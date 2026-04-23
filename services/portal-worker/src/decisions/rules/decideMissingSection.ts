import { type QaDecision, type VisitNoteQaRule } from "@medical-ai-qa/shared-types";
import { summarizeDocumentField, type QaDecisionEngineInput } from "../decisionShared";
import {
  buildCommonEvidence,
  determineAutoFixEligibility,
  determineDecisionType,
  resolveDecisionContext,
  shouldEmitDecisionForCurrentDocument,
} from "./decisionRuleHelpers";

export function decideMissingSection(
  input: QaDecisionEngineInput,
  rule: VisitNoteQaRule,
): QaDecision[] {
  if (rule.status !== "FAIL") {
    return [];
  }

  if (rule.id !== "missing_subjective" && rule.id !== "missing_diagnosis" && rule.id !== "missing_visit_summary") {
    return [];
  }

  const { resolution, sourceDocument, targetDocument, warningCodes } = resolveDecisionContext(
    input,
    rule.id,
  );

  if (!shouldEmitDecisionForCurrentDocument(input, resolution.sourceOfTruth?.targetDocumentKind ?? null)) {
    return [];
  }

  const targetField = mapRuleIdToTargetField(rule.id);
  const sourceValue = mapRuleIdToSourceValue(rule.id, sourceDocument);
  const targetValue = targetDocument ? summarizeDocumentField(targetDocument, targetField) : null;
  const clinicalNarrative = rule.id !== "missing_subjective";
  const manualReviewReasons = [
    ...resolution.humanReviewReasons,
    ...(clinicalNarrative ? ["CLINICALLY_SENSITIVE_NARRATIVE"] as const : []),
  ];
  const actionability = sourceValue && targetDocument && rule.id === "missing_diagnosis"
    ? input.crossDocumentQa.bundleConfidence === "LOW"
      ? "REVIEW_ONLY"
      : "ACTIONABLE"
    : targetDocument
      ? "REVIEW_ONLY"
      : "NOT_ACTIONABLE";

  return [{
    decisionType: determineDecisionType(actionability, Boolean(sourceValue)),
    issueType: rule.id,
    actionability,
    autoFixEligibility: determineAutoFixEligibility({
      actionability,
      allowSafeAutofix: false,
      manualReviewReasons,
    }),
    confidence: resolution.sourceOfTruth?.confidence ?? "LOW",
    sourceOfTruth: resolution.sourceOfTruth,
    proposedAction: {
      targetDocumentKind: "VISIT_NOTE",
      targetField,
      action: actionability === "ACTIONABLE" ? "UPDATE_FIELD" : actionability === "REVIEW_ONLY" ? "REVIEW_FIELD" : "NO_ACTION",
      proposedValue: actionability === "ACTIONABLE" ? sourceValue : null,
      changeStrategy: actionability === "ACTIONABLE" ? "REPLACE" : "NONE",
    },
    reason: buildMissingSectionReason(rule.id, Boolean(sourceValue)),
    evidence: buildCommonEvidence({
      sourceDocumentKind: resolution.sourceOfTruth?.sourceDocumentKind ?? null,
      sourceField: targetField,
      sourceValue,
      targetDocumentKind: "VISIT_NOTE",
      targetField,
      targetValue,
      warningCodes,
    }),
    humanReviewReasons: [...new Set(manualReviewReasons)],
  }];
}

function mapRuleIdToTargetField(
  ruleId: "missing_subjective" | "missing_diagnosis" | "missing_visit_summary",
): "diagnosisSummary" | "orderSummary" {
  switch (ruleId) {
    case "missing_diagnosis":
      return "diagnosisSummary";
    case "missing_subjective":
    case "missing_visit_summary":
    default:
      return "orderSummary";
  }
}

function mapRuleIdToSourceValue(
  ruleId: "missing_subjective" | "missing_diagnosis" | "missing_visit_summary",
  sourceDocument: QaDecisionEngineInput["currentDocument"] | null,
): string | null {
  switch (ruleId) {
    case "missing_diagnosis":
      return summarizeDocumentField(sourceDocument, "diagnosisSummary");
    case "missing_visit_summary":
      return summarizeDocumentField(sourceDocument, "orderSummary") ??
        summarizeDocumentField(sourceDocument, "frequencySummary") ??
        summarizeDocumentField(sourceDocument, "homeboundSummary");
    case "missing_subjective":
    default:
      return null;
  }
}

function buildMissingSectionReason(
  ruleId: "missing_subjective" | "missing_diagnosis" | "missing_visit_summary",
  hasSourceValue: boolean,
): string {
  switch (ruleId) {
    case "missing_diagnosis":
      return hasSourceValue
        ? "Visit note diagnosis section was missing while a supporting diagnosis anchor existed in the bundle."
        : "Visit note diagnosis section was missing, but no deterministic diagnosis source was available.";
    case "missing_visit_summary":
      return "Visit summary content was missing and requires review against supporting documents before any update.";
    case "missing_subjective":
    default:
      return "Subjective content is visit-specific narrative and requires human review rather than deterministic autofill.";
  }
}
