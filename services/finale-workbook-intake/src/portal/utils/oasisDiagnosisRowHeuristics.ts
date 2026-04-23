export interface OasisDiagnosisRowFieldSignal {
  field: "icd10Code" | "onsetDate" | "description" | "severity" | "timingFlags";
  found: boolean;
  disabled: boolean | null;
  readOnly: boolean | null;
}

export interface OasisDiagnosisRowCandidate {
  sectionLabel: string | null;
  icd10Code: string | null;
  onsetDate: string | null;
  description: string | null;
  severity: string | null;
  timingFlags: string[];
  rawText: string;
  selectorEvidence: OasisDiagnosisRowFieldSignal[];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeNoiseText(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/CODEONSET/g, "CODE ONSET")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findFieldSignal(
  selectorEvidence: OasisDiagnosisRowFieldSignal[],
  field: OasisDiagnosisRowFieldSignal["field"],
): OasisDiagnosisRowFieldSignal | undefined {
  return selectorEvidence.find((entry) => entry.field === field);
}

function hasEditableFieldSignal(selectorEvidence: OasisDiagnosisRowFieldSignal[]): boolean {
  return selectorEvidence.some((entry) =>
    entry.found &&
    entry.disabled === false &&
    (entry.readOnly === false || entry.readOnly === null),
  );
}

function hasExtendedFieldSignals(selectorEvidence: OasisDiagnosisRowFieldSignal[]): boolean {
  return ["description", "severity", "timingFlags"].some((field) =>
    findFieldSignal(
      selectorEvidence,
      field as OasisDiagnosisRowFieldSignal["field"],
    )?.found === true,
  );
}

function stripHeaderTokens(rawText: string): string {
  return normalizeNoiseText(rawText)
    .replace(/\bPRIMARY DIAGNOSIS\b/g, " ")
    .replace(/\bOTHER DIAGNOSIS(?:\s+\d+|\s*-\s*\d+)?\b/g, " ")
    .replace(/\bICD\s*10\b/g, " ")
    .replace(/\bCODE\b/g, " ")
    .replace(/\bONSET DATE\b/g, " ")
    .replace(/\bONSET\b/g, " ")
    .replace(/\bDATE\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHeaderNoiseText(rawText: string): boolean {
  const normalized = normalizeNoiseText(rawText);
  if (!normalized) {
    return true;
  }

  return (
    /\bICD\s*10\b/.test(normalized) &&
    /(CODE ONSET DATE|CODE DATE|ONSET DATE)/.test(normalized) &&
    stripHeaderTokens(rawText).length === 0
  );
}

export function getOasisDiagnosisRowRejectionReason(
  candidate: OasisDiagnosisRowCandidate,
): string | null {
  const hasDescriptionValue = normalizeWhitespace(candidate.description).length > 0;
  const hasSeverityValue = normalizeWhitespace(candidate.severity).length > 0;
  const hasTimingValue = candidate.timingFlags.length > 0;
  const hasCodeValue = normalizeWhitespace(candidate.icd10Code).length > 0;
  const hasOnsetValue = normalizeWhitespace(candidate.onsetDate).length > 0;
  const hasAnyFieldSignals = candidate.selectorEvidence.some((entry) => entry.found);
  const hasActionableSignals =
    hasDescriptionValue ||
    hasSeverityValue ||
    hasTimingValue ||
    hasExtendedFieldSignals(candidate.selectorEvidence) ||
    hasEditableFieldSignal(candidate.selectorEvidence);

  if (!hasAnyFieldSignals && stripHeaderTokens(candidate.rawText).length === 0) {
    return "empty_ui_noise";
  }

  if (
    isHeaderNoiseText(candidate.rawText) &&
    !hasActionableSignals &&
    (hasCodeValue || hasOnsetValue || Boolean(candidate.sectionLabel))
  ) {
    return "header_ui_noise";
  }

  return null;
}

export function isOasisDiagnosisRowActionable(
  candidate: OasisDiagnosisRowCandidate,
): boolean {
  return getOasisDiagnosisRowRejectionReason(candidate) === null;
}

export function isOasisDiagnosisRowInteractable(
  candidate: OasisDiagnosisRowCandidate,
): boolean {
  return (
    isOasisDiagnosisRowActionable(candidate) &&
    hasEditableFieldSignal(candidate.selectorEvidence)
  );
}
