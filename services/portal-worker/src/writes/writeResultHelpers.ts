import {
  type QaDecision,
  type WriteExecutionAttempt,
  type WriteExecutionResult,
  type WriteExecutionSummary,
  type WriteExecutionWarning,
  writeExecutionResultSchema,
  writeExecutionSummarySchema,
} from "@medical-ai-qa/shared-types";

export function emptyWriteExecutionResult(): WriteExecutionResult {
  return writeExecutionResultSchema.parse({
    attempted: false,
    results: [],
    summary: {
      writeAttempts: 0,
      writesExecuted: 0,
      writesVerified: 0,
      writesBlocked: 0,
      writesSkipped: 0,
      writeFailures: 0,
      verificationFailures: 0,
      dryRunCount: 0,
      topGuardFailureReasons: [],
    },
  });
}

export function buildWriteExecutionSummary(
  attempts: WriteExecutionAttempt[],
): WriteExecutionSummary {
  const summary = emptyWriteExecutionResult().summary;
  const reasonCounts: Record<string, number> = {};

  for (const attempt of attempts) {
    summary.writeAttempts += 1;

    switch (attempt.status) {
      case "EXECUTED":
        summary.writesExecuted += 1;
        break;
      case "VERIFIED":
        summary.writesExecuted += 1;
        summary.writesVerified += 1;
        break;
      case "BLOCKED":
        summary.writesBlocked += 1;
        break;
      case "SKIPPED":
        summary.writesSkipped += 1;
        break;
      case "FAILED":
        summary.writeFailures += 1;
        break;
      case "VERIFICATION_FAILED":
        summary.writeFailures += 1;
        summary.verificationFailures += 1;
        break;
    }

    if (attempt.mode === "DRY_RUN") {
      summary.dryRunCount += 1;
    }

    for (const reason of attempt.guardFailures) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }

  return writeExecutionSummarySchema.parse({
    ...summary,
    topGuardFailureReasons: Object.entries(reasonCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([key, count]) => ({ key, count })),
  });
}

export function buildWriteExecutionResult(
  attempts: WriteExecutionAttempt[],
): WriteExecutionResult {
  return writeExecutionResultSchema.parse({
    attempted: attempts.length > 0,
    results: attempts,
    summary: buildWriteExecutionSummary(attempts),
  });
}

export function buildWriteWarning(code: string, message: string): WriteExecutionWarning {
  return { code, message };
}

export function shouldConsiderDecisionForWrite(decision: QaDecision): boolean {
  return Boolean(decision.proposedAction.targetDocumentKind && decision.proposedAction.targetField);
}
