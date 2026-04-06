import { type DocumentKind, type FinalizeAction, type PortalSafetyMode, type WorkflowMode } from "@medical-ai-qa/shared-types";

export interface WorkflowExecutionConfig {
  safetyMode: PortalSafetyMode;
  workflowEnabled: boolean;
  mode: WorkflowMode;
  allowedActions: Set<FinalizeAction> | null;
  stopOnFailure: boolean;
  requireOperatorCheckpointFor: Set<FinalizeAction>;
  restrictToDocumentKinds: Set<DocumentKind> | null;
  maxWorkflowStepsPerRun: number;
}

export function resolveWorkflowExecutionConfig(input: {
  safetyMode?: PortalSafetyMode;
  workflowEnabled?: boolean;
  workflowMode?: WorkflowMode;
  allowedWorkflowActions?: FinalizeAction[];
  stopOnWorkflowFailure?: boolean;
  requireOperatorCheckpointFor?: FinalizeAction[];
  restrictWorkflowDocumentKinds?: DocumentKind[];
  maxWorkflowStepsPerRun?: number;
}): WorkflowExecutionConfig {
  const safetyMode = input.safetyMode ?? "READ_ONLY";
  return {
    safetyMode,
    workflowEnabled: safetyMode === "READ_ONLY" ? false : (input.workflowEnabled ?? false),
    mode: input.workflowMode ?? "DRY_RUN",
    allowedActions: input.allowedWorkflowActions?.length
      ? new Set(input.allowedWorkflowActions)
      : null,
    stopOnFailure: input.stopOnWorkflowFailure ?? true,
    requireOperatorCheckpointFor: new Set(
      input.requireOperatorCheckpointFor ?? ["VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
    ),
    restrictToDocumentKinds: input.restrictWorkflowDocumentKinds?.length
      ? new Set(input.restrictWorkflowDocumentKinds)
      : null,
    maxWorkflowStepsPerRun: input.maxWorkflowStepsPerRun ?? 3,
  };
}
