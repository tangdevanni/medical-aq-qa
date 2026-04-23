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

  return input.fieldMapSnapshot.fields.map((field) => {
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
