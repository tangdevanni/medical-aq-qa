import { describe, expect, it } from "vitest";
import {
  estimateLlmCallCost,
  estimateOasisLlmCost,
  estimateTokensFromText,
  hashTextForCostReport,
} from "../services/llmCostEstimator";

const pricing = {
  modelName: "example-model",
  inputPricePerMillionTokens: 1,
  outputPricePerMillionTokens: 4,
  pricingSource: "unit-test",
};

describe("llmCostEstimator", () => {
  it("estimates tokens and hashes without exposing content", () => {
    const text = "OASIS DOM EXTRACTED STATE\nSection: Active Diagnoses\nM1021 Heart failure";

    expect(estimateTokensFromText(text)).toBeGreaterThan(0);
    expect(hashTextForCostReport(text)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("calculates per-call token cost with retry and overhead multipliers", () => {
    const estimate = estimateLlmCallCost({
      pricing,
      inputTokens: 10_000,
      outputTokens: 1_000,
      callCount: 2,
      retryMultiplier: 1.1,
      safetyOverheadMultiplier: 1.2,
    });

    expect(estimate.inputTokens).toBe(26_400);
    expect(estimate.outputTokens).toBe(2_640);
    expect(estimate.costUsd).toBeGreaterThan(0);
  });

  it("shows every-acquisition QA is more expensive than readiness gating", () => {
    const estimate = estimateOasisLlmCost({
      pricing,
      agencies: 2,
      activePatientsPerAgencyPerMonth: 10,
      acquisitionsPerPatient: 4,
      changedAcquisitionsPerPatient: 3,
      llmCallsPerPatientQa: 3,
      averageInputTokens: 12_000,
      averageOutputTokens: 2_000,
      retryMultiplier: 1,
      safetyOverheadMultiplier: 1,
      postQaChangeRate: 0,
      ambiguousPrecheckRate: 0.1,
      cheapPrecheckInputTokenMultiplier: 0.1,
      cheapPrecheckOutputTokens: 200,
    });

    const current = estimate.scenarios.find((scenario) => scenario.key === "current_gated");
    const every = estimate.scenarios.find((scenario) => scenario.key === "llm_on_every_acquisition");
    const changed = estimate.scenarios.find((scenario) => scenario.key === "llm_on_every_changed_acquisition");
    const twoStage = estimate.scenarios.find((scenario) => scenario.key === "two_stage_cheap_precheck");

    expect(current?.monthlyCostUsd).toBeGreaterThan(0);
    expect(every?.monthlyCostUsd).toBeGreaterThan(current?.monthlyCostUsd ?? 0);
    expect(every?.multiplierVsCurrentGated).toBe(4);
    expect(changed?.multiplierVsCurrentGated).toBe(3);
    expect(twoStage?.monthlyCostUsd).toBeGreaterThan(current?.monthlyCostUsd ?? 0);
    expect(twoStage?.monthlyCostUsd).toBeLessThan(every?.monthlyCostUsd ?? Number.POSITIVE_INFINITY);
  });
});
