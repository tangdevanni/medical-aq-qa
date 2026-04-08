import { z } from "zod";
import { crossDocumentQaConfidenceSchema } from "./cross-document-qa";
import { documentKindSchema } from "./document-extraction";

export const decisionConfidenceSchema = crossDocumentQaConfidenceSchema;

export type DecisionConfidence = z.infer<typeof decisionConfidenceSchema>;

export const qaDecisionActionabilitySchema = z.enum([
  "ACTIONABLE",
  "REVIEW_ONLY",
  "NOT_ACTIONABLE",
]);

export type QaDecisionActionability = z.infer<typeof qaDecisionActionabilitySchema>;

export const qaDecisionAutoFixEligibilitySchema = z.enum([
  "SAFE_AUTOFIX_CANDIDATE",
  "MANUAL_REVIEW_REQUIRED",
  "NOT_ELIGIBLE",
]);

export type QaDecisionAutoFixEligibility = z.infer<typeof qaDecisionAutoFixEligibilitySchema>;

export const qaDecisionTypeSchema = z.enum([
  "PROPOSE_UPDATE",
  "PROPOSE_APPEND",
  "PROPOSE_REVIEW",
  "PROPOSE_SKIP",
]);

export type QaDecisionType = z.infer<typeof qaDecisionTypeSchema>;

export const qaDecisionIssueTypeSchema = z.enum([
  "DIAGNOSIS_MISMATCH",
  "FREQUENCY_MISMATCH",
  "MISSING_HOMEBOUND_REASON",
  "ORDER_NOT_REFERENCED",
  "missing_subjective",
  "missing_diagnosis",
  "missing_visit_summary",
  "sparse_note",
]);

export type QaDecisionIssueType = z.infer<typeof qaDecisionIssueTypeSchema>;

export const humanReviewReasonSchema = z.enum([
  "LOW_BUNDLE_CONFIDENCE",
  "MULTIPLE_CANDIDATE_DOCUMENTS",
  "MISSING_SOURCE_ANCHOR",
  "MISSING_TARGET_FIELD",
  "EPISODE_ASSOCIATION_WEAK",
  "EPISODE_ASSOCIATION_REVIEW_REQUIRED",
  "CLINICALLY_SENSITIVE_NARRATIVE",
  "INSUFFICIENT_EVIDENCE",
  "SOURCE_OF_TRUTH_REVIEW_REQUIRED",
  "DOCUMENT_KIND_REVIEW_REQUIRED",
  "TARGET_FIELD_NOT_LOCATED",
]);

export type HumanReviewReason = z.infer<typeof humanReviewReasonSchema>;

export const sourceOfTruthCandidateSchema = z.object({
  sourceDocumentKind: documentKindSchema.nullable(),
  targetDocumentKind: documentKindSchema.nullable(),
  confidence: decisionConfidenceSchema,
  reason: z.string().min(1),
});

export type SourceOfTruthCandidate = z.infer<typeof sourceOfTruthCandidateSchema>;

export const qaDecisionActionSchema = z.object({
  targetDocumentKind: documentKindSchema.nullable(),
  targetField: z.string().min(1).nullable(),
  action: z.enum([
    "UPDATE_FIELD",
    "APPEND_FIELD",
    "REVIEW_FIELD",
    "NO_ACTION",
  ]),
  proposedValue: z.string().min(1).nullable(),
  changeStrategy: z.enum(["REPLACE", "APPEND", "NONE"]),
});

export type QaDecisionAction = z.infer<typeof qaDecisionActionSchema>;

export const qaDecisionEvidenceAnchorSchema = z.object({
  documentKind: documentKindSchema,
  field: z.string().min(1),
  summary: z.string().min(1).nullable(),
});

export type QaDecisionEvidenceAnchor = z.infer<typeof qaDecisionEvidenceAnchorSchema>;

export const qaDecisionEvidenceSchema = z.object({
  sourceAnchors: z.array(qaDecisionEvidenceAnchorSchema),
  targetAnchors: z.array(qaDecisionEvidenceAnchorSchema),
  warningCodes: z.array(z.string().min(1)),
});

export type QaDecisionEvidence = z.infer<typeof qaDecisionEvidenceSchema>;

export const qaDecisionSchema = z.object({
  decisionType: qaDecisionTypeSchema,
  issueType: qaDecisionIssueTypeSchema,
  actionability: qaDecisionActionabilitySchema,
  autoFixEligibility: qaDecisionAutoFixEligibilitySchema,
  confidence: decisionConfidenceSchema,
  sourceOfTruth: sourceOfTruthCandidateSchema.nullable(),
  proposedAction: qaDecisionActionSchema,
  reason: z.string().min(1),
  evidence: qaDecisionEvidenceSchema,
  humanReviewReasons: z.array(humanReviewReasonSchema),
});

export type QaDecision = z.infer<typeof qaDecisionSchema>;

export const qaDecisionWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  issueType: qaDecisionIssueTypeSchema.nullable().optional(),
});

export type QaDecisionWarning = z.infer<typeof qaDecisionWarningSchema>;

export const qaDecisionSummarySchema = z.object({
  actionableCount: z.number().int().nonnegative(),
  reviewOnlyCount: z.number().int().nonnegative(),
  notActionableCount: z.number().int().nonnegative(),
  safeAutofixCandidateCount: z.number().int().nonnegative(),
  manualReviewRequiredCount: z.number().int().nonnegative(),
  issuesByType: z.record(z.string().min(1), z.number().int().nonnegative()),
  decisionsByTargetDocument: z.record(z.string().min(1), z.number().int().nonnegative()),
});

export type QaDecisionSummary = z.infer<typeof qaDecisionSummarySchema>;

export const qaDecisionResultSchema = z.object({
  decisions: z.array(qaDecisionSchema),
  warnings: z.array(qaDecisionWarningSchema),
  summary: qaDecisionSummarySchema,
});

export type QaDecisionResult = z.infer<typeof qaDecisionResultSchema>;

export const qaDecisionRunCountSchema = z.object({
  key: z.string().min(1),
  count: z.number().int().positive(),
});

export type QaDecisionRunCount = z.infer<typeof qaDecisionRunCountSchema>;

export const qaDecisionRunSummarySchema = z.object({
  totalDecisions: z.number().int().nonnegative(),
  actionableCount: z.number().int().nonnegative(),
  reviewOnlyCount: z.number().int().nonnegative(),
  notActionableCount: z.number().int().nonnegative(),
  safeAutofixCandidateCount: z.number().int().nonnegative(),
  manualReviewRequiredCount: z.number().int().nonnegative(),
  topIssueTypes: z.array(qaDecisionRunCountSchema),
  topTargetDocumentKinds: z.array(qaDecisionRunCountSchema),
});

export type QaDecisionRunSummary = z.infer<typeof qaDecisionRunSummarySchema>;
