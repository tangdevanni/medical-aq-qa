import { type CrossDocumentQaMismatch, type QaDecision } from "@medical-ai-qa/shared-types";
import { summarizeDocumentField, type QaDecisionEngineInput } from "../decisionShared";
import {
  buildCommonEvidence,
  determineAutoFixEligibility,
  determineDecisionType,
  resolveDecisionContext,
  shouldEmitDecisionForCurrentDocument,
} from "./decisionRuleHelpers";

export function decideDiagnosisMismatch(
  input: QaDecisionEngineInput,
  mismatch: CrossDocumentQaMismatch,
): QaDecision[] {
  const { resolution, sourceDocument, targetDocument, warningCodes } = resolveDecisionContext(
    input,
    "DIAGNOSIS_MISMATCH",
  );

  if (!shouldEmitDecisionForCurrentDocument(input, resolution.sourceOfTruth?.targetDocumentKind ?? null)) {
    return [];
  }

  const sourceValue = summarizeDocumentField(sourceDocument, "diagnosisSummary");
  const targetValue = summarizeDocumentField(targetDocument, "diagnosisSummary");
  const humanReviewReasons = [...resolution.humanReviewReasons, "CLINICALLY_SENSITIVE_NARRATIVE"] as const;
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
      manualReviewReasons: [...humanReviewReasons],
    }),
    confidence: resolution.sourceOfTruth?.confidence ?? mismatch.confidence,
    sourceOfTruth: resolution.sourceOfTruth,
    proposedAction: {
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? "VISIT_NOTE",
      targetField: targetDocument ? "diagnosisSummary" : null,
      action: actionability === "NOT_ACTIONABLE" ? "NO_ACTION" : "UPDATE_FIELD",
      proposedValue: sourceValue,
      changeStrategy: actionability === "NOT_ACTIONABLE" ? "NONE" : "REPLACE",
    },
    reason: sourceValue
      ? "Supporting diagnosis anchor differed from the visit note and should be aligned conservatively."
      : "Diagnosis mismatch was detected but no safe supporting diagnosis anchor was available for a deterministic proposal.",
    evidence: buildCommonEvidence({
      sourceDocumentKind: resolution.sourceOfTruth?.sourceDocumentKind ?? null,
      sourceField: "diagnosisSummary",
      sourceValue,
      targetDocumentKind: resolution.sourceOfTruth?.targetDocumentKind ?? "VISIT_NOTE",
      targetField: "diagnosisSummary",
      targetValue,
      warningCodes,
    }),
    humanReviewReasons: [...new Set(humanReviewReasons)],
  }];
}
