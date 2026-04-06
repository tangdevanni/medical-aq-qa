import { type DiagnosticAction, type DiagnosticPhase, type RetryAttemptRecord } from "../types/runtimeDiagnostics";
import { type DocumentKind } from "../types/documentKinds";
import { resolveRetryDelayMs, type RetryDecision, type RetryPolicy } from "./retryPolicy";

async function sleep(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export async function withRetry<TResult>(input: {
  policy: RetryPolicy<TResult>;
  operation: string;
  execute: (attemptNumber: number) => Promise<TResult>;
  documentKind?: DocumentKind | null;
  action?: DiagnosticAction | null;
  targetField?: string | null;
  onRetryRecord?: (record: RetryAttemptRecord) => void;
}): Promise<{
  result: TResult;
  retryAttempts: RetryAttemptRecord[];
}> {
  const retryAttempts: RetryAttemptRecord[] = [];
  let lastResult: TResult | null = null;
  let lastError: unknown = null;

  for (let attemptNumber = 1; attemptNumber <= input.policy.maxAttempts; attemptNumber += 1) {
    try {
      const result = await input.execute(attemptNumber);
      lastResult = result;
      const retryDecision = input.policy.retryResult?.(result) ?? noRetry("RESULT_ACCEPTED");
      const isFinalAttempt = attemptNumber >= input.policy.maxAttempts;

      if (!retryDecision.retry || isFinalAttempt) {
        const record = buildRetryAttemptRecord({
          policyName: input.policy.name,
          operation: input.operation,
          phase: input.policy.phase,
          attemptNumber,
          maxAttempts: input.policy.maxAttempts,
          delayMs: retryDecision.retry && isFinalAttempt
            ? resolveRetryDelayMs(input.policy, attemptNumber)
            : 0,
          outcome: retryDecision.retry && isFinalAttempt ? "EXHAUSTED" : "SUCCEEDED",
          retryable: retryDecision.retry && isFinalAttempt,
          reasonCode: retryDecision.reasonCode,
          documentKind: input.documentKind ?? null,
          action: input.action ?? null,
          targetField: input.targetField ?? null,
        });
        retryAttempts.push(record);
        input.onRetryRecord?.(record);
        return { result, retryAttempts };
      }

      const delayMs = resolveRetryDelayMs(input.policy, attemptNumber);
      const record = buildRetryAttemptRecord({
        policyName: input.policy.name,
        operation: input.operation,
        phase: input.policy.phase,
        attemptNumber,
        maxAttempts: input.policy.maxAttempts,
        delayMs,
        outcome: "RETRYING",
        retryable: true,
        reasonCode: retryDecision.reasonCode,
        documentKind: input.documentKind ?? null,
        action: input.action ?? null,
        targetField: input.targetField ?? null,
      });
      retryAttempts.push(record);
      input.onRetryRecord?.(record);
      await sleep(delayMs);
    } catch (error: unknown) {
      lastError = error;
      const retryDecision = input.policy.retryError?.(error) ?? noRetry("ERROR_NOT_RETRYABLE");
      const isFinalAttempt = attemptNumber >= input.policy.maxAttempts;
      const record = buildRetryAttemptRecord({
        policyName: input.policy.name,
        operation: input.operation,
        phase: input.policy.phase,
        attemptNumber,
        maxAttempts: input.policy.maxAttempts,
        delayMs: retryDecision.retry && !isFinalAttempt
          ? resolveRetryDelayMs(input.policy, attemptNumber)
          : 0,
        outcome: retryDecision.retry && !isFinalAttempt ? "RETRYING" : "EXHAUSTED",
        retryable: retryDecision.retry && !isFinalAttempt,
        reasonCode: retryDecision.reasonCode,
        documentKind: input.documentKind ?? null,
        action: input.action ?? null,
        targetField: input.targetField ?? null,
      });
      retryAttempts.push(record);
      input.onRetryRecord?.(record);

      if (!retryDecision.retry || isFinalAttempt) {
        throw error;
      }

      await sleep(record.delayMs);
    }
  }

  if (lastResult !== null) {
    return { result: lastResult, retryAttempts };
  }

  throw lastError instanceof Error ? lastError : new Error("Retry policy exhausted without result.");
}

function noRetry(reasonCode: string): RetryDecision {
  return {
    retry: false,
    reasonCode,
  };
}

function buildRetryAttemptRecord(input: {
  policyName: string;
  operation: string;
  phase: DiagnosticPhase;
  attemptNumber: number;
  maxAttempts: number;
  delayMs: number;
  outcome: RetryAttemptRecord["outcome"];
  retryable: boolean;
  reasonCode: string;
  documentKind: DocumentKind | null;
  action: DiagnosticAction | null;
  targetField: string | null;
}): RetryAttemptRecord {
  return {
    timestamp: new Date().toISOString(),
    policyName: input.policyName,
    operation: input.operation,
    phase: input.phase,
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    delayMs: input.delayMs,
    outcome: input.outcome,
    retryable: input.retryable,
    reasonCode: input.reasonCode,
    documentKind: input.documentKind,
    action: input.action,
    targetField: input.targetField,
  };
}
