import {
  type QueueQaAuditSummary,
  type QueueQaPipelineWarning,
  type QueueQaRowProcessResult,
  type QueueQaRunOverallStatus,
  type QueueQaRunReport,
  type QueueQaRunTotals,
  queueQaRunReportSchema,
} from "../types/queueQaPipeline";
import { buildQaDecisionRunSummary } from "../decisions/decisionSummaryBuilder";
import { type QaDecision, type WriteExecutionAttempt } from "@medical-ai-qa/shared-types";
import { buildReliabilitySummary } from "../observability/reliabilitySummaryBuilder";
import { collectRunDiagnostics } from "../observability/runDiagnosticsCollector";
import { buildSystemSupportSnapshot } from "../observability/systemSupportSnapshot";
import { type RuntimeConfigSnapshot } from "../types/runtimeDiagnostics";
import { buildWriteExecutionSummary } from "../writes/writeResultHelpers";
import { buildWorkflowExecutionSummary } from "../workflows/workflowResultHelpers";

export function buildQueueQaRunTotals(results: QueueQaRowProcessResult[]): QueueQaRunTotals {
  const totals: QueueQaRunTotals = {
    rowsScanned: results.length,
    targetsDetected: 0,
    notesProcessed: 0,
    skipped: 0,
    errors: 0,
    pass: 0,
    fail: 0,
    needsReview: 0,
    decisions: 0,
    actionableDecisions: 0,
    reviewOnlyDecisions: 0,
    notActionableDecisions: 0,
    safeAutofixCandidates: 0,
    manualReviewRequired: 0,
    writeAttempts: 0,
    writesExecuted: 0,
    writesVerified: 0,
    writesBlocked: 0,
    writesSkipped: 0,
    writeFailures: 0,
    verificationFailures: 0,
    dryRunCount: 0,
    workflowAttempts: 0,
    workflowCompleted: 0,
    workflowPartial: 0,
    workflowBlocked: 0,
    workflowFailed: 0,
    workflowReviewRequired: 0,
    workflowPlannedOnly: 0,
    operatorCheckpointRequiredCount: 0,
  };

  for (const result of results) {
    if (result.classification.isTarget) {
      totals.targetsDetected += 1;
    }

    if (result.status === "PROCESSED") {
      totals.notesProcessed += 1;
      totals.decisions += result.decisionResult.decisions.length;
      totals.actionableDecisions += result.decisionResult.summary.actionableCount;
      totals.reviewOnlyDecisions += result.decisionResult.summary.reviewOnlyCount;
      totals.notActionableDecisions += result.decisionResult.summary.notActionableCount;
      totals.safeAutofixCandidates += result.decisionResult.summary.safeAutofixCandidateCount;
      totals.manualReviewRequired += result.decisionResult.summary.manualReviewRequiredCount;
      totals.writeAttempts += result.writeExecutionResult.summary.writeAttempts;
      totals.writesExecuted += result.writeExecutionResult.summary.writesExecuted;
      totals.writesVerified += result.writeExecutionResult.summary.writesVerified;
      totals.writesBlocked += result.writeExecutionResult.summary.writesBlocked;
      totals.writesSkipped += result.writeExecutionResult.summary.writesSkipped;
      totals.writeFailures += result.writeExecutionResult.summary.writeFailures;
      totals.verificationFailures += result.writeExecutionResult.summary.verificationFailures;
      totals.dryRunCount += result.writeExecutionResult.summary.dryRunCount;
      if (result.workflowCompletionResult.attempted) {
        totals.workflowAttempts += 1;
        totals.workflowCompleted += result.workflowCompletionResult.status === "COMPLETED" ? 1 : 0;
        totals.workflowPartial += result.workflowCompletionResult.status === "PARTIAL" ? 1 : 0;
        totals.workflowBlocked += result.workflowCompletionResult.status === "BLOCKED" ? 1 : 0;
        totals.workflowFailed += result.workflowCompletionResult.status === "FAILED" ? 1 : 0;
        totals.workflowReviewRequired += result.workflowCompletionResult.status === "REVIEW_REQUIRED" ? 1 : 0;
        totals.workflowPlannedOnly += result.workflowCompletionResult.status === "PLANNED_ONLY" ? 1 : 0;
        totals.operatorCheckpointRequiredCount += result.workflowCompletionResult.operatorCheckpoint?.required ? 1 : 0;
      }

      if (result.qaResult) {
        switch (result.qaResult.summary.overallStatus) {
          case "PASS":
            totals.pass += 1;
            break;
          case "FAIL":
            totals.fail += 1;
            break;
          case "NEEDS_REVIEW":
            totals.needsReview += 1;
            break;
        }
      }

      continue;
    }

    if (result.status === "SKIPPED") {
      totals.skipped += 1;
      continue;
    }

    totals.errors += 1;
  }

  return totals;
}

export function deriveQueueQaRunOverallStatus(
  totals: Pick<QueueQaRunTotals, "rowsScanned" | "targetsDetected" | "notesProcessed" | "errors">,
): QueueQaRunOverallStatus {
  if (totals.rowsScanned === 0) {
    return "FAILURE";
  }

  if (totals.targetsDetected > 0 && totals.notesProcessed === 0 && totals.errors > 0) {
    return "FAILURE";
  }

  if (totals.errors === 0) {
    return "SUCCESS";
  }

  return "PARTIAL_SUCCESS";
}

export function summarizeQueueQaRuleOutcomes(
  results: QueueQaRowProcessResult[],
): QueueQaRunReport["qaStatusBreakdown"] {
  const totals = buildQueueQaRunTotals(results);

  return {
    pass: totals.pass,
    fail: totals.fail,
    needsReview: totals.needsReview,
  };
}

export function buildQueueQaAuditSummary(
  report: Pick<QueueQaRunReport, "totals" | "pagesProcessed">,
): QueueQaAuditSummary {
  return {
    rowsScanned: report.totals.rowsScanned,
    targetsDetected: report.totals.targetsDetected,
    processed: report.totals.notesProcessed,
    skipped: report.totals.skipped,
    pagesProcessed: report.pagesProcessed,
    fail: report.totals.fail,
    needsReview: report.totals.needsReview,
    errors: report.totals.errors,
    decisionCount: report.totals.decisions,
    actionableDecisionCount: report.totals.actionableDecisions,
    reviewOnlyDecisionCount: report.totals.reviewOnlyDecisions,
    safeAutofixCandidateCount: report.totals.safeAutofixCandidates,
    manualReviewRequiredCount: report.totals.manualReviewRequired,
    writeAttemptCount: report.totals.writeAttempts,
    writeVerifiedCount: report.totals.writesVerified,
    writeBlockedCount: report.totals.writesBlocked,
    writeFailureCount: report.totals.writeFailures,
    workflowAttemptCount: report.totals.workflowAttempts,
    workflowCompletedCount: report.totals.workflowCompleted,
    workflowBlockedCount: report.totals.workflowBlocked,
    workflowFailedCount: report.totals.workflowFailed,
    operatorCheckpointRequiredCount: report.totals.operatorCheckpointRequiredCount,
  };
}

export function finalizeQueueQaRunReport(input: {
  runId: string;
  startedAt: string;
  completedAt: string;
  queueUrl: string;
  pagesProcessed: number;
  resumeUsed: boolean;
  options: QueueQaRunReport["options"];
  results: QueueQaRowProcessResult[];
  totalSourceResults?: QueueQaRowProcessResult[];
  warnings?: QueueQaPipelineWarning[];
  exportArtifacts: QueueQaRunReport["exportArtifacts"];
  dedupe: QueueQaRunReport["dedupe"];
  runtimeConfigSnapshot?: RuntimeConfigSnapshot;
}): QueueQaRunReport {
  const totalSourceResults = input.totalSourceResults ?? input.results;
  const totals = buildQueueQaRunTotals(totalSourceResults);
  const allDecisions = totalSourceResults.flatMap((result): QaDecision[] => {
    if (result.status === "PROCESSED") {
      return result.decisionResult.decisions;
    }

    return [];
  });
  const allWriteAttempts = totalSourceResults.flatMap((result): WriteExecutionAttempt[] => {
    if (result.status === "PROCESSED") {
      return result.writeExecutionResult.results;
    }

    return [];
  });
  const allWorkflowResults = totalSourceResults.flatMap((result) => {
    if (result.status === "PROCESSED") {
      return [result.workflowCompletionResult];
    }

    return [];
  });
  const runDiagnostics = collectRunDiagnostics(totalSourceResults);

  return queueQaRunReportSchema.parse({
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    queueUrl: input.queueUrl,
    pagesProcessed: input.pagesProcessed,
    resumeUsed: input.resumeUsed,
    options: input.options,
    totals,
    results: input.results,
    warnings: input.warnings ?? [],
    overallStatus: deriveQueueQaRunOverallStatus(totals),
    qaStatusBreakdown: summarizeQueueQaRuleOutcomes(totalSourceResults),
    decisionSummary: buildQaDecisionRunSummary(allDecisions),
    writeSummary: buildWriteExecutionSummary(allWriteAttempts),
    workflowSummary: buildWorkflowExecutionSummary(allWorkflowResults),
    diagnosticsSummary: runDiagnostics.diagnosticsSummary,
    reliabilitySummary: buildReliabilitySummary(totalSourceResults),
    selectorHealthSummary: runDiagnostics.selectorHealthSummary,
    driftSignalSummary: runDiagnostics.driftSignalSummary,
    traceStats: runDiagnostics.traceStats,
    runtimeConfigSnapshot: input.runtimeConfigSnapshot,
    systemSupportSnapshot: buildSystemSupportSnapshot(),
    exportArtifacts: input.exportArtifacts,
    dedupe: input.dedupe,
  });
}
