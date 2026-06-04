import type {
  FieldComparisonResult,
  FieldMapSnapshot,
  ReferralDiagnosisCandidate,
  ReferralFieldProposal,
} from "./types";

function normalizeString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeString(entry)).filter(Boolean).join("|");
  }
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : String(value ?? "").trim().toLowerCase();
}

function normalizeDate(value: unknown): string {
  const normalized = normalizeString(value).replace(/-/g, "/");
  const match = normalized.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : normalized;
}

function toSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => normalizeString(entry)).filter(Boolean));
  }
  if (typeof value === "string") {
    return new Set(value.split(/[;,|]/).map((entry) => normalizeString(entry)).filter(Boolean));
  }
  return new Set();
}

function compareValues(input: {
  currentValue: unknown;
  proposedValue: unknown;
  strategy: FieldMapSnapshot["fields"][number]["compare_strategy"];
}): boolean {
  switch (input.strategy) {
    case "exact_string":
      return String(input.currentValue ?? "") === String(input.proposedValue ?? "");
    case "normalized_string":
      return normalizeString(input.currentValue) === normalizeString(input.proposedValue);
    case "date_equivalence":
      return normalizeDate(input.currentValue) === normalizeDate(input.proposedValue);
    case "unordered_set_overlap": {
      const currentSet = toSet(input.currentValue);
      const proposedSet = toSet(input.proposedValue);
      if (currentSet.size === 0 || proposedSet.size === 0) {
        return false;
      }
      return [...proposedSet].every((value) => currentSet.has(value));
    }
    case "presence_only":
      return Boolean(input.currentValue) === Boolean(input.proposedValue);
    case "ranked_diagnosis_compare":
    case "narrative_support_compare":
      return normalizeString(input.currentValue).includes(normalizeString(input.proposedValue)) ||
        normalizeString(input.proposedValue).includes(normalizeString(input.currentValue));
    default:
      return false;
  }
}

function derivePriority(input: {
  comparisonStatus: FieldComparisonResult["comparison_status"];
  confidence: number;
  requiresHumanReview: boolean;
}): FieldComparisonResult["reviewer_priority"] {
  if (input.requiresHumanReview || input.comparisonStatus === "possible_conflict") {
    return "high";
  }
  if (input.comparisonStatus === "missing_in_chart" || input.comparisonStatus === "missing_in_referral" || input.confidence < 0.7) {
    return "medium";
  }
  return "low";
}

function comparisonDomain(category: string): string {
  switch (category) {
    case "active_diagnoses":
      return "diagnoses";
    case "pain_medications_allergies":
      return "medications_allergies";
    case "living_situation_caregiver":
    case "emergency_directives_cultural":
      return "safety_social_support";
    case "medical_necessity_homebound":
    case "risk_scores_and_function":
      return "safety_functional";
    case "therapy_plan_and_narrative":
      return "therapy_plan_goals";
    case "immunization_neuro_psych_cardiopulmonary":
    case "nutrition_gi_gu_integument_safety":
    case "past_medical_history":
      return "body_systems";
    case "assessment_context":
    case "administrative_information":
    case "patient_identity_demographics":
    case "payer_and_utilization":
      return "dates_admin";
    default:
      return category;
  }
}

function hasChartValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function scopedFieldsForComparison(input: {
  fieldMapSnapshot: FieldMapSnapshot;
  proposalByKey: Map<string, ReferralFieldProposal>;
  diagnosisProposalAvailable: boolean;
}): FieldMapSnapshot["fields"] {
  const directFieldKeys = new Set(input.proposalByKey.keys());
  const activeDomains = new Set<string>();

  for (const field of input.fieldMapSnapshot.fields) {
    if (directFieldKeys.has(field.key)) {
      activeDomains.add(comparisonDomain(field.category));
    }
  }

  if (input.diagnosisProposalAvailable) {
    directFieldKeys.add("diagnosis_candidates");
    activeDomains.add("diagnoses");
  }

  if (directFieldKeys.size === 0) {
    return [];
  }

  return input.fieldMapSnapshot.fields.filter((field) => {
    if (directFieldKeys.has(field.key)) {
      return true;
    }
    if (!activeDomains.has(comparisonDomain(field.category))) {
      return false;
    }
    if (field.reference_only) {
      return false;
    }
    return field.populatedInChart || hasChartValue(field.currentChartValue);
  });
}

export function compareProposedFieldsAgainstChart(input: {
  fieldMapSnapshot: FieldMapSnapshot;
  proposals: ReferralFieldProposal[];
  diagnosisCandidates: ReferralDiagnosisCandidate[];
}): FieldComparisonResult[] {
  const proposalByKey = new Map(input.proposals.map((proposal) => [proposal.field_key, proposal]));
  const diagnosisProposal = input.diagnosisCandidates.length > 0
    ? {
        proposed_value: input.diagnosisCandidates.map((candidate) => ({
          description: candidate.description,
          icd10_code: candidate.icd10_code,
        })),
        confidence: Math.max(...input.diagnosisCandidates.map((candidate) => candidate.confidence)),
        source_spans: input.diagnosisCandidates.flatMap((candidate) => candidate.source_spans).slice(0, 8),
        rationale: "Diagnosis candidates extracted from referral evidence.",
        requires_human_review: true,
      }
    : null;
  const fieldsToCompare = scopedFieldsForComparison({
    fieldMapSnapshot: input.fieldMapSnapshot,
    proposalByKey,
    diagnosisProposalAvailable: diagnosisProposal !== null,
  });

  return fieldsToCompare.map((field) => {
    const proposal = field.key === "diagnosis_candidates"
      ? diagnosisProposal
      : proposalByKey.get(field.key) ?? null;
    const currentChartValue = field.currentChartValue;
    const proposedValue = proposal?.proposed_value ?? null;

    let comparisonStatus: FieldComparisonResult["comparison_status"];
    if (field.reference_only) {
      comparisonStatus = "unsupported";
    } else if (field.human_review_required || proposal?.requires_human_review) {
      comparisonStatus = "requires_human_review";
    } else if ((currentChartValue === null || currentChartValue === "") && proposedValue !== null && proposedValue !== "") {
      comparisonStatus = "missing_in_chart";
    } else if ((proposedValue === null || proposedValue === "") && currentChartValue !== null && currentChartValue !== "") {
      comparisonStatus = "missing_in_referral";
    } else if ((proposedValue === null || proposedValue === "") && (currentChartValue === null || currentChartValue === "")) {
      comparisonStatus = "unsupported";
    } else if (compareValues({
      currentValue: currentChartValue,
      proposedValue,
      strategy: field.compare_strategy,
    })) {
      comparisonStatus = "match";
    } else {
      comparisonStatus = "possible_conflict";
    }

    const confidence = proposal?.confidence ?? 0;
    return {
      field_key: field.key,
      current_chart_value: currentChartValue,
      proposed_value: proposedValue,
      comparison_status: comparisonStatus,
      confidence,
      rationale: proposal?.rationale ?? "No referral proposal was available for this field.",
      source_spans: proposal?.source_spans ?? [],
      reviewer_priority: derivePriority({
        comparisonStatus,
        confidence,
        requiresHumanReview: field.human_review_required || proposal?.requires_human_review === true,
      }),
    };
  });
}
