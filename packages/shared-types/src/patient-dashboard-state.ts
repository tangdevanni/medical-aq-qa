import { z } from "zod";
import {
  patientMatchResultSchema,
  patientProcessingStatusSchema,
  qaOutcomeSchema,
} from "./batch-pipeline";
import { emptyOasisQaSummary, oasisQaSummarySchema } from "./oasis-qa";
import { patientEpisodeWorkItemSchema } from "./patient-episode-work-item";
import { patientWorkflowRunSchema } from "./patient-workflow-run";

export const patientDashboardArtifactPathsSchema = z.object({
  codingInput: z.string().min(1),
  documentText: z.string().min(1),
  qaPrefetch: z.string().min(1).nullable(),
  patientQaReference: z.string().min(1),
  qaDocumentSummary: z.string().min(1),
  fieldMapSnapshot: z.string().min(1),
  printedNoteChartValues: z.string().min(1).nullable(),
  printedNoteReview: z.string().min(1).nullable(),
});

export type PatientDashboardArtifactPaths = z.infer<typeof patientDashboardArtifactPathsSchema>;

export const patientDashboardArtifactContentsSchema = z.object({
  codingInput: z.unknown().nullable(),
  documentText: z.unknown().nullable(),
  qaPrefetch: z.unknown().nullable(),
  patientQaReference: z.unknown().nullable(),
  qaDocumentSummary: z.unknown().nullable(),
  fieldMapSnapshot: z.unknown().nullable(),
  printedNoteChartValues: z.unknown().nullable(),
  printedNoteReview: z.unknown().nullable(),
});

export type PatientDashboardArtifactContents = z.infer<typeof patientDashboardArtifactContentsSchema>;

export const patientDashboardStateSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  batchId: z.string().min(1),
  patientId: z.string().min(1),
  runId: z.string().min(1),
  subsidiaryId: z.string().min(1).default("default"),
  patientName: z.string().min(1),
  processingStatus: patientProcessingStatusSchema,
  executionStep: z.string().min(1),
  progressPercent: z.number().min(0).max(100),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().min(1),
  matchResult: patientMatchResultSchema,
  qaOutcome: qaOutcomeSchema,
  oasisQaSummary: oasisQaSummarySchema.default(emptyOasisQaSummary),
  artifactCount: z.number().int().nonnegative(),
  hasFindings: z.boolean(),
  bundleAvailable: z.boolean(),
  resultBundlePath: z.string().min(1).nullable(),
  logPath: z.string().min(1).nullable(),
  errorSummary: z.string().min(1).nullable(),
  workItem: patientEpisodeWorkItemSchema.nullable(),
  workflowRuns: z.array(patientWorkflowRunSchema).default([]),
  artifactPaths: patientDashboardArtifactPathsSchema,
  artifactContents: patientDashboardArtifactContentsSchema,
});

export type PatientDashboardState = z.infer<typeof patientDashboardStateSchema>;
