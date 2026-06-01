import { z } from "zod";

export const evidenceItemSchema = z.object({
  artifact: z.string().min(1),
  sourceType: z.string().min(1),
  sourceLabel: z.string().min(1),
  snippet: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const clinicalComparisonVerdictSchema = z.enum([
  "match",
  "mismatch",
  "missing_in_referral",
  "missing_in_oasis",
  "uncertain",
]);

export const clinicalComparisonSeveritySchema = z.enum(["low", "medium", "high"]);

export const clinicalComparisonRowSchema = z.object({
  fieldKey: z.string().min(1),
  category: z.string().min(1),
  referralValue: z.string().min(1).nullable(),
  oasisValue: z.string().min(1).nullable(),
  verdict: clinicalComparisonVerdictSchema,
  confidence: z.number().min(0).max(1),
  severity: clinicalComparisonSeveritySchema,
  rationale: z.string().min(1),
  referralEvidence: z.array(evidenceItemSchema),
  oasisEvidence: z.array(evidenceItemSchema),
  needsReview: z.boolean(),
  sources: z.object({
    referralArtifacts: z.array(z.string().min(1)),
    oasisArtifacts: z.array(z.string().min(1)),
  }),
});

export type ClinicalComparisonRow = z.infer<typeof clinicalComparisonRowSchema>;

export const clinicalComparisonRowsSchema = z.array(clinicalComparisonRowSchema);
