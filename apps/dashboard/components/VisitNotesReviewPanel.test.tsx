import React from "react";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { VisitNotesReview } from "../lib/types";
import { VisitNotesReviewPanel } from "./VisitNotesReviewPanel";

const baseReview: VisitNotesReview = {
  available: true,
  status: "ready",
  generatedAt: "2026-05-07T00:00:00.000Z",
  totalVisitNotes: 3,
  eligibleVisitNotes: 2,
  analyzedVisitNotes: 2,
  skippedVisitNotes: 1,
  missedVisitNotes: 0,
  notStartedVisitNotes: 1,
  activeMonitoringCount: 1,
  qaCompleteFinalizedCount: 1,
  inProgressCount: 1,
  submittedCount: 0,
  qaPendingCount: 0,
  signedCount: 0,
  capturedVisitNotes: 1,
  reusedVisitNotes: 1,
  failedVisitNotes: 0,
  degradedVisitNotes: 0,
  cappedVisitNotes: 0,
  actionableFindingCount: 1,
  contradictionCount: 1,
  positiveProgressCount: 0,
  possibleUpdateNeededCount: 0,
  pocAlignmentIssueCount: 0,
  incompleteNoteCount: 0,
  byVisitType: { skilled_nursing: 1, physical_therapy: 2 },
  byStatus: { qa_completed: 2, not_started: 1 },
  visitTypeCounts: [
    { visitType: "skilled_nursing", count: 1, statuses: { qa_completed: 1 } },
    { visitType: "physical_therapy", count: 2, statuses: { qa_completed: 1, not_started: 1 } },
  ],
  visitTypeStatusMatrix: [
    { visitType: "skilled_nursing", count: 1, statuses: { qa_completed: 1 } },
    { visitType: "physical_therapy", count: 2, statuses: { qa_completed: 1, not_started: 1 } },
  ],
  findings: [{
    findingId: "finding-1",
    visitNoteKey: "note-1",
    visitType: "physical_therapy",
    visitDate: "2026-05-02",
    severity: "high",
    category: "contradiction",
    title: "Visit note mobility conflicts with OASIS/POC mobility limitation",
    description: "Visit note says independent ambulation while OASIS indicates severe limitation.",
    suggestedReviewerAction: "Confirm interval improvement before accepting the note.",
    needsHumanReview: true,
    confidence: 0.88,
    evidenceCount: 3,
  }],
  noteSummaries: [{
    visitNoteKey: "note-1",
    visitType: "physical_therapy",
    visitDate: "2026-05-02",
    status: "qa_completed",
    lifecycleStatus: "active_monitoring",
    captureStatus: "captured",
    analyzed: true,
    analysisStatus: "ready",
    mappingStatus: "aligned",
    matchStrength: 0.82,
    summary: "Two visit-note facts extracted for physical therapy.",
    missingFields: [],
    alignedPocGoals: ["Improve safe transfers"],
    pocMappingResult: {
      alignmentStatus: "aligned",
      matchStrength: 0.82,
      matchedPocItems: [{
        problemKey: "mobility",
        problemTitle: "Mobility limitation",
        goalTexts: ["Improve safe transfers"],
        interventionTexts: ["Skilled PT to provide gait training and transfer training."],
        evidenceIds: ["poc-goal-1"],
      }],
      visitNoteEvidence: ["visit-note-fact-1"],
      rationale: "Visit-note facts support the mobility POC intervention.",
      missingDocumentation: [],
      contradictions: [],
      pocUpdateSignals: [],
    },
    pocProblemMatches: [{
      problemKey: "mobility",
      problemTitle: "Mobility limitation",
      problemStatement: "Patient has impaired transfers and gait safety.",
      interventionTexts: ["Skilled PT to provide gait training and transfer training."],
      matchedFactIds: ["visit-note-fact-1"],
      confidence: 0.82,
      rationale: "Visit-note facts overlap with the mobility POC intervention.",
    }],
    possibleContradictions: ["Visit note mobility conflicts with OASIS/POC mobility limitation"],
  }],
  warnings: ["One clinically relevant visit note has not been captured."],
};

describe("VisitNotesReviewPanel", () => {
  it("renders pending state when visit notes discovery has not run", () => {
    const html = renderToStaticMarkup(<VisitNotesReviewPanel review={null} />);
    assert.match(html, /Visit Notes discovery has not run/);
    assert.match(html, /Documentations/);
  });

  it("renders visit type counts and note inventory", () => {
    const html = renderToStaticMarkup(<VisitNotesReviewPanel review={baseReview} />);
    assert.match(html, /Total Visit Notes/);
    assert.match(html, /Active Monitoring/);
    assert.match(html, /QA Complete/);
    assert.match(html, /Captured/);
    assert.match(html, /Not Started/);
    assert.match(html, /Skilled Nursing/);
    assert.match(html, /Physical Therapy/);
    assert.match(html, /Relevant to POC/);
    assert.match(html, /Improve safe transfers/);
    assert.match(html, /POC problems and interventions addressed/);
    assert.match(html, /Skilled PT to provide gait training/);
    assert.doesNotMatch(html, /Confirm interval improvement/);
  });

  it("does not render raw evidence details or non-POC findings", () => {
    const html = renderToStaticMarkup(<VisitNotesReviewPanel review={baseReview} />);
    assert.match(html, /<details/);
    assert.doesNotMatch(html, /Evidence details/);
    assert.doesNotMatch(html, /visit-note-fact-1/);
  });

  it("renders legacy note summaries that do not include POC problem matches", () => {
    const legacyReview = {
      ...baseReview,
      noteSummaries: baseReview.noteSummaries.map(({ pocProblemMatches: _pocProblemMatches, ...note }) => note),
    } as VisitNotesReview;

    const html = renderToStaticMarkup(<VisitNotesReviewPanel review={legacyReview} />);
    assert.match(html, /Two visit-note facts extracted for physical therapy/);
    assert.match(html, /Matched Plan of Care goals/);
    assert.doesNotMatch(html, /Cannot read properties/);
  });
});
