import { z } from "zod";

export const patientRunCacheSummarySchema = z.object({
  schemaVersion: z.literal("patient-run-cache-summary.v1"),
  generatedAt: z.string().min(1),
  patientId: z.string().min(1),
  patientName: z.string().min(1),
  runId: z.string().min(1),
  batchId: z.string().min(1),
  lastCompletedAt: z.string().min(1).nullable(),
  totalRuntimeMs: z.number().int().nonnegative().nullable(),
  previousTotalRuntimeMs: z.number().int().nonnegative().nullable().optional(),
  estimatedSavedTimeMs: z.number().int().nonnegative().nullable().optional(),
  stageTimings: z.array(z.object({
    stage: z.string().min(1),
    startedAt: z.string().min(1),
    completedAt: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  })).default([]),
  fingerprints: z.object({
    referralUploadFingerprint: z.string().min(1).nullable(),
    referralProcessingFingerprint: z.string().min(1).nullable(),
    referralFactsFingerprint: z.string().min(1).nullable(),
    oasisDomContentHash: z.string().min(1).nullable(),
    oasisQaHash: z.string().min(1).nullable(),
    planOfCareSourceHash: z.string().min(1).nullable(),
    visitNotesDiscoveryHash: z.string().min(1).nullable(),
  }),
  visitNotes: z.object({
    total: z.number().int().nonnegative(),
    reused: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    noteHashes: z.array(z.object({
      visitNoteKey: z.string().min(1),
      contentHash: z.string().min(1).nullable(),
      textHash: z.string().min(1).nullable(),
      analysisInputHash: z.string().min(1).nullable(),
      llmAnalysisSource: z.string().min(1).nullable(),
      extractionSource: z.string().min(1).nullable(),
    })).default([]),
  }),
  reuseSummary: z.object({
    referral: z.enum(["processed", "reused", "not_available"]),
    oasis: z.enum(["rerun", "reused", "not_available"]),
    planOfCare: z.enum(["rerun", "reused", "not_available"]),
    visitNotes: z.enum(["processed", "reused", "mixed", "not_available"]),
  }),
  warnings: z.array(z.string().min(1)).default([]),
});

export type PatientRunCacheSummary = z.infer<typeof patientRunCacheSummarySchema>;
