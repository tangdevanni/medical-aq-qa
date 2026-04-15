import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { FinaleBatchEnv } from "../../config/env";
import {
  resolveBedrockConfig,
  sendBedrockConverseWithProfileFallback,
} from "../../config/bedrock";
import { REFERRAL_FIELD_CONTRACT } from "../../referralProcessing/fieldContract";
import {
  parsePrintedNoteChartValueExtractionPayload,
  type PrintedNoteChartValueExtractionSchema,
} from "./printedNoteChartValueSchema";

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function getBedrockClient(region: string): BedrockRuntimeClient {
  const existing = bedrockClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function extractConverseText(response: ConverseCommandOutput): string {
  const blocks = response.output?.message?.content;
  if (!blocks) {
    return "";
  }
  const texts: string[] = [];
  for (const block of blocks) {
    if ("text" in block && typeof block.text === "string") {
      const value = normalizeWhitespace(block.text);
      if (value) {
        texts.push(value);
      }
    }
  }
  return normalizeWhitespace(texts.join("\n"));
}

function isChartValueLlmEnabled(env: FinaleBatchEnv): boolean {
  return Boolean(env.CODE_LLM_ENABLED && env.LLM_PROVIDER === "bedrock");
}

function sanitizeValue(fieldKey: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return null;
    }
    if (fieldKey.endsWith("_phone")) {
      const digits = normalized.replace(/\D+/g, "");
      return digits || null;
    }
    return normalized.length > 520 ? normalized.slice(0, 520).trimEnd() : normalized;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => normalizeWhitespace(entry))
      .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "object") {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => {
        if (
          entryValue === null ||
          typeof entryValue === "string" ||
          typeof entryValue === "number" ||
          typeof entryValue === "boolean"
        ) {
          return [key, typeof entryValue === "string" ? normalizeWhitespace(entryValue) : entryValue] as const;
        }
        return null;
      })
      .filter((entry): entry is readonly [string, string | number | boolean | null] => entry !== null);
    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : null;
  }

  return null;
}

function buildPrompt(input: {
  workItem: PatientEpisodeWorkItem;
  sourceText: string;
}): string {
  const fieldGuide = REFERRAL_FIELD_CONTRACT.map((field) =>
    [
      `field_key=${field.key}`,
      `label=${field.label}`,
      `type=${field.type}`,
      `control=${field.control}`,
      `reference_only=${field.reference_only}`,
      `compare_strategy=${field.compare_strategy}`,
    ].join("; "),
  );

  return [
    "Return strict JSON only.",
    "You are extracting current chart values from a printed OASIS note captured from the portal.",
    "Use only PRINTED_OASIS_NOTE_TEXT. Do not use referral facts, workbook values, or outside assumptions.",
    "Only include fields when the printed portal note explicitly provides a patient-specific current value.",
    "Do not treat section headings, unlabeled checkbox groups, fax headers, page counters, field labels, or surrounding boilerplate as values.",
    "If a field appears blank, unchecked, omitted, or not confidently extractable, omit it from current_field_values.",
    "For phone fields, return digits only. For date fields, preserve the chart date string exactly as shown when possible.",
    "For narrative fields, return a concise chart-faithful summary only when the printed note contains clear patient-specific text for that field.",
    "Each extracted field must include 1-3 short source_spans copied verbatim from the printed note.",
    "Allowed fields:",
    ...fieldGuide.map((entry) => `- ${entry}`),
    "Required JSON shape:",
    JSON.stringify({
      current_field_values: [
        {
          field_key: "field_key_from_allowed_fields",
          current_value: "chart value",
          confidence: 0.0,
          source_spans: ["short exact evidence span"],
        },
      ],
      warnings: [],
    }),
    "",
    `Patient: ${input.workItem.patientIdentity.displayName}`,
    "PRINTED_OASIS_NOTE_TEXT:",
    input.sourceText.slice(0, 20_000),
  ].join("\n");
}

async function invokeChartValueLlm(input: {
  env: FinaleBatchEnv;
  logger: Logger;
  prompt: string;
}): Promise<{
  payload: PrintedNoteChartValueExtractionSchema | null;
  invocationModelId: string | null;
  warnings: string[];
}> {
  if (!isChartValueLlmEnabled(input.env)) {
    return {
      payload: null,
      invocationModelId: null,
      warnings: ["Printed-note chart-value extraction skipped because the LLM is disabled or unavailable."],
    };
  }

  const config = resolveBedrockConfig(input.env);
  const client = getBedrockClient(config.region);
  try {
    const { response, invocationModelId, autoResolvedInferenceProfile } =
      await sendBedrockConverseWithProfileFallback({
        client,
        config,
        command: {
          messages: [
            {
              role: "user",
              content: [{ text: input.prompt }],
            },
          ],
          inferenceConfig: {
            temperature: 0,
            maxTokens: 4_000,
          },
        },
      });

    const payload = parsePrintedNoteChartValueExtractionPayload(extractConverseText(response));
    if (!payload) {
      input.logger.warn(
        { workflowDomain: "qa", invocationModelId },
        "printed-note chart-value extraction returned invalid JSON",
      );
      return {
        payload: null,
        invocationModelId,
        warnings: [
          autoResolvedInferenceProfile
            ? `Printed-note chart-value extraction returned invalid JSON after retrying with inference profile ${invocationModelId}.`
            : "Printed-note chart-value extraction returned invalid JSON.",
        ],
      };
    }

    return {
      payload,
      invocationModelId,
      warnings: autoResolvedInferenceProfile
        ? [`Printed-note chart-value extraction used inference profile ${invocationModelId}.`]
        : [],
    };
  } catch (error) {
    input.logger.warn(
      { workflowDomain: "qa", error: error instanceof Error ? error.message : String(error) },
      "printed-note chart-value extraction failed",
    );
    return {
      payload: null,
      invocationModelId: null,
      warnings: [
        `Printed-note chart-value extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export interface PrintedNoteChartValueExtractionResult {
  currentChartValues: Record<string, unknown>;
  artifactPath: string | null;
  extractedFieldCount: number;
  warnings: string[];
  invocationModelId: string | null;
}

export async function extractCurrentChartValuesFromPrintedNote(input: {
  env: FinaleBatchEnv;
  logger: Logger;
  outputDir: string;
  workItem: PatientEpisodeWorkItem;
  extractedTextPath: string | null;
}): Promise<PrintedNoteChartValueExtractionResult> {
  if (!input.extractedTextPath) {
    return {
      currentChartValues: {},
      artifactPath: null,
      extractedFieldCount: 0,
      warnings: ["Printed-note chart-value extraction skipped because no extracted text path was available."],
      invocationModelId: null,
    };
  }

  const sourceText = normalizeWhitespace(await readFile(input.extractedTextPath, "utf8").catch(() => ""));
  if (!sourceText) {
    return {
      currentChartValues: {},
      artifactPath: null,
      extractedFieldCount: 0,
      warnings: ["Printed-note chart-value extraction skipped because the extracted text was empty."],
      invocationModelId: null,
    };
  }

  const llmResult = await invokeChartValueLlm({
    env: input.env,
    logger: input.logger,
    prompt: buildPrompt({
      workItem: input.workItem,
      sourceText,
    }),
  });

  const allowedFieldKeys = new Set(REFERRAL_FIELD_CONTRACT.map((field) => field.key));
  const currentChartValues = Object.fromEntries(
    (llmResult.payload?.current_field_values ?? [])
      .filter((entry) => allowedFieldKeys.has(entry.field_key))
      .map((entry) => [entry.field_key, sanitizeValue(entry.field_key, entry.current_value)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== null),
  );

  const artifactPath = path.join(
    input.outputDir,
    "patients",
    input.workItem.id,
    "printed-note-chart-values.json",
  );
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: "printed_note_ocr",
      extractedTextPath: input.extractedTextPath,
      extractedFieldCount: Object.keys(currentChartValues).length,
      invocationModelId: llmResult.invocationModelId,
      currentChartValues,
      extractedFieldValues: llmResult.payload?.current_field_values ?? [],
      warnings: [
        ...(llmResult.payload?.warnings ?? []),
        ...llmResult.warnings,
      ],
    }, null, 2),
    "utf8",
  );

  return {
    currentChartValues,
    artifactPath,
    extractedFieldCount: Object.keys(currentChartValues).length,
    warnings: [
      ...(llmResult.payload?.warnings ?? []),
      ...llmResult.warnings,
    ],
    invocationModelId: llmResult.invocationModelId,
  };
}
