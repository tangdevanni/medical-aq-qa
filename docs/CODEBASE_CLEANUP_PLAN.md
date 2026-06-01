# Codebase Cleanup Plan

Scope: safe cleanup preparation only. Do not refactor runtime behavior, Visit Notes lifecycle behavior, OASIS Validation Snapshot behavior, or portal automation behavior in this pass.

## Repo Hygiene Audit

No files were deleted during this audit.

| Path / pattern | Classification | Recommendation |
| --- | --- | --- |
| `.tmp*`, `.tmp/`, `.tmp-*/`, `.tmp-docker-build-check/` | generated local artifact / debug artifact / temporary script / scratch workspace copy | Should be gitignored. Safe to delete locally after confirming no process is using `.pid` files. |
| `.tmp-api-task-def*.json`, `.tmp-dashboard-task-def*.json`, `.tmp-current-api-taskdef.json` | generated local deployment/debug task definitions | Should be gitignored. Safe to delete locally; do not use as canonical deployment config. |
| `.tmp-api-dev*.log`, `.tmp-dashboard-dev*.log`, `.tmp-*-pid` | local run outputs | Already covered by `*.log`; `.tmp*` now covers the rest. Safe to delete locally. |
| `.tmp-file-upload-open-probe.cjs`, `.tmp-playwright-ui-review.cjs` | temporary script | Should be gitignored. Safe to delete locally if not actively used for debugging. |
| `batch-detail.json`, `patient-detail.json`, `batch-planning-search.txt`, `source-limit-search.txt` | debug artifact / local API output | Should be gitignored. Safe to delete locally. |
| `apps/dashboard/.next-dev/`, `apps/dashboard/.next/`, `*.tsbuildinfo` | build output | Already gitignored. Safe to delete locally; regenerate with dashboard dev/build. |
| `artifacts/tmp/` | generated local artifact | Should be gitignored. Safe to delete locally. |
| `artifacts/dashboard-verification/`, `artifacts/playwright-christine-review/` | local Playwright/report output | Should be gitignored. Safe to delete locally. |
| `artifacts/smoke-calendar/` | generated smoke output, possibly used as sample evidence | Must keep until intentionally replaced with a fixture or documented sample. |
| `artifacts/local-demo-*` | stale demo/local run output | Should remain untracked/local. Safe to archive or delete after confirming no docs link to it. |
| `services/finale-workbook-intake/artifacts/tmp/` | generated patient artifacts / debug artifact / local replay output | Should be gitignored. Safe to delete locally; contains many replay/live-verification runs. |
| `services/finale-workbook-intake/artifacts/demo/oasis-qa-demo-*/` | generated demo run output | Should be gitignored and removed from tracking. Safe to regenerate with `pnpm demo:oasis-qa`; do not treat timestamped runs as source fixtures. |
| `services/finale-workbook-intake/artifacts/demo/llm-christine-2026-04-20/` | curated script-referenced demo bundle | Keep tracked until replaced by a smaller fixture. Scripts and API demo seeding reference this exact bundle. |
| `services/finale-workbook-intake/artifacts/demo/_coding-input-smoke/` | small smoke fixture | Keep tracked while smoke/replay workflows depend on it. |
| `services/finale-workbook-intake/artifacts/test/` | generated test output | Should be gitignored. Safe to delete locally. |
| `services/finale-workbook-intake/src/tests/fixtures/**` | test fixture | Must keep. Do not gitignore. |
| `services/finale-workbook-intake/assets/poc-question-bank/**` | source/test data asset | Must keep. Do not gitignore. |
| `data/control-plane/**`, `services/api/data/control-plane/**` | runtime control-plane data | Already gitignored except README. Safe to delete only as an operator reset action. |
| `.auth/`, `services/api/.auth/` | local auth/session state | Should be gitignored. Safe to delete locally when resetting auth state. |
| `deploy/aws/ecs/*.json` | source deployment templates | Source file. Must keep. |
| `api-task-def.json`, `dashboard-taskdef-new.json` | ambiguous root deployment/debug files | Classify as debug artifact unless promoted to `deploy/aws/ecs`. Do not delete without owner confirmation. |
| `awsreadme.md` | ambiguous local docs | Must keep until reviewed; consider moving content into `docs/runbooks/` if still relevant. |
| `Microsoft/` | local tool/cache directory | Should be gitignored. Safe to delete locally if no tool is running from it. |

## .gitignore Audit

Added narrow ignores for:

- repo-root `.tmp*` scratch files and directories
- root debug outputs (`batch-detail.json`, `patient-detail.json`, search dumps)
- local artifact output directories under `artifacts/`
- intake scratch/test artifact outputs under `services/finale-workbook-intake/artifacts/`
- generated timestamped OASIS demo runs under `services/finale-workbook-intake/artifacts/demo/oasis-qa-demo-*/`
- local auth state under `.auth/` and `services/api/.auth/`

Not ignored:

- `services/finale-workbook-intake/src/tests/fixtures/**`
- `services/finale-workbook-intake/assets/**`
- `deploy/aws/ecs/**`
- `docs/**`
- curated demo fixtures under `services/finale-workbook-intake/artifacts/demo/llm-christine-2026-04-20/**` and `_coding-input-smoke/**`

## Artifact Source-Control Policy

- Source-controlled demo artifacts must be named fixtures with an active reader or script reference.
- Timestamped run output such as `oasis-qa-demo-2026-*` is generated output. Keep it local, ignored, and regenerable.
- Runtime control-plane data under `data/control-plane/**` and `services/api/data/control-plane/**` is not source. Keep only documentation such as `services/api/data/control-plane/batches/README.md`.
- If a generated artifact becomes required for tests, promote the minimum redacted sample into `src/tests/fixtures/**` and document the reader contract in `docs/ARTIFACT_CONTRACTS.md`.
- Do not quote patient artifact contents in docs or PR text; document file names, contracts, and behavior instead.

## God-File Audit

| File | Approx. responsibility | Risk | Future extraction boundary |
| --- | --- | --- | --- |
| `services/finale-workbook-intake/src/portal/pages/PatientChartPage.ts` (~7800 lines) | Portal page object for patient chart navigation and interactions | Highest portal automation blast radius; selector, navigation, and extraction concerns are coupled | Split by portal tab/feature: demographics, OASIS, documents, visit notes, chart utilities, selector catalog |
| `services/api/src/mappers/dashboardRunViews.ts` (~4676 lines) | Converts batch/patient artifacts into dashboard API views | High dashboard contract risk; many artifact fallback paths and projection rules in one file | Extract artifact readers/normalizers, documentation review projection, Visit Notes projection, comparison row projection, POC projection |
| `services/api/src/services/batchControlPlaneService.ts` (~3927 lines) | Batch lifecycle, fixture/demo seeding, reruns, artifact overlays, control-plane persistence | High operational risk; runtime control-plane and demo/test seeding are coupled | Split repository orchestration, artifact overlay selection, demo seed service, rerun service, batch state transitions |
| `services/finale-workbook-intake/src/services/batchRunService.ts` (~2297 lines) | Intake batch orchestration and per-patient artifact generation | High workflow ordering risk; many artifact contracts are emitted here or coordinated here | Extract patient artifact pipeline, dashboard-state phase, POC phase, Visit Notes phase, cleanup/reset policy |
| `apps/dashboard/app/runs/[runId]/patients/[patientId]/page.tsx` (~2208 lines) | Patient detail UI for comparison, OASIS, referral, Visit Notes, POC, artifacts | High UI regression risk; many domain panels and derived display states are co-located | Extract server data loader, artifact tab sections, comparison table, Visit Notes section, POC section, OASIS/referral sections |
| `services/finale-workbook-intake/src/services/documentExtractionService.ts` (~2050 lines) | OCR/text extraction, repair, cache/write paths | High artifact quality risk; extraction provider logic and artifact writes are coupled | Split provider adapters, extraction repair, text normalization, cache persistence |
| `services/finale-workbook-intake/src/workers/playwrightBatchQaWorker.ts` (~1699 lines) | Batch portal automation client for patient resolution, OASIS capture, Visit Notes discovery, failure artifacts | High portal safety risk; read-only capture and live automation entry points share a client | Extract read-only patient context, OASIS review capture, Visit Notes discovery/capture, failure artifact writer |
| `services/finale-workbook-intake/src/services/patientDashboardStateWriter.ts` (~1108 lines) | Writes canonical patient dashboard state and related derived artifacts | High artifact contract risk; creates fact packs, POC review artifacts, lineage, and dashboard state in one service | Split artifact path resolver, fact-pack writer, POC artifact writer, lineage writer, dashboard-state serializer |
| `services/finale-workbook-intake/src/services/visitNoteQaAnalysisService.ts` (~772 lines) | Visit Note QA review and processing manifest generation | Medium-high Visit Notes contract risk | Keep lifecycle policy isolated; extract manifest writer, review builder, finding normalization |
| `services/finale-workbook-intake/src/services/diagnosisExtractionService.ts` (~741 lines) | OASIS/referral diagnosis extraction artifacts | Medium-high clinical artifact risk | Split OASIS diagnosis extraction, referral diagnosis extraction, shared diagnosis row normalization |
| `services/finale-workbook-intake/src/services/clinicalComparisonRowBuilder.ts` (~661 lines) | Builds canonical clinical comparison rows from fact packs and diagnosis artifacts | High dashboard-facing safety risk | Extract diagnosis row comparison, source-vs-OASIS fact matching, evidence/source attribution |
| `services/finale-workbook-intake/src/services/oasisClinicalFactPackBuilder.ts` | Builds OASIS clinical fact pack from OASIS artifacts | High OASIS snapshot risk | Keep broad fact-pack evidence separate from field-specific OASIS evidence; extract diagnosis, functional, med, wound sections |
| Visit Notes services (`visitNoteFactPackBuilder.ts`, `visitNoteNormalizationService.ts`, `visitNotePocAlignmentAgent.ts`, `visitNote*Agent.ts`) | Capture normalization, fact-pack construction, LLM review agents, POC mapping | Medium-high lifecycle and dashboard risk | Preserve active/finalized policy; extract pure mappers and schema validation before agent orchestration |
| OASIS/fact-pack services (`sourceClinicalFactPackBuilder.ts`, `oasisClinicalFactPackBuilder.ts`, `clinicalContradiction*`) | Source/OASIS fact-pack and contradiction analysis | High clinical correctness risk | Separate evidence collection, fact normalization, contradiction matching, suppression/calibration |

## Validation Checklist

Visit Notes:

- `pnpm --filter @medical-ai-qa/finale-workbook-intake test -- visitNote`
- `pnpm --filter @medical-ai-qa/api test -- src/tests/dashboardRunViews.test.ts`
- `pnpm --filter @medical-ai-qa/dashboard test -- components/VisitNotesReviewPanel.test.tsx`

OASIS Validation Snapshot:

- `pnpm --filter @medical-ai-qa/finale-workbook-intake test -- src/tests/oasisClinicalFactPackBuilder.test.ts src/tests/oasisExtractionCoverageReportService.test.ts src/tests/oasisGateService.test.ts`
- `pnpm --filter @medical-ai-qa/api test -- src/tests/dashboardRunViews.test.ts`

API dashboard projection:

- `pnpm --filter @medical-ai-qa/api typecheck`
- `pnpm --filter @medical-ai-qa/api test -- src/tests/dashboardRunViews.test.ts src/tests/verificationRoutes.test.ts`

Dashboard build:

- `pnpm --filter @medical-ai-qa/dashboard typecheck`
- `pnpm --filter @medical-ai-qa/dashboard build`

Full typecheck:

- `pnpm --filter @medical-ai-qa/finale-workbook-intake typecheck`
- `pnpm --filter @medical-ai-qa/api typecheck`
- `pnpm --filter @medical-ai-qa/dashboard typecheck`
- `pnpm -r typecheck`

## Recommended Next Cleanup Slice

Start with contract-only extraction around `patientDashboardStateWriter.ts`:

1. Move artifact filename/path constants into a small artifact contract module.
2. Add schema validation at read/write boundaries where schemas already exist.
3. Extract lineage/dashboard-state serialization helpers without changing generated JSON.
4. Run focused artifact snapshot tests plus the three requested typecheck/build commands.

Do not start with `PatientChartPage.ts`; that has the largest live portal automation risk.
