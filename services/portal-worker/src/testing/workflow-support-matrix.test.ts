import assert from "node:assert/strict";
import { getWorkflowSupport } from "../workflows/workflowSupportMatrix";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "visit note frequency workflow remains save-capable and validate review-gated",
    run: () => {
      const result = getWorkflowSupport({
        documentKind: "VISIT_NOTE",
        targetField: "frequencySummary",
      });

      assert.equal(result.documentFamily, "VISIT_NOTE");
      assert.equal(result.supportLevel, "REVIEW_GATED");
      assert.deepEqual(result.allowedActions, ["SAVE_PAGE"]);
      assert.deepEqual(result.reviewGatedActions, ["VALIDATE_PAGE"]);
      assert.deepEqual(result.blockedActions, ["LOCK_RECORD", "MARK_QA_COMPLETE"]);
    },
  },
  {
    name: "oasis workflow is review-gated with no executable actions",
    run: () => {
      const result = getWorkflowSupport({
        documentKind: "OASIS",
        targetField: "frequencySummary",
      });

      assert.equal(result.documentFamily, "OASIS");
      assert.equal(result.supportLevel, "REVIEW_GATED");
      assert.deepEqual(result.allowedActions, []);
      assert.deepEqual(result.reviewGatedActions, ["SAVE_PAGE", "VALIDATE_PAGE"]);
      assert.equal(result.dryRunOnly, true);
      assert.equal(result.operatorCheckpointRequired, true);
    },
  },
  {
    name: "plan of care workflow exposes save-only execution support",
    run: () => {
      const result = getWorkflowSupport({
        documentKind: "PLAN_OF_CARE",
        targetField: "frequencySummary",
      });

      assert.equal(result.documentFamily, "PLAN_OF_CARE");
      assert.equal(result.supportLevel, "SAVE_ONLY");
      assert.deepEqual(result.allowedActions, ["SAVE_PAGE"]);
      assert.deepEqual(result.executableActions, ["SAVE_PAGE"]);
      assert.deepEqual(result.reviewGatedActions, ["VALIDATE_PAGE"]);
    },
  },
  {
    name: "order-family workflows are planned-only until selectors are proven",
    run: () => {
      const result = getWorkflowSupport({
        documentKind: "ADMISSION_ORDER",
        targetField: "orderSummary",
      });

      assert.equal(result.documentFamily, "ORDER_FAMILY");
      assert.equal(result.supportLevel, "PLANNED_ONLY");
      assert.deepEqual(result.allowedActions, []);
      assert.equal(result.dryRunOnly, true);
      assert.deepEqual(result.blockedActions, [
        "SAVE_PAGE",
        "VALIDATE_PAGE",
        "LOCK_RECORD",
        "MARK_QA_COMPLETE",
      ]);
    },
  },
  {
    name: "unknown document kind-target pairs stay explicitly unsupported",
    run: () => {
      const result = getWorkflowSupport({
        documentKind: "PLAN_OF_CARE",
        targetField: "homeboundSummary",
      });

      assert.equal(result.supportLevel, "NOT_SUPPORTED");
      assert.equal(result.reason.includes("No explicit workflow policy"), true);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`workflow-support-matrix tests passed: ${passed}/${tests.length}`);
