# OASIS LLM Cost Estimation

This runbook describes the local dry-run estimator for comparing readiness-gated OASIS QA against running full LLM QA on every OASIS DOM acquisition.

The estimator does not call Bedrock, Textract, or the portal. It reads local artifacts, estimates token counts, applies configurable model pricing, and writes ignored local reports.

## Why This Exists

OASIS DOM acquisition can run on every scheduled patient interval. Full LLM QA should not automatically run on every scrape because in-progress OASIS content is incomplete and may change before review.

The intended policy is:

- Scrape DOM every interval.
- Merge into `oasis-dom-acquisition-state.json`.
- Skip full LLM QA while status is `in_progress`.
- Run full LLM QA once status is `ready_for_qa`.
- Skip duplicate LLM QA when `lastQaInputHash` matches `overallContentHash`.
- Rerun full LLM QA only when OASIS changes after prior QA.

## Command

From `services/finale-workbook-intake`:

```powershell
pnpm estimate:oasis-llm-cost
```

The default command looks for the Christine Young DOM validation artifacts under:

```text
artifacts/tmp/oasis-dom-christine-validation/run/patients/CHRISTINE_YOUNG__a89bc267c323fb6a
```

It writes:

```text
artifacts/tmp/oasis-llm-cost-estimate/oasis-llm-cost-estimate.json
artifacts/tmp/oasis-llm-cost-estimate/oasis-llm-cost-estimate.md
```

These reports include counts, hashes, token estimates, and costs. They do not include raw OASIS text.

## Pricing Inputs

Pricing is configurable and should be verified against current AWS Bedrock pricing before using the estimate for finance decisions.

PowerShell example:

```powershell
$env:OASIS_LLM_COST_MODEL="amazon.nova-pro-v1:0"
$env:OASIS_LLM_COST_INPUT_PRICE_PER_1M="0.80"
$env:OASIS_LLM_COST_OUTPUT_PRICE_PER_1M="3.20"
$env:OASIS_LLM_COST_PRICING_SOURCE="operator-verified AWS Bedrock pricing page, YYYY-MM-DD"
pnpm estimate:oasis-llm-cost
```

Equivalent CLI args:

```powershell
pnpm estimate:oasis-llm-cost -- --input-price-per-1m 0.80 --output-price-per-1m 3.20 --pricing-source "operator verified"
```

## Editable Assumptions

The estimator accepts:

- `--agencies`
- `--active-patients-per-agency`
- `--scheduled-interval-days`
- `--days-from-start-to-completion`
- `--acquisitions-per-patient`
- `--changed-acquisitions-per-patient`
- `--average-output-tokens`
- `--llm-calls-per-qa`
- `--retry-multiplier`
- `--safety-overhead-multiplier`
- `--post-qa-change-rate`
- `--ambiguous-precheck-rate`
- `--cheap-precheck-input-token-multiplier`
- `--cheap-precheck-output-tokens`
- `--patient-artifacts-dir`
- `--output-dir`

Every option has a matching `OASIS_LLM_COST_*` environment variable in the estimator source.

## Scenarios

The report compares:

- Scenario A: current readiness-gated DOM acquisition.
- Scenario B: full LLM QA on every acquisition, including incomplete and unchanged OASIS states.
- Scenario C: full LLM QA on every changed DOM hash, even before readiness.
- Scenario D: deterministic readiness plus cheap LLM precheck only for ambiguous states.

## Interpretation

If Scenario B is materially more expensive than Scenario A, keep the readiness gate. Full LLM QA on incomplete OASIS is usually low-value because the output can be invalidated by later chart completion.

The expected decision is:

- Do not run full LLM QA on every OASIS acquisition by default.
- Keep deterministic DOM readiness gating.
- Add a cheap LLM precheck only after collecting telemetry showing deterministic readiness is ambiguous often enough to justify it.

## Telemetry To Add Before Changing Policy

- Persist Bedrock input/output token usage from response metadata where available.
- Persist prompt input hash and model ID per LLM stage.
- Track acquisition status on every scheduled interval.
- Track DOM content hash changes before and after OASIS readiness.
- Track retry rate, invalid JSON rate, and fallback rate per LLM stage.
