import {
  type FinalizeAction,
  type WorkflowCompletionResult,
  type WorkflowExecutionSummary,
  type WorkflowGuardFailureReason,
  type WorkflowMode,
  type WorkflowSupport,
  type WorkflowStepResult,
  type WorkflowWarning,
  workflowCompletionResultSchema,
  workflowExecutionSummarySchema,
} from "@medical-ai-qa/shared-types";

export function buildWorkflowWarning(code: string, message: string): WorkflowWarning {
  return { code, message };
}

export function emptyWorkflowCompletionResult(input: {
  mode?: WorkflowMode;
  documentKind?: WorkflowCompletionResult["documentKind"];
  targetField?: string | null;
  workflowSupport?: WorkflowSupport | null;
  bundleConfidence?: WorkflowCompletionResult["audit"]["bundleConfidence"];
  decisionConfidence?: WorkflowCompletionResult["audit"]["decisionConfidence"];
  sourceWriteStatus?: WorkflowCompletionResult["audit"]["sourceWriteStatus"];
} = {}): WorkflowCompletionResult {
  return workflowCompletionResultSchema.parse({
    attempted: false,
    status: "BLOCKED",
    mode: input.mode ?? "DRY_RUN",
    eligibility: "INELIGIBLE",
    documentKind: input.documentKind ?? null,
    targetField: input.targetField ?? null,
    workflowSupport: input.workflowSupport ?? null,
    plan: null,
    steps: [],
    operatorCheckpoint: null,
    guardFailures: [],
    warnings: [],
    audit: {
      executedAt: new Date().toISOString(),
      bundleConfidence: input.bundleConfidence ?? "LOW",
      decisionConfidence: input.decisionConfidence ?? "LOW",
      sourceWriteStatus: input.sourceWriteStatus ?? null,
    },
  });
}

export function buildWorkflowExecutionSummary(
  results: WorkflowCompletionResult[],
): WorkflowExecutionSummary {
  const summary = emptyWorkflowExecutionSummary();
  const guardFailureCounts: Record<string, number> = {};
  const verificationFailureCounts: Record<string, number> = {};
  const actionCounts: Record<FinalizeAction, number> = {
    SAVE_PAGE: 0,
    VALIDATE_PAGE: 0,
    LOCK_RECORD: 0,
    MARK_QA_COMPLETE: 0,
    STOP_FOR_REVIEW: 0,
  };
  const attemptsByDocumentKind: Record<string, number> = {};
  const completedByDocumentKind: Record<string, number> = {};
  const partialByDocumentKind: Record<string, number> = {};
  const reviewRequiredByDocumentKind: Record<string, number> = {};
  const blockedByDocumentKind: Record<string, number> = {};
  const failedByDocumentKind: Record<string, number> = {};
  const plannedOnlyByDocumentKind: Record<string, number> = {};
  const stepCountsByDocumentKind: Record<string, number> = {};
  const checkpointCountsByCategory: Record<string, number> = {};
  const supportLevelCounts: Record<string, number> = {};

  for (const result of results) {
    if (!result.attempted) {
      continue;
    }

    summary.workflowAttempts += 1;
    const documentKind = result.documentKind ?? "UNKNOWN";
    attemptsByDocumentKind[documentKind] = (attemptsByDocumentKind[documentKind] ?? 0) + 1;
    const supportLevel = result.workflowSupport?.supportLevel;
    if (supportLevel) {
      supportLevelCounts[supportLevel] = (supportLevelCounts[supportLevel] ?? 0) + 1;
    }

    switch (result.status) {
      case "COMPLETED":
        summary.workflowCompleted += 1;
        completedByDocumentKind[documentKind] = (completedByDocumentKind[documentKind] ?? 0) + 1;
        break;
      case "PARTIAL":
        summary.workflowPartial += 1;
        partialByDocumentKind[documentKind] = (partialByDocumentKind[documentKind] ?? 0) + 1;
        break;
      case "BLOCKED":
        summary.workflowBlocked += 1;
        blockedByDocumentKind[documentKind] = (blockedByDocumentKind[documentKind] ?? 0) + 1;
        break;
      case "FAILED":
        summary.workflowFailed += 1;
        failedByDocumentKind[documentKind] = (failedByDocumentKind[documentKind] ?? 0) + 1;
        break;
      case "REVIEW_REQUIRED":
        summary.workflowReviewRequired += 1;
        reviewRequiredByDocumentKind[documentKind] = (reviewRequiredByDocumentKind[documentKind] ?? 0) + 1;
        break;
      case "PLANNED_ONLY":
        summary.workflowPlannedOnly += 1;
        plannedOnlyByDocumentKind[documentKind] = (plannedOnlyByDocumentKind[documentKind] ?? 0) + 1;
        break;
    }

    if (result.operatorCheckpoint?.required) {
      summary.operatorCheckpointRequiredCount += 1;
      if (result.operatorCheckpoint.category) {
        checkpointCountsByCategory[result.operatorCheckpoint.category] =
          (checkpointCountsByCategory[result.operatorCheckpoint.category] ?? 0) + 1;
      }
    }

    accumulateGuardFailures(result.guardFailures, guardFailureCounts);

    for (const step of result.steps) {
      actionCounts[step.action] += 1;
      const stepKey = `${documentKind}:${step.action}`;
      stepCountsByDocumentKind[stepKey] = (stepCountsByDocumentKind[stepKey] ?? 0) + 1;
      accumulateGuardFailures(step.guardFailures, guardFailureCounts);

      if (
        step.guardFailures.includes("POST_STEP_VERIFICATION_FAILED") ||
        (step.status === "FAILED" && !step.verificationPassed)
      ) {
        verificationFailureCounts[step.action] = (verificationFailureCounts[step.action] ?? 0) + 1;
      }
    }
  }

  return workflowExecutionSummarySchema.parse({
    ...summary,
    stepCountsByAction: Object.entries(actionCounts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, count })),
    workflowAttemptsByDocumentKind: toDocumentKindCounts(attemptsByDocumentKind),
    workflowCompletedByDocumentKind: toDocumentKindCounts(completedByDocumentKind),
    workflowPartialByDocumentKind: toDocumentKindCounts(partialByDocumentKind),
    workflowReviewRequiredByDocumentKind: toDocumentKindCounts(reviewRequiredByDocumentKind),
    workflowBlockedByDocumentKind: toDocumentKindCounts(blockedByDocumentKind),
    workflowFailedByDocumentKind: toDocumentKindCounts(failedByDocumentKind),
    workflowPlannedOnlyByDocumentKind: toDocumentKindCounts(plannedOnlyByDocumentKind),
    stepCountsByDocumentKind: toDocumentStepCounts(stepCountsByDocumentKind),
    checkpointCountsByCategory: toCheckpointCategoryCounts(checkpointCountsByCategory),
    supportLevelCounts: toSupportLevelCounts(supportLevelCounts),
    topWorkflowGuardFailures: toTopCounts(guardFailureCounts),
    topVerificationFailures: toTopCounts(verificationFailureCounts),
  });
}

export function buildBlockedWorkflowStepResult(input: {
  action: FinalizeAction;
  mode: WorkflowMode;
  guardFailures: WorkflowGuardFailureReason[];
  warnings?: WorkflowWarning[];
  snapshotBefore?: WorkflowStepResult["snapshotBefore"];
  snapshotAfter?: WorkflowStepResult["snapshotAfter"];
}): WorkflowStepResult {
  return {
    action: input.action,
    status: "BLOCKED",
    mode: input.mode,
    attempted: false,
    selectorUsed: null,
    verificationPassed: false,
    guardFailures: input.guardFailures,
    warnings: input.warnings ?? input.guardFailures.map((reason) =>
      buildWorkflowWarning(reason, `Workflow step blocked by guard: ${reason}.`),
    ),
    snapshotBefore: input.snapshotBefore ?? null,
    snapshotAfter: input.snapshotAfter ?? null,
    executedAt: null,
    verifiedAt: null,
  };
}

export function buildPlannedWorkflowStepResult(input: {
  action: FinalizeAction;
  mode: WorkflowMode;
  status?: Extract<WorkflowStepResult["status"], "PLANNED" | "BLOCKED">;
  guardFailures?: WorkflowGuardFailureReason[];
  warnings?: WorkflowWarning[];
}): WorkflowStepResult {
  return {
    action: input.action,
    status: input.status ?? "PLANNED",
    mode: input.mode,
    attempted: false,
    selectorUsed: null,
    verificationPassed: false,
    guardFailures: input.guardFailures ?? [],
    warnings: input.warnings ?? [],
    snapshotBefore: null,
    snapshotAfter: null,
    executedAt: null,
    verifiedAt: null,
  };
}

function emptyWorkflowExecutionSummary(): Omit<
  WorkflowExecutionSummary,
  | "stepCountsByAction"
  | "workflowAttemptsByDocumentKind"
  | "workflowCompletedByDocumentKind"
  | "workflowPartialByDocumentKind"
  | "workflowReviewRequiredByDocumentKind"
  | "workflowBlockedByDocumentKind"
  | "workflowFailedByDocumentKind"
  | "workflowPlannedOnlyByDocumentKind"
  | "stepCountsByDocumentKind"
  | "checkpointCountsByCategory"
  | "supportLevelCounts"
  | "topWorkflowGuardFailures"
  | "topVerificationFailures"
> {
  return {
    workflowAttempts: 0,
    workflowCompleted: 0,
    workflowPartial: 0,
    workflowBlocked: 0,
    workflowFailed: 0,
    workflowReviewRequired: 0,
    workflowPlannedOnly: 0,
    operatorCheckpointRequiredCount: 0,
  };
}

function accumulateGuardFailures(
  reasons: WorkflowGuardFailureReason[],
  counts: Record<string, number>,
) {
  for (const reason of reasons) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
}

function toTopCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));
}

function toDocumentKindCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([documentKind, count]) => ({ documentKind, count }));
}

function toDocumentStepCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => {
      const [documentKind, action] = key.split(":");
      return { documentKind, action, count };
    });
}

function toCheckpointCategoryCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, count]) => ({ category, count }));
}

function toSupportLevelCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([supportLevel, count]) => ({ supportLevel, count }));
}
