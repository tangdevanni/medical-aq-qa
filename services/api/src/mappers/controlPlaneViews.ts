import type {
  OasisQaSummary,
  PatientRun,
  PatientRunLog,
} from "@medical-ai-qa/shared-types";
import type { BatchRecord } from "../types/batchControlPlane";

function isTerminalStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["COMPLETE", "BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(status);
}

function isActiveStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
    status,
  );
}

function deriveCurrentQaStage(summary: OasisQaSummary): string {
  const activeSection = summary.sections.find((section) => section.status !== "PASS");
  return activeSection?.label ?? "Ready For Billing";
}

function buildQaOverview(summary: OasisQaSummary) {
  return {
    overallStatus: summary.overallStatus,
    urgency: summary.urgency,
    daysInPeriod: summary.daysInPeriod,
    daysLeft: summary.daysLeft,
    blockerCount: summary.blockers.length,
    blockers: summary.blockers,
    currentQaStage: deriveCurrentQaStage(summary),
    sections: summary.sections.map((section) => ({
      key: section.key,
      label: section.label,
      status: section.status,
    })),
  };
}

function deriveBatchCounts(batch: BatchRecord) {
  const totalWorkItems = batch.parse.workItemCount || batch.patientRuns.length;
  const totalCompleted = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "COMPLETE").length;
  const totalBlocked = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "BLOCKED").length;
  const totalFailed = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "FAILED").length;
  const totalNeedsHumanReview = batch.patientRuns.filter(
    (patientRun) => patientRun.processingStatus === "NEEDS_HUMAN_REVIEW",
  ).length;
  const totalReadyForBillingPrep = batch.patientRuns.filter(
    (patientRun) => patientRun.oasisQaSummary.overallStatus === "READY_FOR_BILLING",
  ).length;
  const totalDueSoon = batch.patientRuns.filter(
    (patientRun) => patientRun.oasisQaSummary.urgency === "DUE_SOON",
  ).length;
  const totalOverdue = batch.patientRuns.filter(
    (patientRun) => patientRun.oasisQaSummary.urgency === "OVERDUE",
  ).length;
  const totalParserExceptions = batch.parse.parserExceptionCount;
  const currentlyRunningCount = batch.patientRuns.filter((patientRun) =>
    isActiveStatus(patientRun.processingStatus),
  ).length;
  const processedCount = batch.patientRuns.filter((patientRun) =>
    isTerminalStatus(patientRun.processingStatus),
  ).length;
  const percentComplete =
    totalWorkItems === 0 ? 0 : Math.round((processedCount / totalWorkItems) * 100);

  return {
    totalWorkItems,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalNeedsHumanReview,
    totalReadyForBillingPrep,
    totalDueSoon,
    totalOverdue,
    totalParserExceptions,
    currentlyRunningCount,
    processedCount,
    percentComplete,
  };
}

function deriveBatchExecutionStep(batch: BatchRecord): string {
  if (batch.status === "PARSING") {
    return "PARSING_WORKBOOK";
  }

  if (batch.status === "RUNNING") {
    const activeRun = [...batch.patientRuns]
      .filter((patientRun) => isActiveStatus(patientRun.processingStatus))
      .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))[0];

    return activeRun?.executionStep ?? "RUNNING_BATCH";
  }

  if (batch.status === "READY") {
    return "READY_TO_RUN";
  }

  if (batch.status === "FAILED") {
    return "FAILED";
  }

  if (batch.status === "COMPLETED" || batch.status === "COMPLETED_WITH_EXCEPTIONS") {
    return "COMPLETE";
  }

  return "CREATED";
}

function deriveBatchErrorSummary(batch: BatchRecord): string | null {
  return (
    batch.run.lastError ??
    batch.parse.lastError ??
    batch.patientRuns.find((patientRun) => patientRun.errorSummary)?.errorSummary ??
    null
  );
}

function sortPatients(
  patientRuns: BatchRecord["patientRuns"],
): BatchRecord["patientRuns"] {
  return [...patientRuns].sort((left, right) => {
    const urgencyRank = { OVERDUE: 0, DUE_SOON: 1, ON_TRACK: 2 } as const;
    const urgencyDelta =
      urgencyRank[left.oasisQaSummary.urgency] - urgencyRank[right.oasisQaSummary.urgency];

    if (urgencyDelta !== 0) {
      return urgencyDelta;
    }

    const leftDays = left.oasisQaSummary.daysLeft ?? Number.MAX_SAFE_INTEGER;
    const rightDays = right.oasisQaSummary.daysLeft ?? Number.MAX_SAFE_INTEGER;
    if (leftDays !== rightDays) {
      return leftDays - rightDays;
    }

    return left.patientName.localeCompare(right.patientName);
  });
}

export function toPatientRunSummary(
  batchId: string,
  patientRun: BatchRecord["patientRuns"][number],
) {
  return {
    runId: patientRun.runId,
    batchId,
    workItemId: patientRun.workItemId,
    patientName: patientRun.patientName,
    status: patientRun.processingStatus,
    executionStep: patientRun.executionStep,
    percentComplete: patientRun.progressPercent,
    startedAt: patientRun.startedAt,
    completedAt: patientRun.completedAt,
    lastUpdatedAt: patientRun.lastUpdatedAt,
    matchResult: patientRun.matchResult,
    qaOutcome: patientRun.qaOutcome,
    oasisQaSummary: patientRun.oasisQaSummary,
    ...buildQaOverview(patientRun.oasisQaSummary),
    artifactCount: patientRun.artifactCount,
    findingsAvailable: patientRun.hasFindings,
    bundleAvailable: patientRun.bundleAvailable,
    logAvailable: patientRun.logAvailable,
    retryEligible: patientRun.retryEligible,
    errorSummary: patientRun.errorSummary,
    attemptCount: patientRun.attemptCount,
    logPath: patientRun.logPath,
    resultBundlePath: patientRun.resultBundlePath,
  };
}

export function toBatchListItem(batch: BatchRecord) {
  const counts = deriveBatchCounts(batch);

  return {
    id: batch.id,
    billingPeriod: batch.billingPeriod,
    status: batch.status,
    currentExecutionStep: deriveBatchExecutionStep(batch),
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    totalReadyForBillingPrep: counts.totalReadyForBillingPrep,
    totalDueSoon: counts.totalDueSoon,
    totalOverdue: counts.totalOverdue,
    totalParserExceptions: counts.totalParserExceptions,
    createdAt: batch.createdAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch),
    patients: sortPatients(batch.patientRuns).map((patientRun) =>
      toPatientRunSummary(batch.id, patientRun),
    ),
  };
}

export function toBatchDetail(batch: BatchRecord) {
  const listItem = toBatchListItem(batch);

  return {
    ...listItem,
    sourceWorkbook: {
      acquisitionProvider: batch.sourceWorkbook.acquisitionProvider,
      acquisitionStatus: batch.sourceWorkbook.acquisitionStatus,
      acquisitionReference: batch.sourceWorkbook.acquisitionReference,
      acquisitionNotes: batch.sourceWorkbook.acquisitionNotes,
      acquisitionMetadata: batch.sourceWorkbook.acquisitionMetadata,
      originalFileName: batch.sourceWorkbook.originalFileName,
      storedPath: batch.sourceWorkbook.storedPath,
      uploadedAt: batch.sourceWorkbook.uploadedAt,
      verification: batch.sourceWorkbook.verification,
    },
    timestamps: {
      createdAt: batch.createdAt,
      lastUpdatedAt: batch.updatedAt,
      parseRequestedAt: batch.parse.requestedAt,
      parseCompletedAt: batch.parse.completedAt,
      runRequestedAt: batch.run.requestedAt,
      runCompletedAt: batch.run.completedAt,
    },
    artifactPaths: {
      batchRoot: batch.storage.batchRoot,
      outputRoot: batch.storage.outputRoot,
      manifestPath: batch.storage.manifestPath,
      workItemsPath: batch.storage.workItemsPath,
      parserExceptionsPath: batch.storage.parserExceptionsPath,
      batchSummaryPath: batch.storage.batchSummaryPath,
      patientResultsDirectory: batch.storage.patientResultsDirectory,
      evidenceDirectory: batch.storage.evidenceDirectory,
    },
    actions: {
      canParse: batch.status === "CREATED" || batch.status === "FAILED",
      canRun: ["READY", "COMPLETED", "COMPLETED_WITH_EXCEPTIONS", "FAILED"].includes(batch.status),
      canRetryBlockedPatients: batch.patientRuns.some((patientRun) => patientRun.retryEligible),
    },
  };
}

export function toBatchDetailWithPatients(batch: BatchRecord) {
  return {
    ...toBatchDetail(batch),
    patients: sortPatients(batch.patientRuns).map((patientRun) =>
      toPatientRunSummary(batch.id, patientRun),
    ),
  };
}

export function toBatchSummaryResponse(batch: BatchRecord) {
  const counts = deriveBatchCounts(batch);

  return {
    batchId: batch.id,
    currentBatchStatus: batch.status,
    currentExecutionStep: deriveBatchExecutionStep(batch),
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    totalReadyForBillingPrep: counts.totalReadyForBillingPrep,
    totalDueSoon: counts.totalDueSoon,
    totalOverdue: counts.totalOverdue,
    totalParserExceptions: counts.totalParserExceptions,
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    createdAt: batch.createdAt,
    startedAt: batch.run.requestedAt ?? batch.parse.requestedAt ?? batch.createdAt,
    completedAt: batch.run.completedAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch),
  };
}

export function toPatientRunDetail(
  batchId: string,
  patientRunSummary: BatchRecord["patientRuns"][number],
  patientRunDetail: PatientRun | null,
) {
  const summary = toPatientRunSummary(batchId, patientRunSummary);

  return {
    ...summary,
    oasisQaSummary: patientRunDetail?.oasisQaSummary ?? patientRunSummary.oasisQaSummary,
    artifacts: patientRunDetail?.artifacts ?? [],
    findings: patientRunDetail?.findings ?? [],
    notes: patientRunDetail?.notes ?? [],
    auditArtifacts: patientRunDetail?.auditArtifacts ?? {
      tracePath: patientRunSummary.tracePath,
      screenshotPaths: patientRunSummary.screenshotPaths,
      downloadPaths: patientRunSummary.downloadPaths,
    },
    workItemSnapshot: patientRunDetail?.workItemSnapshot ?? null,
  };
}

export function toPatientRunFindingsResponse(
  batchId: string,
  patientRunSummary: BatchRecord["patientRuns"][number],
  patientRunDetail: PatientRun | null,
) {
  const summary = toPatientRunSummary(batchId, patientRunSummary);

  return {
    runId: summary.runId,
    batchId: summary.batchId,
    patientName: summary.patientName,
    status: summary.status,
    qaOutcome: summary.qaOutcome,
    findingsAvailable: summary.findingsAvailable,
    lastUpdatedAt: summary.lastUpdatedAt,
    findings: patientRunDetail?.findings ?? [],
  };
}

export function toPatientRunLogResponse(input: {
  batchId: string;
  patientRunSummary: BatchRecord["patientRuns"][number];
  log: PatientRunLog | null;
}) {
  const summary = toPatientRunSummary(input.batchId, input.patientRunSummary);

  return {
    runId: summary.runId,
    batchId: summary.batchId,
    patientId: summary.workItemId,
    patientName: summary.patientName,
    status: summary.status,
    logAvailable: Boolean(input.log),
    logPath: summary.logPath,
    log: input.log,
  };
}

export function toPatientArtifactsResponse(input: {
  batchId: string;
  patientRunSummary: BatchRecord["patientRuns"][number];
  artifacts: Array<{
    kind:
      | "bundle"
      | "log"
      | "failure_trace"
      | "failure_screenshot"
      | "download"
      | "evidence"
      | "workflow_result"
      | "workflow_log";
    name: string;
    path: string;
    exists: boolean;
    modifiedAt: string | null;
    sizeBytes: number | null;
  }>;
}) {
  const summary = toPatientRunSummary(input.batchId, input.patientRunSummary);

  return {
    runId: summary.runId,
    batchId: summary.batchId,
    patientId: summary.workItemId,
    patientName: summary.patientName,
    artifacts: input.artifacts,
  };
}
