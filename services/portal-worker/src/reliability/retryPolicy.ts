import { type DiagnosticPhase } from "../types/runtimeDiagnostics";

export interface RetryDecision {
  retry: boolean;
  reasonCode: string;
}

export interface RetryPolicy<TResult> {
  name: string;
  phase: DiagnosticPhase;
  maxAttempts: number;
  backoffMs: number;
  retryResult?: (result: TResult) => RetryDecision;
  retryError?: (error: unknown) => RetryDecision;
}

export const SAFE_READ_RETRY_POLICIES = {
  queueVisibleRows: {
    name: "QUEUE_VISIBLE_ROWS",
    phase: "QUEUE_PIPELINE",
    maxAttempts: 3,
    backoffMs: 200,
    retryResult: (rows: unknown[]) => ({
      retry: rows.length === 0,
      reasonCode: rows.length === 0 ? "QUEUE_ROWS_EMPTY" : "READ_STABLE",
    }),
  } satisfies RetryPolicy<unknown[]>,
  selectorResolution: {
    name: "SELECTOR_RESOLUTION",
    phase: "WORKFLOW_EXECUTION",
    maxAttempts: 3,
    backoffMs: 150,
    retryResult: (result: { status: string }) => ({
      retry: result.status === "NOT_FOUND",
      reasonCode: result.status === "NOT_FOUND" ? "SELECTOR_NOT_YET_RENDERED" : "SELECTOR_RESOLVED",
    }),
  } satisfies RetryPolicy<{ status: string }>,
  extractionRead: {
    name: "EXTRACTION_READ",
    phase: "EXTRACTION",
    maxAttempts: 2,
    backoffMs: 150,
    retryResult: (result: { ready: boolean }) => ({
      retry: !result.ready,
      reasonCode: result.ready ? "DOCUMENT_READY" : "DOCUMENT_NOT_READY",
    }),
  } satisfies RetryPolicy<{ ready: boolean }>,
  postStepVerification: {
    name: "POST_STEP_VERIFICATION",
    phase: "WORKFLOW_EXECUTION",
    maxAttempts: 2,
    backoffMs: 250,
    retryResult: (result: { verificationPassed: boolean }) => ({
      retry: !result.verificationPassed,
      reasonCode: result.verificationPassed ? "VERIFIED" : "POST_STEP_SIGNAL_MISSING",
    }),
  } satisfies RetryPolicy<{ verificationPassed: boolean }>,
} as const;

export function resolveRetryDelayMs(policy: Pick<RetryPolicy<unknown>, "backoffMs">, attemptNumber: number): number {
  return policy.backoffMs * Math.max(attemptNumber, 1);
}
