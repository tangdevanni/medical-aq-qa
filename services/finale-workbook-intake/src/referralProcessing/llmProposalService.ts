import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { FinaleBatchEnv } from "../config/env";
import {
  resolveBedrockConfig,
  sendBedrockConverseWithProfileFallback,
} from "../config/bedrock";
import {
  QA_REFERENCE_FIELD_REGISTRY,
  QA_SECTION_METADATA,
} from "../qaReference/registry";
import type {
  FieldMapSnapshot,
  ReferralDiagnosisCandidate,
  ReferralExtractedFacts,
  ReferralFieldProposal,
  ReferralLlmProposal,
} from "./types";
import { buildReferralFactLookup } from "./factsExtractionService";
import { parseReferralLlmProposalPayload } from "./llmProposalSchema";

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function getBedrockClient(region: string): BedrockRuntimeClient {
  const existing = bedrockClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function isReferralProposalLlmEnabled(env: FinaleBatchEnv): boolean {
  return Boolean(env.CODE_LLM_ENABLED && env.LLM_PROVIDER === "bedrock");
}

function extractConverseText(response: ConverseCommandOutput): string {
  const blocks = response.output?.message?.content;
  if (!blocks) {
    return "";
  }
  const texts: string[] = [];
  for (const block of blocks) {
    if ("text" in block && typeof block.text === "string") {
      const value = normalizeWhitespace(block.text);
      if (value) {
        texts.push(value);
      }
    }
  }
  return normalizeWhitespace(texts.join("\n"));
}

function buildDeterministicFallback(input: {
  fieldMapSnapshot: FieldMapSnapshot;
  extractedFacts: ReferralExtractedFacts;
}): ReferralLlmProposal {
  const factLookup = buildReferralFactLookup(input.extractedFacts.facts);
  const allowedFieldKeys = new Set(input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral);
  const unsupportedOrMissingFields = [...input.extractedFacts.unsupported_or_missing_fields];
  const proposedFieldValues: ReferralLlmProposal["proposed_field_values"] = [];
  const warnings: string[] = [];

  const proposeFact = (factKey: string, targetFieldKey = factKey): void => {
    if (!allowedFieldKeys.has(targetFieldKey)) {
      return;
    }
    const fact = factLookup.get(factKey);
    if (!fact) {
      unsupportedOrMissingFields.push(targetFieldKey);
      return;
    }
    proposedFieldValues.push({
      field_key: targetFieldKey,
      proposed_value: fact.value,
      confidence: fact.confidence,
      source_spans: fact.evidence_spans.slice(0, 6),
      rationale: fact.rationale,
      requires_human_review: fact.requires_human_review,
    });
  };
  proposeFact("referral_date");
  proposeFact("preferred_language");
  proposeFact("interpreter_needed");
  proposeFact("recent_hospitalization_discharge_date");
  proposeFact("recent_hospitalization_facility");
  proposeFact("caregiver_name");
  proposeFact("caregiver_relationship");
  proposeFact("caregiver_phone");
  proposeFact("code_status");
  proposeFact("medical_necessity_summary", "primary_reason_for_home_health_medical_necessity");
  proposeFact("medical_necessity_summary", "admit_reason_to_home_health");
  proposeFact("homebound_narrative");
  proposeFact("homebound_supporting_factors");
  proposeFact("living_situation");
  proposeFact("patient_summary_narrative");
  proposeFact("skilled_interventions");
  proposeFact("plan_for_next_visit");
  proposeFact("care_plan_problems_goals_interventions");
  proposeFact("patient_caregiver_goals");
  proposeFact("functional_limitations");
  proposeFact("prior_functioning");
  proposeFact("therapy_need");
  proposeFact("discipline_frequencies");
  proposeFact("fall_risk_narrative");
  proposeFact("pain_assessment_narrative");
  proposeFact("respiratory_status");
  proposeFact("integumentary_wound_status");
  proposeFact("emotional_behavioral_status");
  proposeFact("past_medical_history");
  warnings.push("LLM disabled or unavailable; deterministic referral proposal fallback was used.");

  return {
    patient_context: input.extractedFacts.patient_context,
    proposed_field_values: proposedFieldValues,
    diagnosis_candidates: input.extractedFacts.diagnosis_candidates,
    caregiver_candidates: input.extractedFacts.caregiver_candidates,
    unsupported_or_missing_fields: Array.from(new Set(unsupportedOrMissingFields)),
    warnings: [
      ...input.extractedFacts.warnings,
      ...warnings,
    ],
  };
}

function buildLlmPrompt(input: {
  fieldMapSnapshot: FieldMapSnapshot;
  extractedFacts: ReferralExtractedFacts;
  sourceText: string;
}): string {
  const candidateFields = new Set(input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral);
  const registryByKey = new Map(QA_REFERENCE_FIELD_REGISTRY.map((entry) => [entry.fieldKey, entry]));
  const fieldGuide = input.fieldMapSnapshot.fields
    .filter((field) => candidateFields.has(field.key))
    .map((field) => {
      const registryEntry = registryByKey.get(field.key);
      const section = registryEntry
        ? QA_SECTION_METADATA.find((entry) => entry.sectionKey === registryEntry.sectionKey)
        : null;
      return [
        `field_key=${field.key}`,
        `label=${field.label}`,
        `qa_group=${registryEntry?.groupKey ?? field.category}`,
        `qa_section=${section?.label ?? registryEntry?.sectionKey ?? field.category}`,
        `field_type=${registryEntry?.fieldType ?? field.type}`,
        `review_mode=${registryEntry?.reviewMode ?? "compare_referral_to_chart"}`,
        `requires_human_review=${field.human_review_required || registryEntry?.requiresHumanReview === true}`,
        `evidence_strategy=${field.evidence_strategy}`,
      ].join("; ");
    });

  return [
    "Return strict JSON only.",
    "You are mapping extracted referral/admission facts into QA reference fields for a filled OASIS assessment.",
    "This is read-only QA support. Do not invent chart values, do not write back, and do not recommend committing values.",
    "Use an internal two-pass workflow before writing JSON: pass 1 extracts atomic patient-specific facts with verbatim evidence, pass 2 maps only those facts into field proposals.",
    "The primary input is EXTRACTED_FACTS. Use those facts first.",
    "You may also use REFERRAL_SOURCE_TEXT directly for patient-specific narrative, therapy, PMH, wound, respiratory, function, mood, diet/fluid, and care-plan details when those details are explicitly present but not already structured in EXTRACTED_FACTS.",
    "Do not use fax headers, page counters, viewer chrome, facility letterhead, column headers, blank form labels, or neighboring unrelated table labels as proposed values.",
    "If a field is not directly supported, omit it from proposed_field_values and list the field_key in unsupported_or_missing_fields.",
    "Every non-null proposal must include 1-3 concise source_spans copied from the source text. Each source_span should be the shortest useful evidence span, normally under 240 characters.",
    "Every proposed_value should be normalized for the target OASIS/QA field. Narrative values must be concise clinical summaries, not pasted pages.",
    "Before proposing a field, verify that the evidence is field-specific and not merely nearby in the same table or fax page.",
    "Diagnosis and ICD-10 ranking are coding-sensitive: include diagnosis_candidates only as candidates, preserve source evidence, and set requires_human_review=true.",
    "Code status may be proposed only when explicitly and unambiguously present, and must still require human review.",
    "Caregiver fields must come from patient contact/caregiver evidence, not pharmacy/provider/facility phone rows.",
    "Medical necessity/admit reason should come from order summary, discharge summary, skilled need, therapy need, or clinical narrative evidence.",
    "Homebound and functional fields should only be proposed when the text supports leaving-home burden, assistance, device use, gait/endurance limitation, or similar facts.",
    "Use this field placement guide:",
    ...fieldGuide.map((entry) => `- ${entry}`),
    "EXTRACTED_FACTS:",
    JSON.stringify(input.extractedFacts),
    "",
    "Required JSON shape:",
    JSON.stringify({
      patient_context: {
        patient_name: null,
        dob: null,
        soc_date: null,
        referral_date: null,
      },
      proposed_field_values: [{
        field_key: "field_key_from_guide",
        proposed_value: null,
        confidence: 0,
        source_spans: ["short exact source evidence"],
        rationale: "why this evidence belongs in this field",
        requires_human_review: true,
      }],
      diagnosis_candidates: [{
        description: "diagnosis description",
        icd10_code: null,
        confidence: 0,
        source_spans: ["short exact diagnosis evidence"],
        is_primary_candidate: false,
        requires_human_review: true,
      }],
      caregiver_candidates: [],
      unsupported_or_missing_fields: [],
      warnings: [],
    }),
    "",
    "Referral source text:",
    input.sourceText.slice(0, 18_000),
  ].join("\n");
}

const NARRATIVE_PROPOSAL_FIELDS = new Set([
  "primary_reason_for_home_health_medical_necessity",
  "admit_reason_to_home_health",
  "homebound_narrative",
  "living_situation",
  "therapy_need",
  "fall_risk_narrative",
  "prior_functioning",
  "patient_summary_narrative",
  "skilled_interventions",
  "plan_for_next_visit",
  "patient_caregiver_goals",
  "care_plan_problems_goals_interventions",
  "respiratory_status",
  "integumentary_wound_status",
  "pain_assessment_narrative",
  "emotional_behavioral_status",
  "past_medical_history",
]);

const CAREGIVER_RELATIONSHIPS = /^(?:daughter|son|spouse|wife|husband|sister|brother|friend|caregiver|self|other)$/i;

function maxProposalStringLength(fieldKey: string): number {
  if (NARRATIVE_PROPOSAL_FIELDS.has(fieldKey)) {
    return 520;
  }
  if (fieldKey.endsWith("_phone")) {
    return 40;
  }
  if (fieldKey.endsWith("_date")) {
    return 20;
  }
  if (fieldKey === "recent_hospitalization_facility") {
    return 140;
  }
  return 180;
}

function isRejectedStringProposal(fieldKey: string, value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return true;
  }
  if (normalized.length > maxProposalStringLength(fieldKey)) {
    return true;
  }
  if (/\bFax Server\b/i.test(normalized) && normalized.length > 120) {
    return true;
  }
  if (/\bPAGE\s+\d+\/\d+\b/i.test(normalized) && normalized.length > 120) {
    return true;
  }
  if (/\bBirth Place Citizenship Maiden Name\b/i.test(normalized)) {
    return true;
  }
  if (fieldKey === "recent_hospitalization_facility" && /\b(?:Medicare|Medicaid|Beneficiary|Citizenship|Maiden Name|Social Security)\b/i.test(normalized)) {
    return true;
  }
  if (fieldKey === "caregiver_relationship" && !CAREGIVER_RELATIONSHIPS.test(normalized)) {
    return true;
  }
  if (fieldKey === "caregiver_phone" && !/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{10}/.test(normalized)) {
    return true;
  }
  if (fieldKey === "code_status" && !/^(?:full_code|dnr|unknown)$/i.test(normalized)) {
    return true;
  }
  return false;
}

function sanitizeProposalValue(fieldKey: string, value: unknown): unknown | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    return isRejectedStringProposal(fieldKey, normalized) ? null : normalized;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((entry) => normalizeWhitespace(entry))
      .filter((entry) => entry.length > 0 && entry.length <= 120 && !/\bFax Server\b/i.test(entry));
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : null;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0 ? value : null;
  }
  return value;
}

function sanitizeSourceSpans(spans: string[]): string[] {
  return Array.from(new Set(
    spans
      .map((span) => normalizeWhitespace(span))
      .filter((span) =>
        span.length > 0 &&
        span.length <= 420 &&
        !(/\bFax Server\b/i.test(span) && span.length > 180) &&
        !(/\bPAGE\s+\d+\/\d+\b/i.test(span) && span.length > 180)),
  )).slice(0, 3);
}

function sanitizeFieldProposal(input: {
  proposal: ReferralFieldProposal;
  allowedFieldKeys: Set<string>;
}): ReferralFieldProposal | null {
  if (!input.allowedFieldKeys.has(input.proposal.field_key)) {
    return null;
  }
  const proposedValue = sanitizeProposalValue(input.proposal.field_key, input.proposal.proposed_value);
  const sourceSpans = sanitizeSourceSpans(input.proposal.source_spans);
  if (proposedValue === null || sourceSpans.length === 0) {
    return null;
  }
  return {
    ...input.proposal,
    proposed_value: proposedValue,
    source_spans: sourceSpans,
    rationale: normalizeWhitespace(input.proposal.rationale),
  };
}

function sanitizeDiagnosisCandidate(candidate: ReferralDiagnosisCandidate): ReferralDiagnosisCandidate | null {
  const description = normalizeWhitespace(candidate.description);
  const sourceSpans = sanitizeSourceSpans(candidate.source_spans);
  if (
    !description ||
    description.length > 180 ||
    /\bFax Server\b/i.test(description) ||
    /\bPAGE\s+\d+\/\d+\b/i.test(description) ||
    sourceSpans.length === 0
  ) {
    return null;
  }
  return {
    ...candidate,
    description,
    icd10_code: candidate.icd10_code ? normalizeWhitespace(candidate.icd10_code).toUpperCase() : null,
    source_spans: sourceSpans,
    requires_human_review: true,
  };
}

function sanitizeReferralProposal(input: {
  proposal: ReferralLlmProposal;
  fieldMapSnapshot: FieldMapSnapshot;
}): ReferralLlmProposal {
  const allowedFieldKeys = new Set(input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral);
  const unsupportedOrMissing = new Set(input.proposal.unsupported_or_missing_fields);
  const cleanedProposals: ReferralFieldProposal[] = [];
  const rejectedFieldKeys: string[] = [];

  for (const proposal of input.proposal.proposed_field_values) {
    const cleaned = sanitizeFieldProposal({ proposal, allowedFieldKeys });
    if (cleaned) {
      cleanedProposals.push(cleaned);
    } else {
      unsupportedOrMissing.add(proposal.field_key);
      rejectedFieldKeys.push(proposal.field_key);
    }
  }

  const diagnosisCandidates = input.proposal.diagnosis_candidates
    .map(sanitizeDiagnosisCandidate)
    .filter((candidate): candidate is ReferralDiagnosisCandidate => candidate !== null);
  if (input.proposal.diagnosis_candidates.length > 0 && diagnosisCandidates.length === 0) {
    unsupportedOrMissing.add("diagnosis_candidates");
    rejectedFieldKeys.push("diagnosis_candidates");
  }

  return {
    ...input.proposal,
    proposed_field_values: cleanedProposals,
    diagnosis_candidates: diagnosisCandidates,
    unsupported_or_missing_fields: Array.from(unsupportedOrMissing),
    warnings: rejectedFieldKeys.length > 0
      ? [
          ...input.proposal.warnings,
          `Rejected noisy or unsupported referral proposals for fields: ${Array.from(new Set(rejectedFieldKeys)).join(", ")}.`,
        ]
      : input.proposal.warnings,
  };
}

export async function generateReferralFieldProposals(input: {
  env: FinaleBatchEnv;
  fieldMapSnapshot: FieldMapSnapshot;
  extractedFacts: ReferralExtractedFacts;
  sourceText: string;
}): Promise<ReferralLlmProposal> {
  const deterministicFallback = sanitizeReferralProposal({
    proposal: buildDeterministicFallback({
      fieldMapSnapshot: input.fieldMapSnapshot,
      extractedFacts: input.extractedFacts,
    }),
    fieldMapSnapshot: input.fieldMapSnapshot,
  });
  if (!isReferralProposalLlmEnabled(input.env)) {
    return deterministicFallback;
  }

  const config = resolveBedrockConfig(input.env);
  const client = getBedrockClient(config.region);

  try {
    const { response } = await sendBedrockConverseWithProfileFallback({
      client,
      config,
      command: {
        messages: [{
          role: "user",
          content: [{ text: buildLlmPrompt({
            fieldMapSnapshot: input.fieldMapSnapshot,
            extractedFacts: input.extractedFacts,
            sourceText: input.sourceText,
          }) }],
        }],
        inferenceConfig: {
          temperature: 0,
          maxTokens: 2_000,
        },
      },
    });

    const content = extractConverseText(response);
    const parsed = parseReferralLlmProposalPayload(content);
    if (!parsed) {
      return {
        ...deterministicFallback,
        warnings: [
          ...deterministicFallback.warnings,
          "Bedrock returned invalid or non-JSON referral proposal output; deterministic fallback was used.",
        ],
      };
    }

    return sanitizeReferralProposal({
      proposal: parsed,
      fieldMapSnapshot: input.fieldMapSnapshot,
    });
  } catch (error) {
    return {
      ...deterministicFallback,
      warnings: [
        ...deterministicFallback.warnings,
        `Bedrock referral proposal failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
