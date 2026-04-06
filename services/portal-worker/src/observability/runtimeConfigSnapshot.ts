import { runtimeConfigSnapshotSchema, type RuntimeConfigSnapshot } from "../types/runtimeDiagnostics";
import { type QueueQaPipelineResolvedOptions } from "../types/queueQaPipeline";
import { type PortalSafetyConfig } from "@medical-ai-qa/shared-types";

export function buildRuntimeConfigSnapshot(
  options: QueueQaPipelineResolvedOptions,
  safety: PortalSafetyConfig,
  dangerousControlDetections = 0,
): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotSchema.parse({
    capturedAt: new Date().toISOString(),
    safetyMode: safety.safetyMode,
    readOnlyEnforced: safety.safetyMode === "READ_ONLY",
    writeMode: options.writeMode ?? null,
    workflowMode: options.workflowMode ?? null,
    writesEnabled: options.writesEnabled,
    workflowEnabled: options.workflowEnabled,
    dryRun: (options.writeMode ?? "DRY_RUN") === "DRY_RUN" && (options.workflowMode ?? "DRY_RUN") === "DRY_RUN",
    dangerousControlDetections,
    maxWritesPerRun: options.maxWritesPerRun,
    maxWorkflowStepsPerRun: options.maxWorkflowStepsPerRun,
    allowedWriteTargetFields: options.allowedWriteTargetFields ?? [],
    allowedWorkflowActions: options.allowedWorkflowActions ?? [],
    restrictWriteDocumentKinds: options.restrictWriteDocumentKinds ?? [],
    restrictWorkflowDocumentKinds: options.restrictWorkflowDocumentKinds ?? [],
    requireOperatorCheckpointFor: options.requireOperatorCheckpointFor ?? [],
  });
}
