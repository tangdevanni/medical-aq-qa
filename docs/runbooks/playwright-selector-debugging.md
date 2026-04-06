# Playwright Selector Debugging

Use this runbook for the active workbook-driven Playwright flow in `services/finale-workbook-intake`.

## Live debug run

Run from repo root:

```bash
pnpm demo:oasis-qa -- --live --limit 1
```

Useful variants:

```bash
pnpm demo:oasis-qa -- --live --patient "Patient Name"
pnpm demo:oasis-qa -- --live --limit 1 --workbook services/finale-workbook-intake/finale-export.xlsx
pnpm verify:oasis-demo-live -- services/finale-workbook-intake/artifacts/demo/<run-dir>
```

## Debug env flags

- `PORTAL_DEBUG_SELECTORS=true`
  Logs every selector candidate attempted and which one matched.
- `PORTAL_SAVE_DEBUG_HTML=true`
  Saves page HTML snapshots for failed steps.
- `PORTAL_DEBUG_SCREENSHOTS=true`
  Saves screenshots for failed steps.
- `PORTAL_PAUSE_ON_FAILURE=true`
  Pauses Playwright after a failed step so a human can inspect manually.
- `PORTAL_STEP_TIMEOUT_MS=8000`
  Increases selector/navigation wait time for each step.
- `PORTAL_SELECTOR_RETRY_COUNT=3`
  Retries layered selector lookup before failing.
- `PORTAL_TRACE_ON_FAILURE=true`
  Keeps Playwright traces on failure.

## Where debug artifacts go

- Batch failures: `.../run/failures/`
- Per-patient evidence: `.../run/evidence/<workItemId>/`
- Per-patient debug artifacts: `.../run/evidence/<workItemId>/debug/`
- Session-level login debug artifacts: `.../run/debug/session/`
- Structured step logs: `.../run/logs/<workItemId>.json`
- Result bundle: `.../run/patient-results/<workItemId>.json`

The debug directory can contain:

- `*.png` screenshots
- `*.html` saved DOM snapshots
- `*.json` page summaries with URL, title, visible inputs/buttons/tables, top text, and text-hint matches

## How to inspect selector drift

1. Run a live debug command with `PORTAL_DEBUG_SELECTORS=true`, `PORTAL_SAVE_DEBUG_HTML=true`, and `PORTAL_DEBUG_SCREENSHOTS=true`.
2. Open the latest patient log JSON and inspect `automationStepLogs`.
3. Look for:
   - selector attempts recorded in `evidence`
   - which selector actually matched
   - missing selector groups
   - debug artifact paths
4. Open the matching debug summary JSON and review:
   - `url`
   - `title`
   - `inputs`
   - `buttons`
   - `interactiveElements`
   - `tables`
   - `ariaSnapshot`
   - `candidateTextMatches`
5. If the portal DOM changed, update the active selector files only:
   - `services/finale-workbook-intake/src/portal/selectors/login.selectors.ts`
   - `services/finale-workbook-intake/src/portal/selectors/patient-search.selectors.ts`
   - `services/finale-workbook-intake/src/portal/selectors/chart-document.selectors.ts`

## Human operator guidance

- Stay in read-only flows only.
- Do not click save, submit, validate, sign, approve, or any write action.
- If `PORTAL_PAUSE_ON_FAILURE=true` stops the browser, inspect the current page and note:
  - the real search input label/placeholder
  - the real results row container
  - the real chart-open control
  - the real documents tab or section control
  - the real document row/link/button structure
- Feed those concrete selectors back into the active selector files above.
