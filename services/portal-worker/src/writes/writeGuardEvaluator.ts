import {
  type CrossDocumentQaConfidence,
  type QaDecision,
  type WriteEligibility,
  type WriteGuardFailureReason,
} from "@medical-ai-qa/shared-types";
import { type WriteExecutionConfig } from "./writeExecutionConfig";
import { getWriteAllowlistEntry } from "./writeAllowlist";

export interface WriteGuardEvaluationResult {
  eligible: boolean;
  eligibility: WriteEligibility;
  reasons: WriteGuardFailureReason[];
  allowlistEntry: ReturnType<typeof getWriteAllowlistEntry>;
}

export function evaluateWriteGuards(input: {
  decision: QaDecision;
  bundleConfidence: CrossDocumentQaConfidence;
  currentDocumentKind: QaDecision["proposedAction"]["targetDocumentKind"] | null;
  config: WriteExecutionConfig;
  writesAttemptedSoFar: number;
}): WriteGuardEvaluationResult {
  const { decision, bundleConfidence, currentDocumentKind, config, writesAttemptedSoFar } = input;
  const reasons: WriteGuardFailureReason[] = [];
  const allowlistEntry = getWriteAllowlistEntry(
    decision.proposedAction.targetDocumentKind,
    decision.proposedAction.targetField,
  );

  if (!config.writesEnabled) {
    reasons.push("WRITES_DISABLED");
  }

  if (writesAttemptedSoFar >= config.maxWritesPerRun) {
    reasons.push("MAX_WRITES_PER_RUN_REACHED");
  }

  if (decision.actionability !== "ACTIONABLE" || decision.autoFixEligibility !== "SAFE_AUTOFIX_CANDIDATE") {
    reasons.push("DECISION_NOT_SAFE_AUTOFIX");
  }

  if (bundleConfidence !== "HIGH") {
    reasons.push("LOW_BUNDLE_CONFIDENCE");
  }

  if (decision.confidence !== "HIGH") {
    reasons.push("LOW_DECISION_CONFIDENCE");
  }

  if (!allowlistEntry) {
    reasons.push("TARGET_FIELD_NOT_ALLOWLISTED");
  }

  if (!decision.proposedAction.targetDocumentKind || currentDocumentKind !== decision.proposedAction.targetDocumentKind) {
    reasons.push("UNSUPPORTED_DOCUMENT_KIND");
    if (decision.proposedAction.targetDocumentKind && currentDocumentKind) {
      reasons.push("PAGE_KIND_MISMATCH");
    }
  }

  if (
    decision.proposedAction.action !== "UPDATE_FIELD" ||
    decision.proposedAction.changeStrategy !== "REPLACE"
  ) {
    reasons.push("UNSUPPORTED_ACTION");
  }

  if (!decision.proposedAction.proposedValue?.trim()) {
    reasons.push("PROPOSED_VALUE_EMPTY");
  }

  if (decision.humanReviewReasons.length > 0) {
    reasons.push("DECISION_NOT_SAFE_AUTOFIX");
  }

  if (allowlistEntry && decision.proposedAction.proposedValue && decision.proposedAction.proposedValue.length > allowlistEntry.maxLength) {
    reasons.push("PROPOSED_VALUE_TOO_LONG");
  }

  if (allowlistEntry && !allowlistEntry.allowedExecutionModes.includes(config.mode)) {
    reasons.push("WRITE_MODE_NOT_ALLOWED");
  }

  if (
    allowlistEntry &&
    config.mode === "EXECUTE" &&
    !allowlistEntry.allowedExecutionModes.includes("EXECUTE")
  ) {
    reasons.push("DOCUMENT_KIND_NOT_EXECUTION_READY");
    reasons.push("SUPPORT_LEVEL_BLOCKED");
  }

  if (allowlistEntry?.requiresHighConfidence && (bundleConfidence !== "HIGH" || decision.confidence !== "HIGH")) {
    if (!reasons.includes("LOW_BUNDLE_CONFIDENCE") && bundleConfidence !== "HIGH") {
      reasons.push("LOW_BUNDLE_CONFIDENCE");
    }
    if (!reasons.includes("LOW_DECISION_CONFIDENCE") && decision.confidence !== "HIGH") {
      reasons.push("LOW_DECISION_CONFIDENCE");
    }
  }

  if (config.allowedTargetFields && decision.proposedAction.targetField && !config.allowedTargetFields.has(decision.proposedAction.targetField)) {
    reasons.push("TARGET_FIELD_NOT_ALLOWLISTED");
  }

  if (config.restrictToDocumentKinds && decision.proposedAction.targetDocumentKind && !config.restrictToDocumentKinds.has(decision.proposedAction.targetDocumentKind)) {
    reasons.push("UNSUPPORTED_DOCUMENT_KIND");
  }

  const uniqueReasons = [...new Set(reasons)];

  return {
    eligible: uniqueReasons.length === 0,
    eligibility: uniqueReasons.length === 0
      ? "ELIGIBLE"
      : decision.actionability === "ACTIONABLE"
        ? "REVIEW_REQUIRED"
        : "INELIGIBLE",
    reasons: uniqueReasons,
    allowlistEntry,
  };
}
