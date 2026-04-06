import assert from "node:assert/strict";
import { buildReliabilitySnapshot } from "../reliability/reliabilitySnapshotBuilder";
import {
  buildDriftSignal,
  buildExecutionTraceEvent,
  buildRunRecord,
  buildSelectorHealthRecord,
  buildSupportMatrixDiagnostic,
} from "./reliability-intelligence.fixtures";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "reliability snapshot aggregates recent run history into dashboard-ready output",
    run: () => {
      const records = [
        buildRunRecord({
          runId: "run-1",
          timestamp: "2026-03-25T00:00:00.000Z",
          selectorHealth: [buildSelectorHealthRecord({ status: "HEALTHY" })],
          driftSignals: [],
          executionTrace: [buildExecutionTraceEvent()],
          supportMatrixDiagnostics: [buildSupportMatrixDiagnostic()],
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
          selectorHealth: [buildSelectorHealthRecord({ status: "MISSING", matchedCount: 0 })],
          driftSignals: [buildDriftSignal({ timestamp: "2026-03-25T01:00:00.000Z" })],
          executionTrace: [buildExecutionTraceEvent({ status: "WARNING", event: "SELECTOR_MISSING" })],
          supportMatrixDiagnostics: [buildSupportMatrixDiagnostic()],
          writeOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "BLOCKED",
              mode: "EXECUTE",
              verificationPassed: false,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: ["TARGET_SELECTOR_NOT_FOUND", "EXECUTABLE_CONTROL_MISSING"],
            },
          ],
          workflowStepOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              action: "SAVE_PAGE",
              targetField: "frequencySummary",
              status: "BLOCKED",
              verificationPassed: false,
              supportLevel: "REVIEW_GATED",
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX",
              supportClassificationReason: "Executable workflow action.",
              contributesToReliability: true,
              guardFailures: ["EXECUTABLE_CONTROL_MISSING"],
            },
          ],
        }),
      ];

      const snapshot = buildReliabilitySnapshot({
        records,
        maxRuns: 2,
        timestamp: "2026-03-25T02:00:00.000Z",
      });

      assert.equal(snapshot.aggregationWindow.runsConsidered, 2);
      assert.equal(snapshot.selectorStability.length, 1);
      assert.ok(snapshot.actionReliability.length >= 2);
      assert.equal(snapshot.documentReliability[0]?.documentKind, "VISIT_NOTE");
      assert.equal(snapshot.timestamp, "2026-03-25T02:00:00.000Z");
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`reliability-snapshot tests passed: ${passed}/${tests.length}`);
