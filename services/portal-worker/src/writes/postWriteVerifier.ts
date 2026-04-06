import {
  type PostWriteValidationResult,
  postWriteValidationResultSchema,
} from "@medical-ai-qa/shared-types";
import { type ResolvedFieldTarget } from "../types/writeTargets";
import { verifyFieldValue } from "./interactions/verifyFieldValue";

export async function runPostWriteVerification(input: {
  target: ResolvedFieldTarget;
  proposedValue: string;
}): Promise<PostWriteValidationResult> {
  const verification = await verifyFieldValue(input.target, input.proposedValue);

  return postWriteValidationResultSchema.parse({
    verificationPassed: verification.matches,
    finalValue: verification.finalValue,
    normalizedFinalValue: verification.normalizedFinalValue,
    warnings: verification.matches ? [] : ["Post-write field verification did not match the proposed value."],
    guardFailures: verification.matches ? [] : ["POST_WRITE_VERIFICATION_FAILED"],
  });
}
