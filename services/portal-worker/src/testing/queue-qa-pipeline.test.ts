import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportCsvReport } from "../export/exportCsvReport";
import { exportJsonReport } from "../export/exportJsonReport";
import {
  buildQueueQaAuditSummary,
  buildQueueQaRunTotals,
  deriveQueueQaRunOverallStatus,
  finalizeQueueQaRunReport,
} from "../reporting/qaRunReporter";
import {
  classifyQueueRowSnapshot,
  normalizeQueueRowSnapshot,
} from "../pipelines/queueQaPipeline";
import { type QueueQaRowProcessResult, type QueueRowSnapshot } from "../types/queueQaPipeline";

const baseSnapshot: QueueRowSnapshot = {
  pageNumber: 1,
  rowIndex: 3,
  rowFingerprint: "abc123",
  patientDisplayNameMasked: "J*** D***",
  documentDesc: "Visit Note-PT - Visit",
  type: "Therapy Visit Note",
  date: "03/24/2026",
  physician: "D*** S***",
  documentType: "VISIT_NOTE",
  availableActions: [
    {
      label: "View / Edit Note",
      labelSource: "ngbtooltip",
      classification: "NOTE_OPEN_ACTION",
    },
  ],
  queueUrl: "https://example.test/document-tracking?page=forQA",
};

function emptyCrossDocumentQa() {
  return {
    bundleConfidence: "LOW" as const,
    bundleReason: "No comparable documents were available.",
    mismatches: [],
    alignments: [],
    warnings: [],
  };
}

function emptyDecisionResult() {
  return {
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
  };
}

function emptyWriteExecutionResult() {
  return {
    attempted: false,
    results: [],
    summary: {
      writeAttempts: 0,
      writesExecuted: 0,
      writesVerified: 0,
      writesBlocked: 0,
      writesSkipped: 0,
      writeFailures: 0,
      verificationFailures: 0,
      dryRunCount: 0,
      topGuardFailureReasons: [],
    },
  };
}

function emptyWorkflowCompletionResult() {
  return {
    attempted: false,
    status: "BLOCKED" as const,
    mode: "DRY_RUN" as const,
    eligibility: "INELIGIBLE" as const,
    documentKind: null,
    targetField: null,
    workflowSupport: {
      documentKind: null,
      documentFamily: "UNKNOWN" as const,
      targetField: null,
      supportLevel: "NOT_SUPPORTED" as const,
      allowedActions: [],
      executableActions: [],
      reviewGatedActions: [],
      blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"] as Array<
        "SAVE_PAGE" | "VALIDATE_PAGE" | "LOCK_RECORD" | "MARK_QA_COMPLETE"
      >,
      requiresVerifiedWrite: true,
      operatorCheckpointRequired: false,
      checkpointCategories: [],
      dryRunOnly: false,
      reason: "No explicit workflow policy is configured for this document kind and target field.",
    },
    plan: null,
    steps: [],
    operatorCheckpoint: null,
    guardFailures: [],
    warnings: [],
    audit: {
      executedAt: "2026-03-24T00:00:00.000Z",
      bundleConfidence: "LOW" as const,
      decisionConfidence: "LOW" as const,
      sourceWriteStatus: null,
    },
  };
}

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: "classifyQueueRowSnapshot marks visit notes as high confidence targets when desc and type match",
    run: () => {
      const classification = classifyQueueRowSnapshot(baseSnapshot);

      assert.equal(classification.isTarget, true);
      assert.equal(classification.confidence, "high");
    },
  },
  {
    name: "classifyQueueRowSnapshot rejects order rows as high confidence non-targets",
    run: () => {
      const classification = classifyQueueRowSnapshot({
        ...baseSnapshot,
        documentDesc: "Physician Order",
        type: "Order",
        documentType: "ORDER",
      });

      assert.equal(classification.isTarget, false);
      assert.equal(classification.confidence, "high");
    },
  },
  {
    name: "classifyQueueRowSnapshot prefers explicit non-target evidence over a weak visit-note document type hint",
    run: () => {
      const classification = classifyQueueRowSnapshot({
        ...baseSnapshot,
        documentDesc: "Physician Order",
        type: "Order",
        documentType: "VISIT_NOTE",
      });

      assert.equal(classification.isTarget, false);
      assert.equal(classification.confidence, "high");
    },
  },
  {
    name: "classifyQueueRowSnapshot marks wrong opened document routes as non-targets",
    run: () => {
      const classification = classifyQueueRowSnapshot({
        ...baseSnapshot,
        openedUrl: "https://example.test/documents/order/123",
      });

      assert.equal(classification.isTarget, false);
      assert.equal(classification.reason.includes("non-visit-note document route"), true);
    },
  },
  {
    name: "normalizeQueueRowSnapshot adds derived target and skip fields",
    run: () => {
      const normalized = normalizeQueueRowSnapshot({
        ...baseSnapshot,
        documentDesc: "Plan of Care",
        type: "Plan of Care",
        documentType: "PLAN_OF_CARE",
      });

      assert.equal(normalized.isTargetVisitNote, false);
      assert.equal(normalized.skipReason, "NON_TARGET_DOCUMENT_TYPE");
      assert.equal(normalized.targetReason, null);
    },
  },
  {
    name: "buildQueueQaRunTotals aggregates processed, skipped, errors, and QA outcomes",
    run: () => {
      const results: QueueQaRowProcessResult[] = [
        {
          rowIndex: 0,
          rowFingerprint: "processed-pass",
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
            queueUrl: baseSnapshot.queueUrl,
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
            extractedAt: "2026-03-24T00:00:00.000Z",
            metadata: {
              pageTitle: "Therapy Visit Note",
              documentLabel: "Therapy Visit Note",
              patientMaskedId: null,
              visitDate: "03/24/2026",
              physician: null,
              signedState: "signed",
              diagnosisSummary: null,
              frequencySummary: null,
              homeboundSummary: null,
              orderSummary: null,
            },
            sections: [],
            warnings: [],
          },
          crossDocumentQa: emptyCrossDocumentQa(),
          qaResult: {
            pageType: "visit_note",
            url: "https://example.test/documents/note/visitnote/123",
            extractedAt: "2026-03-24T00:00:00.000Z",
            sections: [],
            metadata: {
              noteType: "Therapy Visit Note",
              pageTitle: "Therapy Visit Note",
              documentRoute: "/documents/note/visitnote/123",
              signatureState: "signed",
              visitDate: "03/24/2026",
            },
            rules: [],
            summary: {
              overallStatus: "PASS",
              missingSections: [],
              reviewFlags: [],
              meaningfulSectionCount: 4,
              totalMeaningfulTextLength: 120,
            },
            warnings: [],
          },
          decisionResult: emptyDecisionResult(),
          writeExecutionResult: emptyWriteExecutionResult(),
          workflowSupport: {
            documentKind: "VISIT_NOTE",
            documentFamily: "VISIT_NOTE",
            targetField: null,
            supportLevel: "NOT_SUPPORTED",
            allowedActions: [],
            executableActions: [],
            reviewGatedActions: [],
            blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
            requiresVerifiedWrite: true,
            operatorCheckpointRequired: false,
            checkpointCategories: [],
            dryRunOnly: false,
            reason: "No explicit workflow policy is configured for this document kind and target field.",
          },
          workflowCompletionResult: emptyWorkflowCompletionResult(),
          status: "PROCESSED",
        },
        {
          rowIndex: 1,
          rowFingerprint: "processed-poc",
          classification: { isTarget: false, confidence: "high", reason: "plan of care" },
          queueContext: {
            pageNumber: 1,
            patientDisplayNameMasked: null,
            documentDesc: "Plan of Care",
            type: "Plan of Care",
            date: null,
            physician: null,
            documentType: "PLAN_OF_CARE",
            availableActions: [],
            queueUrl: baseSnapshot.queueUrl,
          },
          openResult: {
            success: true,
            openedUrl: "https://example.test/documents/planofcare/456",
            openedInNewTab: false,
          },
          documentExtraction: {
            documentKind: "PLAN_OF_CARE",
            pageType: "plan_of_care",
            url: "https://example.test/documents/planofcare/456",
            extractedAt: "2026-03-24T00:00:00.000Z",
            metadata: {
              pageTitle: "Plan of Care",
              documentLabel: "Plan of Care",
              patientMaskedId: null,
              visitDate: null,
              physician: "D*** S***",
              signedState: null,
              diagnosisSummary: null,
              frequencySummary: null,
              homeboundSummary: null,
              orderSummary: null,
            },
            sections: [],
            warnings: [],
          },
          crossDocumentQa: emptyCrossDocumentQa(),
          qaResult: null,
          decisionResult: emptyDecisionResult(),
          writeExecutionResult: emptyWriteExecutionResult(),
          workflowSupport: {
            documentKind: "PLAN_OF_CARE",
            documentFamily: "PLAN_OF_CARE",
            targetField: null,
            supportLevel: "NOT_SUPPORTED",
            allowedActions: [],
            executableActions: [],
            reviewGatedActions: [],
            blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
            requiresVerifiedWrite: true,
            operatorCheckpointRequired: false,
            checkpointCategories: [],
            dryRunOnly: false,
            reason: "No explicit workflow policy is configured for this document kind and target field.",
          },
          workflowCompletionResult: emptyWorkflowCompletionResult(),
          status: "PROCESSED",
        },
        {
          rowIndex: 2,
          rowFingerprint: "skipped",
          classification: { isTarget: false, confidence: "high", reason: "order" },
          queueContext: {
            pageNumber: 1,
            patientDisplayNameMasked: null,
            documentDesc: "Order",
            type: "Order",
            date: null,
            physician: null,
            documentType: "ORDER",
            availableActions: [],
            queueUrl: baseSnapshot.queueUrl,
          },
          status: "SKIPPED",
          skipReason: "NON_TARGET_DOCUMENT_TYPE",
        },
        {
          rowIndex: 3,
          rowFingerprint: "error",
          classification: { isTarget: true, confidence: "medium", reason: "likely target" },
          queueContext: {
            pageNumber: 1,
            patientDisplayNameMasked: null,
            documentDesc: "Visit Note",
            type: "Therapy Visit Note",
            date: null,
            physician: null,
            documentType: "VISIT_NOTE",
            availableActions: [],
            queueUrl: baseSnapshot.queueUrl,
          },
          status: "ERROR",
          error: {
            code: "NOTE_OPEN_FAILED",
            message: "Open failed",
            recoverable: true,
          },
        },
      ];

      const totals = buildQueueQaRunTotals(results);

      assert.deepEqual(totals, {
        rowsScanned: 4,
        targetsDetected: 2,
        notesProcessed: 2,
        skipped: 1,
        errors: 1,
        pass: 1,
        fail: 0,
        needsReview: 0,
        decisions: 0,
        actionableDecisions: 0,
        reviewOnlyDecisions: 0,
        notActionableDecisions: 0,
        safeAutofixCandidates: 0,
        manualReviewRequired: 0,
        writeAttempts: 0,
        writesExecuted: 0,
        writesVerified: 0,
        writesBlocked: 0,
        writesSkipped: 0,
        writeFailures: 0,
        verificationFailures: 0,
        dryRunCount: 0,
        workflowAttempts: 0,
        workflowCompleted: 0,
        workflowPartial: 0,
        workflowBlocked: 0,
        workflowFailed: 0,
        workflowReviewRequired: 0,
        workflowPlannedOnly: 0,
        operatorCheckpointRequiredCount: 0,
      });
    },
  },
  {
    name: "deriveQueueQaRunOverallStatus returns failure when targets exist but none were processed",
    run: () => {
      assert.equal(
        deriveQueueQaRunOverallStatus({
          rowsScanned: 2,
          targetsDetected: 1,
          notesProcessed: 0,
          errors: 1,
        }),
        "FAILURE",
      );
      assert.equal(
        deriveQueueQaRunOverallStatus({
          rowsScanned: 2,
          targetsDetected: 1,
          notesProcessed: 1,
          errors: 1,
        }),
        "PARTIAL_SUCCESS",
      );
      assert.equal(
        deriveQueueQaRunOverallStatus({
          rowsScanned: 2,
          targetsDetected: 1,
          notesProcessed: 1,
          errors: 0,
        }),
        "SUCCESS",
      );
    },
  },
  {
    name: "finalizeQueueQaRunReport can compute totals from hidden non-target rows",
    run: () => {
      const hiddenSkipped: QueueQaRowProcessResult = {
        rowIndex: 9,
        rowFingerprint: "hidden-skip",
        classification: { isTarget: false, confidence: "medium", reason: "not enough evidence" },
        queueContext: {
          pageNumber: 2,
          patientDisplayNameMasked: null,
          documentDesc: "Unclear",
          type: null,
          date: null,
          physician: null,
          documentType: "UNKNOWN",
          availableActions: [],
          queueUrl: baseSnapshot.queueUrl,
        },
        status: "SKIPPED",
        skipReason: "INSUFFICIENT_TARGET_EVIDENCE",
      };
      const processedOnly = buildQueueQaRunTotals([]);
      assert.equal(processedOnly.rowsScanned, 0);

      const report = finalizeQueueQaRunReport({
        runId: "run-1",
        startedAt: "2026-03-24T00:00:00.000Z",
        completedAt: "2026-03-24T00:05:00.000Z",
        queueUrl: baseSnapshot.queueUrl,
        pagesProcessed: 1,
        resumeUsed: true,
        options: {
          startPage: 2,
          maxRowsToScan: 10,
          maxPages: 3,
          maxTargetNotesToProcess: 5,
          startRowFingerprint: "hidden-skip",
          includeNonTargetsInReport: false,
          captureSectionSamples: false,
          stopOnFirstFailure: false,
          revisitQueueBetweenRows: true,
          debug: false,
          resumeFromState: true,
          statePath: "state.json",
          exportJsonPath: "report.json",
          exportCsvPath: "report.csv",
          startRowIndex: 0,
        },
        results: [],
        totalSourceResults: [hiddenSkipped],
        exportArtifacts: {
          jsonPath: "report.json",
          csvPath: "report.csv",
          statePath: "state.json",
        },
        dedupe: {
          processedFingerprintCount: 1,
          duplicateRowsSkipped: 0,
        },
      });

      assert.equal(report.totals.rowsScanned, 1);
      assert.equal(report.pagesProcessed, 1);
      assert.equal(report.resumeUsed, true);
      assert.equal(report.results.length, 0);
      assert.deepEqual(buildQueueQaAuditSummary(report), {
        rowsScanned: 1,
        targetsDetected: 0,
        processed: 0,
        skipped: 1,
        pagesProcessed: 1,
        fail: 0,
        needsReview: 0,
        errors: 0,
        decisionCount: 0,
        actionableDecisionCount: 0,
        reviewOnlyDecisionCount: 0,
        safeAutofixCandidateCount: 0,
        manualReviewRequiredCount: 0,
        writeAttemptCount: 0,
        writeVerifiedCount: 0,
        writeBlockedCount: 0,
        writeFailureCount: 0,
        workflowAttemptCount: 0,
        workflowCompletedCount: 0,
        workflowBlockedCount: 0,
        workflowFailedCount: 0,
        operatorCheckpointRequiredCount: 0,
      });
    },
  },
  {
    name: "finalizeQueueQaRunReport includes workflow reporting by document kind and support level",
    run: () => {
      const report = finalizeQueueQaRunReport({
        runId: "run-workflow-summary",
        startedAt: "2026-03-24T00:00:00.000Z",
        completedAt: "2026-03-24T00:05:00.000Z",
        queueUrl: baseSnapshot.queueUrl,
        pagesProcessed: 1,
        resumeUsed: false,
        options: {
          startPage: 1,
          maxRowsToScan: 5,
          maxPages: 1,
          maxTargetNotesToProcess: 3,
          includeNonTargetsInReport: true,
          captureSectionSamples: false,
          stopOnFirstFailure: false,
          revisitQueueBetweenRows: true,
          debug: false,
          startRowIndex: 0,
        },
        results: [
          {
            rowIndex: 0,
            rowFingerprint: "visit-note-workflow",
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
              queueUrl: baseSnapshot.queueUrl,
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
              extractedAt: "2026-03-24T00:00:00.000Z",
              metadata: {
                pageTitle: "Visit Note",
                documentLabel: "Visit Note",
                patientMaskedId: null,
                visitDate: null,
                physician: null,
                signedState: "signed",
                diagnosisSummary: null,
                frequencySummary: null,
                homeboundSummary: null,
                orderSummary: null,
              },
              sections: [],
              warnings: [],
            },
            crossDocumentQa: emptyCrossDocumentQa(),
            qaResult: null,
            decisionResult: emptyDecisionResult(),
            writeExecutionResult: emptyWriteExecutionResult(),
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
              ...emptyWorkflowCompletionResult(),
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
              steps: [
                {
                  action: "STOP_FOR_REVIEW",
                  status: "VERIFIED",
                  mode: "EXECUTE",
                  attempted: false,
                  selectorUsed: null,
                  verificationPassed: true,
                  guardFailures: [],
                  warnings: [],
                  snapshotBefore: null,
                  snapshotAfter: null,
                  executedAt: null,
                  verifiedAt: "2026-03-24T00:01:00.000Z",
                },
              ],
              operatorCheckpoint: {
                required: true,
                category: "PRE_VALIDATE_REVIEW",
                reason: "Visit-note frequency updates can save in place, but validation remains review-gated.",
                recommendedAction: "Operator confirm before validate page.",
                beforeAction: "VALIDATE_PAGE",
              },
              audit: {
                executedAt: "2026-03-24T00:01:00.000Z",
                bundleConfidence: "HIGH",
                decisionConfidence: "HIGH",
                sourceWriteStatus: "VERIFIED",
              },
            },
            status: "PROCESSED",
          },
          {
            rowIndex: 1,
            rowFingerprint: "order-workflow",
            classification: { isTarget: false, confidence: "high", reason: "order family" },
            queueContext: {
              pageNumber: 1,
              patientDisplayNameMasked: null,
              documentDesc: "Admission Order",
              type: "Order",
              date: null,
              physician: null,
              documentType: "ORDER",
              availableActions: [],
              queueUrl: baseSnapshot.queueUrl,
            },
            openResult: {
              success: true,
              openedUrl: "https://example.test/documents/order/admission/456",
              openedInNewTab: false,
            },
            documentExtraction: {
              documentKind: "ADMISSION_ORDER",
              pageType: "admission_order",
              url: "https://example.test/documents/order/admission/456",
              extractedAt: "2026-03-24T00:00:00.000Z",
              metadata: {
                pageTitle: "Admission Order",
                documentLabel: "Admission Order",
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
            crossDocumentQa: emptyCrossDocumentQa(),
            qaResult: null,
            decisionResult: emptyDecisionResult(),
            writeExecutionResult: emptyWriteExecutionResult(),
            workflowSupport: {
              documentKind: "ADMISSION_ORDER",
              documentFamily: "ORDER_FAMILY",
              targetField: "orderSummary",
              supportLevel: "PLANNED_ONLY",
              allowedActions: [],
              executableActions: [],
              reviewGatedActions: [],
              blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
              requiresVerifiedWrite: true,
              operatorCheckpointRequired: true,
              checkpointCategories: ["EPISODE_ASSOCIATION_REVIEW", "DOCUMENT_KIND_REVIEW"],
              dryRunOnly: false,
              reason: "Admission orders are currently planned-only until deterministic write targets and workflow selectors are proven stable.",
            },
            workflowCompletionResult: {
              ...emptyWorkflowCompletionResult(),
              attempted: true,
              status: "PLANNED_ONLY",
              mode: "DRY_RUN",
              eligibility: "REVIEW_REQUIRED",
              documentKind: "ADMISSION_ORDER",
              targetField: "orderSummary",
              workflowSupport: {
                documentKind: "ADMISSION_ORDER",
                documentFamily: "ORDER_FAMILY",
                targetField: "orderSummary",
                supportLevel: "PLANNED_ONLY",
                allowedActions: [],
                executableActions: [],
                reviewGatedActions: [],
                blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
                requiresVerifiedWrite: true,
                operatorCheckpointRequired: true,
                checkpointCategories: ["EPISODE_ASSOCIATION_REVIEW", "DOCUMENT_KIND_REVIEW"],
                dryRunOnly: false,
                reason: "Admission orders are currently planned-only until deterministic write targets and workflow selectors are proven stable.",
              },
              steps: [
                {
                  action: "STOP_FOR_REVIEW",
                  status: "PLANNED",
                  mode: "DRY_RUN",
                  attempted: false,
                  selectorUsed: null,
                  verificationPassed: false,
                  guardFailures: [],
                  warnings: [],
                  snapshotBefore: null,
                  snapshotAfter: null,
                  executedAt: null,
                  verifiedAt: null,
                },
              ],
              operatorCheckpoint: {
                required: true,
                category: "DOCUMENT_KIND_REVIEW",
                reason: "Admission orders are currently planned-only until deterministic write targets and workflow selectors are proven stable.",
                recommendedAction: "Operator confirm before stop for review.",
                beforeAction: "STOP_FOR_REVIEW",
              },
              guardFailures: ["SUPPORT_LEVEL_PLANNED_ONLY"],
              audit: {
                executedAt: "2026-03-24T00:02:00.000Z",
                bundleConfidence: "HIGH",
                decisionConfidence: "HIGH",
                sourceWriteStatus: "VERIFIED",
              },
            },
            status: "PROCESSED",
          },
        ],
        exportArtifacts: {
          jsonPath: null,
          csvPath: null,
          statePath: null,
        },
        dedupe: {
          processedFingerprintCount: 2,
          duplicateRowsSkipped: 0,
        },
      });

      assert.equal(report.totals.workflowAttempts, 2);
      assert.equal(report.totals.workflowReviewRequired, 1);
      assert.equal(report.totals.workflowPlannedOnly, 1);
      assert.deepEqual(report.workflowSummary.workflowAttemptsByDocumentKind, [
        { documentKind: "ADMISSION_ORDER", count: 1 },
        { documentKind: "VISIT_NOTE", count: 1 },
      ]);
      assert.deepEqual(report.workflowSummary.workflowReviewRequiredByDocumentKind, [
        { documentKind: "VISIT_NOTE", count: 1 },
      ]);
      assert.deepEqual(report.workflowSummary.workflowPartialByDocumentKind, []);
      assert.deepEqual(report.workflowSummary.workflowFailedByDocumentKind, []);
      assert.deepEqual(report.workflowSummary.workflowPlannedOnlyByDocumentKind, [
        { documentKind: "ADMISSION_ORDER", count: 1 },
      ]);
      assert.deepEqual(report.workflowSummary.supportLevelCounts, [
        { supportLevel: "PLANNED_ONLY", count: 1 },
        { supportLevel: "REVIEW_GATED", count: 1 },
      ]);
      assert.deepEqual(report.workflowSummary.checkpointCountsByCategory, [
        { category: "DOCUMENT_KIND_REVIEW", count: 1 },
        { category: "PRE_VALIDATE_REVIEW", count: 1 },
      ]);
    },
  },
  {
    name: "export report writers sanitize section samples and include pagination columns",
    run: async () => {
      const report = finalizeQueueQaRunReport({
        runId: "run-export",
        startedAt: "2026-03-24T00:00:00.000Z",
        completedAt: "2026-03-24T00:05:00.000Z",
        queueUrl: baseSnapshot.queueUrl,
        pagesProcessed: 2,
        resumeUsed: false,
        options: {
          startPage: 1,
          maxRowsToScan: 10,
          maxPages: 2,
          maxTargetNotesToProcess: 5,
          includeNonTargetsInReport: true,
          captureSectionSamples: true,
          stopOnFirstFailure: false,
          revisitQueueBetweenRows: true,
          debug: false,
          startRowIndex: 0,
          writeMode: "DRY_RUN",
          writesEnabled: true,
        },
        results: [
          {
            rowIndex: 0,
            rowFingerprint: "processed-with-sample",
            classification: { isTarget: true, confidence: "high", reason: "matched" },
            queueContext: {
              pageNumber: 2,
              patientDisplayNameMasked: "J*** D***",
              documentDesc: "Visit Note",
              type: "Therapy Visit Note",
              date: "03/24/2026",
              physician: null,
              documentType: "VISIT_NOTE",
              availableActions: [],
              queueUrl: baseSnapshot.queueUrl,
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
            extractedAt: "2026-03-24T00:00:00.000Z",
            metadata: {
              pageTitle: "Therapy Visit Note",
              documentLabel: "Therapy Visit Note",
              patientMaskedId: null,
              visitDate: "03/24/2026",
              physician: null,
              signedState: "signed",
              diagnosisSummary: null,
              frequencySummary: null,
              homeboundSummary: null,
              orderSummary: null,
            },
            sections: [
              {
                id: "subjective-info",
                label: "Subjective Info",
                present: true,
                visible: true,
                textLength: 20,
                hasMeaningfulContent: true,
                sample: "Patient walked 20 feet.",
              },
            ],
            warnings: [],
          },
          crossDocumentQa: {
            bundleConfidence: "HIGH",
            bundleReason: "matched masked patient identity and nearby document dates",
            mismatches: [
              {
                type: "FREQUENCY_MISMATCH",
                confidence: "MEDIUM",
                reason: "Visit-note and plan-of-care frequency summaries did not loosely align.",
                sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
              },
            ],
            alignments: [],
            warnings: [],
          },
          qaResult: {
            pageType: "visit_note",
            url: "https://example.test/documents/note/visitnote/123",
              extractedAt: "2026-03-24T00:00:00.000Z",
              sections: [
                {
                  id: "subjective-info",
                  label: "Subjective Info",
                  present: true,
                  visible: true,
                  textLength: 20,
                  hasMeaningfulContent: true,
                  sample: "Patient walked 20 feet.",
                },
              ],
              metadata: {
                noteType: "Therapy Visit Note",
                pageTitle: "Therapy Visit Note",
                documentRoute: "/documents/note/visitnote/123",
                signatureState: "signed",
                visitDate: "03/24/2026",
              },
              rules: [],
              summary: {
                overallStatus: "PASS",
                missingSections: [],
                reviewFlags: [],
                meaningfulSectionCount: 1,
                totalMeaningfulTextLength: 20,
              },
              warnings: [],
            },
            decisionResult: {
              decisions: [
                {
                  decisionType: "PROPOSE_UPDATE",
                  issueType: "FREQUENCY_MISMATCH",
                  actionability: "ACTIONABLE",
                  autoFixEligibility: "SAFE_AUTOFIX_CANDIDATE",
                  confidence: "HIGH",
                  sourceOfTruth: {
                    sourceDocumentKind: "PLAN_OF_CARE",
                    targetDocumentKind: "VISIT_NOTE",
                    confidence: "HIGH",
                    reason: "Plan of care is the narrow deterministic source for visit-frequency alignment.",
                  },
                  proposedAction: {
                    targetDocumentKind: "VISIT_NOTE",
                    targetField: "frequencySummary",
                    action: "UPDATE_FIELD",
                    proposedValue: "PT 2x weekly",
                    changeStrategy: "REPLACE",
                  },
                  reason: "Visit frequency should align to the extracted plan-of-care frequency anchor.",
                  evidence: {
                    sourceAnchors: [],
                    targetAnchors: [],
                    warningCodes: [],
                  },
                  humanReviewReasons: [],
                },
              ],
              warnings: [],
              summary: {
                actionableCount: 1,
                reviewOnlyCount: 0,
                notActionableCount: 0,
                safeAutofixCandidateCount: 1,
                manualReviewRequiredCount: 0,
                issuesByType: {
                  FREQUENCY_MISMATCH: 1,
                },
                decisionsByTargetDocument: {
                  VISIT_NOTE: 1,
                },
              },
            },
            writeExecutionResult: {
              attempted: true,
              results: [
                {
                  status: "SKIPPED",
                  mode: "DRY_RUN",
                  eligibility: "ELIGIBLE",
                  decisionType: "PROPOSE_UPDATE",
                  issueType: "FREQUENCY_MISMATCH",
                  targetDocumentKind: "VISIT_NOTE",
                  targetField: "frequencySummary",
                  selectorUsed: "textarea[formcontrolname=\"frequencySummary\"]",
                  previousValue: "PT once weekly",
                  proposedValue: "PT 2x weekly",
                  finalValue: "PT once weekly",
                  verificationPassed: false,
                  guardFailures: ["WRITE_MODE_DRY_RUN"],
                  warnings: [
                    {
                      code: "DRY_RUN",
                      message: "Write was eligible but not executed because mode=DRY_RUN.",
                    },
                  ],
                  audit: {
                    executedAt: "2026-03-24T00:00:00.000Z",
                    bundleConfidence: "HIGH",
                    decisionConfidence: "HIGH",
                  },
                },
              ],
              summary: {
                writeAttempts: 1,
                writesExecuted: 0,
                writesVerified: 0,
                writesBlocked: 0,
                writesSkipped: 1,
                writeFailures: 0,
                verificationFailures: 0,
                dryRunCount: 1,
                topGuardFailureReasons: [
                  {
                    key: "WRITE_MODE_DRY_RUN",
                    count: 1,
                  },
                ],
              },
            },
            workflowSupport: {
              documentKind: "VISIT_NOTE",
              documentFamily: "VISIT_NOTE",
              targetField: "frequencySummary",
              supportLevel: "REVIEW_GATED",
              allowedActions: ["SAVE_PAGE"] as Array<"SAVE_PAGE">,
              executableActions: ["SAVE_PAGE"] as Array<"SAVE_PAGE">,
              reviewGatedActions: ["VALIDATE_PAGE"] as Array<"VALIDATE_PAGE">,
              blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"] as Array<"LOCK_RECORD" | "MARK_QA_COMPLETE">,
              requiresVerifiedWrite: true,
              operatorCheckpointRequired: true,
              checkpointCategories: ["PRE_VALIDATE_REVIEW"] as Array<"PRE_VALIDATE_REVIEW">,
              dryRunOnly: false,
              reason: "Visit-note frequency updates can save in place, but validation remains review-gated.",
            },
            workflowCompletionResult: {
              attempted: false,
              status: "BLOCKED",
              mode: "DRY_RUN",
              eligibility: "INELIGIBLE",
              documentKind: "VISIT_NOTE",
              targetField: "frequencySummary",
              workflowSupport: {
                documentKind: "VISIT_NOTE",
                documentFamily: "VISIT_NOTE",
                targetField: "frequencySummary",
                supportLevel: "REVIEW_GATED",
                allowedActions: ["SAVE_PAGE"] as Array<"SAVE_PAGE">,
                executableActions: ["SAVE_PAGE"] as Array<"SAVE_PAGE">,
                reviewGatedActions: ["VALIDATE_PAGE"] as Array<"VALIDATE_PAGE">,
                blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"] as Array<"LOCK_RECORD" | "MARK_QA_COMPLETE">,
                requiresVerifiedWrite: true,
                operatorCheckpointRequired: true,
                checkpointCategories: ["PRE_VALIDATE_REVIEW"] as Array<"PRE_VALIDATE_REVIEW">,
                dryRunOnly: false,
                reason: "Visit-note frequency updates can save in place, but validation remains review-gated.",
              },
              plan: null,
              steps: [],
              operatorCheckpoint: null,
              guardFailures: [],
              warnings: [],
              audit: {
                executedAt: "2026-03-24T00:00:00.000Z",
                bundleConfidence: "HIGH",
                decisionConfidence: "HIGH",
                sourceWriteStatus: null,
              },
            },
            status: "PROCESSED",
          },
        ],
        exportArtifacts: {
          jsonPath: "report.json",
          csvPath: "report.csv",
          statePath: null,
        },
        dedupe: {
          processedFingerprintCount: 1,
          duplicateRowsSkipped: 0,
        },
      });

      const outputDir = await mkdtemp(join(tmpdir(), "queue-qa-export-"));
      const jsonPath = join(outputDir, "report.json");
      const csvPath = join(outputDir, "report.csv");

      try {
        await exportJsonReport(report, jsonPath);
        await exportCsvReport(report, csvPath);

        const jsonOutput = await readFile(jsonPath, "utf8");
        const csvOutput = await readFile(csvPath, "utf8");

        assert.equal(jsonOutput.includes("Patient walked 20 feet."), false);
        assert.equal(jsonOutput.includes("\"documentKind\": \"VISIT_NOTE\""), true);
        assert.equal(csvOutput.includes("pageNumber"), true);
        assert.equal(csvOutput.includes("documentKind"), true);
        assert.equal(csvOutput.includes("crossDocMismatchCount"), true);
        assert.equal(csvOutput.includes("writeAttemptCount"), true);
        assert.equal(csvOutput.includes("2"), true);
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
  },
];

let passed = 0;

async function main(): Promise<void> {
  for (const entry of tests) {
    await entry.run();
    passed += 1;
  }

  console.log(`queue-qa-pipeline tests passed: ${passed}/${tests.length}`);
}

void main();
