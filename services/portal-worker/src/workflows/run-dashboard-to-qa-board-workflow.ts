import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  portalObservationPayloadSchema,
  type LandingPageObservation,
  type PortalJob,
  type PortalJobResult,
  type PortalObservationFailure,
  type QaBoardObservation,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { type PortalWorkerEnv } from "../config/env";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { QaBoardPage } from "../portal/pages/QaBoardPage";

export interface DashboardToQaBoardWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runDashboardToQaBoardWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: DashboardToQaBoardWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let qaBoardObservation: QaBoardObservation | undefined;

  try {
    const context = await createPortalContext(browser, env);
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    const landingPage = new LandingPage(page);
    const dashboardPage = new DashboardPage(page);
    const qaBoardPage = new QaBoardPage(page);

    logger.info("Opening Finale Health login page.", {
      portal: job.portal,
      portalUrl: job.portalUrl,
    });

    await loginPage.goto(job.portalUrl || env.portalBaseUrl);

    if (!(await loginPage.isLoaded())) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.pageUnexpected,
        "Finale Health login page was not detected.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.loginPageDetected);

    await loginPage.login(env.portalUsername, env.portalPassword);
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.credentialsSubmitted);

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

    const navItems = await dashboardPage.getVisibleTopNavItems();
    const hasPatientSearch = await dashboardPage.hasGlobalPatientSearch();
    const hasOrdersQaManagementTile = await dashboardPage.hasOrdersQaManagementTile();

    if (hasPatientSearch) {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.globalPatientSearchAvailable);
    }

    if (!hasOrdersQaManagementTile) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.qaManagementTileMissing,
        'Dashboard tile "Orders and QA Management" was not detected.',
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaManagementEntryAvailable);

    landingPageObservation = {
      type: "dashboard",
      navItems,
      hasPatientSearch,
      hasOrdersQaManagementTile,
    };

    logger.info("Dashboard observations collected.", {
      navItemCount: navItems.length,
      hasPatientSearch,
      hasOrdersQaManagementTile,
    });

    await dashboardPage.openOrdersQaManagement();

    if (!(await qaBoardPage.isLoaded())) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.qaBoardNotDetected,
        "QA board was not detected after opening Orders and QA Management.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaBoardOpened);

    const cardSummaries = await qaBoardPage.getVisibleCardSummaries();
    const statusesSeen = await qaBoardPage.getVisibleStatuses();
    const workItemTypesSeen = await qaBoardPage.getVisibleWorkItemTypes();

    qaBoardObservation = {
      cardCount: cardSummaries.length,
      statusesSeen,
      workItemTypesSeen,
      cardSummaries,
    };

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemsEnumerated);

    logger.info("QA board observations collected.", {
      cardCount: qaBoardObservation.cardCount,
      statusesSeen,
      workItemTypesSeen,
    });

    const observationPayload = portalObservationPayloadSchema.parse({
      landingPage: landingPageObservation,
      qaBoard: qaBoardObservation,
      failures,
    });

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.qaItemsEnumerated,
      completedAt: new Date().toISOString(),
      summary: "Dashboard and QA board observations collected.",
      ...observationPayload,
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
      qaBoard: qaBoardObservation,
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
