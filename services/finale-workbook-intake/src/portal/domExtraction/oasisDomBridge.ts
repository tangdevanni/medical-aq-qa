import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  PortalDomExtractedField,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";

export const OASIS_DOM_STATE_FILE_NAME = "oasis-dom-extracted-state.json";
export const OASIS_DOM_BRIDGE_TEXT_FILE_NAME = "oasis-dom-bridge-text.txt";
export const OASIS_DOM_COMPARISON_FILE_NAME = "oasis-dom-vs-existing-extraction-comparison.json";

export type OasisDomComparisonDecision =
  | "dom_ready_for_oasis_primary"
  | "dom_ready_with_ocr_fallback"
  | "dom_needs_template_mapping"
  | "dom_not_ready";

export type OasisDomComparisonArtifact = {
  artifactType: "oasis_dom_vs_existing_extraction_comparison";
  generatedAt: string;
  patientCase: string;
  baselineSource: string[];
  candidateSource: string;
  sectionCoverage: {
    domSectionCount: number;
    domSectionLabels: string[];
    highPrioritySectionsFound: string[];
    highPrioritySectionsMissing: string[];
  };
  fieldCoverage: {
    domFieldCount: number;
    domNonEmptyFieldCount: number;
    domItemCodes: string[];
    baselineItemCodes: string[];
    overlappingItemCodes: string[];
  };
  highPriorityClinicalCoverage: Record<string, {
    domMentioned: boolean;
    baselineMentioned: boolean;
  }>;
  diagnosisCoverage: {
    domDiagnosisCueCount: number;
    baselineDiagnosisCueCount: number;
    overlappingDiagnosisCodes: string[];
  };
  valueOverlapSummary: {
    domValueHashCount: number;
    baselineValueHashCount: number;
    overlappingValueHashCount: number;
  };
  missingFromDom: string[];
  missingFromBaseline: string[];
  fallbackReasons: string[];
  recommendedDecision: OasisDomComparisonDecision;
};

const HIGH_PRIORITY_SECTION_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "active_diagnoses", pattern: /active diagnoses|diagnosis|M1021|M1023/i },
  { key: "medication_allergies", pattern: /medication|allerg|injectable|O0110/i },
  { key: "neurological", pattern: /neurological|head|mood|eyes|ears|BIMS|PHQ/i },
  { key: "functional_mobility", pattern: /functional|mobility|musculoskeletal|GG0100|GG0130|GG0170/i },
  { key: "integumentary_wound", pattern: /integumentary|skin|wound|pressure ulcer|M13/i },
  { key: "patient_summary_narrative", pattern: /patient summary|clinical narrative|narrative/i },
  { key: "plan_of_care_pt_eval", pattern: /plan of care|physical therapy|PT evaluation/i },
];

const CLINICAL_CUE_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "diagnoses", pattern: /diagnosis|ICD|M1021|M1023/i },
  { key: "medications", pattern: /medication|allerg|injectable|O0110/i },
  { key: "cognition_mood", pattern: /cognitive|BIMS|PHQ|depression|mood|memory/i },
  { key: "mobility", pattern: /mobility|ambulat|transfer|walker|wheelchair|GG0170/i },
  { key: "wound_skin", pattern: /wound|skin|pressure ulcer|integumentary/i },
  { key: "narrative", pattern: /clinical narrative|patient summary|homebound|medical necessity/i },
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fieldValueText(field: PortalDomExtractedField): string {
  if (Array.isArray(field.value)) {
    return field.value.map(normalizeWhitespace).filter(Boolean).join(" | ");
  }
  if (typeof field.value === "boolean") {
    return field.value ? "checked" : "unchecked";
  }
  return normalizeWhitespace(String(field.selectedText ?? field.value ?? field.selectedValue ?? ""));
}

function fieldBridgeLine(field: PortalDomExtractedField): string | null {
  const value = fieldValueText(field);
  const isEmpty = !value && !field.checked;
  if (isEmpty && field.sourceKind !== "checkbox") {
    return null;
  }
  const label = normalizeWhitespace(field.label ?? field.key ?? field.sourceKind);
  const key = normalizeWhitespace(field.key);
  const prefix = [
    field.itemCode ? `(${field.itemCode})` : "",
    label,
  ].filter(Boolean).join(" ");
  const state = field.sourceKind === "checkbox" || field.sourceKind === "radio"
    ? `${field.checked ? "selected" : "not selected"}${value ? `: ${value}` : ""}`
    : value;
  return `- ${prefix || key || field.sourceKind}: ${state}`;
}

export function buildOasisDomBridgeText(state: PortalDomExtractedState): string {
  const lines = [
    "OASIS DOM EXTRACTED STATE",
    `Extraction Version: ${state.extractionVersion}`,
    `Content Hash: ${state.contentHash}`,
    `Coverage: sections=${state.coverage.sectionCount} fields=${state.coverage.fieldCount} nonEmptyFields=${state.coverage.nonEmptyFieldCount} tables=${state.coverage.tableCount} fallbackRecommended=${state.coverage.fallbackRecommended}`,
    "",
  ];

  for (const section of state.sections) {
    if (section.status === "skipped_duplicate") {
      continue;
    }
    lines.push(`Section: ${section.title}${section.status ? ` [${section.status}]` : ""}`);
    if (section.status === "skipped_deferred") {
      lines.push("- Deferred: Care Plan problem/goal/intervention mapping is intentionally handled later.");
      lines.push("");
      continue;
    }
    const fieldLines = section.fields
      .map(fieldBridgeLine)
      .filter((value): value is string => Boolean(value));
    lines.push(...fieldLines);
    for (const table of section.tables) {
      const title = normalizeWhitespace(table.title) || "Table";
      lines.push(`- ${title}: ${table.headers.join(" | ")}`);
      for (const row of table.rows.slice(0, 25)) {
        lines.push(`  - ${row.map(normalizeWhitespace).filter(Boolean).join(" | ")}`);
      }
    }
    if (section.visibleTextDigest) {
      const digestLines = section.visibleTextDigest
        .split("\n")
        .map(normalizeWhitespace)
        .filter(Boolean)
        .slice(0, 12);
      for (const digestLine of digestLines) {
        if (!fieldLines.some((line) => line.includes(digestLine))) {
          lines.push(`- Text: ${digestLine}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function collectItemCodes(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\b(?:M|GG|O)\d{4}\b/gi), (match) => match[0].toUpperCase()))).sort();
}

function collectValueHashes(text: string): string[] {
  const values = text
    .split(/\n|[|;]/)
    .map(normalizeWhitespace)
    .filter((value) =>
      value.length >= 3 &&
      value.length <= 120 &&
      !/^(section|coverage|content hash|extraction version)/i.test(value),
    );
  return Array.from(new Set(values.map((value) => sha256(value.toLowerCase()).slice(0, 16)))).sort();
}

async function readBaselineText(patientArtifactsDirectory: string): Promise<{
  baselineSource: string[];
  text: string;
}> {
  const candidates = [
    "oasis-printed-note-review.json",
    "printed-note-chart-values.json",
    "document-fact-pack.json",
    path.join("oasis-printed-note", "extracted-text.txt"),
    path.join("oasis-printed-note", "extraction-result.json"),
  ];
  const chunks: string[] = [];
  const baselineSource: string[] = [];
  for (const fileName of candidates) {
    const filePath = path.join(patientArtifactsDirectory, fileName);
    const content = await readFile(filePath, "utf8").catch(() => null);
    if (!content) {
      continue;
    }
    baselineSource.push(fileName.replace(/\\/g, "/"));
    chunks.push(content);
  }
  return {
    baselineSource,
    text: chunks.join("\n"),
  };
}

function decideComparison(input: {
  state: PortalDomExtractedState;
  highPriorityMissing: string[];
  overlappingItemCodes: string[];
  baselineItemCodes: string[];
}): OasisDomComparisonDecision {
  if (input.state.coverage.confidence === "high" && input.highPriorityMissing.length === 0) {
    return "dom_ready_for_oasis_primary";
  }
  if (input.state.coverage.fieldCount >= 30 && input.highPriorityMissing.length <= 2) {
    return "dom_ready_with_ocr_fallback";
  }
  if (input.state.coverage.fieldCount > 0 || input.overlappingItemCodes.length > 0 || input.baselineItemCodes.length === 0) {
    return "dom_needs_template_mapping";
  }
  return "dom_not_ready";
}

export async function buildOasisDomComparisonArtifact(input: {
  state: PortalDomExtractedState;
  patientArtifactsDirectory: string;
  patientCase: string;
  candidateSource?: string;
}): Promise<OasisDomComparisonArtifact> {
  const bridgeText = buildOasisDomBridgeText(input.state);
  const baseline = await readBaselineText(input.patientArtifactsDirectory);
  const domItemCodes = collectItemCodes(bridgeText);
  const baselineItemCodes = collectItemCodes(baseline.text);
  const overlappingItemCodes = domItemCodes.filter((code) => baselineItemCodes.includes(code));
  const domValueHashes = collectValueHashes(bridgeText);
  const baselineValueHashes = collectValueHashes(baseline.text);
  const overlappingValueHashes = domValueHashes.filter((hash) => baselineValueHashes.includes(hash));
  const domSectionLabels = input.state.sections.map((section) => section.title).filter(Boolean);
  const highPrioritySectionsFound = HIGH_PRIORITY_SECTION_PATTERNS
    .filter((entry) => domSectionLabels.some((label) => entry.pattern.test(label)) || entry.pattern.test(bridgeText))
    .map((entry) => entry.key);
  const highPrioritySectionsMissing = HIGH_PRIORITY_SECTION_PATTERNS
    .filter((entry) => !highPrioritySectionsFound.includes(entry.key))
    .map((entry) => entry.key);
  const highPriorityClinicalCoverage = Object.fromEntries(
    CLINICAL_CUE_PATTERNS.map((entry) => [
      entry.key,
      {
        domMentioned: entry.pattern.test(bridgeText),
        baselineMentioned: entry.pattern.test(baseline.text),
      },
    ]),
  ) as OasisDomComparisonArtifact["highPriorityClinicalCoverage"];
  const domDiagnosisCodes = Array.from(new Set(Array.from(bridgeText.matchAll(/\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g), (match) => match[0])));
  const baselineDiagnosisCodes = Array.from(new Set(Array.from(baseline.text.matchAll(/\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g), (match) => match[0])));
  const overlappingDiagnosisCodes = domDiagnosisCodes.filter((code) => baselineDiagnosisCodes.includes(code)).sort();

  return {
    artifactType: "oasis_dom_vs_existing_extraction_comparison",
    generatedAt: new Date().toISOString(),
    patientCase: input.patientCase,
    baselineSource: baseline.baselineSource,
    candidateSource: input.candidateSource ?? OASIS_DOM_STATE_FILE_NAME,
    sectionCoverage: {
      domSectionCount: input.state.coverage.sectionCount,
      domSectionLabels,
      highPrioritySectionsFound,
      highPrioritySectionsMissing,
    },
    fieldCoverage: {
      domFieldCount: input.state.coverage.fieldCount,
      domNonEmptyFieldCount: input.state.coverage.nonEmptyFieldCount,
      domItemCodes,
      baselineItemCodes,
      overlappingItemCodes,
    },
    highPriorityClinicalCoverage,
    diagnosisCoverage: {
      domDiagnosisCueCount: domDiagnosisCodes.length,
      baselineDiagnosisCueCount: baselineDiagnosisCodes.length,
      overlappingDiagnosisCodes,
    },
    valueOverlapSummary: {
      domValueHashCount: domValueHashes.length,
      baselineValueHashCount: baselineValueHashes.length,
      overlappingValueHashCount: overlappingValueHashes.length,
    },
    missingFromDom: [
      ...baselineItemCodes.filter((code) => !domItemCodes.includes(code)).map((code) => `baseline_item_code:${code}`),
      ...highPrioritySectionsMissing.map((section) => `high_priority_section:${section}`),
    ].slice(0, 80),
    missingFromBaseline: domItemCodes.filter((code) => !baselineItemCodes.includes(code)).map((code) => `dom_item_code:${code}`).slice(0, 80),
    fallbackReasons: input.state.coverage.fallbackReasons,
    recommendedDecision: decideComparison({
      state: input.state,
      highPriorityMissing: highPrioritySectionsMissing,
      overlappingItemCodes,
      baselineItemCodes,
    }),
  };
}

export async function persistOasisDomAcquisitionArtifacts(input: {
  state: PortalDomExtractedState;
  patientArtifactsDirectory: string;
  patientCase: string;
}): Promise<{
  domStatePath: string;
  bridgeTextPath: string;
  comparisonPath: string;
  comparison: OasisDomComparisonArtifact;
}> {
  await mkdir(input.patientArtifactsDirectory, { recursive: true });
  const domStatePath = path.join(input.patientArtifactsDirectory, OASIS_DOM_STATE_FILE_NAME);
  const bridgeTextPath = path.join(input.patientArtifactsDirectory, OASIS_DOM_BRIDGE_TEXT_FILE_NAME);
  const comparisonPath = path.join(input.patientArtifactsDirectory, OASIS_DOM_COMPARISON_FILE_NAME);
  const bridgeText = buildOasisDomBridgeText(input.state);
  const comparison = await buildOasisDomComparisonArtifact({
    state: input.state,
    patientArtifactsDirectory: input.patientArtifactsDirectory,
    patientCase: input.patientCase,
    candidateSource: OASIS_DOM_STATE_FILE_NAME,
  });

  await writeFile(domStatePath, JSON.stringify(input.state, null, 2), "utf8");
  await writeFile(bridgeTextPath, bridgeText, "utf8");
  await writeFile(comparisonPath, JSON.stringify(comparison, null, 2), "utf8");

  return {
    domStatePath,
    bridgeTextPath,
    comparisonPath,
    comparison,
  };
}
