import { type CrossDocumentQaMismatch, type QaDecision } from "@medical-ai-qa/shared-types";
import { summarizeDocumentField, type QaDecisionEngineInput } from "../decisionShared";
import {
  buildCommonEvidence,
  determineAutoFixEligibility,
  determineDecisionType,
  resolveDecisionContext,
  shouldEmitDecisionForCurrentDocument,
} from "./decisionRuleHelpers";

export function decideHomeboundMismatch(
  input: QaDecisionEngineInput,
  mismatch: CrossDocumentQaMismatch,
): QaDecision[] {
  const { resolution, sourceDocument, targetDocument, warningCodes } = resolveDecisionContext(
    input,
    "MISSING_HOMEBOUND_REASON",
  );

  if (!shouldEmitDecisionForCurrentDocument(input, resolution.sourceOfTruth?.targetDocumentKind ?? null)) {
    return [];
  }

  const sourceValue = summarizeDocumentField(sourceDocument, "homeboundSummary");
  const targetValue = summarizeDocumentField(targetDocument, "homeboundSummary");
  const manualReviewReasons = [...resolution.humanReviewReasons, "CLINICALLY_SENSITIVE_NARRATIVE"] as const;
  const actionability = sourceValue && targetDocument
    ? input.crossDocumentQa.bundleConfidence === "LOW"
      ? "REVIEW_ONLY"
      : "ACTIONABLE"
    : targetDocument
      ? "REVIEW_ONLY"
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
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? "VISIT_NOTE",
      targetField: targetDocument ? "homeboundSummary" : null,
      action: actionability === "NOT_ACTIONABLE" ? "NO_ACTION" : "UPDATE_FIELD",
      proposedValue: sourceValue,
      changeStrategy: actionability === "NOT_ACTIONABLE" ? "NONE" : "REPLACE",
    },
    reason: sourceValue
      ? "Homebound rationale was present in OASIS but missing from the visit note extraction."
      : "Missing homebound rationale was detected but no safe OASIS homebound anchor was available.",
    evidence: buildCommonEvidence({
      sourceDocumentKind: resolution.sourceOfTruth?.sourceDocumentKind ?? null,
      sourceField: "homeboundSummary",
      sourceValue,
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? "VISIT_NOTE",
      targetField: "homeboundSummary",
      targetValue,
      warningCodes,
    }),
    humanReviewReasons: [...new Set(manualReviewReasons)],
  }];
}
