import { formatDaysLeft, formatTimestamp } from "./qa";
import type { PatientDetail, ReferralFieldView, ReferralSectionView } from "./types";

export type ComparisonResult =
  | "match"
  | "equivalent_match"
  | "mismatch"
  | "missing_in_portal"
  | "missing_in_referral"
  | "uncertain"
  | "coding_review";

export type EquivalenceType =
  | "none"
  | "name_format_only"
  | "date_format_only"
  | "whitespace_only"
  | "punctuation_only";

export type ComparisonConfidence = "high" | "medium" | "low" | "uncertain";
export type CompareFilterValue = "open" | "all" | ComparisonResult;
export type SourceSupportStrength = "strong" | "moderate" | "weak" | "none";
export type MappingStrength = "strong" | "moderate" | "weak";

export type ComparisonEvidence = {
  id: string;
  sourceType: string;
  sourceLabel: string;
  snippet: string | null;
  confidence: ComparisonConfidence;
  confidenceLabel: string;
  pageHint: number | null;
};

export interface InspectTarget {
  referralPage?: number | null;
  portalPage?: number | null;
  referralSection?: string | null;
  portalSection?: string | null;
  referralSnippet?: string | null;
  portalSnippet?: string | null;
}

export interface FieldComparison {
  fieldKey: string;
  fieldLabel: string;
  sectionKey: string;
  sectionLabel: string;
  sourceSectionLabel: string;
  referralValue: string | null;
  portalValue: string | null;
  normalizedReferralValue: string | null;
  normalizedPortalValue: string | null;
  displayReferralValue: string;
  displayPortalValue: string;
  comparisonDisplayValue: string;
  comparisonResult: ComparisonResult;
  equivalenceType: EquivalenceType;
  isFormattingOnlyDifference: boolean;
  isFieldLeakSuspected: boolean;
  isCodingSensitive: boolean;
  sourceSupportStrength: SourceSupportStrength;
  mappingStrength: MappingStrength;
  confidence: ComparisonConfidence;
  reviewerPriority: number;
  shortReason: string;
  reviewStatus: string;
  referralSnippet?: string | null;
  portalSnippet?: string | null;
  sourceQualityWarning?: string | null;
  oasisItemId?: string | null;
  sourceDocuments: string[];
  inspectTarget?: InspectTarget;
  evidence: ComparisonEvidence[];
}

export interface ComparisonSectionSummary {
  sectionKey: string;
  sectionLabel: string;
  mismatchCount: number;
  missingInPortalCount: number;
  missingInReferralCount: number;
  uncertainCount: number;
  codingReviewCount: number;
  matchCount: number;
  rows: FieldComparison[];
}

export interface ComparisonWorkspaceModel {
  header: {
    patientName: string;
    subsidiaryName: string;
    daysLeftLabel: string;
    lastRefreshLabel: string;
    overallReviewVerdict: string;
  };
  summary: {
    mismatchCount: number;
    missingInPortalCount: number;
    missingInReferralCount: number;
    exactMatchCount: number;
    uncertainCount: number;
    codingReviewCount: number;
  };
  globalTrustWarning: string | null;
  comparisons: FieldComparison[];
  sections: ComparisonSectionSummary[];
  debug: {
    referralWarnings: string[];
    referralUsability: string;
    qaStatus: string;
  };
}

const SECTION_ORDER = [
  "administrative_information",
  "active_diagnoses",
  "medication_allergies",
  "patient_summary_clinical_narrative",
  "functional_assessment",
  "neurological",
  "cardiopulmonary",
  "gigu",
  "integumentary",
  "safety_risk",
  "other",
] as const;

const NARRATIVE_GUARD_FIELD_KEYS = new Set([
  "primary_reason_for_home_health_medical_necessity",
  "admit_reason_to_home_health",
  "patient_caregiver_goals",
  "plan_for_next_visit",
  "care_plan_problems_goals_interventions",
  "patient_summary",
  "medical_necessity_and_homebound",
  "medical_necessity",
  "homebound_narrative",
]);

const RELATIONSHIP_VALUES = new Set([
  "daughter",
  "son",
  "spouse",
  "wife",
  "husband",
  "mother",
  "father",
  "sister",
  "brother",
  "friend",
  "caregiver",
  "self",
  "residentself",
  "resident/self",
]);

const GENERIC_NARRATIVE_PHRASES = [
  "pt to discharge home",
  "discharge home",
  "eval and treat",
  "hh nursing services",
  "medication mgmt",
  "medication management",
  "vitals and wound care",
  "send pt home",
  "all remaining medications",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function humanizeCodeLikeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(trimmed)) {
    return trimmed.replace(/[_-]+/g, " ").toLowerCase();
  }

  return trimmed;
}

function sanitizeSourceLabel(value: string | null | undefined): string {
  const cleaned = (value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "Referral document";
}

function parseStructuredString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("{") && (trimmed.includes("},{") || trimmed.includes("}, {"))) {
    try {
      return JSON.parse(`[${trimmed}]`);
    } catch {
      return null;
    }
  }

  return null;
}

function formatSerializedDiagnosisString(value: string): string | null {
  const matches = Array.from(
    value.matchAll(/"description"\s*:\s*"([^"]+)"[\s\S]*?"icd10_code"\s*:\s*"([^"]+)"/g),
  );
  if (matches.length === 0) {
    return null;
  }

  return matches
    .map((match) => `${humanizeCodeLikeToken(match[1] ?? "")} (${match[2] ?? ""})`)
    .join("; ");
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    const parsed = parseStructuredString(trimmed);
    if (parsed !== null) {
      return formatDisplayValue(parsed);
    }

    const diagnosisSummary = formatSerializedDiagnosisString(trimmed);
    if (diagnosisSummary) {
      return diagnosisSummary;
    }

    if (!trimmed.includes(",")) {
      return humanizeCodeLikeToken(trimmed);
    }

    return trimmed
      .split(",")
      .map((segment) => humanizeCodeLikeToken(segment))
      .filter((segment) => segment.length > 0)
      .join(", ");
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => formatDisplayValue(entry))
      .filter((entry) => entry.length > 0)
      .join("; ");
  }

  const record = asRecord(value);
  if (!record) {
    return String(value);
  }

  const description = typeof record.description === "string" ? record.description : null;
  const code =
    typeof record.icd10_code === "string"
      ? record.icd10_code
      : typeof record.code === "string"
        ? record.code
        : null;
  if (description || code) {
    return [description, code ? `(${code})` : null].filter(Boolean).join(" ");
  }

  return Object.entries(record)
    .map(([key, entryValue]) => {
      const formattedEntryValue = formatDisplayValue(entryValue);
      return formattedEntryValue ? `${key}: ${formattedEntryValue}` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join("; ");
}

function stringifyValue(value: unknown): string | null {
  const formatted = normalizeWhitespace(formatDisplayValue(value));
  return formatted.length > 0 ? formatted : null;
}

function compactText(value: string, maxLength = 180): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeComparisonText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
}

function normalizePunctuationOnly(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function humanizeStatus(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizePhoneDigits(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return null;
}

function normalizeDateValue(value: string): string | null {
  const trimmed = normalizeWhitespace(value);
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return trimmed;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function normalizeNameToken(token: string): string {
  return token.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function looksLikePersonName(value: string): boolean {
  const tokens = normalizeWhitespace(value)
    .split(/[\s,]+/)
    .map((token) => normalizeNameToken(token))
    .filter((token) => token.length > 0);
  return tokens.length >= 2 && tokens.length <= 4 && tokens.every((token) => /[A-Z]/.test(token));
}

function parseComparableName(
  value: string,
): { first: string | null; last: string | null; middle: string | null } {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return { first: null, last: null, middle: null };
  }

  const suffixes = new Set(["JR", "SR", "II", "III", "IV", "MR", "MRS", "MS"]);
  const rawTokens = trimmed
    .split(/[\s,]+/)
    .map((token) => normalizeNameToken(token))
    .filter((token) => token.length > 0 && !suffixes.has(token));

  if (rawTokens.length < 2) {
    return { first: null, last: null, middle: null };
  }

  if (trimmed.includes(",")) {
    const parts = trimmed.split(",");
    const last = normalizeNameToken(parts[0] ?? "");
    const remainingTokens = parts
      .slice(1)
      .join(" ")
      .split(/\s+/)
      .map((token) => normalizeNameToken(token))
      .filter((token) => token.length > 0 && !suffixes.has(token));

    return {
      first: remainingTokens[0] ?? null,
      last: last || null,
      middle: remainingTokens[1] ?? null,
    };
  }

  return {
    first: rawTokens[0] ?? null,
    last: rawTokens[rawTokens.length - 1] ?? null,
    middle: rawTokens.length > 2 ? rawTokens[1] ?? null : null,
  };
}

function namesEquivalent(left: string, right: string): boolean {
  const leftName = parseComparableName(left);
  const rightName = parseComparableName(right);
  if (!leftName.first || !leftName.last || !rightName.first || !rightName.last) {
    return false;
  }
  if (leftName.first !== rightName.first || leftName.last !== rightName.last) {
    return false;
  }
  if (!leftName.middle || !rightName.middle) {
    return true;
  }
  return leftName.middle[0] === rightName.middle[0];
}

function looksLikeContactLeakValue(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();
  return (
    looksLikePersonName(normalized) ||
    normalizePhoneDigits(normalized) !== null ||
    RELATIONSHIP_VALUES.has(lower.replace(/\s+/g, "")) ||
    RELATIONSHIP_VALUES.has(lower)
  );
}

function isNarrativeGuardField(field: ReferralFieldView): boolean {
  return (
    NARRATIVE_GUARD_FIELD_KEYS.has(field.fieldKey) ||
    field.fieldType === "narrative" ||
    /goal|plan|homebound|summary|medical necessity|admit reason/i.test(field.label)
  );
}

function getSectionFamily(section: ReferralSectionView | ReferralFieldView) {
  if (section.sectionKey === "administrative_information") {
    return { sectionKey: "administrative_information", sectionLabel: "Administrative Information" };
  }
  if (section.sectionKey === "active_diagnoses") {
    return { sectionKey: "active_diagnoses", sectionLabel: "Active Diagnoses" };
  }
  if (section.sectionKey === "medication_allergies_and_injectables") {
    return { sectionKey: "medication_allergies", sectionLabel: "Medication & Allergies" };
  }
  if (section.sectionKey === "patient_summary_and_clinical_narrative") {
    return {
      sectionKey: "patient_summary_clinical_narrative",
      sectionLabel: "Patient Summary & Clinical Narrative",
    };
  }
  if (
    section.sectionKey === "functional_assessment_self_care" ||
    section.sectionKey === "functional_assessment_mobility_and_musculoskeletal" ||
    section.sectionKey === "plan_of_care_and_physical_therapy_evaluation" ||
    section.sectionKey === "care_plan_problems_goals_interventions"
  ) {
    return { sectionKey: "functional_assessment", sectionLabel: "Functional Assessment" };
  }
  if (section.sectionKey === "neurological_head_mood_eyes_ears") {
    return { sectionKey: "neurological", sectionLabel: "Neurological" };
  }
  if (section.sectionKey === "cardiopulmonary_chest_thorax") {
    return { sectionKey: "cardiopulmonary", sectionLabel: "Cardiopulmonary" };
  }
  if (section.sectionKey === "gastrointestinal_and_genitourinary_assessment") {
    return { sectionKey: "gigu", sectionLabel: "GI/GU" };
  }
  if (section.sectionKey === "integumentary_skin_and_wound") {
    return { sectionKey: "integumentary", sectionLabel: "Integumentary" };
  }
  if (section.sectionKey === "safety_and_risk_assessment") {
    return { sectionKey: "safety_risk", sectionLabel: "Safety & Risk" };
  }
  return { sectionKey: "other", sectionLabel: section.label };
}

function getSectionOrder(sectionKey: string): number {
  const index = SECTION_ORDER.indexOf(sectionKey as (typeof SECTION_ORDER)[number]);
  return index >= 0 ? index : SECTION_ORDER.length;
}

function isCodingSensitiveField(field: ReferralFieldView): boolean {
  return (
    field.sectionKey === "active_diagnoses" ||
    field.fieldType.includes("diagnosis") ||
    field.groupKey.includes("diagnosis") ||
    field.reviewMode.includes("coding") ||
    field.workflowState === "needs_coding_review" ||
    /coding/i.test(field.recommendation.owner) ||
    /diagnosis/i.test(field.label)
  );
}

function parsePageHint(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(/\bpage\s+(\d{1,3})\b/i) ?? value.match(/\b(\d{1,3})\/\d{2,3}\b/i);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function dedupeEvidence(field: ReferralFieldView, section: ReferralSectionView): ComparisonEvidence[] {
  const evidenceByKey = new Map<string, ComparisonEvidence>();
  const pushEvidence = (
    sourceType: string,
    sourceLabel: string,
    snippet: string | null,
    confidenceLabel: string,
    confidence: ComparisonConfidence,
  ) => {
    const cleanedSourceLabel = sanitizeSourceLabel(sourceLabel);
    const cleanedSnippet = snippet ? compactText(snippet, 320) : null;
    const key = `${sourceType}|${cleanedSourceLabel}|${(cleanedSnippet ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
    if (!evidenceByKey.has(key)) {
      evidenceByKey.set(key, {
        id: `${field.fieldKey}:${evidenceByKey.size}`,
        sourceType,
        sourceLabel: cleanedSourceLabel,
        snippet: cleanedSnippet,
        confidence,
        confidenceLabel,
        pageHint: parsePageHint(cleanedSourceLabel, cleanedSnippet),
      });
    }
  };

  for (const entry of field.sourceEvidence) {
    const rawConfidence = typeof entry.confidence === "number" ? entry.confidence : null;
    pushEvidence(
      entry.sourceType,
      entry.sourceLabel,
      entry.textSpan ?? null,
      rawConfidence === null ? "Confidence not scored" : `${Math.round(rawConfidence * 100)}% confidence`,
      rawConfidence === null
        ? "uncertain"
        : rawConfidence >= 0.9
          ? "high"
          : rawConfidence >= 0.75
            ? "medium"
            : "low",
    );
  }

  for (const textSpan of section.textSpans.filter((entry) => entry.relatedFieldKeys.includes(field.fieldKey))) {
    pushEvidence(
      "REFERRAL_TEXT",
      textSpan.sourceSectionNames.join(", ") || section.label,
      textSpan.text,
      "Section snippet",
      "uncertain",
    );
  }

  return Array.from(evidenceByKey.values());
}

function getConfidence(field: ReferralFieldView, evidence: ComparisonEvidence[]): ComparisonConfidence {
  const explicit = field.recommendation.confidenceLabel.toLowerCase();
  if (explicit.includes("high")) {
    return "high";
  }
  if (explicit.includes("moderate") || explicit.includes("medium")) {
    return "medium";
  }
  if (explicit.includes("low")) {
    return "low";
  }
  if (evidence.some((entry) => entry.confidence === "high")) {
    return "high";
  }
  if (evidence.some((entry) => entry.confidence === "medium")) {
    return "medium";
  }
  if (evidence.some((entry) => entry.confidence === "low")) {
    return "low";
  }
  return hasMeaningfulValue(field.documentSupportedValue)
    ? field.requiresHumanReview
      ? "medium"
      : "high"
    : "uncertain";
}

function hasMeaningfulValue(value: unknown): boolean {
  return stringifyValue(value) !== null;
}

function getDisplayReferralValue(
  referralValue: string | null,
  sourceSupportStrength: SourceSupportStrength,
): string {
  if (referralValue) {
    return referralValue;
  }
  return sourceSupportStrength === "weak" || sourceSupportStrength === "none"
    ? "Referral support too weak to compare"
    : "No reliable referral value extracted";
}

function getDisplayPortalValue(portalValue: string | null): string {
  return portalValue ?? "Blank on portal";
}

function getSnippetUsageMap(patient: PatientDetail): Map<string, number> {
  const counts = new Map<string, number>();

  for (const section of patient.referralSections) {
    for (const field of section.fields) {
      if (!isNarrativeGuardField(field)) {
        continue;
      }
      const referralValue = stringifyValue(field.documentSupportedValue);
      if (!referralValue) {
        continue;
      }
      const key = normalizeComparisonText(referralValue);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return counts;
}

function detectEquivalence(
  field: ReferralFieldView,
  referralValue: string | null,
  portalValue: string | null,
): EquivalenceType {
  if (!referralValue || !portalValue) {
    return "none";
  }

  if (normalizeWhitespace(referralValue) === normalizeWhitespace(portalValue)) {
    return "whitespace_only";
  }

  const referralDate = normalizeDateValue(referralValue);
  const portalDate = normalizeDateValue(portalValue);
  if (referralDate && portalDate && referralDate === portalDate) {
    return "date_format_only";
  }

  const referralPhone = normalizePhoneDigits(referralValue);
  const portalPhone = normalizePhoneDigits(portalValue);
  if (referralPhone && portalPhone && referralPhone === portalPhone) {
    return "punctuation_only";
  }

  if (
    (field.fieldKey.includes("name") || looksLikePersonName(referralValue) || looksLikePersonName(portalValue)) &&
    namesEquivalent(referralValue, portalValue)
  ) {
    return "name_format_only";
  }

  if (normalizePunctuationOnly(referralValue) === normalizePunctuationOnly(portalValue)) {
    return "punctuation_only";
  }

  return "none";
}

function isGenericNarrativeEvidence(
  field: ReferralFieldView,
  referralValue: string | null,
  evidence: ComparisonEvidence[],
  reusedSnippetCount: number,
): boolean {
  if (!isNarrativeGuardField(field) || !referralValue) {
    return false;
  }

  const normalized = normalizeComparisonText(referralValue);
  const hasGenericPhrase = GENERIC_NARRATIVE_PHRASES.some((phrase) => normalized.includes(phrase));
  const evidenceText = evidence
    .map((entry) => normalizeComparisonText(entry.snippet ?? ""))
    .join(" ");
  const hasSpecificNarrativeCue = /(goal|teach|teaching|monitor|follow up|next visit|homebound|reason|necessity|assessment|pain|wound|medication)/.test(
    evidenceText,
  );

  return reusedSnippetCount > 1 || (hasGenericPhrase && !hasSpecificNarrativeCue);
}

function getSourceSupportStrength(
  field: ReferralFieldView,
  referralValue: string | null,
  evidence: ComparisonEvidence[],
  confidence: ComparisonConfidence,
  reusedSnippetCount: number,
  isFieldLeakSuspected: boolean,
): SourceSupportStrength {
  if (!referralValue && evidence.length === 0) {
    return "none";
  }
  if (isFieldLeakSuspected) {
    return "weak";
  }

  let score = 0;
  if (referralValue) {
    score += 1;
  }
  if (evidence.length >= 2) {
    score += 1;
  }
  if (confidence === "high") {
    score += 2;
  } else if (confidence === "medium") {
    score += 1;
  } else if (confidence === "low" || confidence === "uncertain") {
    score -= 1;
  }

  if (isGenericNarrativeEvidence(field, referralValue, evidence, reusedSnippetCount)) {
    score -= 2;
  }

  if (score >= 3) {
    return "strong";
  }
  if (score >= 1) {
    return "moderate";
  }
  return "weak";
}

function getMappingStrength(
  field: ReferralFieldView,
  referralValue: string | null,
  evidence: ComparisonEvidence[],
  reusedSnippetCount: number,
  isFieldLeakSuspected: boolean,
): MappingStrength {
  if (!referralValue || isFieldLeakSuspected) {
    return "weak";
  }

  if (field.reviewMode === "reference_only") {
    return "moderate";
  }

  if (isCodingSensitiveField(field) || field.fieldType === "date" || field.fieldType === "phone") {
    return "strong";
  }

  if (field.fieldKey.includes("caregiver_") || field.fieldKey.includes("hospitalization_")) {
    return evidence.length > 0 ? "strong" : "moderate";
  }

  if (isNarrativeGuardField(field)) {
    return isGenericNarrativeEvidence(field, referralValue, evidence, reusedSnippetCount)
      ? "weak"
      : evidence.length > 1
        ? "moderate"
        : "weak";
  }

  return evidence.length > 0 ? "moderate" : "weak";
}

function getSourceQualityWarning(input: {
  patient: PatientDetail;
  field: ReferralFieldView;
  referralValue: string | null;
  confidence: ComparisonConfidence;
  evidence: ComparisonEvidence[];
  sourceSupportStrength: SourceSupportStrength;
  mappingStrength: MappingStrength;
  isFieldLeakSuspected: boolean;
  reusedSnippetCount: number;
}): string | null {
  if (!input.patient.referralQa.referralDataAvailable) {
    return "Referral document is not available for this field.";
  }
  if (input.patient.referralQa.extractionUsabilityStatus !== "usable") {
    return `Referral extraction is ${humanizeStatus(input.patient.referralQa.extractionUsabilityStatus)}.`;
  }
  if (input.isFieldLeakSuspected) {
    return "Referral evidence looks mapped from a different field.";
  }
  if (input.reusedSnippetCount > 1 && isNarrativeGuardField(input.field)) {
    return "The same broad referral narrative is being reused across multiple fields.";
  }
  if (input.referralValue === null && input.evidence.length > 0) {
    return "Referral support was found, but it did not yield a reliable field value.";
  }
  if (input.sourceSupportStrength === "weak" || input.mappingStrength === "weak") {
    return isNarrativeGuardField(input.field)
      ? "Referral evidence is too generic for a reliable field-to-field comparison."
      : "Referral evidence is weak or incomplete for this field.";
  }
  if (input.confidence === "low" || input.confidence === "uncertain") {
    return "Referral evidence is weak or incomplete for this field.";
  }
  return null;
}

function getComparisonResult(input: {
  patient: PatientDetail;
  field: ReferralFieldView;
  referralValue: string | null;
  portalValue: string | null;
  equivalenceType: EquivalenceType;
  isCodingSensitive: boolean;
  sourceSupportStrength: SourceSupportStrength;
  mappingStrength: MappingStrength;
  isFieldLeakSuspected: boolean;
  sourceQualityWarning: string | null;
}): ComparisonResult | null {
  const hasReferral = input.referralValue !== null;
  const hasPortal = input.portalValue !== null;
  const lowTrust =
    input.patient.referralQa.extractionUsabilityStatus !== "usable" ||
    input.sourceSupportStrength === "weak" ||
    input.sourceSupportStrength === "none" ||
    input.mappingStrength === "weak" ||
    input.isFieldLeakSuspected ||
    input.sourceQualityWarning !== null;

  if (!hasReferral && !hasPortal) {
    return input.sourceQualityWarning ? "uncertain" : null;
  }

  if (hasReferral && hasPortal) {
    if ((input.referralValue ?? "") === (input.portalValue ?? "")) {
      return "match";
    }
    if (input.equivalenceType !== "none") {
      return "equivalent_match";
    }
  }

  if (input.isCodingSensitive && (hasReferral || hasPortal)) {
    return hasReferral ? "coding_review" : "uncertain";
  }

  if (hasReferral && !hasPortal) {
    return !lowTrust && input.sourceSupportStrength === "strong" && input.mappingStrength === "strong"
      ? "missing_in_portal"
      : "uncertain";
  }

  if (!hasReferral && hasPortal) {
    return !lowTrust && input.field.reviewMode !== "qa_readback_and_confirm"
      ? "missing_in_referral"
      : "uncertain";
  }

  if (hasReferral && hasPortal) {
    return lowTrust ? "uncertain" : "mismatch";
  }

  return input.sourceQualityWarning ? "uncertain" : null;
}

function getReviewStatus(result: ComparisonResult, equivalenceType: EquivalenceType): string {
  if (result === "match") {
    return "Confirmed Match";
  }
  if (result === "equivalent_match") {
    return equivalenceType === "name_format_only" || equivalenceType === "date_format_only"
      ? "Formatting Only"
      : "Equivalent Match";
  }
  if (result === "coding_review") {
    return "Review with Coding";
  }
  if (result === "uncertain") {
    return "Needs Source Review";
  }
  return "Needs Review";
}

function getShortReason(input: {
  result: ComparisonResult;
  equivalenceType: EquivalenceType;
  sourceQualityWarning: string | null;
  isFieldLeakSuspected: boolean;
  sourceSupportStrength: SourceSupportStrength;
}): string {
  if (input.result === "uncertain" && input.sourceQualityWarning) {
    return input.sourceQualityWarning;
  }
  if (input.result === "match") {
    return "Referral and portal values align.";
  }
  if (input.result === "equivalent_match") {
    return input.equivalenceType === "name_format_only"
      ? "Referral and portal appear to describe the same person; only the name format differs."
      : input.equivalenceType === "date_format_only"
        ? "Referral and portal dates align after date normalization."
        : "Referral and portal values align after formatting normalization.";
  }
  if (input.result === "mismatch") {
    return "Portal value differs from the referral.";
  }
  if (input.result === "missing_in_portal") {
    return "Referral clearly supports this value, but the portal field is blank.";
  }
  if (input.result === "missing_in_referral") {
    return "Portal shows a value the referral did not support.";
  }
  if (input.result === "coding_review") {
    return "Diagnosis-related difference should be reviewed with coding.";
  }
  if (input.isFieldLeakSuspected) {
    return "Possible cross-field mapping leak; referral support should be reviewed before treating this as a discrepancy.";
  }
  if (input.sourceSupportStrength === "none") {
    return "Referral support is too weak to compare this field.";
  }
  return "Referral extraction is too weak to call this a true discrepancy.";
}

function getReviewerPriority(
  result: ComparisonResult,
  field: ReferralFieldView,
  confidence: ComparisonConfidence,
  isFormattingOnlyDifference: boolean,
): number {
  const resultRank: Record<ComparisonResult, number> = {
    coding_review: 0,
    mismatch: 1,
    missing_in_portal: 2,
    missing_in_referral: 3,
    uncertain: 4,
    equivalent_match: 5,
    match: 6,
  };
  const urgencyRank: Record<ReferralFieldView["qaPriority"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const confidenceRank: Record<ComparisonConfidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
    uncertain: 3,
  };

  return (
    resultRank[result] * 100 +
    urgencyRank[field.qaPriority] * 10 +
    confidenceRank[confidence] +
    (isFormattingOnlyDifference ? 2 : 0)
  );
}

function buildInspectTarget(
  comparison: Pick<
    FieldComparison,
    "sectionLabel" | "sourceSectionLabel" | "referralSnippet" | "portalSnippet" | "evidence"
  >,
): InspectTarget {
  const firstEvidence = comparison.evidence[0];
  return {
    referralPage: firstEvidence?.pageHint ?? null,
    portalPage: null,
    referralSection: firstEvidence?.sourceLabel ?? comparison.sourceSectionLabel,
    portalSection: comparison.sectionLabel,
    referralSnippet: comparison.referralSnippet ?? null,
    portalSnippet: comparison.portalSnippet ?? null,
  };
}

function buildFieldComparison(
  patient: PatientDetail,
  section: ReferralSectionView,
  field: ReferralFieldView,
  snippetUsage: Map<string, number>,
): FieldComparison | null {
  const family = getSectionFamily(section);
  const referralValue = stringifyValue(field.documentSupportedValue);
  const portalValue = stringifyValue(field.currentChartValue);
  const normalizedReferralValue = referralValue ? normalizeComparisonText(referralValue) : null;
  const normalizedPortalValue = portalValue ? normalizeComparisonText(portalValue) : null;
  const evidence = dedupeEvidence(field, section);
  const confidence = getConfidence(field, evidence);
  const isCodingSensitive = isCodingSensitiveField(field);
  const reusedSnippetCount = normalizedReferralValue ? snippetUsage.get(normalizedReferralValue) ?? 0 : 0;
  const isFieldLeakSuspected =
    isNarrativeGuardField(field) && referralValue !== null && looksLikeContactLeakValue(referralValue);
  const sourceSupportStrength = getSourceSupportStrength(
    field,
    referralValue,
    evidence,
    confidence,
    reusedSnippetCount,
    isFieldLeakSuspected,
  );
  const mappingStrength = getMappingStrength(
    field,
    referralValue,
    evidence,
    reusedSnippetCount,
    isFieldLeakSuspected,
  );
  const equivalenceType = detectEquivalence(field, referralValue, portalValue);
  const sourceQualityWarning = getSourceQualityWarning({
    patient,
    field,
    referralValue,
    confidence,
    evidence,
    sourceSupportStrength,
    mappingStrength,
    isFieldLeakSuspected,
    reusedSnippetCount,
  });
  const comparisonResult = getComparisonResult({
    patient,
    field,
    referralValue,
    portalValue,
    equivalenceType,
    isCodingSensitive,
    sourceSupportStrength,
    mappingStrength,
    isFieldLeakSuspected,
    sourceQualityWarning,
  });

  if (!comparisonResult) {
    return null;
  }

  const isFormattingOnlyDifference = comparisonResult === "equivalent_match";
  const referralSnippet = evidence[0]?.snippet ?? (referralValue ? compactText(referralValue, 240) : null);
  const portalSnippet = portalValue ? compactText(portalValue, 220) : null;
  const displayReferralValue = getDisplayReferralValue(referralValue, sourceSupportStrength);
  const displayPortalValue = getDisplayPortalValue(portalValue);

  const comparison: FieldComparison = {
    fieldKey: field.fieldKey,
    fieldLabel: field.label,
    sectionKey: family.sectionKey,
    sectionLabel: family.sectionLabel,
    sourceSectionLabel: section.label,
    referralValue,
    portalValue,
    normalizedReferralValue,
    normalizedPortalValue,
    displayReferralValue,
    displayPortalValue,
    comparisonDisplayValue: [displayReferralValue, displayPortalValue].join(" | "),
    comparisonResult,
    equivalenceType,
    isFormattingOnlyDifference,
    isFieldLeakSuspected,
    isCodingSensitive,
    sourceSupportStrength,
    mappingStrength,
    confidence,
    reviewerPriority: getReviewerPriority(
      comparisonResult,
      field,
      confidence,
      isFormattingOnlyDifference,
    ),
    shortReason: getShortReason({
      result: comparisonResult,
      equivalenceType,
      sourceQualityWarning,
      isFieldLeakSuspected,
      sourceSupportStrength,
    }),
    reviewStatus: getReviewStatus(comparisonResult, equivalenceType),
    referralSnippet,
    portalSnippet,
    sourceQualityWarning,
    oasisItemId: field.oasisItemId,
    sourceDocuments: Array.from(new Set(evidence.map((entry) => entry.sourceLabel))),
    evidence,
  };

  comparison.inspectTarget = buildInspectTarget(comparison);
  return comparison;
}

export function buildComparisonWorkspaceModel(patient: PatientDetail): ComparisonWorkspaceModel {
  const snippetUsage = getSnippetUsageMap(patient);
  const comparisons = patient.referralSections
    .flatMap((section) =>
      section.fields.map((field) => buildFieldComparison(patient, section, field, snippetUsage)),
    )
    .filter((comparison): comparison is FieldComparison => comparison !== null)
    .sort(
      (left, right) =>
        left.reviewerPriority - right.reviewerPriority ||
        left.fieldLabel.localeCompare(right.fieldLabel),
    );

  const sectionsByKey = new Map<string, ComparisonSectionSummary>();
  for (const row of comparisons) {
    const section = sectionsByKey.get(row.sectionKey) ?? {
      sectionKey: row.sectionKey,
      sectionLabel: row.sectionLabel,
      mismatchCount: 0,
      missingInPortalCount: 0,
      missingInReferralCount: 0,
      uncertainCount: 0,
      codingReviewCount: 0,
      matchCount: 0,
      rows: [],
    };
    section.rows.push(row);
    if (row.comparisonResult === "mismatch") section.mismatchCount += 1;
    if (row.comparisonResult === "missing_in_portal") section.missingInPortalCount += 1;
    if (row.comparisonResult === "missing_in_referral") section.missingInReferralCount += 1;
    if (row.comparisonResult === "uncertain") section.uncertainCount += 1;
    if (row.comparisonResult === "coding_review") section.codingReviewCount += 1;
    if (row.comparisonResult === "match" || row.comparisonResult === "equivalent_match") {
      section.matchCount += 1;
    }
    sectionsByKey.set(row.sectionKey, section);
  }

  const sections = Array.from(sectionsByKey.values()).sort(
    (left, right) =>
      getSectionOrder(left.sectionKey) - getSectionOrder(right.sectionKey) ||
      left.sectionLabel.localeCompare(right.sectionLabel),
  );

  const summary = {
    mismatchCount: comparisons.filter((row) => row.comparisonResult === "mismatch").length,
    missingInPortalCount: comparisons.filter((row) => row.comparisonResult === "missing_in_portal")
      .length,
    missingInReferralCount: comparisons.filter((row) => row.comparisonResult === "missing_in_referral")
      .length,
    exactMatchCount: comparisons.filter(
      (row) => row.comparisonResult === "match" || row.comparisonResult === "equivalent_match",
    ).length,
    uncertainCount: comparisons.filter((row) => row.comparisonResult === "uncertain").length,
    codingReviewCount: comparisons.filter((row) => row.comparisonResult === "coding_review").length,
  };

  const openItems =
    summary.mismatchCount +
    summary.missingInPortalCount +
    summary.missingInReferralCount +
    summary.uncertainCount +
    summary.codingReviewCount;
  const globalTrustWarning =
    !patient.referralQa.referralDataAvailable
      ? "Referral evidence is missing, so portal discrepancies cannot be trusted yet."
      : patient.referralQa.extractionUsabilityStatus !== "usable"
        ? "Referral extraction quality is limited. Treat surfaced differences as tentative until the source document is confirmed."
        : null;

  return {
    header: {
      patientName: patient.patientName,
      subsidiaryName: patient.subsidiaryName,
      daysLeftLabel: formatDaysLeft(patient.daysLeftBeforeOasisDueDate),
      lastRefreshLabel: formatTimestamp(patient.lastUpdatedAt),
      overallReviewVerdict:
        globalTrustWarning ??
        (openItems > 0
          ? `${openItems} item(s) still need reconciliation against the referral.`
          : "No surfaced discrepancies outside exact matches."),
    },
    summary,
    globalTrustWarning,
    comparisons,
    sections,
    debug: {
      referralWarnings: patient.referralQa.warnings,
      referralUsability: patient.referralQa.extractionUsabilityStatus,
      qaStatus: patient.referralQa.qaStatus,
    },
  };
}

export function filterComparisonRows(
  rows: FieldComparison[],
  input: {
    searchTerm: string;
    sectionFilter: string;
    resultFilter: CompareFilterValue;
    showMatches: boolean;
  },
): FieldComparison[] {
  const search = input.searchTerm.trim().toLowerCase();
  return rows.filter((row) => {
    const isResolved =
      row.comparisonResult === "match" || row.comparisonResult === "equivalent_match";

    if (!input.showMatches && isResolved) return false;
    if (input.sectionFilter && row.sectionKey !== input.sectionFilter) return false;
    if (input.resultFilter === "open" && isResolved) return false;
    if (
      input.resultFilter !== "open" &&
      input.resultFilter !== "all" &&
      row.comparisonResult !== input.resultFilter
    ) {
      return false;
    }
    if (!search) return true;
    return [
      row.fieldLabel,
      row.sectionLabel,
      row.sourceSectionLabel,
      row.displayReferralValue,
      row.displayPortalValue,
      row.shortReason,
      row.comparisonDisplayValue,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
}

export function getResultLabel(result: ComparisonResult): string {
  return result === "missing_in_portal"
    ? "Missing in Portal"
    : result === "missing_in_referral"
      ? "Missing in Referral"
      : result === "coding_review"
        ? "Coding Review"
        : result === "uncertain"
          ? "Uncertain"
          : result === "mismatch"
            ? "Mismatch"
            : result === "equivalent_match"
              ? "Equivalent Match"
              : "Match";
}

export function getResultBadgeClass(result: ComparisonResult): string {
  return result === "match" || result === "equivalent_match"
    ? "badge success"
    : result === "mismatch" || result === "coding_review"
      ? "badge danger"
      : result === "uncertain"
        ? "badge"
        : "badge warning";
}

export function getConfidenceLabel(confidence: ComparisonConfidence): string {
  return confidence === "high"
    ? "High confidence"
    : confidence === "medium"
      ? "Medium confidence"
      : confidence === "low"
        ? "Low confidence"
        : "Uncertain confidence";
}

export function getSourceSupportLabel(strength: SourceSupportStrength): string {
  return strength === "strong"
    ? "Strong referral support"
    : strength === "moderate"
      ? "Moderate referral support"
      : strength === "weak"
        ? "Weak referral support"
        : "No referral support";
}

export function getMappingStrengthLabel(strength: MappingStrength): string {
  return strength === "strong"
    ? "Strong field mapping"
    : strength === "moderate"
      ? "Moderate field mapping"
      : "Weak field mapping";
}
