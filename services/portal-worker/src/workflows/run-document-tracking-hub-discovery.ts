import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  documentTrackingHubDiscoveryPayloadSchema,
  type DocumentTrackingDestinationSurface,
  type DocumentTrackingHub,
  type DocumentTrackingSelectedSubview,
  type DocumentTrackingTransition,
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
import { formatLoginDiagnostics } from "../auth/login-diagnostics";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { DocumentTrackingHubPage } from "../portal/pages/DocumentTrackingHubPage";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";
import { OrdersQaEntryPage } from "../portal/pages/OrdersQaEntryPage";
import { PortalDiscoveryPage } from "../portal/pages/PortalDiscoveryPage";
import { SubviewSurfacePage } from "../portal/pages/SubviewSurfacePage";
import { analyzeClickTransition } from "../portal/utils/transition-detector";

export interface DocumentTrackingHubDiscoveryWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runDocumentTrackingHubDiscoveryWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: DocumentTrackingHubDiscoveryWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let hub: DocumentTrackingHub = {
    url: env.portalBaseUrl,
    title: null,
    cards: [],
  };
  let selectedSubview: DocumentTrackingSelectedSubview = {
    label: null,
    classification: "UNKNOWN",
    opened: false,
  };
  let hubTransition: DocumentTrackingTransition = {
    resultType: "unknown",
    routeChanged: false,
    modalDetected: false,
    newTabDetected: false,
    splitViewDetected: false,
    meaningfulStructureChanged: false,
  };
  let destinationSurface: DocumentTrackingDestinationSurface = {
    detected: false,
    pageType: "unknown",
    url: null,
    title: null,
    tabs: [],
    sectionHeaders: [],
    tables: [],
    buttons: [],
    searchBars: [],
    cards: [],
    layoutPatterns: [],
    hasVisibleRows: false,
  };

  try {
    const context = await createPortalContext(browser, env);
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    const landingPage = new LandingPage(page);
    const dashboardPage = new DashboardPage(page);
    const discoveryPage = new PortalDiscoveryPage(page);
    const ordersQaEntryPage = new OrdersQaEntryPage(page);

    await loginPage.goto(job.portalUrl || env.portalBaseUrl);
    const loginDiagnostics = await loginPage.waitUntilLoaded();

    if (!loginDiagnostics.isLikelyLoginPage) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.pageUnexpected,
        formatLoginDiagnostics("Finale Health login page was not detected.", loginDiagnostics),
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.loginPageDetected);

    const loginResult = await loginPage.login(env.portalUsername, env.portalPassword);
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.credentialsSubmitted);

    if (loginResult.outcome !== "login_succeeded") {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.loginFailed,
        formatLoginDiagnostics(
          `Login did not complete: ${loginResult.outcome}.`,
          loginResult.diagnostics,
        ),
        true,
      );
    }

    await landingPage.waitForAuthenticatedShell();
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.authenticated);

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
    hub.url = landingPageObservation.url ?? env.portalBaseUrl;

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

        const resolvedCards = await hubPage.discoverResolvedCards();
        hub = {
          url: hubEntryTransition.targetPage.url(),
          title: await hubEntryTransition.targetPage.title().catch(() => null),
          cards: resolvedCards.map((card) => card.summary),
        };

        logger.info("Document-tracking hub discovered.", {
          hubUrl: hub.url,
          hubTitle: hub.title,
          cardCount: hub.cards.length,
        });

        if (resolvedCards.length === 0) {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.hubCardsNotFound,
            message: "No document-tracking hub cards were detected.",
            retryable: true,
          });
        } else {
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.hubCardsEnumerated);
        }

        const selectedCard = hubPage.selectPreferredSafeCard(resolvedCards);
        if (!selectedCard) {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.hubTargetNotSafe,
            message: "No document-tracking hub card met the SAFE_NAV allowlist.",
            retryable: true,
          });
        } else {
          selectedSubview = {
            label: selectedCard.summary.label,
            classification: selectedCard.summary.classification,
            opened: false,
          };
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.hubTargetSelected);

          try {
            const subviewTransition = await analyzeClickTransition(
              hubEntryTransition.targetPage,
              selectedCard.target ?? selectedCard.locator,
            );

            hubTransition = mapOrdersTransitionToHubTransition(subviewTransition.transition);
            options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.hubSubviewClickAttempted);

            if (isMeaningfulHubTransition(hubTransition)) {
              selectedSubview.opened = true;
              destinationSurface = await new SubviewSurfacePage(subviewTransition.targetPage).mapSurface(true);

              if (destinationSurface.detected) {
                options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.hubSubviewDetected);
              } else {
                failures.push({
                  code: WORKFLOW_FAILURE_CODES.hubSubviewNotDetected,
                  message: "A hub subview transition occurred, but the destination surface could not be mapped.",
                  retryable: true,
                });
              }
            } else {
              failures.push({
                code: WORKFLOW_FAILURE_CODES.noMeaningfulHubTransition,
                message: "The selected document-tracking hub card did not produce a meaningful transition.",
                retryable: true,
              });
            }
          } catch (error: unknown) {
            throw new WorkflowError(
              WORKFLOW_FAILURE_CODES.hubSubviewClickFailed,
              error instanceof Error ? error.message : "Document-tracking hub subview click failed.",
              true,
            );
          }
        }
      }
    }

    const payload = documentTrackingHubDiscoveryPayloadSchema.parse({
      hub,
      selectedSubview,
      transition: hubTransition,
      destinationSurface,
      failures,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.documentTrackingHubDiscoveryComplete);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.documentTrackingHubDiscoveryComplete,
      completedAt: new Date().toISOString(),
      summary: "Document-tracking hub discovery completed.",
      landingPage: landingPageObservation,
      hub: payload.hub,
      selectedSubview: payload.selectedSubview,
      hubTransition: payload.transition,
      destinationSurface: {
        detected: payload.destinationSurface.detected,
        pageType: payload.destinationSurface.pageType,
        url: payload.destinationSurface.url,
        title: payload.destinationSurface.title,
        tabs: payload.destinationSurface.tabs,
        sectionHeaders: payload.destinationSurface.sectionHeaders,
        tables: payload.destinationSurface.tables,
        buttons: payload.destinationSurface.buttons,
        searchBars: payload.destinationSurface.searchBars,
        cards: payload.destinationSurface.cards,
        layoutPatterns: payload.destinationSurface.layoutPatterns,
      },
      documentTrackingDestinationSurface: payload.destinationSurface,
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
      hub,
      selectedSubview,
      hubTransition,
      destinationSurface: {
        detected: destinationSurface.detected,
        pageType: destinationSurface.pageType,
        url: destinationSurface.url,
        title: destinationSurface.title,
        tabs: destinationSurface.tabs,
        sectionHeaders: destinationSurface.sectionHeaders,
        tables: destinationSurface.tables,
        buttons: destinationSurface.buttons,
        searchBars: destinationSurface.searchBars,
        cards: destinationSurface.cards,
        layoutPatterns: destinationSurface.layoutPatterns,
      },
      documentTrackingDestinationSurface: destinationSurface,
      failures,
      error: failure,
    };
  } finally {
    await browser.close();
  }
}

function mapOrdersTransitionToHubTransition(
  transition: {
    resultType: string;
    routeChanged: boolean;
    modalDetected: boolean;
    newTabDetected: boolean;
    splitViewDetected: boolean;
    meaningfulStructureChanged: boolean;
  },
): DocumentTrackingTransition {
  return {
    resultType:
      transition.resultType === "same_page_dashboard_no_change"
        ? "no_change"
        : transition.resultType === "same_page_new_view"
          ? "same_page_new_view"
          : transition.resultType === "route_change" ||
              transition.resultType === "modal" ||
              transition.resultType === "new_tab" ||
              transition.resultType === "split_view"
            ? transition.resultType
            : "unknown",
    routeChanged: transition.routeChanged,
    modalDetected: transition.modalDetected,
    newTabDetected: transition.newTabDetected,
    splitViewDetected: transition.splitViewDetected,
    meaningfulStructureChanged: transition.meaningfulStructureChanged,
  };
}

function isMeaningfulHubTransition(transition: DocumentTrackingTransition): boolean {
  return (
    transition.resultType === "route_change" ||
    transition.resultType === "modal" ||
    transition.resultType === "new_tab" ||
    transition.resultType === "split_view" ||
    transition.resultType === "same_page_new_view"
  );
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
