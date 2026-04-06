import { type CrossDocumentQaMismatch, type QaDecision } from "@medical-ai-qa/shared-types";
import { summarizeDocumentField, type QaDecisionEngineInput } from "../decisionShared";
import {
  buildCommonEvidence,
  determineAutoFixEligibility,
  determineDecisionType,
  resolveDecisionContext,
  shouldEmitDecisionForCurrentDocument,
} from "./decisionRuleHelpers";

export function decideFrequencyMismatch(
  input: QaDecisionEngineInput,
  mismatch: CrossDocumentQaMismatch,
): QaDecision[] {
  const { resolution, sourceDocument, targetDocument, warningCodes } = resolveDecisionContext(
    input,
    "FREQUENCY_MISMATCH",
  );

  if (!shouldEmitDecisionForCurrentDocument(input, resolution.sourceOfTruth?.targetDocumentKind ?? null)) {
    return [];
  }

  const sourceValue = summarizeDocumentField(sourceDocument, "frequencySummary");
  const targetValue = summarizeDocumentField(targetDocument, "frequencySummary");
  const actionability = sourceValue && targetDocument
    ? input.crossDocumentQa.bundleConfidence === "LOW"
      ? "REVIEW_ONLY"
      : "ACTIONABLE"
    : targetDocument
      ? "REVIEW_ONLY"
      : "NOT_ACTIONABLE";
  const manualReviewReasons = [...resolution.humanReviewReasons];

  return [{
    decisionType: determineDecisionType(actionability, Boolean(sourceValue)),
    issueType: mismatch.type,
    actionability,
    autoFixEligibility: determineAutoFixEligibility({
      actionability,
      allowSafeAutofix:
        input.crossDocumentQa.bundleConfidence === "HIGH" &&
        (resolution.sourceOfTruth?.confidence === "HIGH" || resolution.sourceOfTruth?.confidence === "MEDIUM") &&
        Boolean(sourceValue) &&
        manualReviewReasons.length === 0,
      manualReviewReasons,
    }),
    confidence: resolution.sourceOfTruth?.confidence ?? mismatch.confidence,
    sourceOfTruth: resolution.sourceOfTruth,
    proposedAction: {
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? "VISIT_NOTE",
      targetField: targetDocument ? "frequencySummary" : null,
      action: actionability === "NOT_ACTIONABLE" ? "NO_ACTION" : "UPDATE_FIELD",
      proposedValue: sourceValue,
      changeStrategy: actionability === "NOT_ACTIONABLE" ? "NONE" : "REPLACE",
    },
    reason: sourceValue
      ? "Visit frequency should align to the extracted plan-of-care frequency anchor."
      : "Frequency mismatch was detected but no plan-of-care frequency anchor was available for deterministic correction.",
    evidence: buildCommonEvidence({
      sourceDocumentKind: resolution.sourceOfTruth?.sourceDocumentKind ?? null,
      sourceField: "frequencySummary",
      sourceValue,
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? "VISIT_NOTE",
      targetField: "frequencySummary",
      targetValue,
      warningCodes,
    }),
    humanReviewReasons: [...new Set(manualReviewReasons)],
  }];
}
