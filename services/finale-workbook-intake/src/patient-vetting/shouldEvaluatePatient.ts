import type {
  PatientEligibilityDecision,
  PatientEligibilityReason,
  PatientEpisodeWorkItem,
} from "@medical-ai-qa/shared-types";

const NON_ADMIT_PATTERN = /\bnon[-\s]?admit(?:ted)?\b/i;
const PENDING_PATTERN = /\bpending\b/i;

function collectStatusSignals(workItem: PatientEpisodeWorkItem): string[] {
  const values = new Set<string>();

  for (const remark of workItem.sourceRemarks) {
    if (remark.value.trim()) {
      values.add(`${remark.field}: ${remark.value.trim()}`);
    }
  }

  for (const snapshot of workItem.sourceValues) {
    for (const [field, value] of Object.entries(snapshot.values)) {
      if (!value?.trim()) {
        continue;
      }

      if (
        field === "status" ||
        field === "billingStatus" ||
        field === "oasisStatus" ||
        field === "oasisQaRemarks" ||
        field === "coding" ||
        field === "qa" ||
        field === "rfa"
      ) {
        values.add(`${field}: ${value.trim()}`);
      }
    }
  }

  return [...values];
}

function createDecision(input: {
  eligible: boolean;
  reason?: PatientEligibilityReason | null;
  rationale: string;
  matchedSignals?: string[];
}): PatientEligibilityDecision {
  return {
    eligible: input.eligible,
    reason: input.reason ?? null,
    rationale: input.rationale,
    matchedSignals: input.matchedSignals ?? [],
  };
}

export function shouldEvaluatePatient(
  workItem: PatientEpisodeWorkItem,
): PatientEligibilityDecision {
  const signals = collectStatusSignals(workItem);
  const nonAdmitSignals = signals.filter((signal) => NON_ADMIT_PATTERN.test(signal));
  if (nonAdmitSignals.length > 0) {
    return createDecision({
      eligible: false,
      reason: "non_admit",
      rationale: "Patient is excluded from the QA review queue because workbook status signals indicate non-admit.",
      matchedSignals: nonAdmitSignals,
    });
  }

  const pendingSignals = signals.filter((signal) => PENDING_PATTERN.test(signal));
  if (pendingSignals.length > 0) {
    return createDecision({
      eligible: false,
      reason: "pending",
      rationale: "Patient is excluded from the QA review queue because workbook status signals indicate pending.",
      matchedSignals: pendingSignals,
    });
  }

  return createDecision({
    eligible: true,
    rationale: "Patient is eligible for autonomous QA evaluation based on current workbook status signals.",
  });
}
