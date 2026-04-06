import assert from "node:assert/strict";
import { scoreActionReliability } from "../reliability/actionReliabilityScorer";
import { detectReliabilityAnomalies } from "../reliability/anomalyDetector";
import { buildDocumentKindReliability } from "../reliability/documentKindReliability";
import { detectDriftTrends } from "../reliability/driftTrendDetector";
import { scoreSelectorStability } from "../reliability/selectorStabilityScorer";
import {
  buildDriftSignal,
  buildRunRecord,
  buildSelectorHealthRecord,
} from "./reliability-intelligence.fixtures";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "anomaly detector raises explainable anomalies for verification drop and selector failure",
    run: () => {
      const records = [
        buildRunRecord({
          runId: "run-1",
          reliabilitySummary: {
            extractionSuccessRate: 1,
            writeVerificationRate: 1,
            workflowStepVerificationRate: 1,
            blockedVsFailed: { blocked: 0, failed: 0 },
            selectorMissingByDocumentKind: [],
            ambiguousSelectorByAction: [],
            driftSignalsByType: [],
            supportDispositionCounts: [],
          },
          selectorHealth: [
            buildSelectorHealthRecord({ status: "HEALTHY" }),
          ],
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
        }),
        buildRunRecord({
          runId: "run-2",
          timestamp: "2026-03-25T01:00:00.000Z",
          reliabilitySummary: {
            extractionSuccessRate: 1,
            writeVerificationRate: 0.4,
            workflowStepVerificationRate: 0.5,
            blockedVsFailed: { blocked: 2, failed: 1 },
            selectorMissingByDocumentKind: [{ key: "VISIT_NOTE", count: 1 }],
            ambiguousSelectorByAction: [],
            driftSignalsByType: [{ key: "SELECTOR_MISSING", count: 2 }],
            supportDispositionCounts: [{ key: "EXECUTABLE", count: 2 }],
          },
          selectorHealth: [
            buildSelectorHealthRecord({ status: "MISSING", matchedCount: 0 }),
            buildSelectorHealthRecord({ status: "AMBIGUOUS", matchedCount: 2 }),
          ],
          driftSignals: [
            buildDriftSignal({ timestamp: "2026-03-25T01:00:00.000Z" }),
          ],
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
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "VERIFICATION_FAILED",
              mode: "EXECUTE",
              verificationPassed: false,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: ["POST_WRITE_VERIFICATION_FAILED"],
            },
          ],
        }),
        buildRunRecord({
          runId: "run-3",
          timestamp: "2026-03-25T02:00:00.000Z",
          reliabilitySummary: {
            extractionSuccessRate: 1,
            writeVerificationRate: 0.3,
            workflowStepVerificationRate: 0.3,
            blockedVsFailed: { blocked: 2, failed: 1 },
            selectorMissingByDocumentKind: [{ key: "VISIT_NOTE", count: 2 }],
            ambiguousSelectorByAction: [],
            driftSignalsByType: [{ key: "SELECTOR_MISSING", count: 2 }],
            supportDispositionCounts: [{ key: "EXECUTABLE", count: 2 }],
          },
          selectorHealth: [
            buildSelectorHealthRecord({ status: "MISSING", matchedCount: 0 }),
            buildSelectorHealthRecord({ status: "MISSING", matchedCount: 0 }),
          ],
          driftSignals: [
            buildDriftSignal({ timestamp: "2026-03-25T02:00:00.000Z" }),
            buildDriftSignal({ timestamp: "2026-03-25T02:00:01.000Z" }),
            buildDriftSignal({ timestamp: "2026-03-25T02:00:02.000Z" }),
          ],
          writeOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "FAILED",
              mode: "EXECUTE",
              verificationPassed: false,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: [],
            },
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "VERIFICATION_FAILED",
              mode: "EXECUTE",
              verificationPassed: false,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: ["POST_WRITE_VERIFICATION_FAILED"],
            },
          ],
        }),
        buildRunRecord({
          runId: "run-4",
          timestamp: "2026-03-25T03:00:00.000Z",
          reliabilitySummary: {
            extractionSuccessRate: 1,
            writeVerificationRate: 0.2,
            workflowStepVerificationRate: 0.2,
            blockedVsFailed: { blocked: 2, failed: 2 },
            selectorMissingByDocumentKind: [{ key: "VISIT_NOTE", count: 2 }],
            ambiguousSelectorByAction: [],
            driftSignalsByType: [{ key: "SELECTOR_MISSING", count: 3 }],
            supportDispositionCounts: [{ key: "EXECUTABLE", count: 3 }],
          },
          selectorHealth: [
            buildSelectorHealthRecord({ status: "MISSING", matchedCount: 0 }),
            buildSelectorHealthRecord({ status: "AMBIGUOUS", matchedCount: 2 }),
          ],
          driftSignals: [
            buildDriftSignal({ timestamp: "2026-03-25T03:00:00.000Z" }),
            buildDriftSignal({ timestamp: "2026-03-25T03:00:01.000Z" }),
            buildDriftSignal({ timestamp: "2026-03-25T03:00:02.000Z" }),
          ],
          writeOutcomes: [
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "FAILED",
              mode: "EXECUTE",
              verificationPassed: false,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: [],
            },
            {
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              status: "VERIFICATION_FAILED",
              mode: "EXECUTE",
              verificationPassed: false,
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Executable allowlist entry.",
              contributesToReliability: true,
              guardFailures: ["POST_WRITE_VERIFICATION_FAILED"],
            },
          ],
        }),
      ];

      const selectorStability = scoreSelectorStability(records);
      const actionReliability = scoreActionReliability(records);
      const documentReliability = buildDocumentKindReliability(records, selectorStability);
      const driftTrends = detectDriftTrends(records);
      const anomalies = detectReliabilityAnomalies({
        records,
        selectorStability,
        actionReliability,
        documentReliability,
        driftTrends,
      });

      assert.ok(anomalies.some((anomaly) => anomaly.type === "DROP_IN_VERIFICATION_RATE"));
      assert.ok(anomalies.some((anomaly) => anomaly.type === "SUDDEN_SELECTOR_FAILURE"));
      assert.ok(anomalies.some((anomaly) => anomaly.type === "SPIKE_IN_DRIFT_SIGNALS"));
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`anomaly-detector tests passed: ${passed}/${tests.length}`);
