import { z } from "zod";

export const generatedPlanOfCareStatusSchema = z.enum([
  "not_attempted",
  "ready_for_use",
  "limited_preview",
  "blocked_missing_evidence",
  "draft_ready_for_review",
  "skipped_oasis_gate",
  "skipped_missing_question_bank",
  "generation_failed",
]);

export type GeneratedPlanOfCareStatus = z.infer<typeof generatedPlanOfCareStatusSchema>;

export const generatedPlanOfCareProblemSchema = z.object({
  problem: z.string().min(1),
  domain: z.string().min(1).nullable().default(null),
  planSummary: z.string().min(1),
  clinicalRationale: z.string().min(1),
  evidence: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  goals: z.array(z.string().min(1)).default([]),
  interventions: z.array(z.string().min(1)).default([]),
  interventionEvidence: z
    .array(
      z.object({
        intervention: z.string().min(1),
        evidenceIds: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  questionBankMatches: z.array(z.string().min(1)).default([]),
  candidateProblemLabels: z.array(z.string().min(1)).default([]),
});

export type GeneratedPlanOfCareProblem = z.infer<typeof generatedPlanOfCareProblemSchema>;

export const generatedPlanOfCareReadableSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  bullets: z.array(z.string().min(1)).default([]),
});

export type GeneratedPlanOfCareReadableSection = z.infer<
  typeof generatedPlanOfCareReadableSectionSchema
>;

export const generatedPlanOfCareReadableDraftSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sections: z.array(generatedPlanOfCareReadableSectionSchema).default([]),
});

export type GeneratedPlanOfCareReadableDraft = z.infer<
  typeof generatedPlanOfCareReadableDraftSchema
>;

export const generatedPlanOfCarePreviewItemSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
});

export type GeneratedPlanOfCarePreviewItem = z.infer<
  typeof generatedPlanOfCarePreviewItemSchema
>;

export const generatedPlanOfCarePreviewSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  items: z.array(generatedPlanOfCarePreviewItemSchema).default([]),
});

export type GeneratedPlanOfCarePreviewSection = z.infer<
  typeof generatedPlanOfCarePreviewSectionSchema
>;

export const generatedPlanOfCarePreviewSchema = z.object({
  title: z.string().min(1),
  patientSummary: z.string().min(1),
  sections: z.array(generatedPlanOfCarePreviewSectionSchema).default([]),
  clinicalCautions: z.array(z.string().min(1)).default([]),
});

export type GeneratedPlanOfCarePreview = z.infer<
  typeof generatedPlanOfCarePreviewSchema
>;

export const generatedPlanOfCareEvidenceSnippetSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  label: z.string().min(1),
  text: z.string().min(1),
  sourceLabel: z.string().min(1).nullable().default(null),
  sourceType: z.string().min(1).nullable().default(null),
});

export type GeneratedPlanOfCareEvidenceSnippet = z.infer<
  typeof generatedPlanOfCareEvidenceSnippetSchema
>;

export const generatedPlanOfCareEvidenceMapSchema = z.object({
  diagnoses: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  medications: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  woundFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  respiratoryFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  mobilityFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  cognitionFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  dysphagiaNutritionFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  cardiacFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  oasisChartFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
  referralSkilledNeedFacts: z.array(generatedPlanOfCareEvidenceSnippetSchema).default([]),
});

export type GeneratedPlanOfCareEvidenceMap = z.infer<
  typeof generatedPlanOfCareEvidenceMapSchema
>;

export const generatedPlanOfCareConsolidatedProblemSchema = z.object({
  problem: z.string().min(1),
  domain: z.string().min(1),
  rationale: z.string().min(1),
  candidateProblemLabels: z.array(z.string().min(1)).default([]),
  supportingEvidenceIds: z.array(z.string().min(1)).default([]),
});

export type GeneratedPlanOfCareConsolidatedProblem = z.infer<
  typeof generatedPlanOfCareConsolidatedProblemSchema
>;

export const generatedPlanOfCareValidationFindingSchema = z.object({
  severity: z.enum(["warning", "error"]),
  category: z.string().min(1),
  message: z.string().min(1),
  affectedProblem: z.string().min(1).nullable().default(null),
  affectedIntervention: z.string().min(1).nullable().default(null),
  action: z.enum(["pruned", "retained", "added", "blocked"]),
});

export type GeneratedPlanOfCareValidationFinding = z.infer<
  typeof generatedPlanOfCareValidationFindingSchema
>;

export const generatedPlanOfCareStageStateSchema = z.enum([
  "not_started",
  "completed",
  "skipped",
  "failed",
]);

export type GeneratedPlanOfCareStageState = z.infer<
  typeof generatedPlanOfCareStageStateSchema
>;

export const generatedPlanOfCareStageEntrySchema = z.object({
  state: generatedPlanOfCareStageStateSchema,
  note: z.string().min(1).nullable().default(null),
});

export type GeneratedPlanOfCareStageEntry = z.infer<
  typeof generatedPlanOfCareStageEntrySchema
>;

export const generatedPlanOfCareStageStatusSchema = z.object({
  fact_pack_build: generatedPlanOfCareStageEntrySchema,
  broad_problem_retrieval: generatedPlanOfCareStageEntrySchema,
  evidence_grounding: generatedPlanOfCareStageEntrySchema,
  llm_problem_selection_and_consolidation: generatedPlanOfCareStageEntrySchema,
  llm_poc_form_drafting: generatedPlanOfCareStageEntrySchema,
  deterministic_validation_and_pruning: generatedPlanOfCareStageEntrySchema,
  dashboard_preview_publish: generatedPlanOfCareStageEntrySchema,
});

export type GeneratedPlanOfCareStageStatus = z.infer<
  typeof generatedPlanOfCareStageStatusSchema
>;

export const generatedPlanOfCareDraftSchema = z.object({
  status: generatedPlanOfCareStatusSchema,
  finalPreviewStatus: generatedPlanOfCareStatusSchema.default("not_attempted"),
  generatedAt: z.string().min(1),
  questionBankVersion: z.string().min(1).nullable().default(null),
  reviewRequired: z.boolean().default(true),
  generationMode: z.literal("generate_once_then_freeze").default("generate_once_then_freeze"),
  sourceSummary: z.object({
    oasisValidationTimestamp: z.string().min(1).nullable().default(null),
    oasisGateTimestamp: z.string().min(1).nullable().default(null),
    keyClinicalSignals: z.array(z.string().min(1)).default([]),
  }),
  stageStatus: generatedPlanOfCareStageStatusSchema,
  validationFindings: z.array(generatedPlanOfCareValidationFindingSchema).default([]),
  evidenceMap: generatedPlanOfCareEvidenceMapSchema,
  consolidatedProblems: z.array(generatedPlanOfCareConsolidatedProblemSchema).default([]),
  pocPreview: generatedPlanOfCarePreviewSchema,
  readablePlan: generatedPlanOfCareReadableDraftSchema.nullable().default(null),
  problems: z.array(generatedPlanOfCareProblemSchema).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  diagnostics: z.object({
    llmUsed: z.boolean().default(false),
    modelId: z.string().min(1).nullable().default(null),
    retrievedProblemCount: z.number().int().nonnegative().default(0),
    promptCharacterEstimate: z.number().int().nonnegative().default(0),
  }),
});

export type GeneratedPlanOfCareDraft = z.infer<typeof generatedPlanOfCareDraftSchema>;
