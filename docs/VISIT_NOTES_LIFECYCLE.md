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

Each captured active note carries a POC mapping result in `visit-note-qa-review.json` under `noteSummaries[].pocMappingResult`:

- matched POC problems, goals, and interventions
- `matchStrength`
- visit-note evidence IDs
- `alignmentStatus`
- missing documentation
- contradictions
- POC update signals
- `mappingStatus`, `mappingSource`, `inputHash`, optional `modelId`, and optional `errorReason`

When `VISIT_NOTE_POC_MAPPING_LLM_ENABLED=true` or `CODE_LLM_ENABLED=true` with `LLM_PROVIDER=bedrock`, active Visit Notes are sent to the Bedrock Visit Note -> POC mapper. The prompt includes compact Visit Note facts, discipline/type, row status/lifecycle, visit date, structured POC problems/goals/interventions, and diagnosis context already present in the POC draft. QA Complete notes do not invoke the mapper by default.

The mapper must return JSON only and preserve POC `problemKey` values. It should use `insufficient_documentation` when the note does not prove a POC item was addressed and `contradiction` only for clear conflicts.

If LLM mapping is disabled, unavailable, or returns invalid JSON, the patient run continues. The artifact keeps deterministic mapping with `mappingStatus: "deterministic_only"` or `mappingStatus: "degraded"` and records a warning/error reason. Successful LLM mappings are reused when the mapping `inputHash` is unchanged; that hash includes Visit Note row/content/text/fact inputs plus the POC and OASIS fact-pack hashes. A changed note, changed POC, changed OASIS context, or `--force-rerun-visit-notes` causes remapping.

The dashboard/API expose active/finalized counts, row lifecycle, capture status, mapping status, matched POC items, and concise evidence rationale.

## Validate Locally

Run focused validation:

```powershell
pnpm --filter @medical-ai-qa/finale-workbook-intake exec vitest run src/tests/visitNoteTypeNormalizationService.test.ts src/tests/visitNoteCaptureService.test.ts src/tests/visitNoteQaAnalysisService.test.ts src/tests/visitNotePocAlignmentAgent.test.ts
pnpm --filter @medical-ai-qa/api exec tsx --test src/tests/dashboardRunViews.test.ts
pnpm --filter @medical-ai-qa/dashboard exec tsx --test components/VisitNotesReviewPanel.test.tsx
pnpm --filter @medical-ai-qa/shared-types typecheck
pnpm --filter @medical-ai-qa/finale-workbook-intake typecheck
pnpm --filter @medical-ai-qa/api typecheck
pnpm --filter @medical-ai-qa/dashboard build
```
