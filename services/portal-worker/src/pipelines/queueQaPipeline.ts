import { randomUUID } from "node:crypto";
import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  type CrossDocumentQaResult,
  type DocumentExtraction,
  type DocumentKind,
  type PortalJob,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { executeLoginWorkflow } from "../auth/login-workflow";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { type PortalWorkerEnv } from "../config/env";
import { exportCsvReport } from "../export/exportCsvReport";
import { exportJsonReport } from "../export/exportJsonReport";
import { runSelectorHealthChecks } from "../health/runSelectorHealthChecks";
import { appendExecutionTrace } from "../observability/executionTrace";
import { buildRuntimeConfigSnapshot } from "../observability/runtimeConfigSnapshot";
import { buildTraceEvent } from "../observability/traceEventBuilder";
import { WorkflowError } from "../errors/workflow-error";
import { extractDocument } from "../extractors/extractDocument";
import { runQaDecisionEngine } from "../decisions/qaDecisionEngine";
import { emptyQaDecisionResult } from "../decisions/decisionShared";
import { runCrossDocumentQaEngine } from "../qa/crossDocumentQaEngine";
import { SAFE_READ_RETRY_POLICIES } from "../reliability/retryPolicy";
import { publishReliabilitySnapshot } from "../reliability/reliabilityExport";
import { buildReliabilitySnapshot } from "../reliability/reliabilitySnapshotBuilder";
import { listRunHistoryRecords, recordRunReliabilityReport } from "../reliability/runHistoryCollector";
import { withRetry } from "../reliability/withRetry";
import { executeWorkflowCompletion } from "../workflows/workflowExecutor";
import { resolveWorkflowExecutionConfig } from "../workflows/workflowExecutionConfig";
import { buildWorkflowSupportDiagnostics, getWorkflowSupport } from "../workflows/workflowSupportMatrix";
import { emptyWorkflowCompletionResult } from "../workflows/workflowResultHelpers";
import { executeWriteDecision, buildBlockedWriteAttempt } from "../writes/writeExecutor";
import { emptyWriteExecutionResult, buildWriteExecutionResult, shouldConsiderDecisionForWrite } from "../writes/writeResultHelpers";
import { resolveWriteExecutionConfig } from "../writes/writeExecutionConfig";
import { evaluateWriteGuards } from "../writes/writeGuardEvaluator";
import { getWriteAllowlistEntry } from "../writes/writeAllowlist";
import {
  buildQueueQaAuditSummary,
  finalizeQueueQaRunReport,
} from "../reporting/qaRunReporter";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { DocumentTrackingHubPage } from "../portal/pages/DocumentTrackingHubPage";
import { OrdersQaEntryPage } from "../portal/pages/OrdersQaEntryPage";
import {
  QaMonitoringQueuePage,
  type ResolvedQaQueueRow,
} from "../portal/pages/QaMonitoringQueuePage";
import { VisitNoteDetailPage } from "../portal/pages/VisitNoteDetailPage";
import { analyzeClickTransition } from "../portal/utils/transition-detector";
import { waitForPageSettled } from "../portal/utils/page-helpers";
import { isReadableDocumentKind } from "../types/documentKinds";
import {
  createQueueQaRunState,
  loadQueueQaRunState,
  saveQueueQaRunState,
  updateQueueQaRunState,
  type QueueQaRunState,
} from "../state/runState";
import {
  buildQueueQaPipelineError,
  queueQaRunReportSchema,
  resolveQueueQaPipelineOptions,
  type NormalizedQueueRowSnapshot,
  type QueueQaPipelineProcessContext,
  type QueueQaPipelineResolvedOptions,
  type QueueQaPipelineWarning,
  type QueueQaRowClassification,
  type QueueQaRowProcessResult,
  type QueueQaRunReport,
  type QueueQaSkipReason,
  type QueueRowSnapshot,
} from "../types/queueQaPipeline";
import { type RuntimeDiagnostic } from "../types/runtimeDiagnostics";
import { resolvePortalSafetyConfig } from "../safety/portalSafety";
import { detectDangerousControls } from "../safety/detectDangerousControls";

export interface QueueQaPipelineExecutionOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

interface QueuePageState {
  queuePageHandle: Page;
  queuePage: QaMonitoringQueuePage;
  queueUrl: string;
  currentPage: number;
}

interface ResumeContext {
  processedFingerprints: Set<string>;
  resumeUsed: boolean;
  startPage: number;
  startRowFingerprint: string | undefined;
  runState: QueueQaRunState | null;
}

interface ProcessTargetQueueRowOutcome {
  result: QueueQaRowProcessResult;
  queuePageState: QueuePageState;
}

export async function executeQueueQaPipeline(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: QueueQaPipelineExecutionOptions = {},
): Promise<QueueQaRunReport> {
  const browser = await launchBrowser(env);
  const startedAt = new Date().toISOString();
  const runId = `phase12-${randomUUID()}`;
  const pipelineOptions = resolveQueueQaPipelineOptions(job.payload);
  const safetyConfig = resolvePortalSafetyConfig(job);
  const runtimeConfigSnapshot = buildRuntimeConfigSnapshot(pipelineOptions, safetyConfig);

  try {
    const context = await createPortalContext(browser, env);
    const page = await context.newPage();
    let queuePageState = await navigateToQaMonitoringQueue(page, job, env, logger, options);
    const warnings: QueueQaPipelineWarning[] = [];
    const reportedResults: QueueQaRowProcessResult[] = [];
    const totalSourceResults: QueueQaRowProcessResult[] = [];
    const resumeContext = await initializeResumeContext(runId, startedAt, pipelineOptions);
    let pagesProcessed = 0;
    let targetRowsAttempted = 0;
    let duplicateRowsSkipped = 0;
    let stopProcessing = false;

    queuePageState = await navigateToRequestedStartPage(
      queuePageState,
      resumeContext.startPage,
      warnings,
    );

    for (let pageOffset = 0; pageOffset < pipelineOptions.maxPages; pageOffset += 1) {
      const currentPageNumber = await queuePageState.queuePage.getCurrentPageNumber();
      queuePageState = refreshQueuePageState(queuePageState, currentPageNumber);
      pagesProcessed += 1;

      const visibleRows = await getVisibleRowsWithRetry(queuePageState.queuePage);
      const rowsToScan = selectRowsForScan(
        visibleRows,
        pipelineOptions,
        warnings,
        currentPageNumber,
      );
      const resumeBarrier = createResumeBarrier(resumeContext, currentPageNumber);

      for (const row of rowsToScan) {
        const normalizedSnapshot = normalizeQueueRowSnapshot(row.snapshot);
        const processContext = buildQueueQaProcessContext(normalizedSnapshot);

        if (!resumeBarrier.shouldProcess(normalizedSnapshot.rowFingerprint)) {
          continue;
        }

        if (resumeContext.processedFingerprints.has(normalizedSnapshot.rowFingerprint)) {
          const duplicateResult = buildSkippedResult(
            processContext,
            processContext.snapshot.classification,
            undefined,
            "ALREADY_PROCESSED_FINGERPRINT",
          );
          duplicateRowsSkipped += 1;
          totalSourceResults.push(duplicateResult);
          reportedResults.push(duplicateResult);
          await persistQueueRunState(
            pipelineOptions,
            resumeContext.runState,
            currentPageNumber,
            normalizedSnapshot.rowFingerprint,
            resumeContext.processedFingerprints,
          );
          continue;
        }

        if (!normalizedSnapshot.isTargetVisitNote) {
          if (shouldProcessReadableDocument(normalizedSnapshot)) {
            if (targetRowsAttempted >= pipelineOptions.maxTargetNotesToProcess) {
              warnings.push({
                code: "TARGET_LIMIT_REACHED",
                message: `Stopped after reaching maxTargetNotesToProcess=${pipelineOptions.maxTargetNotesToProcess}.`,
                rowIndex: normalizedSnapshot.rowIndex,
                rowFingerprint: normalizedSnapshot.rowFingerprint,
              });
              stopProcessing = true;
              break;
            }

            targetRowsAttempted += 1;
            const outcome = await processTargetQueueRow({
              queuePageState,
              snapshot: normalizedSnapshot,
              options: pipelineOptions,
              logger,
            });
            queuePageState = outcome.queuePageState;
            totalSourceResults.push(outcome.result);
            reportedResults.push(outcome.result);
            resumeContext.processedFingerprints.add(normalizedSnapshot.rowFingerprint);
            await persistQueueRunState(
              pipelineOptions,
              resumeContext.runState,
              queuePageState.currentPage,
              normalizedSnapshot.rowFingerprint,
              resumeContext.processedFingerprints,
            );
            continue;
          }

          const skippedResult = buildSkippedResult(
            processContext,
            processContext.snapshot.classification,
          );
          totalSourceResults.push(skippedResult);
          if (pipelineOptions.includeNonTargetsInReport) {
            reportedResults.push(skippedResult);
          }
          resumeContext.processedFingerprints.add(normalizedSnapshot.rowFingerprint);
          await persistQueueRunState(
            pipelineOptions,
            resumeContext.runState,
            currentPageNumber,
            normalizedSnapshot.rowFingerprint,
            resumeContext.processedFingerprints,
          );
          continue;
        }

        if (targetRowsAttempted >= pipelineOptions.maxTargetNotesToProcess) {
          warnings.push({
            code: "TARGET_LIMIT_REACHED",
            message: `Stopped after reaching maxTargetNotesToProcess=${pipelineOptions.maxTargetNotesToProcess}.`,
            rowIndex: normalizedSnapshot.rowIndex,
            rowFingerprint: normalizedSnapshot.rowFingerprint,
          });
          stopProcessing = true;
          break;
        }

        targetRowsAttempted += 1;
        const outcome = await processTargetQueueRow({
          queuePageState,
          snapshot: normalizedSnapshot,
          options: pipelineOptions,
          logger,
        });
        queuePageState = outcome.queuePageState;
        totalSourceResults.push(outcome.result);
        reportedResults.push(outcome.result);
        resumeContext.processedFingerprints.add(normalizedSnapshot.rowFingerprint);
        await persistQueueRunState(
          pipelineOptions,
          resumeContext.runState,
          queuePageState.currentPage,
          normalizedSnapshot.rowFingerprint,
          resumeContext.processedFingerprints,
        );

        logger.info("Phase 12 queue row processed.", {
          pageNumber: queuePageState.currentPage,
          rowIndex: outcome.result.rowIndex,
          status: outcome.result.status,
          isTarget: outcome.result.classification.isTarget,
          qaOverallStatus: outcome.result.status === "PROCESSED" && outcome.result.qaResult
            ? outcome.result.qaResult.summary.overallStatus
            : null,
          errorCode: outcome.result.status === "ERROR" ? outcome.result.error.code : null,
          skipReason: outcome.result.status === "SKIPPED" ? outcome.result.skipReason : null,
        });

        if (outcome.result.status === "ERROR" && pipelineOptions.stopOnFirstFailure) {
          warnings.push({
            code: "STOPPED_ON_FIRST_FAILURE",
            message: "Processing stopped after the first row-level failure because stopOnFirstFailure=true.",
            rowIndex: outcome.result.rowIndex,
            rowFingerprint: outcome.result.rowFingerprint,
          });
          stopProcessing = true;
          break;
        }
      }

      if (stopProcessing) {
        break;
      }

      const hasNextPage = await queuePageState.queuePage.hasNextPage();
      if (!hasNextPage) {
        break;
      }

      const movedToNextPage = await queuePageState.queuePage.goToNextPage();
      if (!movedToNextPage) {
        warnings.push({
          code: "PAGINATION_ADVANCE_FAILED",
          message: `Queue pagination could not advance from page ${queuePageState.currentPage}.`,
          rowIndex: null,
          rowFingerprint: null,
        });
        break;
      }

      const nextPageNumber = await queuePageState.queuePage.getCurrentPageNumber();
      queuePageState = refreshQueuePageState(queuePageState, nextPageNumber);
      await persistQueueRunState(
        pipelineOptions,
        resumeContext.runState,
        queuePageState.currentPage,
        null,
        resumeContext.processedFingerprints,
      );
    }

    const exportArtifacts = {
      jsonPath: pipelineOptions.exportJsonPath ?? null,
      csvPath: pipelineOptions.exportCsvPath ?? null,
      statePath: pipelineOptions.statePath ?? null,
    };
    const enrichedTotalSourceResults = applyCrossDocumentQaToResults(totalSourceResults);
    const writeAppliedResults = await applyWriteExecutionToResults({
      results: enrichedTotalSourceResults,
      queuePageState,
      options: pipelineOptions,
      safetyMode: safetyConfig.safetyMode,
      logger,
      warnings,
    });
    queuePageState = writeAppliedResults.queuePageState;
    const enrichedReportedResults = projectReportedResults(
      writeAppliedResults.results,
      reportedResults,
    );

    const baseReport = finalizeQueueQaRunReport({
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      queueUrl: queuePageState.queueUrl,
      pagesProcessed,
      resumeUsed: resumeContext.resumeUsed,
      options: pipelineOptions,
      results: enrichedReportedResults,
      totalSourceResults: writeAppliedResults.results,
      warnings,
      exportArtifacts,
      dedupe: {
        processedFingerprintCount: resumeContext.processedFingerprints.size,
        duplicateRowsSkipped,
      },
      runtimeConfigSnapshot,
    });
    recordRunReliabilityReport(baseReport);
    const reliabilitySnapshot = buildReliabilitySnapshot({
      records: listRunHistoryRecords(),
      timestamp: baseReport.completedAt,
    });
    publishReliabilitySnapshot(reliabilitySnapshot);
    const report = queueQaRunReportSchema.parse({
      ...baseReport,
      reliabilitySnapshot,
    });

    if (pipelineOptions.exportJsonPath) {
      await exportJsonReport(report, pipelineOptions.exportJsonPath);
    }

    if (pipelineOptions.exportCsvPath) {
      await exportCsvReport(report, pipelineOptions.exportCsvPath);
    }

    await finalizePersistedRunState(
      pipelineOptions,
      resumeContext.runState,
      queuePageState.currentPage,
      resumeContext.processedFingerprints,
    );

    logger.info("Phase 12 queue QA pipeline completed.", buildQueueQaAuditSummary(report));
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaQueuePipelineComplete);

    return report;
  } finally {
    await browser.close();
  }
}

export function normalizeQueueRowSnapshot(snapshot: QueueRowSnapshot): NormalizedQueueRowSnapshot {
  const classification = classifyQueueRowSnapshot(snapshot);
  const skipReason = classification.isTarget ? null : deriveSkipReason(snapshot, classification);

  return {
    ...snapshot,
    classification,
    isTargetVisitNote: classification.isTarget,
    targetReason: classification.isTarget ? classification.reason : null,
    skipReason,
  };
}

export function classifyQueueRowSnapshot(input: {
  documentDesc: string | null;
  type: string | null;
  documentType?: QueueRowSnapshot["documentType"];
  availableActions?: QueueRowSnapshot["availableActions"];
  openedUrl?: string | null;
  detailPageType?: string | null;
}): QueueQaRowClassification {
  const documentDesc = (input.documentDesc ?? "").toLowerCase();
  const type = (input.type ?? "").toLowerCase();
  const openedUrl = (input.openedUrl ?? "").toLowerCase();
  const detailPageType = (input.detailPageType ?? "").toLowerCase();
  const actionLabels = (input.availableActions ?? [])
    .map((action) => action.label.toLowerCase())
    .join(" ");

  if (openedUrl && !isVisitNoteUrl(openedUrl) && /\/documents\//i.test(openedUrl)) {
    return {
      isTarget: false,
      confidence: "high",
      reason: "opened URL resolved to a non-visit-note document route.",
    };
  }

  if (isVisitNoteUrl(openedUrl)) {
    return {
      isTarget: true,
      confidence: "high",
      reason: "opened URL confirmed a visit note route.",
    };
  }

  if (detailPageType === "order_detail" || detailPageType === "document_detail") {
    return {
      isTarget: false,
      confidence: "high",
      reason: `detail page resolved as ${detailPageType}.`,
    };
  }

  const documentDescMatched = VISIT_NOTE_DESC_PATTERNS.some((pattern) => pattern.test(documentDesc));
  const typeMatched = VISIT_NOTE_TYPE_PATTERNS.some((pattern) => pattern.test(type));
  const explicitNonTarget =
    NON_TARGET_PATTERNS.some((pattern) => pattern.test(documentDesc)) ||
    NON_TARGET_PATTERNS.some((pattern) => pattern.test(type));
  const actionSuggestsNote = /\bview \/ edit note\b|\bview note\b|\bedit note\b/.test(actionLabels);

  if (explicitNonTarget) {
    return {
      isTarget: false,
      confidence: "high",
      reason: "document appears to be a non-visit-note item such as an order or plan of care.",
    };
  }

  if ((documentDescMatched && typeMatched) || (documentDescMatched && actionSuggestsNote)) {
    return {
      isTarget: true,
      confidence: "high",
      reason: documentDescMatched && typeMatched
        ? "documentDesc matched visit note and type matched therapy or nursing visit note."
        : "documentDesc matched visit note and row exposed a View / Edit Note action.",
    };
  }

  if (documentDescMatched || typeMatched || input.documentType === "VISIT_NOTE") {
    return {
      isTarget: true,
      confidence: "medium",
      reason: "row metadata suggests a visit note but route confirmation has not happened yet.",
    };
  }

  return {
    isTarget: false,
    confidence: "medium",
    reason: "row metadata did not provide enough deterministic evidence for a visit note.",
  };
}

function buildQueueQaProcessContext(
  snapshot: NormalizedQueueRowSnapshot,
): QueueQaPipelineProcessContext {
  return {
    snapshot,
    queueContext: {
      pageNumber: snapshot.pageNumber,
      patientDisplayNameMasked: snapshot.patientDisplayNameMasked,
      documentDesc: snapshot.documentDesc,
      type: snapshot.type,
      date: snapshot.date,
      physician: snapshot.physician,
      documentType: snapshot.documentType,
      availableActions: snapshot.availableActions,
      queueUrl: snapshot.queueUrl,
    },
  };
}

async function navigateToQaMonitoringQueue(
  page: Page,
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: QueueQaPipelineExecutionOptions,
): Promise<QueuePageState> {
  const dashboardPage = new DashboardPage(page);
  const ordersQaEntryPage = new OrdersQaEntryPage(page);

  await executeLoginWorkflow(
    page,
    job.portalUrl || env.portalBaseUrl,
    env.portalUsername,
    env.portalPassword,
    logger,
    { onCheckpoint: options.onCheckpoint },
  );

  if (!(await dashboardPage.isLoaded())) {
    throw new WorkflowError("QUEUE_LOAD_FAILED", "Authenticated dashboard was not detected after login.", true);
  }

  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.dashboardDetected);

  const targetTile = await ordersQaEntryPage.findOrdersQaShortcutTile();
  if (!targetTile) {
    throw new WorkflowError("QUEUE_LOAD_FAILED", "Orders & QA Management tile was not found.", true);
  }

  const hubEntryTransition = await analyzeClickTransition(page, targetTile.locator);
  const hubPage = new DocumentTrackingHubPage(hubEntryTransition.targetPage);
  if (!(await hubPage.isLoaded())) {
    throw new WorkflowError("QUEUE_LOAD_FAILED", "Document-tracking hub was not detected.", true);
  }

  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.documentTrackingHubEntered);

  const trustedLinks = await hubPage.discoverTrustedSidebarLinks();
  const qaMonitoringLink = trustedLinks.find((link) => /qa monitoring/i.test(link.summary.label));
  if (!qaMonitoringLink) {
    throw new WorkflowError("QUEUE_LOAD_FAILED", "QA Monitoring sidebar anchor was not found.", true);
  }

  const queueTransition = await analyzeClickTransition(
    hubEntryTransition.targetPage,
    qaMonitoringLink.locator,
  );
  const queuePageHandle = queueTransition.targetPage;
  const queuePage = new QaMonitoringQueuePage(queuePageHandle);
  await waitForPageSettled(queuePageHandle, queueTransition.transition.newTabDetected ? 500 : 250);

  if (!(await queuePage.waitUntilReady())) {
    throw new WorkflowError("QUEUE_LOAD_FAILED", "QA Monitoring queue was not detected after navigation.", true);
  }

  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaQueueDetected);
  return {
    queuePageHandle,
    queuePage,
    queueUrl: queuePageHandle.url(),
    currentPage: await queuePage.getCurrentPageNumber(),
  };
}

async function initializeResumeContext(
  runId: string,
  startedAt: string,
  options: QueueQaPipelineResolvedOptions,
): Promise<ResumeContext> {
  const loadedState =
    options.resumeFromState && options.statePath
      ? await loadQueueQaRunState(options.statePath)
      : null;
  const startPage = options.startPage ?? loadedState?.currentPage ?? 1;
  const startRowFingerprint = options.startRowFingerprint ?? loadedState?.lastProcessedFingerprint ?? undefined;
  const processedFingerprints = new Set(loadedState?.processedFingerprints ?? []);
  const runState = options.statePath
    ? createQueueQaRunState({
        runId,
        startedAt,
        currentPage: startPage,
        lastProcessedFingerprint: startRowFingerprint ?? null,
        processedFingerprints,
      })
    : null;

  return {
    processedFingerprints,
    resumeUsed: Boolean(loadedState || options.resumeFromState || options.startPage > 1 || options.startRowFingerprint),
    startPage,
    startRowFingerprint,
    runState,
  };
}

async function getVisibleRowsWithRetry(queuePage: QaMonitoringQueuePage): Promise<ResolvedQaQueueRow[]> {
  return (await withRetry({
    policy: SAFE_READ_RETRY_POLICIES.queueVisibleRows,
    operation: "get-visible-queue-rows",
    execute: async () => {
      const rows = await queuePage.getVisibleRows();
      if (rows.length === 0) {
        await queuePage.waitUntilReady(1_500);
      }
      return rows;
    },
  })).result;
}

function selectRowsForScan(
  rows: ResolvedQaQueueRow[],
  options: QueueQaPipelineResolvedOptions,
  warnings: QueueQaPipelineWarning[],
  currentPageNumber: number,
): ResolvedQaQueueRow[] {
  const rangedRows = rows.filter((row) =>
    row.snapshot.rowIndex >= options.startRowIndex &&
    (typeof options.endRowIndex !== "number" || row.snapshot.rowIndex <= options.endRowIndex),
  );

  if (rangedRows.length === 0) {
    warnings.push({
      code: "NO_ROWS_IN_RANGE",
      message: `No visible QA queue rows matched the requested row range on page ${currentPageNumber}.`,
      rowIndex: null,
      rowFingerprint: null,
    });
    return [];
  }

  const limitedRows = rangedRows.slice(0, options.maxRowsToScan);
  if (limitedRows.length < rangedRows.length) {
    warnings.push({
      code: "MAX_ROWS_LIMIT_REACHED",
      message: `Only the first ${options.maxRowsToScan} rows in range were scanned on page ${currentPageNumber}.`,
      rowIndex: limitedRows.at(-1)?.snapshot.rowIndex ?? null,
      rowFingerprint: limitedRows.at(-1)?.snapshot.rowFingerprint ?? null,
    });
  }

  return limitedRows;
}

function createResumeBarrier(
  resumeContext: ResumeContext,
  currentPageNumber: number,
): { shouldProcess: (fingerprint: string) => boolean } {
  if (!resumeContext.startRowFingerprint || currentPageNumber !== resumeContext.startPage) {
    return {
      shouldProcess: () => true,
    };
  }

  let unlocked = false;
  return {
    shouldProcess(fingerprint: string): boolean {
      if (unlocked) {
        return true;
      }

      if (fingerprint === resumeContext.startRowFingerprint) {
        unlocked = true;
      }

      return false;
    },
  };
}

async function processTargetQueueRow(input: {
  queuePageState: QueuePageState;
  snapshot: NormalizedQueueRowSnapshot;
  options: QueueQaPipelineResolvedOptions;
  logger: Logger;
}): Promise<ProcessTargetQueueRowOutcome> {
  const processContext = buildQueueQaProcessContext(input.snapshot);
  let queuePageState = input.queuePageState;
  const resolvedRow = await reacquireQueueRow(queuePageState.queuePage, processContext.snapshot);

  if (!resolvedRow) {
    return {
      queuePageState,
      result: buildErrorResult(
        processContext,
        buildQueueQaPipelineError(
          "ROW_REACQUIRE_FAILED",
          "The queue row could not be re-located before processing.",
          true,
        ),
      ),
    };
  }

  const noteTarget = queuePageState.queuePage.selectPreferredTarget(resolvedRow);
  if (!noteTarget) {
    return {
      queuePageState,
      result: buildErrorResult(
        processContext,
        buildQueueQaPipelineError(
          "ROW_ACTION_NOT_FOUND",
          "The row did not expose a safe read-only document target.",
          true,
        ),
      ),
    };
  }

  let openResult:
    | {
        success: boolean;
        openedUrl: string | null;
        openedInNewTab: boolean;
      }
    | undefined;

  try {
    const itemTransition = await analyzeClickTransition(queuePageState.queuePageHandle, noteTarget.locator);
    const targetPage = itemTransition.targetPage;
    const openedUrl = targetPage.url() || null;
    openResult = {
      success: Boolean(openedUrl),
      openedUrl,
      openedInNewTab: itemTransition.transition.newTabDetected,
    };

    await prepareTargetPage(targetPage, itemTransition.transition.newTabDetected);

    const detailPage = new VisitNoteDetailPage(targetPage);
    const detailDetected = await detailPage.isLoaded();
    const detailSurface = await detailPage.mapSurface(detailDetected);
    const postOpenClassification = classifyQueueRowSnapshot({
      ...processContext.snapshot,
      openedUrl,
      detailPageType: detailSurface.pageType,
    });
    const documentExtraction = await extractDocument(targetPage, {
      includeSamples: input.options.captureSectionSamples,
      expectedDocumentKinds: getExpectedDocumentKindsForRow(processContext.snapshot),
    });
    const dangerousControlDiagnostics = await detectDangerousControls({
      page: targetPage,
      documentKind: documentExtraction.documentKind,
    });
    const extractionHealth = await runSelectorHealthChecks({
      page: targetPage,
      documentKind: documentExtraction.documentKind,
      phase: "EXTRACTION",
    });
    const extractionTrace = appendExecutionTrace(undefined,
      buildTraceEvent({
        phase: "QUEUE_PIPELINE",
        event: "PAGE_OPENED",
        status: "COMPLETED",
        documentKind: documentExtraction.documentKind,
        detail: "Queue row opened for document processing.",
      }),
      buildTraceEvent({
        phase: "EXTRACTION",
        event: "DOCUMENT_KIND_DETECTED",
        status: "COMPLETED",
        documentKind: documentExtraction.documentKind,
        detail: `Document kind resolved as ${documentExtraction.documentKind}.`,
      }),
      buildTraceEvent({
        phase: "EXTRACTION",
        event: "EXTRACTION_COMPLETED",
        status: "COMPLETED",
        documentKind: documentExtraction.documentKind,
        detail: `Extraction completed with ${documentExtraction.warnings.length} warning(s).`,
      }),
    );

    if (!postOpenClassification.isTarget && !shouldTreatAsProcessedDocument(processContext.snapshot, documentExtraction.documentKind)) {
      queuePageState = await safelyReturnToQueue({
        queuePageState,
        targetPage,
        openedInNewTab: itemTransition.transition.newTabDetected,
        revisitQueueBetweenRows: input.options.revisitQueueBetweenRows,
      });

      return {
        queuePageState,
        result: withObservability(
          buildSkippedResult(processContext, postOpenClassification, openResult, undefined, documentExtraction),
          {
            runtimeDiagnostics: [...dangerousControlDiagnostics, ...extractionHealth.runtimeDiagnostics],
            selectorHealth: extractionHealth.selectorHealth,
            driftSignals: extractionHealth.driftSignals,
            executionTrace: extractionTrace,
          },
        ),
      };
    }

    if (!detailDetected && documentExtraction.documentKind === "UNKNOWN") {
      queuePageState = await safelyReturnToQueue({
        queuePageState,
        targetPage,
        openedInNewTab: itemTransition.transition.newTabDetected,
        revisitQueueBetweenRows: input.options.revisitQueueBetweenRows,
      });

      return {
        queuePageState,
        result: withObservability(
          buildErrorResult(
            processContext,
            buildQueueQaPipelineError(
              "NOTE_PAGE_VALIDATION_FAILED",
              "The opened page did not validate as a supported document detail page.",
              true,
            ),
            openResult,
            documentExtraction,
          ),
          {
            runtimeDiagnostics: [...dangerousControlDiagnostics, ...extractionHealth.runtimeDiagnostics],
            selectorHealth: extractionHealth.selectorHealth,
            driftSignals: extractionHealth.driftSignals,
            executionTrace: extractionTrace,
          },
        ),
      };
    }

    const qaResult = documentExtraction.documentKind === "VISIT_NOTE"
      ? await detailPage.extractQaReport({
          includeSamples: input.options.captureSectionSamples,
        })
      : null;

    queuePageState = await safelyReturnToQueue({
      queuePageState,
      targetPage,
      openedInNewTab: itemTransition.transition.newTabDetected,
      revisitQueueBetweenRows: input.options.revisitQueueBetweenRows,
    });

    return {
      queuePageState,
      result: {
        rowIndex: processContext.snapshot.rowIndex,
        rowFingerprint: processContext.snapshot.rowFingerprint,
        classification: postOpenClassification,
        queueContext: processContext.queueContext,
        openResult: {
          ...openResult,
          success: true,
        },
        documentExtraction,
        crossDocumentQa: emptyCrossDocumentQaResult(),
        qaResult,
        decisionResult: emptyQaDecisionResult(),
        writeExecutionResult: emptyWriteExecutionResult(),
        workflowSupport: getWorkflowSupport({
          documentKind: documentExtraction.documentKind,
          targetField: null,
        }),
        workflowCompletionResult: emptyWorkflowCompletionResult({
          mode: input.options.workflowMode ?? "DRY_RUN",
          documentKind: documentExtraction.documentKind,
          workflowSupport: getWorkflowSupport({
            documentKind: documentExtraction.documentKind,
            targetField: null,
          }),
          bundleConfidence: "LOW",
          decisionConfidence: "LOW",
        }),
        runtimeDiagnostics: [...dangerousControlDiagnostics, ...extractionHealth.runtimeDiagnostics],
        selectorHealth: extractionHealth.selectorHealth,
        driftSignals: extractionHealth.driftSignals,
        retryAttempts: [],
        executionTrace: extractionTrace,
        supportMatrixDiagnostics: [],
        status: "PROCESSED",
      },
    };
  } catch (error: unknown) {
    input.logger.error("Phase 12 queue row failed.", {
      pageNumber: processContext.snapshot.pageNumber,
      rowIndex: processContext.snapshot.rowIndex,
      errorCode: mapRowFailureToPipelineError(error).code,
      errorMessage: buildSafeRowLogMessage(error),
    });

    return {
      queuePageState,
      result: buildErrorResult(
        processContext,
        mapRowFailureToPipelineError(error),
        openResult,
        undefined,
      ),
    };
  }
}

async function reacquireQueueRow(
  queuePage: QaMonitoringQueuePage,
  snapshot: NormalizedQueueRowSnapshot,
): Promise<ResolvedQaQueueRow | null> {
  const byFingerprint = await queuePage.findVisibleRowByFingerprint(snapshot.rowFingerprint);
  if (byFingerprint) {
    return byFingerprint;
  }

  const visibleRows = await queuePage.getVisibleRows();
  return visibleRows.find((row) =>
    row.snapshot.documentDesc === snapshot.documentDesc &&
    row.snapshot.type === snapshot.type &&
    row.snapshot.date === snapshot.date,
  ) ?? null;
}

async function navigateToRequestedStartPage(
  queuePageState: QueuePageState,
  startPage: number,
  warnings: QueueQaPipelineWarning[],
): Promise<QueuePageState> {
  if (startPage <= 1) {
    return queuePageState;
  }

  const directNavigation = await queuePageState.queuePage.goToPage(startPage);
  if (directNavigation) {
    return refreshQueuePageState(
      queuePageState,
      await queuePageState.queuePage.getCurrentPageNumber(),
    );
  }

  while (queuePageState.currentPage < startPage) {
    const moved = await queuePageState.queuePage.goToNextPage();
    if (!moved) {
      warnings.push({
        code: "START_PAGE_NOT_REACHED",
        message: `Queue pagination could not reach requested startPage=${startPage}.`,
        rowIndex: null,
        rowFingerprint: null,
      });
      return queuePageState;
    }

    queuePageState = refreshQueuePageState(queuePageState, queuePageState.currentPage + 1);
  }

  return queuePageState;
}

async function persistQueueRunState(
  options: QueueQaPipelineResolvedOptions,
  currentState: QueueQaRunState | null,
  currentPage: number,
  lastProcessedFingerprint: string | null,
  processedFingerprints: Set<string>,
): Promise<void> {
  if (!options.statePath || !currentState) {
    return;
  }

  const updatedState = updateQueueQaRunState(currentState, {
    currentPage,
    processedFingerprints,
    lastProcessedFingerprint,
    updatedAt: new Date().toISOString(),
  });
  await saveQueueQaRunState(options.statePath, updatedState);
  Object.assign(currentState, updatedState);
}

async function finalizePersistedRunState(
  options: QueueQaPipelineResolvedOptions,
  currentState: QueueQaRunState | null,
  currentPage: number,
  processedFingerprints: Set<string>,
): Promise<void> {
  if (!options.statePath || !currentState) {
    return;
  }

  const updatedState = updateQueueQaRunState(currentState, {
    currentPage,
    processedFingerprints,
    lastProcessedFingerprint: currentState.lastProcessedFingerprint,
    updatedAt: new Date().toISOString(),
  });
  await saveQueueQaRunState(options.statePath, updatedState);
}

function refreshQueuePageState(
  queuePageState: QueuePageState,
  currentPage: number,
): QueuePageState {
  return {
    queuePageHandle: queuePageState.queuePageHandle,
    queuePage: new QaMonitoringQueuePage(queuePageState.queuePageHandle),
    queueUrl: queuePageState.queuePageHandle.url(),
    currentPage,
  };
}

async function safelyReturnToQueue(input: {
  queuePageState: QueuePageState;
  targetPage: Page;
  openedInNewTab: boolean;
  revisitQueueBetweenRows: boolean;
}): Promise<QueuePageState> {
  try {
    let queuePageHandle = input.queuePageState.queuePageHandle;

    if (input.openedInNewTab && input.targetPage !== queuePageHandle) {
      await input.targetPage.close().catch(() => undefined);
      if (queuePageHandle.isClosed()) {
        queuePageHandle = await createReplacementQueuePage(queuePageHandle, input.queuePageState.queueUrl);
      } else {
        await queuePageHandle.bringToFront().catch(() => undefined);
      }
    }

    if (queuePageHandle.isClosed()) {
      queuePageHandle = await createReplacementQueuePage(queuePageHandle, input.queuePageState.queueUrl);
    }

    if (
      !input.openedInNewTab ||
      input.revisitQueueBetweenRows ||
      !isQueueUrl(queuePageHandle.url())
    ) {
      await queuePageHandle.goto(input.queuePageState.queueUrl, { waitUntil: "domcontentloaded" });
    }

    await waitForPageSettled(queuePageHandle, 300);
    const queuePage = new QaMonitoringQueuePage(queuePageHandle);
    if (!(await queuePage.waitUntilReady(5_000))) {
      await queuePageHandle.goto(input.queuePageState.queueUrl, { waitUntil: "domcontentloaded" });
      await waitForPageSettled(queuePageHandle, 300);
    }

    if (!(await queuePage.waitUntilReady(5_000))) {
      throw new Error("QA Monitoring queue was not ready after returning from the note page.");
    }

    return {
      queuePageHandle,
      queuePage,
      queueUrl: queuePageHandle.url(),
      currentPage: await queuePage.getCurrentPageNumber(),
    };
  } catch (error: unknown) {
    throw new WorkflowError(
      "RETURN_TO_QUEUE_FAILED",
      error instanceof Error ? error.message : "Failed to return to the queue after note processing.",
      true,
    );
  }
}

async function prepareTargetPage(page: Page, openedInNewTab: boolean): Promise<void> {
  if (openedInNewTab) {
    await page.bringToFront().catch(() => undefined);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
  await waitForPageSettled(page, openedInNewTab ? 500 : 250);
}

function deriveSkipReason(
  snapshot: QueueRowSnapshot,
  classification: QueueQaRowClassification,
): QueueQaSkipReason {
  if (classification.reason.includes("non-visit-note document route")) {
    return "NON_TARGET_URL";
  }

  if (classification.reason.includes("detail page resolved")) {
    return "NON_TARGET_DETAIL_PAGE";
  }

  if (snapshot.documentType === "ORDER" || snapshot.documentType === "PLAN_OF_CARE" || snapshot.documentType === "OASIS") {
    return "NON_TARGET_DOCUMENT_TYPE";
  }

  if (classification.confidence === "high") {
    return "NON_TARGET_DOCUMENT_TYPE";
  }

  return "INSUFFICIENT_TARGET_EVIDENCE";
}

function isVisitNoteUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.includes("/documents/note/visitnote/");
}

function shouldProcessReadableDocument(snapshot: NormalizedQueueRowSnapshot): boolean {
  return snapshot.documentType === "PLAN_OF_CARE" ||
    snapshot.documentType === "ORDER" ||
    snapshot.documentType === "OASIS";
}

function getExpectedDocumentKindsForRow(
  snapshot: NormalizedQueueRowSnapshot,
): readonly import("@medical-ai-qa/shared-types").DocumentKind[] {
  switch (snapshot.documentType) {
    case "VISIT_NOTE":
      return ["VISIT_NOTE"];
    case "OASIS":
      return ["OASIS"];
    case "PLAN_OF_CARE":
      return ["PLAN_OF_CARE"];
    case "ORDER":
      return ["ADMISSION_ORDER", "PHYSICIAN_ORDER"];
    case "UNKNOWN":
    default:
      return [];
  }
}

function shouldTreatAsProcessedDocument(
  snapshot: NormalizedQueueRowSnapshot,
  documentKind: string,
): boolean {
  return isReadableDocumentKind(documentKind as Parameters<typeof isReadableDocumentKind>[0]) ||
    shouldProcessReadableDocument(snapshot);
}

function isQueueUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /\/document-tracking/i.test(value) && /page=forQA/i.test(value);
}

function isExtractionError(error: unknown): boolean {
  return error instanceof Error && /extract|section|visit note/i.test(error.message);
}

function mapRowFailureToPipelineError(error: unknown) {
  if (error instanceof WorkflowError && error.code === "RETURN_TO_QUEUE_FAILED") {
    return buildQueueQaPipelineError(
      "RETURN_TO_QUEUE_FAILED",
      sanitizePipelineErrorMessage(error.message),
      error.retryable,
    );
  }

  if (isExtractionError(error)) {
    return buildQueueQaPipelineError(
      "EXTRACTION_FAILED",
      sanitizePipelineErrorMessage(
        error instanceof Error ? error.message : "Document extraction failed.",
      ),
      true,
    );
  }

  return buildQueueQaPipelineError(
    "NOTE_OPEN_FAILED",
    sanitizePipelineErrorMessage(
      error instanceof Error ? error.message : "Document processing failed.",
    ),
    true,
  );
}

function buildSkippedResult(
  processContext: QueueQaPipelineProcessContext,
  classification: QueueQaRowClassification,
  openResult?: {
    success: boolean;
    openedUrl: string | null;
    openedInNewTab: boolean;
  },
  skipReason?: QueueQaSkipReason,
  documentExtraction?: import("@medical-ai-qa/shared-types").DocumentExtraction,
): QueueQaRowProcessResult {
  return {
    rowIndex: processContext.snapshot.rowIndex,
    rowFingerprint: processContext.snapshot.rowFingerprint,
    classification,
    queueContext: processContext.queueContext,
    openResult,
    documentExtraction,
    crossDocumentQa: undefined,
    decisionResult: undefined,
    writeExecutionResult: undefined,
    status: "SKIPPED",
    skipReason: skipReason ?? deriveSkipReason(processContext.snapshot, classification),
  };
}

function buildErrorResult(
  processContext: QueueQaPipelineProcessContext,
  error: ReturnType<typeof buildQueueQaPipelineError>,
  openResult?: {
    success: boolean;
    openedUrl: string | null;
    openedInNewTab: boolean;
  },
  documentExtraction?: import("@medical-ai-qa/shared-types").DocumentExtraction,
): QueueQaRowProcessResult {
  return {
    rowIndex: processContext.snapshot.rowIndex,
    rowFingerprint: processContext.snapshot.rowFingerprint,
    classification: processContext.snapshot.classification,
    queueContext: processContext.queueContext,
    openResult,
    documentExtraction,
    crossDocumentQa: undefined,
    decisionResult: undefined,
    writeExecutionResult: undefined,
    status: "ERROR",
    error,
  };
}

function applyCrossDocumentQaToResults(
  results: QueueQaRowProcessResult[],
): QueueQaRowProcessResult[] {
  const processedRows = results.filter((result): result is Extract<QueueQaRowProcessResult, { status: "PROCESSED" }> =>
    result.status === "PROCESSED",
  );

  if (processedRows.length === 0) {
    return results;
  }

  const processedDescriptors = processedRows.map((result, index) => ({
    result,
    index,
    patientKey: result.queueContext.patientDisplayNameMasked ?? `row:${result.rowFingerprint}`,
    comparableDate: parseComparableDate(result.queueContext.date ?? result.documentExtraction.metadata.visitDate),
  }));

  return results.map((result) => {
    if (result.status !== "PROCESSED") {
      return result;
    }

    const currentDescriptor = processedDescriptors.find((descriptor) => descriptor.result.rowFingerprint === result.rowFingerprint);
    if (!currentDescriptor) {
      return result;
    }

    const peerDescriptors = processedDescriptors.filter((descriptor) => descriptor.patientKey === currentDescriptor.patientKey);
    const bundle = buildCrossDocumentBundle(currentDescriptor, peerDescriptors);
    const crossDocumentQa = runCrossDocumentQaEngine(bundle);
    const decisionResult = runQaDecisionEngine({
      currentDocument: result.documentExtraction,
      qaResult: result.qaResult,
      crossDocumentQa,
      bundle,
      rowContext: result.queueContext,
    });

    return {
      ...result,
      crossDocumentQa,
      decisionResult,
      executionTrace: appendExecutionTrace(
        result.executionTrace,
        buildTraceEvent({
          phase: "COMPARISON",
          event: "CROSS_DOCUMENT_QA_COMPLETED",
          status: "COMPLETED",
          documentKind: result.documentExtraction.documentKind,
          detail: `Cross-document QA produced ${crossDocumentQa.mismatches.length} mismatch(es).`,
        }),
        buildTraceEvent({
          phase: "DECISION",
          event: "DECISION_GENERATED",
          status: decisionResult.decisions.length > 0 ? "COMPLETED" : "SKIPPED",
          documentKind: result.documentExtraction.documentKind,
          detail: `Decision engine produced ${decisionResult.decisions.length} decision(s).`,
        }),
      ),
    };
  });
}

async function applyWriteExecutionToResults(input: {
  results: QueueQaRowProcessResult[];
  queuePageState: QueuePageState;
  options: QueueQaPipelineResolvedOptions;
  safetyMode: import("@medical-ai-qa/shared-types").PortalSafetyMode;
  logger: Logger;
  warnings: QueueQaPipelineWarning[];
}): Promise<{
  results: QueueQaRowProcessResult[];
  queuePageState: QueuePageState;
}> {
  const config = resolveWriteExecutionConfig({
    ...input.options,
    safetyMode: input.safetyMode,
  });
  const workflowConfig = resolveWorkflowExecutionConfig({
    ...input.options,
    safetyMode: input.safetyMode,
  });
  let queuePageState = input.queuePageState;
  let writesAttemptedSoFar = 0;
  const updatedResults: QueueQaRowProcessResult[] = [];

  for (const result of input.results) {
    if (result.status !== "PROCESSED" || result.decisionResult.decisions.length === 0) {
      updatedResults.push(result);
      continue;
    }

    const rowExecution = await executeWritesForProcessedRow({
      result,
      queuePageState,
      config,
      workflowConfig,
      writesAttemptedSoFar,
      logger: input.logger,
    });

    queuePageState = rowExecution.queuePageState;
    writesAttemptedSoFar += rowExecution.eligibleAttemptCount;
    updatedResults.push({
      ...result,
      writeExecutionResult: rowExecution.writeExecutionResult,
      workflowSupport: rowExecution.workflowCompletionResult.workflowSupport ?? result.workflowSupport,
      workflowCompletionResult: rowExecution.workflowCompletionResult,
      runtimeDiagnostics: [...(result.runtimeDiagnostics ?? []), ...rowExecution.runtimeDiagnostics],
      selectorHealth: [...(result.selectorHealth ?? []), ...rowExecution.selectorHealth],
      driftSignals: [...(result.driftSignals ?? []), ...rowExecution.driftSignals],
      retryAttempts: [...(result.retryAttempts ?? []), ...rowExecution.retryAttempts],
      executionTrace: rowExecution.executionTrace,
      supportMatrixDiagnostics: [
        ...(result.supportMatrixDiagnostics ?? []),
        ...rowExecution.supportMatrixDiagnostics,
      ],
    });

    input.logger.info("Phase 17 workflow completion evaluated.", {
      rowIndex: result.rowIndex,
      documentKind: rowExecution.workflowCompletionResult.documentKind,
      targetField: rowExecution.workflowCompletionResult.targetField,
      status: rowExecution.workflowCompletionResult.status,
      mode: rowExecution.workflowCompletionResult.mode,
      guardFailures: rowExecution.workflowCompletionResult.guardFailures,
      operatorCheckpointRequired: rowExecution.workflowCompletionResult.operatorCheckpoint?.required ?? false,
      bundleConfidence: rowExecution.workflowCompletionResult.audit.bundleConfidence,
      decisionConfidence: rowExecution.workflowCompletionResult.audit.decisionConfidence,
      steps: rowExecution.workflowCompletionResult.steps.map((step) => ({
        action: step.action,
        status: step.status,
        verificationPassed: step.verificationPassed,
        guardFailures: step.guardFailures,
      })),
    });

    if (rowExecution.stopRequested) {
      input.warnings.push({
        code: rowExecution.stopReason === "WORKFLOW_FAILURE"
          ? "STOPPED_ON_WORKFLOW_FAILURE"
          : "STOPPED_ON_WRITE_FAILURE",
        message: rowExecution.stopReason === "WORKFLOW_FAILURE"
          ? "Workflow execution stopped after a row-level workflow failure because stopOnWorkflowFailure=true."
          : "Write execution stopped after a row-level write failure because stopOnWriteFailure=true.",
        rowIndex: result.rowIndex,
        rowFingerprint: result.rowFingerprint,
      });

      updatedResults.push(...input.results.slice(updatedResults.length));
      break;
    }
  }

  return {
    results: updatedResults,
    queuePageState,
  };
}

async function executeWritesForProcessedRow(input: {
  result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
  queuePageState: QueuePageState;
  config: ReturnType<typeof resolveWriteExecutionConfig>;
  workflowConfig: ReturnType<typeof resolveWorkflowExecutionConfig>;
  writesAttemptedSoFar: number;
  logger: Logger;
}): Promise<{
  writeExecutionResult: import("@medical-ai-qa/shared-types").WriteExecutionResult;
  workflowCompletionResult: import("@medical-ai-qa/shared-types").WorkflowCompletionResult;
  runtimeDiagnostics: NonNullable<QueueQaRowProcessResult["runtimeDiagnostics"]>;
  selectorHealth: NonNullable<QueueQaRowProcessResult["selectorHealth"]>;
  driftSignals: NonNullable<QueueQaRowProcessResult["driftSignals"]>;
  retryAttempts: NonNullable<QueueQaRowProcessResult["retryAttempts"]>;
  executionTrace: NonNullable<QueueQaRowProcessResult["executionTrace"]>;
  supportMatrixDiagnostics: NonNullable<QueueQaRowProcessResult["supportMatrixDiagnostics"]>;
  eligibleAttemptCount: number;
  queuePageState: QueuePageState;
  stopRequested: boolean;
  stopReason: "WRITE_FAILURE" | "WORKFLOW_FAILURE" | null;
}> {
  const candidateDecisions = input.result.decisionResult.decisions.filter(shouldConsiderDecisionForWrite);
  const supportReferenceDecision = candidateDecisions[0] ?? null;
  const supportReferenceTargetField = supportReferenceDecision?.proposedAction.targetField ?? null;
  const resolvedWorkflowSupport = getWorkflowSupport({
    documentKind: input.result.documentExtraction.documentKind,
    targetField: supportReferenceTargetField,
  });
  const supportMatrixDiagnostics = supportReferenceTargetField
    ? buildWorkflowSupportDiagnostics({
      workflowSupport: resolvedWorkflowSupport,
      actions: uniqueWorkflowActions(resolvedWorkflowSupport),
    })
    : [];
  if (candidateDecisions.length === 0) {
    return {
      writeExecutionResult: emptyWriteExecutionResult(),
      workflowCompletionResult: emptyWorkflowCompletionResult({
        mode: input.workflowConfig.mode,
        documentKind: input.result.documentExtraction.documentKind,
        bundleConfidence: input.result.crossDocumentQa.bundleConfidence,
        decisionConfidence: "LOW",
      }),
      runtimeDiagnostics: [],
      selectorHealth: [],
      driftSignals: [],
      retryAttempts: [],
      executionTrace: appendExecutionTrace(
        input.result.executionTrace,
        buildTraceEvent({
          phase: "WRITE_EXECUTION",
          event: "WRITE_SKIPPED",
          status: "SKIPPED",
          documentKind: input.result.documentExtraction.documentKind,
          detail: "No write-eligible decisions were present for this row.",
        }),
      ),
      supportMatrixDiagnostics: [],
      eligibleAttemptCount: 0,
      queuePageState: input.queuePageState,
      stopRequested: false,
      stopReason: null,
    };
  }

  const attempts: import("@medical-ai-qa/shared-types").WriteExecutionAttempt[] = [];
  const executableDecisions: typeof candidateDecisions = [];
  let writesAttemptedSoFar = input.writesAttemptedSoFar;

  for (const decision of candidateDecisions) {
    const guardEvaluation = evaluateWriteGuards({
      decision,
      bundleConfidence: input.result.crossDocumentQa.bundleConfidence,
      currentDocumentKind: input.result.documentExtraction.documentKind,
      config: input.config,
      writesAttemptedSoFar,
    });

    if (!guardEvaluation.eligible) {
      attempts.push(buildBlockedWriteAttempt({
        decision,
        mode: input.config.mode,
        eligibility: guardEvaluation.eligibility,
        guardFailures: guardEvaluation.reasons,
        bundleConfidence: input.result.crossDocumentQa.bundleConfidence,
      }));
      continue;
    }

    executableDecisions.push(decision);
    writesAttemptedSoFar += 1;
  }

  if (executableDecisions.length === 0) {
    const writeExecutionResult = buildWriteExecutionResult(attempts);
    return {
      writeExecutionResult,
      workflowCompletionResult: await executeWorkflowCompletion({
        page: null,
        currentDocumentKind: input.result.documentExtraction.documentKind,
        crossDocumentQa: input.result.crossDocumentQa,
        decisionResult: input.result.decisionResult,
        writeExecutionResult,
        config: input.workflowConfig,
      }),
      runtimeDiagnostics: mapSupportMatrixDiagnosticsToRuntimeDiagnostics(supportMatrixDiagnostics),
      selectorHealth: [],
      driftSignals: [],
      retryAttempts: [],
      executionTrace: appendExecutionTrace(
        input.result.executionTrace,
        buildTraceEvent({
          phase: "WRITE_EXECUTION",
          event: "WRITE_BLOCKED",
          status: "BLOCKED",
          documentKind: input.result.documentExtraction.documentKind,
          targetField: supportReferenceTargetField,
          detail: `All write candidates were blocked before page execution.`,
        }),
      ),
      supportMatrixDiagnostics,
      eligibleAttemptCount: writesAttemptedSoFar - input.writesAttemptedSoFar,
      queuePageState: input.queuePageState,
      stopRequested: false,
      stopReason: null,
    };
  }

  const openOutcome = await openProcessedRowForWrite(input.queuePageState, input.result);
  let queuePageState = openOutcome.queuePageState;

  if (!openOutcome.targetPage) {
    const failedAttempts = executableDecisions.map((decision) =>
      buildBlockedWriteAttempt({
        decision,
        mode: input.config.mode,
        eligibility: "REVIEW_REQUIRED",
        guardFailures: ["CURRENT_VALUE_UNVERIFIED"],
        bundleConfidence: input.result.crossDocumentQa.bundleConfidence,
      }),
    );
    const writeExecutionResult = buildWriteExecutionResult([...attempts, ...failedAttempts]);

    return {
      writeExecutionResult,
      workflowCompletionResult: await executeWorkflowCompletion({
        page: null,
        currentDocumentKind: input.result.documentExtraction.documentKind,
        crossDocumentQa: input.result.crossDocumentQa,
        decisionResult: input.result.decisionResult,
        writeExecutionResult,
        config: input.workflowConfig,
      }),
      runtimeDiagnostics: [{
        timestamp: new Date().toISOString(),
        severity: "ERROR",
        category: "WRITE_EXECUTION",
        code: "EXECUTABLE_CONTROL_MISSING",
        message: "Target page could not be re-opened for an otherwise eligible write path.",
        phase: "WRITE_EXECUTION",
        documentKind: input.result.documentExtraction.documentKind,
        action: null,
        targetField: supportReferenceTargetField,
        selectorName: null,
        supportLevel: resolvedWorkflowSupport.supportLevel,
        supportDisposition: "EXECUTABLE",
      }],
      selectorHealth: [],
      driftSignals: [],
      retryAttempts: [],
      executionTrace: appendExecutionTrace(
        input.result.executionTrace,
        buildTraceEvent({
          phase: "WRITE_EXECUTION",
          event: "WRITE_OPEN_BLOCKED",
          status: "BLOCKED",
          documentKind: input.result.documentExtraction.documentKind,
          targetField: supportReferenceTargetField,
          detail: "Eligible write path could not reopen the target page.",
        }),
      ),
      supportMatrixDiagnostics,
      eligibleAttemptCount: writesAttemptedSoFar - input.writesAttemptedSoFar,
      queuePageState,
      stopRequested: false,
      stopReason: null,
    };
  }

  let stopRequested = false;
  const retryAttempts: NonNullable<QueueQaRowProcessResult["retryAttempts"]> = [];
  const writeSupportDisposition = resolveWriteSupportDisposition({
    documentKind: input.result.documentExtraction.documentKind,
    targetField: supportReferenceTargetField,
  });
  const writeSelectorHealth = supportReferenceTargetField
    ? await runSelectorHealthChecks({
      page: openOutcome.targetPage,
      documentKind: input.result.documentExtraction.documentKind,
      phase: "WRITE_EXECUTION",
      targetField: supportReferenceTargetField,
      supportDisposition: writeSupportDisposition,
      supportDiagnostics: supportMatrixDiagnostics,
    })
    : emptySelectorHealthRun();
  const workflowSelectorHealthRuns = await Promise.all(
    uniqueWorkflowActions(resolvedWorkflowSupport).map((action) =>
      runSelectorHealthChecks({
        page: openOutcome.targetPage!,
        documentKind: input.result.documentExtraction.documentKind,
        phase: "WORKFLOW_EXECUTION",
        action,
        targetField: supportReferenceTargetField,
        supportDisposition: resolvedWorkflowSupport.executableActions.includes(action)
          ? "EXECUTABLE"
          : resolvedWorkflowSupport.reviewGatedActions.includes(action)
            ? "REVIEW_GATED"
            : "NOT_SUPPORTED",
        supportDiagnostics: supportMatrixDiagnostics,
      })
    ),
  );
  let workflowCompletionResult = emptyWorkflowCompletionResult({
    mode: input.workflowConfig.mode,
    documentKind: input.result.documentExtraction.documentKind,
    targetField: supportReferenceTargetField,
    workflowSupport: resolvedWorkflowSupport,
    bundleConfidence: input.result.crossDocumentQa.bundleConfidence,
    decisionConfidence: "LOW",
  });

  try {
    for (const decision of executableDecisions) {
      const attempt = await executeWriteDecision({
        page: openOutcome.targetPage,
        decision,
        bundleConfidence: input.result.crossDocumentQa.bundleConfidence,
        currentDocumentKind: input.result.documentExtraction.documentKind,
        config: input.config,
        writesAttemptedSoFar: input.writesAttemptedSoFar,
        onRetryRecord: (record) => retryAttempts.push(record),
      });

      attempts.push(attempt);
      input.logger.info("Phase 16 write attempt completed.", {
        rowIndex: input.result.rowIndex,
        targetDocumentKind: attempt.targetDocumentKind,
        targetField: attempt.targetField,
        status: attempt.status,
        guardFailures: attempt.guardFailures,
        verificationPassed: attempt.verificationPassed,
        mode: attempt.mode,
        decisionConfidence: attempt.audit.decisionConfidence,
        bundleConfidence: attempt.audit.bundleConfidence,
      });

      if (
        input.config.stopOnWriteFailure &&
        (attempt.status === "FAILED" || attempt.status === "VERIFICATION_FAILED")
      ) {
        stopRequested = true;
        break;
      }
    }

    const writeExecutionResult = buildWriteExecutionResult(attempts);
    workflowCompletionResult = await executeWorkflowCompletion({
      page: openOutcome.targetPage,
      currentDocumentKind: input.result.documentExtraction.documentKind,
      crossDocumentQa: input.result.crossDocumentQa,
      decisionResult: input.result.decisionResult,
      writeExecutionResult,
      config: input.workflowConfig,
      onRetryRecord: (record) => retryAttempts.push(record),
    });

    if (
      input.workflowConfig.stopOnFailure &&
      workflowCompletionResult.status === "FAILED"
    ) {
      stopRequested = true;
    }
  } finally {
    queuePageState = await safelyReturnToQueue({
      queuePageState,
      targetPage: openOutcome.targetPage,
      openedInNewTab: openOutcome.openedInNewTab,
      revisitQueueBetweenRows: true,
    });
  }

  const writeExecutionResult = buildWriteExecutionResult(attempts);

  return {
    writeExecutionResult,
    workflowCompletionResult,
    runtimeDiagnostics: [
      ...writeSelectorHealth.runtimeDiagnostics,
      ...workflowSelectorHealthRuns.flatMap((run) => run.runtimeDiagnostics),
      ...mapSupportMatrixDiagnosticsToRuntimeDiagnostics(supportMatrixDiagnostics),
    ],
    selectorHealth: [
      ...writeSelectorHealth.selectorHealth,
      ...workflowSelectorHealthRuns.flatMap((run) => run.selectorHealth),
    ],
    driftSignals: [
      ...writeSelectorHealth.driftSignals,
      ...workflowSelectorHealthRuns.flatMap((run) => run.driftSignals),
    ],
    retryAttempts,
    executionTrace: appendExecutionTrace(
      input.result.executionTrace,
      ...buildObservabilityTraceEvents({
        runtimeDiagnostics: [
          ...writeSelectorHealth.runtimeDiagnostics,
          ...workflowSelectorHealthRuns.flatMap((run) => run.runtimeDiagnostics),
          ...mapSupportMatrixDiagnosticsToRuntimeDiagnostics(supportMatrixDiagnostics),
        ],
        driftSignals: [
          ...writeSelectorHealth.driftSignals,
          ...workflowSelectorHealthRuns.flatMap((run) => run.driftSignals),
        ],
        documentKind: input.result.documentExtraction.documentKind,
        targetField: supportReferenceTargetField,
      }),
      buildTraceEvent({
        phase: "WRITE_EXECUTION",
        event: "WRITE_COMPLETED",
        status: writeExecutionResult.summary.writesVerified > 0
          ? "VERIFIED"
          : writeExecutionResult.summary.writeFailures > 0
            ? "FAILED"
            : writeExecutionResult.summary.writesBlocked > 0
              ? "BLOCKED"
              : "SKIPPED",
        documentKind: input.result.documentExtraction.documentKind,
        targetField: supportReferenceTargetField,
        detail: `Write execution produced ${writeExecutionResult.summary.writeAttempts} attempt(s).`,
      }),
      buildTraceEvent({
        phase: "WORKFLOW_EXECUTION",
        event: "WORKFLOW_COMPLETED",
        status: workflowCompletionResult.status === "COMPLETED"
          ? "VERIFIED"
          : workflowCompletionResult.status === "FAILED"
            ? "FAILED"
            : workflowCompletionResult.status === "BLOCKED"
              ? "BLOCKED"
              : workflowCompletionResult.status === "REVIEW_REQUIRED"
                ? "WARNING"
                : "SKIPPED",
        documentKind: workflowCompletionResult.documentKind,
        targetField: workflowCompletionResult.targetField,
        detail: `Workflow completion ended with status ${workflowCompletionResult.status}.`,
      }),
    ),
    supportMatrixDiagnostics,
    eligibleAttemptCount: writesAttemptedSoFar - input.writesAttemptedSoFar,
    queuePageState,
    stopRequested,
    stopReason: workflowCompletionResult.status === "FAILED" ? "WORKFLOW_FAILURE" : stopRequested ? "WRITE_FAILURE" : null,
  };
}

async function openProcessedRowForWrite(
  queuePageState: QueuePageState,
  result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>,
): Promise<{
  queuePageState: QueuePageState;
  targetPage: Page | null;
  openedInNewTab: boolean;
}> {
  const targetPageNumber = result.queueContext.pageNumber;
  if (queuePageState.currentPage !== targetPageNumber) {
    const moved = await queuePageState.queuePage.goToPage(targetPageNumber);
    if (!moved) {
      return {
        queuePageState,
        targetPage: null,
        openedInNewTab: false,
      };
    }

    queuePageState = refreshQueuePageState(
      queuePageState,
      await queuePageState.queuePage.getCurrentPageNumber(),
    );
  }

  const resolvedRow = await reacquireQueueRow(
    queuePageState.queuePage,
    buildNormalizedSnapshotFromProcessedResult(result),
  );
  if (!resolvedRow) {
    return {
      queuePageState,
      targetPage: null,
      openedInNewTab: false,
    };
  }

  const target = queuePageState.queuePage.selectPreferredTarget(resolvedRow);
  if (!target) {
    return {
      queuePageState,
      targetPage: null,
      openedInNewTab: false,
    };
  }

  const transition = await analyzeClickTransition(queuePageState.queuePageHandle, target.locator);
  const targetPage = transition.targetPage;
  await prepareTargetPage(targetPage, transition.transition.newTabDetected);

  return {
    queuePageState,
    targetPage,
    openedInNewTab: transition.transition.newTabDetected,
  };
}

function withObservability<T extends QueueQaRowProcessResult>(
  result: T,
  observability: Partial<Pick<
    QueueQaRowProcessResult,
    | "runtimeDiagnostics"
    | "selectorHealth"
    | "driftSignals"
    | "retryAttempts"
    | "executionTrace"
    | "supportMatrixDiagnostics"
  >>,
): T {
  return {
    ...result,
    runtimeDiagnostics: observability.runtimeDiagnostics ?? result.runtimeDiagnostics ?? [],
    selectorHealth: observability.selectorHealth ?? result.selectorHealth ?? [],
    driftSignals: observability.driftSignals ?? result.driftSignals ?? [],
    retryAttempts: observability.retryAttempts ?? result.retryAttempts ?? [],
    executionTrace: observability.executionTrace ?? result.executionTrace ?? [],
    supportMatrixDiagnostics: observability.supportMatrixDiagnostics ?? result.supportMatrixDiagnostics ?? [],
  };
}

function mapSupportMatrixDiagnosticsToRuntimeDiagnostics(
  diagnostics: NonNullable<QueueQaRowProcessResult["supportMatrixDiagnostics"]>,
): RuntimeDiagnostic[] {
  return diagnostics
    .filter((entry) => entry.supportDisposition !== "EXECUTABLE")
    .map((entry) => ({
      timestamp: new Date().toISOString(),
      severity: entry.supportDisposition === "REVIEW_GATED" ? "WARNING" : "ERROR",
      category: "SUPPORT_MATRIX" as const,
      code: entry.supportDisposition === "REVIEW_GATED" ? "SUPPORT_LEVEL_BLOCKED" : "SUPPORT_LEVEL_UNSUPPORTED",
      message: entry.reason,
      phase: "WORKFLOW_GUARD" as const,
      documentKind: entry.documentKind,
      action: entry.action ?? null,
      targetField: entry.targetField ?? null,
      selectorName: null,
      supportLevel: entry.supportLevel,
      supportDisposition: entry.supportDisposition,
    }));
}

function emptySelectorHealthRun() {
  return {
    selectorHealth: [],
    runtimeDiagnostics: [],
    driftSignals: [],
  };
}

function uniqueWorkflowActions(
  workflowSupport: ReturnType<typeof getWorkflowSupport>,
) {
  const actions = [...new Set([
    ...workflowSupport.executableActions,
    ...workflowSupport.reviewGatedActions,
  ])];

  return actions.length > 0 ? actions : ([] as typeof actions);
}

function resolveWriteSupportDisposition(input: {
  documentKind: DocumentKind;
  targetField: string | null;
}) {
  const allowlistEntry = getWriteAllowlistEntry(input.documentKind, input.targetField);

  if (!allowlistEntry) {
    return "NOT_SUPPORTED" as const;
  }

  return allowlistEntry.allowedExecutionModes.includes("EXECUTE")
    ? "EXECUTABLE" as const
    : "DRY_RUN_ONLY" as const;
}

function buildObservabilityTraceEvents(input: {
  runtimeDiagnostics: RuntimeDiagnostic[];
  driftSignals: NonNullable<QueueQaRowProcessResult["driftSignals"]>;
  documentKind: DocumentKind;
  targetField: string | null;
}) {
  const diagnosticEvents = input.runtimeDiagnostics
    .filter((entry) => entry.severity !== "INFO")
    .slice(0, 5)
    .map((entry) =>
      buildTraceEvent({
        phase: entry.phase,
        event: entry.code,
        status: entry.severity === "WARNING" ? "WARNING" : "BLOCKED",
        documentKind: entry.documentKind ?? input.documentKind,
        action: entry.action ?? null,
        targetField: entry.targetField ?? input.targetField,
        selectorName: entry.selectorName ?? null,
        supportDisposition: entry.supportDisposition ?? null,
        detail: entry.message,
      }),
    );
  const driftEvents = input.driftSignals.slice(0, 5).map((signal) =>
    buildTraceEvent({
      phase: "WORKFLOW_EXECUTION",
      event: signal.type,
      status: "WARNING",
      documentKind: signal.documentKind,
      action: signal.action ?? null,
      targetField: signal.targetField ?? input.targetField,
      selectorName: signal.selectorName ?? null,
      supportDisposition: signal.supportDisposition ?? null,
      detail: signal.reason,
    }),
  );

  return [...diagnosticEvents, ...driftEvents];
}

function projectReportedResults(
  totalSourceResults: QueueQaRowProcessResult[],
  reportedResults: QueueQaRowProcessResult[],
): QueueQaRowProcessResult[] {
  const byKey = new Map(totalSourceResults.map((result) => [buildResultKey(result), result]));

  return reportedResults.map((result) => byKey.get(buildResultKey(result)) ?? result);
}

function buildResultKey(result: QueueQaRowProcessResult): string {
  return `${result.rowFingerprint}:${result.status}:${result.rowIndex}`;
}

function buildNormalizedSnapshotFromProcessedResult(
  result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>,
): NormalizedQueueRowSnapshot {
  return {
    pageNumber: result.queueContext.pageNumber,
    rowIndex: result.rowIndex,
    rowFingerprint: result.rowFingerprint,
    patientDisplayNameMasked: result.queueContext.patientDisplayNameMasked ?? null,
    documentDesc: result.queueContext.documentDesc,
    type: result.queueContext.type,
    date: result.queueContext.date,
    physician: result.queueContext.physician,
    documentType: result.queueContext.documentType,
    availableActions: result.queueContext.availableActions,
    queueUrl: result.queueContext.queueUrl,
    classification: result.classification,
    isTargetVisitNote: result.classification.isTarget,
    targetReason: result.classification.isTarget ? result.classification.reason : null,
    skipReason: null,
  };
}

function buildCrossDocumentBundle(
  current: {
    result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
    index: number;
    patientKey: string;
    comparableDate: number | null;
  },
  peers: Array<{
    result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
    index: number;
    patientKey: string;
    comparableDate: number | null;
  }>,
): {
  visitNote: DocumentExtraction | null;
  oasis: DocumentExtraction | null;
  planOfCare: DocumentExtraction | null;
  orders: DocumentExtraction[];
  bundleConfidence: CrossDocumentQaResult["bundleConfidence"];
  bundleReason: string | null;
} {
  const pickClosest = (documentKinds: readonly DocumentKind[]): DocumentExtraction | null => {
    if (documentKinds.includes(current.result.documentExtraction.documentKind)) {
      return current.result.documentExtraction;
    }

    const closest = peers
      .filter((peer) => documentKinds.includes(peer.result.documentExtraction.documentKind))
      .map((peer) => ({
        extraction: peer.result.documentExtraction,
        distance: compareDocumentDistance(current, peer),
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    return closest?.extraction ?? null;
  };

  const orders = peers
    .filter((peer) => peer.result.documentExtraction.documentKind === "ADMISSION_ORDER" || peer.result.documentExtraction.documentKind === "PHYSICIAN_ORDER")
    .sort((left, right) => compareDocumentDistance(current, left) - compareDocumentDistance(current, right))
    .map((peer) => peer.result.documentExtraction)
    .slice(0, 5);
  const peerDocumentCount = peers.filter((peer) => peer.result.rowFingerprint !== current.result.rowFingerprint).length;
  const bundleConfidence = determineBundleConfidence(current, peers, peerDocumentCount);
  const bundleReason = determineBundleReason(current, peers, bundleConfidence, peerDocumentCount);

  return {
    visitNote: pickClosest(["VISIT_NOTE"]),
    oasis: pickClosest(["OASIS"]),
    planOfCare: pickClosest(["PLAN_OF_CARE"]),
    orders,
    bundleConfidence,
    bundleReason,
  };
}

function determineBundleConfidence(
  current: {
    result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
    comparableDate: number | null;
  },
  peers: Array<{
    result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
    comparableDate: number | null;
  }>,
  peerDocumentCount: number,
): CrossDocumentQaResult["bundleConfidence"] {
  if (!current.result.queueContext.patientDisplayNameMasked) {
    return "LOW";
  }

  if (peerDocumentCount === 0) {
    return "LOW";
  }

  const datedPeers = peers.filter((peer) =>
    peer.result.rowFingerprint !== current.result.rowFingerprint &&
    peer.comparableDate !== null &&
    current.comparableDate !== null,
  );
  const closestDateDistance = datedPeers
    .map((peer) => Math.abs((peer.comparableDate ?? 0) - (current.comparableDate ?? 0)))
    .sort((left, right) => left - right)[0] ?? null;
  const fourteenDaysInMs = 14 * 24 * 60 * 60 * 1000;

  if (closestDateDistance !== null && closestDateDistance <= fourteenDaysInMs) {
    return "HIGH";
  }

  if (closestDateDistance !== null || peerDocumentCount > 0) {
    return "MEDIUM";
  }

  return "LOW";
}

function determineBundleReason(
  current: {
    result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
  },
  peers: Array<{
    result: Extract<QueueQaRowProcessResult, { status: "PROCESSED" }>;
  }>,
  bundleConfidence: CrossDocumentQaResult["bundleConfidence"],
  peerDocumentCount: number,
): string {
  if (!current.result.queueContext.patientDisplayNameMasked) {
    return "Bundle relied on row-order proximity because masked patient identity was unavailable.";
  }

  if (peerDocumentCount === 0) {
    return "No peer documents matched the current row, so only single-document context was available.";
  }

  switch (bundleConfidence) {
    case "HIGH":
      return "Bundle matched masked patient identity and nearby document dates.";
    case "MEDIUM":
      return "Bundle matched masked patient identity, but date alignment was incomplete or distant.";
    case "LOW":
    default:
      return `Bundle confidence stayed low across ${peers.length} comparable documents.`;
  }
}

function compareDocumentDistance(
  current: { index: number; comparableDate: number | null },
  candidate: { index: number; comparableDate: number | null },
): number {
  if (current.comparableDate !== null && candidate.comparableDate !== null) {
    return Math.abs(current.comparableDate - candidate.comparableDate);
  }

  return Math.abs(current.index - candidate.index);
}

function parseComparableDate(
  value: string | null | undefined,
): number | null {
  if (!value) {
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? Number(`20${us[3]}`) : Number(us[3]);
    return Date.UTC(year, Number(us[1]) - 1, Number(us[2]));
  }

  return null;
}

function emptyCrossDocumentQaResult(): CrossDocumentQaResult {
  return {
    bundleConfidence: "LOW",
    bundleReason: "Cross-document bundle not computed yet.",
    mismatches: [],
    alignments: [],
    warnings: [],
  };
}

function buildSafeRowLogMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unexpected non-Error value.";
  }

  return sanitizePipelineErrorMessage(error.message);
}

async function createReplacementQueuePage(closedPage: Page, queueUrl: string): Promise<Page> {
  const replacementPage = await closedPage.context().newPage();
  await replacementPage.goto(queueUrl, { waitUntil: "domcontentloaded" });
  return replacementPage;
}

function sanitizePipelineErrorMessage(message: string): string {
  const sanitized = message
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\/documents\/note\/visitnote\/\S+/gi, "/documents/note/visitnote/[id]")
    .slice(0, 180)
    .trim();

  return sanitized || "Unhandled row-level error.";
}

const VISIT_NOTE_DESC_PATTERNS = [
  /\bvisit note\b/i,
  /\bvisit note-[a-z]{2,3}\b/i,
  /\bpt visit\b/i,
  /\bot visit\b/i,
  /\bst visit\b/i,
  /\bnursing visit\b/i,
];

const VISIT_NOTE_TYPE_PATTERNS = [
  /\btherapy visit note\b/i,
  /\bnursing visit note\b/i,
  /\btherap(y|ist)\b/i,
  /\bskilled nursing\b/i,
  /\b(pt|ot|st)\b/i,
];

const NON_TARGET_PATTERNS = [
  /\border\b/i,
  /physician'?s order/i,
  /\bplan of care\b/i,
  /\boasis\b/i,
];
