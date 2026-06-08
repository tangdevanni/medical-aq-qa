import type { FieldComparison } from "./patientComparison";
import type {
  AllergyEntry,
  DiagnosisEntry,
  DiagnosisSummaryBlock,
  MedicationEntry,
  MedicationSummaryBlock,
  ReferralOasisChangeFlag,
} from "./types";

export function compactDisplayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function formatClinicalSourceDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const isoDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) {
    return isoDate[1];
  }

  return trimmed;
}

export function normalizeLabelForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripPocElementAnnotation(value: string): string {
  const start = value.search(/\s*\(POC Element/i);
  if (start < 0) {
    return value;
  }

  let depth = 0;
  let end = -1;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth <= 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end < 0) {
    return value.slice(0, start);
  }

  return `${value.slice(0, start)}${value.slice(end)}`;
}

export function cleanOasisDisplayLabel(value: string): string {
  const compacted = compactDisplayText(value).replace(/[^\x20-\x7E]/g, " ");
  if (normalizeLabelForComparison(compacted) === "icd 10 code") {
    return "Diagnosis Code";
  }
  const withoutPocElement = stripPocElementAnnotation(compacted);
  const cleaned = withoutPocElement
    .replace(/\bICD-?10 Code\b/gi, "")
    .replace(/\b(?:PRIMARY|OTHER)\s+DIAGNOSIS\s*(?:-\s*\d+)?\b/gi, "")
    .replace(/\s*:\s*-\s*/g, " - ")
    .replace(/\s+[-:]\s*$/g, "")
    .replace(/[:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : compacted.trim();
}

export function cleanDiagnosisDescription(value: string | null | undefined, code: string): string | null {
  const cleaned = compactDisplayText(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:-|:|\\))?\\s*`, "i"), "")
    .replace(/^ICD-?10 Code\s*/i, "")
    .replace(/\bICD-?10 Code\b/gi, "")
    .trim();
  const normalized = normalizeLabelForComparison(cleaned);
  if (
    !cleaned ||
    /^[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/i.test(cleaned) ||
    /^diagnoses?$/i.test(cleaned) ||
    /^active diagnoses$/i.test(cleaned) ||
    normalized === "icd 10 code" ||
    /^(?:primary|other) diagnosis(?: \d+)?$/.test(normalized)
  ) {
    return null;
  }
  return cleaned;
}

export type ReferralOasisGroupKey =
  | "diagnoses"
  | "medications_allergies"
  | "safety_social"
  | "functional_therapy"
  | "body_systems"
  | "dates_admin";

export const REFERRAL_OASIS_GROUPS: Array<{ key: ReferralOasisGroupKey; label: string }> = [
  { key: "diagnoses", label: "Diagnoses" },
  { key: "medications_allergies", label: "Medications & Allergies" },
  { key: "safety_social", label: "Safety / Social Support" },
  { key: "functional_therapy", label: "Functional / Therapy" },
  { key: "body_systems", label: "Body Systems" },
  { key: "dates_admin", label: "Dates / Admin" },
];

export type ReferralOasisDisplayItem = {
  label: string;
  value: string;
  meta?: string | null;
  changed?: boolean;
  changeReason?: string | null;
};

export type ReferralOasisCategoryModel = {
  key: ReferralOasisGroupKey;
  label: string;
  referralItems: ReferralOasisDisplayItem[];
  oasisItems: ReferralOasisDisplayItem[];
};

export type ReferralOasisSourceSummaries = {
  diagnosisSummary?: DiagnosisSummaryBlock | null;
  medicationSummary?: MedicationSummaryBlock | null;
};

const PORTAL_VALUE_PLACEHOLDERS = new Set([
  "no chart data captured",
  "chart value is blank",
  "printed note ocr did not capture a value",
  "no reliable chart value extracted",
  "no reliable referral value extracted",
  "no explicit primary diagnosis identified in the text",
  "no explicit other diagnoses identified in the text",
]);

function hasVisiblePortalValue(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = normalizeLabelForComparison(value);
  return normalized.length > 0 && !PORTAL_VALUE_PLACEHOLDERS.has(normalized);
}

function hasReferralBackedComparisonValue(row: FieldComparison): boolean {
  return row.valuePresence?.hasDocumentValue ?? hasVisiblePortalValue(row.displayReferralValue);
}

function hasUsableOasisValue(row: FieldComparison): boolean {
  return row.valuePresence?.hasChartValue ?? hasVisiblePortalValue(row.displayPortalValue);
}

function isIcdCodeValue(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/i.test(value.trim());
}

function isPlanOfCareCategoryText(value: string): boolean {
  return /\b(plan of care|care plan|goal|goals|intervention|interventions|coordination|next visit)\b/i.test(value);
}

export function getReferralOasisGroup(row: FieldComparison): ReferralOasisGroupKey | null {
  if (row.sectionKey === "diagnoses") {
    return "diagnoses";
  }
  if (row.sectionKey === "medications_allergies") {
    return "medications_allergies";
  }
  if (row.sectionKey === "safety_social_support") {
    return "safety_social";
  }
  if (row.sectionKey === "functional_therapy") {
    return "functional_therapy";
  }
  if (row.sectionKey === "body_systems") {
    return "body_systems";
  }
  if (row.sectionKey === "dates_admin") {
    return "dates_admin";
  }

  const text = `${row.sectionKey} ${row.sourceSectionLabel} ${row.fieldKey} ${row.fieldLabel}`.toLowerCase();
  if (row.sectionKey.startsWith("active_diagnoses") || /\bdiagnos|icd|onset\b/.test(text)) {
    return "diagnoses";
  }
  if (row.sectionKey.startsWith("medication_allergies") || /\bmedication|allerg|injectable|o0110|high-risk\b/.test(text)) {
    return "medications_allergies";
  }
  if (
    /\bliving|caregiver|emergency|contact|supervision|safety|risk|fall|homebound|transport|code status|directive|hospitalization|alone|support\b/.test(text)
  ) {
    return "safety_social";
  }
  if (/\bfunctional|mobility|self care|therapy|pt\b|ot\b|discipline|frequency|gg0100|gg0130|gg0170|m18|m19|prior function/.test(text)) {
    return "functional_therapy";
  }
  if (isPlanOfCareCategoryText(text)) {
    return null;
  }
  if (/\bneurolog|cardio|respiratory|gastro|genitourinary|integumentary|wound|pain|endocrine|diabetic|eyes|ears|mood|behavioral\b/.test(text)) {
    return "body_systems";
  }
  if (/\bdate|soc|start of care|referral|dob|address|phone|physician|provider|language|admin/.test(text)) {
    return "dates_admin";
  }
  return "body_systems";
}

function isOasisItemIdPlaceholder(value: string | null | undefined, row: FieldComparison): boolean {
  if (!value || !row.oasisItemId) {
    return false;
  }
  return normalizeLabelForComparison(value) === normalizeLabelForComparison(row.oasisItemId);
}

function buildStructuredItemMeta(row: FieldComparison, side: "referral" | "oasis"): string | null {
  const parts = [
    side === "oasis" && row.oasisItemId && !isOasisItemIdPlaceholder(row.oasisItemId, row)
      ? row.oasisItemId
      : null,
    row.sectionLabel && normalizeLabelForComparison(row.sectionLabel) !== normalizeLabelForComparison(row.fieldLabel)
      ? row.sectionLabel
      : null,
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.slice(0, 2).join(" | ") : null;
}

function dedupeReferralOasisItems(items: ReferralOasisDisplayItem[]): ReferralOasisDisplayItem[] {
  const seen = new Set<string>();
  const deduped: ReferralOasisDisplayItem[] = [];
  for (const item of items) {
    const key = `${normalizeLabelForComparison(item.label)}|${normalizeLabelForComparison(item.value)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function splitDisplayListValue(value: string): string[] {
  return value
    .split(/\s*;\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => hasVisiblePortalValue(entry));
}

function findOasisChangeReason(row: FieldComparison, flags: ReferralOasisChangeFlag[]): string | null {
  if (flags.length === 0) {
    return null;
  }
  const rowKeys = [
    row.fieldKey,
    row.fieldLabel,
    row.oasisItemId ?? "",
    row.sectionKey,
    row.sectionLabel,
  ].map(normalizeLabelForComparison).filter(Boolean);

  for (const flag of flags) {
    const flagKeys = [
      flag.fieldKey ?? "",
      flag.label ?? "",
    ].map(normalizeLabelForComparison).filter(Boolean);
    if (flagKeys.some((flagKey) =>
      rowKeys.some((rowKey) => rowKey === flagKey || rowKey.includes(flagKey) || flagKey.includes(rowKey))
    )) {
      return flag.kind === "regressed" ? "Regressed" : "Changed";
    }
  }

  return null;
}

function buildDisplayItemsFromRows(
  rows: FieldComparison[],
  side: "referral" | "oasis",
  oasisChangeFlags: ReferralOasisChangeFlag[] = [],
): ReferralOasisDisplayItem[] {
  const items = rows.flatMap((row) => {
    const value = side === "referral" ? row.displayReferralValue : row.displayPortalValue;
    const hasValue = side === "referral"
      ? hasReferralBackedComparisonValue(row) && hasVisiblePortalValue(value)
      : hasUsableOasisValue(row) && hasVisiblePortalValue(value);

    if (!hasValue || isOasisItemIdPlaceholder(value, row)) {
      return [];
    }

    const changeReason = side === "oasis" ? findOasisChangeReason(row, oasisChangeFlags) : null;
    const label = side === "oasis" ? cleanOasisDisplayLabel(row.fieldLabel) : row.fieldLabel;
    return splitDisplayListValue(value)
      .filter((entry) => !isOasisItemIdPlaceholder(entry, row))
      .map((entry) => ({
        label,
        value: entry,
        meta: buildStructuredItemMeta(row, side),
        changed: Boolean(changeReason),
        changeReason,
      }));
  });

  return dedupeReferralOasisItems(items);
}

function diagnosisCodeFromValue(value: string): string | null {
  const direct = value.trim();
  if (isIcdCodeValue(direct)) {
    return direct.toUpperCase();
  }
  const match = direct.match(/\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDiagnosisEntry(entry: DiagnosisEntry | null, side: "referral" | "oasis"): ReferralOasisDisplayItem | null {
  if (!entry) {
    return null;
  }
  const code = entry.code ?? entry.normalizedIcd10Code ?? null;
  const description = entry.description?.trim() || null;
  if (!code && !description) {
    return null;
  }
  const label = code && description ? `${code} - ${description}` : code ?? description ?? "Diagnosis";
  const role = entry.role ?? entry.slotLabel ?? null;
  const metaParts = [
    role ? formatStatusLabel(role) : null,
    !description && code && side === "oasis" ? "Description not captured" : null,
  ].filter((part): part is string => Boolean(part));
  return {
    label,
    value: entry.onsetDate ? `Onset: ${entry.onsetDate}` : "Diagnosis",
    meta: metaParts.length > 0 ? metaParts.join(" | ") : null,
  };
}

function buildDiagnosisItemsFromSummary(
  summary: DiagnosisSummaryBlock | null | undefined,
  side: "referral" | "oasis",
): ReferralOasisDisplayItem[] {
  if (!summary) {
    return [];
  }
  return [
    formatDiagnosisEntry(summary.primaryDiagnosis, side),
    ...summary.otherDiagnoses.map((entry) => formatDiagnosisEntry(entry, side)),
  ].filter((entry): entry is ReferralOasisDisplayItem => entry !== null);
}

function getDiagnosisSideValue(row: FieldComparison, side: "referral" | "oasis"): string {
  return side === "referral" ? row.displayReferralValue : row.displayPortalValue;
}

function getDiagnosisSideSnippet(row: FieldComparison, side: "referral" | "oasis"): string | null | undefined {
  return side === "referral" ? row.referralSnippet : row.portalSnippet;
}

function getDiagnosisRoleLabel(row: FieldComparison): string | null {
  const text = normalizeLabelForComparison(`${row.fieldKey} ${row.fieldLabel}`);
  if (text.includes("primary diagnosis")) {
    return "Primary";
  }
  const otherMatch = text.match(/\bother diagnosis (\d+)\b/);
  if (otherMatch) {
    return `Other diagnosis ${otherMatch[1]}`;
  }
  return null;
}

function buildDiagnosisItemsFromRows(
  rows: FieldComparison[],
  side: "referral" | "oasis",
  oasisChangeFlags: ReferralOasisChangeFlag[] = [],
): ReferralOasisDisplayItem[] {
  const valueRows = rows.filter((row) => {
    const value = getDiagnosisSideValue(row, side);
    return side === "referral"
      ? hasReferralBackedComparisonValue(row) && hasVisiblePortalValue(value)
      : hasUsableOasisValue(row) && hasVisiblePortalValue(value);
  });
  const onsetValues = valueRows
    .filter((row) => normalizeLabelForComparison(row.fieldLabel).includes("onset"))
    .map((row) => compactDisplayText(getDiagnosisSideValue(row, side)))
    .filter(Boolean);
  const diagnosisRows = valueRows.filter((row) => {
    const value = getDiagnosisSideValue(row, side);
    return !normalizeLabelForComparison(row.fieldLabel).includes("onset") &&
      (isIcdCodeValue(value) || /\bdiagnos|icd\b/.test(normalizeLabelForComparison(row.fieldLabel)));
  });

  if (diagnosisRows.length === 0) {
    return buildDisplayItemsFromRows(rows, side, oasisChangeFlags);
  }

  const items = diagnosisRows.flatMap((row, index): ReferralOasisDisplayItem[] => {
    const value = compactDisplayText(getDiagnosisSideValue(row, side));
    const code = diagnosisCodeFromValue(value);
    if (!code) {
      return [];
    }
    const description = cleanDiagnosisDescription(getDiagnosisSideSnippet(row, side), code) ??
      cleanDiagnosisDescription(value, code);
    const onsetDate = onsetValues[index] ?? onsetValues[0] ?? null;
    const changeReason = side === "oasis" ? findOasisChangeReason(row, oasisChangeFlags) : null;
    const roleLabel = getDiagnosisRoleLabel(row);
    return [{
      label: description ? `${code} - ${description}` : code,
      value: onsetDate ? `Onset: ${onsetDate}` : "Diagnosis",
      meta: [
        roleLabel,
        !description && side === "oasis" ? "Description not captured" : null,
      ].filter((part): part is string => Boolean(part)).join(" | ") || null,
      changed: Boolean(changeReason),
      changeReason,
    }];
  });

  return dedupeReferralOasisItems(items);
}

function toMedicationListItems(summary: MedicationSummaryBlock | null | undefined, includeEmptyAllergy = false): ReferralOasisDisplayItem[] {
  if (!summary) {
    return includeEmptyAllergy ? [{ label: "Allergy: Not documented", value: "Not documented", meta: null }] : [];
  }
  const medicationItems = summary.medications.map((entry: MedicationEntry) => {
    const metaParts = [
      entry.dose,
      entry.route,
      entry.classification,
      entry.startDate ? `Start: ${entry.startDate}` : null,
      entry.status,
    ].filter((part): part is string => Boolean(part));
    return {
      label: entry.name,
      value: "Medication",
      meta: metaParts.length > 0 ? metaParts.join(" | ") : null,
    };
  });
  const allergyItems = summary.allergies.length > 0
    ? summary.allergies.map((allergy) => {
        if (typeof allergy === "string") {
          return {
            label: `Allergy: ${allergy}`,
            value: "Allergy",
            meta: null,
          };
        }
        const entry = allergy as AllergyEntry;
        const metaParts = [
          entry.reaction ? `Reaction: ${entry.reaction}` : null,
          entry.startDate ? `Start: ${entry.startDate}` : null,
          entry.status,
        ].filter((part): part is string => Boolean(part));
        return {
          label: `Allergy: ${entry.name}`,
          value: "Allergy",
          meta: metaParts.length > 0 ? metaParts.join(" | ") : null,
        };
      })
    : includeEmptyAllergy
      ? [{ label: "Allergy: Not documented", value: "Not documented", meta: null }]
      : [];
  return dedupeReferralOasisItems([...medicationItems, ...allergyItems]);
}

function appendRowFallbackItems(
  summaryItems: ReferralOasisDisplayItem[],
  rowItems: ReferralOasisDisplayItem[],
): ReferralOasisDisplayItem[] {
  const seen = new Set<string>();
  const seenDiagnosisCodes = new Set<string>();
  for (const item of summaryItems) {
    const label = normalizeLabelForComparison(item.label);
    const value = normalizeLabelForComparison(item.value);
    seen.add(`${label}|${value}`);
    seen.add(`${value}|${label}`);
    const code = diagnosisCodeFromValue(item.label) ?? diagnosisCodeFromValue(item.value);
    if (code) {
      seenDiagnosisCodes.add(code);
    }
  }
  const filteredRows = rowItems.filter((item) => {
    const label = normalizeLabelForComparison(item.label);
    const value = normalizeLabelForComparison(item.value);
    const key = `${label}|${value}`;
    const reversedKey = `${value}|${label}`;
    const code = diagnosisCodeFromValue(item.label) ?? diagnosisCodeFromValue(item.value);
    if (seen.has(key) || seen.has(reversedKey) || (code !== null && seenDiagnosisCodes.has(code))) {
      return false;
    }
    seen.add(key);
    seen.add(reversedKey);
    if (code) {
      seenDiagnosisCodes.add(code);
    }
    return true;
  });
  return dedupeReferralOasisItems([...summaryItems, ...filteredRows]);
}

export function buildReferralOasisCategoryModel(input: {
  group: { key: ReferralOasisGroupKey; label: string };
  referralRows: FieldComparison[];
  oasisRows: FieldComparison[];
  referralSummary?: ReferralOasisSourceSummaries | null;
  oasisSummary?: ReferralOasisSourceSummaries | null;
  oasisChangeFlags?: ReferralOasisChangeFlag[];
}): ReferralOasisCategoryModel {
  const oasisChangeFlags = input.oasisChangeFlags ?? [];
  const referralRowItems = input.group.key === "diagnoses"
    ? buildDiagnosisItemsFromRows(input.referralRows, "referral")
    : buildDisplayItemsFromRows(input.referralRows, "referral");
  const oasisRowItems = input.group.key === "diagnoses"
    ? buildDiagnosisItemsFromRows(input.oasisRows, "oasis", oasisChangeFlags)
    : buildDisplayItemsFromRows(input.oasisRows, "oasis", oasisChangeFlags);

  if (input.group.key === "diagnoses") {
    const referralSummaryItems = buildDiagnosisItemsFromSummary(input.referralSummary?.diagnosisSummary, "referral");
    const oasisSummaryItems = buildDiagnosisItemsFromSummary(input.oasisSummary?.diagnosisSummary, "oasis");
    return {
      key: input.group.key,
      label: input.group.label,
      referralItems: appendRowFallbackItems(referralSummaryItems, referralRowItems),
      oasisItems: appendRowFallbackItems(oasisSummaryItems, oasisRowItems),
    };
  }

  if (input.group.key === "medications_allergies") {
    const referralSummaryItems = toMedicationListItems(input.referralSummary?.medicationSummary, false);
    const oasisSummaryItems = toMedicationListItems(input.oasisSummary?.medicationSummary, false);
    return {
      key: input.group.key,
      label: input.group.label,
      referralItems: referralSummaryItems.length > 0 ? referralSummaryItems : referralRowItems,
      oasisItems: oasisSummaryItems.length > 0 ? oasisSummaryItems : oasisRowItems,
    };
  }

  return {
    key: input.group.key,
    label: input.group.label,
    referralItems: referralRowItems,
    oasisItems: oasisRowItems,
  };
}
