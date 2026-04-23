import { systemSupportSnapshotSchema, type SystemSupportSnapshot } from "../types/runtimeDiagnostics";
import { listWorkflowSupportMatrix } from "../workflows/workflowSupportMatrix";

export function buildSystemSupportSnapshot(): SystemSupportSnapshot {
  return systemSupportSnapshotSchema.parse({
    capturedAt: new Date().toISOString(),
    workflowSupportMatrix: listWorkflowSupportMatrix().map((entry) => ({
      documentKind: entry.documentKind ?? "UNKNOWN",
      targetField: entry.targetField,
      supportLevel: entry.supportLevel,
      allowedActions: entry.allowedActions,
      executableActions: entry.executableActions,
      reviewGatedActions: entry.reviewGatedActions,
      blockedActions: entry.blockedActions,
      reason: entry.reason,
    })),
  });
}
