import {
  type CrossDocumentQaResult,
  type DocumentKind,
  type QaDecision,
  type QaDecisionResult,
  type WriteExecutionAttempt,
  type WriteExecutionResult,
  type WorkflowEligibility,
  type WorkflowGuardFailureReason,
  type WorkflowSupport,
} from "@medical-ai-qa/shared-types";
import { type WorkflowExecutionConfig } from "./workflowExecutionConfig";
import { getWorkflowAllowlistEntry, type WorkflowAllowlistEntry } from "./workflowAllowlist";
import { getWorkflowSupport } from "./workflowSupportMatrix";

export interface WorkflowGuardEvaluationResult {
  eligible: boolean;
  eligibility: WorkflowEligibility;
  reasons: WorkflowGuardFailureReason[];
  allowlistEntry: WorkflowAllowlistEntry | null;
  verifiedWriteAttempt: WriteExecutionAttempt | null;
  matchedDecision: QaDecision | null;
  targetDocumentKind: DocumentKind | null;
  targetField: string | null;
  workflowSupport: WorkflowSupport;
}

export function evaluateWorkflowGuards(input: {
  currentDocumentKind: DocumentKind;
  crossDocumentQa: CrossDocumentQaResult;
  decisionResult: QaDecisionResult;
  writeExecutionResult: WriteExecutionResult;
  config: WorkflowExecutionConfig;
}): WorkflowGuardEvaluationResult {
  const reasons: WorkflowGuardFailureReason[] = [];
  const verifiedWriteAttempt = selectVerifiedWriteAttempt(input.writeExecutionResult);
  const candidateDecision = selectWorkflowDecision(input.decisionResult, input.currentDocumentKind);
  const targetDocumentKind =
    verifiedWriteAttempt?.targetDocumentKind ??
    candidateDecision?.proposedAction.targetDocumentKind ??
    input.currentDocumentKind;
  const targetField =
    verifiedWriteAttempt?.targetField ??
    candidateDecision?.proposedAction.targetField ??
    null;
  const matchedDecision = targetDocumentKind && targetField
    ? input.decisionResult.decisions.find((decision) =>
      decision.proposedAction.targetDocumentKind === targetDocumentKind &&
      decision.proposedAction.targetField === targetField,
    ) ?? null
    : candidateDecision;
  const allowlistEntry = getWorkflowAllowlistEntry(targetDocumentKind, targetField);
  const workflowSupport = getWorkflowSupport({
    documentKind: targetDocumentKind,
    targetField,
  });

  if (!input.config.workflowEnabled) {
    reasons.push("WORKFLOW_DISABLED");
  }

  if (!verifiedWriteAttempt) {
    reasons.push("WRITE_NOT_VERIFIED");
  }

  if (
    input.writeExecutionResult.summary.writeFailures > 0 ||
    input.writeExecutionResult.summary.verificationFailures > 0
  ) {
    reasons.push("PRECONDITION_NOT_MET");
  }

  if (verifiedWriteAttempt?.audit.bundleConfidence !== "HIGH") {
    reasons.push("LOW_BUNDLE_CONFIDENCE");
  }

  if (verifiedWriteAttempt?.audit.decisionConfidence !== "HIGH") {
    reasons.push("LOW_DECISION_CONFIDENCE");
  }

  if (
    input.config.restrictToDocumentKinds &&
    !input.config.restrictToDocumentKinds.has(input.currentDocumentKind)
  ) {
    reasons.push("UNSUPPORTED_DOCUMENT_KIND");
  }

  if (!targetDocumentKind || input.currentDocumentKind !== targetDocumentKind) {
    reasons.push("UNSUPPORTED_DOCUMENT_KIND");
    if (targetDocumentKind && input.currentDocumentKind !== targetDocumentKind) {
      reasons.push("PAGE_KIND_MISMATCH");
    }
  }

  if (!allowlistEntry) {
    reasons.push(targetDocumentKind ? "STEP_NOT_ALLOWLISTED" : "UNSUPPORTED_DOCUMENT_KIND");
  }

  switch (workflowSupport.supportLevel) {
    case "NOT_SUPPORTED":
      reasons.push("DOCUMENT_KIND_NOT_EXECUTION_READY");
      reasons.push("SUPPORT_LEVEL_BLOCKED");
      break;
    case "REVIEW_GATED":
      if (!verifiedWriteAttempt || workflowSupport.executableActions.length === 0) {
        reasons.push("SUPPORT_LEVEL_REVIEW_GATED");
        reasons.push("SUPPORT_LEVEL_BLOCKED");
      }
      break;
    case "PLANNED_ONLY":
      reasons.push("SUPPORT_LEVEL_PLANNED_ONLY");
      reasons.push("SUPPORT_LEVEL_BLOCKED");
      break;
    case "SAVE_ONLY":
    case "FULLY_SUPPORTED":
      break;
  }

  if (
    matchedDecision &&
    (matchedDecision.actionability !== "ACTIONABLE" ||
      matchedDecision.autoFixEligibility !== "SAFE_AUTOFIX_CANDIDATE")
  ) {
    reasons.push("PRECONDITION_NOT_MET");
  }

  if (matchedDecision?.humanReviewReasons.length) {
    reasons.push("HUMAN_REVIEW_STILL_REQUIRED");
  }

  if (
    matchedDecision?.humanReviewReasons.includes("SOURCE_OF_TRUTH_REVIEW_REQUIRED") ||
    matchedDecision?.humanReviewReasons.includes("MISSING_SOURCE_ANCHOR")
  ) {
    reasons.push("SOURCE_OF_TRUTH_REVIEW_REQUIRED");
  }

  if (
    matchedDecision?.humanReviewReasons.includes("EPISODE_ASSOCIATION_REVIEW_REQUIRED") ||
    matchedDecision?.humanReviewReasons.includes("EPISODE_ASSOCIATION_WEAK")
  ) {
    reasons.push("EPISODE_ASSOCIATION_REVIEW_REQUIRED");
  }

  if (
    input.crossDocumentQa.warnings.length > 0 ||
    input.decisionResult.warnings.length > 0 ||
    (matchedDecision?.evidence.warningCodes.length ?? 0) > 0
  ) {
    reasons.push("UNRESOLVED_WARNINGS_PRESENT");
  }

  if (
    verifiedWriteAttempt &&
    allowlistEntry &&
    !allowlistEntry.requiresVerifiedWriteStatuses.includes(verifiedWriteAttempt.status)
  ) {
    reasons.push("WRITE_NOT_VERIFIED");
  }

  const uniqueReasons = [...new Set(reasons)];

  return {
    eligible: uniqueReasons.length === 0,
    eligibility: uniqueReasons.length === 0
      ? "ELIGIBLE"
      : workflowSupport.supportLevel === "REVIEW_GATED" ||
          workflowSupport.supportLevel === "PLANNED_ONLY" ||
          matchedDecision?.actionability === "ACTIONABLE"
        ? "REVIEW_REQUIRED"
        : "INELIGIBLE",
    reasons: uniqueReasons,
    allowlistEntry,
    verifiedWriteAttempt,
    matchedDecision,
    targetDocumentKind,
    targetField,
    workflowSupport,
  };
}

function selectVerifiedWriteAttempt(
  result: WriteExecutionResult,
): WriteExecutionAttempt | null {
  return result.results.find((attempt) =>
    attempt.status === "VERIFIED" &&
    Boolean(attempt.targetDocumentKind) &&
    Boolean(attempt.targetField),
  ) ?? null;
}

function selectWorkflowDecision(
  result: QaDecisionResult,
  currentDocumentKind: DocumentKind,
): QaDecision | null {
  return result.decisions.find((decision) =>
    decision.proposedAction.targetDocumentKind === currentDocumentKind &&
    Boolean(decision.proposedAction.targetField),
  ) ?? result.decisions.find((decision) =>
    Boolean(decision.proposedAction.targetDocumentKind) &&
    Boolean(decision.proposedAction.targetField),
  ) ?? null;
}
