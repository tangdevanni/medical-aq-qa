import { sanitizeDocumentText } from "../../extractors/shared/sanitizeText";
import { type ResolvedFieldTarget } from "../../types/writeTargets";

export interface ReadFieldValueResult {
  rawValue: string | null;
  sanitizedValue: string | null;
  normalizedValue: string | null;
}

export async function readFieldValue(
  target: ResolvedFieldTarget,
): Promise<ReadFieldValueResult> {
  const rawValue = await readRawFieldValue(target);

  return {
    rawValue,
    sanitizedValue: sanitizeDocumentText(rawValue, 48),
    normalizedValue: normalizeWriteComparisonValue(rawValue),
  };
}

export function normalizeWriteComparisonValue(
  value: string | null | undefined,
): string | null {
  const normalized = value
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? normalized : null;
}

async function readRawFieldValue(
  target: ResolvedFieldTarget,
): Promise<string | null> {
  if (target.interactionType === "contenteditable") {
    return target.locator.textContent().catch(() => null);
  }

  const value = await target.locator.inputValue().catch(() => null);
  if (typeof value === "string") {
    return value;
  }

  return target.locator.textContent().catch(() => null);
}
