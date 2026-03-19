import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  phase7TileInteractionPayloadSchema,
  type DestinationSurfaceObservation,
  type LandingPageObservation,
  type Phase7TileInteraction,
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
import { DestinationSurfacePage } from "../portal/pages/DestinationSurfacePage";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";
import { OrdersQaEntryPage } from "../portal/pages/OrdersQaEntryPage";
import { PortalDiscoveryPage } from "../portal/pages/PortalDiscoveryPage";
import { analyzeInteractionTransition, isMeaningfulForensicsResultType } from "../portal/utils/transition-detector";

export interface Phase7TileInteractionWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runPhase7TileInteractionWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: Phase7TileInteractionWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let tileCount = 0;
  let targetTileIndex: number | null = null;
  let targetLabel: string | null = null;
  let tileInteraction: Phase7TileInteraction = {
    clicked: false,
    resultType: "unknown",
    meaningful: false,
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

    const tiles = await ordersQaEntryPage.discoverShortcutTiles();
    tileCount = tiles.length;
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.shortcutTilesEnumerated);

    const targetTile = await ordersQaEntryPage.findOrdersQaShortcutTile();
    targetTileIndex = targetTile?.tileIndex ?? null;
    targetLabel = targetTile?.label ?? targetTile?.textSummary ?? null;

    logger.info("Phase 7 shortcut tile scan collected.", {
      landingUrl: landingPageObservation.url,
      tileCount,
      targetTileIndex,
      targetLabel,
    });

    if (!targetTile) {
      failures.push({
        code: WORKFLOW_FAILURE_CODES.ordersQaTargetNotFound,
        message: "Orders and QA Management tile was not found in the dashboard shortcut row.",
        retryable: true,
      });
    } else {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.targetTileIdentified);

      const transitionResult = await analyzeInteractionTransition(page, targetTile.locator, "click");
      tileInteraction = {
        clicked: true,
        resultType: transitionResult.attempt.resultType,
        meaningful: transitionResult.attempt.success,
      };
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.targetTileClicked);

      if (isMeaningfulForensicsResultType(tileInteraction.resultType)) {
        destinationSurface = await new DestinationSurfacePage(transitionResult.targetPage).mapSurface(true);

        if (destinationSurface.detected) {
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.destinationSurfaceDetected);
        } else {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.destinationSurfaceNotDetected,
            message: "The Orders and QA Management tile changed the UI, but the destination surface could not be mapped.",
            retryable: true,
          });
        }
      } else {
        failures.push({
          code: WORKFLOW_FAILURE_CODES.noTileLevelInteractionSuccess,
          message: "Clicking the Orders and QA Management tile did not produce a meaningful transition.",
          retryable: true,
        });
      }
    }

    const payload = phase7TileInteractionPayloadSchema.parse({
      tileCount,
      targetTileIndex,
      targetLabel,
      interaction: tileInteraction,
      destinationSurface,
      failures,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.phase7TileInteractionComplete);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.phase7TileInteractionComplete,
      completedAt: new Date().toISOString(),
      summary: "Phase 7 tile interaction completed.",
      landingPage: landingPageObservation,
      tileCount: payload.tileCount,
      targetTileIndex: payload.targetTileIndex,
      targetLabel: payload.targetLabel,
      tileInteraction: payload.interaction,
      destinationSurface: payload.destinationSurface,
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
      tileCount,
      targetTileIndex,
      targetLabel,
      tileInteraction,
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
