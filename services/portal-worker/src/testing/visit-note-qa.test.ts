import assert from "node:assert/strict";
import { hasMeaningfulVisitNoteContent } from "../extractors/visitNoteExtractor";
import {
  buildVisitNoteQaReport,
  deriveVisitNoteOverallStatus,
  evaluateVisitNoteQaRules,
} from "../rules/visitNoteQaRules";
import { type VisitNoteExtractionSnapshot } from "../types/visitNoteQa";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "hasMeaningfulVisitNoteContent rejects empty, placeholder-like, and sub-10-char values",
    run: () => {
      assert.equal(hasMeaningfulVisitNoteContent(""), false);
      assert.equal(hasMeaningfulVisitNoteContent("N/A"), false);
      assert.equal(hasMeaningfulVisitNoteContent("Too short"), false);
      assert.equal(hasMeaningfulVisitNoteContent("Subjective Info", { label: "Subjective Info" }), false);
    },
  },
  {
    name: "hasMeaningfulVisitNoteContent marks content over 30 chars as meaningful",
    run: () => {
      assert.equal(
        hasMeaningfulVisitNoteContent("No safety issues noted during visit.", {
          label: "Safety Issues",
          minimumLength: 31,
        }),
        true,
      );
    },
  },
  {
    name: "hasMeaningfulVisitNoteContent stays conservative for 10-to-30-char content",
    run: () => {
      assert.equal(
        hasMeaningfulVisitNoteContent("Mild fatigue today", {
          label: "Subjective Info",
          minimumLength: 31,
        }),
        false,
      );
    },
  },
  {
    name: "evaluateVisitNoteQaRules flags missing required sections and sparse notes conservatively",
    run: () => {
      const rules = evaluateVisitNoteQaRules({
        sections: [
          {
            id: "subjective-info",
            label: "Subjective Info",
            present: true,
            visible: true,
            textLength: 10,
            hasMeaningfulContent: false,
            sample: null,
          },
          {
            id: "diagnosis-history",
            label: "Diagnosis History",
            present: true,
            visible: true,
            textLength: 42,
            hasMeaningfulContent: true,
            sample: null,
          },
          {
            id: "visit-summary",
            label: "Visit Summary",
            present: false,
            visible: false,
            textLength: 0,
            hasMeaningfulContent: false,
            sample: null,
          },
          {
            id: "safety-issues",
            label: "Safety Issues",
            present: true,
            visible: true,
            textLength: 31,
            hasMeaningfulContent: true,
            sample: null,
          },
          {
            id: "functional-mobility",
            label: "Functional Mobility",
            present: true,
            visible: true,
            textLength: 11,
            hasMeaningfulContent: false,
            sample: null,
          },
        ],
        metadata: {
          noteType: "Therapy Visit Note",
          pageTitle: "Therapy Visit Note",
          documentRoute: "/documents/note/visitnote/123",
          signatureState: "unsigned",
          visitDate: null,
        },
      });

      assert.equal(rules.find((rule) => rule.id === "missing_subjective")?.status, "FAIL");
      assert.equal(rules.find((rule) => rule.id === "missing_visit_summary")?.status, "FAIL");
      assert.equal(rules.find((rule) => rule.id === "possibly_unsigned")?.status, "NEEDS_REVIEW");
      assert.equal(rules.find((rule) => rule.id === "sparse_note")?.status, "NEEDS_REVIEW");
    },
  },
  {
    name: "buildVisitNoteQaReport derives FAIL overall status when required sections fail",
    run: () => {
      const snapshot: VisitNoteExtractionSnapshot = {
        pageType: "visit_note",
        url: "https://example.test/documents/note/visitnote/123",
        extractedAt: "2026-03-24T00:00:00.000Z",
        sections: [
          {
            id: "subjective-info",
            label: "Subjective Info",
            present: true,
            visible: true,
            textLength: 32,
            hasMeaningfulContent: true,
            sample: null,
          },
          {
            id: "diagnosis-history",
            label: "Diagnosis History",
            present: true,
            visible: true,
            textLength: 0,
            hasMeaningfulContent: false,
            sample: null,
          },
          {
            id: "visit-summary",
            label: "Visit Summary",
            present: true,
            visible: true,
            textLength: 40,
            hasMeaningfulContent: true,
            sample: null,
          },
          {
            id: "safety-issues",
            label: "Safety Issues",
            present: true,
            visible: true,
            textLength: 28,
            hasMeaningfulContent: true,
            sample: null,
          },
          {
            id: "functional-mobility",
            label: "Functional Mobility",
            present: true,
            visible: true,
            textLength: 35,
            hasMeaningfulContent: true,
            sample: null,
          },
        ],
        metadata: {
          noteType: "Therapy Visit Note",
          pageTitle: "Therapy Visit Note",
          documentRoute: "/documents/note/visitnote/123",
          signatureState: "signed",
          visitDate: "03/24/2026",
        },
        warnings: [],
      };

      const report = buildVisitNoteQaReport(snapshot);

      assert.equal(report.summary.overallStatus, "FAIL");
      assert.deepEqual(report.summary.missingSections, ["diagnosis-history"]);
    },
  },
  {
    name: "deriveVisitNoteOverallStatus prefers FAIL over NEEDS_REVIEW and PASS",
    run: () => {
      assert.equal(
        deriveVisitNoteOverallStatus([
          { status: "PASS" },
          { status: "NEEDS_REVIEW" },
          { status: "FAIL" },
        ]),
        "FAIL",
      );
      assert.equal(
        deriveVisitNoteOverallStatus([
          { status: "PASS" },
          { status: "NEEDS_REVIEW" },
        ]),
        "NEEDS_REVIEW",
      );
      assert.equal(
        deriveVisitNoteOverallStatus([
          { status: "PASS" },
          { status: "PASS" },
        ]),
        "PASS",
      );
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`visit-note-qa tests passed: ${passed}/${tests.length}`);
