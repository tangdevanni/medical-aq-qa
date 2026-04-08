import { z } from "zod";
import { crossDocumentQaResultSchema } from "./cross-document-qa";
import { documentExtractionSchema } from "./document-extraction";
import { qaQueueAvailableActionSchema, qaQueueDocumentTypeSchema } from "./portal-observation";
import { qaDecisionResultSchema, qaDecisionRunSummarySchema } from "./qa-decision";
import { reliabilitySnapshotSchema } from "./reliability-intelligence";
import {
  diagnosticsSummarySchema,
  driftSignalSchema,
  driftSignalSummarySchema,
  executionTraceEventSchema,
  reliabilitySummarySchema,
  retryAttemptRecordSchema,
  runtimeConfigSnapshotSchema,
  runtimeDiagnosticSchema,
  selectorHealthRecordSchema,
  selectorHealthSummarySchema,
  supportMatrixDiagnosticSchema,
  systemSupportSnapshotSchema,
  traceStatsSchema,
} from "./runtime-diagnostics";
import { visitNoteQaReportSchema, visitNoteQaStatusSchema } from "./visit-note-qa";
import {
  finalizeActionSchema,
  workflowCompletionResultSchema,
  workflowExecutionSummarySchema,
  workflowModeSchema,
  workflowSupportSchema,
} from "./workflow-completion";
import { writeExecutionResultSchema, writeModeSchema } from "./write-execution";

export const queueQaClassificationConfidenceSchema = z.enum(["high", "medium", "low"]);

export type QueueQaClassificationConfidence = z.infer<typeof queueQaClassificationConfidenceSchema>;

export const queueQaSkipReasonSchema = z.enum([
  "NON_TARGET_DOCUMENT_TYPE",
  "NON_TARGET_URL",
  "NON_TARGET_DETAIL_PAGE",
  "INSUFFICIENT_TARGET_EVIDENCE",
  "ALREADY_PROCESSED_FINGERPRINT",
]);

export type QueueQaSkipReason = z.infer<typeof queueQaSkipReasonSchema>;

export const queueQaPipelineErrorCodeSchema = z.enum([
  "QUEUE_LOAD_FAILED",
  "ROW_PARSE_FAILED",
  "ROW_ACTION_NOT_FOUND",
  "ROW_REACQUIRE_FAILED",
  "NOTE_OPEN_FAILED",
  "NOTE_PAGE_VALIDATION_FAILED",
  "EXTRACTION_FAILED",
  "RETURN_TO_QUEUE_FAILED",
]);

export type QueueQaPipelineErrorCode = z.infer<typeof queueQaPipelineErrorCodeSchema>;

export const queueQaRunOverallStatusSchema = z.enum(["SUCCESS", "PARTIAL_SUCCESS", "FAILURE"]);

export type QueueQaRunOverallStatus = z.infer<typeof queueQaRunOverallStatusSchema>;

export const queueQaPipelineOptionsSchema = z.object({
  startRowIndex: z.number().int().nonnegative().optional(),
  endRowIndex: z.number().int().nonnegative().optional(),
  startPage: z.number().int().positive().optional(),
  maxRowsToScan: z.number().int().positive().optional(),
  maxPages: z.number().int().positive().optional(),
  maxTargetNotesToProcess: z.number().int().positive().optional(),
  startRowFingerprint: z.string().min(1).optional(),
  includeNonTargetsInReport: z.boolean().optional(),
  captureSectionSamples: z.boolean().optional(),
  stopOnFirstFailure: z.boolean().optional(),
  revisitQueueBetweenRows: z.boolean().optional(),
  debug: z.boolean().optional(),
  resumeFromState: z.boolean().optional(),
  statePath: z.string().min(1).optional(),
  exportJsonPath: z.string().min(1).optional(),
  exportCsvPath: z.string().min(1).optional(),
  writeMode: writeModeSchema.optional(),
  writesEnabled: z.boolean().optional(),
  maxWritesPerRun: z.number().int().positive().optional(),
  stopOnWriteFailure: z.boolean().optional(),
  allowedWriteTargetFields: z.array(z.string().min(1)).optional(),
  restrictWriteDocumentKinds: z.array(documentExtractionSchema.shape.documentKind).optional(),
  workflowMode: workflowModeSchema.optional(),
  workflowEnabled: z.boolean().optional(),
  allowedWorkflowActions: z.array(finalizeActionSchema).optional(),
  stopOnWorkflowFailure: z.boolean().optional(),
  requireOperatorCheckpointFor: z.array(finalizeActionSchema).optional(),
  restrictWorkflowDocumentKinds: z.array(documentExtractionSchema.shape.documentKind).optional(),
  maxWorkflowStepsPerRun: z.number().int().positive().optional(),
});

export type QueueQaPipelineOptions = z.infer<typeof queueQaPipelineOptionsSchema>;

export const queueQaRowClassificationSchema = z.object({
  isTarget: z.boolean(),
  confidence: queueQaClassificationConfidenceSchema,
  reason: z.string().min(1),
});

export type QueueQaRowClassification = z.infer<typeof queueQaRowClassificationSchema>;

export const queueQaRowContextSchema = z.object({
  pageNumber: z.number().int().positive(),
  patientDisplayNameMasked: z.string().min(1).nullable().optional(),
  documentDesc: z.string().min(1).nullable(),
  type: z.string().min(1).nullable(),
  date: z.string().min(1).nullable(),
  physician: z.string().min(1).nullable(),
  documentType: qaQueueDocumentTypeSchema,
  availableActions: z.array(qaQueueAvailableActionSchema),
  queueUrl: z.string().min(1),
});

export type QueueQaRowContext = z.infer<typeof queueQaRowContextSchema>;

export const queueQaOpenResultSchema = z.object({
  success: z.boolean(),
  openedUrl: z.string().min(1).nullable(),
  openedInNewTab: z.boolean(),
});

export type QueueQaOpenResult = z.infer<typeof queueQaOpenResultSchema>;

export const queueQaPipelineErrorSchema = z.object({
  code: queueQaPipelineErrorCodeSchema,
  message: z.string().min(1),
  recoverable: z.boolean(),
});

export type QueueQaPipelineError = z.infer<typeof queueQaPipelineErrorSchema>;

const queueQaRowResultBaseSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  rowFingerprint: z.string().min(1),
  classification: queueQaRowClassificationSchema,
  queueContext: queueQaRowContextSchema,
  runtimeDiagnostics: z.array(runtimeDiagnosticSchema).optional(),
  selectorHealth: z.array(selectorHealthRecordSchema).optional(),
  driftSignals: z.array(driftSignalSchema).optional(),
  retryAttempts: z.array(retryAttemptRecordSchema).optional(),
  executionTrace: z.array(executionTraceEventSchema).optional(),
  supportMatrixDiagnostics: z.array(supportMatrixDiagnosticSchema).optional(),
});

export const queueQaProcessedRowResultSchema = queueQaRowResultBaseSchema.extend({
  openResult: queueQaOpenResultSchema.extend({
    success: z.literal(true),
  }),
  documentExtraction: documentExtractionSchema,
  crossDocumentQa: crossDocumentQaResultSchema,
  qaResult: visitNoteQaReportSchema.nullable(),
  decisionResult: qaDecisionResultSchema,
  writeExecutionResult: writeExecutionResultSchema,
  workflowSupport: workflowSupportSchema,
  workflowCompletionResult: workflowCompletionResultSchema,
  status: z.literal("PROCESSED"),
});

export type QueueQaProcessedRowResult = z.infer<typeof queueQaProcessedRowResultSchema>;

export const queueQaSkippedRowResultSchema = queueQaRowResultBaseSchema.extend({
  openResult: queueQaOpenResultSchema.optional(),
  documentExtraction: documentExtractionSchema.optional(),
  crossDocumentQa: crossDocumentQaResultSchema.optional(),
  decisionResult: qaDecisionResultSchema.optional(),
  writeExecutionResult: writeExecutionResultSchema.optional(),
  workflowSupport: workflowSupportSchema.optional(),
  workflowCompletionResult: workflowCompletionResultSchema.optional(),
  status: z.literal("SKIPPED"),
  skipReason: queueQaSkipReasonSchema,
});

export type QueueQaSkippedRowResult = z.infer<typeof queueQaSkippedRowResultSchema>;

export const queueQaErrorRowResultSchema = queueQaRowResultBaseSchema.extend({
  openResult: queueQaOpenResultSchema.optional(),
  documentExtraction: documentExtractionSchema.optional(),
  crossDocumentQa: crossDocumentQaResultSchema.optional(),
  decisionResult: qaDecisionResultSchema.optional(),
  writeExecutionResult: writeExecutionResultSchema.optional(),
  workflowSupport: workflowSupportSchema.optional(),
  workflowCompletionResult: workflowCompletionResultSchema.optional(),
  status: z.literal("ERROR"),
  error: queueQaPipelineErrorSchema,
});

export type QueueQaErrorRowResult = z.infer<typeof queueQaErrorRowResultSchema>;

export const queueQaRowProcessResultSchema = z.discriminatedUnion("status", [
  queueQaProcessedRowResultSchema,
  queueQaSkippedRowResultSchema,
  queueQaErrorRowResultSchema,
]);

export type QueueQaRowProcessResult = z.infer<typeof queueQaRowProcessResultSchema>;

export const queueQaRunTotalsSchema = z.object({
  rowsScanned: z.number().int().nonnegative(),
  targetsDetected: z.number().int().nonnegative(),
  notesProcessed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  decisions: z.number().int().nonnegative(),
  actionableDecisions: z.number().int().nonnegative(),
  reviewOnlyDecisions: z.number().int().nonnegative(),
  notActionableDecisions: z.number().int().nonnegative(),
  safeAutofixCandidates: z.number().int().nonnegative(),
  manualReviewRequired: z.number().int().nonnegative(),
  writeAttempts: z.number().int().nonnegative(),
  writesExecuted: z.number().int().nonnegative(),
  writesVerified: z.number().int().nonnegative(),
  writesBlocked: z.number().int().nonnegative(),
  writesSkipped: z.number().int().nonnegative(),
  writeFailures: z.number().int().nonnegative(),
  verificationFailures: z.number().int().nonnegative(),
  dryRunCount: z.number().int().nonnegative(),
  workflowAttempts: z.number().int().nonnegative(),
  workflowCompleted: z.number().int().nonnegative(),
  workflowPartial: z.number().int().nonnegative(),
  workflowBlocked: z.number().int().nonnegative(),
  workflowFailed: z.number().int().nonnegative(),
  workflowReviewRequired: z.number().int().nonnegative(),
  workflowPlannedOnly: z.number().int().nonnegative(),
  operatorCheckpointRequiredCount: z.number().int().nonnegative(),
});

export type QueueQaRunTotals = z.infer<typeof queueQaRunTotalsSchema>;

export const queueQaPipelineWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  rowIndex: z.number().int().nonnegative().nullable().optional(),
  rowFingerprint: z.string().min(1).nullable().optional(),
});

export type QueueQaPipelineWarning = z.infer<typeof queueQaPipelineWarningSchema>;

export const queueQaAuditSummarySchema = z.object({
  rowsScanned: z.number().int().nonnegative(),
  targetsDetected: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  pagesProcessed: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  decisionCount: z.number().int().nonnegative(),
  actionableDecisionCount: z.number().int().nonnegative(),
  reviewOnlyDecisionCount: z.number().int().nonnegative(),
  safeAutofixCandidateCount: z.number().int().nonnegative(),
  manualReviewRequiredCount: z.number().int().nonnegative(),
  writeAttemptCount: z.number().int().nonnegative(),
  writeVerifiedCount: z.number().int().nonnegative(),
  writeBlockedCount: z.number().int().nonnegative(),
  writeFailureCount: z.number().int().nonnegative(),
  workflowAttemptCount: z.number().int().nonnegative(),
  workflowCompletedCount: z.number().int().nonnegative(),
  workflowBlockedCount: z.number().int().nonnegative(),
  workflowFailedCount: z.number().int().nonnegative(),
  operatorCheckpointRequiredCount: z.number().int().nonnegative(),
});

export type QueueQaAuditSummary = z.infer<typeof queueQaAuditSummarySchema>;

export const queueQaRunReportSchema = z.object({
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  queueUrl: z.string().min(1),
  pagesProcessed: z.number().int().nonnegative(),
  resumeUsed: z.boolean(),
  options: queueQaPipelineOptionsSchema,
  totals: queueQaRunTotalsSchema,
  results: z.array(queueQaRowProcessResultSchema),
  warnings: z.array(queueQaPipelineWarningSchema),
  overallStatus: queueQaRunOverallStatusSchema,
  qaStatusBreakdown: z.object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
  }),
  decisionSummary: qaDecisionRunSummarySchema,
  writeSummary: writeExecutionResultSchema.shape.summary,
  workflowSummary: workflowExecutionSummarySchema,
  diagnosticsSummary: diagnosticsSummarySchema.optional(),
  reliabilitySummary: reliabilitySummarySchema.optional(),
  selectorHealthSummary: selectorHealthSummarySchema.optional(),
  driftSignalSummary: driftSignalSummarySchema.optional(),
  traceStats: traceStatsSchema.optional(),
  reliabilitySnapshot: reliabilitySnapshotSchema.optional(),
  runtimeConfigSnapshot: runtimeConfigSnapshotSchema.optional(),
  systemSupportSnapshot: systemSupportSnapshotSchema.optional(),
  exportArtifacts: z.object({
    jsonPath: z.string().min(1).nullable(),
    csvPath: z.string().min(1).nullable(),
    statePath: z.string().min(1).nullable(),
  }),
  dedupe: z.object({
    processedFingerprintCount: z.number().int().nonnegative(),
    duplicateRowsSkipped: z.number().int().nonnegative(),
  }),
});

export type QueueQaRunReport = z.infer<typeof queueQaRunReportSchema>;

export const queueQaRuleOutcomeSummarySchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
});

export type QueueQaRuleOutcomeSummary = z.infer<typeof queueQaRuleOutcomeSummarySchema>;

export const queueQaProcessedSummaryStatusSchema = visitNoteQaStatusSchema;

export type QueueQaProcessedSummaryStatus = z.infer<typeof queueQaProcessedSummaryStatusSchema>;
