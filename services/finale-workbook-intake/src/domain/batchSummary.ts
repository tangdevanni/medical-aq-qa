import type {
  BatchManifest,
  BatchStatus,
  BatchSummary,
  ParserException,
  PatientRun,
} from "@medical-ai-qa/shared-types";

function deriveBatchStatus(
  patientRuns: PatientRun[],
  parserExceptions: ParserException[],
): BatchStatus {
  if (patientRuns.some((run) => run.processingStatus === "FAILED")) {
    return "FAILED";
  }

  if (parserExceptions.length > 0 || patientRuns.some((run) => run.processingStatus === "NEEDS_HUMAN_REVIEW")) {
    return "COMPLETED_WITH_EXCEPTIONS";
  }

  return "COMPLETED";
}

export function buildBatchSummary(input: {
  manifest: BatchManifest;
  parserExceptions: ParserException[];
  patientRuns: PatientRun[];
  startedAt: string;
  completedAt: string;
}): BatchSummary {
  const { manifest, parserExceptions, patientRuns, startedAt, completedAt } = input;
  const completeCount = patientRuns.filter((run) => run.processingStatus === "COMPLETE").length;
  const blockedCount = patientRuns.filter((run) => run.processingStatus === "BLOCKED").length;
  const failedCount = patientRuns.filter((run) => run.processingStatus === "FAILED").length;
  const needsHumanReviewCount = patientRuns.filter(
    (run) => run.processingStatus === "NEEDS_HUMAN_REVIEW",
  ).length;
  const currentlyRunningCount = patientRuns.filter((run) =>
    ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      run.processingStatus,
    ),
  ).length;
  const percentComplete =
    manifest.totalWorkItems === 0
      ? 100
      : Math.round((patientRuns.length / manifest.totalWorkItems) * 100);

  return {
    batchId: manifest.batchId,
    status: deriveBatchStatus(patientRuns, parserExceptions),
    startedAt,
    completedAt,
    lastUpdatedAt: completedAt,
    totalWorkItems: manifest.totalWorkItems,
    automationEligible: manifest.automationEligibleWorkItemIds.length,
    processed: patientRuns.length,
    totalCompleted: completeCount,
    totalBlocked: blockedCount,
    totalFailed: failedCount,
    totalNeedsHumanReview: needsHumanReviewCount,
    totalReadyForBillingPrep: patientRuns.filter(
      (run) => run.qaOutcome === "READY_FOR_BILLING_PREP",
    ).length,
    totalParserExceptions: parserExceptions.length,
    percentComplete,
    currentlyRunningCount,
    currentBatchStatus: deriveBatchStatus(patientRuns, parserExceptions),
    complete: completeCount,
    blocked: blockedCount,
    failed: failedCount,
    needsHumanReview: needsHumanReviewCount,
    parserExceptions: parserExceptions.length,
    qaOutcomes: {
      READY_FOR_BILLING_PREP: patientRuns.filter((run) => run.qaOutcome === "READY_FOR_BILLING_PREP").length,
      INCOMPLETE: patientRuns.filter((run) => run.qaOutcome === "INCOMPLETE").length,
      MISSING_DOCUMENTS: patientRuns.filter((run) => run.qaOutcome === "MISSING_DOCUMENTS").length,
      PORTAL_NOT_FOUND: patientRuns.filter((run) => run.qaOutcome === "PORTAL_NOT_FOUND").length,
      PORTAL_MISMATCH: patientRuns.filter((run) => run.qaOutcome === "PORTAL_MISMATCH").length,
      AMBIGUOUS_PATIENT: patientRuns.filter((run) => run.qaOutcome === "AMBIGUOUS_PATIENT").length,
      NEEDS_MANUAL_QA: patientRuns.filter((run) => run.qaOutcome === "NEEDS_MANUAL_QA").length,
    },
    patientRuns: patientRuns.map((run) => ({
      workItemId: run.workItemId,
      patientName: run.patientName,
      processingStatus: run.processingStatus,
      executionStep: run.executionStep,
      progressPercent: run.progressPercent,
      qaOutcome: run.qaOutcome,
      errorSummary: run.errorSummary,
      resultBundlePath: run.resultBundlePath,
    })),
  };
}
