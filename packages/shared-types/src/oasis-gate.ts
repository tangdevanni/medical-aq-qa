import { z } from "zod";

export const oasisValidationStatusSchema = z.enum([
  "validated_clean",
  "validated_with_gaps",
  "validation_unavailable",
  "validation_error",
  "wrong_page_context",
]);

export type OasisValidationStatus = z.infer<typeof oasisValidationStatusSchema>;

export const oasisValidationMissingFieldSchema = z.object({
  fieldId: z.string().min(1).nullable().default(null),
  label: z.string().min(1),
  section: z.string().min(1).nullable().default(null),
  mItem: z.string().min(1).nullable().default(null),
  message: z.string().min(1).nullable().default(null),
  selectorUsed: z.string().min(1).nullable().default(null),
});

export type OasisValidationMissingField = z.infer<typeof oasisValidationMissingFieldSchema>;

export const oasisValidationPageContextSchema = z.object({
  currentUrl: z.string().min(1).nullable().default(null),
  expectedContext: z.string().min(1),
  expectedChartUrl: z.string().min(1).nullable().default(null),
  classifiedContext: z.string().min(1),
  patientKey: z.string().min(1).nullable().default(null),
  stepName: z.string().min(1),
  recoveryAttempted: z.boolean().default(false),
  recoverySucceeded: z.boolean().default(false),
});

export type OasisValidationPageContext = z.infer<typeof oasisValidationPageContextSchema>;

export const oasisValidationResultSchema = z.object({
  status: oasisValidationStatusSchema,
  validatedAt: z.string().min(1),
  validateSelectorUsed: z.string().min(1).nullable().default(null),
  currentUrl: z.string().min(1).nullable().default(null),
  missingFieldCount: z.number().int().nonnegative().default(0),
  missingFields: z.array(oasisValidationMissingFieldSchema).default([]),
  rawMessages: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  pageContext: oasisValidationPageContextSchema.nullable().optional(),
});

export type OasisValidationResult = z.infer<typeof oasisValidationResultSchema>;

export const referralOasisConsistencyCategorySchema = z.enum([
  "cognition",
  "wound",
  "respiratory",
  "mobility",
  "therapy_need",
  "other",
]);

export type ReferralOasisConsistencyCategory = z.infer<
  typeof referralOasisConsistencyCategorySchema
>;

export const referralOasisConsistencyConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
]);

export type ReferralOasisConsistencyConfidence = z.infer<
  typeof referralOasisConsistencyConfidenceSchema
>;

export const referralOasisConsistencyFindingSchema = z.object({
  id: z.string().min(1),
  category: referralOasisConsistencyCategorySchema,
  label: z.string().min(1),
  confidence: referralOasisConsistencyConfidenceSchema,
  referralEvidence: z.string().min(1),
  oasisEvidence: z.string().min(1),
  reviewerExplanation: z.string().min(1),
  blocksPlanOfCare: z.boolean().default(false),
});

export type ReferralOasisConsistencyFinding = z.infer<
  typeof referralOasisConsistencyFindingSchema
>;

export const referralOasisConsistencyStatusSchema = z.enum([
  "clear",
  "contradictions_found",
  "consistency_unavailable",
]);

export type ReferralOasisConsistencyStatus = z.infer<
  typeof referralOasisConsistencyStatusSchema
>;

export const referralOasisConsistencyResultSchema = z.object({
  status: referralOasisConsistencyStatusSchema,
  generatedAt: z.string().min(1),
  findingCount: z.number().int().nonnegative().default(0),
  blockingFindingCount: z.number().int().nonnegative().default(0),
  findings: z.array(referralOasisConsistencyFindingSchema).default([]),
  warnings: z.array(z.string().min(1)).default([]),
});

export type ReferralOasisConsistencyResult = z.infer<
  typeof referralOasisConsistencyResultSchema
>;

export const oasisGateStatusSchema = z.enum([
  "passed",
  "failed_missing_fields",
  "failed_referral_mismatch",
  "failed_both",
  "unavailable",
]);

export type OasisGateStatus = z.infer<typeof oasisGateStatusSchema>;

export const oasisGateResultSchema = z.object({
  evaluatedAt: z.string().min(1),
  status: oasisGateStatusSchema,
  blockedFromPlanOfCare: z.boolean().default(false),
  missingFieldCount: z.number().int().nonnegative().default(0),
  contradictionCount: z.number().int().nonnegative().default(0),
  topReasons: z.array(z.string().min(1)).default([]),
  planOfCareAttempted: z.boolean().default(false),
  planOfCareAttemptSkippedReason: z.string().min(1).nullable().default(null),
});

export type OasisGateResult = z.infer<typeof oasisGateResultSchema>;
