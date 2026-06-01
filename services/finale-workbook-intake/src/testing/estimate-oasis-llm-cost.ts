import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  estimateOasisLlmCost,
  estimateTokensFromText,
  hashTextForCostReport,
  type LlmPricing,
  type OasisLlmCostEstimate,
} from "../services/llmCostEstimator";

const DEFAULT_CHRISTINE_PATIENT_DIR = path.resolve(
  process.cwd(),
  "artifacts",
  "tmp",
  "oasis-dom-christine-validation",
  "run",
  "patients",
  "CHRISTINE_YOUNG__a89bc267c323fb6a",
);
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "artifacts", "tmp", "oasis-llm-cost-estimate");

type CliArgs = {
  patientArtifactsDirectory: string;
  outputDirectory: string;
  modelName: string;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  pricingSource: string;
  agencies: number;
  activePatientsPerAgencyPerMonth: number;
  acquisitionsPerPatient: number | null;
  changedAcquisitionsPerPatient: number | null;
  scheduledIntervalDays: number;
  daysFromStartToCompletion: number;
  averageOutputTokens: number;
  llmCallsPerPatientQa: number;
  retryMultiplier: number;
  safetyOverheadMultiplier: number;
  postQaChangeRate: number;
  ambiguousPrecheckRate: number;
  cheapPrecheckInputTokenMultiplier: number;
  cheapPrecheckOutputTokens: number;
};

type MeasuredArtifactInput = {
  bridgeTextPath: string | null;
  bridgeTextHash: string | null;
  bridgeTextBytes: number;
  bridgeTextTokens: number;
  factPackPath: string | null;
  factPackHash: string | null;
  factPackBytes: number;
  factPackTokens: number;
  domStatePath: string | null;
  domStateSummary: {
    sectionCount: number | null;
    fieldCount: number | null;
    nonEmptyFieldCount: number | null;
    tableCount: number | null;
    fallbackRecommended: boolean | null;
    inputSource: string | null;
    ocrUsed: boolean | null;
    pdfCaptureUsed: boolean | null;
  };
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative number: ${value}`);
  }
  return parsed;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  return parseNumber(value, 0);
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) {
      throw new Error(`Unsupported positional argument: ${raw}`);
    }
    const [flag, inlineValue] = raw.split("=", 2);
    if (inlineValue !== undefined) {
      values.set(flag, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, next);
    index += 1;
  }

  const get = (flag: string, envName: string, fallback: string): string =>
    values.get(flag) ?? env[envName] ?? fallback;

  const scheduledIntervalDays = parseNumber(
    get("--scheduled-interval-days", "OASIS_LLM_COST_SCHEDULED_INTERVAL_DAYS", "15"),
    15,
  );
  const daysFromStartToCompletion = parseNumber(
    get("--days-from-start-to-completion", "OASIS_LLM_COST_DAYS_TO_COMPLETION", "30"),
    30,
  );

  return {
    patientArtifactsDirectory: path.resolve(
      get("--patient-artifacts-dir", "OASIS_LLM_COST_PATIENT_ARTIFACTS_DIR", DEFAULT_CHRISTINE_PATIENT_DIR),
    ),
    outputDirectory: path.resolve(get("--output-dir", "OASIS_LLM_COST_OUTPUT_DIR", DEFAULT_OUTPUT_DIR)),
    modelName: get("--model", "OASIS_LLM_COST_MODEL", env.BEDROCK_MODEL_ID ?? "amazon.nova-pro-v1:0"),
    inputPricePerMillionTokens: parseNumber(
      get("--input-price-per-1m", "OASIS_LLM_COST_INPUT_PRICE_PER_1M", "0.80"),
      0.8,
    ),
    outputPricePerMillionTokens: parseNumber(
      get("--output-price-per-1m", "OASIS_LLM_COST_OUTPUT_PRICE_PER_1M", "3.20"),
      3.2,
    ),
    pricingSource: get(
      "--pricing-source",
      "OASIS_LLM_COST_PRICING_SOURCE",
      "editable example; verify current Amazon Bedrock pricing before relying on dollars",
    ),
    agencies: parseNumber(get("--agencies", "OASIS_LLM_COST_AGENCIES", "5"), 5),
    activePatientsPerAgencyPerMonth: parseNumber(
      get("--active-patients-per-agency", "OASIS_LLM_COST_ACTIVE_PATIENTS_PER_AGENCY", "40"),
      40,
    ),
    acquisitionsPerPatient: parseNullableNumber(
      values.get("--acquisitions-per-patient") ?? env.OASIS_LLM_COST_ACQUISITIONS_PER_PATIENT,
    ),
    changedAcquisitionsPerPatient: parseNullableNumber(
      values.get("--changed-acquisitions-per-patient") ?? env.OASIS_LLM_COST_CHANGED_ACQUISITIONS_PER_PATIENT,
    ),
    scheduledIntervalDays,
    daysFromStartToCompletion,
    averageOutputTokens: parseNumber(get("--average-output-tokens", "OASIS_LLM_COST_OUTPUT_TOKENS", "2200"), 2_200),
    llmCallsPerPatientQa: parseNumber(get("--llm-calls-per-qa", "OASIS_LLM_COST_CALLS_PER_QA", "3"), 3),
    retryMultiplier: parseNumber(get("--retry-multiplier", "OASIS_LLM_COST_RETRY_MULTIPLIER", "1.1"), 1.1),
    safetyOverheadMultiplier: parseNumber(
      get("--safety-overhead-multiplier", "OASIS_LLM_COST_SAFETY_OVERHEAD_MULTIPLIER", "1.15"),
      1.15,
    ),
    postQaChangeRate: parseNumber(get("--post-qa-change-rate", "OASIS_LLM_COST_POST_QA_CHANGE_RATE", "0.1"), 0.1),
    ambiguousPrecheckRate: parseNumber(
      get("--ambiguous-precheck-rate", "OASIS_LLM_COST_AMBIGUOUS_PRECHECK_RATE", "0.15"),
      0.15,
    ),
    cheapPrecheckInputTokenMultiplier: parseNumber(
      get("--cheap-precheck-input-token-multiplier", "OASIS_LLM_COST_CHEAP_PRECHECK_INPUT_MULTIPLIER", "0.15"),
      0.15,
    ),
    cheapPrecheckOutputTokens: parseNumber(
      get("--cheap-precheck-output-tokens", "OASIS_LLM_COST_CHEAP_PRECHECK_OUTPUT_TOKENS", "300"),
      300,
    ),
  };
}

async function readOptionalText(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  return readFile(filePath, "utf8");
}

async function measureArtifacts(patientArtifactsDirectory: string): Promise<MeasuredArtifactInput> {
  const bridgeTextPath = path.join(patientArtifactsDirectory, "oasis-dom-bridge-text.txt");
  const factPackPath = path.join(patientArtifactsDirectory, "document-fact-pack.json");
  const domStatePath = path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json");

  const bridgeText = await readOptionalText(bridgeTextPath);
  const factPackText = await readOptionalText(factPackPath);
  const domStateText = await readOptionalText(domStatePath);
  const domState = domStateText ? JSON.parse(domStateText) as Record<string, any> : null;

  return {
    bridgeTextPath: bridgeText ? bridgeTextPath : null,
    bridgeTextHash: bridgeText ? hashTextForCostReport(bridgeText) : null,
    bridgeTextBytes: bridgeText ? Buffer.byteLength(bridgeText, "utf8") : 0,
    bridgeTextTokens: bridgeText ? estimateTokensFromText(bridgeText) : 0,
    factPackPath: factPackText ? factPackPath : null,
    factPackHash: factPackText ? hashTextForCostReport(factPackText) : null,
    factPackBytes: factPackText ? Buffer.byteLength(factPackText, "utf8") : 0,
    factPackTokens: factPackText ? estimateTokensFromText(factPackText) : 0,
    domStatePath: domState ? domStatePath : null,
    domStateSummary: {
      sectionCount: typeof domState?.coverage?.sectionCount === "number" ? domState.coverage.sectionCount : null,
      fieldCount: typeof domState?.coverage?.fieldCount === "number" ? domState.coverage.fieldCount : null,
      nonEmptyFieldCount: typeof domState?.coverage?.nonEmptyFieldCount === "number" ? domState.coverage.nonEmptyFieldCount : null,
      tableCount: typeof domState?.coverage?.tableCount === "number" ? domState.coverage.tableCount : null,
      fallbackRecommended: typeof domState?.coverage?.fallbackRecommended === "boolean"
        ? domState.coverage.fallbackRecommended
        : null,
      inputSource: typeof domState?.diagnostics?.inputSource === "string" ? domState.diagnostics.inputSource : null,
      ocrUsed: typeof domState?.diagnostics?.ocrUsed === "boolean" ? domState.diagnostics.ocrUsed : null,
      pdfCaptureUsed: typeof domState?.diagnostics?.pdfCaptureUsed === "boolean" ? domState.diagnostics.pdfCaptureUsed : null,
    },
  };
}

function buildMarkdownReport(input: {
  args: CliArgs;
  measured: MeasuredArtifactInput;
  estimate: OasisLlmCostEstimate;
}): string {
  const scenarios = input.estimate.scenarios;
  const scenarioRows = scenarios.map((scenario) =>
    [
      scenario.label,
      scenario.fullQaRunsPerPatient.toString(),
      scenario.cheapPrecheckRunsPerPatient.toString(),
      formatUsd(scenario.monthlyCostUsd),
      formatUsd(scenario.annualCostUsd),
      `${scenario.multiplierVsCurrentGated}x`,
    ].join(" | "),
  );
  const everyAcquisition = scenarios.find((scenario) => scenario.key === "llm_on_every_acquisition");
  const current = scenarios.find((scenario) => scenario.key === "current_gated");
  const multiplier = everyAcquisition?.multiplierVsCurrentGated ?? 0;
  const lowMediumHighRows = [0.5, 1, 2].map((scale) => {
    const patients = Math.round(input.args.activePatientsPerAgencyPerMonth * scale);
    const scaled = estimateOasisLlmCost({
      ...input.estimate.assumptions,
      activePatientsPerAgencyPerMonth: patients,
    });
    const currentScaled = scaled.scenarios.find((scenario) => scenario.key === "current_gated");
    const everyScaled = scaled.scenarios.find((scenario) => scenario.key === "llm_on_every_acquisition");
    return [
      scale === 0.5 ? "Low" : scale === 1 ? "Medium" : "High",
      patients.toString(),
      formatUsd(currentScaled?.monthlyCostUsd ?? 0),
      formatUsd(everyScaled?.monthlyCostUsd ?? 0),
      `${everyScaled?.multiplierVsCurrentGated ?? 0}x`,
    ].join(" | ");
  });

  return [
    "# OASIS LLM Cost Estimate",
    "",
    "This is a dry-run estimate. It does not call Bedrock and does not print patient content.",
    "",
    "## LLM Usage Paths Observed",
    "",
    "- `diagnosisCodingExtractionService.ts`: Bedrock Converse for diagnosis coding extraction; may use a short rescue call and a main extraction call; configured by `CODE_LLM_ENABLED`, `BEDROCK_REGION`, and `BEDROCK_MODEL_ID`.",
    "- `oasis/print/printedNoteChartValueExtractionService.ts`: Bedrock Converse for current OASIS chart values from printed-note text; max output configured in code at 4,000 tokens.",
    "- `referralProcessing/llmProposalService.ts`: Bedrock Converse for referral field proposals; max output configured in code at 2,000 tokens.",
    "- `referralProcessing/referralQaInsightsService.ts`: Bedrock Converse for QA insights; max output configured in code at 2,000 tokens.",
    "- `visitNotePocAlignmentAgent.ts`: Bedrock Converse for Visit Note to POC alignment; separate flag `VISIT_NOTE_POC_MAPPING_LLM_ENABLED`, not part of OASIS-only estimate unless configured separately.",
    "- Current code records model IDs and fallback warnings in artifacts, but token usage/cost is not consistently persisted from Bedrock `usage` metadata.",
    "",
    "## Pricing",
    "",
    `- Model: ${input.estimate.pricing.modelName}`,
    `- Input price: ${formatUsd(input.estimate.pricing.inputPricePerMillionTokens)} per 1M tokens`,
    `- Output price: ${formatUsd(input.estimate.pricing.outputPricePerMillionTokens)} per 1M tokens`,
    `- Pricing source: ${input.estimate.pricing.pricingSource}`,
    "",
    "Verify current AWS Bedrock pricing before using this as a billing forecast.",
    "",
    "## Measured Christine Young Artifact Baseline",
    "",
    `- Patient artifact directory: ${input.args.patientArtifactsDirectory}`,
    `- Bridge text hash: ${input.measured.bridgeTextHash ?? "unavailable"}`,
    `- Bridge text bytes: ${input.measured.bridgeTextBytes}`,
    `- Bridge text token estimate: ${input.measured.bridgeTextTokens}`,
    `- Fact-pack bytes: ${input.measured.factPackBytes}`,
    `- Fact-pack token estimate: ${input.measured.factPackTokens}`,
    `- DOM sections: ${input.measured.domStateSummary.sectionCount ?? "unavailable"}`,
    `- DOM fields: ${input.measured.domStateSummary.fieldCount ?? "unavailable"}`,
    `- DOM non-empty fields: ${input.measured.domStateSummary.nonEmptyFieldCount ?? "unavailable"}`,
    `- DOM tables: ${input.measured.domStateSummary.tableCount ?? "unavailable"}`,
    `- DOM fallback recommended: ${String(input.measured.domStateSummary.fallbackRecommended)}`,
    `- DOM input source: ${input.measured.domStateSummary.inputSource ?? "unavailable"}`,
    `- OCR used: ${String(input.measured.domStateSummary.ocrUsed)}`,
    `- PDF capture used: ${String(input.measured.domStateSummary.pdfCaptureUsed)}`,
    "",
    "## Assumptions",
    "",
    `- Agencies: ${input.args.agencies}`,
    `- Active OASIS patients per agency per month: ${input.args.activePatientsPerAgencyPerMonth}`,
    `- Scheduled interval days: ${input.args.scheduledIntervalDays}`,
    `- Average days from OASIS start to completion: ${input.args.daysFromStartToCompletion}`,
    `- Acquisitions per patient: ${input.estimate.assumptions.acquisitionsPerPatient}`,
    `- Changed acquisitions per patient: ${input.estimate.assumptions.changedAcquisitionsPerPatient}`,
    `- Full LLM calls per patient QA: ${input.args.llmCallsPerPatientQa}`,
    `- Average full QA input tokens per call: ${input.estimate.assumptions.averageInputTokens}`,
    `- Average full QA output tokens per call: ${input.args.averageOutputTokens}`,
    `- Retry multiplier: ${input.args.retryMultiplier}`,
    `- Safety overhead multiplier: ${input.args.safetyOverheadMultiplier}`,
    `- Post-QA change rate: ${input.args.postQaChangeRate}`,
    `- Ambiguous precheck rate: ${input.args.ambiguousPrecheckRate}`,
    "",
    "## Scenario Comparison",
    "",
    "Scenario | Full QA runs / patient | Cheap prechecks / patient | Monthly cost | Annual cost | Multiplier vs gated",
    "--- | ---: | ---: | ---: | ---: | ---:",
    ...scenarioRows,
    "",
    "## Sensitivity",
    "",
    "Volume | Patients / agency / month | Current gated monthly | Every acquisition monthly | Multiplier",
    "--- | ---: | ---: | ---: | ---:",
    ...lowMediumHighRows,
    "",
    "## Recommendation",
    "",
    `Running full LLM QA on every OASIS acquisition is estimated at ${multiplier}x the readiness-gated approach under these assumptions.`,
    "Do not enable full LLM QA on every acquisition by default. In-progress OASIS states are incomplete by design, so the expensive output is likely to be noisy and then invalidated by later chart changes.",
    "Keep deterministic DOM readiness gating. Run full LLM QA when the accumulated OASIS state is ready, and rerun only when the content hash changes after QA.",
    "Consider a cheap LLM precheck only for ambiguous deterministic states after measuring actual false-pending and false-ready rates.",
    "",
    "## Telemetry To Add Before Changing Policy",
    "",
    "- Persist Bedrock input/output token usage from response metadata when available.",
    "- Persist prompt input hash and model ID per LLM stage.",
    "- Track acquisition status at each scheduled interval.",
    "- Track how often incomplete OASIS states later change fields that would affect QA conclusions.",
    "- Track fallback, retry, and invalid JSON rates by LLM stage.",
    "",
    `Current gated monthly estimate: ${formatUsd(current?.monthlyCostUsd ?? 0)}.`,
    `Every-acquisition monthly estimate: ${formatUsd(everyAcquisition?.monthlyCostUsd ?? 0)}.`,
    "",
  ].join("\n");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), process.env);
  const measured = await measureArtifacts(args.patientArtifactsDirectory);
  const acquisitionsPerPatient =
    args.acquisitionsPerPatient ??
    Math.max(1, Math.ceil(args.daysFromStartToCompletion / Math.max(1, args.scheduledIntervalDays)) + 1);
  const changedAcquisitionsPerPatient =
    args.changedAcquisitionsPerPatient ??
    Math.max(1, Math.min(acquisitionsPerPatient, Math.ceil(acquisitionsPerPatient * 0.67)));
  const pricing: LlmPricing = {
    modelName: args.modelName,
    inputPricePerMillionTokens: args.inputPricePerMillionTokens,
    outputPricePerMillionTokens: args.outputPricePerMillionTokens,
    pricingSource: args.pricingSource,
  };
  const averageInputTokens = Math.max(1, measured.bridgeTextTokens + measured.factPackTokens);
  const estimate = estimateOasisLlmCost({
    pricing,
    agencies: args.agencies,
    activePatientsPerAgencyPerMonth: args.activePatientsPerAgencyPerMonth,
    acquisitionsPerPatient,
    changedAcquisitionsPerPatient,
    llmCallsPerPatientQa: args.llmCallsPerPatientQa,
    averageInputTokens,
    averageOutputTokens: args.averageOutputTokens,
    retryMultiplier: args.retryMultiplier,
    safetyOverheadMultiplier: args.safetyOverheadMultiplier,
    postQaChangeRate: args.postQaChangeRate,
    ambiguousPrecheckRate: args.ambiguousPrecheckRate,
    cheapPrecheckInputTokenMultiplier: args.cheapPrecheckInputTokenMultiplier,
    cheapPrecheckOutputTokens: args.cheapPrecheckOutputTokens,
  });

  await mkdir(args.outputDirectory, { recursive: true });
  const output = {
    measured,
    estimate,
  };
  const jsonPath = path.join(args.outputDirectory, "oasis-llm-cost-estimate.json");
  const markdownPath = path.join(args.outputDirectory, "oasis-llm-cost-estimate.md");
  await writeFile(jsonPath, JSON.stringify(output, null, 2), "utf8");
  await writeFile(markdownPath, buildMarkdownReport({ args, measured, estimate }), "utf8");

  const current = estimate.scenarios.find((scenario) => scenario.key === "current_gated");
  const every = estimate.scenarios.find((scenario) => scenario.key === "llm_on_every_acquisition");
  console.log(JSON.stringify({
    jsonPath,
    markdownPath,
    bridgeTextTokens: measured.bridgeTextTokens,
    factPackTokens: measured.factPackTokens,
    modelName: pricing.modelName,
    pricingSource: pricing.pricingSource,
    currentGatedMonthlyCostUsd: current?.monthlyCostUsd ?? null,
    everyAcquisitionMonthlyCostUsd: every?.monthlyCostUsd ?? null,
    everyAcquisitionMultiplier: every?.multiplierVsCurrentGated ?? null,
    recommendation: "do_not_run_full_llm_on_every_oasis_acquisition_by_default",
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown OASIS LLM cost estimation error.");
  process.exitCode = 1;
});
