import { describe, expect, it } from "vitest";
import type { PlanOfCareReviewDraftArtifact, VisitNoteFactPack, VisitNotesDiscoveryArtifact } from "@medical-ai-qa/shared-types";
import { buildVisitNotesDiscoveryArtifactForTest } from "../portal/services/visitNotesDiscoveryService";
import {
  buildVisitNoteProcessingManifest,
  buildVisitNoteQaReview,
} from "../services/visitNoteQaAnalysisService";

function discovery(rows: Array<{ key?: string; type: string; status?: string; text?: string }>): VisitNotesDiscoveryArtifact {
  const artifact = buildVisitNotesDiscoveryArtifactForTest({
    rows: rows.map((row, index) => ({
      portalDocumentId: row.key ?? `note-${index}`,
      rawDocumentType: row.type,
      statusRaw: row.status,
      rowText: row.text ?? `${row.type} ${row.status ?? ""}`,
      hasSafeOpenAction: true,
    })),
    generatedAt: "2026-05-07T00:00:00.000Z",
  });
  artifact.rows = artifact.rows.map((row) => ({ ...row, captureStatus: "captured" }));
  return artifact;
}

function minimalPlanOfCare(): PlanOfCareReviewDraftArtifact {
  return {
    schemaVersion: "plan-of-care-review-draft.v1",
    generatedAt: "2026-05-07T00:00:00.000Z",
    sourcePriorityUsed: "oasis_fact_pack",
    llmStatus: "disabled",
    diagnosisDrafts: [{
      diagnosisKey: "weakness",
      diagnosisLabel: "Weakness",
      clinicalDomain: "mobility_fall_risk",
      problem: {
        selectedText: "Mobility limitation",
        rationale: "OASIS mobility facts",
        confidence: 0.9,
        evidenceFactIds: ["oasis-mobility-1"],
      },
      goal: {
        selectedText: "Improve safe transfers and ambulation",
        rationale: "OASIS mobility facts",
        confidence: 0.9,
        evidenceFactIds: ["oasis-mobility-1"],
      },
      interventions: [{
        selectedText: "Skilled PT to provide gait training, transfer training, and fall prevention instruction.",
        rationale: "Mobility limitation requires skilled therapy intervention.",
        confidence: 0.88,
        evidenceFactIds: ["oasis-mobility-1"],
      }],
      needsHumanReview: false,
      warnings: [],
    }],
    summary: {
      diagnosisCount: 1,
      draftedDiagnosisCount: 1,
      needsReviewCount: 0,
      lowConfidenceCount: 0,
      missingCandidateCount: 0,
      sourcePriorityUsed: "oasis_fact_pack",
      llmStatus: "disabled",
      warnings: [],
    },
    warnings: [],
  };
}

describe("visit note processing manifest", () => {
  it("reuses OCR/text extraction when content is unchanged but reruns analysis when POC changes", () => {
    const notes = discovery([{ key: "note-1", type: "Visit Note-PT", status: "In Progress" }]);
    const first = buildVisitNoteProcessingManifest({
      patientRunId: "run-1",
      discovery: notes,
      planOfCareHash: "poc-a",
      oasisFactPackHash: "oasis-a",
      textHashesByVisitNoteKey: { [notes.rows[0]!.visitNoteKey]: "text-a" },
      generatedAt: "2026-05-07T00:00:00.000Z",
    });
    const second = buildVisitNoteProcessingManifest({
      patientRunId: "run-1",
      discovery: notes,
      planOfCareHash: "poc-b",
      oasisFactPackHash: "oasis-a",
      previousManifest: first,
      textHashesByVisitNoteKey: { [notes.rows[0]!.visitNoteKey]: "text-a" },
      generatedAt: "2026-05-07T00:01:00.000Z",
    });

    expect(second.visitNoteInputs[0]?.extractionSource).toBe("cache");
    expect(second.visitNoteInputs[0]?.llmAnalysisSource).toBe("new_llm");
    expect(second.visitNoteInputs[0]?.rerunReason).toBe("plan_of_care_or_oasis_hash_changed");
  });

  it("marks removed visit notes inactive instead of deleting history", () => {
    const notes = discovery([
      { key: "note-1", type: "Visit Note-PT" },
      { key: "note-2", type: "Visit Note-RN Regular Visit" },
    ]);
    const first = buildVisitNoteProcessingManifest({
      patientRunId: "run-1",
      discovery: notes,
      planOfCareHash: "poc-a",
      oasisFactPackHash: "oasis-a",
      textHashesByVisitNoteKey: Object.fromEntries(notes.rows.map((row) => [row.visitNoteKey, `text-${row.visitNoteKey}`])),
    });
    const current = {
      ...notes,
      rows: notes.rows.slice(0, 1),
      counts: {
        ...notes.counts,
        total: 1,
      },
    };
    const second = buildVisitNoteProcessingManifest({
      patientRunId: "run-1",
      discovery: current,
      planOfCareHash: "poc-a",
      oasisFactPackHash: "oasis-a",
      previousManifest: first,
      textHashesByVisitNoteKey: { [current.rows[0]!.visitNoteKey]: "text-a" },
    });

    expect(second.visitNoteInputs).toHaveLength(2);
    expect(second.visitNoteInputs.find((entry) => entry.inactive)?.rerunReason).toBe("visit_note_removed");
  });
});

describe("visit note QA review", () => {
  it("detects mobility contradictions against OASIS constraints", () => {
    const notes = discovery([{ key: "note-1", type: "Visit Note-PT", status: "In Progress" }]);
    const factPack: VisitNoteFactPack = {
      schemaVersion: "visit-note-fact-pack.v1",
      generatedAt: "2026-05-07T00:00:00.000Z",
      factCount: 1,
      categories: ["mobility"],
      facts: [{
        factId: "visit-note-fact-1",
        visitNoteKey: notes.rows[0]!.visitNoteKey,
        category: "mobility",
        normalizedValue: "patient ambulates independently",
        confidence: 0.88,
        source: {
          visitType: "physical_therapy",
          documentType: "Visit Note-PT",
        },
      }],
      warnings: [],
    };
    const review = buildVisitNoteQaReview({
      discovery: notes,
      factPack,
      planOfCare: minimalPlanOfCare(),
      oasisClinicalFactPack: {
        facts: [{
          factId: "oasis-mobility-1",
          category: "mobility",
          normalizedValue: "Patient is chair-bound and requires assistance.",
        }],
      },
      generatedAt: "2026-05-07T00:00:00.000Z",
    });

    expect(review.status).toBe("ready");
    expect(review.summary.contradictionCount).toBe(1);
    expect(review.findings[0]?.category).toBe("contradiction");
  });

  it("maps analyzed visit notes to POC problems and interventions addressed", () => {
    const notes = discovery([{ key: "note-1", type: "Visit Note-PT", status: "In Progress" }]);
    const factPack: VisitNoteFactPack = {
      schemaVersion: "visit-note-fact-pack.v1",
      generatedAt: "2026-05-07T00:00:00.000Z",
      factCount: 3,
      categories: ["mobility", "therapy_exercises", "patient_response"],
      facts: [
        {
          factId: "visit-note-fact-mobility",
          visitNoteKey: notes.rows[0]!.visitNoteKey,
          category: "mobility",
          normalizedValue: "gait training and transfer training performed",
          rawSnippet: "Skilled PT provided gait training and transfer training for fall prevention.",
          confidence: 0.88,
          source: {
            visitType: "physical_therapy",
            documentType: "Visit Note-PT",
          },
        },
        {
          factId: "visit-note-fact-response",
          visitNoteKey: notes.rows[0]!.visitNoteKey,
          category: "patient_response",
          normalizedValue: "patient tolerated well",
          rawSnippet: "Patient tolerated well and demonstrated safer transfers.",
          confidence: 0.82,
          source: {
            visitType: "physical_therapy",
            documentType: "Visit Note-PT",
          },
        },
      ],
      warnings: [],
    };
    const review = buildVisitNoteQaReview({
      discovery: notes,
      factPack,
      planOfCare: minimalPlanOfCare(),
      oasisClinicalFactPack: { facts: [] },
      generatedAt: "2026-05-07T00:00:00.000Z",
    });

    const match = review.noteSummaries[0]?.pocProblemMatches[0];
    expect(match?.problemTitle).toBe("Weakness");
    expect(match?.interventionTexts[0]).toContain("gait training");
    expect(match?.matchedFactIds).toContain("visit-note-fact-mobility");
    expect(review.noteSummaries[0]?.pocMappingResult?.alignmentStatus).toBe("aligned");
    expect(review.noteSummaries[0]?.pocMappingResult?.matchedPocItems[0]?.problemTitle).toBe("Weakness");
  });

  it("keeps QA Complete notes finalized and out of active monitoring counts", () => {
    const notes = discovery([
      { key: "note-1", type: "Visit Note-PT", status: "QA Completed" },
      { key: "note-2", type: "Visit Note-RN Regular Visit", status: "Submitted" },
    ]);
    const review = buildVisitNoteQaReview({
      discovery: notes,
      factPack: null,
      planOfCare: minimalPlanOfCare(),
      oasisClinicalFactPack: { facts: [] },
    });

    expect(review.summary.qaCompleteFinalizedCount).toBe(1);
    expect(review.summary.activeMonitoringCount).toBe(1);
    expect(review.noteSummaries[0]?.lifecycleStatus).toBe("finalized_no_active_monitoring");
    expect(review.noteSummaries[1]?.lifecycleStatus).toBe("active_monitoring");
  });

  it("counts not-started and missed visits without turning them into findings", () => {
    const notes = discovery([
      { key: "note-1", type: "Visit Note-RN Regular Visit", status: "Not Started" },
      { key: "note-2", type: "Visit Note-PTA", status: "Missed Visit" },
    ]);
    const review = buildVisitNoteQaReview({
      discovery: notes,
      factPack: null,
      planOfCare: minimalPlanOfCare(),
      oasisClinicalFactPack: { facts: [] },
    });

    expect(review.summary.notStartedVisitNotes).toBe(1);
    expect(review.summary.missedVisitNotes).toBe(1);
    expect(review.summary.incompleteNoteCount).toBe(0);
    expect(review.summary.actionableFindingCount).toBe(0);
    expect(review.findings).toEqual([]);
  });
});
