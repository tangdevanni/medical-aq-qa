import assert from "node:assert/strict";
import { scoreSelectorStability } from "../reliability/selectorStabilityScorer";
import { buildRunRecord, buildSelectorHealthRecord } from "./reliability-intelligence.fixtures";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "selector stability scores executable selectors and ignores review-gated missing states",
    run: () => {
      const records = [
        buildRunRecord({
          runId: "run-1",
          selectorHealth: [
            buildSelectorHealthRecord({
              status: "HEALTHY",
            }),
            buildSelectorHealthRecord({
              name: "OASIS.SAVE_PAGE.workflowAction",
              documentKind: "OASIS",
              status: "MISSING",
              supportDisposition: "REVIEW_GATED",
            }),
          ],
        }),
        buildRunRecord({
          runId: "run-2",
          timestamp: "2026-03-25T01:00:00.000Z",
          selectorHealth: [
            buildSelectorHealthRecord({
              status: "HEALTHY",
            }),
          ],
        }),
        buildRunRecord({
          runId: "run-3",
          timestamp: "2026-03-25T02:00:00.000Z",
          selectorHealth: [
            buildSelectorHealthRecord({
              status: "AMBIGUOUS",
              matchedCount: 2,
            }),
          ],
        }),
      ];

      const scores = scoreSelectorStability(records);

      assert.equal(scores.length, 1);
      assert.equal(scores[0].selectorName, "VISIT_NOTE.SAVE_PAGE.workflowAction");
      assert.equal(scores[0].sampleSize, 3);
      assert.equal(scores[0].healthyCount, 2);
      assert.equal(scores[0].ambiguousCount, 1);
      assert.equal(scores[0].reliabilityLevel, "DEGRADED");
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`selector-stability tests passed: ${passed}/${tests.length}`);
