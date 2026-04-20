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
import type { LlmInputSource } from "../../services/diagnosisCodingExtractionService";
import {
  buildDocumentFactPack,
  type DocumentFactPack,
} from "../../services/documentFactPackBuilder";
import type { ExtractedDocument } from "../../services/documentExtractionService";
import {
  parsePrintedNoteChartValueExtractionPayload,
  type PrintedNoteChartValueExtractionSchema,
} from "./printedNoteChartValueSchema";

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();
const FACT_PACK_SECTION_ITEM_LIMITS = {
  diagnoses: 8,
  assessmentValues: 8,
  homeboundEvidence: 5,
  skilledNeedEvidence: 5,
  hospitalizationReasons: 5,
  medications: 6,
  allergies: 6,
  supportingSnippets: 4,
} as const;
const RAW_FALLBACK_CHARACTER_LIMIT = 2_500;
const FACT_PACK_PRIMARY_MINIMUM_SCORE = 0.55;

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

function dedupeNormalizedValues(values: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= maxItems) {
      break;
    }
  }

  return deduped;
}

function formatFactPackSection(label: string, values: string[], maxItems: number): string | null {
  const cleaned = dedupeNormalizedValues(values, maxItems);
  if (cleaned.length === 0) {
    return null;
  }
  return `${label}:\n${cleaned.map((value) => `- ${value}`).join("\n")}`;
}

function buildFactPackPromptText(factPack: DocumentFactPack): string {
  const diagnosisSection = formatFactPackSection(
    "Diagnoses",
    factPack.diagnoses.map((diagnosis) =>
      [
        diagnosis.rank ? `${diagnosis.rank}` : "",
        diagnosis.code ?? "",
        diagnosis.description,
      ].filter(Boolean).join(" "),
    ),
    FACT_PACK_SECTION_ITEM_LIMITS.diagnoses,
  );
  const assessmentSection = formatFactPackSection(
    "Assessment Values",
    factPack.assessmentValues.map((snippet) => snippet.text),
    FACT_PACK_SECTION_ITEM_LIMITS.assessmentValues,
  );
  const homeboundSection = formatFactPackSection(
    "Homebound Evidence",
    factPack.homeboundEvidence.map((snippet) => snippet.text),
    FACT_PACK_SECTION_ITEM_LIMITS.homeboundEvidence,
  );
  const skilledNeedSection = formatFactPackSection(
    "Skilled Need Evidence",
    factPack.skilledNeedEvidence.map((snippet) => snippet.text),
    FACT_PACK_SECTION_ITEM_LIMITS.skilledNeedEvidence,
  );
  const hospitalizationSection = formatFactPackSection(
    "Hospitalization / Referral Reasons",
    factPack.hospitalizationReasons.map((snippet) => snippet.text),
    FACT_PACK_SECTION_ITEM_LIMITS.hospitalizationReasons,
  );
  const medicationSection = formatFactPackSection(
    "Medications",
    factPack.medications.map((medication) =>
      [
        medication.name,
        medication.dose ?? "",
        medication.route ?? "",
        medication.frequency ?? "",
      ].filter(Boolean).join(" "),
    ),
    FACT_PACK_SECTION_ITEM_LIMITS.medications,
  );
  const allergySection = formatFactPackSection(
    "Allergies",
    factPack.allergies,
    FACT_PACK_SECTION_ITEM_LIMITS.allergies,
  );
  const supportSection = formatFactPackSection(
    "Supporting Snippets",
    factPack.uncategorizedEvidence.map((snippet) => snippet.text),
    FACT_PACK_SECTION_ITEM_LIMITS.supportingSnippets,
  );

  return [
    diagnosisSection,
    assessmentSection,
    homeboundSection,
    skilledNeedSection,
    hospitalizationSection,
    medicationSection,
    allergySection,
    supportSection,
  ].filter((section): section is string => Boolean(section)).join("\n\n");
}

function buildSyntheticPrintedNoteDocument(sourceText: string): ExtractedDocument[] {
  const normalized = normalizeWhitespace(sourceText);
  if (!normalized) {
    return [];
  }
  return [{
    type: "OASIS",
    text: normalized,
    metadata: {
      source: "artifact_fallback",
      effectiveTextSource: "viewer_text_fallback",
      textSelectionReason: "synthetic_fact_pack_input",
      textLength: normalized.length,
    },
  }];
}

function buildRawFallbackExcerpt(sourceText: string): string {
  const normalized = normalizeWhitespace(sourceText);
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, RAW_FALLBACK_CHARACTER_LIMIT);
}

function buildFactPackCoverageSummary(factPack: DocumentFactPack): {
  populatedSections: string[];
  missingCriticalSections: string[];
  factPackCoverageScore: number;
  hasStrongCoverage: boolean;
} {
  const populatedSections = [
    factPack.diagnoses.length > 0 ? "diagnoses" : null,
    factPack.assessmentValues.length > 0 ? "assessmentValues" : null,
    factPack.homeboundEvidence.length > 0 ? "homeboundEvidence" : null,
    factPack.skilledNeedEvidence.length > 0 ? "skilledNeedEvidence" : null,
    factPack.hospitalizationReasons.length > 0 ? "hospitalizationReasons" : null,
    factPack.medications.length > 0 ? "medications" : null,
    factPack.allergies.length > 0 ? "allergies" : null,
    factPack.uncategorizedEvidence.length > 0 ? "supportingSnippets" : null,
  ].filter((section): section is string => Boolean(section));

  const hasAssessmentCoverage = factPack.assessmentValues.length > 0;
  const hasDiagnosisCoverage = factPack.diagnoses.length > 0;
  const hasNarrativeCoverage =
    factPack.homeboundEvidence.length > 0 ||
    factPack.skilledNeedEvidence.length > 0 ||
    factPack.hospitalizationReasons.length > 0 ||
    factPack.uncategorizedEvidence.length > 0;
  const hasMedicationCoverage =
    factPack.medications.length > 0 ||
    factPack.allergies.length > 0;

  const missingCriticalSections = [
    hasAssessmentCoverage ? null : "assessmentValues",
    hasDiagnosisCoverage ? null : "diagnoses",
    hasNarrativeCoverage ? null : "narrativeEvidence",
    hasMedicationCoverage ? null : "medicationsOrAllergies",
  ].filter((section): section is string => Boolean(section));
  const factPackCoverageScore = Number((
    (hasAssessmentCoverage ? 0.35 : 0) +
    (hasDiagnosisCoverage ? 0.2 : 0) +
    (hasNarrativeCoverage ? 0.2 : 0) +
    (hasMedicationCoverage ? 0.15 : 0) +
    (factPack.uncategorizedEvidence.length > 0 ? 0.1 : 0)
  ).toFixed(2));
  const strongCriticalSectionCount = 4 - missingCriticalSections.length;

  return {
    populatedSections,
    missingCriticalSections,
    factPackCoverageScore,
    hasStrongCoverage:
      factPackCoverageScore >= FACT_PACK_PRIMARY_MINIMUM_SCORE &&
      strongCriticalSectionCount >= 2,
  };
}

function resolveChartValueInputSource(sourceText: string): {
  factPackText: string;
  rawFallbackText: string;
  llmInputSource: LlmInputSource;
  diagnostics: string[];
} {
  const sourceDocuments = buildSyntheticPrintedNoteDocument(sourceText);
  const rawFallbackText = buildRawFallbackExcerpt(sourceText);

  if (sourceDocuments.length === 0) {
    return {
      factPackText: "",
      rawFallbackText,
      llmInputSource: "raw_text_fallback",
      diagnostics: [
        "LLM input source: raw_text_fallback.",
        "Fact pack unavailable or empty; using bounded raw text fallback.",
      ],
    };
  }

  const factPack = buildDocumentFactPack(sourceDocuments);
  const factPackText = buildFactPackPromptText(factPack);
  if (!factPackText) {
    return {
      factPackText: "",
      rawFallbackText,
      llmInputSource: "raw_text_fallback",
      diagnostics: [
        "LLM input source: raw_text_fallback.",
        "Fact pack unavailable or empty; using bounded raw text fallback.",
      ],
    };
  }

  const coverage = buildFactPackCoverageSummary(factPack);
  const promptCharacterEstimate = factPackText.length + (coverage.hasStrongCoverage ? 0 : rawFallbackText.length);
  const diagnostics = [
    `Fact pack coverage: ${coverage.populatedSections.join(", ") || "none"}.`,
    `Fact pack coverage score: ${coverage.factPackCoverageScore}.`,
    `Prompt character estimate: ${promptCharacterEstimate}.`,
  ];

  if (coverage.hasStrongCoverage || !rawFallbackText) {
    return {
      factPackText,
      rawFallbackText: "",
      llmInputSource: "fact_pack_primary",
      diagnostics: [
        "LLM input source: fact_pack_primary.",
        ...diagnostics,
        "Fallback reason: none.",
      ],
    };
  }

  return {
    factPackText,
    rawFallbackText,
    llmInputSource: "fact_pack_plus_raw_fallback",
    diagnostics: [
      "LLM input source: fact_pack_plus_raw_fallback.",
      ...diagnostics,
      `Fallback reason: ${coverage.missingCriticalSections.join(", ") || "coverage_score_below_threshold"}.`,
      `Raw fallback appended for missing coverage: ${coverage.missingCriticalSections.join(", ") || "coverage_score_below_threshold"}.`,
    ],
  };
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
  resolvedInput: {
    factPackText: string;
    rawFallbackText: string;
    llmInputSource: LlmInputSource;
  };
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
    `Selected input source: ${input.resolvedInput.llmInputSource}.`,
    "Use DOCUMENT_FACT_PACK first. It is compact evidence derived from the printed OASIS note text.",
    "Use RAW_FALLBACK_EXCERPTS only when DOCUMENT_FACT_PACK is insufficient for a field or lacks needed nuance.",
    "Do not use referral facts, workbook values, or outside assumptions.",
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
    "DOCUMENT_FACT_PACK:",
    input.resolvedInput.factPackText || "(empty)",
    ...(input.resolvedInput.rawFallbackText
      ? [
          "",
          "RAW_FALLBACK_EXCERPTS:",
          input.resolvedInput.rawFallbackText,
        ]
      : []),
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
  currentChartValueSource: "printed_note_ocr" | null;
  artifactPath: string | null;
  extractedFieldCount: number;
  warnings: string[];
  invocationModelId: string | null;
  llmInputSource: LlmInputSource | null;
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
      currentChartValueSource: null,
      artifactPath: null,
      extractedFieldCount: 0,
      warnings: ["Printed-note chart-value extraction skipped because no extracted text path was available."],
      invocationModelId: null,
      llmInputSource: null,
    };
  }

  const sourceText = normalizeWhitespace(await readFile(input.extractedTextPath, "utf8").catch(() => ""));
  if (!sourceText) {
    return {
      currentChartValues: {},
      currentChartValueSource: null,
      artifactPath: null,
      extractedFieldCount: 0,
      warnings: ["Printed-note chart-value extraction skipped because the extracted text was empty."],
      invocationModelId: null,
      llmInputSource: null,
    };
  }

  const resolvedInput = resolveChartValueInputSource(sourceText);
  const llmResult = await invokeChartValueLlm({
    env: input.env,
    logger: input.logger,
    prompt: buildPrompt({
      workItem: input.workItem,
      resolvedInput,
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
      llmInputSource: resolvedInput.llmInputSource,
      extractedFieldCount: Object.keys(currentChartValues).length,
      invocationModelId: llmResult.invocationModelId,
      currentChartValues,
      extractedFieldValues: llmResult.payload?.current_field_values ?? [],
      warnings: [
        ...resolvedInput.diagnostics,
        ...(llmResult.payload?.warnings ?? []),
        ...llmResult.warnings,
      ],
    }, null, 2),
    "utf8",
  );

  return {
    currentChartValues,
    currentChartValueSource: "printed_note_ocr",
    artifactPath,
    extractedFieldCount: Object.keys(currentChartValues).length,
    warnings: [
      ...resolvedInput.diagnostics,
      ...(llmResult.payload?.warnings ?? []),
      ...llmResult.warnings,
    ],
    invocationModelId: llmResult.invocationModelId,
    llmInputSource: resolvedInput.llmInputSource,
  };
}
