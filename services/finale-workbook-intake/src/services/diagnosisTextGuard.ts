function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

const DIAGNOSIS_DESCRIPTION_PATTERN =
  /\b(?:fracture|aftercare|encounter|heart|failure|diabetes|mellitus|hypertension|disease|dysphagia|weakness|pneumonia|unspecified|history|fall|atrial|fibrillation|hyperlipidemia|gastro|reflux|hypothyroidism|depression|kidney|anemia|respiratory|organism|wound|infection|surgery|joint|arthroplasty|rotator|cuff|pain)\b/i;

const NON_DIAGNOSIS_CONTEXT_PATTERN =
  /\b(?:allerg(?:y|ies|ic)|nkda|nka|no known drug allergies|no known allergies|pharmacy|medication|oral|tablet|capsule|dose|route|mg|mcg|meq|ml|by mouth|once a day|twice a day|q4-6|prn)\b/i;

export function isClearlyNotDiagnosisDescription(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return true;
  }

  if (/^(?:none|n\/a|not applicable|unknown|no known drug allergies|no known allergies|nkda|nka)$/i.test(normalized)) {
    return true;
  }

  if (/\ballerg(?:y|ies|ic)\b/i.test(normalized) && !DIAGNOSIS_DESCRIPTION_PATTERN.test(normalized)) {
    return true;
  }

  if (NON_DIAGNOSIS_CONTEXT_PATTERN.test(normalized) && !DIAGNOSIS_DESCRIPTION_PATTERN.test(normalized)) {
    return true;
  }

  return false;
}

export function isSuspiciousIcdDescriptionPair(input: {
  icd10Code: string | null | undefined;
  description: string | null | undefined;
}): boolean {
  const code = normalizeWhitespace(input.icd10Code).toUpperCase();
  const description = normalizeWhitespace(input.description);
  if (!code || !description) {
    return false;
  }

  const lower = description.toLowerCase();
  const isAftercareCode = /^Z47(?:\.|$)/.test(code);
  const looksLikePriorSurgeryHistory =
    /\bhistory of\b/.test(lower) &&
    /\b(?:arthroplasty|joint replacement|surgery|surgical repair)\b/.test(lower);
  const explicitlyAftercare =
    /\b(?:aftercare|encounter|orthopedic aftercare|post[- ]?op|postoperative)\b/.test(lower);

  if (isAftercareCode && looksLikePriorSurgeryHistory && !explicitlyAftercare) {
    return true;
  }

  return false;
}
