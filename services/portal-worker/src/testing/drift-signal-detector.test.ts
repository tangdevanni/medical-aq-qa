import assert from "node:assert/strict";
import { buildDriftSignalsFromSelectorHealth } from "../health/driftSignalDetector";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "executable missing selector raises drift",
    run: () => {
      const result = buildDriftSignalsFromSelectorHealth({
        documentKind: "VISIT_NOTE",
        routePath: "/documents/note/visitnote/123",
        selectorHealth: [
          {
            name: "VISIT_NOTE.SAVE_PAGE.workflowAction",
            documentKind: "VISIT_NOTE",
            phase: "WORKFLOW_EXECUTION",
            action: "SAVE_PAGE",
            targetField: "frequencySummary",
            required: true,
            expectedCardinality: "ONE",
            status: "MISSING",
            matchedCount: 0,
            selectorUsed: null,
            supportLevel: "REVIEW_GATED",
            supportDisposition: "EXECUTABLE",
            reason: "Required selector did not resolve.",
          },
        ],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0].type, "SELECTOR_MISSING");
    },
  },
  {
    name: "review-gated selector health does not raise drift",
    run: () => {
      const result = buildDriftSignalsFromSelectorHealth({
        documentKind: "OASIS",
        routePath: "/documents/assessment/123",
        selectorHealth: [
          {
            name: "OASIS.SAVE_PAGE.workflowAction",
            documentKind: "OASIS",
            phase: "WORKFLOW_EXECUTION",
            action: "SAVE_PAGE",
            targetField: "frequencySummary",
            required: true,
            expectedCardinality: "ONE",
            status: "MISSING",
            matchedCount: 0,
            selectorUsed: null,
            supportLevel: "REVIEW_GATED",
            supportDisposition: "REVIEW_GATED",
            reason: "Required selector did not resolve.",
          },
        ],
        supportMatrixDiagnostics: [
          {
            timestamp: "2026-03-25T00:00:00.000Z",
            documentKind: "OASIS",
            targetField: "frequencySummary",
            action: "SAVE_PAGE",
            supportLevel: "REVIEW_GATED",
            supportDisposition: "REVIEW_GATED",
            driftEligible: false,
            reason: "SAVE_PAGE is intentionally review-gated for this document kind and target field.",
          },
        ],
      });

      assert.equal(result.length, 0);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`drift-signal-detector tests passed: ${passed}/${tests.length}`);
