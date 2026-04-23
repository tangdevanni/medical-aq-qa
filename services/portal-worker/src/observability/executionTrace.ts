import { type ExecutionTraceEvent } from "../types/runtimeDiagnostics";

export function appendExecutionTrace(
  current: readonly ExecutionTraceEvent[] | undefined,
  ...events: ExecutionTraceEvent[]
): ExecutionTraceEvent[] {
  return [...(current ?? []), ...events];
}
