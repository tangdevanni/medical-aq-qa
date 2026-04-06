import assert from "node:assert/strict";
import { runCrossDocumentQaEngine } from "../qa/crossDocumentQaEngine";

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

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "cross-document QA flags diagnosis mismatches",
    run: () => {
      const result = runCrossDocumentQaEngine({
        visitNote: buildDocument({
          documentKind: "VISIT_NOTE",
          pageType: "visit_note",
          diagnosisSummary: "Generalized weakness and falls.",
        }),
        oasis: buildDocument({
          documentKind: "OASIS",
          pageType: "oasis",
          diagnosisSummary: "Congestive heart failure management.",
        }),
        planOfCare: null,
        orders: [],
      });

      assert.equal(result.mismatches.some((mismatch) => mismatch.type === "DIAGNOSIS_MISMATCH"), true);
      assert.equal(result.bundleConfidence, "MEDIUM");
    },
  },
  {
    name: "cross-document QA flags frequency mismatches",
    run: () => {
      const result = runCrossDocumentQaEngine({
        visitNote: buildDocument({
          documentKind: "VISIT_NOTE",
          pageType: "visit_note",
          frequencySummary: "PT 2x weekly",
        }),
        oasis: null,
        planOfCare: buildDocument({
          documentKind: "PLAN_OF_CARE",
          pageType: "plan_of_care",
          frequencySummary: "PT 1x weekly",
        }),
        orders: [],
      });

      assert.equal(result.mismatches.some((mismatch) => mismatch.type === "FREQUENCY_MISMATCH"), true);
    },
  },
  {
    name: "cross-document QA flags missing homebound reasons",
    run: () => {
      const result = runCrossDocumentQaEngine({
        visitNote: buildDocument({
          documentKind: "VISIT_NOTE",
          pageType: "visit_note",
        }),
        oasis: buildDocument({
          documentKind: "OASIS",
          pageType: "oasis",
          homeboundSummary: "Patient is homebound due to exertional dyspnea and fall risk.",
        }),
        planOfCare: null,
        orders: [],
      });

      assert.equal(result.mismatches.some((mismatch) => mismatch.type === "MISSING_HOMEBOUND_REASON"), true);
    },
  },
  {
    name: "cross-document QA emits diagnosis alignments when anchors loosely match",
    run: () => {
      const result = runCrossDocumentQaEngine({
        visitNote: buildDocument({
          documentKind: "VISIT_NOTE",
          pageType: "visit_note",
          diagnosisSummary: "Chronic gait instability with lower extremity weakness.",
        }),
        oasis: buildDocument({
          documentKind: "OASIS",
          pageType: "oasis",
          diagnosisSummary: "Lower extremity weakness and chronic gait instability.",
        }),
        planOfCare: null,
        orders: [],
      });

      assert.equal(result.alignments.some((alignment) => alignment.type === "DIAGNOSIS_ALIGNED"), true);
    },
  },
  {
    name: "cross-document QA flags orders without matching note references",
    run: () => {
      const result = runCrossDocumentQaEngine({
        visitNote: buildDocument({
          documentKind: "VISIT_NOTE",
          pageType: "visit_note",
          frequencySummary: "SN 2x weekly",
        }),
        oasis: null,
        planOfCare: buildDocument({
          documentKind: "PLAN_OF_CARE",
          pageType: "plan_of_care",
          frequencySummary: "SN 2x weekly",
        }),
        orders: [
          buildDocument({
            documentKind: "PHYSICIAN_ORDER",
            pageType: "physician_order",
            orderSummary: "Discontinue skilled nursing and start daily wound checks.",
          }),
        ],
      });

      assert.equal(result.mismatches.some((mismatch) => mismatch.type === "ORDER_NOT_REFERENCED"), true);
    },
  },
  {
    name: "cross-document QA returns warnings when documents are missing",
    run: () => {
      const result = runCrossDocumentQaEngine({
        visitNote: null,
        oasis: null,
        planOfCare: null,
        orders: [],
      });

      assert.equal(result.warnings.some((warning) => warning.code === "MISSING_VISIT_NOTE"), true);
      assert.equal(result.warnings.some((warning) => warning.code === "MISSING_OASIS"), true);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`cross-document-qa tests passed: ${passed}/${tests.length}`);
