import { z } from "zod";
import { documentKindSchema } from "./document-extraction";
import { portalSafetyModeSchema } from "./portal-safety";

export const diagnosticSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]);

export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

export const diagnosticCategorySchema = z.enum([
  "SELECTOR_HEALTH",
  "PAGE_STATE",
  "EXTRACTION",
  "COMPARISON",
  "DECISION",
  "PORTAL_SAFETY",
  "WRITE_GUARD",
  "WRITE_EXECUTION",
  "WORKFLOW_GUARD",
  "WORKFLOW_EXECUTION",
  "DRIFT_SIGNAL",
  "CONFIGURATION",
  "SUPPORT_MATRIX",
]);

export type DiagnosticCategory = z.infer<typeof diagnosticCategorySchema>;

export const selectorHealthStatusSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "MISSING",
  "AMBIGUOUS",
  "UNSUPPORTED",
]);

export type SelectorHealthStatus = z.infer<typeof selectorHealthStatusSchema>;

export const selectorHealthExpectedCardinalitySchema = z.enum(["ONE", "AT_LEAST_ONE"]);

export type SelectorHealthExpectedCardinality = z.infer<
  typeof selectorHealthExpectedCardinalitySchema
>;

export const diagnosticPhaseSchema = z.enum([
  "QUEUE_PIPELINE",
  "EXTRACTION",
  "COMPARISON",
  "DECISION",
  "WRITE_GUARD",
  "WRITE_EXECUTION",
  "WORKFLOW_GUARD",
  "WORKFLOW_EXECUTION",
  "REPORTING",
]);

export type DiagnosticPhase = z.infer<typeof diagnosticPhaseSchema>;

export const diagnosticActionSchema = z.enum([
  "SAVE_PAGE",
  "VALIDATE_PAGE",
  "LOCK_RECORD",
  "MARK_QA_COMPLETE",
  "STOP_FOR_REVIEW",
]);

export type DiagnosticAction = z.infer<typeof diagnosticActionSchema>;

export const supportDispositionSchema = z.enum([
  "EXECUTABLE",
  "REVIEW_GATED",
  "PLANNED_ONLY",
  "NOT_SUPPORTED",
  "DRY_RUN_ONLY",
  "UNKNOWN",
]);

export type SupportDisposition = z.infer<typeof supportDispositionSchema>;

export const workflowSupportLevelSnapshotSchema = z.enum([
  "FULLY_SUPPORTED",
  "SAVE_ONLY",
  "REVIEW_GATED",
  "PLANNED_ONLY",
  "NOT_SUPPORTED",
]);

export type WorkflowSupportLevelSnapshot = z.infer<typeof workflowSupportLevelSnapshotSchema>;

export const driftSignalTypeSchema = z.enum([
  "SELECTOR_MISSING",
  "SELECTOR_AMBIGUOUS",
  "EXPECTED_CONTROL_ABSENT",
  "EXPECTED_SECTION_ABSENT",
  "PAGE_TITLE_CHANGED",
  "ROUTE_PATTERN_CHANGED",
  "POST_STEP_SIGNAL_MISSING",
]);

export type DriftSignalType = z.infer<typeof driftSignalTypeSchema>;

export const retryAttemptOutcomeSchema = z.enum([
  "RETRYING",
  "SUCCEEDED",
  "EXHAUSTED",
  "SKIPPED",
]);

export type RetryAttemptOutcome = z.infer<typeof retryAttemptOutcomeSchema>;

export const traceStatusSchema = z.enum([
  "STARTED",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "VERIFIED",
  "SKIPPED",
  "WARNING",
]);

export type TraceStatus = z.infer<typeof traceStatusSchema>;

export const namedCountSchema = z.object({
  key: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export type NamedCount = z.infer<typeof namedCountSchema>;

const diagnosticMetadataValueSchema: z.ZodType<
  string | number | boolean | null | string[] | number[] | boolean[]
> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

export const runtimeDiagnosticSchema = z.object({
  timestamp: z.string().min(1),
  severity: diagnosticSeveritySchema,
  category: diagnosticCategorySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  phase: diagnosticPhaseSchema,
  documentKind: documentKindSchema.nullable(),
  action: diagnosticActionSchema.nullable().optional(),
  targetField: z.string().min(1).nullable().optional(),
  selectorName: z.string().min(1).nullable().optional(),
  supportLevel: workflowSupportLevelSnapshotSchema.nullable().optional(),
  supportDisposition: supportDispositionSchema.nullable().optional(),
  metadata: z.record(z.string().min(1), diagnosticMetadataValueSchema).optional(),
});

export type RuntimeDiagnostic = z.infer<typeof runtimeDiagnosticSchema>;

export const selectorHealthRecordSchema = z.object({
  name: z.string().min(1),
  documentKind: documentKindSchema,
  phase: diagnosticPhaseSchema,
  action: diagnosticActionSchema.nullable().optional(),
  targetField: z.string().min(1).nullable().optional(),
  required: z.boolean(),
  expectedCardinality: selectorHealthExpectedCardinalitySchema,
  status: selectorHealthStatusSchema,
  matchedCount: z.number().int().nonnegative(),
  selectorUsed: z.string().min(1).nullable(),
  supportLevel: workflowSupportLevelSnapshotSchema.nullable().optional(),
  supportDisposition: supportDispositionSchema.nullable().optional(),
  reason: z.string().min(1).nullable(),
});

export type SelectorHealthRecord = z.infer<typeof selectorHealthRecordSchema>;

export const driftSignalSchema = z.object({
  timestamp: z.string().min(1),
  type: driftSignalTypeSchema,
  severity: diagnosticSeveritySchema,
  documentKind: documentKindSchema,
  selectorName: z.string().min(1).nullable(),
  action: diagnosticActionSchema.nullable().optional(),
  targetField: z.string().min(1).nullable().optional(),
  supportLevel: workflowSupportLevelSnapshotSchema.nullable().optional(),
  supportDisposition: supportDispositionSchema.nullable().optional(),
  routePath: z.string().min(1).nullable().optional(),
  reason: z.string().min(1),
});

export type DriftSignal = z.infer<typeof driftSignalSchema>;

export const retryAttemptRecordSchema = z.object({
  timestamp: z.string().min(1),
  policyName: z.string().min(1),
  operation: z.string().min(1),
  phase: diagnosticPhaseSchema,
  attemptNumber: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().int().nonnegative(),
  outcome: retryAttemptOutcomeSchema,
  retryable: z.boolean(),
  reasonCode: z.string().min(1),
  documentKind: documentKindSchema.nullable().optional(),
  action: diagnosticActionSchema.nullable().optional(),
  targetField: z.string().min(1).nullable().optional(),
});

export type RetryAttemptRecord = z.infer<typeof retryAttemptRecordSchema>;

export const executionTraceEventSchema = z.object({
  timestamp: z.string().min(1),
  phase: diagnosticPhaseSchema,
  event: z.string().min(1),
  status: traceStatusSchema,
  documentKind: documentKindSchema.nullable(),
  action: diagnosticActionSchema.nullable().optional(),
  targetField: z.string().min(1).nullable().optional(),
  selectorName: z.string().min(1).nullable().optional(),
  supportDisposition: supportDispositionSchema.nullable().optional(),
  detail: z.string().min(1).nullable().optional(),
});

export type ExecutionTraceEvent = z.infer<typeof executionTraceEventSchema>;

export const supportMatrixDiagnosticSchema = z.object({
  timestamp: z.string().min(1),
  documentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  action: diagnosticActionSchema.nullable().optional(),
  supportLevel: workflowSupportLevelSnapshotSchema.nullable(),
  supportDisposition: supportDispositionSchema,
  driftEligible: z.boolean(),
  reason: z.string().min(1),
});

export type SupportMatrixDiagnostic = z.infer<typeof supportMatrixDiagnosticSchema>;

export const diagnosticsSummarySchema = z.object({
  totalDiagnostics: z.number().int().nonnegative(),
  bySeverity: z.array(namedCountSchema),
  byCategory: z.array(namedCountSchema),
  topCodes: z.array(namedCountSchema),
  supportLevelBlockedCounts: z.array(namedCountSchema),
  retryStats: z.object({
    totalRecords: z.number().int().nonnegative(),
    exhaustedCount: z.number().int().nonnegative(),
    byPolicy: z.array(namedCountSchema),
  }),
});

export type DiagnosticsSummary = z.infer<typeof diagnosticsSummarySchema>;

export const selectorHealthSummarySchema = z.object({
  totalChecks: z.number().int().nonnegative(),
  statusCounts: z.array(namedCountSchema),
  missingByDocumentKind: z.array(namedCountSchema),
  ambiguousByAction: z.array(namedCountSchema),
});

export type SelectorHealthSummary = z.infer<typeof selectorHealthSummarySchema>;

export const driftSignalSummarySchema = z.object({
  totalSignals: z.number().int().nonnegative(),
  byType: z.array(namedCountSchema),
  byDocumentKind: z.array(namedCountSchema),
});

export type DriftSignalSummary = z.infer<typeof driftSignalSummarySchema>;

export const traceStatsSchema = z.object({
  totalEvents: z.number().int().nonnegative(),
  byPhase: z.array(namedCountSchema),
  byStatus: z.array(namedCountSchema),
});

export type TraceStats = z.infer<typeof traceStatsSchema>;

export const reliabilitySummarySchema = z.object({
  extractionSuccessRate: z.number().min(0).max(1),
  writeVerificationRate: z.number().min(0).max(1),
  workflowStepVerificationRate: z.number().min(0).max(1),
  blockedVsFailed: z.object({
    blocked: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  selectorMissingByDocumentKind: z.array(namedCountSchema),
  ambiguousSelectorByAction: z.array(namedCountSchema),
  driftSignalsByType: z.array(namedCountSchema),
  supportDispositionCounts: z.array(namedCountSchema),
});

export type ReliabilitySummary = z.infer<typeof reliabilitySummarySchema>;

export const runtimeConfigSnapshotSchema = z.object({
  capturedAt: z.string().min(1),
  safetyMode: portalSafetyModeSchema,
  readOnlyEnforced: z.boolean(),
  writeMode: z.enum(["DRY_RUN", "EXECUTE"]).nullable(),
  workflowMode: z.enum(["DRY_RUN", "EXECUTE"]).nullable(),
  writesEnabled: z.boolean(),
  workflowEnabled: z.boolean(),
  dryRun: z.boolean(),
  dangerousControlDetections: z.number().int().nonnegative(),
  maxWritesPerRun: z.number().int().positive(),
  maxWorkflowStepsPerRun: z.number().int().positive(),
  allowedWriteTargetFields: z.array(z.string().min(1)),
  allowedWorkflowActions: z.array(diagnosticActionSchema),
  restrictWriteDocumentKinds: z.array(documentKindSchema),
  restrictWorkflowDocumentKinds: z.array(documentKindSchema),
  requireOperatorCheckpointFor: z.array(diagnosticActionSchema),
});

export type RuntimeConfigSnapshot = z.infer<typeof runtimeConfigSnapshotSchema>;

export const systemSupportSnapshotEntrySchema = z.object({
  documentKind: documentKindSchema,
  targetField: z.string().min(1).nullable(),
  supportLevel: workflowSupportLevelSnapshotSchema,
  allowedActions: z.array(diagnosticActionSchema),
  executableActions: z.array(diagnosticActionSchema),
  reviewGatedActions: z.array(diagnosticActionSchema),
  blockedActions: z.array(diagnosticActionSchema),
  reason: z.string().min(1),
});

export type SystemSupportSnapshotEntry = z.infer<typeof systemSupportSnapshotEntrySchema>;

export const systemSupportSnapshotSchema = z.object({
  capturedAt: z.string().min(1),
  workflowSupportMatrix: z.array(systemSupportSnapshotEntrySchema),
});

export type SystemSupportSnapshot = z.infer<typeof systemSupportSnapshotSchema>;
