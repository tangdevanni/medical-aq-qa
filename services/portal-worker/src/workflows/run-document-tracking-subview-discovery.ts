import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  documentTrackingSubviewDiscoveryPayloadSchema,
  type DestinationSurfaceObservation,
  type DocumentTrackingSubviewDestinationSurface,
  type DocumentTrackingSubviewHub,
  type DocumentTrackingSubviewSelection,
  type DocumentTrackingSubviewTransition,
  type LandingPageObservation,
  type PortalJob,
  type PortalJobResult,
  type PortalObservationFailure,
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
import { SubviewSurfacePage } from "../portal/pages/SubviewSurfacePage";
import { analyzeClickTransition } from "../portal/utils/transition-detector";

export interface DocumentTrackingSubviewDiscoveryWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runDocumentTrackingSubviewDiscoveryWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: DocumentTrackingSubviewDiscoveryWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let trustedHub: DocumentTrackingSubviewHub = {
    url: env.portalBaseUrl,
    title: null,
    trustedLinks: [],
  };
  let subviewSelection: DocumentTrackingSubviewSelection = {
    label: "QA Monitoring",
    classification: "SAFE_NAV",
    selectorKind: "sidebar_anchor",
    opened: false,
  };
  let subviewTransition: DocumentTrackingSubviewTransition = {
    resultType: "unknown",
    routeChanged: false,
    queryChanged: false,
    modalDetected: false,
    splitViewDetected: false,
    meaningfulStructureChanged: false,
  };
  let documentTrackingSubviewSurface: DocumentTrackingSubviewDestinationSurface = {
    detected: false,
    pageType: "unknown",
    url: null,
    title: null,
    filters: [],
    searchBars: [],
    tabs: [],
    sectionHeaders: [],
    tables: [],
    cards: [],
    statusLabels: [],
    layoutPatterns: [],
    hasVisibleRows: false,
  };

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
        trustedHub = await hubPage.discoverTrustedSidebarHub();
        options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.trustedHubLinksEnumerated);

        logger.info("Trusted document-tracking sidebar links discovered.", {
          hubUrl: trustedHub.url,
          hubTitle: trustedHub.title,
          trustedLinkCount: trustedHub.trustedLinks.length,
          trustedLabels: trustedHub.trustedLinks.map((link) => link.label),
        });

        const selectedLink = hubPage.selectPreferredTrustedSidebarLink(trustedLinks);
        if (!selectedLink) {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.trustedSubviewNotFound,
            message: "No trusted sidebar subview target was found on the document-tracking hub.",
            retryable: true,
          });
        } else {
          subviewSelection = {
            ...selectedLink.summary,
            opened: false,
          };
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.subviewTargetSelected);

          try {
            const transitionResult = await analyzeClickTransition(
              hubEntryTransition.targetPage,
              selectedLink.locator,
            );

            subviewTransition = mapOrdersTransitionToSubviewTransition(transitionResult.transition);
            options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.subviewClickAttempted);

            if (isMeaningfulSubviewTransition(subviewTransition)) {
              subviewSelection.opened = true;
              documentTrackingSubviewSurface = await new SubviewSurfacePage(
                transitionResult.targetPage,
              ).mapPhase9Surface(true);

              if (documentTrackingSubviewSurface.detected) {
                options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.subviewDetected);
              } else {
                failures.push({
                  code: WORKFLOW_FAILURE_CODES.subviewNotDetected,
                  message: "A trusted sidebar subview transition occurred, but the destination surface could not be mapped.",
                  retryable: true,
                });
              }
            } else {
              failures.push({
                code: WORKFLOW_FAILURE_CODES.noMeaningfulSubviewTransition,
                message: "The trusted sidebar subview click did not produce a meaningful transition.",
                retryable: true,
              });
            }
          } catch (error: unknown) {
            throw new WorkflowError(
              WORKFLOW_FAILURE_CODES.subviewClickFailed,
              error instanceof Error ? error.message : "Trusted sidebar subview click failed.",
              true,
            );
          }
        }
      }
    }

    const payload = documentTrackingSubviewDiscoveryPayloadSchema.parse({
      hub: trustedHub,
      selectedSubview: subviewSelection,
      transition: subviewTransition,
      destinationSurface: documentTrackingSubviewSurface,
      failures,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.documentTrackingSubviewDiscoveryComplete);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.documentTrackingSubviewDiscoveryComplete,
      completedAt: new Date().toISOString(),
      summary: "Document-tracking subview discovery completed.",
      landingPage: landingPageObservation,
      trustedHub: payload.hub,
      subviewSelection: payload.selectedSubview,
      subviewTransition: payload.transition,
      destinationSurface: mapPhase9SurfaceToGenericSurface(payload.destinationSurface),
      documentTrackingSubviewSurface: payload.destinationSurface,
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
      trustedHub,
      subviewSelection,
      subviewTransition,
      destinationSurface: mapPhase9SurfaceToGenericSurface(documentTrackingSubviewSurface),
      documentTrackingSubviewSurface,
      failures,
      error: failure,
    };
  } finally {
    await browser.close();
  }
}

function mapOrdersTransitionToSubviewTransition(input: {
  resultType: string;
  urlBefore: string | null;
  urlAfter: string | null;
  routeChanged: boolean;
  modalDetected: boolean;
  splitViewDetected: boolean;
  meaningfulStructureChanged: boolean;
}): DocumentTrackingSubviewTransition {
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
    resultType: input.modalDetected
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
    modalDetected: input.modalDetected,
    splitViewDetected: input.splitViewDetected,
    meaningfulStructureChanged: input.meaningfulStructureChanged,
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

function isMeaningfulSubviewTransition(transition: DocumentTrackingSubviewTransition): boolean {
  return (
    transition.resultType === "route_change" ||
    transition.resultType === "query_param_change" ||
    transition.resultType === "same_page_new_view" ||
    transition.resultType === "modal" ||
    transition.resultType === "split_view"
  );
}

function mapPhase9SurfaceToGenericSurface(
  input: DocumentTrackingSubviewDestinationSurface,
): DestinationSurfaceObservation {
  return {
    detected: input.detected,
    pageType: input.pageType,
    url: input.url,
    title: input.title,
    tabs: input.tabs,
    sectionHeaders: input.sectionHeaders,
    tables: input.tables,
    buttons: [],
    searchBars: input.searchBars,
    cards: input.cards,
    layoutPatterns: input.layoutPatterns,
  };
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
