import { z } from "zod";
import { crossDocumentQaConfidenceSchema } from "./cross-document-qa";
import { documentKindSchema, documentSignedStateSchema } from "./document-extraction";
import { decisionConfidenceSchema } from "./qa-decision";
import { writeExecutionStatusSchema } from "./write-execution";

export const workflowModeSchema = z.enum(["DRY_RUN", "EXECUTE"]);

export type WorkflowMode = z.infer<typeof workflowModeSchema>;

export const documentFamilySchema = z.enum([
  "VISIT_NOTE",
  "OASIS",
  "PLAN_OF_CARE",
  "ORDER_FAMILY",
  "UNKNOWN",
]);

export type DocumentFamily = z.infer<typeof documentFamilySchema>;

export const finalizeActionSchema = z.enum([
  "SAVE_PAGE",
  "VALIDATE_PAGE",
  "LOCK_RECORD",
  "MARK_QA_COMPLETE",
  "STOP_FOR_REVIEW",
]);

export type FinalizeAction = z.infer<typeof finalizeActionSchema>;

export const workflowStepStatusSchema = z.enum([
  "PLANNED",
  "SKIPPED",
  "BLOCKED",
  "EXECUTED",
  "VERIFIED",
  "FAILED",
]);

export type WorkflowStepStatus = z.infer<typeof workflowStepStatusSchema>;

export const workflowCompletionStatusSchema = z.enum([
  "COMPLETED",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "REVIEW_REQUIRED",
  "PLANNED_ONLY",
]);

export type WorkflowCompletionStatus = z.infer<typeof workflowCompletionStatusSchema>;

export const workflowEligibilitySchema = z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]);

export type WorkflowEligibility = z.infer<typeof workflowEligibilitySchema>;

export const workflowGuardFailureReasonSchema = z.enum([
  "WRITE_NOT_VERIFIED",
  "WORKFLOW_DISABLED",
  "UNSUPPORTED_DOCUMENT_KIND",
  "STEP_NOT_ALLOWLISTED",
  "SELECTOR_HEALTH_DEGRADED",
  "SELECTOR_CARDINALITY_UNEXPECTED",
  "PAGE_KIND_MISMATCH",
  "SUPPORT_LEVEL_BLOCKED",
  "EXECUTABLE_CONTROL_MISSING",
  "EXECUTABLE_CONTROL_AMBIGUOUS",
  "RETRY_EXHAUSTED",
  "DRIFT_SIGNAL_RAISED",
  "LOW_BUNDLE_CONFIDENCE",
  "LOW_DECISION_CONFIDENCE",
  "HUMAN_REVIEW_STILL_REQUIRED",
  "UNRESOLVED_WARNINGS_PRESENT",
  "SAVE_SELECTOR_NOT_FOUND",
  "VALIDATE_SELECTOR_NOT_FOUND",
  "LOCK_SELECTOR_NOT_FOUND",
  "QA_COMPLETE_SELECTOR_NOT_FOUND",
  "POST_STEP_VERIFICATION_FAILED",
  "POST_SAVE_SIGNAL_MISSING",
  "POST_VALIDATE_SIGNAL_MISSING",
  "PAGE_STATE_AMBIGUOUS",
  "PRECONDITION_NOT_MET",
  "OPERATOR_CHECKPOINT_REQUIRED",
  "MAX_WORKFLOW_STEPS_PER_RUN_REACHED",
  "ACTION_NOT_ENABLED_BY_CONFIG",
  "DOCUMENT_KIND_NOT_EXECUTION_READY",
  "SUPPORT_LEVEL_REVIEW_GATED",
  "SUPPORT_LEVEL_PLANNED_ONLY",
  "SOURCE_OF_TRUTH_REVIEW_REQUIRED",
  "EPISODE_ASSOCIATION_REVIEW_REQUIRED",
  "MULTI_DOCUMENT_SELECTOR_UNSUPPORTED",
  "ACTION_REQUIRES_OPERATOR_CONFIRMATION",
  "READ_ONLY_MODE_ENFORCED",
]);

export type WorkflowGuardFailureReason = z.infer<typeof workflowGuardFailureReasonSchema>;

export const workflowWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type WorkflowWarning = z.infer<typeof workflowWarningSchema>;

export const workflowStateSnapshotSchema = z.object({
  capturedAt: z.string().min(1),
  documentKind: documentKindSchema.nullable(),
  documentFamily: documentFamilySchema.nullable().optional(),
  currentUrlPath: z.string().min(1).nullable(),
  signedState: documentSignedStateSchema.nullable(),
  dirtyIndicatorsPresent: z.boolean().nullable(),
  successIndicatorsPresent: z.boolean().nullable(),
  availableActions: z.array(finalizeActionSchema),
});

export type WorkflowStateSnapshot = z.infer<typeof workflowStateSnapshotSchema>;

export const operatorCheckpointCategorySchema = z.enum([
  "PRE_VALIDATE_REVIEW",
  "PRE_LOCK_REVIEW",
  "PRE_QA_COMPLETE_REVIEW",
  "SOURCE_OF_TRUTH_REVIEW",
  "EPISODE_ASSOCIATION_REVIEW",
  "DOCUMENT_KIND_REVIEW",
]);

export type OperatorCheckpointCategory = z.infer<typeof operatorCheckpointCategorySchema>;

export const operatorCheckpointSchema = z.object({
  required: z.boolean(),
  category: operatorCheckpointCategorySchema.nullable(),
  reason: z.string().min(1).nullable(),
  recommendedAction: z.string().min(1).nullable(),
  beforeAction: finalizeActionSchema.nullable(),
});

export type OperatorCheckpoint = z.infer<typeof operatorCheckpointSchema>;

export const workflowSupportLevelSchema = z.enum([
  "FULLY_SUPPORTED",
  "SAVE_ONLY",
  "REVIEW_GATED",
  "PLANNED_ONLY",
  "NOT_SUPPORTED",
]);

export type WorkflowSupportLevel = z.infer<typeof workflowSupportLevelSchema>;

export const workflowSupportSchema = z.object({
  documentKind: documentKindSchema.nullable(),
  documentFamily: documentFamilySchema,
  targetField: z.string().min(1).nullable(),
  supportLevel: workflowSupportLevelSchema,
  allowedActions: z.array(finalizeActionSchema),
  executableActions: z.array(finalizeActionSchema),
  reviewGatedActions: z.array(finalizeActionSchema),
  blockedActions: z.array(finalizeActionSchema),
  requiresVerifiedWrite: z.boolean(),
  operatorCheckpointRequired: z.boolean(),
  checkpointCategories: z.array(operatorCheckpointCategorySchema),
  dryRunOnly: z.boolean(),
  reason: z.string().min(1),
});

export type WorkflowSupport = z.infer<typeof workflowSupportSchema>;

export const workflowPlanStepSchema = z.object({
  action: finalizeActionSchema,
  status: workflowStepStatusSchema,
  guardFailure: workflowGuardFailureReasonSchema.nullable().optional(),
  reason: z.string().min(1).nullable().optional(),
  requiresOperatorCheckpoint: z.boolean(),
});

export type WorkflowPlanStep = z.infer<typeof workflowPlanStepSchema>;

export const workflowPlanSchema = z.object({
  documentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  supportLevel: workflowSupportLevelSchema,
  reason: z.string().min(1),
  steps: z.array(workflowPlanStepSchema),
  maxSteps: z.number().int().positive(),
});

export type WorkflowPlan = z.infer<typeof workflowPlanSchema>;

export const workflowStepResultSchema = z.object({
  action: finalizeActionSchema,
  status: workflowStepStatusSchema,
  mode: workflowModeSchema,
  attempted: z.boolean(),
  selectorUsed: z.string().min(1).nullable(),
  verificationPassed: z.boolean(),
  guardFailures: z.array(workflowGuardFailureReasonSchema),
  warnings: z.array(workflowWarningSchema),
  snapshotBefore: workflowStateSnapshotSchema.nullable(),
  snapshotAfter: workflowStateSnapshotSchema.nullable(),
  executedAt: z.string().min(1).nullable(),
  verifiedAt: z.string().min(1).nullable(),
});

export type WorkflowStepResult = z.infer<typeof workflowStepResultSchema>;

export const workflowExecutionCountSchema = z.object({
  key: z.string().min(1),
  count: z.number().int().positive(),
});

export type WorkflowExecutionCount = z.infer<typeof workflowExecutionCountSchema>;

export const workflowDocumentKindCountSchema = z.object({
  documentKind: documentKindSchema,
  count: z.number().int().positive(),
});

export type WorkflowDocumentKindCount = z.infer<typeof workflowDocumentKindCountSchema>;

export const workflowDocumentStepCountSchema = z.object({
  documentKind: documentKindSchema,
  action: finalizeActionSchema,
  count: z.number().int().positive(),
});

export type WorkflowDocumentStepCount = z.infer<typeof workflowDocumentStepCountSchema>;

export const workflowSupportLevelCountSchema = z.object({
  supportLevel: workflowSupportLevelSchema,
  count: z.number().int().positive(),
});

export type WorkflowSupportLevelCount = z.infer<typeof workflowSupportLevelCountSchema>;

export const workflowCheckpointCategoryCountSchema = z.object({
  category: operatorCheckpointCategorySchema,
  count: z.number().int().positive(),
});

export type WorkflowCheckpointCategoryCount = z.infer<typeof workflowCheckpointCategoryCountSchema>;

export const workflowExecutionSummarySchema = z.object({
  workflowAttempts: z.number().int().nonnegative(),
  workflowCompleted: z.number().int().nonnegative(),
  workflowPartial: z.number().int().nonnegative(),
  workflowBlocked: z.number().int().nonnegative(),
  workflowFailed: z.number().int().nonnegative(),
  workflowReviewRequired: z.number().int().nonnegative(),
  workflowPlannedOnly: z.number().int().nonnegative(),
  operatorCheckpointRequiredCount: z.number().int().nonnegative(),
  stepCountsByAction: z.array(workflowExecutionCountSchema),
  workflowAttemptsByDocumentKind: z.array(workflowDocumentKindCountSchema),
  workflowCompletedByDocumentKind: z.array(workflowDocumentKindCountSchema),
  workflowPartialByDocumentKind: z.array(workflowDocumentKindCountSchema),
  workflowReviewRequiredByDocumentKind: z.array(workflowDocumentKindCountSchema),
  workflowBlockedByDocumentKind: z.array(workflowDocumentKindCountSchema),
  workflowFailedByDocumentKind: z.array(workflowDocumentKindCountSchema),
  workflowPlannedOnlyByDocumentKind: z.array(workflowDocumentKindCountSchema),
  stepCountsByDocumentKind: z.array(workflowDocumentStepCountSchema),
  checkpointCountsByCategory: z.array(workflowCheckpointCategoryCountSchema),
  supportLevelCounts: z.array(workflowSupportLevelCountSchema),
  topWorkflowGuardFailures: z.array(workflowExecutionCountSchema),
  topVerificationFailures: z.array(workflowExecutionCountSchema),
});

export type WorkflowExecutionSummary = z.infer<typeof workflowExecutionSummarySchema>;

export const workflowCompletionResultSchema = z.object({
  attempted: z.boolean(),
  status: workflowCompletionStatusSchema,
  mode: workflowModeSchema,
  eligibility: workflowEligibilitySchema,
  documentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  workflowSupport: workflowSupportSchema.nullable(),
  plan: workflowPlanSchema.nullable(),
  steps: z.array(workflowStepResultSchema),
  operatorCheckpoint: operatorCheckpointSchema.nullable(),
  guardFailures: z.array(workflowGuardFailureReasonSchema),
  warnings: z.array(workflowWarningSchema),
  audit: z.object({
    executedAt: z.string().min(1),
    bundleConfidence: crossDocumentQaConfidenceSchema,
    decisionConfidence: decisionConfidenceSchema,
    sourceWriteStatus: writeExecutionStatusSchema.nullable(),
  }),
});

export type WorkflowCompletionResult = z.infer<typeof workflowCompletionResultSchema>;
