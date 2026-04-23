import { z } from "zod";

export const documentKindSchema = z.enum([
  "VISIT_NOTE",
  "OASIS",
  "PLAN_OF_CARE",
  "ADMISSION_ORDER",
  "PHYSICIAN_ORDER",
  "UNKNOWN",
]);

export type DocumentKind = z.infer<typeof documentKindSchema>;

export const documentPageTypeSchema = z.enum([
  "visit_note",
  "oasis",
  "plan_of_care",
  "admission_order",
  "physician_order",
  "unknown",
]);

export type DocumentPageType = z.infer<typeof documentPageTypeSchema>;

export const documentSignedStateSchema = z.enum([
  "signed",
  "unsigned",
  "validated",
  "pending_signature",
  "unknown",
]);

export type DocumentSignedState = z.infer<typeof documentSignedStateSchema>;

export const documentExtractionSectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).nullable(),
  present: z.boolean(),
  visible: z.boolean(),
  textLength: z.number().int().nonnegative(),
  hasMeaningfulContent: z.boolean(),
  sample: z.string().min(1).nullable(),
});

export type DocumentExtractionSection = z.infer<typeof documentExtractionSectionSchema>;

export const documentExtractionMetadataSchema = z.object({
  pageTitle: z.string().min(1).nullable(),
  documentLabel: z.string().min(1).nullable(),
  patientMaskedId: z.string().min(1).nullable(),
  visitDate: z.string().min(1).nullable(),
  physician: z.string().min(1).nullable(),
  signedState: documentSignedStateSchema.nullable(),
  diagnosisSummary: z.string().min(1).nullable(),
  frequencySummary: z.string().min(1).nullable(),
  homeboundSummary: z.string().min(1).nullable(),
  orderSummary: z.string().min(1).nullable(),
});

export type DocumentExtractionMetadata = z.infer<typeof documentExtractionMetadataSchema>;

export const documentExtractionWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  selector: z.string().min(1).nullable().optional(),
});

export type DocumentExtractionWarning = z.infer<typeof documentExtractionWarningSchema>;

export const documentExtractionSchema = z.object({
  documentKind: documentKindSchema,
  pageType: documentPageTypeSchema,
  url: z.string().min(1),
  extractedAt: z.string().min(1),
  metadata: documentExtractionMetadataSchema,
  sections: z.array(documentExtractionSectionSchema),
  warnings: z.array(documentExtractionWarningSchema),
});

export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;
