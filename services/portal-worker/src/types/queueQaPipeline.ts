import {
  type DocumentKind,
  type FinalizeAction,
  type QaQueueAvailableAction,
  type QaQueueDocumentType,
  type QueueQaAuditSummary,
  type QueueQaPipelineError,
  type QueueQaPipelineErrorCode,
  type QueueQaPipelineOptions,
  type QueueQaPipelineWarning,
  type QueueQaRowClassification,
  type QueueQaRowContext,
  type QueueQaRowProcessResult,
  type QueueQaRunOverallStatus,
  type QueueQaRunReport,
  type QueueQaRunTotals,
  type QueueQaSkipReason,
  type WorkflowMode,
  queueQaPipelineOptionsSchema,
  queueQaRunReportSchema,
} from "@medical-ai-qa/shared-types";

export type {
  QueueQaAuditSummary,
  QueueQaPipelineError,
  QueueQaPipelineErrorCode,
  QueueQaPipelineOptions,
  QueueQaPipelineWarning,
  QueueQaRowClassification,
  QueueQaRowContext,
  QueueQaRowProcessResult,
  QueueQaRunOverallStatus,
  QueueQaRunReport,
  QueueQaRunTotals,
  QueueQaSkipReason,
  WorkflowMode,
};

export { queueQaPipelineOptionsSchema, queueQaRunReportSchema };

export interface QueueRowSnapshot {
  pageNumber: number;
  rowIndex: number;
  rowFingerprint: string;
  patientDisplayNameMasked: string | null;
  documentDesc: string | null;
  type: string | null;
  date: string | null;
  physician: string | null;
  documentType: QaQueueDocumentType;
  availableActions: QaQueueAvailableAction[];
  queueUrl: string;
}

export interface NormalizedQueueRowSnapshot extends QueueRowSnapshot {
  classification: QueueQaRowClassification;
  isTargetVisitNote: boolean;
  targetReason: string | null;
  skipReason: QueueQaSkipReason | null;
}

export interface QueueQaPipelineResolvedOptions {
  startRowIndex: number;
  endRowIndex: number | undefined;
  startPage: number;
  maxRowsToScan: number;
  maxPages: number;
  maxTargetNotesToProcess: number;
  startRowFingerprint: string | undefined;
  includeNonTargetsInReport: boolean;
  captureSectionSamples: boolean;
  stopOnFirstFailure: boolean;
  revisitQueueBetweenRows: boolean;
  debug: boolean;
  resumeFromState: boolean;
  statePath: string | undefined;
  exportJsonPath: string | undefined;
  exportCsvPath: string | undefined;
  writeMode: import("@medical-ai-qa/shared-types").WriteMode | undefined;
  writesEnabled: boolean;
  maxWritesPerRun: number;
  stopOnWriteFailure: boolean;
  allowedWriteTargetFields: string[] | undefined;
  restrictWriteDocumentKinds: DocumentKind[] | undefined;
  workflowMode: WorkflowMode | undefined;
  workflowEnabled: boolean;
  allowedWorkflowActions: FinalizeAction[] | undefined;
  stopOnWorkflowFailure: boolean;
  requireOperatorCheckpointFor: FinalizeAction[] | undefined;
  restrictWorkflowDocumentKinds: DocumentKind[] | undefined;
  maxWorkflowStepsPerRun: number;
}

export interface QueueQaPipelineProcessContext {
  snapshot: NormalizedQueueRowSnapshot;
  queueContext: QueueQaRowContext;
}

export function resolveQueueQaPipelineOptions(
  input: QueueQaPipelineOptions | Record<string, unknown> | undefined,
): QueueQaPipelineResolvedOptions {
  const parsed = queueQaPipelineOptionsSchema.parse(input ?? {});
  const startRowIndex = parsed.startRowIndex ?? 0;
  const endRowIndex = parsed.endRowIndex;
  const startPage = parsed.startPage ?? 1;

  if (typeof endRowIndex === "number" && endRowIndex < startRowIndex) {
    throw new Error("Queue QA pipeline endRowIndex must be greater than or equal to startRowIndex.");
  }

  if (startPage < 1) {
    throw new Error("Queue QA pipeline startPage must be greater than or equal to 1.");
  }

  return {
    startRowIndex,
    endRowIndex,
    startPage,
    maxRowsToScan: parsed.maxRowsToScan ?? 25,
    maxPages: parsed.maxPages ?? 1,
    maxTargetNotesToProcess: parsed.maxTargetNotesToProcess ?? 10,
    startRowFingerprint: parsed.startRowFingerprint,
    includeNonTargetsInReport: parsed.includeNonTargetsInReport ?? true,
    captureSectionSamples: parsed.captureSectionSamples ?? false,
    stopOnFirstFailure: parsed.stopOnFirstFailure ?? false,
    revisitQueueBetweenRows: parsed.revisitQueueBetweenRows ?? true,
    debug: parsed.debug ?? false,
    resumeFromState: parsed.resumeFromState ?? false,
    statePath: parsed.statePath,
    exportJsonPath: parsed.exportJsonPath,
    exportCsvPath: parsed.exportCsvPath,
    writeMode: parsed.writeMode,
    writesEnabled: parsed.writesEnabled ?? false,
    maxWritesPerRun: parsed.maxWritesPerRun ?? 5,
    stopOnWriteFailure: parsed.stopOnWriteFailure ?? false,
    allowedWriteTargetFields: parsed.allowedWriteTargetFields,
    restrictWriteDocumentKinds: parsed.restrictWriteDocumentKinds,
    workflowMode: parsed.workflowMode,
    workflowEnabled: parsed.workflowEnabled ?? false,
    allowedWorkflowActions: parsed.allowedWorkflowActions,
    stopOnWorkflowFailure: parsed.stopOnWorkflowFailure ?? true,
    requireOperatorCheckpointFor: parsed.requireOperatorCheckpointFor,
    restrictWorkflowDocumentKinds: parsed.restrictWorkflowDocumentKinds,
    maxWorkflowStepsPerRun: parsed.maxWorkflowStepsPerRun ?? 3,
  };
}

export function buildQueueQaPipelineError(
  code: QueueQaPipelineErrorCode,
  message: string,
  recoverable: boolean,
): QueueQaPipelineError {
  return {
    code,
    message,
    recoverable,
  };
}
