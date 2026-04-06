import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  ordersQaEntryDiscoveryPayloadSchema,
  type DestinationSurfaceObservation,
  type LandingPageObservation,
  type OrdersQaTargetCandidate,
  type OrdersQaTransition,
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
import { DestinationSurfacePage } from "../portal/pages/DestinationSurfacePage";
import { OrdersQaEntryPage } from "../portal/pages/OrdersQaEntryPage";
import { PortalDiscoveryPage } from "../portal/pages/PortalDiscoveryPage";
import { analyzeClickTransition } from "../portal/utils/transition-detector";

export interface OrdersQaEntryWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runOrdersQaEntryWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: OrdersQaEntryWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let targetCandidate: OrdersQaTargetCandidate = {
    label: null,
    classification: "UNKNOWN",
    reason: null,
    found: false,
  };
  let transition: OrdersQaTransition = {
    clicked: false,
    resultType: "unknown",
    urlBefore: null,
    urlAfter: null,
    routeChanged: false,
    modalDetected: false,
    newTabDetected: false,
    splitViewDetected: false,
    meaningfulStructureChanged: false,
  };
  let destinationSurface: DestinationSurfaceObservation = {
    detected: false,
    pageType: null,
    url: null,
    title: null,
    tabs: [],
    sectionHeaders: [],
    tables: [],
    buttons: [],
    searchBars: [],
    cards: [],
    layoutPatterns: [],
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

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaTargetSearchStarted);

    const targetResult = await ordersQaEntryPage.findTargetCandidate();
    targetCandidate = targetResult.candidate;

    if (targetCandidate.found) {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaTargetFound);
    }

    logger.info("Orders QA target analysis collected.", {
      landingUrl: landingPageObservation.url,
      landingTitle: landingPageObservation.title,
      targetLabel: targetCandidate.label,
      targetClassification: targetCandidate.classification,
      targetFound: targetCandidate.found,
    });

    if (!targetCandidate.found) {
      failures.push({
        code: WORKFLOW_FAILURE_CODES.ordersQaTargetNotFound,
        message: "Orders and QA Management entry was not found on the dashboard.",
        retryable: true,
      });
    } else if (targetCandidate.classification !== "SAFE_NAV" || !targetResult.target) {
      failures.push({
        code: WORKFLOW_FAILURE_CODES.ordersQaTargetNotSafe,
        message: `Orders QA target "${targetCandidate.label}" was found but was not classified as safe navigation.`,
        retryable: true,
      });
    } else {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaClickAttempted);

      try {
        const transitionResult = await analyzeClickTransition(page, targetResult.target);
        transition = transitionResult.transition;
        options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.transitionAnalyzed);

        const shouldMapDestination = isMeaningfulTransition(transition);
        destinationSurface = await new DestinationSurfacePage(transitionResult.targetPage).mapSurface(
          shouldMapDestination,
        );

        if (shouldMapDestination && destinationSurface.detected) {
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.destinationSurfaceDetected);
        } else if (!shouldMapDestination) {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.transitionNotMeaningful,
            message: "Orders QA click did not produce a meaningful state transition.",
            retryable: true,
          });
        } else {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.destinationSurfaceNotDetected,
            message: "A transition occurred, but the resulting destination surface could not be mapped.",
            retryable: true,
          });
        }
      } catch (error: unknown) {
        throw new WorkflowError(
          WORKFLOW_FAILURE_CODES.ordersQaClickFailed,
          error instanceof Error ? error.message : "Orders QA target click failed.",
          true,
        );
      }
    }

    const observationPayload = ordersQaEntryDiscoveryPayloadSchema.parse({
      landingPage: {
        url: landingPageObservation.url ?? page.url(),
        title: landingPageObservation.title ?? null,
      },
      targetCandidate,
      transition,
      destinationPage: destinationSurface,
      failures,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaEntryDiscoveryComplete);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.ordersQaEntryDiscoveryComplete,
      completedAt: new Date().toISOString(),
      summary: "Orders and QA Management entry discovery completed.",
      landingPage: landingPageObservation,
      targetCandidate: observationPayload.targetCandidate,
      transition: observationPayload.transition,
      destinationSurface: observationPayload.destinationPage,
      failures: observationPayload.failures,
      data: observationPayload as unknown as Record<string, unknown>,
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
      targetCandidate,
      transition,
      destinationSurface,
      failures,
      error: failure,
    };
  } finally {
    await browser.close();
  }
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

function isMeaningfulTransition(transition: OrdersQaTransition): boolean {
  return (
    transition.resultType === "modal" ||
    transition.resultType === "new_tab" ||
    transition.resultType === "split_view" ||
    transition.resultType === "route_change" ||
    transition.resultType === "same_page_new_view"
  );
}
