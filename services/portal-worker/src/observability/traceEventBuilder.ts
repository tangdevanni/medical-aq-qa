import {
  type DiagnosticAction,
  type DiagnosticPhase,
  type ExecutionTraceEvent,
  type SupportDisposition,
  type TraceStatus,
} from "../types/runtimeDiagnostics";
import { type DocumentKind } from "../types/documentKinds";

export function buildTraceEvent(input: {
  phase: DiagnosticPhase;
  event: string;
  status: TraceStatus;
  documentKind?: DocumentKind | null;
  action?: DiagnosticAction | null;
  targetField?: string | null;
  selectorName?: string | null;
  supportDisposition?: SupportDisposition | null;
  detail?: string | null;
}): ExecutionTraceEvent {
  return {
    timestamp: new Date().toISOString(),
    phase: input.phase,
    event: input.event,
    status: input.status,
    documentKind: input.documentKind ?? null,
    action: input.action ?? null,
    targetField: input.targetField ?? null,
    selectorName: input.selectorName ?? null,
    supportDisposition: input.supportDisposition ?? null,
    detail: input.detail ?? null,
  };
}
