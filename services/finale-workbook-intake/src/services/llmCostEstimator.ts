import { createHash } from "node:crypto";

export type LlmPricing = {
  modelName: string;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  pricingSource: string;
};

export type OasisLlmCostEstimatorInput = {
  pricing: LlmPricing;
  agencies: number;
  activePatientsPerAgencyPerMonth: number;
  acquisitionsPerPatient: number;
  changedAcquisitionsPerPatient: number;
  llmCallsPerPatientQa: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  retryMultiplier: number;
  safetyOverheadMultiplier: number;
  postQaChangeRate: number;
  ambiguousPrecheckRate: number;
  cheapPrecheckInputTokenMultiplier: number;
  cheapPrecheckOutputTokens: number;
};

export type OasisLlmCostScenarioKey =
  | "current_gated"
  | "llm_on_every_acquisition"
  | "llm_on_every_changed_acquisition"
  | "two_stage_cheap_precheck";

export type OasisLlmCostScenarioEstimate = {
  key: OasisLlmCostScenarioKey;
  label: string;
  description: string;
  fullQaRunsPerPatient: number;
  cheapPrecheckRunsPerPatient: number;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  monthlyCostUsd: number;
  annualCostUsd: number;
  multiplierVsCurrentGated: number;
};

export type OasisLlmCostEstimate = {
  generatedAt: string;
  pricing: LlmPricing;
  assumptions: OasisLlmCostEstimatorInput;
  perFullQaCall: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  perCheapPrecheckCall: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  scenarios: OasisLlmCostScenarioEstimate[];
};

export function estimateTokensFromText(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  const wordEstimate = normalized.split(/\s+/).length * 1.35;
  const characterEstimate = normalized.length / 4;
  return Math.ceil(Math.max(wordEstimate, characterEstimate));
}

export function hashTextForCostReport(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function estimateLlmCallCost(input: {
  pricing: LlmPricing;
  inputTokens: number;
  outputTokens: number;
  callCount?: number;
  retryMultiplier?: number;
  safetyOverheadMultiplier?: number;
}): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
} {
  const callCount = Math.max(0, input.callCount ?? 1);
  const retryMultiplier = Math.max(0, input.retryMultiplier ?? 1);
  const safetyOverheadMultiplier = Math.max(0, input.safetyOverheadMultiplier ?? 1);
  const multiplier = callCount * retryMultiplier * safetyOverheadMultiplier;
  const inputTokens = Math.ceil(input.inputTokens * multiplier);
  const outputTokens = Math.ceil(input.outputTokens * multiplier);
  const inputCost = (inputTokens / 1_000_000) * input.pricing.inputPricePerMillionTokens;
  const outputCost = (outputTokens / 1_000_000) * input.pricing.outputPricePerMillionTokens;
  return {
    inputTokens,
    outputTokens,
    costUsd: roundCurrency(inputCost + outputCost),
  };
}

export function estimateOasisLlmCost(input: OasisLlmCostEstimatorInput): OasisLlmCostEstimate {
  const totalPatientsPerMonth = Math.max(0, input.agencies) * Math.max(0, input.activePatientsPerAgencyPerMonth);
  const currentGatedRunsPerPatient = 1 + Math.max(0, input.postQaChangeRate);
  const everyAcquisitionRunsPerPatient = Math.max(0, input.acquisitionsPerPatient);
  const changedAcquisitionRunsPerPatient = Math.max(0, input.changedAcquisitionsPerPatient);
  const twoStageFullRunsPerPatient = currentGatedRunsPerPatient;
  const cheapPrecheckRunsPerPatient =
    Math.max(0, input.acquisitionsPerPatient) * Math.max(0, input.ambiguousPrecheckRate);

  const perFullQaCall = estimateLlmCallCost({
    pricing: input.pricing,
    inputTokens: input.averageInputTokens,
    outputTokens: input.averageOutputTokens,
    callCount: input.llmCallsPerPatientQa,
    retryMultiplier: input.retryMultiplier,
    safetyOverheadMultiplier: input.safetyOverheadMultiplier,
  });
  const perCheapPrecheckCall = estimateLlmCallCost({
    pricing: input.pricing,
    inputTokens: Math.ceil(input.averageInputTokens * input.cheapPrecheckInputTokenMultiplier),
    outputTokens: input.cheapPrecheckOutputTokens,
    callCount: 1,
    retryMultiplier: input.retryMultiplier,
    safetyOverheadMultiplier: input.safetyOverheadMultiplier,
  });

  const currentGated = buildScenario({
    key: "current_gated",
    label: "Scenario A - Current Gated Approach",
    description: "DOM scrape every interval; full LLM QA only when OASIS is ready or changes after prior QA.",
    totalPatientsPerMonth,
    fullQaRunsPerPatient: currentGatedRunsPerPatient,
    cheapPrecheckRunsPerPatient: 0,
    perFullQaCall,
    perCheapPrecheckCall,
    currentGatedMonthlyCostUsd: null,
  });
  const currentGatedMonthlyCostUsd = currentGated.monthlyCostUsd || 1;

  const scenarios = [
    {
      ...currentGated,
      multiplierVsCurrentGated: 1,
    },
    buildScenario({
      key: "llm_on_every_acquisition",
      label: "Scenario B - Full LLM on Every Acquisition",
      description: "Every scheduled OASIS DOM scrape triggers full LLM QA, including incomplete and unchanged states.",
      totalPatientsPerMonth,
      fullQaRunsPerPatient: everyAcquisitionRunsPerPatient,
      cheapPrecheckRunsPerPatient: 0,
      perFullQaCall,
      perCheapPrecheckCall,
      currentGatedMonthlyCostUsd,
    }),
    buildScenario({
      key: "llm_on_every_changed_acquisition",
      label: "Scenario C - Full LLM on Changed Acquisition",
      description: "Full LLM QA runs whenever DOM content hash changes, even before readiness; unchanged intervals are skipped.",
      totalPatientsPerMonth,
      fullQaRunsPerPatient: changedAcquisitionRunsPerPatient,
      cheapPrecheckRunsPerPatient: 0,
      perFullQaCall,
      perCheapPrecheckCall,
      currentGatedMonthlyCostUsd,
    }),
    buildScenario({
      key: "two_stage_cheap_precheck",
      label: "Scenario D - Two-Stage Cheap Precheck",
      description: "Deterministic readiness every interval, cheap LLM precheck only for ambiguous cases, full QA only when ready or stale.",
      totalPatientsPerMonth,
      fullQaRunsPerPatient: twoStageFullRunsPerPatient,
      cheapPrecheckRunsPerPatient,
      perFullQaCall,
      perCheapPrecheckCall,
      currentGatedMonthlyCostUsd,
    }),
  ];

  return {
    generatedAt: new Date().toISOString(),
    pricing: input.pricing,
    assumptions: input,
    perFullQaCall,
    perCheapPrecheckCall,
    scenarios,
  };
}

function buildScenario(input: {
  key: OasisLlmCostScenarioKey;
  label: string;
  description: string;
  totalPatientsPerMonth: number;
  fullQaRunsPerPatient: number;
  cheapPrecheckRunsPerPatient: number;
  perFullQaCall: { inputTokens: number; outputTokens: number; costUsd: number };
  perCheapPrecheckCall: { inputTokens: number; outputTokens: number; costUsd: number };
  currentGatedMonthlyCostUsd: number | null;
}): OasisLlmCostScenarioEstimate {
  const fullQaCallsPerMonth = input.totalPatientsPerMonth * input.fullQaRunsPerPatient;
  const cheapPrecheckCallsPerMonth = input.totalPatientsPerMonth * input.cheapPrecheckRunsPerPatient;
  const monthlyInputTokens =
    Math.ceil(fullQaCallsPerMonth * input.perFullQaCall.inputTokens) +
    Math.ceil(cheapPrecheckCallsPerMonth * input.perCheapPrecheckCall.inputTokens);
  const monthlyOutputTokens =
    Math.ceil(fullQaCallsPerMonth * input.perFullQaCall.outputTokens) +
    Math.ceil(cheapPrecheckCallsPerMonth * input.perCheapPrecheckCall.outputTokens);
  const monthlyCostUsd = roundCurrency(
    fullQaCallsPerMonth * input.perFullQaCall.costUsd +
    cheapPrecheckCallsPerMonth * input.perCheapPrecheckCall.costUsd,
  );
  return {
    key: input.key,
    label: input.label,
    description: input.description,
    fullQaRunsPerPatient: roundNumber(input.fullQaRunsPerPatient),
    cheapPrecheckRunsPerPatient: roundNumber(input.cheapPrecheckRunsPerPatient),
    monthlyInputTokens,
    monthlyOutputTokens,
    monthlyCostUsd,
    annualCostUsd: roundCurrency(monthlyCostUsd * 12),
    multiplierVsCurrentGated: input.currentGatedMonthlyCostUsd
      ? roundNumber(monthlyCostUsd / input.currentGatedMonthlyCostUsd)
      : 1,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
