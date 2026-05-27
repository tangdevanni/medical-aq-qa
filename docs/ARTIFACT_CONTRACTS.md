# Artifact Contracts

Operator note: artifacts below are per-patient unless noted otherwise. Most live under `.../run/patients/<patientId>/`; referral processing artifacts live under `referral-document-processing/`.

Contract modules:

- `services/finale-workbook-intake/src/artifacts/artifactNames.ts` contains shared artifact filename constants.
- `services/finale-workbook-intake/src/artifacts/patientArtifactPaths.ts` builds per-patient artifact paths without changing layout.
- `services/finale-workbook-intake/src/artifacts/jsonArtifactIO.ts` provides minimal JSON read/write/exists helpers using the existing pretty JSON format.

| Artifact | Writer | Readers | Canonical / legacy | Schema/type | Dashboard-facing | Regenerable | Known risks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `clinical-comparison-rows.json` | `patientDashboardStateWriter.ts` / `clinicalComparisonRowBuilder.ts` | `dashboardRunViews.ts`, `patientDashboardStateWriter.ts`, dashboard patient page | Canonical dashboard comparison row source | `ClinicalComparisonRow` in `packages/shared-types/src/clinical-comparison-row.ts`; pipeline version `clinical-comparison-rows.v1` | Yes | Yes, from source and OASIS fact packs plus diagnosis artifacts | Empty or stale canonical rows can suppress legacy fallback; source attribution must stay precise. |
| `patient-dashboard-state.json` | `patientDashboardStateWriter.ts`; API fixture/demo paths in `batchControlPlaneService.ts` | API control-plane/detail reads, dashboard API routes, dashboard patient page | Canonical patient dashboard snapshot | `PatientDashboardState` in `packages/shared-types/src/patient-dashboard-state.ts` | Yes | Yes, but should preserve run metadata and overlay freshness semantics | Currently broad and central; reader-side validation should use shared schema instead of casts. |
| `source-clinical-fact-pack.json` | `patientDashboardStateWriter.ts` via `sourceClinicalFactPackBuilder.ts` | `clinicalComparisonRowBuilder.ts`, `dashboardRunViews.ts`, POC/review services | Canonical source/referral fact pack | `ClinicalFactPack` in `packages/shared-types/src/clinical-fact-pack.ts` | Yes | Yes, from referral/document processing artifacts | Referral diagnosis extraction should be authoritative over metadata noise. |
| `oasis-clinical-fact-pack.json` | `patientDashboardStateWriter.ts` via `oasisClinicalFactPackBuilder.ts` | `clinicalComparisonRowBuilder.ts`, POC services, `dashboardRunViews.ts`, OASIS docs review | Canonical OASIS fact pack | `ClinicalFactPack` in `packages/shared-types/src/clinical-fact-pack.ts` | Yes | Yes, from OASIS extraction artifacts | Broad fact-pack evidence must not populate unrelated OASIS Validation Snapshot fields. |
| `visit-note-qa-review.json` | `visitNoteQaAnalysisService.ts` | `dashboardRunViews.ts`, `VisitNotesReviewPanel`, `patientDashboardStateWriter.ts` tests | Canonical Visit Notes QA review | schema version `visit-note-qa-review.v1`; shared Visit Notes review types in `packages/shared-types/src/visit-notes-review.ts` and `visit-note-qa.ts` | Yes | Yes, from visit-note fact pack plus POC draft/OASIS context | Active/finalized lifecycle and POC mapping semantics are behavior-sensitive; do not change in cleanup. |
| `visit-note-processing-manifest.json` | `visitNoteQaAnalysisService.ts`; read by worker before recapture | `playwrightBatchQaWorker.ts`, tests, dashboard-state writer | Canonical Visit Notes processing manifest | schema version `visit-note-processing-manifest.v1` | Indirectly | Yes, but reruns must preserve enough data for already-processed detection | Cleanup must not delete manifest before full rerun decisions are made. |
| `visit-note-fact-pack.json` | `visitNoteFactPackBuilder.ts` | `visitNoteQaAnalysisService.ts`, `dashboardRunViews.ts`, tests | Canonical Visit Notes fact pack | schema version `visit-note-fact-pack.v1`; shared Visit Notes types | Yes, through review projection | Yes, from captured Visit Notes documents | Fact identity/source path stability matters for finding diffs and POC mapping. |
| `plan-of-care-review-draft.json` | `patientDashboardStateWriter.ts` via POC services; `pocDraftGenerationService.ts` for smoke/replay | `dashboardRunViews.ts`, Visit Notes QA, dashboard panels | Canonical POC review draft | `PlanOfCareReviewDraftArtifact` in `packages/shared-types/src/plan-of-care-review.ts`; schema version `plan-of-care-review-draft.v1` | Yes | Yes, from OASIS fact pack and POC question bank/candidates | Downstream Visit Notes POC mapping depends on stable question/problem identifiers. |
| `plan-of-care-review-summary.json` | `patientDashboardStateWriter.ts` / POC review quality services | `dashboardRunViews.ts`, dashboard POC panel | Canonical POC review summary | shared POC review types | Yes | Yes | Summary must remain aligned with draft item IDs and readiness statuses. |

## Additional Artifact Inventory

| Artifact | Writer | Readers | Canonical / legacy | Schema/type | Dashboard-facing | Regenerable | Known risks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `oasis-diagnosis-extraction.json` | `diagnosisExtractionService.ts` | `oasisClinicalFactPackBuilder.ts`, `clinicalComparisonRowBuilder.ts`, `planOfCareDiagnosisSourceService.ts`, `dashboardRunViews.ts` | Canonical OASIS diagnosis extraction | schema version `oasis-diagnosis-extraction.v1` | Yes | Yes, from OASIS assessment/printed note evidence | Must remain the authoritative source for ordered OASIS diagnoses. |
| `referral-diagnosis-extraction.json` | `diagnosisExtractionService.ts` | `sourceClinicalFactPackBuilder.ts`, `clinicalComparisonRowBuilder.ts`, `dashboardRunViews.ts` | Canonical referral diagnosis extraction | schema version `referral-diagnosis-extraction.v1` | Yes | Yes, from referral/document text | Must avoid promotion of noisy metadata diagnoses over structured referral rows. |
| `diagnosis-reconciliation.json` | diagnosis reconciliation service / batch patient pipeline | `dashboardRunViews.ts`, dashboard diagnosis review | Canonical derived diagnosis reconciliation | shared diagnosis/clinical comparison types where available | Yes | Yes | Depends on both diagnosis extraction artifacts being current. |
| `referral-document-processing/source-meta.json` | `referralProcessing/pipeline.ts` | Referral debug/review tools | Canonical processing metadata | referral processing local type | No direct | Yes | Local provenance may contain source-specific paths. |
| `referral-document-processing/extraction-result.json` | `referralProcessing/pipeline.ts` / document extraction | Referral processing readers, debug | Canonical OCR/extraction output | document extraction types | Indirectly | Yes | Large and source-sensitive; avoid committing live patient output. |
| `referral-document-processing/extracted-text.txt` | `referralProcessing/pipeline.ts` | Referral processing, debug | Canonical text extraction output | text | Indirectly | Yes | PHI/local output risk; should stay in ignored generated artifacts. |
| `referral-document-processing/normalized-sections.json` | `referralProcessing/pipeline.ts` | `factsExtractionService.ts`, referral QA services | Canonical normalized referral sections | referral processing section types | Indirectly | Yes | Section labels drive field mapping; avoid ad hoc renames. |
| `referral-document-processing/extracted-facts.json` | `referralProcessing/pipeline.ts` / `factsExtractionService.ts` | `sourceClinicalFactPackBuilder.ts`, `patientDashboardStateWriter.ts`, `dashboardRunViews.ts` | Canonical referral extracted facts | referral fact extraction types | Yes, through source fact pack/docs review | Yes | Fact IDs/source sections must remain stable. |
| `referral-document-processing/field-map-snapshot.json` | `referralProcessing/pipeline.ts` | `oasisClinicalFactPackBuilder.ts`, `patientDashboardStateWriter.ts`, `dashboardRunViews.ts` | Canonical field-map snapshot | referral field contract types | Yes, indirectly | Yes | Broad field-map evidence should not be treated as field-specific OASIS evidence. |
| `referral-document-processing/llm-proposal.json` | `referralProcessing/pipeline.ts` / `llmProposalService.ts` | `comparisonEngine.ts`, debug, QA services | Canonical LLM proposal artifact | `llmProposalSchema.ts` | Indirectly | Yes, if LLM enabled and source text available | LLM output should remain auditable and should not bypass deterministic safety checks. |
| `referral-document-processing/field-comparison.json` | `referralProcessing/pipeline.ts` / `comparisonEngine.ts` | dashboard state writer, debug | Canonical referral comparison artifact | referral comparison types | Indirectly | Yes | Mapping drift can surface as false comparison mismatches. |
| `referral-document-processing/patient-qa-reference.json` | `referralProcessing/pipeline.ts` / QA reference projection | `dashboardRunViews.ts`, `patientDashboardStateWriter.ts`, API demo seeding | Canonical referral QA reference | `PatientQaReference` | Yes | Yes | Dashboard docs review depends on this for source fields. |
| `referral-document-processing/qa-document-summary.json` | `referralProcessing/pipeline.ts` | `dashboardRunViews.ts`, dashboard docs review | Canonical referral document summary | referral QA insight types | Yes | Yes | Summary must not be treated as raw evidence when field-specific artifacts exist. |
| `document-inventory.json`, `document-catalog.json`, `document-text.json`, `document-fact-pack.json`, `document-extraction-cache.json` | document inventory/catalog/text/fact-pack/cache services | referral processing, dashboard docs review, source fact-pack builder | Canonical document processing artifacts | shared document types in `packages/shared-types/src/document-*.ts` | Yes, mostly indirect | Yes | Large local artifacts may contain source text; keep generated runs ignored. |

## Production Feedback Source Rules

- OASIS Diagnosis dashboard priority is strict: Finale coded diagnosis rows (`oasis-diagnosis-extraction.json` / visible diagnosis route) win first, then OASIS SOC diagnosis snapshot fallback, then printed-note diagnosis fallback, then explicit referral fallback only when labeled as fallback. Broad OASIS clinical fact-pack text must not silently masquerade as authoritative coded diagnoses.
- Diagnosis summary payloads may include `sourceLabel`, `capturedAt`, and `isFallback`. The dashboard must render fallback status visibly whenever `isFallback` is true.
- Patient lookup failures must leave actionable step evidence: patient display name, available identifier, search attempts, candidate texts, rejected/scored candidate reasons, debug summary/screenshot paths when captured, and final failure category.
- Visit Notes discovery has two inventory modes: the existing patient Visit Notes table and a calendar/card fallback. Calendar-derived rows use `source: "calendar_card"` and indicate inventory-only analysis until note text capture runs.
- Manual patient refresh is read-only and routes through the agency refresh control plane with a single selected patient. Refresh should reacquire source-of-truth artifacts and rebuild dashboard state; OCR/extraction caches are reusable only when source content hashes remain unchanged.

## Source-Control Policy

- Track curated, script-referenced demo bundles only when they are intentionally used by tests, seeded demos, or replay tools.
- Ignore timestamped generated runs such as `services/finale-workbook-intake/artifacts/demo/oasis-qa-demo-*/`.
- Promote reusable test data to `src/tests/fixtures/**` instead of committing ad hoc generated patient output.
- Runtime control-plane data (`data/control-plane/**`, `services/api/data/control-plane/**`) and local auth state (`.auth/**`, `services/api/.auth/**`) are operational state, not source artifacts.
- Before adding a new tracked artifact, document its writer, reader, schema/type, regeneration path, and PHI/security risk in this file.

## Contract Rules

- Canonical dashboard rows come from `clinical-comparison-rows.json`; legacy fallback should only apply when canonical rows are absent or explicitly unavailable.
- `patient-dashboard-state.json` is the dashboard aggregate, not the only source of truth. Keep raw source artifacts available for audit.
- Fact packs are derived artifacts. Regenerate rather than hand-edit.
- OASIS Validation Snapshot field evidence must stay field-specific; broad fact-pack or field-map evidence is not a safe substitute.
- Visit Notes cleanup must preserve active/finalized lifecycle policy, POC mapping fields, and the processing manifest.
- Local generated artifacts should stay out of source control unless promoted to named fixtures under `src/tests/fixtures`.
