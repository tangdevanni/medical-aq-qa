import { z } from "zod";
import { crossDocumentQaConfidenceSchema } from "./cross-document-qa";
import { documentKindSchema } from "./document-extraction";
import { decisionConfidenceSchema, qaDecisionIssueTypeSchema, qaDecisionTypeSchema } from "./qa-decision";

export const writeModeSchema = z.enum(["DRY_RUN", "EXECUTE"]);

export type WriteMode = z.infer<typeof writeModeSchema>;

export const writeExecutionStatusSchema = z.enum([
  "EXECUTED",
  "SKIPPED",
  "BLOCKED",
  "FAILED",
  "VERIFIED",
  "VERIFICATION_FAILED",
]);

export type WriteExecutionStatus = z.infer<typeof writeExecutionStatusSchema>;

export const writeEligibilitySchema = z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]);

export type WriteEligibility = z.infer<typeof writeEligibilitySchema>;

export const fieldWriteActionSchema = z.enum(["UPDATE_FIELD", "APPEND_TEXT", "NO_ACTION"]);

export type FieldWriteAction = z.infer<typeof fieldWriteActionSchema>;

export const fieldWriteStrategySchema = z.enum(["REPLACE", "APPEND", "NONE"]);

export type FieldWriteStrategy = z.infer<typeof fieldWriteStrategySchema>;

export const writeGuardFailureReasonSchema = z.enum([
  "DECISION_NOT_SAFE_AUTOFIX",
  "LOW_BUNDLE_CONFIDENCE",
  "LOW_DECISION_CONFIDENCE",
  "TARGET_FIELD_NOT_ALLOWLISTED",
  "TARGET_SELECTOR_NOT_FOUND",
  "TARGET_SELECTOR_AMBIGUOUS",
  "SELECTOR_HEALTH_DEGRADED",
  "SELECTOR_CARDINALITY_UNEXPECTED",
  "PAGE_KIND_MISMATCH",
  "SUPPORT_LEVEL_BLOCKED",
  "EXECUTABLE_CONTROL_MISSING",
  "EXECUTABLE_CONTROL_AMBIGUOUS",
  "RETRY_EXHAUSTED",
  "CURRENT_VALUE_UNVERIFIED",
  "POST_WRITE_VERIFICATION_FAILED",
  "POST_SAVE_SIGNAL_MISSING",
  "WRITE_MODE_DRY_RUN",
  "UNSUPPORTED_DOCUMENT_KIND",
  "UNSUPPORTED_ACTION",
  "PROPOSED_VALUE_EMPTY",
  "PROPOSED_VALUE_TOO_LONG",
  "FIELD_STATE_MISMATCH",
  "FIELD_NOT_EDITABLE",
  "WRITES_DISABLED",
  "MAX_WRITES_PER_RUN_REACHED",
  "WRITE_MODE_NOT_ALLOWED",
  "DOCUMENT_KIND_NOT_EXECUTION_READY",
  "MULTI_DOCUMENT_SELECTOR_UNSUPPORTED",
  "READ_ONLY_MODE_ENFORCED",
]);

export type WriteGuardFailureReason = z.infer<typeof writeGuardFailureReasonSchema>;

export const preWriteValidationResultSchema = z.object({
  canProceed: z.boolean(),
  selectorUsed: z.string().min(1).nullable(),
  currentValue: z.string().min(1).nullable(),
  normalizedCurrentValue: z.string().min(1).nullable(),
  normalizedProposedValue: z.string().min(1).nullable(),
  alreadyMatches: z.boolean(),
  warnings: z.array(z.string().min(1)),
  guardFailures: z.array(writeGuardFailureReasonSchema),
});

export type PreWriteValidationResult = z.infer<typeof preWriteValidationResultSchema>;

export const postWriteValidationResultSchema = z.object({
  verificationPassed: z.boolean(),
  finalValue: z.string().min(1).nullable(),
  normalizedFinalValue: z.string().min(1).nullable(),
  warnings: z.array(z.string().min(1)),
  guardFailures: z.array(writeGuardFailureReasonSchema),
});

export type PostWriteValidationResult = z.infer<typeof postWriteValidationResultSchema>;

export const writeExecutionWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type WriteExecutionWarning = z.infer<typeof writeExecutionWarningSchema>;

export const writeExecutionAttemptSchema = z.object({
  status: writeExecutionStatusSchema,
  mode: writeModeSchema,
  eligibility: writeEligibilitySchema,
  decisionType: qaDecisionTypeSchema,
  issueType: qaDecisionIssueTypeSchema,
  targetDocumentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  selectorUsed: z.string().min(1).nullable(),
  previousValue: z.string().min(1).nullable(),
  proposedValue: z.string().min(1).nullable(),
  finalValue: z.string().min(1).nullable(),
  verificationPassed: z.boolean(),
  guardFailures: z.array(writeGuardFailureReasonSchema),
  warnings: z.array(writeExecutionWarningSchema),
  audit: z.object({
    executedAt: z.string().min(1),
    bundleConfidence: crossDocumentQaConfidenceSchema,
    decisionConfidence: decisionConfidenceSchema,
  }),
});

export type WriteExecutionAttempt = z.infer<typeof writeExecutionAttemptSchema>;

export const writeExecutionCountSchema = z.object({
  key: z.string().min(1),
  count: z.number().int().positive(),
});

export type WriteExecutionCount = z.infer<typeof writeExecutionCountSchema>;

export const writeExecutionSummarySchema = z.object({
  writeAttempts: z.number().int().nonnegative(),
  writesExecuted: z.number().int().nonnegative(),
  writesVerified: z.number().int().nonnegative(),
  writesBlocked: z.number().int().nonnegative(),
  writesSkipped: z.number().int().nonnegative(),
  writeFailures: z.number().int().nonnegative(),
  verificationFailures: z.number().int().nonnegative(),
  dryRunCount: z.number().int().nonnegative(),
  topGuardFailureReasons: z.array(writeExecutionCountSchema),
});

export type WriteExecutionSummary = z.infer<typeof writeExecutionSummarySchema>;

export const writeExecutionResultSchema = z.object({
  attempted: z.boolean(),
  results: z.array(writeExecutionAttemptSchema),
  summary: writeExecutionSummarySchema,
});

export type WriteExecutionResult = z.infer<typeof writeExecutionResultSchema>;
