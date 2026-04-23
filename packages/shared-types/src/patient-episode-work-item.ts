import { z } from "zod";

export const stageStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "REVIEW_REQUIRED",
  "DONE",
]);

export type StageStatus = z.infer<typeof stageStatusSchema>;

export const workflowTypeSchema = z.enum([
  "SOC",
  "ROC",
  "RECERT",
  "DC",
  "TRANSFER",
  "DEATH",
  "VISIT_NOTES",
  "BILLING_PREP",
]);

export type WorkflowType = z.infer<typeof workflowTypeSchema>;

export const sourceRowReferenceSchema = z.object({
  workflowTypes: z.array(workflowTypeSchema).min(1),
  sourceSheet: z.string().min(1),
  sourceRowNumber: z.number().int().positive(),
});

export type SourceRowReference = z.infer<typeof sourceRowReferenceSchema>;

export const sourceValueSnapshotSchema = z.object({
  sourceSheet: z.string().min(1),
  sourceRowNumber: z.number().int().positive(),
  values: z.record(z.string(), z.string().nullable()),
});

export type SourceValueSnapshot = z.infer<typeof sourceValueSnapshotSchema>;

export const stageRemarkSchema = z.object({
  workflowTypes: z.array(workflowTypeSchema).min(1),
  sourceSheet: z.string().min(1),
  field: z.string().min(1),
  value: z.string().min(1),
});

export type StageRemark = z.infer<typeof stageRemarkSchema>;

export const patientIdentitySchema = z.object({
  displayName: z.string().min(1),
  normalizedName: z.string().min(1),
  medicareNumber: z.string().min(1).nullable().optional(),
});

export type PatientIdentity = z.infer<typeof patientIdentitySchema>;

export const timingMetadataSchema = z.object({
  trackingDays: z.number().int().nullable().default(null),
  daysInPeriod: z.number().int().nullable().default(null),
  daysLeft: z.number().int().nullable().default(null),
  daysLeftBeforeOasisDueDate: z.number().int().nullable().default(null),
  rawTrackingValues: z.array(z.string().min(1)),
  rawDaysInPeriodValues: z.array(z.string().min(1)).default([]),
  rawDaysLeftValues: z.array(z.string().min(1)).default([]),
});

export type TimingMetadata = z.infer<typeof timingMetadataSchema>;

export const episodeContextSchema = z.object({
  episodeDate: z.string().min(1).nullable(),
  socDate: z.string().min(1).nullable(),
  episodePeriod: z.string().min(1).nullable(),
  billingPeriod: z.string().min(1).nullable(),
  payer: z.string().min(1).nullable(),
  assignedStaff: z.string().min(1).nullable(),
  clinician: z.string().min(1).nullable(),
  qaSpecialist: z.string().min(1).nullable(),
  rfa: z.string().min(1).nullable(),
});

export type EpisodeContext = z.infer<typeof episodeContextSchema>;

export const patientEpisodeWorkItemSchema = z.object({
  id: z.string().min(1),
  subsidiaryId: z.string().min(1).default("default"),
  patientIdentity: patientIdentitySchema,
  episodeContext: episodeContextSchema,
  workflowTypes: z.array(workflowTypeSchema).min(1),
  sourceSheets: z.array(z.string().min(1)).min(1),
  timingMetadata: timingMetadataSchema.optional(),
  codingReviewStatus: stageStatusSchema,
  oasisQaStatus: stageStatusSchema,
  pocQaStatus: stageStatusSchema,
  visitNotesQaStatus: stageStatusSchema,
  billingPrepStatus: stageStatusSchema,
  sourceRemarks: z.array(stageRemarkSchema),
  sourceRowReferences: z.array(sourceRowReferenceSchema),
  sourceValues: z.array(sourceValueSnapshotSchema),
  importWarnings: z.array(z.string().min(1)),
});

export type PatientEpisodeWorkItem = z.infer<typeof patientEpisodeWorkItemSchema>;
