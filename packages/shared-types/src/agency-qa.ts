import { z } from "zod";
import { workflowTypeSchema } from "./patient-episode-work-item";
import { subsidiaryStatusSchema } from "./subsidiary";

export const agencySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  status: subsidiaryStatusSchema,
  timezone: z.string().min(1),
});

export type Agency = z.infer<typeof agencySchema>;

export const workbookSourceKindSchema = z.enum([
  "configured_path",
  "manual_upload",
  "finale_download",
  "unknown",
]);

export type WorkbookSourceKind = z.infer<typeof workbookSourceKindSchema>;

export const workbookAcquisitionMetadataSchema = z.object({
  providerId: z.string().min(1).nullable().default(null),
  acquisitionReference: z.string().min(1).nullable().default(null),
  metadataPath: z.string().min(1).nullable().default(null),
  selectedAgencyName: z.string().min(1).nullable().default(null),
  selectedAgencyUrl: z.string().min(1).nullable().default(null),
  dashboardUrl: z.string().min(1).nullable().default(null),
  notes: z.array(z.string().min(1)).default([]),
});

export type WorkbookAcquisitionMetadata = z.infer<typeof workbookAcquisitionMetadataSchema>;

export const workbookVerificationSchema = z.object({
  usable: z.boolean().default(true),
  verifiedAt: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative(),
  fileExtension: z.string().min(1),
  sheetNames: z.array(z.string().min(1)).default([]),
  detectedSourceTypes: z.array(z.string().min(1)).default([]),
  warningCount: z.number().int().nonnegative().default(0),
});

export type WorkbookVerification = z.infer<typeof workbookVerificationSchema>;

export const workbookSourceSchema = z.object({
  agencyId: z.string().min(1),
  batchId: z.string().min(1),
  kind: workbookSourceKindSchema,
  path: z.string().min(1),
  originalFileName: z.string().min(1),
  sourceLabel: z.string().min(1),
  acquiredAt: z.string().min(1),
  ingestedAt: z.string().min(1),
  acquisition: workbookAcquisitionMetadataSchema.default({
    providerId: null,
    acquisitionReference: null,
    metadataPath: null,
    selectedAgencyName: null,
    selectedAgencyUrl: null,
    dashboardUrl: null,
    notes: [],
  }),
  verification: workbookVerificationSchema.nullable().default(null),
});

export type WorkbookSource = z.infer<typeof workbookSourceSchema>;

export const reviewWindowSchema = z.object({
  id: z.string().min(1),
  agencyId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  durationDays: z.number().int().positive().default(15),
  timezone: z.string().min(1),
  label: z.string().min(1),
});

export type ReviewWindow = z.infer<typeof reviewWindowSchema>;

export const patientEligibilityReasonSchema = z.enum([
  "non_admit",
  "pending",
  "excluded_other",
]);

export type PatientEligibilityReason = z.infer<typeof patientEligibilityReasonSchema>;

export const patientEligibilityDecisionSchema = z.object({
  eligible: z.boolean(),
  reason: patientEligibilityReasonSchema.nullable().default(null),
  rationale: z.string().min(1),
  matchedSignals: z.array(z.string().min(1)).default([]),
});

export type PatientEligibilityDecision = z.infer<typeof patientEligibilityDecisionSchema>;

export const queueEntryStatusSchema = z.enum([
  "eligible",
  "skipped_non_admit",
  "skipped_pending",
  "excluded_other",
]);

export type QueueEntryStatus = z.infer<typeof queueEntryStatusSchema>;

export const queueEntrySchema = z.object({
  id: z.string().min(1),
  agencyId: z.string().min(1),
  batchId: z.string().min(1),
  workItemId: z.string().min(1),
  patientName: z.string().min(1),
  reviewWindowId: z.string().min(1),
  workflowTypes: z.array(workflowTypeSchema).default([]),
  status: queueEntryStatusSchema,
  eligibility: patientEligibilityDecisionSchema,
  episodeDate: z.string().min(1).nullable(),
  socDate: z.string().min(1).nullable(),
  billingPeriod: z.string().min(1).nullable(),
  sourceSheets: z.array(z.string().min(1)).default([]),
  sourceRowNumbers: z.array(z.number().int().positive()).default([]),
  notes: z.array(z.string().min(1)).default([]),
  createdAt: z.string().min(1),
});

export type QueueEntry = z.infer<typeof queueEntrySchema>;

export const patientQueueArtifactSchema = z.object({
  generatedAt: z.string().min(1),
  agencyId: z.string().min(1),
  batchId: z.string().min(1),
  reviewWindowId: z.string().min(1),
  summary: z.object({
    total: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    skippedNonAdmit: z.number().int().nonnegative(),
    skippedPending: z.number().int().nonnegative(),
    excludedOther: z.number().int().nonnegative(),
  }),
  entries: z.array(queueEntrySchema),
});

export type PatientQueueArtifact = z.infer<typeof patientQueueArtifactSchema>;

export const refreshCycleSchema = z.object({
  id: z.string().min(1),
  agencyId: z.string().min(1),
  batchId: z.string().min(1),
  status: z.enum(["pending", "running", "completed", "failed"]),
  workbookSource: workbookSourceSchema,
  reviewWindow: reviewWindowSchema,
  scheduleTimezone: z.string().min(1),
  scheduleLocalTimes: z.array(z.string().min(1)).min(1),
  lastRefreshStartedAt: z.string().min(1).nullable(),
  lastRefreshCompletedAt: z.string().min(1).nullable(),
  nextRefreshAt: z.string().min(1).nullable(),
  queueSummary: patientQueueArtifactSchema.shape.summary,
});

export type RefreshCycle = z.infer<typeof refreshCycleSchema>;

export const dashboardPatientRecordSchema = z.object({
  queueEntry: queueEntrySchema,
  runId: z.string().min(1).nullable(),
  patientId: z.string().min(1).nullable(),
  processingStatus: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().min(1).nullable(),
  errorSummary: z.string().min(1).nullable(),
});

export type DashboardPatientRecord = z.infer<typeof dashboardPatientRecordSchema>;

export const agencyDashboardSnapshotSchema = z.object({
  agency: agencySchema,
  refreshCycle: refreshCycleSchema.nullable(),
  queueEntries: z.array(queueEntrySchema),
  patientRecords: z.array(dashboardPatientRecordSchema),
  lastUpdatedAt: z.string().min(1),
});

export type AgencyDashboardSnapshot = z.infer<typeof agencyDashboardSnapshotSchema>;
