import { type ResolvedFieldTarget } from "../../types/writeTargets";
import { normalizeWriteComparisonValue, readFieldValue } from "./readFieldValue";

export async function verifyFieldValue(
  target: ResolvedFieldTarget,
  expectedValue: string,
): Promise<{
  matches: boolean;
  finalValue: string | null;
  normalizedFinalValue: string | null;
}> {
  const current = await readFieldValue(target);
  const normalizedExpected = normalizeWriteComparisonValue(expectedValue);

  return {
    matches: Boolean(normalizedExpected && current.normalizedValue === normalizedExpected),
    finalValue: current.sanitizedValue,
    normalizedFinalValue: current.normalizedValue,
  };
}
