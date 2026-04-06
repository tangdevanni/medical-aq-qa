import { z } from "zod";
import { automationStepLogSchema } from "./automation-step-log";
import { documentInventoryItemSchema } from "./document-inventory";
import { emptyOasisQaSummary, oasisQaSummarySchema } from "./oasis-qa";
import { patientProcessingStatusSchema, qaOutcomeSchema } from "./batch-pipeline";

export const patientRunLogSchema = z.object({
  schemaVersion: z.literal("1"),
  generatedAt: z.string().min(1),
  runId: z.string().min(1),
  batchId: z.string().min(1),
  workItemId: z.string().min(1),
  patientName: z.string().min(1),
  processingStatus: patientProcessingStatusSchema,
  executionStep: z.string().min(1),
  qaOutcome: qaOutcomeSchema,
  progressPercent: z.number().min(0).max(100),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().min(1),
  artifactCount: z.number().int().nonnegative(),
  findingsCount: z.number().int().nonnegative(),
  bundlePath: z.string().min(1).nullable(),
  oasisQaSummary: oasisQaSummarySchema.default(emptyOasisQaSummary),
  documentInventory: z.array(documentInventoryItemSchema).default([]),
  errorSummary: z.string().min(1).nullable(),
  automationStepLogs: z.array(automationStepLogSchema).default([]),
  notes: z.array(z.string().min(1)),
  auditArtifacts: z.object({
    tracePath: z.string().min(1).nullable(),
    screenshotPaths: z.array(z.string().min(1)),
    downloadPaths: z.array(z.string().min(1)),
  }),
});

export type PatientRunLog = z.infer<typeof patientRunLogSchema>;
