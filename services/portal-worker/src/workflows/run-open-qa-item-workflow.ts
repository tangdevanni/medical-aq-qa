import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  portalObservationPayloadSchema,
  type LandingPageObservation,
  type PortalJob,
  type PortalJobResult,
  type PortalObservationFailure,
  type QaBoardObservation,
  type QaItemDetailSummary,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { type PortalWorkerEnv } from "../config/env";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { executeLoginWorkflow } from "../auth/login-workflow";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { QaBoardPage } from "../portal/pages/QaBoardPage";
import { QaItemDetailPage } from "../portal/pages/QaItemDetailPage";

export interface OpenQaItemWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runOpenQaItemWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: OpenQaItemWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let qaBoardObservation: QaBoardObservation | undefined;
  let qaItemDetail: QaItemDetailSummary | undefined;

  try {
    const context = await createPortalContext(browser, env);
    const page = await context.newPage();
    const dashboardPage = new DashboardPage(page);
    const qaBoardPage = new QaBoardPage(page);

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
    const selectedCardIndex = await qaBoardPage.getFirstOpenableCardIndex();

    qaBoardObservation = {
      cardCount: cardSummaries.length,
      statusesSeen,
      workItemTypesSeen,
      cardSummaries,
      selectedCardIndex: selectedCardIndex ?? undefined,
    };

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemsEnumerated);

    if (selectedCardIndex === null) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.qaItemsNotFound,
        "No visible openable QA item was found on the board.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemOpenAttempted);

    const openResult = await qaBoardPage.openVisibleCardByIndex(selectedCardIndex);

    if (openResult.openBehavior === "unknown" && openResult.ambiguousSignals.length > 1) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.multipleOpenBehaviorsUnclear,
        "QA item open behavior was ambiguous.",
        true,
      );
    }

    if (openResult.openBehavior === "unknown") {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.qaItemOpenFailed,
        "QA item open behavior could not be determined.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemOpened);

    const qaItemDetailPage = new QaItemDetailPage(openResult.targetPage, {
      openBehavior: openResult.openBehavior,
      routeChanged: openResult.routeChanged,
      modalDetected: openResult.modalDetected,
      newTabDetected: openResult.newTabDetected,
    });

    if (!(await qaItemDetailPage.isLoaded())) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.qaItemDetailNotDetected,
        "QA item detail view was not detected after opening the card.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemDetailDetected);

    qaItemDetail = await qaItemDetailPage.getMinimalSummary();
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.qaItemMetadataCaptured);

    logger.info("QA item detail metadata captured.", {
      openBehavior: qaItemDetail.openBehavior,
      detailViewDetected: qaItemDetail.detailViewDetected,
      sectionCount: qaItemDetail.sectionNames.length,
      actionCount: qaItemDetail.actionLabels.length,
    });

    const observationPayload = portalObservationPayloadSchema.parse({
      landingPage: landingPageObservation,
      qaBoard: qaBoardObservation,
      qaItemDetail,
      failures,
    });

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.qaItemMetadataCaptured,
      completedAt: new Date().toISOString(),
      summary: "QA item detail metadata captured.",
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
      qaItemDetail,
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
