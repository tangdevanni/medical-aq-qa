import { z } from "zod";
import { patientMatchResultSchema } from "./batch-pipeline";
import { patientEpisodeWorkItemSchema } from "./patient-episode-work-item";

export const identityConfidenceSchema = z.enum([
  "portal_id",
  "mr_number",
  "name_dob",
  "name_soc",
  "name_only_review",
  "ambiguous",
]);

export type IdentityConfidence = z.infer<typeof identityConfidenceSchema>;

export const patientMemoryArtifactMetadataSchema = z.object({
  name: z.string().min(1),
  relativePath: z.string().min(1),
  currentPath: z.string().min(1),
  sourcePath: z.string().min(1).nullable(),
  sizeBytes: z.number().int().nonnegative(),
  promotedAt: z.string().min(1),
});

export type PatientMemoryArtifactMetadata = z.infer<typeof patientMemoryArtifactMetadataSchema>;

export const patientMemoryCurrentMetadataSchema = z.object({
  updatedAt: z.string().min(1),
  batchId: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
  workItemId: z.string().min(1).nullable(),
  sourcePatientArtifactsDirectory: z.string().min(1).nullable(),
  artifacts: z.record(z.string(), patientMemoryArtifactMetadataSchema),
});

export type PatientMemoryCurrentMetadata = z.infer<typeof patientMemoryCurrentMetadataSchema>;

export const patientMemoryHistorySnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  createdAt: z.string().min(1),
  reason: z.string().min(1),
  batchId: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
  workItemId: z.string().min(1).nullable(),
  snapshotPath: z.string().min(1),
  artifactNames: z.array(z.string().min(1)),
});

export type PatientMemoryHistorySnapshot = z.infer<typeof patientMemoryHistorySnapshotSchema>;

export const patientMemoryIdentitySchema = z.object({
  displayName: z.string().min(1),
  normalizedName: z.string().min(1),
  medicareNumber: z.string().min(1).nullable(),
  portalPatientId: z.string().min(1).nullable(),
  portalDisplayName: z.string().min(1).nullable(),
  identityConfidence: identityConfidenceSchema,
  identityKeys: z.array(z.string().min(1)),
  lastResolvedAt: z.string().min(1),
  lastMatchResult: patientMatchResultSchema.nullable(),
});

export type PatientMemoryIdentity = z.infer<typeof patientMemoryIdentitySchema>;

export const patientMemoryRecordSchema = z.object({
  schemaVersion: z.literal("patient-memory-record.v1"),
  agencySlug: z.string().min(1),
  patientMemoryId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  identity: patientMemoryIdentitySchema,
  current: patientMemoryCurrentMetadataSchema.nullable(),
  history: z.array(patientMemoryHistorySnapshotSchema),
});

export type PatientMemoryRecord = z.infer<typeof patientMemoryRecordSchema>;

export const patientMemoryIndexSchema = z.object({
  schemaVersion: z.literal("patient-memory-index.v1"),
  agencySlug: z.string().min(1),
  generatedAt: z.string().min(1),
  records: z.record(z.string(), patientMemoryRecordSchema),
  identityAliases: z.record(z.string(), z.string().min(1)),
});

export type PatientMemoryIndex = z.infer<typeof patientMemoryIndexSchema>;

export const patientRunDeltaArtifactActionSchema = z.object({
  name: z.string().min(1),
  relativePath: z.string().min(1),
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  action: z.enum(["promote", "seed"]),
  copied: z.boolean(),
  reason: z.string().min(1).nullable(),
});

export type PatientRunDeltaArtifactAction = z.infer<typeof patientRunDeltaArtifactActionSchema>;

export const patientRunDeltaPlanSchema = z.object({
  schemaVersion: z.literal("patient-run-delta-plan.v1"),
  agencySlug: z.string().min(1),
  patientMemoryId: z.string().min(1),
  workItem: patientEpisodeWorkItemSchema.nullable(),
  identityConfidence: identityConfidenceSchema,
  createdAt: z.string().min(1),
  sourcePatientArtifactsDirectory: z.string().min(1).nullable(),
  targetPatientArtifactsDirectory: z.string().min(1).nullable(),
  currentDirectory: z.string().min(1),
  historySnapshotPath: z.string().min(1).nullable(),
  actions: z.array(patientRunDeltaArtifactActionSchema),
});

export type PatientRunDeltaPlan = z.infer<typeof patientRunDeltaPlanSchema>;
