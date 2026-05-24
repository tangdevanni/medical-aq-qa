# Visit Notes Lifecycle Policy

Visit Notes are counted separately from active review. QA Complete notes are treated as finalized: they remain visible in dashboard counts, but the bot does not recapture or reanalyze them by default.

## Active vs Finalized

- `active_monitoring`: clinical notes that are not QA Complete, including `in_progress`, `submitted`, `qa_pending`, `qa_review`, `signed`, and `e_signed`.
- `finalized_no_active_monitoring`: QA Complete notes. Count and show them, but do not actively capture by default.
- `count_only`: missed, cancelled, and not-started notes.
- `ineligible`: administrative or non-clinical Visit Notes.
- `review_needed_unknown`: clinical note type with an unknown row status.

## Capture And Reuse

Active clinical notes are capture candidates. If an active note is unchanged on a later run, the manifest can reuse prior capture/extraction/analysis and the note remains visible as active. If the row text, POC hash, OASIS fact-pack hash, or previous processing status changes, the note is planned for recapture or reanalysis. If an active note becomes QA Complete, it moves to finalized monitoring and is no longer opened by default.

`--force-rerun-visit-notes` bypasses reuse for active notes.

## Capture Cap

Production should leave `VISIT_NOTE_CAPTURE_MAX_NOTES` unset so all active notes are processed. If a cap is set for smoke testing, overflow active notes are marked `capture_pending_due_to_config_limit`; they are not silently skipped.

## POC Mapping

Each captured active note now carries a POC mapping result in `visit-note-qa-review.json` under `noteSummaries[].pocMappingResult`:

- matched POC problems, goals, and interventions
- `matchStrength`
- visit-note evidence IDs
- `alignmentStatus`
- missing documentation
- contradictions
- POC update signals

The dashboard/API expose active/finalized counts, row lifecycle, capture status, mapping status, matched POC items, and concise evidence rationale.

## Validate Locally

Run focused validation:

```powershell
pnpm --filter @medical-ai-qa/finale-workbook-intake test -- visitNoteTypeNormalizationService visitNoteCaptureService visitNoteQaAnalysisService visitNotePocAlignmentAgent
pnpm --filter @medical-ai-qa/api test -- dashboardRunViews
pnpm --filter @medical-ai-qa/dashboard test -- VisitNotesReviewPanel
pnpm --filter @medical-ai-qa/finale-workbook-intake typecheck
pnpm --filter @medical-ai-qa/api typecheck
pnpm --filter @medical-ai-qa/dashboard typecheck
pnpm --filter @medical-ai-qa/dashboard build
```
