import assert from "node:assert/strict";
import { scoreActionReliability } from "../reliability/actionReliabilityScorer";
import { buildRunRecord } from "./reliability-intelligence.fixtures";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "action reliability excludes review-gated paths and counts only executable execution-path outcomes",
    run: () => {
      const records = [
        buildRunRecord({
          runId: "run-1",
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
            {
              documentKind: "OASIS",
              targetField: "frequencySummary",
              status: "BLOCKED",
              mode: "DRY_RUN",
              verificationPassed: false,
              supportDisposition: "DRY_RUN_ONLY",
              supportClassificationSource: "WRITE_ALLOWLIST",
              supportClassificationReason: "Dry-run-only allowlist entry.",
              contributesToReliability: false,
              guardFailures: ["WRITE_MODE_DRY_RUN"],
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
            {
              documentKind: "OASIS",
              action: "SAVE_PAGE",
              targetField: "frequencySummary",
              status: "BLOCKED",
              verificationPassed: false,
              supportLevel: "REVIEW_GATED",
              supportDisposition: "REVIEW_GATED",
              supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX",
              supportClassificationReason: "Review-gated workflow action.",
              contributesToReliability: false,
              guardFailures: ["SUPPORT_LEVEL_REVIEW_GATED"],
            },
          ],
        }),
        buildRunRecord({
          runId: "run-2",
          timestamp: "2026-03-25T01:00:00.000Z",
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
              status: "FAILED",
              verificationPassed: false,
              supportLevel: "REVIEW_GATED",
              supportDisposition: "EXECUTABLE",
              supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX",
              supportClassificationReason: "Executable workflow action.",
              contributesToReliability: true,
              guardFailures: ["POST_STEP_VERIFICATION_FAILED"],
            },
          ],
        }),
      ];

      const scores = scoreActionReliability(records);
      const writeScore = scores.find((score) =>
        score.action === "WRITE_FIELD" && score.documentKind === "VISIT_NOTE"
      );
      const saveScore = scores.find((score) =>
        score.action === "SAVE_PAGE" && score.documentKind === "VISIT_NOTE"
      );

      assert.ok(writeScore);
      assert.equal(writeScore.attempts, 1);
      assert.equal(writeScore.verifiedSuccessCount, 1);
      assert.equal(writeScore.blockedCount, 1);
      assert.equal(writeScore.excludedObservationCount, 0);
      assert.equal(writeScore.successRate, 1);

      assert.ok(saveScore);
      assert.equal(saveScore.attempts, 2);
      assert.equal(saveScore.verifiedSuccessCount, 1);
      assert.equal(saveScore.failureCount, 1);
      assert.equal(saveScore.excludedObservationCount, 0);
      assert.equal(saveScore.successRate, 0.5);
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`action-reliability tests passed: ${passed}/${tests.length}`);
