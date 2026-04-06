import assert from "node:assert/strict";
import { detectDriftTrends } from "../reliability/driftTrendDetector";
import {
  buildDriftSignal,
  buildRunRecord,
  buildSelectorHealthRecord,
} from "./reliability-intelligence.fixtures";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "drift trend detector marks repeated executable selector drift as degrading",
    run: () => {
      const records = [
        buildRunRecord({
          runId: "run-1",
          selectorHealth: [
            buildSelectorHealthRecord({
              status: "HEALTHY",
            }),
          ],
          driftSignals: [
            buildDriftSignal({
              timestamp: "2026-03-25T00:00:00.000Z",
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
          driftSignals: [],
        }),
        buildRunRecord({
          runId: "run-3",
          timestamp: "2026-03-25T02:00:00.000Z",
          selectorHealth: [
            buildSelectorHealthRecord({
              status: "MISSING",
              matchedCount: 0,
            }),
          ],
          driftSignals: [
            buildDriftSignal({
              timestamp: "2026-03-25T02:00:00.000Z",
            }),
            buildDriftSignal({
              timestamp: "2026-03-25T02:00:01.000Z",
            }),
          ],
        }),
      ];

      const trends = detectDriftTrends(records);

      assert.equal(trends.length, 1);
      assert.equal(trends[0].trend, "DEGRADING");
      assert.equal(trends[0].previousCount, 1);
      assert.equal(trends[0].recentCount, 2);
      assert.ok(trends[0].recentDriftRate > trends[0].previousDriftRate);
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`drift-trend tests passed: ${passed}/${tests.length}`);
