import { z } from "zod";
import { documentKindSchema } from "./document-extraction";

export const crossDocumentQaConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export type CrossDocumentQaConfidence = z.infer<typeof crossDocumentQaConfidenceSchema>;

export const crossDocumentQaMismatchTypeSchema = z.enum([
  "DIAGNOSIS_MISMATCH",
  "FREQUENCY_MISMATCH",
  "MISSING_HOMEBOUND_REASON",
  "ORDER_NOT_REFERENCED",
]);

export type CrossDocumentQaMismatchType = z.infer<typeof crossDocumentQaMismatchTypeSchema>;

export const crossDocumentQaAlignmentTypeSchema = z.enum([
  "DIAGNOSIS_ALIGNED",
  "FREQUENCY_ALIGNED",
  "HOMEBOUND_DOCUMENTED",
  "ORDER_REFERENCED",
]);

export type CrossDocumentQaAlignmentType = z.infer<typeof crossDocumentQaAlignmentTypeSchema>;

const crossDocumentQaFindingBaseSchema = z.object({
  confidence: crossDocumentQaConfidenceSchema,
  reason: z.string().min(1),
  sources: z.array(documentKindSchema).min(1),
});

export const crossDocumentQaMismatchSchema = crossDocumentQaFindingBaseSchema.extend({
  type: crossDocumentQaMismatchTypeSchema,
});

export type CrossDocumentQaMismatch = z.infer<typeof crossDocumentQaMismatchSchema>;

export const crossDocumentQaAlignmentSchema = crossDocumentQaFindingBaseSchema.extend({
  type: crossDocumentQaAlignmentTypeSchema,
});

export type CrossDocumentQaAlignment = z.infer<typeof crossDocumentQaAlignmentSchema>;

export const crossDocumentQaWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  sources: z.array(documentKindSchema).default([]),
});

export type CrossDocumentQaWarning = z.infer<typeof crossDocumentQaWarningSchema>;

export const crossDocumentQaResultSchema = z.object({
  bundleConfidence: crossDocumentQaConfidenceSchema,
  bundleReason: z.string().min(1).nullable(),
  mismatches: z.array(crossDocumentQaMismatchSchema),
  alignments: z.array(crossDocumentQaAlignmentSchema),
  warnings: z.array(crossDocumentQaWarningSchema),
});

export type CrossDocumentQaResult = z.infer<typeof crossDocumentQaResultSchema>;
