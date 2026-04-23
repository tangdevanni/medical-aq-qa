import assert from "node:assert/strict";
import { type QaDecision } from "@medical-ai-qa/shared-types";
import { evaluateWriteGuards } from "../writes/writeGuardEvaluator";
import { resolveWriteExecutionConfig } from "../writes/writeExecutionConfig";

function buildDecision(input?: Partial<QaDecision>): QaDecision {
  return {
    ...baseDecision(),
    ...input,
    proposedAction: {
      ...baseDecision().proposedAction,
      ...input?.proposedAction,
    },
  };
}

function baseDecision(): QaDecision {
  return {
    decisionType: "PROPOSE_UPDATE" as const,
    issueType: "FREQUENCY_MISMATCH" as const,
    actionability: "ACTIONABLE" as const,
    autoFixEligibility: "SAFE_AUTOFIX_CANDIDATE" as const,
    confidence: "HIGH" as const,
    sourceOfTruth: {
      sourceDocumentKind: "PLAN_OF_CARE" as const,
      targetDocumentKind: "VISIT_NOTE" as const,
      confidence: "HIGH" as const,
      reason: "source",
    },
    proposedAction: {
      targetDocumentKind: "VISIT_NOTE" as const,
      targetField: "frequencySummary",
      action: "UPDATE_FIELD" as const,
      proposedValue: "PT twice weekly",
      changeStrategy: "REPLACE" as const,
    },
    reason: "reason",
    evidence: {
      sourceAnchors: [],
      targetAnchors: [],
      warningCodes: [],
    },
    humanReviewReasons: [],
  };
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "allowlist permits high-confidence visit-note frequency updates",
    run: () => {
      const result = evaluateWriteGuards({
        decision: buildDecision(),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
      });

      assert.equal(result.eligible, true);
      assert.equal(result.reasons.length, 0);
    },
  },
  {
    name: "guards block non-safe decisions",
    run: () => {
      const result = evaluateWriteGuards({
        decision: buildDecision({
          autoFixEligibility: "MANUAL_REVIEW_REQUIRED",
        }),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reasons.includes("DECISION_NOT_SAFE_AUTOFIX"), true);
    },
  },
  {
    name: "guards block low bundle confidence",
    run: () => {
      const result = evaluateWriteGuards({
        decision: buildDecision(),
        bundleConfidence: "MEDIUM",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reasons.includes("LOW_BUNDLE_CONFIDENCE"), true);
    },
  },
  {
    name: "guards reject unsupported fields",
    run: () => {
      const result = evaluateWriteGuards({
        decision: buildDecision({
          proposedAction: {
            ...baseDecision().proposedAction,
            targetField: "diagnosisSummary",
          },
        }),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reasons.includes("TARGET_FIELD_NOT_ALLOWLISTED"), true);
    },
  },
  {
    name: "guards reject overlength proposed values with a precise failure reason",
    run: () => {
      const result = evaluateWriteGuards({
        decision: buildDecision({
          proposedAction: {
            ...baseDecision().proposedAction,
            proposedValue: "PT frequency twice weekly with extended unsupported wording",
          },
        }),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reasons.includes("PROPOSED_VALUE_TOO_LONG"), true);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`write-guard-evaluator tests passed: ${passed}/${tests.length}`);
