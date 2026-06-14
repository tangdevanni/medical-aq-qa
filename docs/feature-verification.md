# Feature Verification Checklist

Use this checklist before accepting local or deployed behavior for a new feature.

## Required Version Evidence

- Record the API `/api/version` response.
- Record the dashboard `/api/session/version` response after login.
- Confirm dashboard `nextPublicApiBaseUrl` points at the intended API.
- Confirm API and dashboard `gitSha` or image tag match the code being tested.
- Record key feature flags, especially `OASIS_ACQUISITION_SOURCE`.

## Local Stack Defaults

- Start API in manual mode for read-only dashboard verification:
  - `API_AUTONOMOUS_MODE=manual_only`
  - `DEFAULT_SUBSIDIARY_RERUN_ENABLED=false`
- Do not treat a page as verified if `/api/session/version` cannot load.
- Restart or clean the dashboard dev server if the displayed UI does not match the current source.
- Treat `.next-dev` as generated output. Do not review or commit it as feature source.

## Patient-Level Feature Runs

- Record patient id, run id, selected agency, artifact root, and exact URL.
- Record whether live portal acquisition was triggered.
- For refresh actions, record `clinical-refresh/status`, including preflight.
- For OASIS print-preview tests, record:
  - print-preview text artifact path
  - canonical OASIS artifact paths
  - dashboard parity report path

## Christine Golden-Parity Gate

Christine Young parity must use existing processed artifacts as baseline A.

Required baseline files:

- `patient-dashboard-state.json`
- `qa-prefetch-result.json`
- `oasis-dom-section-outputs.json`

Do not rerun Christine through legacy acquisition to regenerate baseline A. If the files are missing, the test must fail clearly.

Run:

```powershell
pnpm --filter @medical-ai-qa/api verify:christine-print-preview-parity
```

Optional inputs:

- `CHRISTINE_BASELINE_ROOT`
- `PRINT_PREVIEW_TEXT_PATH`
- `CHRISTINE_PARITY_OUTPUT_DIR`

The parity report must have zero material and zero critical differences unless a narrow, documented allowlist is added with old value, new value, reason, and approval note.
