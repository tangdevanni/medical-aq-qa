# Repo Hygiene and Clean Main Runbook

Purpose: keep `main` as source code only. Patient data, runtime control-plane state, portal auth, OCR/text outputs, deployment dumps, and generated build artifacts must stay local and untracked.

## Current Clean Baseline

The repo was cleaned on 2026-06-04.

- Valid cleaned remote: `origin/main`
- Cleanup commit before history rewrite: `903db19 Align main with deployed DOM-first app and remove runtime artifacts`
- Source-equivalent rewritten commit after history purge: `3951b06 Align main with deployed DOM-first app and remove runtime artifacts`
- Safety branch created before cleanup: `backup/pre-clean-main-20260604-160210`
- Backup manifests and restore bundle:
  - `C:\dev\repo-cleanup-backups\pre-clean-main-20260604-160210`
  - `C:\dev\repo-cleanup-backups\history-purge-20260604-161426`

Old local clones made before the history rewrite are stale. Prefer a fresh clone of `origin/main` over trying to repair an old checkout.

## What Changed

- Aligned `main` with the deployed DOM-first application source.
- Removed tracked runtime and patient artifacts from:
  - `data/control-plane/**`
  - `services/api/data/control-plane/**`
  - `services/finale-workbook-intake/artifacts/**`
  - `artifacts/**`
  - `.auth/**`
  - `services/api/.auth/**`
- Kept only the sanitized control-plane README:
  - `services/api/data/control-plane/batches/README.md`
- Removed generated deployment dumps from source control:
  - `api-task-def.json`
  - `deploy/aws/**/*.json`
  - `deploy/aws/**/*.txt`
- Removed local build/scratch outputs from tracking, including `.tmp*`, `.next*`, `dist`, and `*.tsbuildinfo`.
- Scrubbed real patient names from active test fixtures and replaced them with synthetic sample names.
- Added ignore rules to prevent generated runtime files from being re-added by normal `git add`.
- Rewrote `origin/main` history so previously tracked runtime artifact paths are no longer reachable from `main`.

## Source-Control Policy

Track:

- Application source under `apps/`, `packages/`, `services/`, `src/`, `docs/`, and `scripts/`.
- Sanitized templates and examples, such as `.env.example`.
- Small redacted fixtures only when they are intentionally used by tests and contain no patient data.

Do not track:

- `.env` or any local secret file.
- Portal auth state.
- Runtime control-plane batches, agencies, scheduled runs, patient outputs, dashboard states, memory records, document text, OCR results, screenshots, PDFs, or downloaded source documents.
- Generated deployment task definitions or AWS output dumps.
- Build outputs, TypeScript build info, Next output, logs, Playwright reports, or scratch folders.

If a runtime artifact becomes useful for a test, create the smallest possible redacted fixture under a test fixture directory and document the contract. Do not promote live patient output.

## Clean Worktree Workflow

Use a fresh clone for source work:

```powershell
git clone https://github.com/tangdevanni/medical-aq-qa.git C:\dev\medical-aq-qa-clean
cd C:\dev\medical-aq-qa-clean
git status -sb
```

Keep local runtime operations in ignored directories. Do not force-add ignored runtime paths.

Before every commit, run:

```powershell
git status --short --untracked-files=all
git diff --cached --check
git ls-files 'data/control-plane/**' 'services/api/data/control-plane/**' 'services/finale-workbook-intake/artifacts/**' 'artifacts/**' '.auth/**' 'services/api/.auth/**' '*.tsbuildinfo' '.env*' 'deploy/aws/**' 'api-task-def.json'
git ls-files | Select-String -Pattern 'outputs/evidence|patient-results|patient-dashboard-state\.json|patient-memory-record\.json|printed-source\.pdf|ocr-result\.json|extracted-text\.txt|document-text\.json|data/control-plane/agencies|services/finale-workbook-intake/artifacts|^artifacts/|\.auth/'
git grep -n -I -w -e "<known-patient-first-name>" -e "<known-patient-last-name>"
```

Expected output for the `git ls-files` sensitive-path check is only:

```text
.env.example
services/api/data/control-plane/batches/README.md
```

Expected output for the artifact-path scan and patient-name grep is no matches.

Run the focused typechecks before pushing source changes:

```powershell
pnpm --filter @medical-ai-qa/api typecheck
pnpm --filter @medical-ai-qa/dashboard typecheck
pnpm --filter @medical-ai-qa/finale-workbook-intake typecheck
```

## If The Worktree Gets Dirty

First inspect what changed:

```powershell
git status --short --untracked-files=all
git status --ignored --short
```

If the changes are generated files in ignored paths, leave them untracked or delete them locally after confirming no run is using them. Preview ignored-file cleanup before deleting anything:

```powershell
git clean -ndX
```

Do not use `git add -f` for ignored paths unless the file is a deliberate sanitized fixture or template.

If a local checkout predates the history rewrite, do not push from it. Make a fresh clone, move only intentional source edits across, and verify with the checks above.

## Deployment Notes

Generated AWS task definitions are operational outputs, not source. Keep deployment templates sanitized and avoid committing account-specific task definition dumps, secrets, live image revisions, portal auth state, or production environment snapshots.

## Recovery Notes

The pre-clean source and history backups were saved outside the repo under `C:\dev\repo-cleanup-backups`. These are local recovery materials only and should not be copied back into source control.
