import { z } from "zod";

export const costPlanningDecisionSchema = z.enum([
  "reuse_complete",
  "reuse_terminal_exclusion",
  "needs_portal_acquisition",
  "local_projection_only",
  "needs_llm_only",
]);

export const costStageTimingSchema = z.object({
  stage: z.string().min(1),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
});

export const patientCostSummarySchema = z.object({
  schemaVersion: z.literal("patient-cost-summary.v1"),
  generatedAt: z.string().min(1),
  batchId: z.string().min(1),
  runId: z.string().min(1),
  patientId: z.string().min(1),
  patientName: z.string().min(1),
  planningDecision: costPlanningDecisionSchema.nullable(),
  planningReason: z.string().min(1).nullable(),
  totalRuntimeMs: z.number().int().nonnegative().nullable(),
  portal: z.object({
    browserActiveMs: z.number().int().nonnegative(),
    patientSearchAttempts: z.number().int().nonnegative(),
    dashboardResetAttempts: z.number().int().nonnegative(),
    retrySignals: z.number().int().nonnegative(),
  }),
  oasis: z.object({
    acquisitionSources: z.array(z.string().min(1)),
    printPreviewAccepted: z.boolean(),
    legacyFallbacks: z.number().int().nonnegative(),
  }),
  llm: z.object({
    callCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    unknownTokenCalls: z.number().int().nonnegative(),
    stages: z.array(z.object({
      stage: z.string().min(1),
      callCount: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })),
  }),
  textract: z.object({
    ocrJobs: z.number().int().nonnegative(),
    ocrAvoidedByHtml: z.number().int().nonnegative(),
    ocrAvoidedByNativeText: z.number().int().nonnegative(),
    ocrDisabledSkips: z.number().int().nonnegative(),
    extractionPolicyModes: z.record(z.string(), z.number().int().nonnegative()),
  }),
  cache: z.object({
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    reusedOasisSections: z.number().int().nonnegative(),
    processedOasisSections: z.number().int().nonnegative(),
    reusedVisitNotes: z.number().int().nonnegative(),
    processedVisitNotes: z.number().int().nonnegative(),
  }),
  failure: z.object({
    retryEligible: z.boolean(),
    reason: z.string().min(1).nullable(),
  }),
  stageTimings: z.array(costStageTimingSchema),
  artifactPaths: z.array(z.string().min(1)),
});

export type CostPlanningDecision = z.infer<typeof costPlanningDecisionSchema>;
export type PatientCostSummary = z.infer<typeof patientCostSummarySchema>;

export const preWorkerRunPlanSchema = z.object({
  schemaVersion: z.literal("pre-worker-run-plan.v1"),
  generatedAt: z.string().min(1),
  batchId: z.string().min(1),
  mode: z.string().min(1),
  deltaReuseEnabled: z.boolean(),
  totalPatients: z.number().int().nonnegative(),
  decisionCounts: z.record(costPlanningDecisionSchema, z.number().int().nonnegative()),
  patients: z.array(z.object({
    workItemId: z.string().min(1),
    patientName: z.string().min(1),
    decision: costPlanningDecisionSchema,
    reason: z.string().min(1),
    priorRunId: z.string().min(1).nullable(),
    willOpenPortalWorker: z.boolean(),
  })),
});

export type PreWorkerRunPlan = z.infer<typeof preWorkerRunPlanSchema>;

export const runCostSummarySchema = z.object({
  schemaVersion: z.literal("run-cost-summary.v1"),
  generatedAt: z.string().min(1),
  batchId: z.string().min(1),
  patientCount: z.number().int().nonnegative(),
  totalRuntimeMs: z.number().int().nonnegative(),
  portalBrowserActiveMs: z.number().int().nonnegative(),
  patientSearchAttempts: z.number().int().nonnegative(),
  dashboardResetAttempts: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  llmInputTokens: z.number().int().nonnegative(),
  llmOutputTokens: z.number().int().nonnegative(),
  llmTotalTokens: z.number().int().nonnegative(),
  textractOcrJobs: z.number().int().nonnegative(),
  ocrAvoidedByHtml: z.number().int().nonnegative(),
  ocrAvoidedByNativeText: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  planning: z.object({
    totalPatients: z.number().int().nonnegative(),
    decisionCounts: z.record(costPlanningDecisionSchema, z.number().int().nonnegative()),
  }).nullable(),
  patientCostSummaryPaths: z.array(z.string().min(1)),
});

export type RunCostSummary = z.infer<typeof runCostSummarySchema>;
