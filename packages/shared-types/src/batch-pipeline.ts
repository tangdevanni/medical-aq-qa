import { z } from "zod";
import { automationStepLogSchema } from "./automation-step-log";
import { documentInventoryItemSchema } from "./document-inventory";
import { emptyOasisQaSummary, oasisQaSummarySchema } from "./oasis-qa";
import { patientEpisodeWorkItemSchema } from "./patient-episode-work-item";

export const batchStatusSchema = z.enum([
  "CREATED",
  "PARSING",
  "READY",
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_EXCEPTIONS",
  "FAILED",
]);

export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const patientProcessingStatusSchema = z.enum([
  "PENDING",
  "MATCHING_PATIENT",
  "DISCOVERING_CHART",
  "COLLECTING_EVIDENCE",
  "RUNNING_QA",
  "COMPLETE",
  "BLOCKED",
  "FAILED",
  "NEEDS_HUMAN_REVIEW",
]);

export type PatientProcessingStatus = z.infer<typeof patientProcessingStatusSchema>;

export const qaOutcomeSchema = z.enum([
  "READY_FOR_BILLING_PREP",
  "INCOMPLETE",
  "MISSING_DOCUMENTS",
  "PORTAL_NOT_FOUND",
  "PORTAL_MISMATCH",
  "AMBIGUOUS_PATIENT",
  "NEEDS_MANUAL_QA",
]);

export type QaOutcome = z.infer<typeof qaOutcomeSchema>;

export const parserExceptionSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  sourceSheet: z.string().min(1),
  sourceRowNumber: z.number().int().positive(),
  patientDisplayName: z.string().min(1).nullable(),
  rawValues: z.record(z.string(), z.string().nullable()),
  createdAt: z.string().min(1),
});

export type ParserException = z.infer<typeof parserExceptionSchema>;

export const batchManifestSchema = z.object({
  batchId: z.string().min(1),
  createdAt: z.string().min(1),
  status: batchStatusSchema,
  workbookPath: z.string().min(1),
  outputDirectory: z.string().min(1),
  billingPeriod: z.string().min(1).nullable(),
  totalWorkItems: z.number().int().nonnegative(),
  parserExceptionCount: z.number().int().nonnegative(),
  automationEligibleWorkItemIds: z.array(z.string().min(1)),
  blockedWorkItemIds: z.array(z.string().min(1)),
});

export type BatchManifest = z.infer<typeof batchManifestSchema>;

export const patientMatchStatusSchema = z.enum([
  "EXACT",
  "AMBIGUOUS",
  "NOT_FOUND",
  "ERROR",
]);

export type PatientMatchStatus = z.infer<typeof patientMatchStatusSchema>;

export const patientMatchResultSchema = z.object({
  status: patientMatchStatusSchema,
  searchQuery: z.string().min(1),
  portalPatientId: z.string().min(1).nullable(),
  portalDisplayName: z.string().min(1).nullable(),
  candidateNames: z.array(z.string().min(1)),
  note: z.string().min(1).nullable(),
});

export type PatientMatchResult = z.infer<typeof patientMatchResultSchema>;

export const artifactTypeSchema = z.enum([
  "OASIS",
  "PLAN_OF_CARE",
  "VISIT_NOTES",
  "PHYSICIAN_ORDERS",
  "COMMUNICATION_NOTES",
  "MISSED_VISITS",
  "THIRTY_SIXTY_DAY_SUMMARIES",
  "DISCHARGE_SUMMARY",
  "SUPERVISORY_VISITS",
  "INFECTION_AND_FALL_REPORTS",
]);

export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactStatusSchema = z.enum([
  "FOUND",
  "MISSING",
  "DOWNLOADED",
  "UNAVAILABLE",
]);

export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const artifactRecordSchema = z.object({
  artifactType: artifactTypeSchema,
  status: artifactStatusSchema,
  portalLabel: z.string().min(1).nullable(),
  locatorUsed: z.string().min(1).nullable(),
  discoveredAt: z.string().min(1),
  downloadPath: z.string().min(1).nullable(),
  extractedFields: z.record(z.string(), z.string().nullable()),
  notes: z.array(z.string().min(1)),
});

export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

export const qaFindingStageSchema = z.enum([
  "CODING_REVIEW",
  "OASIS_QA",
  "POC_QA",
  "VISIT_NOTES_REVIEW",
  "TECHNICAL_REVIEW",
  "FINAL_BILLING_PREP_READINESS",
]);

export type QaFindingStage = z.infer<typeof qaFindingStageSchema>;

export const qaFindingSchema = z.object({
  ruleId: z.string().min(1),
  stage: qaFindingStageSchema,
  outcome: qaOutcomeSchema,
  message: z.string().min(1),
  evidence: z.array(z.string().min(1)),
});

export type QaFinding = z.infer<typeof qaFindingSchema>;

export const patientRunSchema = z.object({
  runId: z.string().min(1),
  batchId: z.string().min(1),
  workItemId: z.string().min(1),
  patientName: z.string().min(1),
  processingStatus: patientProcessingStatusSchema,
  executionStep: z.string().min(1),
  progressPercent: z.number().min(0).max(100),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().min(1),
  matchResult: patientMatchResultSchema,
  artifacts: z.array(artifactRecordSchema),
  artifactCount: z.number().int().nonnegative(),
  findings: z.array(qaFindingSchema),
  hasFindings: z.boolean(),
  qaOutcome: qaOutcomeSchema,
  oasisQaSummary: oasisQaSummarySchema.default(emptyOasisQaSummary),
  documentInventory: z.array(documentInventoryItemSchema).default([]),
  resultBundlePath: z.string().min(1).nullable(),
  bundleAvailable: z.boolean(),
  logPath: z.string().min(1).nullable(),
  logAvailable: z.boolean(),
  retryEligible: z.boolean(),
  errorSummary: z.string().min(1).nullable(),
  auditArtifacts: z.object({
    tracePath: z.string().min(1).nullable(),
    screenshotPaths: z.array(z.string().min(1)),
    downloadPaths: z.array(z.string().min(1)),
  }),
  workItemSnapshot: patientEpisodeWorkItemSchema,
  automationStepLogs: z.array(automationStepLogSchema).default([]),
  notes: z.array(z.string().min(1)),
});

export type PatientRun = z.infer<typeof patientRunSchema>;

export const batchSummarySchema = z.object({
  batchId: z.string().min(1),
  status: batchStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().min(1),
  totalWorkItems: z.number().int().nonnegative(),
  automationEligible: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  totalCompleted: z.number().int().nonnegative(),
  totalBlocked: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  totalNeedsHumanReview: z.number().int().nonnegative(),
  totalReadyForBillingPrep: z.number().int().nonnegative(),
  totalParserExceptions: z.number().int().nonnegative(),
  percentComplete: z.number().min(0).max(100),
  currentlyRunningCount: z.number().int().nonnegative(),
  currentBatchStatus: batchStatusSchema,
  complete: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  needsHumanReview: z.number().int().nonnegative(),
  parserExceptions: z.number().int().nonnegative(),
  qaOutcomes: z.object({
    READY_FOR_BILLING_PREP: z.number().int().nonnegative(),
    INCOMPLETE: z.number().int().nonnegative(),
    MISSING_DOCUMENTS: z.number().int().nonnegative(),
    PORTAL_NOT_FOUND: z.number().int().nonnegative(),
    PORTAL_MISMATCH: z.number().int().nonnegative(),
    AMBIGUOUS_PATIENT: z.number().int().nonnegative(),
    NEEDS_MANUAL_QA: z.number().int().nonnegative(),
  }),
  patientRuns: z.array(
    z.object({
      workItemId: z.string().min(1),
      patientName: z.string().min(1),
      processingStatus: patientProcessingStatusSchema,
      executionStep: z.string().min(1),
      progressPercent: z.number().min(0).max(100),
      qaOutcome: qaOutcomeSchema,
      errorSummary: z.string().min(1).nullable(),
      resultBundlePath: z.string().min(1).nullable(),
    }),
  ),
});

export type BatchSummary = z.infer<typeof batchSummarySchema>;
