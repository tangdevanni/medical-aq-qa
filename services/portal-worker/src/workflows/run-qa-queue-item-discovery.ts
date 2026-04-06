import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  qaQueueItemDiscoveryPayloadSchema,
  type LandingPageObservation,
  type PortalJob,
  type PortalJobResult,
  type PortalObservationFailure,
  type QaQueueItemDetailSurface,
  type QaQueueItemSelectedRow,
  type QaQueueItemSelectedTarget,
  type QaQueueItemTransition,
  type QaQueueSummary,
  type VisitNoteQaReport,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { type PortalWorkerEnv } from "../config/env";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { executeLoginWorkflow } from "../auth/login-workflow";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { DocumentTrackingHubPage } from "../portal/pages/DocumentTrackingHubPage";
import { OrdersQaEntryPage } from "../portal/pages/OrdersQaEntryPage";
import { PortalDiscoveryPage } from "../portal/pages/PortalDiscoveryPage";
import { QaMonitoringQueuePage } from "../portal/pages/QaMonitoringQueuePage";
import { VisitNoteDetailPage } from "../portal/pages/VisitNoteDetailPage";
import { analyzeClickTransition } from "../portal/utils/transition-detector";
import { waitForPageSettled } from "../portal/utils/page-helpers";

export interface QaQueueItemDiscoveryWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runQaQueueItemDiscoveryWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: QaQueueItemDiscoveryWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let queue: QaQueueSummary = {
    url: env.portalBaseUrl,
    rowCount: 0,
  };
  let selectedRow: QaQueueItemSelectedRow = {
    rowIndex: 0,
    documentDescText: null,
    documentType: "UNKNOWN",
    availableActionLabels: [],
  };
  let selectedTarget: QaQueueItemSelectedTarget = {
    label: "View / Edit Note",
    labelSource: "unknown",
    targetType: "NOTE_OPEN_ACTION",
    opened: false,
  };
  let transition: QaQueueItemTransition = {
    resultType: "unknown",
    routeChanged: false,
    queryChanged: false,
    newTabDetected: false,
    modalDetected: false,
    splitViewDetected: false,
    newUrl: null,
  };
  let detailSurface: QaQueueItemDetailSurface = {
    detected: false,
    pageType: "unknown",
    url: null,
    title: null,
    tabs: [],
    sectionHeaders: [],
    fieldLabels: [],
    buttons: [],
    attachmentsPresent: false,
    textareasPresent: false,
    statusAreasPresent: false,
    layoutPatterns: [],
  };
  let visitNoteQa: VisitNoteQaReport | undefined;

  try {
    const context = await createPortalContext(browser, env);
    const page = await context.newPage();
    const dashboardPage = new DashboardPage(page);
    const discoveryPage = new PortalDiscoveryPage(page);
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
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.dashboardNotDetected,
        "Authenticated dashboard was not detected after login.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.dashboardDetected);

    landingPageObservation = {
      ...(await discoveryPage.discover()),
      hasPatientSearch: await dashboardPage.hasGlobalPatientSearch(),
      hasOrdersQaManagementTile: await dashboardPage.hasOrdersQaManagementTile(),
    };

    const targetTile = await ordersQaEntryPage.findOrdersQaShortcutTile();
    if (!targetTile) {
      failures.push({
        code: WORKFLOW_FAILURE_CODES.ordersQaTargetNotFound,
        message: "Orders and QA Management tile was not found on the dashboard.",
        retryable: true,
      });
    } else {
      const hubEntryTransition = await analyzeClickTransition(page, targetTile.locator);
      const hubPage = new DocumentTrackingHubPage(hubEntryTransition.targetPage);

      if (!(await hubPage.isLoaded())) {
        failures.push({
          code: WORKFLOW_FAILURE_CODES.hubNotDetected,
          message: "Document-tracking hub was not detected after entering Orders and QA Management.",
          retryable: true,
        });
      } else {
        options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.documentTrackingHubEntered);

        const trustedLinks = await hubPage.discoverTrustedSidebarLinks();
        const qaMonitoringLink = trustedLinks.find((link) => /qa monitoring/i.test(link.summary.label));

        if (!qaMonitoringLink) {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.trustedSubviewNotFound,
            message: "QA Monitoring sidebar anchor was not found on the document-tracking hub.",
            retryable: true,
          });
        } else {
          const queueTransition = await analyzeClickTransition(
            hubEntryTransition.targetPage,
            qaMonitoringLink.locator,
          );
          const queuePage = new QaMonitoringQueuePage(queueTransition.targetPage);

          if (!(await queuePage.isLoaded())) {
            failures.push({
              code: WORKFLOW_FAILURE_CODES.qaQueueNotDetected,
              message: "QA Monitoring queue was not detected after opening the trusted sidebar link.",
              retryable: true,
            });
          } else {
            queue = await queuePage.summarizeQueue();
            options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaQueueDetected);

            logger.info("QA Monitoring queue detected.", {
              queueUrl: queue.url,
              rowCount: queue.rowCount,
            });

            const visibleRows = await queuePage.getVisibleRows();
            const preferredRow = queuePage.selectPreferredRow(visibleRows);
            if (!preferredRow) {
              failures.push({
                code: WORKFLOW_FAILURE_CODES.qaRowsNotFound,
                message: "No visible rows were found in the QA Monitoring queue.",
                retryable: true,
              });
            } else {
              selectedRow = preferredRow.row;
              options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaRowSelected);

              logger.info("QA queue row selected.", {
                rowIndex: preferredRow.row.rowIndex,
                selectedDocumentType: preferredRow.row.documentType,
                classificationReason: preferredRow.documentTypeReason,
                actionLabels: preferredRow.actions.map((action) => ({
                  label: action.label,
                  labelSource: action.labelSource,
                  classification: action.targetType,
                })),
                targetClassificationCounts: {
                  noteOpenAction: preferredRow.actions.filter((action) => action.targetType === "NOTE_OPEN_ACTION").length,
                  documentLink: preferredRow.actions.filter((action) => action.targetType === "DOCUMENT_LINK").length,
                  patientLink: preferredRow.actions.filter((action) => action.targetType === "PATIENT_LINK").length,
                  otherAction: preferredRow.actions.filter((action) => action.targetType === "OTHER_ACTION").length,
                },
              });

              const noteTarget = queuePage.selectPreferredTarget(preferredRow);

              if (!noteTarget) {
                failures.push({
                  code: WORKFLOW_FAILURE_CODES.safeRowTargetNotFound,
                  message: "The selected QA queue row did not expose a safe View / Edit Note target.",
                  retryable: true,
                });
              } else {
                selectedTarget = {
                  label: noteTarget.label,
                  labelSource: noteTarget.labelSource,
                  targetType: noteTarget.targetType,
                  opened: false,
                };
                options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaRowTargetSelected);

                try {
                  const itemTransition = await analyzeClickTransition(
                    queueTransition.targetPage,
                    noteTarget.locator,
                  );
                  transition = mapOrdersTransitionToQueueItemTransition(itemTransition.transition);
                  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemOpenAttempted);
                  await prepareVisitNoteTargetPage(itemTransition.targetPage, transition);

                  const detailPage = new VisitNoteDetailPage(itemTransition.targetPage);
                  const detailDetected = await detailPage.isLoaded();

                  if (isMeaningfulQueueItemTransition(transition, itemTransition.targetPage.url()) && detailDetected) {
                    selectedTarget.opened = true;
                    detailSurface = await detailPage.mapSurface(true);
                    visitNoteQa = await detailPage.extractQaReport();
                    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.visitNoteDetailDetected);
                    logger.info("QA detail page detected.", {
                      selectedDocumentType: selectedRow.documentType,
                      pageTypeDetected: detailSurface.pageType,
                      qaOverallStatus: visitNoteQa.summary.overallStatus,
                      meaningfulSectionCount: visitNoteQa.summary.meaningfulSectionCount,
                      missingSectionCount: visitNoteQa.summary.missingSections.length,
                      warningCount: visitNoteQa.warnings.length,
                    });
                  } else if (!isMeaningfulQueueItemTransition(transition, transition.newUrl)) {
                    failures.push({
                      code: WORKFLOW_FAILURE_CODES.noMeaningfulItemTransition,
                      message: "View / Edit Note did not produce a meaningful visit-note transition.",
                      retryable: true,
                    });
                  } else {
                    failures.push({
                      code: WORKFLOW_FAILURE_CODES.visitNoteDetailNotDetected,
                      message: "A queue-item transition occurred, but the visit-note detail page was not detected.",
                      retryable: true,
                    });
                  }
                } catch (error: unknown) {
                  throw new WorkflowError(
                    WORKFLOW_FAILURE_CODES.qaItemOpenFailed,
                    error instanceof Error ? error.message : "QA queue item open failed.",
                    true,
                  );
                }
              }
            }
          }
        }
      }
    }

    const payload = qaQueueItemDiscoveryPayloadSchema.parse({
      queue,
      selectedRow,
      selectedTarget,
      transition,
      detailSurface,
      visitNoteQa,
      failures,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaQueueItemDiscoveryComplete);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.qaQueueItemDiscoveryComplete,
      completedAt: new Date().toISOString(),
      summary: "QA queue item discovery completed.",
      landingPage: landingPageObservation,
      queue: payload.queue,
      selectedRow: payload.selectedRow,
      selectedTarget: payload.selectedTarget,
      qaQueueItemTransition: payload.transition,
      detailSurface: payload.detailSurface,
      visitNoteQa: payload.visitNoteQa,
      failures: payload.failures,
      data: payload as unknown as Record<string, unknown>,
    };
  } catch (error: unknown) {
    const failure = classifyWorkflowFailure(error);
    failures.push(failure);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: "failed",
      completedAt: new Date().toISOString(),
      summary: failure.message,
      landingPage: landingPageObservation,
      queue,
      selectedRow,
      selectedTarget,
      qaQueueItemTransition: transition,
      detailSurface,
      visitNoteQa,
      failures,
      error: failure,
    };
  } finally {
    await browser.close();
  }
}

function mapOrdersTransitionToQueueItemTransition(input: {
  resultType: string;
  urlBefore: string | null;
  urlAfter: string | null;
  routeChanged: boolean;
  modalDetected: boolean;
  newTabDetected: boolean;
  splitViewDetected: boolean;
}): QaQueueItemTransition {
  const beforeUrl = parseUrl(input.urlBefore);
  const afterUrl = parseUrl(input.urlAfter);
  const queryChanged = Boolean(
    beforeUrl &&
      afterUrl &&
      beforeUrl.origin === afterUrl.origin &&
      beforeUrl.pathname === afterUrl.pathname &&
      beforeUrl.search !== afterUrl.search,
  );
  const pathChanged = Boolean(
    beforeUrl &&
      afterUrl &&
      (beforeUrl.origin !== afterUrl.origin || beforeUrl.pathname !== afterUrl.pathname),
  );

  return {
    resultType: input.newTabDetected
      ? "new_tab"
      : input.modalDetected
      ? "modal"
      : input.splitViewDetected
      ? "split_view"
      : pathChanged
      ? "route_change"
      : queryChanged
      ? "query_param_change"
      : input.resultType === "same_page_new_view"
      ? "same_page_new_view"
      : input.resultType === "same_page_dashboard_no_change"
      ? "no_change"
      : "unknown",
    routeChanged: pathChanged || (input.routeChanged && !queryChanged),
    queryChanged,
    newTabDetected: input.newTabDetected,
    modalDetected: input.modalDetected,
    splitViewDetected: input.splitViewDetected,
    newUrl: input.urlAfter,
  };
}

function parseUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isMeaningfulQueueItemTransition(
  transition: QaQueueItemTransition,
  url: string | null,
): boolean {
  if (url?.includes("/documents/note/visitnote/")) {
    return true;
  }

  return (
    transition.resultType === "route_change" ||
    transition.resultType === "query_param_change" ||
    transition.resultType === "same_page_new_view" ||
    transition.resultType === "modal" ||
    transition.resultType === "split_view" ||
    transition.resultType === "new_tab"
  );
}

async function prepareVisitNoteTargetPage(
  page: import("@playwright/test").Page,
  transition: QaQueueItemTransition,
): Promise<void> {
  if (transition.newTabDetected) {
    await page.bringToFront().catch(() => undefined);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
  await waitForPageSettled(page, transition.newTabDetected ? 500 : 250);
}

function classifyWorkflowFailure(error: unknown): PortalObservationFailure {
  if (error instanceof WorkflowError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error && /timeout/i.test(error.message)) {
    return {
      code: WORKFLOW_FAILURE_CODES.timeout,
      message: error.message,
      retryable: true,
    };
  }

  return {
    code: WORKFLOW_FAILURE_CODES.unknown,
    message: error instanceof Error ? error.message : "Unknown workflow failure.",
    retryable: true,
  };
}
