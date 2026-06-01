import { normalizeWhitespace } from "./clinicalFactPackUtils";
export { CLINICAL_TEXT_QUALITY_FILTER_VERSION } from "./clinicalQualityVersion";

const PDF_BINARY_PATTERNS = [
  /%?PDF-\d\.\d/i,
  /\b\d+\s+\d+\s+obj\b/i,
  /\bendobj\b/i,
  /\bxref\b/i,
  /\btrailer\b/i,
  /\bstartxref\b/i,
  /\bstream\b[\s\S]{0,80}\bendstream\b/i,
  /\bTitle\s*\(\s*Finale Health\s*\)/i,
  /\bMozilla\/5\.0\b/i,
];

const SELECTOR_DEBUG_PATTERNS = [
  /\[(?:matched|not_found|timeout|error)\]/i,
  /\bformcontrolname\b/i,
  /\bformgroupname\b/i,
  /\bselectors?\b/i,
  /\belapsedMs\s*=/i,
  /\bvisible\s*=/i,
  /\bcount\s*=/i,
  /\bselector(?:Used)?\b/i,
  /Prefer formcontrolname selectors/i,
  /Insert Diagnosis action button/i,
  /Snapshot is read-only/i,
  /Diagnosis rows inferred from icdcode field anchors/i,
  /OASIS diagnosis card container/i,
  /fallback to row text heuristics/i,
  /row text heuristics/i,
  /rows are classified as existing diagnoses/i,
  /empty editable slots/i,
  /empty readonly slots/i,
  /\b(?:true|false)\s+(?:true|false)\s+(?:true|false)\b.*\b(?:https?:\/\/|\/data\/control-plane)\b/i,
  /\b(?:high|medium|low):\d+\s+(?:high|medium|low):\d+\s+(?:high|medium|low):\d+\b/i,
  /\b(?:OASIS|Visit Notes?|File Uploads?|Documents?)\s+(?:documents\s+)?page\b.*\b(?:true|false)\b/i,
  /\bapp\.finalehealth\.com\b.*\b(?:true|false|\/data\/control-plane)\b/i,
];

const CLINICAL_HINT_PATTERNS = [
  /\bdiagnos(?:is|es|ed)\b/i,
  /\bicd\b/i,
  /\b(?:pneumonia|heart failure|atrial fibrillation|dysphagia|hypertension|depression|hypothyroidism|weakness)\b/i,
  /\b(?:wound|ulcer|pain|fall|mobility|ambulat|transfer|walker|wheelchair|oxygen|dyspnea|medication|allerg)\b/i,
  /\b(?:homebound|skilled|caregiver|hospital|discharge|vital|blood pressure|pulse)\b/i,
  /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/i,
];

export function isLikelyPdfBinaryText(text: string | null | undefined): boolean {
  const value = normalizeWhitespace(text);
  return Boolean(value && PDF_BINARY_PATTERNS.some((pattern) => pattern.test(value)));
}

export function isLikelySelectorDebugText(text: string | null | undefined): boolean {
  const value = normalizeWhitespace(text);
  return Boolean(value && SELECTOR_DEBUG_PATTERNS.some((pattern) => pattern.test(value)));
}

export function isLikelyOcrGibberish(text: string | null | undefined): boolean {
  const value = normalizeWhitespace(text);
  if (!value) return true;
  if (value.length <= 3) return !/^(?:no|yes|pt|ot|st|rn|sn|[A-TV-Z]\d{2})$/i.test(value);
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const vowels = value.match(/[AEIOUaeiou]/g)?.length ?? 0;
  const symbols = value.match(/[^A-Za-z0-9\s.,;:()/-]/g)?.length ?? 0;
  const tokens = value.split(/\s+/).filter(Boolean);
  const gibberishTokens = tokens.filter((token) =>
    token.length >= 5 &&
    /[A-Za-z]/.test(token) &&
    /[0-9]/.test(token) &&
    !/\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/i.test(token));
  if (symbols / Math.max(1, value.length) > 0.18) return true;
  if (letters >= 12 && vowels / Math.max(1, letters) < 0.18 && !CLINICAL_HINT_PATTERNS.some((pattern) => pattern.test(value))) return true;
  if (gibberishTokens.length >= Math.max(2, Math.ceil(tokens.length / 3))) return true;
  return false;
}

export function getClinicalTextQualityReason(text: string | null | undefined): string | null {
  const value = normalizeWhitespace(text);
  if (!value) return "empty_text";
  if (/^(?:true|false)$/i.test(value)) return "boolean_or_debug_value";
  if (isLikelyPdfBinaryText(value)) return "pdf_binary_or_metadata_text";
  if (isLikelySelectorDebugText(value)) return "selector_or_debug_text";
  if (isLikelyOcrGibberish(value)) return "ocr_gibberish";
  return null;
}

export function isClinicallyUsableSnippet(text: string | null | undefined): boolean {
  const value = normalizeWhitespace(text);
  if (!value) return false;
  if (getClinicalTextQualityReason(value)) return false;
  if (value.length < 4) return /^(?:no|yes|pt|ot|st|rn|sn|[A-TV-Z]\d{2})$/i.test(value);
  return true;
}

export function sanitizeClinicalSnippet(text: string | null | undefined, maxLength = 260): string {
  const value = normalizeWhitespace(text);
  if (!isClinicallyUsableSnippet(value)) return "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}...`;
}
