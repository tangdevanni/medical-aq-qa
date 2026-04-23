import { z } from "zod";

const proposalValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  z.null(),
]);

export const referralPatientContextSchema = z.object({
  patient_name: z.string().nullable(),
  dob: z.string().nullable(),
  soc_date: z.string().nullable(),
  referral_date: z.string().nullable(),
}).strict();

export const referralFieldProposalSchema = z.object({
  field_key: z.string().min(1),
  proposed_value: proposalValueSchema,
  confidence: z.number().min(0).max(1),
  source_spans: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
  requires_human_review: z.boolean(),
}).strict();

export const referralDiagnosisCandidateSchema = z.object({
  description: z.string().min(1),
  icd10_code: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  source_spans: z.array(z.string().min(1)).min(1),
  is_primary_candidate: z.boolean(),
  requires_human_review: z.boolean(),
}).strict();

export const referralLlmProposalSchema = z.object({
  patient_context: referralPatientContextSchema,
  proposed_field_values: z.array(referralFieldProposalSchema),
  diagnosis_candidates: z.array(referralDiagnosisCandidateSchema),
  caregiver_candidates: z.array(z.record(z.string(), proposalValueSchema)),
  unsupported_or_missing_fields: z.array(z.string().min(1)),
  warnings: z.array(z.string()),
}).strict();

export type ReferralLlmProposalSchema = z.infer<typeof referralLlmProposalSchema>;

export function parseReferralLlmProposalPayload(text: string): ReferralLlmProposalSchema | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const parseCandidate = (candidate: string): ReferralLlmProposalSchema | null => {
    try {
      return referralLlmProposalSchema.parse(JSON.parse(candidate));
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
