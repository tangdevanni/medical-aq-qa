import assert from "node:assert/strict";
import { buildReliabilitySnapshot } from "../reliability/reliabilitySnapshotBuilder";
import { classifyOverallSystemHealth } from "../reliability/systemHealthClassifier";
import { buildRunRecord, buildSelectorHealthRecord } from "./reliability-intelligence.fixtures";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "system health stays stable when executable paths remain healthy",
    run: () => {
      const records = [
        buildRunRecord({
          runId: "run-1",
          selectorHealth: [buildSelectorHealthRecord({ status: "HEALTHY" })],
          writeOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "VERIFIED",
              mode: "EXECUTE",
              verificationPassed: true,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: [],
            },
          ],
          workflowStepOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              action: "SAVE_PAGE",
              targetField: "frequencySummary",
              status: "VERIFIED",
              verificationPassed: true,
              supportLevel: "REVIEW_GATED",
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX",
              supportClassificationReason: "Executable workflow action.",
              contributesToReliability: true,
              guardFailures: [],
            },
          ],
        }),
        buildRunRecord({
          runId: "run-2",
          timestamp: "2026-03-25T01:00:00.000Z",
          selectorHealth: [buildSelectorHealthRecord({ status: "HEALTHY" })],
          writeOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "VERIFIED",
              mode: "EXECUTE",
              verificationPassed: true,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: [],
            },
          ],
          workflowStepOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              action: "SAVE_PAGE",
              targetField: "frequencySummary",
              status: "VERIFIED",
              verificationPassed: true,
              supportLevel: "REVIEW_GATED",
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX",
              supportClassificationReason: "Executable workflow action.",
              contributesToReliability: true,
              guardFailures: [],
            },
          ],
        }),
        buildRunRecord({
          runId: "run-3",
          timestamp: "2026-03-25T02:00:00.000Z",
          selectorHealth: [buildSelectorHealthRecord({ status: "HEALTHY" })],
          writeOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "VERIFIED",
              mode: "EXECUTE",
              verificationPassed: true,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: [],
            },
          ],
          workflowStepOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              action: "SAVE_PAGE",
              targetField: "frequencySummary",
              status: "VERIFIED",
              verificationPassed: true,
              supportLevel: "REVIEW_GATED",
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX",
              supportClassificationReason: "Executable workflow action.",
              contributesToReliability: true,
              guardFailures: [],
            },
          ],
        }),
      ];

      const snapshot = buildReliabilitySnapshot({ records });
      const health = classifyOverallSystemHealth({
        selectorStability: snapshot.selectorStability,
        actionReliability: snapshot.actionReliability,
        documentReliability: snapshot.documentReliability,
        driftTrends: snapshot.driftTrends,
        anomalies: snapshot.anomalies,
      });

      assert.equal(snapshot.overallSystemHealth, "STABLE");
      assert.equal(health, "STABLE");
      assert.equal(snapshot.anomalies.length, 0);
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`system-health tests passed: ${passed}/${tests.length}`);
