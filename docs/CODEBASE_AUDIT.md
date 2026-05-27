# Codebase Audit

This audit records cleanup findings for the Medical QA Automation monorepo. It is scoped to maintainability, reliability, security hygiene, and developer handoff risk. It avoids raw patient data and secret values.

## Executive Summary

The active product path is a pnpm monorepo where the Fastify API calls `@medical-ai-qa/finale-workbook-intake` directly, persists filesystem control-plane artifacts, and serves them to the Next.js dashboard. The standalone `services/orchestrator` and much of `services/portal-worker` are not the primary API/dashboard execution path today, which is a major source of confusion.

The highest-risk areas are broad Playwright selector fallbacks, duplicate dashboard/API DTOs, partially validated artifact reads, local PHI/secrets hygiene, and uneven test script wiring. Cleanup should stay incremental because artifact compatibility and portal behavior are easy to break.

## Resolved In Cleanup Pass

- Fixed the demo Docker dashboard API target in `docker-compose.demo.yml`. The dashboard container now uses `NEXT_PUBLIC_API_BASE_URL=http://api:3000` so server-side dashboard fetches route to the Compose API service instead of the dashboard container itself.
- Added an API package test script in `services/api/package.json` for existing `node:test` suites under `services/api/src/tests`.
- Added a dashboard package test script in `apps/dashboard/package.json` for existing `node:test` suites under `apps/dashboard/app`, `apps/dashboard/lib`, and `apps/dashboard/components`.
- Added a root `pnpm test` script that runs API tests, dashboard tests, and the existing intake Vitest suite.
- Added `scripts/run-node-tests.mjs` so package test scripts discover `.test.ts` and `.test.tsx` files without relying on shell glob expansion.

## Validation Notes From Cleanup Pass

- `cmd /c pnpm --filter @medical-ai-qa/api typecheck` passed.
- `cmd /c pnpm --filter @medical-ai-qa/api test` ran the newly wired API tests, but existing tests failed. Failures are concentrated in `services/api/src/tests/dashboardRunViews.test.ts` and demo seed expectations in `services/api/src/tests/verificationRoutes.test.ts`.
- `cmd /c pnpm --filter @medical-ai-qa/dashboard test` and `cmd /c pnpm -r typecheck` were blocked by an existing local `EPERM: operation not permitted, lstat 'C:\Users\short'` issue. This is the same environment class described by `docs/runbooks/local-dev.md`; use the repo-local dev shell before treating dashboard lifecycle failures as code regressions.
- `cmd /c pnpm --filter @medical-ai-qa/finale-workbook-intake test` exceeded the command timeout in this cleanup environment, so it was not treated as a product regression.

## Resolved In Cleanup Pass 2

- Completed the repo-local Windows tooling path fix. `scripts/dev-shell.ps1` now creates `.pnpm-home\pnpm.ps1` and `.pnpm-home\pnpm.cmd` shims pointing at the repo-local Corepack pnpm package under `.corepack`, so `pnpm` no longer resolves through `C:\Users\short\AppData\Roaming\npm` after the dev shell is loaded.
- Confirmed `HOME`, `USERPROFILE`, `TEMP`, `TMP`, `PNPM_HOME`, `COREPACK_HOME`, pnpm cache/store/state, and Playwright browser cache resolve under `C:\dev\medical-aq-qa` in the dev shell.
- Fixed `services/api/src/mappers/dashboardRunViews.ts` so the canonical `clinical-comparison-rows.json` dashboard path is used only when canonical rows are present or explicitly pending/ready. Older runs without canonical comparison rows now keep the legacy referral/OASIS dashboard fallback instead of rendering empty dashboard rows.
- Fixed verification rerun artifact preference in `services/api/src/services/batchControlPlaneService.ts`. Overlay selection now uses `patient-dashboard-state.json` timestamps (`lastUpdatedAt`/`generatedAt`) before filesystem mtime, and agency dashboard snapshots use the same effective patient-run overlay as patient detail reads.
- Fixed API test fixtures in `services/api/src/tests/verificationRoutes.test.ts` and `services/api/src/tests/christineYoungDemoSeed.test.ts` so Christine demo artifacts resolve from the workspace root instead of `services/api`.
- Fixed `services/api/src/tests/batchControlPlaneService.test.ts` fixture setup by creating required output directories and isolating the verification-rerun dashboard fixture from autonomous startup batches.
- Updated the stale dashboard wording assertion in `services/api/src/tests/dashboardRunViews.test.ts` to match the current clinician-facing copy normalization.

## Validation Notes From Cleanup Pass 2

- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm --filter @medical-ai-qa/api typecheck }"` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm --filter @medical-ai-qa/api test }"` passed: 63 tests, 7 suites.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm --filter @medical-ai-qa/dashboard test }"` passed: 40 tests, 8 suites.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm test }"` ran API and dashboard successfully, then failed in `@medical-ai-qa/finale-workbook-intake`. The remaining failures are intake-suite issues: several Vitest files with no registered suites, multiple `batchRunService.test.ts` timeouts, and stale expectations in File Upload capture, printed-note extraction, referral facts extraction, and referral proposal tests.
- No validation command failed with `EPERM: lstat 'C:\Users\short'` after loading the repo-local dev shell. In this sandbox, pnpm/Node commands that traverse Windows `node_modules` junctions still required elevated execution, but the process environment and pnpm executable were repo-local.

## Resolved In Cleanup Pass 3

- Converted the remaining intake `node:test` suites (`oasisGateService.test.ts`, `pocQuestionBankNormalizer.test.ts`, `pocQuestionRetriever.test.ts`, and `referralOasisConsistencyService.test.ts`) to Vitest so the package runner no longer reports "No test suite found."
- Made intake unit tests independent from live Bedrock startup checks by disabling `CODE_LLM_ENABLED` inside the batch/demo harness test files and restoring the previous process env after each file.
- Fixed controlled File Upload catalog/planning behavior so deterministic admin/insurance/consent rows classified with `clinicalRelevance: "ignore"` persist as ineligible `unsafe_action_only` skips instead of being considered capturable until a capture limit is reached.
- Fixed deterministic printed-note caregiver extraction to strip OCR/header labels such as `Email` from caregiver names.
- Tightened deterministic referral extraction for M1005 discharge dates, PT frequency lines, and diagnosis-coded functional limitations (`M62.81`, `R26.2`).
- Fixed source clinical fact-pack collection so camelCase paths such as `primaryDiagnosis`/`secondaryDiagnosis` are categorized as diagnosis facts before validation/dedupe.
- Updated stale expectations in referral, document catalog, source fact-pack, and batch/demo tests to match current title-casing, artifact gating, no-LLM unit-test behavior, and evidence requirements.

## Validation Notes From Cleanup Pass 3

- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm --filter @medical-ai-qa/finale-workbook-intake typecheck; exit `$LASTEXITCODE }"` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm --filter @medical-ai-qa/finale-workbook-intake test -- --reporter=default; exit `$LASTEXITCODE }"` passed: 90 files, 426 tests.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . .\scripts\dev-shell.ps1; pnpm test; exit `$LASTEXITCODE }"` passed across API, dashboard, and intake.
- No command in this pass failed with `EPERM: lstat 'C:\Users\short'`; dev-shell output showed HOME/USERPROFILE/TEMP/TMP/pnpm/Corepack paths under `C:\dev\medical-aq-qa`.
- Remaining risk: the repo still has many unrelated dirty/generated artifacts and tracked demo outputs. Keep code cleanup commits scoped and avoid staging generated `.next-dev`, `.runtime`, `.pnpm-*`, `.corepack`, `.sandbox-home`, and patient/demo artifact output unless deliberately cleaning artifact storage.

## Resolved In Cleanup Pass 4

- Removed tracked Next.js dev output, TypeScript build info, local auth state, scratch workspace copies, and filesystem control-plane runtime data from the Git index while preserving local files.
- Added ignore coverage for repo-local package/runtime caches, scratch files, generated task definitions, Next.js dev output, TypeScript build info, runtime data, local auth state, and timestamped OASIS demo runs.
- Preserved `services/api/data/control-plane/batches/README.md` as tracked documentation while ignoring generated batch directories.
- Established the demo artifact source-control policy: keep curated script-referenced bundles such as `llm-christine-2026-04-20`, but ignore timestamped `oasis-qa-demo-*` output.
- Added and corrected documentation in `docs/CODEBASE_CLEANUP_PLAN.md` and `docs/ARTIFACT_CONTRACTS.md` so artifact ownership, validation commands, and source-control rules are explicit.

## Validation Notes From Cleanup Pass 4

- `git diff --check` passed, with only expected Windows line-ending warnings.
- `pnpm --filter @medical-ai-qa/api typecheck` passed.
- `pnpm --filter @medical-ai-qa/dashboard typecheck` passed.
- `pnpm --filter @medical-ai-qa/finale-workbook-intake typecheck` passed.
- `pnpm --filter @medical-ai-qa/finale-workbook-intake test -- visitNote` passed: 8 files, 61 tests.
- `pnpm --filter @medical-ai-qa/api test -- src/tests/dashboardRunViews.test.ts src/tests/verificationRoutes.test.ts` passed: 7 suites, 66 tests.
- `pnpm --filter @medical-ai-qa/dashboard test -- components/VisitNotesReviewPanel.test.tsx` passed: 14 suites, 43 tests.
- `pnpm --filter @medical-ai-qa/finale-workbook-intake test -- src/tests/oasisClinicalFactPackBuilder.test.ts src/tests/oasisExtractionCoverageReportService.test.ts src/tests/oasisGateService.test.ts` passed: 3 files, 23 tests.
- `pnpm -r typecheck` passed across workspace packages.
- `pnpm --filter @medical-ai-qa/dashboard build` passed.

## High-Priority Recommendations

- Harden portal authentication and chart-open checks in `services/finale-workbook-intake/src/portal/selectors/login.selectors.ts`, `LoginPage.ts`, `patient-search.selectors.ts`, and `PatientSearchPage.ts`. Current broad `main` markers can false-positive on generic shells.
- Preserve or migrate `visit-note-processing-manifest.json` before `batchRunService.ts` clears per-patient runtime artifacts, otherwise already-processed Visit Notes detection cannot work across full reruns.
- Move dashboard/API response contracts such as `RunDetail`, `PatientDetail`, and status/artifact response types from `apps/dashboard/lib/types.ts` and `services/api/src/mappers/dashboardRunViews.ts` into `packages/shared-types`.
- Validate `patient-dashboard-state.json` at API read boundaries using the shared schema instead of casting parsed JSON to `PatientDashboardState`.
- Redact client-facing API errors in `services/api/src/app.ts`; raw errors may include filesystem paths, portal URLs, or patient identifiers.

## Medium-Priority Recommendations

- Add a fallback or explicit pending state when `clinicalComparisonRows` are pending so `dashboardRunViews.ts` does not blank useful referral/OASIS context.
- Split very large files into smaller modules after tests are in place. Current hotspots include `PatientChartPage.ts`, `dashboardRunViews.ts`, `batchControlPlaneService.ts`, `batchRunService.ts`, and `apps/dashboard/app/runs/[runId]/patients/[patientId]/page.tsx`.
- Add aggregate test scripts for `services/portal-worker` once the desired subset of phase/prototype tests is agreed.
- Exclude test/demo sources from production `tsc` outputs or Docker runtime copies for API/intake.
- Improve recursive log redaction in `packages/shared-logging` and `services/portal-worker/src/audit/redact.ts`.

## Low-Priority Recommendations

- Update `README.md` and top-level handoff docs to reflect that the API currently invokes the workbook-intake package directly.
- Keep portal maps in `docs/portal-maps` synchronized when selectors are changed.
- Clarify which `services/portal-worker` phase runners are experimental versus production-supported.

## Risk Areas

- Portal automation is read-only by default but contains aggressive click fallbacks. Avoid changing selectors without targeted tests and, where possible, a live dry run.
- Artifact files under `services/finale-workbook-intake/artifacts` and control-plane data may contain PHI. Do not quote artifact contents in docs, logs, PRs, or prompts.
- Local `.env` and ad hoc task-definition JSON files may contain sensitive values. Do not commit or echo them; rotate any exposed values outside this cleanup.
- Existing artifacts must remain readable unless a migration updates readers, shared types, tests, and docs together.

## Suggested Cleanup Order

1. Finish documentation handoff files that are currently missing: `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/RUNBOOK.md`, and `docs/PLANS.md`.
2. Move dashboard/API DTOs into `packages/shared-types` and add package tests around mapper output.
3. Add schema validation at artifact read boundaries.
4. Harden portal authenticated/chart markers and remove broad `main` success markers.
5. Fix Visit Notes manifest reuse across reruns.
6. Split the largest files only after tests cover the moved behavior.

## Testing Gaps

- API and dashboard tests existed but were not wired to package scripts before this cleanup pass.
- Portal-worker has many one-off `test:*` scripts but no agreed aggregate test command.
- No coverage command or threshold is configured.
- Playwright dashboard verification exists via `pnpm verify:dashboard`, but it requires a running API/dashboard and seeded verification routes.

## Documentation Gaps

- The requested top-level docs `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/RUNBOOK.md`, and `docs/PLANS.md` were not present at the start of this cleanup pass.
- Existing `README.md` still includes older scaffold-era language and should be reconciled with the current API/intake/dashboard flow.
