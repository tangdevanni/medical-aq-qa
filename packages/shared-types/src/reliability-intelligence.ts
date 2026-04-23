import { z } from "zod";
import {
  diagnosticsSummarySchema,
  driftSignalSchema,
  driftSignalSummarySchema,
  executionTraceEventSchema,
  namedCountSchema,
  reliabilitySummarySchema,
  runtimeConfigSnapshotSchema,
  selectorHealthRecordSchema,
  selectorHealthSummarySchema,
  supportDispositionSchema,
  supportMatrixDiagnosticSchema,
  systemSupportSnapshotSchema,
} from "./runtime-diagnostics";
import { documentKindSchema } from "./document-extraction";
import { workflowExecutionSummarySchema, workflowStepStatusSchema, workflowSupportLevelSchema, finalizeActionSchema } from "./workflow-completion";
import {
  writeExecutionStatusSchema,
  writeExecutionSummarySchema,
  writeGuardFailureReasonSchema,
  writeModeSchema,
} from "./write-execution";

export const reliabilityLevelSchema = z.enum([
  "STABLE",
  "DEGRADED",
  "UNSTABLE",
  "INSUFFICIENT_DATA",
]);

export type ReliabilityLevel = z.infer<typeof reliabilityLevelSchema>;

export const anomalyTypeSchema = z.enum([
  "SUDDEN_SELECTOR_FAILURE",
  "SPIKE_IN_DRIFT_SIGNALS",
  "DROP_IN_VERIFICATION_RATE",
  "INCREASE_IN_BLOCKED_ACTIONS",
  "EXECUTION_PATH_REGRESSION",
]);

export type AnomalyType = z.infer<typeof anomalyTypeSchema>;

export const trendDirectionSchema = z.enum([
  "IMPROVING",
  "STABLE",
  "DEGRADING",
]);

export type TrendDirection = z.infer<typeof trendDirectionSchema>;

export const reliabilityAggregationWindowSchema = z.object({
  label: z.string().min(1),
  maxRuns: z.number().int().positive(),
  runsConsidered: z.number().int().nonnegative(),
  startTimestamp: z.string().min(1).nullable(),
  endTimestamp: z.string().min(1).nullable(),
});

export type ReliabilityAggregationWindow = z.infer<typeof reliabilityAggregationWindowSchema>;

export const supportClassificationSourceSchema = z.enum([
  "WRITE_ALLOWLIST",
  "WORKFLOW_SUPPORT_MATRIX",
  "SELECTOR_HEALTH",
  "RUN_REPORT",
]);

export type SupportClassificationSource = z.infer<typeof supportClassificationSourceSchema>;

export const runHistoryPolicySnapshotSchema = z.object({
  capturedAt: z.string().min(1),
  storageKind: z.string().min(1),
  persistent: z.boolean(),
  scoringPolicyVersion: z.string().min(1),
  runtimeConfigSnapshot: runtimeConfigSnapshotSchema.nullable(),
  systemSupportSnapshot: systemSupportSnapshotSchema.nullable(),
});

export type RunHistoryPolicySnapshot = z.infer<typeof runHistoryPolicySnapshotSchema>;

export const runWriteOutcomeSchema = z.object({
  documentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  status: writeExecutionStatusSchema,
  mode: writeModeSchema,
  verificationPassed: z.boolean(),
  supportDisposition: supportDispositionSchema.nullable(),
  supportClassificationSource: supportClassificationSourceSchema,
  supportClassificationReason: z.string().min(1),
  contributesToReliability: z.boolean(),
  guardFailures: z.array(writeGuardFailureReasonSchema),
});

export type RunWriteOutcome = z.infer<typeof runWriteOutcomeSchema>;

export const runWorkflowStepOutcomeSchema = z.object({
  documentKind: documentKindSchema.nullable(),
  action: finalizeActionSchema,
  targetField: z.string().min(1).nullable(),
  status: workflowStepStatusSchema,
  verificationPassed: z.boolean(),
  supportLevel: workflowSupportLevelSchema.nullable(),
  supportDisposition: z.enum([
    "EXECUTABLE",
    "REVIEW_GATED",
    "PLANNED_ONLY",
    "NOT_SUPPORTED",
    "DRY_RUN_ONLY",
    "UNKNOWN",
  ]).nullable(),
  supportClassificationSource: supportClassificationSourceSchema,
  supportClassificationReason: z.string().min(1),
  contributesToReliability: z.boolean(),
  guardFailures: z.array(z.string().min(1)),
});

export type RunWorkflowStepOutcome = z.infer<typeof runWorkflowStepOutcomeSchema>;

export const runReliabilityRecordSchema = z.object({
  runId: z.string().min(1),
  timestamp: z.string().min(1),
  overallStatus: z.enum(["SUCCESS", "PARTIAL_SUCCESS", "FAILURE"]),
  policySnapshot: runHistoryPolicySnapshotSchema,
  diagnosticsSummary: diagnosticsSummarySchema.nullable(),
  selectorHealthSummary: selectorHealthSummarySchema.nullable(),
  driftSignalSummary: driftSignalSummarySchema.nullable(),
  reliabilitySummary: reliabilitySummarySchema.nullable(),
  writeSummary: writeExecutionSummarySchema,
  workflowSummary: workflowExecutionSummarySchema,
  selectorHealth: z.array(selectorHealthRecordSchema),
  driftSignals: z.array(driftSignalSchema),
  executionTrace: z.array(executionTraceEventSchema),
  supportMatrixDiagnostics: z.array(supportMatrixDiagnosticSchema),
  writeOutcomes: z.array(runWriteOutcomeSchema),
  workflowStepOutcomes: z.array(runWorkflowStepOutcomeSchema),
});

export type RunReliabilityRecord = z.infer<typeof runReliabilityRecordSchema>;

export const selectorStabilityScoreSchema = z.object({
  selectorName: z.string().min(1),
  documentKind: documentKindSchema,
  action: finalizeActionSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  stabilityScore: z.number().min(0).max(1),
  reliabilityLevel: reliabilityLevelSchema,
  trend: trendDirectionSchema,
  sampleSize: z.number().int().nonnegative(),
  excludedObservationCount: z.number().int().nonnegative(),
  healthyCount: z.number().int().nonnegative(),
  degradedCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  ambiguousCount: z.number().int().nonnegative(),
});

export type SelectorStabilityScore = z.infer<typeof selectorStabilityScoreSchema>;

export const actionReliabilityScoreSchema = z.object({
  action: z.string().min(1),
  documentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  supportLevel: workflowSupportLevelSchema.nullable().optional(),
  attempts: z.number().int().nonnegative(),
  verifiedSuccessCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  excludedObservationCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  verificationFailureCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  reliabilityLevel: reliabilityLevelSchema,
  trend: trendDirectionSchema,
});

export type ActionReliabilityScore = z.infer<typeof actionReliabilityScoreSchema>;

export const documentKindReliabilitySchema = z.object({
  documentKind: documentKindSchema,
  reliabilityLevel: reliabilityLevelSchema,
  writeVerificationRate: z.number().min(0).max(1),
  workflowCompletionRate: z.number().min(0).max(1),
  driftSignalRate: z.number().min(0).max(1),
  selectorInstabilityCount: z.number().int().nonnegative(),
  supportDispositionCounts: z.array(namedCountSchema),
  trend: trendDirectionSchema,
});

export type DocumentKindReliability = z.infer<typeof documentKindReliabilitySchema>;

export const driftTrendSchema = z.object({
  selectorName: z.string().min(1).nullable(),
  documentKind: documentKindSchema.nullable(),
  action: finalizeActionSchema.nullable(),
  trend: trendDirectionSchema,
  recentDriftRate: z.number().min(0).max(1),
  previousDriftRate: z.number().min(0).max(1),
  recentCount: z.number().int().nonnegative(),
  previousCount: z.number().int().nonnegative(),
  scoredOpportunityCount: z.number().int().nonnegative(),
  excludedSignalCount: z.number().int().nonnegative(),
});

export type DriftTrend = z.infer<typeof driftTrendSchema>;

export const anomalyRecordSchema = z.object({
  type: anomalyTypeSchema,
  severity: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]),
  documentKind: documentKindSchema.nullable(),
  action: z.string().min(1).nullable(),
  selectorName: z.string().min(1).nullable(),
  reason: z.string().min(1),
  baselineValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
});

export type AnomalyRecord = z.infer<typeof anomalyRecordSchema>;

export const reliabilityInsightSchema = z.object({
  kind: z.enum(["SELECTOR", "ACTION", "DOCUMENT", "DRIFT", "ANOMALY"]),
  key: z.string().min(1),
  reliabilityLevel: reliabilityLevelSchema,
  summary: z.string().min(1),
});

export type ReliabilityInsight = z.infer<typeof reliabilityInsightSchema>;

export const reliabilitySnapshotSchema = z.object({
  timestamp: z.string().min(1),
  aggregationWindow: reliabilityAggregationWindowSchema,
  selectorStability: z.array(selectorStabilityScoreSchema),
  actionReliability: z.array(actionReliabilityScoreSchema),
  documentReliability: z.array(documentKindReliabilitySchema),
  driftTrends: z.array(driftTrendSchema),
  anomalies: z.array(anomalyRecordSchema),
  overallSystemHealth: reliabilityLevelSchema,
});

export type ReliabilitySnapshot = z.infer<typeof reliabilitySnapshotSchema>;
