import { reliabilitySummarySchema, type ReliabilitySummary } from "../types/runtimeDiagnostics";
import { type QueueQaRowProcessResult } from "../types/queueQaPipeline";

export function buildReliabilitySummary(
  results: QueueQaRowProcessResult[],
): ReliabilitySummary {
  const processedResults = results.filter((result): result is Extract<QueueQaRowProcessResult, { status: "PROCESSED" }> =>
    result.status === "PROCESSED",
  );
  const extractionAttempts = results.filter((result) =>
    result.status === "PROCESSED" || result.status === "ERROR",
  ).length;
  const verifiedWrites = processedResults.reduce((total, result) =>
    total + result.writeExecutionResult.summary.writesVerified, 0);
  const executedWriteAttempts = processedResults.reduce((total, result) =>
    total + result.writeExecutionResult.summary.writesExecuted + result.writeExecutionResult.summary.writeFailures, 0);
  const verifiedWorkflowSteps = processedResults.reduce((total, result) =>
    total + result.workflowCompletionResult.steps.filter((step) => step.status === "VERIFIED").length, 0);
  const attemptedWorkflowSteps = processedResults.reduce((total, result) =>
    total + result.workflowCompletionResult.steps.filter((step) => step.attempted).length, 0);
  const blocked = processedResults.reduce((total, result) =>
    total +
    result.writeExecutionResult.summary.writesBlocked +
    result.workflowCompletionResult.steps.filter((step) => step.status === "BLOCKED").length, 0);
  const failed = processedResults.reduce((total, result) =>
    total +
    result.writeExecutionResult.summary.writeFailures +
    result.workflowCompletionResult.steps.filter((step) => step.status === "FAILED").length, 0);

  return reliabilitySummarySchema.parse({
    extractionSuccessRate: ratio(processedResults.length, extractionAttempts),
    writeVerificationRate: ratio(verifiedWrites, executedWriteAttempts),
    workflowStepVerificationRate: ratio(verifiedWorkflowSteps, attemptedWorkflowSteps),
    blockedVsFailed: {
      blocked,
      failed,
    },
    selectorMissingByDocumentKind: toCounts(
      processedResults.flatMap((result) =>
        (result.selectorHealth ?? [])
          .filter((entry) => entry.status === "MISSING")
          .map((entry) => entry.documentKind),
      ),
    ),
    ambiguousSelectorByAction: toCounts(
      processedResults.flatMap((result) =>
        (result.selectorHealth ?? [])
          .filter((entry) => entry.status === "AMBIGUOUS")
          .map((entry) => entry.action ?? "NO_ACTION"),
      ),
    ),
    driftSignalsByType: toCounts(
      processedResults.flatMap((result) => (result.driftSignals ?? []).map((signal) => signal.type)),
    ),
    supportDispositionCounts: toCounts(
      processedResults.flatMap((result) =>
        (result.supportMatrixDiagnostics ?? []).map((entry) => entry.supportDisposition),
      ),
    ),
  });
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function toCounts(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}
