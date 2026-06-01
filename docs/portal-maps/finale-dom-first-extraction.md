# Finale DOM-First Extraction

## Portal Section

OASIS document notes and patient Visit Notes in the Finale Health portal.

## Route Pattern

Use sanitized patterns only, for example:

- `https://<portal-host>/provider/<provider-id>/client/<client-id>/...`
- `https://<portal-host>/provider/<provider-id>/.../documents/<document-id>`

DOM extraction artifacts redact provider, client, patient, and document path segments before persisting route diagnostics.

## Entry Points

- OASIS: patient chart sidebar OASIS flow, then the opened Angular document note page.
- Visit Notes: patient chart Visit Notes table, then a safe read-only opened note view.

## DOM-First Strategy

The default live behavior remains unchanged. DOM-first extraction is opt-in through config flags and is intended to run before OCR/PDF capture only when explicitly enabled.

Pipeline:

1. Playwright opens the portal page using the existing read-only navigation.
2. The DOM extractor reads structured rendered page state.
3. Inputs, textareas, native selects, Angular `ng-select`, radio groups, checkboxes, tables, labels, and compact visible clinical text are normalized.
4. The normalized artifact receives a stable content hash that excludes timestamps.
5. Coverage scoring decides whether the compact DOM state is sufficient.
6. Existing OCR/PDF/download capture remains the fallback when coverage is degraded or fallback is forced.

## OASIS Section Selector

The OASIS page is an Angular document note surface under `app-document-note app-oasis`. The page selector is expected to be an `ng-select` inside:

- `fin-select.select-oasis-pages`
- fallback: `fin-select[class*='select-oasis-pages'] ng-select`
- fallback: `app-oasis ng-select:has(input[role='combobox'])`

When opened, options are read from:

- `ng-dropdown-panel .ng-option`
- `ng-dropdown-panel [role='option']`
- `.ng-option-label` when present

The iterator opens the selector, records every visible option label, selects each option one at a time, waits for the page to settle, extracts the current section DOM state, and combines all sections into one `portal_dom_extracted_state` artifact. Blank option labels are retained as synthetic `blank-option-N` labels. Duplicate labels are skipped. Failed or degraded sections are recorded and cause OCR/PDF fallback to remain recommended.

The selector strategy intentionally avoids generated Angular `_ngcontent-*` attributes and generated dropdown ids.

## Visit Notes Scaffold

The Visit Notes DOM adapter extracts the current opened Visit Note page or form. It captures:

- note headings and visible note type cues
- note date and discipline fields when visible
- narrative textareas
- goals, interventions, responses, vitals, assessment fields, checkboxes, radios, and tables
- plan-of-care references when visible in page text

If clinical cues such as goals, interventions, vitals, assessment, wound, gait, skilled care, or plan-of-care text are not found, the artifact recommends fallback.

## Config Flags

- `PORTAL_DOM_EXTRACTION_ENABLED=false`
- `OASIS_DOM_EXTRACTION_ENABLED=false`
- `VISIT_NOTES_DOM_EXTRACTION_ENABLED=false`
- `OCR_FALLBACK_ENABLED=true`
- `DOM_EXTRACTION_MIN_FIELD_COUNT=10`
- `DOM_EXTRACTION_MIN_NONEMPTY_FIELD_COUNT=3`

With the defaults above, live portal behavior should match the previous OCR/PDF/download path.

## Fallback Behavior

Fallback is recommended when:

- the OASIS page selector cannot be found or opened
- OASIS options cannot be read
- any OASIS section fails or degrades
- section count, field count, or non-empty field count is below threshold
- only shell/navigation text is extracted
- Visit Notes clinical cues are absent

Use `OCR_FALLBACK_ENABLED=true` to keep current OCR/PDF capture available. For debugging, force the existing OCR/PDF path by leaving DOM extraction flags disabled or by raising the DOM thresholds above observed coverage.

## Cost-Saving Rationale

When coverage is high, the fact-pack builder can later consume compact structured DOM state instead of raw OCR text. That should reduce:

- PDF printing and OCR/Textract calls
- repeated extraction for unchanged documents through content hashes
- LLM input size by replacing full raw text with normalized fields, tables, and short text digests

To verify OCR was not used in a future wired run, inspect the DOM artifact diagnostics:

- `diagnostics.ocrUsed=false`
- `diagnostics.pdfCaptureUsed=false`
- `diagnostics.inputSource=dom_state_primary`

Related automation files:

- `services/finale-workbook-intake/src/portal/domExtraction/portalDomExtraction.ts`
- `services/finale-workbook-intake/src/portal/domExtraction/oasisDomExtraction.ts`
- `services/finale-workbook-intake/src/portal/domExtraction/visitNotesDomExtraction.ts`
- `services/finale-workbook-intake/src/portal/domExtraction/oasisDomBridge.ts`

## Christine Young Validation

Use the OASIS demo harness for a single selected patient in read-only mode. Prefer a patient selector from the workbook rather than hard-coding a production code path.

Example local command:

```bash
PORTAL_DOM_EXTRACTION_ENABLED=true OASIS_DOM_EXTRACTION_ENABLED=true OCR_FALLBACK_ENABLED=true CODE_LLM_ENABLED=false VISIT_NOTE_POC_MAPPING_LLM_ENABLED=false pnpm --filter @medical-ai-qa/finale-workbook-intake demo:oasis-qa -- --live --patient "Christine Young" --limit 1 --debug-oasis-dom-extraction --output-dir artifacts/demo/oasis-dom-christine-validation
```

This command is read-only. It should not write portal values, change dashboard behavior, call deployment tooling, or change discrepancy logic. Review local credentials and environment before running live portal automation.

Expected artifacts under `run/patients/<patient-run-id>/`:

- `oasis-dom-extracted-state.json`
- `oasis-dom-acquisition-state.json`
- `oasis-dom-bridge-text.txt`
- `oasis-dom-vs-existing-extraction-comparison.json`

`oasis-dom-extracted-state.json` is the structured candidate acquisition artifact. Check:

- `coverage.sectionCount`
- `coverage.fieldCount`
- `coverage.nonEmptyFieldCount`
- `coverage.fallbackRecommended`
- `coverage.fallbackReasons`
- `diagnostics.inputSource`
- `diagnostics.ocrUsed`
- `diagnostics.pdfCaptureUsed`
- `diagnostics.sectionOptionLabels`
- `diagnostics.skippedDeferredSections`

`oasis-dom-vs-existing-extraction-comparison.json` compares DOM coverage against previous OCR/printed-note artifacts using section labels, OASIS item codes, value hashes, diagnosis cues, and high-priority clinical cue overlap. It does not call an LLM and does not copy raw PHI-heavy text.

## Interval-Based OASIS Acquisition

Scheduled runs may see an OASIS note before all sections are filled. When DOM extraction is enabled, each run writes the latest raw DOM scrape and merges it into `oasis-dom-acquisition-state.json`.

The acquisition state tracks:

- `acquisitionStatus`
- first and last scrape timestamps
- accumulated sections and fields
- missing required sections and fields
- changed and regressed fields
- readiness and fallback reasons
- `overallContentHash`
- `lastQaInputHash` after QA has run for a given DOM state

Field values are merged incrementally. A newly filled field becomes `filled`. A changed non-empty value becomes `changed`. If a previously filled field appears empty on a later scrape, the previous value is preserved and the field is marked `regressed`; the bot does not silently erase acquired clinical evidence. If a section is not visible in the latest scrape, prior values are preserved and the section is marked `not_seen_this_run`.

Care Plan Problems/Goals/Interventions remains intentionally deferred for this phase and does not block readiness.

Readiness does not require every OASIS field to be non-empty. It requires the high-priority OASIS sections to be captured or explicitly deferred/not applicable, enough total fields and non-empty fields, enough OASIS item codes, high-priority clinical cue coverage, no failed high-priority sections, and no DOM fallback recommendation. The required high-priority areas are Administrative Information, Active Diagnoses, Vitals/Pain, Medication/Allergies, Neurological, Cardiopulmonary, Gastrointestinal/Genitourinary, Integumentary/Wound, Safety/Self Care, Functional/Mobility, Endocrine/Diabetic, Plan of Care/PT Evaluation, and Patient Summary/Narrative.

`acquisitionStatus` values:

- `not_started`: no DOM state exists yet.
- `in_progress`: DOM was acquired but required readiness criteria are still pending.
- `ready_for_qa`: accumulated DOM state is sufficient for the existing QA/fact-pack path.
- `qa_completed`: QA already ran for the current acquisition hash.
- `qa_stale_due_to_oasis_change`: OASIS changed after prior QA and should be reviewed again once ready.
- `blocked_dom_extraction_failed`: DOM extraction failed and cannot support QA.
- `fallback_to_ocr_required`: DOM coverage is weak and OCR fallback is allowed.
- `insufficient_evidence`: DOM coverage is weak and OCR fallback is disabled.

Readiness reasons include `ready_for_qa`, `pending_missing_required_sections`, `pending_low_field_coverage`, `pending_low_nonempty_coverage`, `pending_failed_high_priority_sections`, `pending_document_not_complete`, `blocked_extraction_failed`, and `fallback_to_ocr_required`.

When the acquisition state is `in_progress`, scheduled runs should skip expensive OASIS LLM QA and OCR/PDF capture, then persist the pending state for inspection. When it is `ready_for_qa` or `qa_stale_due_to_oasis_change`, the deterministic bridge text can feed the existing fact-pack/QA path without changing prompt semantics. When it is `qa_completed` and `lastQaInputHash` matches the current `overallContentHash`, the run can skip duplicate OASIS QA work.

OCR fallback is preserved. If DOM extraction fails or coverage is low and `OCR_FALLBACK_ENABLED=true`, the previous printed-note/PDF/OCR acquisition path remains available. If fallback is disabled, the run records insufficient evidence rather than manufacturing a low-confidence QA result.

To inspect pending OASIS completion, open `oasis-dom-acquisition-state.json` and review:

- `acquisitionStatus`
- `missingRequiredSections`
- `missingRequiredFields`
- `readinessReasons`
- `fallbackReasons`
- `changedFields`
- `regressedFields`

Decision values:

- `dom_ready_for_oasis_primary`: DOM capture is strong enough to trial as primary OASIS acquisition.
- `dom_ready_with_ocr_fallback`: DOM capture is useful, but keep OCR/PDF fallback enabled.
- `dom_needs_template_mapping`: DOM controls were captured, but section/item mapping needs more template work.
- `dom_not_ready`: do not use DOM as primary acquisition.

To verify OCR was bypassed for the OASIS acquisition attempt, check:

- DOM artifact: `diagnostics.ocrUsed=false`
- DOM artifact: `diagnostics.pdfCaptureUsed=false`
- QA step log: `oasis_dom_extraction`

If DOM coverage is weak and `OCR_FALLBACK_ENABLED=true`, the existing printed-note OCR/PDF path still runs. If DOM coverage is weak and `OCR_FALLBACK_ENABLED=false`, the workflow records insufficient evidence instead of producing a silent low-quality acquisition result.

Do not deploy this path as OASIS-primary until the comparison artifact has been reviewed.
