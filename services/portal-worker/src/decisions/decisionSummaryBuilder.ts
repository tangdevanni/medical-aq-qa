import {
  type QaDecision,
  type QaDecisionResult,
  type QaDecisionRunCount,
  type QaDecisionRunSummary,
  qaDecisionRunSummarySchema,
} from "@medical-ai-qa/shared-types";
import { emptyQaDecisionResult } from "./decisionShared";

export function buildQaDecisionSummary(
  decisions: QaDecision[],
): QaDecisionResult["summary"] {
  const base = emptyQaDecisionResult().summary;
  const issuesByType: Record<string, number> = {};
  const decisionsByTargetDocument: Record<string, number> = {};

  for (const decision of decisions) {
    switch (decision.actionability) {
      case "ACTIONABLE":
        base.actionableCount += 1;
        break;
      case "REVIEW_ONLY":
        base.reviewOnlyCount += 1;
        break;
      case "NOT_ACTIONABLE":
        base.notActionableCount += 1;
        break;
    }

    if (decision.autoFixEligibility === "SAFE_AUTOFIX_CANDIDATE") {
      base.safeAutofixCandidateCount += 1;
    }

    if (decision.autoFixEligibility === "MANUAL_REVIEW_REQUIRED") {
      base.manualReviewRequiredCount += 1;
    }

    issuesByType[decision.issueType] = (issuesByType[decision.issueType] ?? 0) + 1;

    const targetDocumentKind = decision.proposedAction.targetDocumentKind ?? "UNSPECIFIED";
    decisionsByTargetDocument[targetDocumentKind] = (decisionsByTargetDocument[targetDocumentKind] ?? 0) + 1;
  }

  return {
    ...base,
    issuesByType,
    decisionsByTargetDocument,
  };
}

export function buildQaDecisionRunSummary(
  decisions: QaDecision[],
): QaDecisionRunSummary {
  const rowSummary = buildQaDecisionSummary(decisions);

  return qaDecisionRunSummarySchema.parse({
    totalDecisions: decisions.length,
    actionableCount: rowSummary.actionableCount,
    reviewOnlyCount: rowSummary.reviewOnlyCount,
    notActionableCount: rowSummary.notActionableCount,
    safeAutofixCandidateCount: rowSummary.safeAutofixCandidateCount,
    manualReviewRequiredCount: rowSummary.manualReviewRequiredCount,
    topIssueTypes: buildTopCounts(rowSummary.issuesByType),
    topTargetDocumentKinds: buildTopCounts(rowSummary.decisionsByTargetDocument),
  });
}

function buildTopCounts(
  counts: Record<string, number>,
): QaDecisionRunCount[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));
}
