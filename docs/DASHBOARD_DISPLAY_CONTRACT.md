# Dashboard Display Contract

This document defines how patient dashboard clinical sources should appear in the UI. Treat it as the reference for dashboard display changes and regression tests.

## Referral vs OASIS

Referral vs OASIS compares a selected static referral document against a selected OASIS assessment.

- Referral documents are static, on-demand sources. They are acquired by the referral intake action and reused by document/content hash when unchanged.
- Each processed referral document must appear as a selectable source tab using the document title and date when available.
- OASIS assessments are chart-backed sources. SOC, ROC, and RECERT assessments may all remain viewable, but only the newest/current OASIS is actively monitored after historical assessments have been captured.
- Each OASIS assessment must appear as a selectable source tab using assessment type and date when available.
- The default comparison is newest processed referral document vs newest/current OASIS.
- All six category tabs must remain visible even when the selected source has no values:
  - Diagnoses
  - Medications & Allergies
  - Safety / Social Support
  - Functional / Therapy
  - Body Systems
  - Dates / Admin
- Empty source/category states should say that no data was captured or that the source is viewable but not processed yet. Do not backfill from OCR or printed-note artifacts.
- OASIS source dates shown to users should be date-only, not raw ISO timestamps.
- Diagnoses and Medications & Allergies are summary-first categories. Render the selected source's structured summary before using same-source row fallback.
- Summary data must be source-scoped. A selected referral document can only show diagnosis/medication summaries derived from that document's artifacts. A selected OASIS assessment can only show diagnosis/medication summaries derived from that assessment's OASIS artifacts.
- OASIS diagnosis names must come from OASIS artifacts only. Do not infer or borrow OASIS diagnosis descriptions from referral documents. If OASIS captured a code/onset but no description, show the code, onset, role when available, and a quiet `Description not captured` meta.

## Row Labels

Dashboard rows should show clinical labels, not internal extraction labels.

- Do not render raw OASIS item IDs like `M1021` or `M1023` as the primary visible description.
- Do not render extraction scaffolding such as `POC Element`, `ICD-10 Code`, `PRIMARY DIAGNOSIS`, `OTHER DIAGNOSIS - 1`, or non-clinical symbols as the main label.
- Diagnoses should show the ICD code, a meaningful diagnosis name when available, onset date when available, and diagnosis role when available.
- Medication and allergy display should preserve structured medication/allergy summaries first. Row fallback may add clean same-source entries only when they are not duplicates.
- Medication, allergy, safety, functional, body-system, and date/admin rows should show compact clinical labels and values.
- Deterministic cleanup belongs in dashboard display helpers. Do not use an LLM to clean labels, detect changed fields, or compare unchanged values.

## Source Boundaries

The current dashboard must not use OCR artifacts as active clinical truth.

- OASIS values come from structured field-map values or DOM-acquired OASIS artifacts.
- Referral values come from direct-document LLM referral artifacts.
- Historical printed-note OCR files may remain on disk, but they must not populate current dashboard rows.
- Plan of Care is displayed only in the top-level Plan of Care tab.
- Visit Notes are displayed only in the top-level Visit Notes area.

## Plan Of Care

- Plan of Care content should not be duplicated into Referral vs OASIS.
- The Plan of Care tab may show generated or captured POC artifacts, but it should keep source labels clear and avoid raw extraction payloads.
- Missing POC evidence should show a clean pending/empty state, not unrelated referral or OCR fallback content.

## Visit Notes

- Visit Notes are monitored as part of active patient automation.
- Visit note rows should be grouped by visit/source status where practical.
- The UI should summarize relevant visit-note findings without dumping raw portal evidence or raw LLM JSON.
- Missing or pending visit-note evidence should not block Referral vs OASIS, OASIS, or Plan of Care display.

## Regression Requirements

Before merging dashboard display changes:

- Run focused dashboard display tests, including all six Referral vs OASIS categories.
- Verify selected referral and OASIS source tabs filter displayed rows.
- Verify OASIS labels do not expose raw extraction scaffolding.
- Verify source dates are user-readable.
- Verify empty states stay stable for sources with no rows.
- Do not commit runtime artifacts, patient artifacts, screenshots, traces, `.env`, `.next`, `dist`, or control-plane data.

Focused command:

```bash
node --import tsx --test apps/dashboard/lib/referralOasisDisplay.test.ts
pnpm --filter @medical-ai-qa/dashboard typecheck
```
