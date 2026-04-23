import assert from "node:assert/strict";
import { finalizeQueueQaRunReport } from "../reporting/qaRunReporter";
import {
  clearRunHistory,
  getLatestRunReliabilityRecord,
  listRunHistoryRecords,
  recordRunReliabilityReport,
} from "../reliability/runHistoryCollector";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "run history collector upserts by runId and preserves per-run policy snapshot metadata",
    run: () => {
      clearRunHistory();

      const firstReport = finalizeQueueQaRunReport({
        runId: "run-history-1",
        startedAt: "2026-03-25T00:00:00.000Z",
        completedAt: "2026-03-25T00:05:00.000Z",
        queueUrl: "https://portal.example/qa",
        pagesProcessed: 1,
        resumeUsed: false,
        options: {
          startPage: 1,
          maxRowsToScan: 5,
          maxPages: 1,
          maxTargetNotesToProcess: 1,
          includeNonTargetsInReport: true,
          captureSectionSamples: false,
          stopOnFirstFailure: false,
          revisitQueueBetweenRows: true,
          debug: false,
          startRowIndex: 0,
        },
        results: [],
        exportArtifacts: {
          jsonPath: null,
          csvPath: null,
          statePath: null,
        },
        dedupe: {
          processedFingerprintCount: 0,
          duplicateRowsSkipped: 0,
        },
        runtimeConfigSnapshot: {
          safetyMode: "CONTROLLED_WRITE",
          capturedAt: "2026-03-25T00:05:00.000Z",
          readOnlyEnforced: false,
          writeMode: "EXECUTE",
          workflowMode: "EXECUTE",
          writesEnabled: true,
          workflowEnabled: true,
          dryRun: false,
          dangerousControlDetections: 0,
          maxWritesPerRun: 5,
          maxWorkflowStepsPerRun: 3,
          allowedWriteTargetFields: ["frequencySummary"],
          allowedWorkflowActions: ["SAVE_PAGE"],
          restrictWriteDocumentKinds: [],
          restrictWorkflowDocumentKinds: [],
          requireOperatorCheckpointFor: [],
        },
      });

      const secondReport = {
        ...firstReport,
        completedAt: "2026-03-25T00:06:00.000Z",
      };

      recordRunReliabilityReport(firstReport);
      recordRunReliabilityReport(secondReport);

      const records = listRunHistoryRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].policySnapshot.storageKind, "IN_MEMORY");
      assert.equal(records[0].policySnapshot.persistent, false);
      assert.equal(records[0].policySnapshot.runtimeConfigSnapshot?.writeMode, "EXECUTE");
      assert.ok(records[0].policySnapshot.systemSupportSnapshot);

      records[0].policySnapshot.storageKind = "MUTATED";
      assert.equal(getLatestRunReliabilityRecord()?.policySnapshot.storageKind, "IN_MEMORY");
      assert.equal(getLatestRunReliabilityRecord()?.timestamp, "2026-03-25T00:06:00.000Z");
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`run-history-collector tests passed: ${passed}/${tests.length}`);
