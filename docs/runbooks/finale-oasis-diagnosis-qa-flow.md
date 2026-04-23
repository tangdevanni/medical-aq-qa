# Finale OASIS Diagnosis QA Flow

## Updated Workflow Order

Active order for diagnosis QA pipeline:

1. Patient lookup and chart open
2. File Uploads navigation
3. Referral/source document context capture (including Admission Order)
4. Diagnosis/coding extraction from captured source text
5. OASIS sidebar navigation
6. SOC document open
7. Active Diagnoses section open
8. Read-only diagnosis DOM snapshot
9. Guarded diagnosis execution for unlocked notes only
10. Post-write resnapshot and extracted-vs-portal comparison artifact generation

This order is implemented by orchestration changes in `PatientChartPage.discoverArtifacts()` and keeps the existing route/navigation capabilities.

## Reused Navigation Modules

- `PatientSearchPage` remains unchanged for patient lookup and chart open.
- `PatientChartPage.openFileUploadsAndAdmissionOrderFromSidebar()` is reused first in the chart phase.
- `PatientChartPage.openOasisDocumentsPageFromSidebar()` is reused after File Uploads/referral capture.
- `PatientChartPage.openSocDocumentFromOasisTable()` is reused to open SOC.
- `PatientChartPage.openActiveDiagnosesSectionFromSocForm()` is reused and now also captures diagnosis snapshot data.

No new parallel navigation implementation is introduced.

## New Read-Only Modules

- `src/portal/selectors/oasis-diagnosis.selectors.ts`
  - Selector map for diagnosis page root/rows/fields.
- `src/portal/utils/oasisDiagnosisInspector.ts`
  - DOM-aware diagnosis snapshot model and read-only inspector.
- `src/services/oasisDiagnosisComparisonService.ts`
  - Snapshot export, extracted-vs-portal comparison, comparison export.

## Artifact Outputs

Per patient outputs written under:

- `artifacts/.../patients/{patientId}/coding-input.json`
- `artifacts/.../patients/{patientId}/oasis-diagnosis-snapshot.json`
- `artifacts/.../patients/{patientId}/oasis-diagnosis-compare.json`
- `artifacts/.../patients/{patientId}/oasis-diagnosis-verification.json`
- `artifacts/.../patients/{patientId}/oasis-input-actions.json`
- `artifacts/.../patients/{patientId}/oasis-execution-result.json`

These outputs are idempotent and overwritten on re-run.

## Comparison Intent

The comparison stage is read-only and intended for:

- exact and normalized diagnosis/code matching
- mismatch detection
- missing-on-portal and missing-in-extraction reporting
- suspicious split/merge mapping notes

No portal writes are performed.

## Guarded Execution Rules

- Live execution is allowed only when all three conditions are true:
  - `lockState === "unlocked"`
  - `mode === "input_capable"`
  - `OASIS_WRITE_ENABLED === true`
- Otherwise the pipeline performs no writes and logs `executionSkipped`.
- `insert_slot` actions must:
  - click `Insert Diagnosis`
  - wait for filtered diagnosis slot count to increase
  - confirm the new slot is actionable/interactable before continuing
- `fill_diagnosis` actions must:
  - target the filtered slot index
  - fill ICD code and description
  - set severity and onset/exacerbate choice
  - emit before/after evidence for the targeted row
- Post-write validation must:
  - capture a fresh diagnosis snapshot
  - rerun deterministic verification and extracted-vs-portal comparison
  - confirm intended diagnoses now appear in the portal snapshot

## Commands

Read-only live demo run:

```powershell
pnpm demo:oasis-qa -- --live --limit 1
```

Typecheck before handoff:

```powershell
pnpm -r typecheck
```
