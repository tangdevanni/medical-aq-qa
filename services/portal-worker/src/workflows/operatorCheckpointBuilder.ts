import {
  type FinalizeAction,
  type OperatorCheckpoint,
  type QaDecision,
  type WorkflowSupport,
} from "@medical-ai-qa/shared-types";
import { type WorkflowAllowlistEntry } from "./workflowAllowlist";
import { type WorkflowExecutionConfig } from "./workflowExecutionConfig";

export function buildOperatorCheckpoint(input: {
  action: FinalizeAction;
  allowlistEntry: WorkflowAllowlistEntry;
  config: WorkflowExecutionConfig;
  workflowSupport?: WorkflowSupport | null;
  matchedDecision?: QaDecision | null;
}): OperatorCheckpoint | null {
  const requiresCheckpoint =
    input.action === "STOP_FOR_REVIEW"
      ? input.allowlistEntry.requiresOperatorCheckpoint || input.config.requireOperatorCheckpointFor.has(input.action)
      :
    input.allowlistEntry.reviewGatedActions.includes(input.action) ||
    input.config.requireOperatorCheckpointFor.has(input.action);

  if (!requiresCheckpoint) {
    return null;
  }

  const readableAction = formatActionLabel(input.action);
  return {
    required: true,
    category: resolveCheckpointCategory(input),
    reason: buildCheckpointReason(input, readableAction),
    recommendedAction: `Operator confirm before ${readableAction.toLowerCase()}.`,
    beforeAction: input.action,
  };
}

function formatActionLabel(action: FinalizeAction): string {
  switch (action) {
    case "SAVE_PAGE":
      return "Save page";
    case "VALIDATE_PAGE":
      return "Validate page";
    case "LOCK_RECORD":
      return "Lock record";
    case "MARK_QA_COMPLETE":
      return "Mark QA complete";
    case "STOP_FOR_REVIEW":
      return "Stop for review";
  }
}

function resolveCheckpointCategory(input: {
  action: FinalizeAction;
  workflowSupport?: WorkflowSupport | null;
  matchedDecision?: QaDecision | null;
}): OperatorCheckpoint["category"] {
  if (
    input.matchedDecision?.humanReviewReasons.includes("SOURCE_OF_TRUTH_REVIEW_REQUIRED") ||
    input.matchedDecision?.humanReviewReasons.includes("MISSING_SOURCE_ANCHOR")
  ) {
    return "SOURCE_OF_TRUTH_REVIEW";
  }

  if (
    input.matchedDecision?.humanReviewReasons.includes("EPISODE_ASSOCIATION_REVIEW_REQUIRED") ||
    input.matchedDecision?.humanReviewReasons.includes("EPISODE_ASSOCIATION_WEAK")
  ) {
    return "EPISODE_ASSOCIATION_REVIEW";
  }

  switch (input.action) {
    case "VALIDATE_PAGE":
      return "PRE_VALIDATE_REVIEW";
    case "LOCK_RECORD":
      return "PRE_LOCK_REVIEW";
    case "MARK_QA_COMPLETE":
      return "PRE_QA_COMPLETE_REVIEW";
    case "SAVE_PAGE":
    case "STOP_FOR_REVIEW":
    default:
      return input.workflowSupport?.supportLevel === "PLANNED_ONLY"
        ? "DOCUMENT_KIND_REVIEW"
        : input.workflowSupport?.checkpointCategories[0] ?? "DOCUMENT_KIND_REVIEW";
  }
}

function buildCheckpointReason(input: {
  action: FinalizeAction;
  allowlistEntry: WorkflowAllowlistEntry;
  workflowSupport?: WorkflowSupport | null;
  matchedDecision?: QaDecision | null;
}, readableAction: string): string {
  if (
    input.matchedDecision?.humanReviewReasons.includes("SOURCE_OF_TRUTH_REVIEW_REQUIRED") ||
    input.matchedDecision?.humanReviewReasons.includes("MISSING_SOURCE_ANCHOR")
  ) {
    return `Source-of-truth review is required before ${readableAction.toLowerCase()} on ${input.allowlistEntry.targetDocumentKind}:${input.allowlistEntry.targetField ?? "document"}.`;
  }

  if (
    input.matchedDecision?.humanReviewReasons.includes("EPISODE_ASSOCIATION_REVIEW_REQUIRED") ||
    input.matchedDecision?.humanReviewReasons.includes("EPISODE_ASSOCIATION_WEAK")
  ) {
    return `Episode association review is required before ${readableAction.toLowerCase()} on ${input.allowlistEntry.targetDocumentKind}:${input.allowlistEntry.targetField ?? "document"}.`;
  }

  return input.workflowSupport?.reason
    ? input.workflowSupport.reason
    : `${readableAction} remains review-gated for ${input.allowlistEntry.targetDocumentKind}:${input.allowlistEntry.targetField ?? "document"}.`;
}
