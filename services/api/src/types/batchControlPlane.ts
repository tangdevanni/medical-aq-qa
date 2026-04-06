import { z } from "zod";
import {
  batchStatusSchema,
  emptyOasisQaSummary,
  oasisQaSummarySchema,
  patientMatchResultSchema,
  patientProcessingStatusSchema,
  qaOutcomeSchema,
} from "@medical-ai-qa/shared-types";

const workbookSourceTypeSchema = z.enum(["socPoc", "dc", "visitNotes", "diz", "trackingReport"]);

export const batchRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  billingPeriod: z.string().min(1).nullable(),
  status: batchStatusSchema,
  sourceWorkbook: z.object({
    acquisitionProvider: z.enum(["MANUAL_UPLOAD", "FINALE"]),
    acquisitionStatus: z.enum(["ACQUIRED", "FAILED", "PENDING"]),
    acquisitionReference: z.string().min(1).nullable(),
    acquisitionNotes: z.array(z.string().min(1)),
    originalFileName: z.string().min(1),
    storedPath: z.string().min(1),
    uploadedAt: z.string().min(1),
  }),
  storage: z.object({
    batchRoot: z.string().min(1),
    outputRoot: z.string().min(1),
    manifestPath: z.string().min(1).nullable(),
    workItemsPath: z.string().min(1).nullable(),
    parserExceptionsPath: z.string().min(1).nullable(),
    batchSummaryPath: z.string().min(1).nullable(),
    patientResultsDirectory: z.string().min(1),
    evidenceDirectory: z.string().min(1),
  }),
  parse: z.object({
    requestedAt: z.string().min(1).nullable(),
    completedAt: z.string().min(1).nullable(),
    workItemCount: z.number().int().nonnegative(),
    eligibleWorkItemCount: z.number().int().nonnegative(),
    parserExceptionCount: z.number().int().nonnegative(),
    sourceDetections: z.array(
      z.object({
        sourceType: workbookSourceTypeSchema,
        detectedSheetName: z.string().min(1).nullable(),
        detectionStatus: z.enum(["detected", "missing"]),
        headerRowNumber: z.number().int().positive().nullable(),
        headerMatchCount: z.number().int().nonnegative(),
        minimumHeaderMatches: z.number().int().positive(),
        extractedRowCount: z.number().int().nonnegative(),
      }),
    ),
    sheetSummaries: z.array(
      z.object({
        sheetName: z.string().min(1),
        detectedSourceType: workbookSourceTypeSchema.nullable(),
        rowCount: z.number().int().nonnegative(),
        headerRowNumber: z.number().int().positive().nullable(),
        headerMatchCount: z.number().int().nonnegative(),
        detectedHeaders: z.record(z.string(), z.string()),
        extractedRowCount: z.number().int().nonnegative(),
        excludedRows: z.array(
          z.object({
            sourceRowNumber: z.number().int().positive(),
            reason: z.string().min(1),
            sample: z.string().min(1).nullable(),
          }),
        ),
      }),
    ),
    lastError: z.string().min(1).nullable(),
  }),
  run: z.object({
    requestedAt: z.string().min(1).nullable(),
    completedAt: z.string().min(1).nullable(),
    patientRunCount: z.number().int().nonnegative(),
    lastError: z.string().min(1).nullable(),
  }),
  patientRuns: z.array(
    z.object({
      runId: z.string().min(1),
      workItemId: z.string().min(1),
      patientName: z.string().min(1),
      processingStatus: patientProcessingStatusSchema,
      executionStep: z.string().min(1),
      progressPercent: z.number().min(0).max(100),
      startedAt: z.string().min(1).nullable(),
      completedAt: z.string().min(1).nullable(),
      lastUpdatedAt: z.string().min(1),
      matchResult: patientMatchResultSchema,
      qaOutcome: qaOutcomeSchema,
      oasisQaSummary: oasisQaSummarySchema.default(emptyOasisQaSummary),
      artifactCount: z.number().int().nonnegative(),
      hasFindings: z.boolean(),
      bundleAvailable: z.boolean(),
      logPath: z.string().min(1).nullable(),
      logAvailable: z.boolean(),
      retryEligible: z.boolean(),
      errorSummary: z.string().min(1).nullable(),
      resultBundlePath: z.string().min(1),
      evidenceDirectory: z.string().min(1),
      tracePath: z.string().min(1).nullable(),
      screenshotPaths: z.array(z.string().min(1)),
      downloadPaths: z.array(z.string().min(1)),
      lastAttemptAt: z.string().min(1).nullable(),
      attemptCount: z.number().int().nonnegative(),
    }),
  ),
});

export type BatchRecord = z.infer<typeof batchRecordSchema>;
