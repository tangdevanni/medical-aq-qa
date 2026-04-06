import { collapseWhitespace } from "./sanitizeText";

const PLACEHOLDER_PATTERNS = [
  /^(n\/?a|na|null|none|unknown)$/i,
  /^(not documented|not entered|not available|not provided)$/i,
  /^(see above|same as above)$/i,
  /^(select|choose|click to add)$/i,
] as const;

export function hasMeaningfulDocumentContent(
  text: string | null | undefined,
  options: {
    label?: string | null;
    minimumLength?: number;
  } = {},
): boolean {
  const normalized = collapseWhitespace(text);
  if (!normalized) {
    return false;
  }

  const normalizedLabel = collapseWhitespace(options.label)?.toLowerCase().replace(/[:\-]/g, "").trim() ?? null;
  const body = stripLabelText(normalized, normalizedLabel);
  if (!body) {
    return false;
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(body))) {
    return false;
  }

  if (normalizedLabel && body === normalizedLabel) {
    return false;
  }

  if (body.length < 12) {
    return false;
  }

  const alphaCharacters = (body.match(/[A-Za-z]/g) ?? []).length;
  const uniqueWords = new Set(body.toLowerCase().match(/[a-z]{2,}/g) ?? []).size;
  const minimumLength = options.minimumLength ?? 24;

  if (alphaCharacters < 6 || uniqueWords < 2) {
    return false;
  }

  return body.length >= minimumLength;
}

function stripLabelText(text: string, normalizedLabel: string | null): string | null {
  if (!normalizedLabel) {
    return text.toLowerCase();
  }

  const lower = text.toLowerCase();
  if (lower.startsWith(normalizedLabel)) {
    const stripped = lower.slice(normalizedLabel.length).replace(/^[:\-\s]+/, "").trim();
    return stripped || null;
  }

  return lower;
}
