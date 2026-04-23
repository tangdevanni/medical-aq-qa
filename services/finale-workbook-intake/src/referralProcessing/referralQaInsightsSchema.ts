import { z } from "zod";

const consistencyCheckIdSchema = z.enum([
  "mental-status-vs-m1700-m1710",
  "vision-vs-b1000-glasses",
  "respiratory-vs-m1400",
  "functional-vs-gg0130-gg0170",
  "wound-vs-worksheet",
  "pain-vs-j0510-j0520-j0530",
  "depression-vs-d0150",
]);

const sourceHighlightIdSchema = z.enum([
  "homebound-reason",
  "medical-necessity",
  "prior-level-of-function",
  "wound-history",
  "diet-and-fluid-instructions",
  "pmh-immunizations-diabetes",
  "diagnoses-and-coding-support",
]);

const draftNarrativeFieldSchema = z.enum([
  "homebound_narrative",
  "primary_reason_for_home_health_medical_necessity",
  "patient_summary_narrative",
  "skilled_interventions",
  "plan_for_next_visit",
  "care_plan_problems_goals_interventions",
  "patient_caregiver_goals",
]);

export const referralQaConsistencyCheckSchema = z.object({
  id: consistencyCheckIdSchema,
  status: z.enum(["flagged", "watch"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  related_sections: z.array(z.string().min(1)).max(6),
}).strict();

export const referralQaSourceHighlightSchema = z.object({
  id: sourceHighlightIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  supporting_sections: z.array(z.string().min(1)).max(6),
}).strict();

export const referralQaDraftNarrativeSchema = z.object({
  field_key: draftNarrativeFieldSchema,
  label: z.string().min(1),
  draft: z.string().min(1),
  status: z.enum(["ready_for_qa", "needs_human_review"]),
}).strict();

export const referralQaInsightsSchema = z.object({
  generated_at: z.string().min(1),
  warnings: z.array(z.string()),
  consistency_checks: z.array(referralQaConsistencyCheckSchema).max(7),
  source_highlights: z.array(referralQaSourceHighlightSchema).max(7),
  draft_narratives: z.array(referralQaDraftNarrativeSchema).max(7),
}).strict();

export type ReferralQaInsightsSchema = z.infer<typeof referralQaInsightsSchema>;

export function parseReferralQaInsightsPayload(text: string): ReferralQaInsightsSchema | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const parseCandidate = (candidate: string): ReferralQaInsightsSchema | null => {
    try {
      return referralQaInsightsSchema.parse(JSON.parse(candidate));
    } catch {
      return null;
    }
  };

  const direct = parseCandidate(normalized);
  if (direct) {
    return direct;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  return parseCandidate(normalized.slice(firstBrace, lastBrace + 1));
}
