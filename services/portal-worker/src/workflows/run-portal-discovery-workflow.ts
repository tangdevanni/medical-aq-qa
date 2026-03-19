import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  phase4PortalDiscoveryPayloadSchema,
  type DestinationPageObservation,
  type LandingPageObservation,
  type PortalJob,
  type PortalJobResult,
  type PortalObservationFailure,
  type SafeNavigationCandidate,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { type PortalWorkerEnv } from "../config/env";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { formatLoginDiagnostics } from "../auth/login-diagnostics";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";
import { PortalDiscoveryPage } from "../portal/pages/PortalDiscoveryPage";

export interface PortalDiscoveryWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runPortalDiscoveryWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: PortalDiscoveryWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let safeNavigationCandidate: SafeNavigationCandidate = {
    label: null,
    classification: "UNKNOWN",
    reason: null,
  };
  let destinationPage: DestinationPageObservation = {
    opened: false,
    openBehavior: "unknown",
    url: null,
    title: null,
    pageType: null,
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

    await loginPage.goto(job.portalUrl || env.portalBaseUrl);
    const loginDiagnostics = await loginPage.waitUntilLoaded();

    if (!loginDiagnostics.isLikelyLoginPage) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.pageUnexpected,
        formatLoginDiagnostics("Finale Health login page was not detected.", loginDiagnostics),
        true,
      );
    }

    logger.info("Finale Health login page detected.", {
      url: loginDiagnostics.currentUrl,
      title: loginDiagnostics.title,
      passwordInputFound: loginDiagnostics.passwordInputFound,
      loginButtonFound: loginDiagnostics.loginButtonFound,
      visibleInputCount: loginDiagnostics.visibleInputCount,
      headingMarkers: loginDiagnostics.headingMarkers,
    });

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

    const isDashboardLoaded = await dashboardPage.isLoaded();
    if (!isDashboardLoaded) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.dashboardNotDetected,
        "Authenticated dashboard was not detected after login.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.dashboardDetected);
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.dashboardDeepScanStarted);

    try {
      const baseObservation = await discoveryPage.discover();
      landingPageObservation = {
        ...baseObservation,
        hasPatientSearch: await dashboardPage.hasGlobalPatientSearch(),
        hasOrdersQaManagementTile: await dashboardPage.hasOrdersQaManagementTile(),
      };
    } catch (error: unknown) {
      throw new WorkflowError(
        WORKFLOW_FAILURE_CODES.scrollDiscoveryFailed,
        error instanceof Error ? error.message : "Dashboard deep scan failed.",
        true,
      );
    }

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.dashboardDeepScanCompleted);

    const candidateResult = await dashboardPage.findSafeNavigationCandidate();
    safeNavigationCandidate = candidateResult.candidate;
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.safeNavCandidateIdentified);

    logger.info("Phase 4 dashboard discovery collected.", {
      url: landingPageObservation.url,
      title: landingPageObservation.title,
      navItemCount: landingPageObservation.navItems.length,
      tileCount: landingPageObservation.tiles?.length ?? 0,
      buttonCount: landingPageObservation.buttons?.length ?? 0,
      tableCount: landingPageObservation.tables?.length ?? 0,
      sectionGroupCount: landingPageObservation.sectionGroups?.length ?? 0,
      candidateLabel: safeNavigationCandidate.label,
      candidateClassification: safeNavigationCandidate.classification,
    });

    if (safeNavigationCandidate.classification !== "SAFE_NAV" || !candidateResult.target) {
      failures.push(
        safeNavigationCandidate.label
          ? {
              code: WORKFLOW_FAILURE_CODES.safeNavigationBlocked,
              message: `Top dashboard candidate "${safeNavigationCandidate.label}" was not clearly safe to open.`,
              retryable: true,
            }
          : {
              code: WORKFLOW_FAILURE_CODES.safeNavCandidateNotFound,
              message: "No clearly ranked dashboard navigation candidate was found.",
              retryable: true,
            },
      );
    } else {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.safeNavigationAttempted);

      const openResult = await dashboardPage.openNavigationTarget(candidateResult.target);

      if (openResult.openBehavior === "unknown") {
        failures.push({
          code: WORKFLOW_FAILURE_CODES.safeNavigationBlocked,
          message: `Safe dashboard navigation target "${safeNavigationCandidate.label}" did not produce a detectable destination view.`,
          retryable: true,
        });
      } else {
        destinationPage = await discoveryPage.discoverDestinationPage({
          opened: true,
          openBehavior: openResult.openBehavior,
        });

        if (isDestinationPageDetected(destinationPage)) {
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.destinationPageDetected);
        } else {
          failures.push({
            code: WORKFLOW_FAILURE_CODES.destinationPageNotDetected,
            message: `Destination page for "${safeNavigationCandidate.label}" could not be mapped confidently.`,
            retryable: true,
          });
        }
      }
    }

    const observationPayload = phase4PortalDiscoveryPayloadSchema.parse({
      landingPage: landingPageObservation,
      safeNavigationCandidate,
      destinationPage,
      failures,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.phase4DiscoveryComplete);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.phase4DiscoveryComplete,
      completedAt: new Date().toISOString(),
      summary: "Phase 4 portal discovery completed.",
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
      safeNavigationCandidate,
      destinationPage,
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

function isDestinationPageDetected(destinationPage: DestinationPageObservation): boolean {
  return Boolean(
    destinationPage.url ||
      destinationPage.title ||
      destinationPage.pageType ||
      destinationPage.tabs.length > 0 ||
      destinationPage.sectionHeaders.length > 0 ||
      destinationPage.tables.length > 0 ||
      destinationPage.buttons.length > 0 ||
      destinationPage.searchBars.length > 0 ||
      destinationPage.cards.length > 0,
  );
}
