import { z } from "zod";

const visitNoteQaEvidenceValueSchema = z.union([
  z.string().min(1),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().min(1)),
  z.array(z.number()),
  z.array(z.boolean()),
]);

export const visitNoteQaSectionIdSchema = z.enum([
  "subjective-info",
  "diagnosis-history",
  "visit-summary",
  "safety-issues",
  "functional-mobility",
]);

export type VisitNoteQaSectionId = z.infer<typeof visitNoteQaSectionIdSchema>;

export const visitNoteQaStatusSchema = z.enum(["PASS", "FAIL", "NEEDS_REVIEW"]);

export type VisitNoteQaStatus = z.infer<typeof visitNoteQaStatusSchema>;

export const visitNoteQaSignatureStateSchema = z.enum(["signed", "unsigned"]);

export type VisitNoteQaSignatureState = z.infer<typeof visitNoteQaSignatureStateSchema>;

export const visitNoteQaSectionSchema = z.object({
  id: visitNoteQaSectionIdSchema,
  label: z.string().min(1).nullable(),
  present: z.boolean(),
  visible: z.boolean(),
  textLength: z.number().int().nonnegative(),
  hasMeaningfulContent: z.boolean(),
  sample: z.string().min(1).nullable(),
});

export type VisitNoteQaSection = z.infer<typeof visitNoteQaSectionSchema>;

export const visitNoteQaMetadataSchema = z.object({
  noteType: z.string().min(1).nullable(),
  pageTitle: z.string().min(1).nullable(),
  documentRoute: z.string().min(1).nullable(),
  signatureState: visitNoteQaSignatureStateSchema.nullable(),
  visitDate: z.string().min(1).nullable(),
});

export type VisitNoteQaMetadata = z.infer<typeof visitNoteQaMetadataSchema>;

export const visitNoteQaWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  sectionId: visitNoteQaSectionIdSchema.nullable().optional(),
  selector: z.string().min(1).nullable().optional(),
});

export type VisitNoteQaWarning = z.infer<typeof visitNoteQaWarningSchema>;

export const visitNoteQaRuleSchema = z.object({
  id: z.string().min(1),
  status: visitNoteQaStatusSchema,
  reason: z.string().min(1),
  evidence: z.record(z.string().min(1), visitNoteQaEvidenceValueSchema),
});

export type VisitNoteQaRule = z.infer<typeof visitNoteQaRuleSchema>;

export const visitNoteQaSummarySchema = z.object({
  overallStatus: visitNoteQaStatusSchema,
  missingSections: z.array(visitNoteQaSectionIdSchema),
  reviewFlags: z.array(z.string().min(1)),
  meaningfulSectionCount: z.number().int().nonnegative(),
  totalMeaningfulTextLength: z.number().int().nonnegative(),
});

export type VisitNoteQaSummary = z.infer<typeof visitNoteQaSummarySchema>;

export const visitNoteQaReportSchema = z.object({
  pageType: z.literal("visit_note"),
  url: z.string().min(1),
  extractedAt: z.string().min(1),
  sections: z.array(visitNoteQaSectionSchema),
  metadata: visitNoteQaMetadataSchema,
  rules: z.array(visitNoteQaRuleSchema),
  summary: visitNoteQaSummarySchema,
  warnings: z.array(visitNoteQaWarningSchema),
});

export type VisitNoteQaReport = z.infer<typeof visitNoteQaReportSchema>;
