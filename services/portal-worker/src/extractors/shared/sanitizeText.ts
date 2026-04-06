import { type DocumentKind } from "@medical-ai-qa/shared-types";

const DATE_PATTERN = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const LONG_NUMBER_PATTERN = /\b\d{5,}\b/g;
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g;
const EMAIL_PATTERN = /\b\S+@\S+\.\S+\b/g;
const DOCUMENT_LABEL_PATTERNS: Record<DocumentKind, RegExp[]> = {
  VISIT_NOTE: [/\b(?:therapy|pt|ot|st|nursing)?\s*visit note\b/i],
  OASIS: [/\boasis(?:\s+\w+)?\b/i],
  PLAN_OF_CARE: [/\bplan of care\b/i, /\bpoc\b/i],
  ADMISSION_ORDER: [/\badmission order\b/i, /\bstart of care order\b/i],
  PHYSICIAN_ORDER: [/\bphysician order\b/i, /\border type\b/i],
  UNKNOWN: [],
};

export function collapseWhitespace(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function sanitizeDocumentText(
  value: string | null | undefined,
  maxLength = 96,
): string | null {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return null;
  }

  const sanitized = normalized
    .replace(DATE_PATTERN, "[date]")
    .replace(LONG_NUMBER_PATTERN, "[id]")
    .replace(PHONE_PATTERN, "[phone]")
    .replace(EMAIL_PATTERN, "[email]");

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  return `${sanitized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function sanitizeDocumentTitle(
  value: string | null | undefined,
  documentKinds: readonly DocumentKind[] = [],
): string | null {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return null;
  }

  const segments = normalized
    .split(/\s+(?:\||-|:|\/)\s+/)
    .map((segment) => sanitizeDocumentText(segment, 80))
    .filter((segment): segment is string => Boolean(segment));

  for (const documentKind of documentKinds) {
    for (const pattern of DOCUMENT_LABEL_PATTERNS[documentKind]) {
      const exactSegment = segments.find((segment) => pattern.test(segment));
      if (exactSegment) {
        return exactSegment;
      }

      const fullMatch = normalized.match(pattern);
      if (fullMatch) {
        return sanitizeDocumentText(fullMatch[0], 80);
      }
    }
  }

  const sanitized = sanitizeDocumentText(normalized, 80);
  if (!sanitized) {
    return null;
  }

  return /\b(note|oasis|plan of care|order|certification|assessment)\b/i.test(sanitized)
    ? sanitized
    : null;
}

export function maskIdentifier(value: string | null | undefined): string | null {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return null;
  }

  const tail = normalized.replace(/[^A-Za-z0-9]/g, "").slice(-4);
  return tail ? `***${tail}` : "***";
}

export function maskClinicianName(value: string | null | undefined): string | null {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return null;
  }

  const words = normalized.split(/\s+/).slice(0, 3);
  if (words.length === 0) {
    return null;
  }

  return words
    .map((word) => (/^[A-Za-z]/.test(word) ? `${word[0].toUpperCase()}***` : word))
    .join(" ");
}
