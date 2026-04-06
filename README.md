# medical-ai-qa

Monorepo scaffold for an internal medical portal QA automation system. The repository is split into service packages for orchestration, browser automation, and HTTP health endpoints, plus shared packages for types, config, and logging.

## Workspace

- `services/orchestrator`: accepts portal jobs and dispatches them.
- `services/portal-worker`: runs Playwright-backed login workflows.
- `services/api`: exposes a basic health endpoint.
- `packages/shared-types`: shared DTOs and workflow types.
- `packages/shared-config`: constants and default runtime settings.
- `packages/shared-logging`: lightweight structured logger.
- `docs`: portal maps and operator runbooks.

## Getting Started

```bash
pnpm install
pnpm build
pnpm typecheck
```

To start an individual service in development:

```bash
pnpm dev:api
pnpm dev:orchestrator
pnpm dev:portal-worker
```

## Notes

- The portal worker is scaffolded for a login flow and should be extended with per-portal selectors and post-login assertions.
- The orchestrator currently uses a local dispatch stub. Replace it with queue or RPC integration when the service boundaries are finalized.
- An unrelated legacy Java file remains under `src/Main.java` and was left untouched.


# 1. Executive Summary

- In reality, the repo currently supports a working workbook-first batch pipeline: it parses an Excel workbook, normalizes patient episode work items, runs deterministic OASIS QA, and persists JSON/evidence artifacts to the filesystem. The main implementation lives in /C:/Users/short/OneDrive/Desktop/    
  medical-aq-qa/services/finale-workbook-intake/package.json, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/workbookIntakeService.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/batchRunService.ts.
- The current demo entrypoint is workbook-driven by default. pnpm demo:oasis-qa resolves to /C:/Users/short/OneDrive/Desktop/medical-aq-qa/package.json -> /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/package.json -> /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/
  finale-workbook-intake/src/testing/run-oasis-demo.ts -> /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts.
- The repo also contains a larger, separate Playwright automation stack in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker with queue, write-guard, and workflow code, but that package is not the current execution path for the workbook demo or API control plane.
- The API and dashboard are real and usable: the API stores batches under services/api/data/control-plane, and the dashboard uploads workbooks and browses results through that API. See /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/routes/batches.ts, /C:/Users/short/OneDrive/Desktop/     
  medical-aq-qa/services/api/src/services/batchControlPlaneService.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/batches/page.tsx.
- The orchestrator service is still a stub. /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/orchestrator.ts logs that polling is not implemented, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/local-dispatch.ts returns a stub response.
- Live portal traversal exists in code, but repo evidence shows it is not yet stable. A persisted control-plane batch at /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/batch.json and /C:/Users/short/OneDrive/Desktop/medical-  
  aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/outputs/batch-summary.json shows 20 work items parsed, 55 parser exceptions, and all 20 patient runs blocked with Patient search input selector was not found.

# 2. Repo Map

- apps/dashboard: Next.js control-plane UI for uploading workbooks, polling batch state, and viewing patient logs/artifacts. Status: implemented/partial. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/package.json, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/
  batches/page.tsx, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/lib/api.ts.
- services/api: Fastify API/control plane for workbook upload, parse/run orchestration, and batch/patient result retrieval backed by filesystem storage. Status: implemented. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/package.json, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/
  services/api/src/app.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/routes/batches.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/routes/patientRuns.ts.
- services/finale-workbook-intake: The actual workbook parser, normalization pipeline, batch runner, deterministic QA engine, and current demo harness. Status: implemented/partial. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/package.json, /C:/Users/short/      
  OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/parsers/workbookParser.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/workbookIntakeService.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/
  batchRunService.ts.
- services/orchestrator: Intended orchestration service, but currently only bootstraps and logs an unimplemented polling loop. Status: stub. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/package.json, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/   
  src/orchestrator.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/local-dispatch.ts.
- services/portal-worker: Separate Playwright/queue/workflow automation system with login, queue QA, decision, write-guard, and workflow execution code. Status: partial and not wired to current workbook demo/API path. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/        
  package.json, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/worker.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/pipelines/queueQaPipeline.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/workflows/                 
  workflowExecutor.ts.
- packages/shared-types: Shared schemas and domain contracts for batch state, patient runs, automation step logs, document inventory, QA summaries, portal safety, and jobs. Status: implemented. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/index.ts, /C:/Users/short/   
  OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/patient-episode-work-item.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/oasis-qa.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/portal-job.ts.
- packages/shared-config: Minimal shared constants package used by orchestrator/portal-worker. Status: implemented but small. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-config/src/constants.ts.
- packages/shared-logging: Minimal shared logger wrapper. Status: implemented but small. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-logging/src/logger.ts.
- docs/portal-maps and docs/runbooks: Operator notes and portal map docs exist, but at least some docs are outdated relative to code. Status: partial/outdated. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/docs/portal-maps/finale-health.md, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/docs/  
  runbooks/finale-workbook-intake.md, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/README.md.

# 3. Current End-to-End Flow in Code

- Demo path: pnpm demo:oasis-qa in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/package.json delegates to /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/package.json, which builds and runs /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/
  testing/run-oasis-demo.ts.
- Demo entrypoint: run-oasis-demo.ts parses --workbook, --patient, --limit, --all, --live, and --output-dir, then calls runOasisDemoHarness in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts.
- Workbook phase: runOasisDemoHarness calls intakeWorkbook in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/workbookIntakeService.ts, which calls parseWorkbook in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/parsers/      
  workbookParser.ts, runs mapper modules, then aggregates episodes in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/mappers/patientEpisodeAggregator.ts.
- Batch phase: runOasisDemoHarness passes the selected work items into runFinaleBatch in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/batchRunService.ts.
- Non-live demo mode: the harness injects DemoReadOnlyPortalClient from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts, so workbook intake is real but portal traversal/evidence are simulated.
- Live demo mode: --live leaves the portal client undefined, so runFinaleBatch instantiates PlaywrightBatchQaWorker from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/workers/playwrightBatchQaWorker.ts.
- API path: POST /api/batches/upload and POST /api/batches/:id/run in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/routes/batches.ts call BatchControlPlaneService in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/services/batchControlPlaneService.ts, which persists     
  batch metadata and calls the same finale-workbook-intake pipeline.
- Current stopping point: live portal traversal is incomplete/fragile. Persisted evidence in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/batch.json shows the run stops at patient search because the search input selector was
  not found.

# 4. Workbook Intake Status

- Default real workbook path for the demo is services/finale-workbook-intake/finale-export.xlsx, configured in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts. The parser itself accepts an arbitrary workbook path.
- Excel reading is implemented in parseWorkbook in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/parsers/workbookParser.ts. It uses xlsx, reads sheets with sheet_to_json(..., header: 1, blankrows: true), finds headers by aliases, and skips repeated header rows.
- Supported sheet assumptions are hardcoded in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/parsers/workbookParser.ts: OASIS SOC-ROC-REC & POC, OASIS DC-TXR-DEATH, VISIT NOTES, and DIZ.
- Row validation is implemented in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/validators/rawRowSchemas.ts. This is mostly structural/text cleanup validation, not deep business validation.
- Normalization logic is split by sheet mapper: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/mappers/socPocMapper.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/mappers/dcTransferMapper.ts, /C:/Users/short/OneDrive/Desktop/     
  medical-aq-qa/services/finale-workbook-intake/src/mappers/visitNotesMapper.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/mappers/dizMapper.ts.
- Patient work-item aggregation is implemented in aggregatePatientEpisodes in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/mappers/patientEpisodeAggregator.ts. This is where fragments are merged into normalized patient episode work items.
- Output files are written by /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/workbookIntakeService.ts: batch-manifest.json, work-items.json, normalized-patients.json, and parser-exceptions.json.
- JSON output shape is defined by shared schemas in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/patient-episode-work-item.ts and related types exported through /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/index.ts.
- Failure points visible in code and artifacts are: missing/renamed sheets, missing header aliases, rows missing patient identity or episode context, and date normalization gaps. The date utility in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/utils/dateMath.ts does  
  not robustly handle episode date ranges such as 11/20/2025 - 01/18/2026, which contributes to parser exceptions.
- Current observed parse result is real, not hypothetical: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/batch.json records workItemCount: 20 and parserExceptionCount: 55.

# 5. Portal Automation Status

- The current live workbook/demo path uses Playwright code inside services/finale-workbook-intake, not services/portal-worker. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/workers/playwrightBatchQaWorker.ts is constructed by /C:/Users/short/OneDrive/Desktop/
  medical-aq-qa/services/finale-workbook-intake/src/services/batchRunService.ts.
- Browser/session creation is implemented in createPortalSession in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/browser/context.ts. It launches Chromium, supports auth state, enables downloads, and returns browser/page handles.
- Login flow exists in ensureLoggedIn in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/pages/LoginPage.ts. It navigates to the base URL and fills login fields when selectors are present.
- Patient search and chart opening exist in resolvePatient in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/pages/PatientSearchPage.ts. It searches by patient name, inspects result rows, attempts exact matching, and opens a chart when possible.
- Document discovery/extraction exists in discoverArtifacts and related helpers in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/pages/PatientChartPage.ts. It enumerates candidates, classifies likely documents, opens them read-only, captures downloads/tabs/     
  modals, and builds artifact records.
- Read-only safety enforcement exists in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/safety/readOnlySafety.ts. Allowed actions are constrained, and dangerous controls are detected and logged.
- Step logging exists in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/utils/automationLog.ts, and those logs are persisted via /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/patientRunLogWriter.ts.
- Mocked portal path still exists and is the default demo mode. DemoReadOnlyPortalClient in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts simulates portal evidence for presentation stability unless --live is passed.
- A second, broader portal automation system exists in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/worker.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/auth/login-workflow.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-     
  worker/src/pipelines/queueQaPipeline.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/writes/writeExecutor.ts, but it is not wired into the current workbook-driven demo/API execution path.
- Live path status is partial, not complete. Persisted run evidence in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/outputs/batch-summary.json shows every patient run ended PORTAL_MISMATCH because the search selector failed.

# 6. QA Engine Status

- The active QA engine in the workbook path is deterministic, not LLM-based. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/oasisQaEvaluator.ts and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/qa/                 
  deterministicQaEngine.ts.
- The evaluator consumes workbook-derived stage/workflow data plus extracted document evidence. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/documentInventoryService.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/
  src/services/documentExtractionService.ts, and the extractor modules /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/oasisFieldExtractor.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/pocExtractor.ts, /C:/Users/
  short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/visitNoteExtractor.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/technicalReviewExtractor.ts.
- Output schemas exist in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/oasis-qa.ts, including QaFinding, OasisQaSummary, and qaOutcome.
- The engine maps portal/match states into deterministic QA outcomes such as READY_FOR_BILLING_PREP, MISSING_DOCUMENTS, PORTAL_MISMATCH, and AMBIGUOUS_PATIENT. Evidence: mapOverallStatusToQaOutcome in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/             
  oasisQaEvaluator.ts.
- There is no LLM prompt, model client, or AI scoring path on the current workbook/demo execution path from code inspection.
- Document extraction is heuristic, not OCR-grade. /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/documentExtractionService.ts strips HTML, looks for PDF-like text, falls back to UTF-8 text heuristics, and can fall back to artifact labels/notes if file content
  is sparse.
- Missing pieces are robust OCR/scanned-PDF handling, stronger cross-document reasoning, and any write-back/remediation workflow in the current intake QA path.

# 7. Dashboard / Frontend Status

- A real dashboard exists in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard. It is a Next 15 app with server/client pages, not a stub.
- The dashboard connects directly to the API via /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/lib/api.ts. It uses NEXT_PUBLIC_API_BASE_URL, defaults to http://localhost:3000, and automatically prefixes /api when needed.
- The root page in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/page.tsx redirects to /batches.
- Batch list/upload UI is implemented in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/batches/page.tsx. It uploads a workbook and then calls the batch run endpoint.
- Batch detail polling is implemented in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/batches/[batchId]/page.tsx.
- Patient detail/log/artifact viewing is implemented in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/batches/[batchId]/patients/[patientId]/page.tsx.
- The frontend is partial rather than complete. It renders operational data and JSON-derived summaries, but there is no auth layer, no advanced artifact viewer, no workflow/write UI, and no live portal session UI.

# 8. Orchestration / Job Processing Status

- The current real orchestration model is local and file-backed inside the API service, not the separate orchestrator package. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/services/batchControlPlaneService.ts and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/
  repositories/filesystemBatchRepository.ts.
- Job persistence is JSON on disk under services/api/data/control-plane/batches/<batchId>, as defined by /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/types/batchControlPlane.ts. The repository already contains real persisted batches under /C:/Users/short/OneDrive/Desktop/medical-aq-qa/
  services/api/data/control-plane.
- Status tracking is implemented in the batch record schema: parse status, run status, per-patient status, result bundle paths, evidence paths, retry eligibility, and attempts. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/types/batchControlPlane.ts.
- Retry behavior exists at the API control-plane layer. Evidence: retryBlocked handling in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/routes/batches.ts and corresponding service logic in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/services/                         
  batchControlPlaneService.ts.
- Polling exists only in the dashboard UI. The dashboard periodically refreshes batch detail pages; there is no worker queue polling loop in the backend. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/batches/[batchId]/page.tsx.
- The separate orchestrator package is still non-functional as an orchestrator. /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/orchestrator.ts explicitly says polling is not yet implemented, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/local-      
  dispatch.ts is a stub.
- There is no real queue backend, broker, or durable worker lease model from code inspection. Shared job types exist in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/portal-job.ts, but the active path is still in-process service orchestration.

# 9. Logging / Auditability Status

- API logging uses Fastify/Pino in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/app.ts.
- Finale intake/batch logging uses Pino and service-level logs through /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/index.ts and related services.
- Shared logging primitives exist in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-logging/src/logger.ts.
- Audit-friendly per-patient artifacts are implemented in the current intake path: result bundles via /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/patientResultBundleWriter.ts, step logs via /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-     
  workbook-intake/src/services/patientRunLogWriter.ts, and evidence directories managed through /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/batchRunService.ts.
- Shared audit schemas exist in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/automation-step-log.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/patient-run-log.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/document-  
  inventory.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/packages/shared-types/src/portal-safety.ts.
- Read-only safety is auditable because dangerous controls are detected and attached to step logs by /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/safety/readOnlySafety.ts.
- The system does support human verification of a run through stored batch-summary.json, patient result bundles, log JSON, and evidence directories. It does not have a centralized log index or external audit store from code inspection.

# 10. Scripts You Can Actually Run

- Root pnpm build: runs workspace builds from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/package.json. Usable.
- Root pnpm typecheck: runs workspace typechecks from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/package.json. Usable; it passed in this inspection.
- Root pnpm dev:api: starts the API via the API package dev script. Usable.
- Root pnpm dev:dashboard: starts the Next dashboard. Usable.
- Root pnpm clean:dashboard: clears dashboard build output. Usable.
- Root pnpm rebuild:dashboard: cleans and rebuilds dashboard. Usable.
- Root pnpm demo:oasis-qa: runs the workbook demo harness in finale-workbook-intake. Usable; non-live mode is the safer default.
- Root pnpm verify:oasis-demo-live: runs the live demo artifact verification script. Usable if a demo output directory exists.
- Root pnpm test:oasis-demo: runs the demo harness into artifacts/test/oasis-qa-demo. Usable.
- Root pnpm dev:finale-workbook-intake: runs the workbook batch CLI in dev mode. Usable.
- Root pnpm dev:orchestrator: starts the orchestrator service. Usable as a process, but functionally stubbed.
- Root pnpm dev:portal-worker: starts portal-worker bootstrap. Usable as a process, but not the main workbook path.
- Dashboard pnpm --filter @medical-ai-qa/dashboard clean|dev|build|rebuild|start|typecheck: defined in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/package.json. Usable.
- API pnpm --filter @medical-ai-qa/api build|dev|typecheck: defined in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/package.json. Usable.
- Finale intake pnpm --filter @medical-ai-qa/finale-workbook-intake build|dev|demo:oasis-qa|verify:oasis-demo-live|typecheck|test|test:oasis-demo: defined in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/package.json. Usable; live runs require portal env.
- Orchestrator pnpm --filter @medical-ai-qa/orchestrator build|dev|typecheck: defined in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/package.json. Process runs are usable, orchestration behavior is stubbed.
- Portal-worker pnpm --filter @medical-ai-qa/portal-worker build|dev|dev:discover|dev:phase4|dev:phase5|dev:phase6|dev:phase7|dev:phase8|dev:phase9|dev:phase10|dev:phase10:queue-item|dev:phase11|dev:local|typecheck: defined in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/         
  package.json. These appear to be manual/experimental automation runners; usability depends on portal credentials and selector health.
- Portal-worker test:* scripts test:cross-document-qa, test:qa-decision-engine, test:document-extraction, test:visit-note-qa, test:queue-qa-pipeline, test:write-guard-evaluator, test:write-executor, test:workflow-guard-evaluator, test:workflow-executor, test:workflow-support-matrix, test:selector-health,
  test:drift-signal-detector, test:retry-policy, test:reliability-summary, test:selector-stability, test:action-reliability, test:drift-trend, test:anomaly-detector, test:system-health, test:reliability-snapshot, test:run-history-collector: defined in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/       
  services/portal-worker/package.json. They are runnable manual script tests, not a unified test suite.
- Shared packages pnpm --filter @medical-ai-qa/shared-types build|typecheck, pnpm --filter @medical-ai-qa/shared-config build|typecheck, pnpm --filter @medical-ai-qa/shared-logging build|typecheck: library maintenance only. Usable.

# 11. Environment / Secrets Requirements

- API env vars from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/config/env.ts: API_PORT, API_HOST, API_STORAGE_ROOT, API_LOG_LEVEL, API_CORS_ORIGIN.
- Finale workbook intake env vars from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/config/env.ts: FINALE_BATCH_OUTPUT_DIR, FINALE_LOG_LEVEL, PORTAL_BASE_URL, PORTAL_USERNAME, PORTAL_PASSWORD, PORTAL_AUTH_STATE_PATH, PORTAL_HEADLESS, PORTAL_TRACE_ON_FAILURE.
- Dashboard env var from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/lib/api.ts: NEXT_PUBLIC_API_BASE_URL.
- Portal-worker env vars from /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/config/env.ts: PORTAL_BASE_URL, PORTAL_USERNAME, PORTAL_PASSWORD, PLAYWRIGHT_HEADLESS, PLAYWRIGHT_SLOW_MO_MS.
- External runtime dependencies visible from code are: a workbook file or upload, Playwright/Chromium, and Finale portal access for live runs. There is no database, Redis, or cloud queue requirement from code inspection.

# 12. Tests and Validation

- finale-workbook-intake has a real Vitest suite in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/package.json. Relevant tests include /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/tests/workbookParser.test.ts, /C:/Users/short/OneDrive/
  Desktop/medical-aq-qa/services/finale-workbook-intake/src/tests/workbookIntakeService.test.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/tests/batchRunService.test.ts, /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/tests/      
  oasisQaEvaluator.test.ts, and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/tests/oasisDemoRun.test.ts.
- During this inspection, pnpm --filter @medical-ai-qa/finale-workbook-intake test passed.
- During this inspection, pnpm -r typecheck passed across the workspace.
- portal-worker has many test scripts, but they are standalone tsx runners rather than a unified test harness. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/package.json and representative files like /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/  
  src/testing/queue-qa-pipeline.test.ts and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/testing/workflow-executor.test.ts.
- Confidence level today is strongest for workbook parsing, normalization, deterministic QA, filesystem persistence, API routes, and dashboard rendering. Confidence is weaker for stable live portal traversal because persisted run evidence already shows selector failure.

# 13. Legacy or Misaligned Code

- The repo contains two competing automation stacks: the active workbook demo/API path in services/finale-workbook-intake, and a larger queue/workflow/write system in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker. That duplication is real and currently unresolved.
- The orchestrator package looks like intended infrastructure for distributed execution, but it is not used by the current workbook-driven flow and remains stubbed. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/orchestrator.ts.
- FINALE workbook acquisition is implied by the control-plane model but not implemented. Evidence: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/acquisition/finaleWorkbookProvider.ts versus the implemented /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/acquisition/      
  manualUploadWorkbookProvider.ts.
- Documentation is behind the code. /C:/Users/short/OneDrive/Desktop/medical-aq-qa/README.md and /C:/Users/short/OneDrive/Desktop/medical-aq-qa/docs/runbooks/finale-workbook-intake.md do not fully match the current API/dashboard/demo behavior.
- A legacy output concept still exists as an artifact: /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/artifacts/demo/dashboard-data.json. Current code writes normalized-patients.json and work-items.json instead.
- normalized-patients.json and work-items.json are currently produced by /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/workbookIntakeService.ts, but from code inspection they represent the same normalized work-item set rather than two materially different     
  models.
- The default demo is still not live portal automation. In /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts, real workbook intake is default, but portal activity is simulated unless --live is passed.

# 14. Biggest Gaps Blocking the Demo

- Live patient search/selectors are not stable. Repo evidence already shows the current live run failing at the patient search input selector in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/batch.json.
- Document extraction is heuristic-only. There is no OCR/scanned-PDF strategy in /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/documentExtractionService.ts, which limits real-chart evidence capture.
- The repo has not converged on one portal automation stack. finale-workbook-intake and portal-worker overlap heavily, which raises maintenance and selector drift risk.
- Automatic workbook acquisition from Finale is still unimplemented. /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/acquisition/finaleWorkbookProvider.ts is scaffold-only.
- Distributed/background orchestration is absent. The real system still relies on in-process API execution and filesystem persistence rather than a queue/worker model.

# 15. Recommended Next Build Order

      1. Stabilize the live patient search and chart-open path in the active finale-workbook-intake Playwright worker, and validate it against a real portal session with persisted evidence.                                                                                                                       
      2. Improve document discovery/extraction for real charts, especially PDF/text extraction and fallback handling, before expanding QA rules.                                                                                                                                                                    
      3. Choose one portal automation stack as canonical. Either fold portal-worker into the workbook path or retire the duplicate flow.                                                                                                                                                                            
      4. Implement the missing Finale acquisition provider in the API control plane if workbook sourcing from the portal is still a product goal.                                                                                                                                                                   
      5. Replace the stub orchestrator with a real queue/worker model only after the active workbook + portal path is stable; otherwise it will just formalize unstable selectors.                                                                                                                                  

# 16. Evidence Appendix

- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/package.json: root workspace scripts and the true demo entrypoint.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/pnpm-workspace.yaml: confirms workspace package boundaries.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/run-oasis-demo.ts: CLI parser for the current demo.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/testing/oasisDemoHarness.ts: current demo orchestration, patient selection, live/non-live switch.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/parsers/workbookParser.ts: Excel read path and sheet assumptions.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/validators/rawRowSchemas.ts: raw row validation layer.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/mappers/patientEpisodeAggregator.ts: normalization target and patient work-item aggregation.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/workbookIntakeService.ts: workbook-to-JSON output writer.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/batchRunService.ts: active batch execution path.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/workers/playwrightBatchQaWorker.ts: active live Playwright worker.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/portal/pages/PatientSearchPage.ts: patient search/open implementation and current fragility point.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/finale-workbook-intake/src/services/oasisQaEvaluator.ts: deterministic QA summary generation.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/services/batchControlPlaneService.ts: real API-side orchestration and persistence.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/src/repositories/filesystemBatchRepository.ts: confirms filesystem storage model.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/apps/dashboard/app/batches/page.tsx: dashboard upload/start-run behavior.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/orchestrator/src/orchestrator.ts: explicit evidence that orchestrator polling is not implemented.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/portal-worker/src/worker.ts: separate automation stack that is currently not the main path.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/batch.json: concrete persisted evidence of the current live failure mode.
- /C:/Users/short/OneDrive/Desktop/medical-aq-qa/services/api/data/control-plane/batches/batch-2026-03-31T04-30-17-060Z-6a1eb216/outputs/batch-summary.json: concrete persisted evidence of parse counts and run outcomes.                                                                                        
 
 
