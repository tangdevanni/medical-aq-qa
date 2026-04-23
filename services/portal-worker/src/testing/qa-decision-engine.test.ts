import assert from "node:assert/strict";
import {
  type CrossDocumentQaMismatch,
  type CrossDocumentQaResult,
  type VisitNoteQaReport,
} from "@medical-ai-qa/shared-types";
import { runQaDecisionEngine } from "../decisions/qaDecisionEngine";
import { resolveSourceOfTruth } from "../decisions/sourceOfTruthResolver";
import { type DocumentExtractionBundle } from "../decisions/decisionShared";

function buildDocument(input: {
  documentKind: "VISIT_NOTE" | "OASIS" | "PLAN_OF_CARE" | "ADMISSION_ORDER" | "PHYSICIAN_ORDER";
  pageType: "visit_note" | "oasis" | "plan_of_care" | "admission_order" | "physician_order";
  diagnosisSummary?: string | null;
  frequencySummary?: string | null;
  homeboundSummary?: string | null;
  orderSummary?: string | null;
}) {
  return {
    documentKind: input.documentKind,
    pageType: input.pageType,
    url: `https://example.test/${input.documentKind.toLowerCase()}`,
    extractedAt: "2026-03-24T00:00:00.000Z",
    metadata: {
      pageTitle: input.documentKind,
      documentLabel: input.documentKind,
      patientMaskedId: "***1234",
      visitDate: "03/24/2026",
      physician: "D*** S***",
      signedState: "signed" as const,
      diagnosisSummary: input.diagnosisSummary ?? null,
      frequencySummary: input.frequencySummary ?? null,
      homeboundSummary: input.homeboundSummary ?? null,
      orderSummary: input.orderSummary ?? null,
    },
    sections: [],
    warnings: [],
  };
}

function buildBundle(input?: Partial<DocumentExtractionBundle>): DocumentExtractionBundle {
  return {
    visitNote: null,
    oasis: null,
    planOfCare: null,
    orders: [],
    bundleConfidence: "HIGH",
    bundleReason: "matched masked patient identity and nearby document dates",
    ...input,
  };
}

function buildCrossDocumentQa(input?: Partial<CrossDocumentQaResult>): CrossDocumentQaResult {
  return {
    ...baseCrossDocumentQa(),
    ...input,
  };
}

function baseCrossDocumentQa(): CrossDocumentQaResult {
  return {
    bundleConfidence: "HIGH",
    bundleReason: "matched masked patient identity and nearby document dates",
    mismatches: [],
    alignments: [],
    warnings: [],
  };
}

function buildMismatch(input: CrossDocumentQaMismatch): CrossDocumentQaMismatch {
  return input;
}

function buildVisitNoteQa(
  ruleId: "missing_diagnosis" | "sparse_note",
  status: "FAIL" | "NEEDS_REVIEW",
): VisitNoteQaReport {
  return {
    pageType: "visit_note" as const,
    url: "https://example.test/visit-note",
    extractedAt: "2026-03-24T00:00:00.000Z",
    sections: [],
    metadata: {
      noteType: "Therapy Visit Note",
      pageTitle: "Therapy Visit Note",
      documentRoute: "/documents/note/visitnote/123",
      signatureState: "signed" as const,
      visitDate: "03/24/2026",
    },
    rules: [{
      id: ruleId,
      status,
      reason: `${ruleId} triggered`,
      evidence: {},
    }],
    summary: {
      overallStatus: status === "FAIL" ? "FAIL" as const : "NEEDS_REVIEW" as const,
      missingSections: ruleId === "missing_diagnosis" ? ["diagnosis-history"] : [],
      reviewFlags: [ruleId],
      meaningfulSectionCount: 1,
      totalMeaningfulTextLength: 40,
    },
    warnings: [],
  };
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "frequency mismatch yields actionable safe-autofix candidate on visit note target",
    run: () => {
      const visitNote = buildDocument({
        documentKind: "VISIT_NOTE",
        pageType: "visit_note",
        frequencySummary: "PT once weekly",
      });
      const planOfCare = buildDocument({
        documentKind: "PLAN_OF_CARE",
        pageType: "plan_of_care",
        frequencySummary: "PT twice weekly",
      });
      const result = runQaDecisionEngine({
        currentDocument: visitNote,
        qaResult: null,
        crossDocumentQa: buildCrossDocumentQa({
          mismatches: [buildMismatch({
            type: "FREQUENCY_MISMATCH",
            confidence: "HIGH",
            reason: "mismatch",
            sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
          })],
        }),
        bundle: buildBundle({
          visitNote,
          planOfCare,
        }),
      });

      assert.equal(result.decisions.length, 1);
      assert.equal(result.decisions[0].issueType, "FREQUENCY_MISMATCH");
      assert.equal(result.decisions[0].actionability, "ACTIONABLE");
      assert.equal(result.decisions[0].autoFixEligibility, "SAFE_AUTOFIX_CANDIDATE");
      assert.equal(result.decisions[0].sourceOfTruth?.sourceDocumentKind, "PLAN_OF_CARE");
      assert.equal(result.decisions[0].proposedAction.targetField, "frequencySummary");
    },
  },
  {
    name: "diagnosis mismatch stays manual review even when actionable",
    run: () => {
      const visitNote = buildDocument({
        documentKind: "VISIT_NOTE",
        pageType: "visit_note",
        diagnosisSummary: "Generalized weakness",
      });
      const oasis = buildDocument({
        documentKind: "OASIS",
        pageType: "oasis",
        diagnosisSummary: "Heart failure and weakness",
      });
      const result = runQaDecisionEngine({
        currentDocument: visitNote,
        qaResult: null,
        crossDocumentQa: buildCrossDocumentQa({
          mismatches: [buildMismatch({
            type: "DIAGNOSIS_MISMATCH",
            confidence: "MEDIUM",
            reason: "mismatch",
            sources: ["VISIT_NOTE", "OASIS"],
          })],
        }),
        bundle: buildBundle({
          visitNote,
          oasis,
        }),
      });

      assert.equal(result.decisions[0].actionability, "ACTIONABLE");
      assert.equal(result.decisions[0].autoFixEligibility, "MANUAL_REVIEW_REQUIRED");
      assert.equal(result.decisions[0].humanReviewReasons.includes("CLINICALLY_SENSITIVE_NARRATIVE"), true);
    },
  },
  {
    name: "low bundle confidence downgrades homebound decisioning to review-only",
    run: () => {
      const visitNote = buildDocument({
        documentKind: "VISIT_NOTE",
        pageType: "visit_note",
      });
      const oasis = buildDocument({
        documentKind: "OASIS",
        pageType: "oasis",
        homeboundSummary: "Homebound due to dyspnea and fall risk",
      });
      const result = runQaDecisionEngine({
        currentDocument: visitNote,
        qaResult: null,
        crossDocumentQa: buildCrossDocumentQa({
          bundleConfidence: "LOW",
          bundleReason: "Bundle relied on row-order proximity.",
          mismatches: [buildMismatch({
            type: "MISSING_HOMEBOUND_REASON",
            confidence: "HIGH",
            reason: "missing",
            sources: ["OASIS", "VISIT_NOTE"],
          })],
        }),
        bundle: buildBundle({
          visitNote,
          oasis,
          bundleConfidence: "LOW",
          bundleReason: "Bundle relied on row-order proximity.",
        }),
      });

      assert.equal(result.decisions[0].actionability, "REVIEW_ONLY");
      assert.equal(result.decisions[0].humanReviewReasons.includes("LOW_BUNDLE_CONFIDENCE"), true);
    },
  },
  {
    name: "sparse note stays review-only and not eligible for autofix",
    run: () => {
      const visitNote = buildDocument({
        documentKind: "VISIT_NOTE",
        pageType: "visit_note",
      });
      const result = runQaDecisionEngine({
        currentDocument: visitNote,
        qaResult: buildVisitNoteQa("sparse_note", "NEEDS_REVIEW"),
        crossDocumentQa: buildCrossDocumentQa(),
        bundle: buildBundle({
          visitNote,
        }),
      });

      assert.equal(result.decisions[0].issueType, "sparse_note");
      assert.equal(result.decisions[0].actionability, "REVIEW_ONLY");
      assert.equal(result.decisions[0].autoFixEligibility, "NOT_ELIGIBLE");
    },
  },
  {
    name: "order mismatch without safe order anchor is not actionable",
    run: () => {
      const visitNote = buildDocument({
        documentKind: "VISIT_NOTE",
        pageType: "visit_note",
      });
      const result = runQaDecisionEngine({
        currentDocument: visitNote,
        qaResult: null,
        crossDocumentQa: buildCrossDocumentQa({
          mismatches: [buildMismatch({
            type: "ORDER_NOT_REFERENCED",
            confidence: "MEDIUM",
            reason: "order missing",
            sources: ["PHYSICIAN_ORDER", "VISIT_NOTE"],
          })],
        }),
        bundle: buildBundle({
          visitNote,
          orders: [
            buildDocument({
              documentKind: "PHYSICIAN_ORDER",
              pageType: "physician_order",
              orderSummary: null,
            }),
          ],
        }),
      });

      assert.equal(result.decisions[0].actionability, "NOT_ACTIONABLE");
      assert.equal(result.decisions[0].proposedAction.action, "NO_ACTION");
    },
  },
  {
    name: "source-of-truth resolution prefers OASIS for missing diagnosis when available",
    run: () => {
      const resolution = resolveSourceOfTruth({
        issueType: "missing_diagnosis",
        bundle: buildBundle({
          oasis: buildDocument({
            documentKind: "OASIS",
            pageType: "oasis",
            diagnosisSummary: "Heart failure",
          }),
          planOfCare: buildDocument({
            documentKind: "PLAN_OF_CARE",
            pageType: "plan_of_care",
            diagnosisSummary: "Heart failure",
          }),
        }),
      });

      assert.equal(resolution.sourceOfTruth?.sourceDocumentKind, "OASIS");
      assert.equal(resolution.humanReviewReasons.includes("MULTIPLE_CANDIDATE_DOCUMENTS"), true);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`qa-decision-engine tests passed: ${passed}/${tests.length}`);
