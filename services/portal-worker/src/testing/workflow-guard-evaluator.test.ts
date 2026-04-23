import assert from "node:assert/strict";
import {
  type DocumentKind,
  type QaDecision,
  type QaDecisionResult,
  type WriteExecutionResult,
} from "@medical-ai-qa/shared-types";
import { resolveWorkflowExecutionConfig } from "../workflows/workflowExecutionConfig";
import { evaluateWorkflowGuards } from "../workflows/workflowGuardEvaluator";

function buildDecisionResult(input?: {
  targetDocumentKind?: DocumentKind;
  targetField?: string;
  humanReviewReasons?: QaDecision["humanReviewReasons"];
}): QaDecisionResult {
  const targetDocumentKind = input?.targetDocumentKind ?? "VISIT_NOTE";
  const targetField = input?.targetField ?? "frequencySummary";
  const humanReviewReasons = input?.humanReviewReasons ?? [];

  return {
    decisions: [
      {
        decisionType: "PROPOSE_UPDATE",
        issueType: "FREQUENCY_MISMATCH",
        actionability: "ACTIONABLE",
        autoFixEligibility: "SAFE_AUTOFIX_CANDIDATE",
        confidence: "HIGH",
        sourceOfTruth: {
          sourceDocumentKind: "PLAN_OF_CARE",
          targetDocumentKind,
          confidence: "HIGH",
          reason: "source",
        },
        proposedAction: {
          targetDocumentKind,
          targetField,
          action: "UPDATE_FIELD",
          proposedValue: "PT twice weekly",
          changeStrategy: "REPLACE",
        },
        reason: "reason",
        evidence: {
          sourceAnchors: [],
          targetAnchors: [],
          warningCodes: [],
        },
        humanReviewReasons,
      },
    ],
    warnings: [],
    summary: {
      actionableCount: 1,
      reviewOnlyCount: 0,
      notActionableCount: 0,
      safeAutofixCandidateCount: 1,
      manualReviewRequiredCount: humanReviewReasons.length ? 1 : 0,
      issuesByType: {
        FREQUENCY_MISMATCH: 1,
      },
      decisionsByTargetDocument: {
        [targetDocumentKind]: 1,
      },
    },
  };
}

function buildWriteExecutionResult(
  status: "VERIFIED" | "SKIPPED",
  bundleConfidence: "LOW" | "MEDIUM" | "HIGH" = "HIGH",
  input?: {
    targetDocumentKind?: DocumentKind;
    targetField?: string;
  },
): WriteExecutionResult {
  const targetDocumentKind = input?.targetDocumentKind ?? "VISIT_NOTE";
  const targetField = input?.targetField ?? "frequencySummary";

  return {
    attempted: true,
    results: [
      {
        status,
        mode: "EXECUTE",
        eligibility: status === "VERIFIED" ? "ELIGIBLE" : "REVIEW_REQUIRED",
        decisionType: "PROPOSE_UPDATE",
        issueType: "FREQUENCY_MISMATCH",
        targetDocumentKind,
        targetField,
        selectorUsed: "textarea[formcontrolname=\"frequencySummary\"]",
        previousValue: "PT once weekly",
        proposedValue: "PT twice weekly",
        finalValue: status === "VERIFIED" ? "PT twice weekly" : "PT once weekly",
        verificationPassed: status === "VERIFIED",
        guardFailures: status === "VERIFIED" ? [] : ["WRITE_MODE_DRY_RUN"],
        warnings: [],
        audit: {
          executedAt: "2026-03-24T00:00:00.000Z",
          bundleConfidence,
          decisionConfidence: "HIGH",
        },
      },
    ],
    summary: {
      writeAttempts: 1,
      writesExecuted: status === "VERIFIED" ? 1 : 0,
      writesVerified: status === "VERIFIED" ? 1 : 0,
      writesBlocked: 0,
      writesSkipped: status === "SKIPPED" ? 1 : 0,
      writeFailures: 0,
      verificationFailures: 0,
      dryRunCount: status === "SKIPPED" ? 1 : 0,
      topGuardFailureReasons: status === "SKIPPED"
        ? [{ key: "WRITE_MODE_DRY_RUN", count: 1 }]
        : [],
    },
  };
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "workflow blocks when write was not verified",
    run: () => {
      const result = evaluateWorkflowGuards({
        currentDocumentKind: "VISIT_NOTE",
        crossDocumentQa: {
          bundleConfidence: "HIGH",
          bundleReason: "matched",
          mismatches: [],
          alignments: [],
          warnings: [],
        },
        decisionResult: buildDecisionResult(),
        writeExecutionResult: buildWriteExecutionResult("SKIPPED"),
        config: resolveWorkflowExecutionConfig({
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reasons.includes("WRITE_NOT_VERIFIED"), true);
    },
  },
  {
    name: "visit note frequency workflow remains eligible when the verified write is high confidence",
    run: () => {
      const result = evaluateWorkflowGuards({
        currentDocumentKind: "VISIT_NOTE",
        crossDocumentQa: {
          bundleConfidence: "HIGH",
          bundleReason: "matched",
          mismatches: [],
          alignments: [],
          warnings: [],
        },
        decisionResult: buildDecisionResult(),
        writeExecutionResult: buildWriteExecutionResult("VERIFIED"),
        config: resolveWorkflowExecutionConfig({
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.eligible, true);
      assert.equal(result.reasons.length, 0);
      assert.equal(result.workflowSupport.supportLevel, "REVIEW_GATED");
    },
  },
  {
    name: "workflow blocks on low bundle confidence",
    run: () => {
      const result = evaluateWorkflowGuards({
        currentDocumentKind: "VISIT_NOTE",
        crossDocumentQa: {
          bundleConfidence: "MEDIUM",
          bundleReason: "weak",
          mismatches: [],
          alignments: [],
          warnings: [],
        },
        decisionResult: buildDecisionResult(),
        writeExecutionResult: buildWriteExecutionResult("VERIFIED", "MEDIUM"),
        config: resolveWorkflowExecutionConfig({
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reasons.includes("LOW_BUNDLE_CONFIDENCE"), true);
    },
  },
  {
    name: "oasis workflow is review required until selectors are execution-ready",
    run: () => {
      const result = evaluateWorkflowGuards({
        currentDocumentKind: "OASIS",
        crossDocumentQa: {
          bundleConfidence: "HIGH",
          bundleReason: "matched",
          mismatches: [],
          alignments: [],
          warnings: [],
        },
        decisionResult: buildDecisionResult({
          targetDocumentKind: "OASIS",
          targetField: "frequencySummary",
        }),
        writeExecutionResult: buildWriteExecutionResult("VERIFIED", "HIGH", {
          targetDocumentKind: "OASIS",
          targetField: "frequencySummary",
        }),
        config: resolveWorkflowExecutionConfig({
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.eligible, false);
      assert.equal(result.eligibility, "REVIEW_REQUIRED");
      assert.equal(result.reasons.includes("SUPPORT_LEVEL_REVIEW_GATED"), true);
      assert.equal(result.workflowSupport.supportLevel, "REVIEW_GATED");
    },
  },
  {
    name: "planned-only order workflows stay blocked from execution",
    run: () => {
      const result = evaluateWorkflowGuards({
        currentDocumentKind: "ADMISSION_ORDER",
        crossDocumentQa: {
          bundleConfidence: "HIGH",
          bundleReason: "matched",
          mismatches: [],
          alignments: [],
          warnings: [],
        },
        decisionResult: buildDecisionResult({
          targetDocumentKind: "ADMISSION_ORDER",
          targetField: "orderSummary",
        }),
        writeExecutionResult: buildWriteExecutionResult("VERIFIED", "HIGH", {
          targetDocumentKind: "ADMISSION_ORDER",
          targetField: "orderSummary",
        }),
        config: resolveWorkflowExecutionConfig({
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.eligible, false);
      assert.equal(result.eligibility, "REVIEW_REQUIRED");
      assert.equal(result.reasons.includes("SUPPORT_LEVEL_PLANNED_ONLY"), true);
      assert.equal(result.workflowSupport.supportLevel, "PLANNED_ONLY");
    },
  },
  {
    name: "source-of-truth review reasons become explicit workflow guard failures",
    run: () => {
      const result = evaluateWorkflowGuards({
        currentDocumentKind: "OASIS",
        crossDocumentQa: {
          bundleConfidence: "HIGH",
          bundleReason: "matched",
          mismatches: [],
          alignments: [],
          warnings: [],
        },
        decisionResult: buildDecisionResult({
          targetDocumentKind: "OASIS",
          targetField: "frequencySummary",
          humanReviewReasons: ["SOURCE_OF_TRUTH_REVIEW_REQUIRED"],
        }),
        writeExecutionResult: buildWriteExecutionResult("VERIFIED", "HIGH", {
          targetDocumentKind: "OASIS",
          targetField: "frequencySummary",
        }),
        config: resolveWorkflowExecutionConfig({
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.reasons.includes("HUMAN_REVIEW_STILL_REQUIRED"), true);
      assert.equal(result.reasons.includes("SOURCE_OF_TRUTH_REVIEW_REQUIRED"), true);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`workflow-guard-evaluator tests passed: ${passed}/${tests.length}`);
