import type {
  PatientEpisodeWorkItem,
} from "@medical-ai-qa/shared-types";
import type { BatchRecord } from "../types/batchControlPlane";
import {
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
} from "./controlPlaneViews";

type KnownArtifactContents = {
  codingInput: unknown | null;
  documentText: unknown | null;
};

type PatientViewInput = {
  batch: BatchRecord;
  summary: BatchRecord["patientRuns"][number];
  workItem: PatientEpisodeWorkItem | null;
  artifactContents: KnownArtifactContents;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function countPatientsByStatus(batch: BatchRecord) {
  const totalWorkItems = batch.parse.workItemCount || batch.patientRuns.length;
  const totalCompleted = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "COMPLETE").length;
  const totalBlocked = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "BLOCKED").length;
  const totalFailed = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "FAILED").length;
  const totalNeedsHumanReview = batch.patientRuns.filter(
    (patientRun) => patientRun.processingStatus === "NEEDS_HUMAN_REVIEW",
  ).length;
  const currentlyRunningCount = batch.patientRuns.filter((patientRun) =>
    ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      patientRun.processingStatus,
    ),
  ).length;
  const processedCount = totalCompleted + totalBlocked + totalFailed + totalNeedsHumanReview;

  return {
    totalWorkItems,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalNeedsHumanReview,
    currentlyRunningCount,
    percentComplete:
      totalWorkItems === 0 ? 0 : Math.round((processedCount / totalWorkItems) * 100),
  };
}

function toSubsidiarySummary(batch: BatchRecord) {
  return {
    subsidiaryId: batch.subsidiary.id,
    subsidiarySlug: batch.subsidiary.slug,
    subsidiaryName: batch.subsidiary.name,
  };
}

function deriveCurrentExecutionStep(batch: BatchRecord): string {
  if (batch.status === "PARSING") {
    return "PARSING_WORKBOOK";
  }

  if (batch.status === "RUNNING") {
    const activeRun = [...batch.patientRuns]
      .filter((patientRun) =>
        ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
          patientRun.processingStatus,
        ),
      )
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

function deriveDaysLeftBeforeOasisDueDate(input: PatientViewInput): number | null {
  return (
    input.workItem?.timingMetadata?.daysLeftBeforeOasisDueDate ??
    input.workItem?.timingMetadata?.daysLeft ??
    null
  );
}

function normalizeDiagnosisEntry(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const code = asString(record.code);
  const description = asString(record.description);
  const confidence = asString(record.confidence);
  if (!code && !description) {
    return null;
  }

  return {
    code,
    description,
    confidence,
  };
}

function deriveDiagnosisSummary(input: PatientViewInput) {
  const codingInput = asRecord(input.artifactContents.codingInput);
  const primaryDiagnosis = normalizeDiagnosisEntry(codingInput?.primaryDiagnosis);
  const otherDiagnoses = asArray(codingInput?.otherDiagnoses)
    .map((diagnosis) => normalizeDiagnosisEntry(diagnosis))
    .filter((diagnosis): diagnosis is NonNullable<typeof diagnosis> => diagnosis !== null);

  return {
    primaryDiagnosis,
    otherDiagnoses,
  };
}

function derivePatientStatusSummary(input: PatientViewInput, diagnosisCount: number): string {
  switch (input.summary.processingStatus) {
    case "COMPLETE":
      return diagnosisCount > 0
        ? "Diagnosis reference ready"
        : "Completed without extracted diagnoses";
    case "BLOCKED":
      return input.summary.errorSummary ?? input.summary.matchResult.note ?? "Blocked during read-only extraction";
    case "FAILED":
      return input.summary.errorSummary ?? "Read-only extraction failed";
    case "NEEDS_HUMAN_REVIEW":
      return input.summary.errorSummary ?? "Needs manual diagnosis review";
    default:
      return "Read-only extraction in progress";
  }
}

function sortPatientSummaries(patients: ReturnType<typeof toDashboardPatientSummary>[]) {
  return [...patients].sort((left, right) => {
    const leftDays = left.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
    const rightDays = right.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
    if (leftDays !== rightDays) {
      return leftDays - rightDays;
    }

    return left.patientName.localeCompare(right.patientName);
  });
}

export function toDashboardRunListItem(batch: BatchRecord) {
  const counts = countPatientsByStatus(batch);

  return {
    ...toSubsidiarySummary(batch),
    id: batch.id,
    billingPeriod: batch.billingPeriod,
    status: batch.status,
    currentExecutionStep: deriveCurrentExecutionStep(batch),
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    createdAt: batch.createdAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch),
    runMode: batch.runMode,
    rerunEnabled: batch.schedule.rerunEnabled && batch.schedule.active,
    lastRunAt: batch.schedule.lastRunAt,
    nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
  };
}

export function toDashboardPatientSummary(input: PatientViewInput) {
  const diagnosisSummary = deriveDiagnosisSummary(input);
  const diagnosisCount =
    (diagnosisSummary.primaryDiagnosis ? 1 : 0) + diagnosisSummary.otherDiagnoses.length;

  return {
    ...toSubsidiarySummary(input.batch),
    runId: input.summary.runId,
    batchId: input.batch.id,
    subsidiaryId: input.summary.subsidiaryId ?? input.batch.subsidiary.id,
    workItemId: input.summary.workItemId,
    patientName: input.summary.patientName,
    status: input.summary.processingStatus,
    executionStep: input.summary.executionStep,
    percentComplete: input.summary.progressPercent,
    startedAt: input.summary.startedAt,
    completedAt: input.summary.completedAt,
    lastUpdatedAt: input.summary.lastUpdatedAt,
    errorSummary: input.summary.errorSummary,
    retryEligible: input.summary.retryEligible,
    attemptCount: input.summary.attemptCount,
    resultBundlePath: input.summary.resultBundlePath,
    logPath: input.summary.logPath,
    batchStatusSummary: derivePatientStatusSummary(input, diagnosisCount),
    daysLeftBeforeOasisDueDate: deriveDaysLeftBeforeOasisDueDate(input),
    primaryDiagnosis: diagnosisSummary.primaryDiagnosis,
    otherDiagnoses: diagnosisSummary.otherDiagnoses,
    runMode: input.batch.runMode,
    rerunEnabled: input.batch.schedule.rerunEnabled && input.batch.schedule.active,
    lastRunAt: input.batch.schedule.lastRunAt,
    nextScheduledRunAt: input.batch.schedule.nextScheduledRunAt,
  };
}

export function toDashboardRunDetail(input: {
  batch: BatchRecord;
  patients: ReturnType<typeof toDashboardPatientSummary>[];
}) {
  const counts = countPatientsByStatus(input.batch);
  const patients = sortPatientSummaries(input.patients);

  return {
    ...toDashboardRunListItem(input.batch),
    sourceWorkbookName: input.batch.sourceWorkbook.originalFileName,
    uploadedAt: input.batch.sourceWorkbook.uploadedAt,
    canRetryBlockedPatients: input.batch.patientRuns.some((patientRun) => patientRun.retryEligible),
    canDeactivate: input.batch.schedule.active,
    patientStatusSummary: {
      ready: counts.totalCompleted,
      blocked: counts.totalBlocked,
      failed: counts.totalFailed,
      needsManualReview: counts.totalNeedsHumanReview,
      inProgress: counts.currentlyRunningCount,
    },
    patients,
  };
}

export function toDashboardPatientDetail(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);

  return {
    ...summary,
    workbookContext: {
      billingPeriod: input.workItem?.episodeContext.billingPeriod ?? null,
      workflowTypes: input.workItem?.workflowTypes ?? [],
      rawDaysLeftValues: input.workItem?.timingMetadata?.rawDaysLeftValues ?? [],
    },
  };
}

export function toDashboardPatientStatus(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);
  return {
    runId: summary.runId,
    batchId: summary.batchId,
    subsidiaryId: summary.subsidiaryId,
    subsidiarySlug: summary.subsidiarySlug,
    subsidiaryName: summary.subsidiaryName,
    patientId: summary.workItemId,
    patientName: summary.patientName,
    status: summary.status,
    executionStep: summary.executionStep,
    batchStatusSummary: summary.batchStatusSummary,
    primaryDiagnosis: summary.primaryDiagnosis,
    otherDiagnoses: summary.otherDiagnoses,
    runMode: summary.runMode,
    rerunEnabled: summary.rerunEnabled,
    lastRunAt: summary.lastRunAt,
    nextScheduledRunAt: summary.nextScheduledRunAt,
    lastUpdatedAt: summary.lastUpdatedAt,
  };
}

export function toBatchSummaryResponse(batch: BatchRecord) {
  const counts = countPatientsByStatus(batch);

  return {
    ...toSubsidiarySummary(batch),
    batchId: batch.id,
    currentBatchStatus: batch.status,
    currentExecutionStep: deriveCurrentExecutionStep(batch),
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    createdAt: batch.createdAt,
    startedAt: batch.run.requestedAt ?? batch.parse.requestedAt ?? batch.createdAt,
    completedAt: batch.run.completedAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch),
    runMode: batch.runMode,
    rerunEnabled: batch.schedule.rerunEnabled && batch.schedule.active,
    lastRunAt: batch.schedule.lastRunAt,
    nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
  };
}

export {
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
};
