import assert from "node:assert/strict";
import { buildReliabilitySummary } from "../observability/reliabilitySummaryBuilder";
import { collectRunDiagnostics } from "../observability/runDiagnosticsCollector";
import { type QueueQaRowProcessResult } from "../types/queueQaPipeline";

function buildProcessedRow(overrides: Partial<Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>> = {}): Extract<QueueQaRowProcessResult, { status: "PROCESSED" }> {
  return {
    rowIndex: 0,
    rowFingerprint: "row-1",
    classification: { isTarget: true, confidence: "high", reason: "matched" },
    queueContext: {
      pageNumber: 1,
      patientDisplayNameMasked: null,
      documentDesc: "Visit Note",
      type: "Therapy Visit Note",
      date: null,
      physician: null,
      documentType: "VISIT_NOTE",
      availableActions: [],
      queueUrl: "https://example.test/document-tracking?page=forQA",
    },
    openResult: {
      success: true,
      openedUrl: "https://example.test/documents/note/visitnote/123",
      openedInNewTab: true,
    },
    documentExtraction: {
      documentKind: "VISIT_NOTE",
      pageType: "visit_note",
      url: "https://example.test/documents/note/visitnote/123",
      extractedAt: "2026-03-25T00:00:00.000Z",
      metadata: {
        pageTitle: "Visit Note",
        documentLabel: "Visit Note",
        patientMaskedId: null,
        visitDate: null,
        physician: null,
        signedState: null,
        diagnosisSummary: null,
        frequencySummary: null,
        homeboundSummary: null,
        orderSummary: null,
      },
      sections: [],
      warnings: [],
    },
    crossDocumentQa: {
      bundleConfidence: "HIGH",
      bundleReason: "matched",
      mismatches: [],
      alignments: [],
      warnings: [],
    },
    qaResult: null,
    decisionResult: {
      decisions: [],
      warnings: [],
      summary: {
        actionableCount: 0,
        reviewOnlyCount: 0,
        notActionableCount: 0,
        safeAutofixCandidateCount: 0,
        manualReviewRequiredCount: 0,
        issuesByType: {},
        decisionsByTargetDocument: {},
      },
    },
    writeExecutionResult: {
      attempted: true,
      results: [],
      summary: {
        writeAttempts: 1,
        writesExecuted: 1,
        writesVerified: 1,
        writesBlocked: 0,
        writesSkipped: 0,
        writeFailures: 0,
        verificationFailures: 0,
        dryRunCount: 0,
        topGuardFailureReasons: [],
      },
    },
    workflowSupport: {
      documentKind: "VISIT_NOTE",
      documentFamily: "VISIT_NOTE",
      targetField: "frequencySummary",
      supportLevel: "REVIEW_GATED",
      allowedActions: ["SAVE_PAGE"],
      executableActions: ["SAVE_PAGE"],
      reviewGatedActions: ["VALIDATE_PAGE"],
      blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"],
      requiresVerifiedWrite: true,
      operatorCheckpointRequired: true,
      checkpointCategories: ["PRE_VALIDATE_REVIEW"],
      dryRunOnly: false,
      reason: "Visit-note frequency updates can save in place, but validation remains review-gated.",
    },
    workflowCompletionResult: {
      attempted: true,
      status: "REVIEW_REQUIRED",
      mode: "EXECUTE",
      eligibility: "REVIEW_REQUIRED",
      documentKind: "VISIT_NOTE",
      targetField: "frequencySummary",
      workflowSupport: {
        documentKind: "VISIT_NOTE",
        documentFamily: "VISIT_NOTE",
        targetField: "frequencySummary",
        supportLevel: "REVIEW_GATED",
        allowedActions: ["SAVE_PAGE"],
        executableActions: ["SAVE_PAGE"],
        reviewGatedActions: ["VALIDATE_PAGE"],
        blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"],
        requiresVerifiedWrite: true,
        operatorCheckpointRequired: true,
        checkpointCategories: ["PRE_VALIDATE_REVIEW"],
        dryRunOnly: false,
        reason: "Visit-note frequency updates can save in place, but validation remains review-gated.",
      },
      plan: null,
      steps: [
        {
          action: "SAVE_PAGE",
          status: "VERIFIED",
          mode: "EXECUTE",
          attempted: true,
          selectorUsed: "button[data-testid=\"visit-note-save\"]",
          verificationPassed: true,
          guardFailures: [],
          warnings: [],
          snapshotBefore: null,
          snapshotAfter: null,
          executedAt: "2026-03-25T00:00:00.000Z",
          verifiedAt: "2026-03-25T00:00:01.000Z",
        },
      ],
      operatorCheckpoint: null,
      guardFailures: [],
      warnings: [],
      audit: {
        executedAt: "2026-03-25T00:00:00.000Z",
        bundleConfidence: "HIGH",
        decisionConfidence: "HIGH",
        sourceWriteStatus: "VERIFIED",
      },
    },
    runtimeDiagnostics: [
      {
        timestamp: "2026-03-25T00:00:00.000Z",
        severity: "WARNING",
        category: "SUPPORT_MATRIX",
        code: "SUPPORT_LEVEL_BLOCKED",
        message: "VALIDATE_PAGE is intentionally review-gated for this document kind and target field.",
        phase: "WORKFLOW_GUARD",
        documentKind: "VISIT_NOTE",
        action: "VALIDATE_PAGE",
        targetField: "frequencySummary",
        selectorName: null,
        supportLevel: "REVIEW_GATED",
        supportDisposition: "REVIEW_GATED",
      },
    ],
    selectorHealth: [
      {
        name: "VISIT_NOTE.SAVE_PAGE.workflowAction",
        documentKind: "VISIT_NOTE",
        phase: "WORKFLOW_EXECUTION",
        action: "SAVE_PAGE",
        targetField: "frequencySummary",
        required: true,
        expectedCardinality: "ONE",
        status: "MISSING",
        matchedCount: 0,
        selectorUsed: null,
        supportLevel: "REVIEW_GATED",
        supportDisposition: "EXECUTABLE",
        reason: "Required selector did not resolve.",
      },
    ],
    driftSignals: [
      {
        timestamp: "2026-03-25T00:00:00.000Z",
        type: "SELECTOR_MISSING",
        severity: "ERROR",
        documentKind: "VISIT_NOTE",
        selectorName: "VISIT_NOTE.SAVE_PAGE.workflowAction",
        action: "SAVE_PAGE",
        targetField: "frequencySummary",
        supportLevel: "REVIEW_GATED",
        supportDisposition: "EXECUTABLE",
        routePath: "/documents/note/visitnote/123",
        reason: "Expected executable selector missing for VISIT_NOTE.SAVE_PAGE.workflowAction.",
      },
    ],
    retryAttempts: [
      {
        timestamp: "2026-03-25T00:00:00.000Z",
        policyName: "SELECTOR_RESOLUTION",
        operation: "resolve-workflow-action:SAVE_PAGE",
        phase: "WORKFLOW_EXECUTION",
        attemptNumber: 1,
        maxAttempts: 3,
        delayMs: 150,
        outcome: "RETRYING",
        retryable: true,
        reasonCode: "SELECTOR_NOT_YET_RENDERED",
        documentKind: "VISIT_NOTE",
        action: "SAVE_PAGE",
        targetField: "frequencySummary",
      },
    ],
    executionTrace: [
      {
        timestamp: "2026-03-25T00:00:00.000Z",
        phase: "WORKFLOW_EXECUTION",
        event: "WORKFLOW_COMPLETED",
        status: "WARNING",
        documentKind: "VISIT_NOTE",
        action: null,
        targetField: "frequencySummary",
        selectorName: null,
        supportDisposition: null,
        detail: "Workflow completion ended with status REVIEW_REQUIRED.",
      },
    ],
    supportMatrixDiagnostics: [
      {
        timestamp: "2026-03-25T00:00:00.000Z",
        documentKind: "VISIT_NOTE",
        targetField: "frequencySummary",
        action: "VALIDATE_PAGE",
        supportLevel: "REVIEW_GATED",
        supportDisposition: "REVIEW_GATED",
        driftEligible: false,
        reason: "VALIDATE_PAGE is intentionally review-gated for this document kind and target field.",
      },
    ],
    status: "PROCESSED",
    ...overrides,
  };
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "buildReliabilitySummary counts selector drift and support dispositions",
    run: () => {
      const summary = buildReliabilitySummary([buildProcessedRow()]);

      assert.equal(summary.extractionSuccessRate, 1);
      assert.equal(summary.writeVerificationRate, 1);
      assert.equal(summary.workflowStepVerificationRate, 1);
      assert.deepEqual(summary.selectorMissingByDocumentKind, [
        { key: "VISIT_NOTE", count: 1 },
      ]);
      assert.deepEqual(summary.driftSignalsByType, [
        { key: "SELECTOR_MISSING", count: 1 },
      ]);
      assert.deepEqual(summary.supportDispositionCounts, [
        { key: "REVIEW_GATED", count: 1 },
      ]);
    },
  },
  {
    name: "collectRunDiagnostics aggregates retries, selector health, drift, and trace stats",
    run: () => {
      const diagnostics = collectRunDiagnostics([buildProcessedRow()]);

      assert.equal(diagnostics.diagnosticsSummary.totalDiagnostics, 1);
      assert.equal(diagnostics.diagnosticsSummary.retryStats.totalRecords, 1);
      assert.equal(diagnostics.selectorHealthSummary.totalChecks, 1);
      assert.equal(diagnostics.driftSignalSummary.totalSignals, 1);
      assert.equal(diagnostics.traceStats.totalEvents, 1);
    },
  },
];

let passed = 0;

for (const entry of tests) {
  entry.run();
  passed += 1;
}

console.log(`reliability-summary tests passed: ${passed}/${tests.length}`);
