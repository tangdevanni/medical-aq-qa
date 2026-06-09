import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";
import { resolveBedrockConfig, sendBedrockConverseWithProfileFallback } from "../config/bedrock";
import type { FinaleBatchEnv } from "../config/env";
import {
  writeOasisMggFieldSnapshot,
  type OasisMggFieldSnapshotArtifact,
} from "./oasisMggFieldSnapshotService";

export const OASIS_DOM_SECTION_PROCESSING_MANIFEST_FILE_NAME = "oasis-dom-section-processing-manifest.json";
export const OASIS_DOM_SECTION_OUTPUTS_FILE_NAME = "oasis-dom-section-outputs.json";
export const OASIS_DOM_SECTION_PROMPT_VERSION = "oasis-dom-section-llm.v1";

export type OasisDomDashboardSectionKey =
  | "diagnoses"
  | "medications_allergies"
  | "safety_social_support"
  | "functional_therapy"
  | "body_systems"
  | "dates_admin"
  | "plan_of_care";

export type OasisDomSectionProcessingSource =
  | "new_llm"
  | "cache"
  | "deterministic"
  | "skipped";

export type OasisDomSectionAnalysisStatus =
  | "success"
  | "cache"
  | "disabled"
  | "failed"
  | "skipped_empty";

export type OasisDomSectionOutputRow = {
  label: string;
  value: string;
  meta: string | null;
  sourceKind: "structured_value" | "table_row" | "section_evidence" | "llm_summary";
  confidence: number | null;
  sourceSectionTitle: string | null;
  sourceItemCode: string | null;
};

export type OasisDomSectionResult = {
  sectionKey: OasisDomDashboardSectionKey;
  label: string;
  sourceSectionTitles: string[];
  sectionContentHash: string;
  analysisInputHash: string;
  cacheKey: string;
  promptVersion: string;
  modelId: string;
  processingMode: "dom_section_llm";
  processingSource: OasisDomSectionProcessingSource;
  analysisStatus: OasisDomSectionAnalysisStatus;
  rerunReason: "new_section" | "section_content_changed" | "model_or_prompt_changed" | null;
  fieldCount: number;
  tableCount: number;
  evidenceRowCount: number;
  rows: OasisDomSectionOutputRow[];
  warnings: string[];
  processedAt: string;
};

export type OasisDomSectionProcessingManifest = {
  schemaVersion: "oasis-dom-section-processing-manifest.v1";
  generatedAt: string;
  patientId: string;
  patientRunId: string;
  processingMode: "dom_section_llm";
  promptVersion: string;
  modelId: string;
  domContentHash: string;
  sectionInputs: Array<{
    sectionKey: OasisDomDashboardSectionKey;
    label: string;
    sourceSectionTitles: string[];
    sectionContentHash: string;
    analysisInputHash: string;
    cacheKey: string;
    fieldCount: number;
    tableCount: number;
    llmAnalysisSource: OasisDomSectionProcessingSource;
    analysisStatus: OasisDomSectionAnalysisStatus;
    rerunReason: OasisDomSectionResult["rerunReason"];
  }>;
  summary: {
    totalSections: number;
    processedSections: number;
    reusedSections: number;
    deterministicSections: number;
    skippedSections: number;
    failedSections: number;
  };
};

export type OasisDomSectionOutputsArtifact = {
  schemaVersion: "oasis-dom-section-outputs.v1";
  generatedAt: string;
  patientId: string;
  patientRunId: string;
  processingMode: "dom_section_llm";
  promptVersion: string;
  modelId: string;
  domContentHash: string;
  sections: OasisDomSectionResult[];
  summary: OasisDomSectionProcessingManifest["summary"];
  warnings: string[];
};

export type OasisDomSectionLlmInvoke = (input: {
  prompt: string;
  sectionKey: OasisDomDashboardSectionKey;
  sectionLabel: string;
  sectionContentHash: string;
}) => Promise<string | { content: string; modelId?: string | null }>;

type SectionDefinition = {
  key: OasisDomDashboardSectionKey;
  label: string;
  pattern: RegExp;
};

type SectionWorkItem = {
  sectionKey: OasisDomDashboardSectionKey;
  label: string;
  sourceSections: PortalDomExtractedSection[];
  sourceSectionTitles: string[];
  normalizedContent: string;
  sectionContentHash: string;
  analysisInputHash: string;
  cacheKey: string;
  fieldCount: number;
  tableCount: number;
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: "diagnoses",
    label: "Diagnoses",
    pattern: /diagnos|icd|m1021|m1023|m1025|active problem/i,
  },
  {
    key: "medications_allergies",
    label: "Medications & Allergies",
    pattern: /medication|allerg|drug|dose|route|o0110|injectable/i,
  },
  {
    key: "safety_social_support",
    label: "Safety / Social Support",
    pattern: /safety|risk|emergency|living situation|lives|caregiver|support|code status|m1033|m1100|m2102/i,
  },
  {
    key: "functional_therapy",
    label: "Functional / Therapy",
    pattern: /functional|therapy|mobility|musculoskeletal|gait|ambulat|transfer|walker|wheelchair|gg0100|gg0130|gg0170|m18|m19/i,
  },
  {
    key: "body_systems",
    label: "Body Systems",
    pattern: /vital|pain|neuro|eyes|ears|cardio|respiratory|gastro|genitourinary|integumentary|skin|wound|emotional|mood|endocrine|nutrition|supplement|bims|phq|m13|j0/i,
  },
  {
    key: "dates_admin",
    label: "Dates / Admin",
    pattern: /administrative|start of care|soc|date|provider|identity|patient information|m00|billing|episode|insurance|payer/i,
  },
  {
    key: "plan_of_care",
    label: "Plan of Care",
    pattern: /plan of care|careplan|goal|intervention|physical therapy evaluation|frequency/i,
  },
];

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function getBedrockClient(region: string): BedrockRuntimeClient {
  const cached = bedrockClientByRegion.get(region);
  if (cached) {
    return cached;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeKey(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(^|At$)(extractedAt|generatedAt|processedAt|lastSeenAt|firstSeenAt|lastChangedAt)/.test(key))
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatFieldValue(field: PortalDomExtractedField): string | null {
  if (field.selectedText) {
    return normalizeWhitespace(field.selectedText);
  }
  if (Array.isArray(field.value)) {
    const values = field.value.map(normalizeWhitespace).filter(Boolean);
    return values.length > 0 ? values.join("; ") : null;
  }
  if (typeof field.value === "boolean") {
    return field.value ? "Yes" : null;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  if (typeof field.value === "string") {
    return normalizeWhitespace(field.value) || null;
  }
  if (typeof field.checked === "boolean") {
    return field.checked ? "Selected" : null;
  }
  if (field.selectedValue) {
    return normalizeWhitespace(field.selectedValue);
  }
  return null;
}

function fieldLabel(field: PortalDomExtractedField): string {
  const label = normalizeWhitespace(field.label ?? field.key ?? "");
  if (field.itemCode && label && !label.includes(field.itemCode)) {
    return `${field.itemCode} - ${label}`;
  }
  return label || field.itemCode || "OASIS field";
}

function titleSectionKeyFor(title: string): OasisDomDashboardSectionKey | null {
  const normalizedTitle = normalizeWhitespace(title);
  if (!normalizedTitle) {
    return null;
  }
  if (/care plan|plan of care|clinical narrative/i.test(normalizedTitle)) {
    return "plan_of_care";
  }
  if (/active diagnoses|diagnos|icd/i.test(normalizedTitle)) {
    return "diagnoses";
  }
  if (/medication|allerg/i.test(normalizedTitle)) {
    return "medications_allergies";
  }
  if (/safety|risk|emergency|caregiver|support/i.test(normalizedTitle)) {
    return "safety_social_support";
  }
  if (/functional|mobility|musculoskeletal|gait|range of motion|self care|therapy/i.test(normalizedTitle)) {
    return "functional_therapy";
  }
  if (/administrative|patient information|start of care|billing|provider|identity/i.test(normalizedTitle)) {
    return "dates_admin";
  }
  if (/vital|pain|neuro|eyes|ears|cardio|pulmonary|gastro|genitourinary|integumentary|skin|wound|mood/i.test(normalizedTitle)) {
    return "body_systems";
  }
  return null;
}

function isIgnoredDomField(field: PortalDomExtractedField): boolean {
  const label = normalizeWhitespace(field.label ?? "");
  const key = normalizeWhitespace(field.key ?? "");
  const value = formatFieldValue(field);
  if (!value) {
    return true;
  }
  if (/^(?:100%|false|unchecked|not selected|no data)$/i.test(value)) {
    return true;
  }
  if (/^(?:\^|x|\u00d7|\u00d7\^)+$/i.test(value)) {
    return true;
  }
  if (/m-item search|type agency's name|^fax$/i.test(label)) {
    return true;
  }
  if (/^zoom-input$/i.test(key)) {
    return true;
  }
  return false;
}

function usefulSectionFields(section: PortalDomExtractedSection): PortalDomExtractedField[] {
  return (section.fields ?? []).filter((field) => !isIgnoredDomField(field));
}

function sectionSearchText(section: PortalDomExtractedSection): string {
  return [
    section.title,
    ...(section.fields ?? []).flatMap((field) => [
      field.itemCode,
      field.label,
      field.key,
      formatFieldValue(field),
      field.evidenceText,
    ]),
    ...(section.tables ?? []).flatMap((table) => [
      table.title,
      ...table.headers,
      ...table.rows.flat(),
    ]),
    section.visibleTextDigest,
  ].map((value) => normalizeWhitespace(value)).filter(Boolean).join(" ");
}

function sectionKeyFor(section: PortalDomExtractedSection): OasisDomDashboardSectionKey {
  const titleKey = titleSectionKeyFor(section.title);
  if (titleKey) {
    return titleKey;
  }
  const text = sectionSearchText(section);
  if (/plan of care|careplan|goal|intervention|physical therapy evaluation|frequency/i.test(text)) {
    return "plan_of_care";
  }
  return SECTION_DEFINITIONS.find((definition) => definition.pattern.test(text))?.key ?? "body_systems";
}

function sectionLabelFor(sectionKey: OasisDomDashboardSectionKey): string {
  return SECTION_DEFINITIONS.find((definition) => definition.key === sectionKey)?.label ?? "OASIS Section";
}

function buildSectionContent(section: PortalDomExtractedSection): string {
  const lines = [`Section: ${normalizeWhitespace(section.title)}`];
  for (const field of usefulSectionFields(section)) {
    const value = formatFieldValue(field);
    if (!value) {
      continue;
    }
    lines.push(`Field: ${fieldLabel(field)} = ${value}`);
  }
  for (const table of section.tables ?? []) {
    const title = normalizeWhitespace(table.title) || "Table";
    lines.push(`Table: ${title}`);
    if (table.headers.length > 0) {
      lines.push(`Headers: ${table.headers.map(normalizeWhitespace).filter(Boolean).join(" | ")}`);
    }
    for (const row of table.rows.slice(0, 30)) {
      const rowText = row.map(normalizeWhitespace).filter(Boolean).join(" | ");
      if (rowText) {
        lines.push(`Row: ${rowText}`);
      }
    }
  }
  const digest = normalizeWhitespace(section.visibleTextDigest);
  if (digest) {
    lines.push(`Visible text: ${digest.slice(0, 2_500)}`);
  }
  return lines.join("\n").trim();
}

export function buildOasisDomSectionWorkItems(input: {
  state: PortalDomExtractedState;
  patientId: string;
  promptVersion?: string;
  modelId: string;
}): SectionWorkItem[] {
  const promptVersion = input.promptVersion ?? OASIS_DOM_SECTION_PROMPT_VERSION;
  const sectionsByKey = new Map<OasisDomDashboardSectionKey, PortalDomExtractedSection[]>();
  for (const section of input.state.sections) {
    if (section.status === "skipped_duplicate") {
      continue;
    }
    const sectionKey = sectionKeyFor(section);
    const sections = sectionsByKey.get(sectionKey) ?? [];
    sections.push(section);
    sectionsByKey.set(sectionKey, sections);
  }

  return SECTION_DEFINITIONS.map((definition) => {
    const sourceSections = sectionsByKey.get(definition.key) ?? [];
    const sourceSectionTitles = sourceSections.map((section) => section.title);
    const normalizedContent = sourceSections
      .map(buildSectionContent)
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const sectionContentHash = sha256(stableJson({
      sectionKey: definition.key,
      sourceSectionTitles,
      normalizedContent,
    }));
    const analysisInputHash = sha256(stableJson({
      patientId: input.patientId,
      sectionKey: definition.key,
      sectionContentHash,
      promptVersion,
      modelId: input.modelId,
      processingMode: "dom_section_llm",
    }));
    const cacheKey = sha256(stableJson({
      patientId: input.patientId,
      sectionKey: definition.key,
      sectionContentHash,
      promptVersion,
      modelId: input.modelId,
      processingMode: "dom_section_llm",
    }));
    return {
      sectionKey: definition.key,
      label: definition.label,
      sourceSections,
      sourceSectionTitles,
      normalizedContent,
      sectionContentHash,
      analysisInputHash,
      cacheKey,
      fieldCount: sourceSections.reduce((total, section) => total + usefulSectionFields(section).length, 0),
      tableCount: sourceSections.reduce((total, section) => total + section.tables.length, 0),
    };
  });
}

function buildPrompt(workItem: SectionWorkItem): string {
  return [
    "You are extracting display-ready OASIS dashboard facts from DOM-acquired OASIS content.",
    "Use only the supplied DOM content. Do not infer missing values. Do not create clinical recommendations.",
    "Return JSON only with this exact shape:",
    '{"rows":[{"label":"short label","value":"captured value","meta":"optional short metadata or null","sourceKind":"structured_value|table_row|section_evidence|llm_summary","confidence":0.0,"sourceItemCode":"optional OASIS item code or null"}],"warnings":[]}',
    "Rows should be concise and suitable for a clinical review card. Prefer structured field and table values over narrative evidence. If only narrative section evidence exists, label it \"OASIS section evidence\".",
    "",
    `Dashboard section: ${workItem.label}`,
    `Section key: ${workItem.sectionKey}`,
    "DOM content:",
    workItem.normalizedContent || "(no captured content)",
  ].join("\n");
}

function extractConverseText(response: ConverseCommandOutput): string {
  const parts = response.output?.message?.content ?? [];
  return parts
    .map((part) => "text" in part && typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trim();
}

async function invokeBedrock(input: {
  env: FinaleBatchEnv;
  prompt: string;
}): Promise<{ content: string; modelId: string }> {
  const config = resolveBedrockConfig({
    ...input.env,
    CODE_LLM_ENABLED: true,
    BEDROCK_MODEL_ID: input.env.OASIS_SECTION_LLM_MODEL_ID ?? input.env.BEDROCK_MODEL_ID,
  });
  const client = getBedrockClient(config.region);
  const { response, invocationModelId } = await sendBedrockConverseWithProfileFallback({
    client,
    config,
    command: {
      messages: [{
        role: "user",
        content: [{ text: input.prompt }],
      }],
      inferenceConfig: {
        maxTokens: input.env.OASIS_SECTION_LLM_MAX_TOKENS,
        temperature: 0,
      },
    },
  });
  return {
    content: extractConverseText(response),
    modelId: invocationModelId,
  };
}

function isOasisSectionLlmEnabled(env: FinaleBatchEnv, invokeText?: OasisDomSectionLlmInvoke): boolean {
  if (invokeText) {
    return true;
  }
  return Boolean((env.OASIS_SECTION_LLM_ENABLED ?? env.CODE_LLM_ENABLED) && env.LLM_PROVIDER === "bedrock");
}

function configuredModelId(env: FinaleBatchEnv, enabled: boolean): string {
  if (!enabled) {
    return "disabled";
  }
  return env.OASIS_SECTION_LLM_MODEL_ID ?? env.BEDROCK_INFERENCE_PROFILE_ID ?? env.BEDROCK_MODEL_ID ?? "bedrock";
}

function sanitizeRowText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }
  const text = normalizeWhitespace(String(value));
  return text ? text.slice(0, 700) : null;
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function parseLlmRows(content: string, workItem: SectionWorkItem): OasisDomSectionOutputRow[] {
  const jsonText = content
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(jsonText) as unknown;
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rows = Array.isArray(record?.rows) ? record.rows : [];
  return rows
    .map((row): OasisDomSectionOutputRow | null => {
      const rowRecord = row && typeof row === "object" && !Array.isArray(row)
        ? row as Record<string, unknown>
        : null;
      if (!rowRecord) {
        return null;
      }
      const label = sanitizeRowText(rowRecord.label);
      const value = sanitizeRowText(rowRecord.value);
      if (!label || !value) {
        return null;
      }
      const rawSourceKind = sanitizeRowText(rowRecord.sourceKind);
      const sourceKind: OasisDomSectionOutputRow["sourceKind"] =
        rawSourceKind === "structured_value" ||
        rawSourceKind === "table_row" ||
        rawSourceKind === "section_evidence" ||
        rawSourceKind === "llm_summary"
          ? rawSourceKind
          : "llm_summary";
      return {
        label,
        value,
        meta: sanitizeRowText(rowRecord.meta),
        sourceKind,
        confidence: clampConfidence(rowRecord.confidence),
        sourceSectionTitle: workItem.sourceSectionTitles[0] ?? null,
        sourceItemCode: sanitizeRowText(rowRecord.sourceItemCode),
      };
    })
    .filter((row): row is OasisDomSectionOutputRow => Boolean(row))
    .slice(0, 80);
}

function deterministicRows(workItem: SectionWorkItem): OasisDomSectionOutputRow[] {
  const rows: OasisDomSectionOutputRow[] = [];
  for (const section of workItem.sourceSections) {
    for (const field of usefulSectionFields(section)) {
      const value = formatFieldValue(field);
      const isZeroMggSelection =
        /\b(?:M\d{4}|GG\d{4}[A-Z0-9]*)\b/i.test([field.itemCode, field.key, field.label].filter(Boolean).join(" ")) &&
        (normalizeWhitespace(field.selectedValue) === "0" || /^0(?:\.|\s|$)/.test(value ?? ""));
      if (!value || isZeroMggSelection || /^(?:0|false|unchecked|not selected)$/i.test(value)) {
        continue;
      }
      rows.push({
        label: fieldLabel(field),
        value,
        meta: null,
        sourceKind: "structured_value",
        confidence: field.confidence === "high" ? 0.92 : field.confidence === "medium" ? 0.78 : 0.55,
        sourceSectionTitle: section.title,
        sourceItemCode: field.itemCode ?? null,
      });
    }
    for (const table of section.tables) {
      const headers = table.headers.map(normalizeWhitespace);
      for (const row of table.rows.slice(0, 20)) {
        const cells = row.map(normalizeWhitespace).filter(Boolean);
        if (cells.length === 0) {
          continue;
        }
        rows.push({
          label: normalizeWhitespace(table.title) || "OASIS table row",
          value: headers.length === row.length
            ? row.map((cell, index) => `${headers[index] || `Column ${index + 1}`}: ${normalizeWhitespace(cell)}`).join(" | ")
            : cells.join(" | "),
          meta: null,
          sourceKind: "table_row",
          confidence: 0.75,
          sourceSectionTitle: section.title,
          sourceItemCode: null,
        });
      }
    }
  }
  if (rows.length === 0 && workItem.normalizedContent) {
    rows.push({
      label: "OASIS section evidence",
      value: workItem.normalizedContent.replace(/\n+/g, " ").slice(0, 700),
      meta: null,
      sourceKind: "section_evidence",
      confidence: 0.5,
      sourceSectionTitle: workItem.sourceSectionTitles[0] ?? null,
      sourceItemCode: null,
    });
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}|${row.value}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 80);
}

function findPreviousResult(input: {
  previousOutputs: OasisDomSectionOutputsArtifact | null;
  workItem: SectionWorkItem;
}): OasisDomSectionResult | null {
  return input.previousOutputs?.sections.find((section) =>
    section.sectionKey === input.workItem.sectionKey &&
    section.cacheKey === input.workItem.cacheKey &&
    section.analysisStatus !== "failed"
  ) ?? null;
}

function rerunReason(input: {
  previousOutputs: OasisDomSectionOutputsArtifact | null;
  workItem: SectionWorkItem;
}): OasisDomSectionResult["rerunReason"] {
  const previous = input.previousOutputs?.sections.find((section) => section.sectionKey === input.workItem.sectionKey);
  if (!previous) {
    return "new_section";
  }
  if (previous.sectionContentHash !== input.workItem.sectionContentHash) {
    return "section_content_changed";
  }
  if (previous.analysisInputHash !== input.workItem.analysisInputHash) {
    return "model_or_prompt_changed";
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function resultBase(input: {
  workItem: SectionWorkItem;
  modelId: string;
  generatedAt: string;
  processingSource: OasisDomSectionProcessingSource;
  analysisStatus: OasisDomSectionAnalysisStatus;
  rerunReason: OasisDomSectionResult["rerunReason"];
  rows: OasisDomSectionOutputRow[];
  warnings?: string[];
}): OasisDomSectionResult {
  return {
    sectionKey: input.workItem.sectionKey,
    label: input.workItem.label,
    sourceSectionTitles: input.workItem.sourceSectionTitles,
    sectionContentHash: input.workItem.sectionContentHash,
    analysisInputHash: input.workItem.analysisInputHash,
    cacheKey: input.workItem.cacheKey,
    promptVersion: OASIS_DOM_SECTION_PROMPT_VERSION,
    modelId: input.modelId,
    processingMode: "dom_section_llm",
    processingSource: input.processingSource,
    analysisStatus: input.analysisStatus,
    rerunReason: input.rerunReason,
    fieldCount: input.workItem.fieldCount,
    tableCount: input.workItem.tableCount,
    evidenceRowCount: input.rows.length,
    rows: input.rows,
    warnings: input.warnings ?? [],
    processedAt: input.generatedAt,
  };
}

export async function processOasisDomSections(input: {
  state: PortalDomExtractedState;
  patientArtifactsDirectory: string;
  patientId: string;
  patientRunId: string;
  env: FinaleBatchEnv;
  invokeText?: OasisDomSectionLlmInvoke;
  generatedAt?: string;
  assessmentId?: string | null;
  assessmentType?: string | null;
  title?: string | null;
  date?: string | null;
  sourceDomStatePath?: string | null;
}): Promise<{
  manifestPath: string;
  outputsPath: string;
  mggSnapshotPath: string;
  manifest: OasisDomSectionProcessingManifest;
  outputs: OasisDomSectionOutputsArtifact;
  mggSnapshot: OasisMggFieldSnapshotArtifact;
}> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const llmEnabled = isOasisSectionLlmEnabled(input.env, input.invokeText);
  const modelId = configuredModelId(input.env, llmEnabled);
  const workItems = buildOasisDomSectionWorkItems({
    state: input.state,
    patientId: input.patientId,
    modelId,
  });
  const manifestPath = path.join(input.patientArtifactsDirectory, OASIS_DOM_SECTION_PROCESSING_MANIFEST_FILE_NAME);
  const outputsPath = path.join(input.patientArtifactsDirectory, OASIS_DOM_SECTION_OUTPUTS_FILE_NAME);
  const previousOutputs = await readJsonIfExists<OasisDomSectionOutputsArtifact>(outputsPath);

  const sections = await mapWithConcurrency(
    workItems,
    input.env.OASIS_SECTION_LLM_MAX_CONCURRENCY,
    async (workItem): Promise<OasisDomSectionResult> => {
      const cached = findPreviousResult({ previousOutputs, workItem });
      if (cached) {
        return {
          ...cached,
          processingSource: "cache",
          analysisStatus: "cache",
          processedAt: generatedAt,
        };
      }

      if (!workItem.normalizedContent) {
        return resultBase({
          workItem,
          modelId,
          generatedAt,
          processingSource: "skipped",
          analysisStatus: "skipped_empty",
          rerunReason: rerunReason({ previousOutputs, workItem }),
          rows: [],
        });
      }

      if (!llmEnabled) {
        return resultBase({
          workItem,
          modelId,
          generatedAt,
          processingSource: "deterministic",
          analysisStatus: "disabled",
          rerunReason: rerunReason({ previousOutputs, workItem }),
          rows: deterministicRows(workItem),
          warnings: ["OASIS section LLM processing is disabled; deterministic DOM rows were persisted."],
        });
      }

      try {
        const prompt = buildPrompt(workItem);
        const invoked = input.invokeText
          ? await input.invokeText({
              prompt,
              sectionKey: workItem.sectionKey,
              sectionLabel: workItem.label,
              sectionContentHash: workItem.sectionContentHash,
            })
          : await invokeBedrock({ env: input.env, prompt });
        const content = typeof invoked === "string" ? invoked : invoked.content;
        const invocationModelId = typeof invoked === "string" ? modelId : invoked.modelId ?? modelId;
        const rows = parseLlmRows(content, workItem);
        return resultBase({
          workItem,
          modelId: invocationModelId,
          generatedAt,
          processingSource: "new_llm",
          analysisStatus: "success",
          rerunReason: rerunReason({ previousOutputs, workItem }),
          rows: rows.length > 0 ? rows : deterministicRows(workItem),
          warnings: rows.length > 0 ? [] : ["OASIS section LLM returned no rows; deterministic DOM rows were retained."],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return resultBase({
          workItem,
          modelId,
          generatedAt,
          processingSource: "deterministic",
          analysisStatus: "failed",
          rerunReason: rerunReason({ previousOutputs, workItem }),
          rows: deterministicRows(workItem),
          warnings: [`OASIS section LLM failed; deterministic DOM rows were retained. ${message}`],
        });
      }
    },
  );

  const summary = {
    totalSections: sections.length,
    processedSections: sections.filter((section) => section.processingSource === "new_llm").length,
    reusedSections: sections.filter((section) => section.processingSource === "cache").length,
    deterministicSections: sections.filter((section) => section.processingSource === "deterministic").length,
    skippedSections: sections.filter((section) => section.processingSource === "skipped").length,
    failedSections: sections.filter((section) => section.analysisStatus === "failed").length,
  };
  const manifest: OasisDomSectionProcessingManifest = {
    schemaVersion: "oasis-dom-section-processing-manifest.v1",
    generatedAt,
    patientId: input.patientId,
    patientRunId: input.patientRunId,
    processingMode: "dom_section_llm",
    promptVersion: OASIS_DOM_SECTION_PROMPT_VERSION,
    modelId,
    domContentHash: input.state.contentHash,
    sectionInputs: sections.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      sourceSectionTitles: section.sourceSectionTitles,
      sectionContentHash: section.sectionContentHash,
      analysisInputHash: section.analysisInputHash,
      cacheKey: section.cacheKey,
      fieldCount: section.fieldCount,
      tableCount: section.tableCount,
      llmAnalysisSource: section.processingSource,
      analysisStatus: section.analysisStatus,
      rerunReason: section.rerunReason,
    })),
    summary,
  };
  const outputs: OasisDomSectionOutputsArtifact = {
    schemaVersion: "oasis-dom-section-outputs.v1",
    generatedAt,
    patientId: input.patientId,
    patientRunId: input.patientRunId,
    processingMode: "dom_section_llm",
    promptVersion: OASIS_DOM_SECTION_PROMPT_VERSION,
    modelId,
    domContentHash: input.state.contentHash,
    sections,
    summary,
    warnings: Array.from(new Set(sections.flatMap((section) => section.warnings))),
  };

  await mkdir(input.patientArtifactsDirectory, { recursive: true });
  const mggSnapshot = await writeOasisMggFieldSnapshot({
    state: input.state,
    patientArtifactsDirectory: input.patientArtifactsDirectory,
    assessmentId: input.assessmentId,
    assessmentType: input.assessmentType,
    title: input.title,
    date: input.date,
    sourceDomStatePath: input.sourceDomStatePath,
    generatedAt,
  });
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
    writeFile(outputsPath, JSON.stringify(outputs, null, 2), "utf8"),
  ]);

  return {
    manifestPath,
    outputsPath,
    mggSnapshotPath: mggSnapshot.snapshotPath,
    manifest,
    outputs,
    mggSnapshot: mggSnapshot.snapshot,
  };
}
