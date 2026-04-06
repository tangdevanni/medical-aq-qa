# Local Development

## Prerequisites

- Node.js 20+
- `pnpm`

## Setup

1. Run `pnpm install` at the repository root.
2. Copy `.env.example`, `services/finale-workbook-intake/.env.example`, and `services/portal-worker/.env.example` as needed for local values.
3. Run `pnpm build` to compile all packages.
4. Run `pnpm typecheck` to validate the workspace.

## Service Commands

- API: `pnpm dev:api`
- Orchestrator: `pnpm dev:orchestrator`
- Portal worker: `pnpm dev:portal-worker`
- Dashboard: `pnpm dev:dashboard`

## Dashboard Demo Notes

- The dashboard/API run path and the direct `demo:oasis-qa` flow now use the same Finale workbook intake portal bootstrap.
- Keep portal credentials and `PORTAL_DASHBOARD_URL` in `services/finale-workbook-intake/.env` so both CLI and API-triggered runs resolve the same provider dashboard context.

## Portal Worker Phases

- Phase 10 single-note QA: `pnpm --filter @medical-ai-qa/portal-worker dev:phase10`
- Phase 11 queue QA pipeline: `pnpm --filter @medical-ai-qa/portal-worker dev:phase11`

## Phase 11 Notes

- The Phase 11 runner is read-only and is intended for QA Monitoring queue scans plus visit-note extraction and rule evaluation.
- Default local payload values are conservative: `maxRowsToScan=10`, `maxTargetNotesToProcess=5`, `captureSectionSamples=false`, and `revisitQueueBetweenRows=true`.
- Review the structured JSON output rather than logs for row-level results. Audit logs intentionally keep only compact counts and statuses.
