import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";
import { buildPortalDomExtractedState } from "../../portal/domExtraction/portalDomExtraction";
import {
  CANONICAL_OASIS_DOCUMENT_FILE_NAME,
  CANONICAL_OASIS_SECTION_HASHES_FILE_NAME,
  CANONICAL_OASIS_SECTION_INDEX_FILE_NAME,
  CANONICAL_OASIS_STRUCTURED_FILE_NAME,
} from "../../artifacts/artifactNames";

export const CANONICAL_OASIS_SCHEMA_VERSION = "canonical-oasis.v1";
export const CANONICAL_OASIS_SECTIONER_VERSION = "oasis-print-preview-sectioner.v1";
export const CANONICAL_OASIS_PARSER_VERSION = "oasis-print-preview-parser.v1";
export const CANONICAL_OASIS_LLM_FORMATTER_VERSION = "none";

export type OasisCanonicalSource = "print_preview_dom" | "legacy_dom";

export type CanonicalOasisSectionKey =
  | "administrative_information"
  | "diagnoses"
  | "medications"
  | "allergies"
  | "vitals"
  | "m_items"
  | "functional_status"
  | "homebound_supporting_narrative"
  | "skilled_need_medical_necessity"
  | "health_assessment"
  | "plan_of_care"
  | "orders"
  | "interventions"
  | "goals"
  | "other";

export type CanonicalOasisSectionRecord = {
  sectionKey: CanonicalOasisSectionKey;
  source: OasisCanonicalSource;
  title: string;
  rawText: string;
  normalizedText: string;
  startOffset: number;
  endOffset: number;
  hash: string;
};

export type CanonicalOasisQualityGate = {
  passed: boolean;
  assessmentType: string | null;
  textLength: number;
  sectionMarkerCount: number;
  mItemCount: number;
  icd10Count: number;
  requiredCoverage: Record<string, boolean>;
  warnings: string[];
};

export type CanonicalOasisDocumentArtifact = {
  schemaVersion: typeof CANONICAL_OASIS_SCHEMA_VERSION;
  generatedAt: string;
  source: OasisCanonicalSource;
  acquisitionSource: OasisCanonicalSource;
  assessmentType: string | null;
  rawText: string;
  normalizedText: string;
  rawTextHash: string;
  normalizedTextHash: string;
  qualityGate: CanonicalOasisQualityGate;
  provenance: {
    source: OasisCanonicalSource;
    sourcePath?: string | null;
    sourceUrl?: string | null;
  };
};

export type CanonicalOasisSectionIndexArtifact = {
  schemaVersion: typeof CANONICAL_OASIS_SCHEMA_VERSION;
  generatedAt: string;
  source: OasisCanonicalSource;
  sectionerVersion: typeof CANONICAL_OASIS_SECTIONER_VERSION;
  sections: CanonicalOasisSectionRecord[];
};

export type CanonicalOasisSectionHashesArtifact = {
  schemaVersion: typeof CANONICAL_OASIS_SCHEMA_VERSION;
  generatedAt: string;
  source: OasisCanonicalSource;
  sectionerVersion: typeof CANONICAL_OASIS_SECTIONER_VERSION;
  hashes: Array<{
    sectionKey: CanonicalOasisSectionKey;
    title: string;
    hash: string;
    startOffset: number;
    endOffset: number;
  }>;
};

export type CanonicalOasisStructuredArtifact = {
  schemaVersion: typeof CANONICAL_OASIS_SCHEMA_VERSION;
  generatedAt: string;
  source: OasisCanonicalSource;
  assessmentType: string | null;
  parserVersion: typeof CANONICAL_OASIS_PARSER_VERSION;
  sectionerVersion: typeof CANONICAL_OASIS_SECTIONER_VERSION;
  llmFormatterVersion: typeof CANONICAL_OASIS_LLM_FORMATTER_VERSION;
  diagnoses: Array<{
    code: string;
    description: string;
    source: OasisCanonicalSource;
    sourceSection: CanonicalOasisSectionKey;
    sourceHash: string;
    evidenceSpan: { startOffset: number; endOffset: number };
  }>;
  vitals: Array<{
    label: string;
    value: string;
    source: OasisCanonicalSource;
    sourceSection: CanonicalOasisSectionKey;
    sourceHash: string;
  }>;
  mItems: Array<{
    itemCode: string;
    label: string;
    value: string;
    source: OasisCanonicalSource;
    sourceSection: CanonicalOasisSectionKey;
    sourceHash: string;
  }>;
  sections: Array<{
    sectionKey: CanonicalOasisSectionKey;
    hash: string;
    normalizedTextHash: string;
    schemaVersion: typeof CANONICAL_OASIS_SCHEMA_VERSION;
    sectionerVersion: typeof CANONICAL_OASIS_SECTIONER_VERSION;
    parserVersion: typeof CANONICAL_OASIS_PARSER_VERSION;
    llmFormatterVersion: typeof CANONICAL_OASIS_LLM_FORMATTER_VERSION;
    parsedAt: string;
  }>;
  qualityGate: CanonicalOasisQualityGate;
};

export type CanonicalOasisBuildResult = {
  document: CanonicalOasisDocumentArtifact;
  sectionIndex: CanonicalOasisSectionIndexArtifact;
  sectionHashes: CanonicalOasisSectionHashesArtifact;
  structured: CanonicalOasisStructuredArtifact;
  portalDomState: PortalDomExtractedState;
};

const SECTION_MARKERS: Array<{
  key: CanonicalOasisSectionKey;
  title: string;
  pattern: RegExp;
}> = [
  { key: "administrative_information", title: "Administrative Information", pattern: /ADMINISTRATIVE INFORMATION/i },
  { key: "diagnoses", title: "Active Diagnoses", pattern: /ACTIVE DIAGNOSES|M1021|M1023|M1028/i },
  { key: "vitals", title: "Vital Signs & Pain Assessment", pattern: /VITAL SIGNS\s*&\s*PAIN ASSESSMENT|Height and Weight|Pain Assessment/i },
  { key: "medications", title: "Medication & Allergies", pattern: /MEDICATION\s*&\s*ALLERGIES|High-Risk Drug Classes|Medication Profile/i },
  { key: "allergies", title: "Allergies", pattern: /ALLERG(?:Y|IES)/i },
  { key: "health_assessment", title: "Health Assessment", pattern: /NEUROLOGICAL|CARDIOPULMONARY|GASTROINTESTINAL|GENITOURINARY|INTEGUMENTARY/i },
  { key: "functional_status", title: "Functional Status", pattern: /FUNCTIONAL|MOBILITY|MUSCULOSKELETAL|GG0130|GG0170|SELF CARE/i },
  { key: "homebound_supporting_narrative", title: "Homebound / Supporting Narrative", pattern: /HOMEBOUND|SUPPORTING NARRATIVE|PATIENT SUMMARY|CLINICAL NARRATIVE/i },
  { key: "skilled_need_medical_necessity", title: "Skilled Need / Medical Necessity", pattern: /SKILLED NEED|MEDICAL NECESSITY|REASON FOR HOME HEALTH/i },
  { key: "plan_of_care", title: "Plan of Care", pattern: /PLAN OF CARE|CARE PLAN|INDIVIDUALIZED PATIENT/i },
  { key: "orders", title: "Orders", pattern: /\bORDERS?\b|PHYSICIAN ORDER/i },
  { key: "interventions", title: "Interventions", pattern: /\bINTERVENTIONS?\b|Intervention\s*\/\s*Treatment/i },
  { key: "goals", title: "Goals", pattern: /\bGOALS?\b|Goal\(s\)/i },
  { key: "m_items", title: "M-Items", pattern: /\((?:M|GG|O)\d{4}[A-Z0-9]*\)/i },
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeAssessmentType(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value).toUpperCase();
  if (!normalized) {
    return null;
  }
  if (/\b(?:DISCHARGE|DEATH AT HOME|DAH|DC)\b/.test(normalized)) {
    return normalized.includes("DEATH") || normalized === "DAH" ? "DAH" : "DC";
  }
  if (/\b(?:TRANSFER|TRN|TOC)\b/.test(normalized)) {
    return "TRANSFER";
  }
  if (/\b(?:START OF CARE|SOC)\b/.test(normalized)) {
    return "SOC";
  }
  if (/\b(?:RESUMPTION OF CARE|ROC)\b/.test(normalized)) {
    return "ROC";
  }
  if (/\b(?:RECERT|RECERTIFICATION|REC)\b/.test(normalized)) {
    return "RECERT";
  }
  return normalized;
}

function inferAssessmentTypeFromText(normalizedText: string): string | null {
  const headerMatch = normalizedText.match(/OASIS Assessment:\s*([^\n\r]{1,160})/i);
  return normalizeAssessmentType(headerMatch?.[1] ?? normalizedText.slice(0, 800));
}

const ACTIVE_DIAGNOSIS_REQUIRED_ASSESSMENT_TYPES = new Set(["SOC", "ROC", "RECERT"]);
const ACTIVE_DIAGNOSIS_OPTIONAL_ASSESSMENT_TYPES = new Set(["DC", "DAH", "TRANSFER"]);

function requiresActiveDiagnosisCoverage(assessmentType: string | null): boolean {
  if (!assessmentType) {
    return true;
  }
  if (ACTIVE_DIAGNOSIS_REQUIRED_ASSESSMENT_TYPES.has(assessmentType)) {
    return true;
  }
  return !ACTIVE_DIAGNOSIS_OPTIONAL_ASSESSMENT_TYPES.has(assessmentType);
}

export function normalizeOasisClinicalText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^\s*Page\s+\d+\s+(?:of|\/)\s+\d+\s*$/gim, "")
    .replace(/^\s*Printed(?:\s+on|\s+at)?[:\s].*$/gim, "")
    .replace(/^\s*Star Home Health Care Inc\s*$/gim, "Star Home Health Care Inc")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sectionKeyForTitle(title: string): CanonicalOasisSectionKey {
  return SECTION_MARKERS.find((marker) => marker.pattern.test(title))?.key ?? "other";
}

function findSectionStarts(text: string): Array<{ key: CanonicalOasisSectionKey; title: string; index: number }> {
  const starts: Array<{ key: CanonicalOasisSectionKey; title: string; index: number }> = [];
  const lines = Array.from(text.matchAll(/^(.{1,160})$/gm));
  for (const match of lines) {
    const line = normalizeWhitespace(match[1]);
    if (!line || match.index === undefined) {
      continue;
    }
    const marker = SECTION_MARKERS.find((candidate) => candidate.pattern.test(line));
    if (!marker) {
      continue;
    }
    if (starts.some((entry) => Math.abs(entry.index - match.index!) < 12)) {
      continue;
    }
    starts.push({
      key: marker.key,
      title: line.length <= 90 ? line : marker.title,
      index: match.index,
    });
  }
  if (starts.length === 0) {
    starts.push({ key: "other", title: "OASIS Document", index: 0 });
  } else if (starts[0].index > 0) {
    starts.unshift({ key: "administrative_information", title: "Document Header", index: 0 });
  }
  return starts.sort((left, right) => left.index - right.index);
}

function buildSections(text: string, source: OasisCanonicalSource): CanonicalOasisSectionRecord[] {
  const starts = findSectionStarts(text);
  return starts
    .map((start, index) => {
      const endOffset = starts[index + 1]?.index ?? text.length;
      const rawText = text.slice(start.index, endOffset).trim();
      const normalizedText = normalizeOasisClinicalText(rawText);
      return {
        sectionKey: start.key,
        source,
        title: start.title,
        rawText,
        normalizedText,
        startOffset: start.index,
        endOffset,
        hash: sha256(normalizedText.toLowerCase()),
      };
    })
    .filter((section) => section.normalizedText.length > 0);
}

function evaluateQualityGate(input: {
  normalizedText: string;
  sections: CanonicalOasisSectionRecord[];
  assessmentType?: string | null;
}): CanonicalOasisQualityGate {
  const normalizedText = input.normalizedText;
  const sections = input.sections;
  const assessmentType = normalizeAssessmentType(input.assessmentType) ?? inferAssessmentTypeFromText(normalizedText);
  const mItemCount = new Set(Array.from(normalizedText.matchAll(/\b(?:M|GG|O)\d{4}[A-Z0-9]*\b/g), (match) => match[0])).size;
  const icd10Count = new Set(Array.from(normalizedText.matchAll(/\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g), (match) => match[0])).size;
  const sectionMarkerCount = sections.filter((section) => section.sectionKey !== "other").length;
  const activeDiagnosesCovered = /ACTIVE DIAGNOSES|M1021|M1023|M1028|PRIMARY DIAGNOSIS/i.test(normalizedText);
  const requiredCoverage = {
    administrative_information: /ADMINISTRATIVE INFORMATION|Patient INFO|Start of Care/i.test(normalizedText),
    active_diagnoses: requiresActiveDiagnosisCoverage(assessmentType) ? activeDiagnosesCovered : true,
    vitals: /VITAL SIGNS|Pain Assessment|Blood Pressure|Pulse/i.test(normalizedText),
    medications: /MEDICATION|High-Risk Drug Classes|Allerg/i.test(normalizedText),
    plan_of_care: /PLAN OF CARE|CARE PLAN|Goal|Intervention/i.test(normalizedText),
  };
  const warnings: string[] = [];
  if (normalizedText.length < 20_000) {
    warnings.push(`text_length_below_expected:${normalizedText.length}<20000`);
  }
  if (sectionMarkerCount < 4) {
    warnings.push(`section_marker_count_below_expected:${sectionMarkerCount}<4`);
  }
  if (mItemCount < 10) {
    warnings.push(`m_item_count_below_expected:${mItemCount}<10`);
  }
  for (const [key, covered] of Object.entries(requiredCoverage)) {
    if (!covered) {
      warnings.push(`required_coverage_missing:${key}`);
    }
  }
  return {
    passed: warnings.length === 0,
    assessmentType,
    textLength: normalizedText.length,
    sectionMarkerCount,
    mItemCount,
    icd10Count,
    requiredCoverage,
    warnings,
  };
}

function extractDiagnoses(sections: CanonicalOasisSectionRecord[], source: OasisCanonicalSource): CanonicalOasisStructuredArtifact["diagnoses"] {
  const diagnosisSections = sections.filter((section) => section.sectionKey === "diagnoses" || /diagnos/i.test(section.title));
  const candidates = diagnosisSections.length > 0 ? diagnosisSections : sections;
  const diagnoses: CanonicalOasisStructuredArtifact["diagnoses"] = [];
  const seen = new Set<string>();
  for (const section of candidates) {
    const regex = /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*-\s*([^\n\r]{3,140})/g;
    for (const match of section.rawText.matchAll(regex)) {
      const code = match[1].toUpperCase();
      const description = normalizeWhitespace(match[2])
        .replace(/\b(?:Onset Date|Severity|OnsetExacerbate)\b.*$/i, "")
        .trim();
      if (!description || seen.has(code)) {
        continue;
      }
      seen.add(code);
      const localStart = match.index ?? 0;
      diagnoses.push({
        code,
        description,
        source,
        sourceSection: section.sectionKey,
        sourceHash: section.hash,
        evidenceSpan: {
          startOffset: section.startOffset + localStart,
          endOffset: section.startOffset + localStart + match[0].length,
        },
      });
    }
  }
  return diagnoses;
}

function extractVitals(sections: CanonicalOasisSectionRecord[], source: OasisCanonicalSource): CanonicalOasisStructuredArtifact["vitals"] {
  const vitalSections = sections.filter((section) =>
    section.sectionKey === "vitals" || /vital signs|pain assessment|height and weight/i.test(section.title));
  if (vitalSections.length === 0) {
    return [];
  }
  const vitalSection = {
    ...vitalSections[0],
    rawText: vitalSections.map((section) => section.rawText).join("\n"),
    normalizedText: vitalSections.map((section) => section.normalizedText).join("\n"),
    hash: sha256(vitalSections.map((section) => section.hash).join("|")),
  };
  const labels = [
    "Temperature",
    "Pulse",
    "Respiratory",
    "Weight",
    "Blood Pressure mm/Hg (R)",
    "Blood Pressure mm/Hg (L)",
    "Blood Sugar",
    "O2 Sat",
    "Height",
    "BMI",
  ];
  const rows: CanonicalOasisStructuredArtifact["vitals"] = [];
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = vitalSection.rawText.match(new RegExp(`${escaped}\\s*:?\\s*([^\\n\\r]{1,80})`, "i"));
    const value = normalizeWhitespace(match?.[1]);
    if (!value) {
      continue;
    }
    rows.push({
      label,
      value,
      source,
      sourceSection: vitalSection.sectionKey,
      sourceHash: vitalSection.hash,
    });
  }
  return rows;
}

function extractMItems(sections: CanonicalOasisSectionRecord[], source: OasisCanonicalSource): CanonicalOasisStructuredArtifact["mItems"] {
  const rows: CanonicalOasisStructuredArtifact["mItems"] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const regex = /\((M|GG|O)(\d{4}[A-Z0-9]*)\)\s*([^\n\r]{3,180})(?:\n\s*([^\n\r]{1,180}))?/g;
    for (const match of section.rawText.matchAll(regex)) {
      const itemCode = `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
      if (seen.has(`${itemCode}:${section.sectionKey}`)) {
        continue;
      }
      seen.add(`${itemCode}:${section.sectionKey}`);
      rows.push({
        itemCode,
        label: normalizeWhitespace(match[3]),
        value: normalizeWhitespace(match[4]),
        source,
        sourceSection: section.sectionKey,
        sourceHash: section.hash,
      });
    }
  }
  return rows.slice(0, 300);
}

function fieldFromText(input: {
  section: CanonicalOasisSectionRecord;
  label: string;
  key: string;
  value: string;
  itemCode?: string;
  confidence?: "high" | "medium" | "low";
}): PortalDomExtractedField {
  return {
    section: input.section.title,
    label: input.label,
    key: input.key,
    ...(input.itemCode ? { itemCode: input.itemCode } : {}),
    value: input.value,
    sourceKind: "visibleText",
    confidence: input.confidence ?? "high",
    evidenceText: input.section.normalizedText.slice(0, 600),
  };
}

function buildPortalDomState(input: {
  sections: CanonicalOasisSectionRecord[];
  structured: Pick<CanonicalOasisStructuredArtifact, "diagnoses" | "vitals" | "mItems">;
}): PortalDomExtractedState {
  const extractedSections: PortalDomExtractedSection[] = input.sections.map((section) => {
    const fields: PortalDomExtractedField[] = [];
    for (const diagnosis of input.structured.diagnoses.filter((entry) => entry.sourceSection === section.sectionKey)) {
      fields.push(fieldFromText({
        section,
        label: "OASIS Diagnosis",
        key: `diagnosis_${diagnosis.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        value: `${diagnosis.code} - ${diagnosis.description}`,
        confidence: "high",
      }));
    }
    for (const vital of input.structured.vitals.filter((entry) => entry.sourceSection === section.sectionKey)) {
      fields.push(fieldFromText({
        section,
        label: vital.label,
        key: vital.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        value: vital.value,
        confidence: "high",
      }));
    }
    for (const item of input.structured.mItems.filter((entry) => entry.sourceSection === section.sectionKey).slice(0, 80)) {
      fields.push(fieldFromText({
        section,
        label: item.label,
        key: item.itemCode.toLowerCase(),
        itemCode: item.itemCode,
        value: item.value,
        confidence: item.value ? "high" : "medium",
      }));
    }
    return {
      title: section.title,
      status: "success",
      fields,
      tables: [],
      visibleTextDigest: section.normalizedText,
      fallbackReasons: [],
    };
  });

  return buildPortalDomExtractedState({
    sourceArea: "oasis",
    sections: extractedSections,
    routePattern: "print_preview_dom",
    thresholds: {
      minFieldCount: 10,
      minNonEmptyFieldCount: 3,
    },
    fallbackReasons: [],
  });
}

export function buildCanonicalOasisFromText(input: {
  rawText: string;
  source?: OasisCanonicalSource;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  assessmentType?: string | null;
  generatedAt?: string;
}): CanonicalOasisBuildResult {
  const source = input.source ?? "print_preview_dom";
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rawText = input.rawText.replace(/\r\n/g, "\n");
  const normalizedText = normalizeOasisClinicalText(rawText);
  const sections = buildSections(normalizedText, source);
  const assessmentType = normalizeAssessmentType(input.assessmentType) ?? inferAssessmentTypeFromText(normalizedText);
  const qualityGate = evaluateQualityGate({ normalizedText, sections, assessmentType });
  const diagnoses = extractDiagnoses(sections, source);
  const vitals = extractVitals(sections, source);
  const mItems = extractMItems(sections, source);
  const structured: CanonicalOasisStructuredArtifact = {
    schemaVersion: CANONICAL_OASIS_SCHEMA_VERSION,
    generatedAt,
    source,
    assessmentType,
    parserVersion: CANONICAL_OASIS_PARSER_VERSION,
    sectionerVersion: CANONICAL_OASIS_SECTIONER_VERSION,
    llmFormatterVersion: CANONICAL_OASIS_LLM_FORMATTER_VERSION,
    diagnoses,
    vitals,
    mItems,
    sections: sections.map((section) => ({
      sectionKey: section.sectionKey,
      hash: section.hash,
      normalizedTextHash: sha256(section.normalizedText.toLowerCase()),
      schemaVersion: CANONICAL_OASIS_SCHEMA_VERSION,
      sectionerVersion: CANONICAL_OASIS_SECTIONER_VERSION,
      parserVersion: CANONICAL_OASIS_PARSER_VERSION,
      llmFormatterVersion: CANONICAL_OASIS_LLM_FORMATTER_VERSION,
      parsedAt: generatedAt,
    })),
    qualityGate,
  };

  return {
    document: {
      schemaVersion: CANONICAL_OASIS_SCHEMA_VERSION,
      generatedAt,
      source,
      acquisitionSource: source,
      assessmentType,
      rawText,
      normalizedText,
      rawTextHash: sha256(rawText),
      normalizedTextHash: sha256(normalizedText.toLowerCase()),
      qualityGate,
      provenance: {
        source,
        sourcePath: input.sourcePath ?? null,
        sourceUrl: input.sourceUrl ?? null,
      },
    },
    sectionIndex: {
      schemaVersion: CANONICAL_OASIS_SCHEMA_VERSION,
      generatedAt,
      source,
      sectionerVersion: CANONICAL_OASIS_SECTIONER_VERSION,
      sections,
    },
    sectionHashes: {
      schemaVersion: CANONICAL_OASIS_SCHEMA_VERSION,
      generatedAt,
      source,
      sectionerVersion: CANONICAL_OASIS_SECTIONER_VERSION,
      hashes: sections.map((section) => ({
        sectionKey: section.sectionKey,
        title: section.title,
        hash: section.hash,
        startOffset: section.startOffset,
        endOffset: section.endOffset,
      })),
    },
    structured,
    portalDomState: buildPortalDomState({
      sections,
      structured: { diagnoses, vitals, mItems },
    }),
  };
}

export async function persistCanonicalOasisArtifacts(input: {
  patientArtifactsDirectory: string;
  canonical: CanonicalOasisBuildResult;
}): Promise<{
  documentPath: string;
  sectionIndexPath: string;
  sectionHashesPath: string;
  structuredPath: string;
}> {
  await mkdir(input.patientArtifactsDirectory, { recursive: true });
  const documentPath = path.join(input.patientArtifactsDirectory, CANONICAL_OASIS_DOCUMENT_FILE_NAME);
  const sectionIndexPath = path.join(input.patientArtifactsDirectory, CANONICAL_OASIS_SECTION_INDEX_FILE_NAME);
  const sectionHashesPath = path.join(input.patientArtifactsDirectory, CANONICAL_OASIS_SECTION_HASHES_FILE_NAME);
  const structuredPath = path.join(input.patientArtifactsDirectory, CANONICAL_OASIS_STRUCTURED_FILE_NAME);
  await Promise.all([
    writeFile(documentPath, JSON.stringify(input.canonical.document, null, 2), "utf8"),
    writeFile(sectionIndexPath, JSON.stringify(input.canonical.sectionIndex, null, 2), "utf8"),
    writeFile(sectionHashesPath, JSON.stringify(input.canonical.sectionHashes, null, 2), "utf8"),
    writeFile(structuredPath, JSON.stringify(input.canonical.structured, null, 2), "utf8"),
  ]);
  return {
    documentPath,
    sectionIndexPath,
    sectionHashesPath,
    structuredPath,
  };
}

export async function buildCanonicalOasisFromTextFile(input: {
  textPath: string;
  source?: OasisCanonicalSource;
  sourceUrl?: string | null;
  assessmentType?: string | null;
}): Promise<CanonicalOasisBuildResult> {
  const rawText = await readFile(input.textPath, "utf8");
  return buildCanonicalOasisFromText({
    rawText,
    source: input.source ?? "print_preview_dom",
    sourcePath: input.textPath,
    sourceUrl: input.sourceUrl ?? null,
    assessmentType: input.assessmentType ?? null,
  });
}
