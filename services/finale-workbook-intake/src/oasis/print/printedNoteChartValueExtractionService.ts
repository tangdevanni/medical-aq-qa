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
const FIELD_DEFINITION_BY_KEY = new Map(
  REFERRAL_FIELD_CONTRACT.map((field) => [field.key, field] as const),
);
const ICD10_CODE_PATTERN = /([A-TV-Z1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)/i;
const DIAGNOSIS_VALUE_PATTERN =
  /\bPRIMARY DIAGNOSIS\b[\s\S]{0,120}?([A-TV-Z1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\s*[-:)]\s*([A-Za-z][A-Za-z0-9 ,()/-]{3,120})/i;
const SELECTED_OPTION_LINE_PATTERN = /^\[SELECTED\](?:\[page\s+\d+\])?\s+(.+)$/gim;
const FUNCTIONAL_LIMITATION_OPTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Ambulation", pattern: /\bAmbulation\b/i },
  { label: "Dyspnea with minimal exertion", pattern: /\bDyspnea(?: with minimal exertion)?\b/i },
  { label: "Endurance", pattern: /\bEndurance\b/i },
  { label: "Hearing", pattern: /\bHearing\b/i },
  { label: "Speech", pattern: /\bSpeech\b/i },
  { label: "Legally blind", pattern: /\bLegally blind\b/i },
  { label: "Paralysis", pattern: /\bParalysis\b/i },
  { label: "Contracture", pattern: /\bContracture\b/i },
  { label: "Bowel/Bladder \(Incontinence\)", pattern: /\bBowel\/Bladder \(Incontinence\)\b/i },
  { label: "Amputation", pattern: /\bAmputation\b/i },
];
const CAREGIVER_RELATIONSHIP_PATTERN =
  /\b(Daughter|Son|Spouse|Wife|Husband|Mother|Father|Sister|Brother|Friend|Caregiver)\b/i;

interface PrintedNoteFieldValueCandidate {
  field_key: string;
  current_value: unknown;
  confidence: number;
  source_spans: string[];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeMultilineText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .trim();
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
  const normalized = normalizeMultilineText(sourceText);
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
  const normalized = normalizeMultilineText(sourceText);
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, RAW_FALLBACK_CHARACTER_LIMIT);
}

function firstRegexMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  if (!match?.[0]) {
    return null;
  }
  return normalizeWhitespace(match[0]);
}

function normalizeSlashDate(value: string): string | null {
  const match = normalizeWhitespace(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) {
    year += 2000;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return `${month.toString().padStart(2, "0")}/${day.toString().padStart(2, "0")}/${year.toString().padStart(4, "0")}`;
}

function collectSelectedOptionLabels(sourceText: string): string[] {
  const labels: string[] = [];
  for (const match of sourceText.matchAll(SELECTED_OPTION_LINE_PATTERN)) {
    const label = normalizeWhitespace(match[1]);
    if (!label) {
      continue;
    }
    labels.push(label);
  }
  return dedupeNormalizedValues(labels, 400);
}

function extractDeterministicPrimaryDiagnosis(sourceText: string): PrintedNoteFieldValueCandidate | null {
  const match = sourceText.match(DIAGNOSIS_VALUE_PATTERN);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const code = normalizeWhitespace(match[1]).replace(/^[1|L]/i, "I");
  const description = normalizeWhitespace(match[2])
    .replace(/\b(?:OTHER DIAGNOSIS|Add Allergies|SELECTED CHECKBOX \/ RADIO OPTIONS|VITAL SIGNS\s*&\s*PAIN ASSESSMENT)\b[\s\S]*$/i, "")
    .replace(/\s+\^.*$/i, "")
    .replace(/\s+\bOnset\b.*$/i, "")
    .replace(/\s+\bSeverity\b.*$/i, "")
    .trim();
  if (!code || !description) {
    return null;
  }

  const value = `${code} - ${description}`;
  return {
    field_key: "primary_diagnosis",
    current_value: value,
    confidence: 0.99,
    source_spans: [normalizeWhitespace(match[0])],
  };
}

function extractDeterministicSecondaryDiagnoses(sourceText: string): PrintedNoteFieldValueCandidate | null {
  const values = Array.from(
    sourceText.matchAll(
      /\bOTHER DIAGNOSIS\s*-\s*\d+\b[\s\S]{0,120}?([A-TV-Z1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\s*[-:)]\s*([A-Za-z][A-Za-z0-9 ,()/-]{3,120})/gi,
    ),
    (match) => {
      const code = normalizeWhitespace(match[1]).replace(/^[1|L]/i, "I");
      const description = normalizeWhitespace(match[2])
        .replace(/\b(?:OTHER DIAGNOSIS|PRIMARY DIAGNOSIS|Add Allergies|SELECTED CHECKBOX \/ RADIO OPTIONS|VITAL SIGNS\s*&\s*PAIN ASSESSMENT)\b[\s\S]*$/i, "")
        .replace(/\s+\^.*$/i, "")
        .replace(/\s+\bOnset\b.*$/i, "")
        .replace(/\s+\bSeverity\b.*$/i, "")
        .trim();
      return code && description ? `${code} - ${description}` : null;
    },
  ).filter((value): value is string => Boolean(value));

  const deduped = dedupeNormalizedValues(values, 8);
  if (deduped.length === 0) {
    return null;
  }

  return {
    field_key: "secondary_diagnoses",
    current_value: deduped,
    confidence: 0.98,
    source_spans: deduped.slice(0, 3),
  };
}

function extractDeterministicCodeStatus(sourceText: string, selectedOptionLabels: string[]): PrintedNoteFieldValueCandidate | null {
  if (selectedOptionLabels.some((label) => /\bFull Code\b/i.test(label)) || /\bfull code\b/i.test(sourceText)) {
    return {
      field_key: "code_status",
      current_value: "full_code",
      confidence: 0.98,
      source_spans: selectedOptionLabels.filter((label) => /\bFull Code\b/i.test(label)).slice(0, 1).length > 0
        ? selectedOptionLabels.filter((label) => /\bFull Code\b/i.test(label)).slice(0, 1)
        : ["Full Code"],
    };
  }
  if (selectedOptionLabels.some((label) => /\bDNR\b/i.test(label)) || /\bdnr\b/i.test(sourceText)) {
    return {
      field_key: "code_status",
      current_value: "dnr",
      confidence: 0.98,
      source_spans: selectedOptionLabels.filter((label) => /\bDNR\b/i.test(label)).slice(0, 1).length > 0
        ? selectedOptionLabels.filter((label) => /\bDNR\b/i.test(label)).slice(0, 1)
        : ["DNR"],
    };
  }
  return null;
}

function extractDeterministicFunctionalLimitations(selectedOptionLabels: string[]): PrintedNoteFieldValueCandidate | null {
  const values = FUNCTIONAL_LIMITATION_OPTION_PATTERNS
    .filter((candidate) => selectedOptionLabels.some((label) => candidate.pattern.test(label)))
    .map((candidate) => candidate.label);
  const deduped = dedupeNormalizedValues(values, 12);
  if (deduped.length === 0) {
    return null;
  }

  return {
    field_key: "functional_limitations",
    current_value: deduped,
    confidence: 0.96,
    source_spans: selectedOptionLabels.filter((label) =>
      FUNCTIONAL_LIMITATION_OPTION_PATTERNS.some((candidate) => candidate.pattern.test(label)),
    ).slice(0, 3),
  };
}

function extractDeterministicAllergies(sourceText: string): PrintedNoteFieldValueCandidate | null {
  const match = firstRegexMatch(sourceText, /\b(?:No Known Allergies|None known)\b/i)
    ?? firstRegexMatch(sourceText, /\bAdd Allergies\s+None known\b/i);
  if (!match) {
    return null;
  }

  return {
    field_key: "allergy_list",
    current_value: ["No Known Allergies"],
    confidence: 0.92,
    source_spans: [match],
  };
}

function extractDeterministicOrderSummary(sourceText: string): string | null {
  const match = sourceText.match(
    /\bOrder Summary:\s*(.+?)(?=\s+Confirmed By:|\s+Ordered By Signature:|\s+Face Sheet\b|\s+Fax Server\b)/i,
  );
  if (!match?.[1]) {
    return null;
  }

  const summary = normalizeWhitespace(match[1]);
  return summary || null;
}

function extractDeterministicMedicalNecessityNarrative(sourceText: string): PrintedNoteFieldValueCandidate | null {
  const summary = extractDeterministicOrderSummary(sourceText);
  if (!summary) {
    return null;
  }

  return {
    field_key: "primary_reason_for_home_health_medical_necessity",
    current_value: summary,
    confidence: 0.89,
    source_spans: [summary],
  };
}

function extractDeterministicAdmitReason(sourceText: string): PrintedNoteFieldValueCandidate | null {
  const summary = extractDeterministicOrderSummary(sourceText);
  if (!summary) {
    return null;
  }

  return {
    field_key: "admit_reason_to_home_health",
    current_value: summary,
    confidence: 0.87,
    source_spans: [summary],
  };
}

function extractDeterministicRecentHospitalizationDischargeDate(
  sourceText: string,
): PrintedNoteFieldValueCandidate | null {
  const orderSummaryMatch = sourceText.match(/\bOrder Summary:\s*Pt to discharge home on (\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
  const normalizedOrderSummaryDate = normalizeSlashDate(orderSummaryMatch?.[1] ?? "");
  if (normalizedOrderSummaryDate) {
    return {
      field_key: "recent_hospitalization_discharge_date",
      current_value: normalizedOrderSummaryDate,
      confidence: 0.93,
      source_spans: [normalizeWhitespace(orderSummaryMatch?.[0] ?? normalizedOrderSummaryDate)],
    };
  }

  const dischargeDateMatch = sourceText.match(
    /\bDate of Discharge\b[\s\S]{0,120}?\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  );
  if (!dischargeDateMatch?.[1]) {
    return null;
  }

  const parsedDate = new Date(dischargeDateMatch[1]);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const normalizedDate = `${(parsedDate.getMonth() + 1).toString().padStart(2, "0")}/${parsedDate.getDate().toString().padStart(2, "0")}/${parsedDate.getFullYear().toString().padStart(4, "0")}`;
  return {
    field_key: "recent_hospitalization_discharge_date",
    current_value: normalizedDate,
    confidence: 0.88,
    source_spans: [normalizeWhitespace(dischargeDateMatch[0])],
  };
}

function extractDeterministicRecentHospitalizationFacility(
  sourceText: string,
): PrintedNoteFieldValueCandidate | null {
  const match = sourceText.match(
    /\bAcute care hospital\s+([A-Z][A-Z0-9 .,&'-]{6,}?)(?=\s+Medicare Beneficiary|\s+Medicare \(HIC\)|\s+Medicaid|\s+Social Security)/i,
  );
  if (!match?.[1]) {
    return null;
  }

  const facility = normalizeWhitespace(match[1]);
  if (!facility) {
    return null;
  }

  return {
    field_key: "recent_hospitalization_facility",
    current_value: facility,
    confidence: 0.92,
    source_spans: [normalizeWhitespace(match[0])],
  };
}

function extractDeterministicCaregiverContact(sourceText: string): PrintedNoteFieldValueCandidate[] {
  const contactsWindowMatch = sourceText.match(/\bCONTACTS\b([\s\S]{0,800}?)\bDIAGNOSIS INFORMATION\b/i);
  const contactsWindow = contactsWindowMatch?.[1] ?? "";
  if (!contactsWindow) {
    return [];
  }

  const contactMatch = contactsWindow.match(
    /([A-Z][A-Z ,.'-]{4,}?)\s+(Daughter|Son|Spouse|Wife|Husband|Mother|Father|Sister|Brother|Friend|Caregiver)\s+(?:Address\s+)?(?:Phone\/Email\s+)?(?:Cell:|Home:|Phone:)?\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{10})/i,
  );
  if (!contactMatch?.[1] || !contactMatch?.[2] || !contactMatch?.[3]) {
    return [];
  }

  const caregiverName = normalizeWhitespace(contactMatch[1]).replace(/\s{2,}/g, " ");
  const caregiverRelationship = normalizeWhitespace(contactMatch[2]);
  const caregiverPhone = contactMatch[3].replace(/\D+/g, "");
  const sourceSpan = normalizeWhitespace(contactMatch[0]);
  const results: PrintedNoteFieldValueCandidate[] = [];

  if (caregiverName) {
    results.push({
      field_key: "caregiver_name",
      current_value: caregiverName,
      confidence: 0.91,
      source_spans: [sourceSpan],
    });
  }

  if (caregiverPhone) {
    results.push({
      field_key: "caregiver_phone",
      current_value: caregiverPhone,
      confidence: 0.93,
      source_spans: [sourceSpan],
    });
  }

  if (CAREGIVER_RELATIONSHIP_PATTERN.test(caregiverRelationship)) {
    results.push({
      field_key: "caregiver_relationship",
      current_value: caregiverRelationship,
      confidence: 0.9,
      source_spans: [sourceSpan],
    });
  }

  return results;
}

export function extractDeterministicCurrentChartValues(sourceText: string): {
  extractedFieldValues: PrintedNoteFieldValueCandidate[];
  diagnostics: string[];
} {
  const selectedOptionLabels = collectSelectedOptionLabels(sourceText);
  const candidates = [
    extractDeterministicMedicalNecessityNarrative(sourceText),
    extractDeterministicAdmitReason(sourceText),
    extractDeterministicRecentHospitalizationDischargeDate(sourceText),
    extractDeterministicRecentHospitalizationFacility(sourceText),
    extractDeterministicPrimaryDiagnosis(sourceText),
    extractDeterministicSecondaryDiagnoses(sourceText),
    extractDeterministicCodeStatus(sourceText, selectedOptionLabels),
    extractDeterministicFunctionalLimitations(selectedOptionLabels),
    extractDeterministicAllergies(sourceText),
    ...extractDeterministicCaregiverContact(sourceText),
  ].filter((candidate): candidate is PrintedNoteFieldValueCandidate => candidate !== null);

  const diagnostics = [
    `Deterministic printed-note chart values: ${candidates.map((candidate) => candidate.field_key).join(", ") || "none"}.`,
    `Selected option labels detected: ${selectedOptionLabels.length}.`,
  ];

  return {
    extractedFieldValues: candidates,
    diagnostics,
  };
}

export function isSuspiciousPrintedNoteChartValue(fieldKey: string, value: unknown): boolean {
  const normalized = typeof value === "string"
    ? normalizeWhitespace(value)
    : Array.isArray(value)
      ? value.map((entry) => normalizeWhitespace(typeof entry === "string" ? entry : "")).join(" | ")
      : "";

  if (!normalized && typeof value !== "boolean" && !Array.isArray(value)) {
    return true;
  }

  if (fieldKey === "primary_diagnosis") {
    if (!ICD10_CODE_PATTERN.test(normalized)) {
      return true;
    }
    if (/\bpatient lives in\b/i.test(normalized) || /\bcongregate\b/i.test(normalized)) {
      return true;
    }
  }

  if (fieldKey === "secondary_diagnoses" || fieldKey === "diagnosis_candidates") {
    const diagnosisText = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").join(" | ")
      : normalized;
    return !ICD10_CODE_PATTERN.test(diagnosisText);
  }

  if (fieldKey === "allergy_list") {
    return Array.isArray(value) &&
      value.every((entry) => typeof entry === "string" && /\bNone of the Above\b/i.test(entry));
  }

  if (fieldKey === "hospitalization_risk_summary") {
    return /\bUnable to determine\b/i.test(normalized) ||
      /\bDate of Referral\b/i.test(normalized) ||
      /\bM0102\b/i.test(normalized);
  }

  if (fieldKey === "high_risk_medication_notes") {
    return /\bUnable to answer\b/i.test(normalized) ||
      /\bHigh-Risk Drug Classes\b/i.test(normalized);
  }

  if (fieldKey === "code_status") {
    return !/^(?:full_code|dnr|unknown)$/i.test(normalized);
  }

  return false;
}

function mergeChartFieldValueCandidates(input: {
  deterministic: PrintedNoteFieldValueCandidate[];
  llm: PrintedNoteChartValueExtractionSchema["current_field_values"];
}): PrintedNoteFieldValueCandidate[] {
  const merged = new Map<string, PrintedNoteFieldValueCandidate>();

  for (const candidate of input.llm) {
    merged.set(candidate.field_key, candidate);
  }

  for (const candidate of input.deterministic) {
    merged.set(candidate.field_key, candidate);
  }

  return [...merged.values()];
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
  const fieldDefinition = FIELD_DEFINITION_BY_KEY.get(fieldKey);
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return null;
    }
    if (fieldDefinition?.type === "boolean") {
      if (/^(?:yes|true|checked|selected|1)$/i.test(normalized)) {
        return true;
      }
      if (/^(?:no|false|unchecked|not selected|0)$/i.test(normalized)) {
        return false;
      }
    }
    if (fieldDefinition?.type === "multi_select" || fieldDefinition?.type === "array") {
      const parts = normalized
        .split(/\s*[;,|\n]\s*/)
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean);
      if (parts.length > 1) {
        return dedupeNormalizedValues(parts, 24);
      }
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
    "The OCR text may include lines that start with [SELECTED]; treat those as explicit selected checkbox or radio answers from the OASIS document.",
    "Do not treat section headings, unlabeled checkbox groups, fax headers, page counters, field labels, or surrounding boilerplate as values unless the OCR explicitly marks them as [SELECTED].",
    "If a field appears blank, unchecked, omitted, or not confidently extractable, omit it from current_field_values.",
    "For phone fields, return digits only. For date fields, preserve the chart date string exactly as shown when possible.",
    "For multi_select and array fields, current_value must be a JSON array of strings, not a comma-delimited string.",
    "For boolean checkbox fields, current_value must be true or false only when the selected state is explicit in the printed note.",
    "For diagnosis fields, only use the Active Diagnoses / diagnosis table evidence or explicit ICD-10 diagnosis lines; never infer diagnosis values from living situation, homebound, or caregiver sections.",
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

  const sourceText = normalizeMultilineText(await readFile(input.extractedTextPath, "utf8").catch(() => ""));
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
  const deterministicResult = extractDeterministicCurrentChartValues(sourceText);

  const allowedFieldKeys = new Set(REFERRAL_FIELD_CONTRACT.map((field) => field.key));
  const mergedFieldValues = mergeChartFieldValueCandidates({
    deterministic: deterministicResult.extractedFieldValues,
    llm: llmResult.payload?.current_field_values ?? [],
  }).filter((entry) => allowedFieldKeys.has(entry.field_key));
  const currentChartValues = Object.fromEntries(
    mergedFieldValues
      .map((entry) => [entry.field_key, sanitizeValue(entry.field_key, entry.current_value)] as const)
      .filter((entry): entry is readonly [string, unknown] =>
        entry[1] !== null && !isSuspiciousPrintedNoteChartValue(entry[0], entry[1]),
      ),
  );
  const acceptedFieldKeys = new Set(Object.keys(currentChartValues));
  const acceptedMergedFieldValues = mergedFieldValues.filter((entry) => acceptedFieldKeys.has(entry.field_key));
  const rejectedMergedFieldValues = mergedFieldValues
    .filter((entry) => !acceptedFieldKeys.has(entry.field_key))
    .map((entry) => `${entry.field_key}: rejected as low-confidence or suspicious for the field`);

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
      extractedFieldValues: acceptedMergedFieldValues,
      warnings: [
        ...resolvedInput.diagnostics,
        ...deterministicResult.diagnostics,
        ...(llmResult.payload?.warnings ?? []),
        ...llmResult.warnings,
        ...rejectedMergedFieldValues,
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
      ...deterministicResult.diagnostics,
      ...(llmResult.payload?.warnings ?? []),
      ...llmResult.warnings,
      ...rejectedMergedFieldValues,
    ],
    invocationModelId: llmResult.invocationModelId,
    llmInputSource: resolvedInput.llmInputSource,
  };
}
