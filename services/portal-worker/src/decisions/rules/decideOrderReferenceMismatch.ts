import { type CrossDocumentQaMismatch, type QaDecision } from "@medical-ai-qa/shared-types";
import { summarizeDocumentField, type QaDecisionEngineInput } from "../decisionShared";
import {
  buildCommonEvidence,
  determineAutoFixEligibility,
  determineDecisionType,
  resolveDecisionContext,
  shouldEmitDecisionForCurrentDocument,
} from "./decisionRuleHelpers";

export function decideOrderReferenceMismatch(
  input: QaDecisionEngineInput,
  mismatch: CrossDocumentQaMismatch,
): QaDecision[] {
  const { resolution, sourceDocument, targetDocument, warningCodes } = resolveDecisionContext(
    input,
    "ORDER_NOT_REFERENCED",
  );

  if (!shouldEmitDecisionForCurrentDocument(input, resolution.sourceOfTruth?.targetDocumentKind ?? null)) {
    return [];
  }

  const sourceValue = summarizeDocumentField(sourceDocument, "orderSummary");
  const targetValue = summarizeDocumentField(targetDocument, "orderSummary");
  const manualReviewReasons = [...resolution.humanReviewReasons, "CLINICALLY_SENSITIVE_NARRATIVE"] as const;
  const actionability = sourceValue && targetDocument
    ? input.crossDocumentQa.bundleConfidence === "LOW"
      ? "REVIEW_ONLY"
      : "ACTIONABLE"
    : "NOT_ACTIONABLE";

  return [{
    decisionType: determineDecisionType(actionability, Boolean(sourceValue)),
    issueType: mismatch.type,
    actionability,
    autoFixEligibility: determineAutoFixEligibility({
      actionability,
      allowSafeAutofix: false,
      manualReviewReasons: [...manualReviewReasons],
    }),
    confidence: resolution.sourceOfTruth?.confidence ?? mismatch.confidence,
    sourceOfTruth: resolution.sourceOfTruth,
    proposedAction: {
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? null,
      targetField: targetDocument ? "orderSummary" : null,
      action: actionability === "ACTIONABLE" ? "APPEND_FIELD" : "NO_ACTION",
      proposedValue: actionability === "ACTIONABLE" ? sourceValue : null,
      changeStrategy: actionability === "ACTIONABLE" ? "APPEND" : "NONE",
    },
    reason: sourceValue
      ? "Order content was present in order documents but not clearly referenced in the target document."
      : "Order mismatch was detected but no short deterministic order anchor was available for a safe proposal.",
    evidence: buildCommonEvidence({
      sourceDocumentKind: resolution.sourceOfTruth?.sourceDocumentKind ?? null,
      sourceField: "orderSummary",
      sourceValue,
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? null,
      targetField: "orderSummary",
      targetValue,
      warningCodes,
    }),
    humanReviewReasons: [...new Set(manualReviewReasons)],
  }];
}
