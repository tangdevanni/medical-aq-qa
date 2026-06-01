# Local Development

## Prerequisites

- Node.js 20+
- `pnpm`

## Setup

1. Run `pnpm install` at the repository root.
2. Copy `.env.example`, `services/finale-workbook-intake/.env.example`, and `services/portal-worker/.env.example` as needed for local values.
   Keep `BEDROCK_MODEL_ID=amazon.nova-pro-v1:0` unless you are intentionally testing another model.
3. On Windows, open a repo-local dev shell before running replay or audit commands:

```powershell
.\scripts\dev-shell.cmd
```

This keeps `HOME`, `USERPROFILE`, `TEMP`, `TMP`, `PNPM_HOME`, pnpm cache/store/state, Corepack state, and Playwright browser downloads inside the repo so tooling writes stay under `C:\dev\medical-aq-qa`.
If you prefer PowerShell directly, use `powershell -NoExit -ExecutionPolicy Bypass -Command ". '.\scripts\dev-shell.ps1'"`.
The repo `.npmrc` also pins pnpm's store/cache/state/global directories to workspace-local folders. If `pnpm` itself is not installed in `.pnpm-home`, bootstrap it from inside this shell with Corepack or a local pnpm install before running workspace scripts; avoid running the user-profile shim from a normal PowerShell session.
Run this one-time Git fix too if `git` reports dubious ownership:

```powershell
git config --global --add safe.directory C:/dev/medical-aq-qa
```
4. Run `pnpm build` to compile all packages.
5. Run `pnpm typecheck` to validate the workspace.

## Service Commands

- API: `pnpm dev:api`
- Orchestrator: `pnpm dev:orchestrator`
- Portal worker: `pnpm dev:portal-worker`
- Dashboard: `pnpm dev:dashboard`
- Intake typecheck: `pnpm typecheck:intake`
- Christine LLM audit replay: `pnpm audit:christine:llm`
- Christine POC replay: `pnpm replay:christine:poc`
- Dashboard verification Playwright: `pnpm verify:dashboard`

## Dashboard Demo Notes

- The dashboard/API run path and the direct `demo:oasis-qa` flow now use the same Finale workbook intake portal bootstrap.
- Keep portal credentials and `PORTAL_DASHBOARD_URL` in `services/finale-workbook-intake/.env` so both CLI and API-triggered runs resolve the same provider dashboard context.
- For normal local development, set `API_AUTONOMOUS_MODE=manual_only` so agency refreshes do not start automatically on API boot.
- Set `API_ENABLE_VERIFICATION_ROUTES=true` whenever you want to run the dashboard Playwright verification harness against a seeded control-plane fixture.
- Pair that with `DEFAULT_SUBSIDIARY_RERUN_ENABLED=false` and `FINALE_PATIENT_CONCURRENCY=1` to avoid background reruns, token burn, and noisy parallel debugging.
- Before any replay or Docker build that depends on Plan of Care generation, regenerate the normalized question bank:

```powershell
pnpm --dir services/finale-workbook-intake poc:normalize-question-bank
```

## Dashboard Verification Harness

Use the same seeded verification flow locally that staging will use:

1. Start the API with:
   - `API_AUTONOMOUS_MODE=manual_only`
   - `DEFAULT_SUBSIDIARY_RERUN_ENABLED=false`
   - `FINALE_PATIENT_CONCURRENCY=1`
   - `API_ENABLE_VERIFICATION_ROUTES=true`
2. Start the dashboard.
3. Run:

```powershell
pnpm verify:dashboard
```

The Playwright harness seeds a non-production verification batch for `star-home-health`, signs into the dashboard, verifies the agency queue, opens patient detail pages, checks `OASIS Gate` and `AI Plan of Care`, and writes a scorecard JSON report to `artifacts/dashboard-verification/dashboard-verification-local.json`.

## Christine Young Demo

For a full frontend/backend demo backed by Christine Young's saved referral, OASIS, and Plan of Care artifacts:

1. Start the API with:
   - `API_AUTONOMOUS_MODE=manual_only`
   - `DEFAULT_SUBSIDIARY_RERUN_ENABLED=false`
   - `FINALE_PATIENT_CONCURRENCY=1`
   - `API_ENABLE_VERIFICATION_ROUTES=true`
2. Start the dashboard.
3. Seed the demo batch:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/testing/demo/christine-young/seed `
  -ContentType "application/json" `
  -Body '{"agencyId":"star-home-health","assumeOasisPassed":true}'
```

4. Sign into the dashboard, select `star-home-health`, and open Christine Young from the patient queue.

The seeded demo uses Christine's stored artifact bundle for the patient detail view and Plan of Care tab. Because the legacy bundle does not contain persisted OASIS gate JSON, the seed route assumes a clean OASIS pass when `assumeOasisPassed=true` so the dashboard can render the POC state alongside the rest of her captured data.

You can also run the seeded smoke helper once the API and dashboard are up:

```powershell
pnpm smoke:christine:demo
```

It reseeds Christine, checks the backend snapshot, and prints the exact dashboard state to confirm.

## Control Plane Storage

- The API's canonical local storage root is `services/api/data/control-plane`.
- The legacy workspace-level `data/control-plane` path is no longer the default source of truth and is ignored by Git.
- `pnpm reset:control-plane` now resets only the canonical API storage root.
- If you still need to purge an old workspace-level tree, run `cmd /c pnpm exec tsx services/api/src/testing/resetAgencyControlPlane.ts --all --include-legacy-root`.

## Portal Worker Phases

- Phase 10 single-note QA: `pnpm --filter @medical-ai-qa/portal-worker dev:phase10`
- Phase 11 queue QA pipeline: `pnpm --filter @medical-ai-qa/portal-worker dev:phase11`

## Phase 11 Notes

- The Phase 11 runner is read-only and is intended for QA Monitoring queue scans plus visit-note extraction and rule evaluation.
- Default local payload values are conservative: `maxRowsToScan=10`, `maxTargetNotesToProcess=5`, `captureSectionSamples=false`, and `revisitQueueBetweenRows=true`.
- Review the structured JSON output rather than logs for row-level results. Audit logs intentionally keep only compact counts and statuses.
