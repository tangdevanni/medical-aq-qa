import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  ordersQaInteractionForensicsPayloadSchema,
  type DestinationSurfaceObservation,
  type InteractionAttemptSummary,
  type InteractionForensicsMethod,
  type InteractiveForensicsCandidate,
  type LandingPageObservation,
  type OrdersQaContainerSummary,
  type OrdersQaForensicsTarget,
  type PortalJob,
  type PortalJobResult,
  type PortalObservationFailure,
  type SuccessfulInteractionAttempt,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { type PortalWorkerEnv } from "../config/env";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { formatLoginDiagnostics } from "../auth/login-diagnostics";
import { DashboardPage } from "../portal/pages/DashboardPage";
import { DestinationSurfacePage } from "../portal/pages/DestinationSurfacePage";
import {
  type ResolvedInteractiveCandidate,
  InteractionForensicsPage,
} from "../portal/pages/InteractionForensicsPage";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";
import { PortalDiscoveryPage } from "../portal/pages/PortalDiscoveryPage";
import {
  analyzeInteractionTransition,
  isMeaningfulForensicsResultType,
} from "../portal/utils/transition-detector";

export interface OrdersQaInteractionForensicsWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runOrdersQaInteractionForensicsWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: OrdersQaInteractionForensicsWorkflowOptions = {},
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);
  const failures: PortalObservationFailure[] = [];
  let landingPageObservation: LandingPageObservation | undefined;
  let forensicsTarget: OrdersQaForensicsTarget = {
    label: "Orders and QA Management",
    found: false,
  };
  let containerSummary: OrdersQaContainerSummary = {
    visible: false,
    textSummary: null,
  };
  let interactiveCandidates: InteractiveForensicsCandidate[] = [];
  let interactionAttempts: InteractionAttemptSummary[] = [];
  let successfulAttempt: SuccessfulInteractionAttempt | null = null;
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
    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaForensicsStarted);

    landingPageObservation = {
      ...(await discoveryPage.discover()),
      hasPatientSearch: await dashboardPage.hasGlobalPatientSearch(),
      hasOrdersQaManagementTile: await dashboardPage.hasOrdersQaManagementTile(),
    };

    const dashboardUrl = landingPageObservation.url ?? page.url();
    const inspection = await new InteractionForensicsPage(page).inspect();
    forensicsTarget = inspection.target;
    containerSummary = inspection.container;
    interactiveCandidates = inspection.interactiveCandidates;

    if (!forensicsTarget.found || !containerSummary.visible) {
      failures.push({
        code: WORKFLOW_FAILURE_CODES.ordersQaContainerNotFound,
        message: "Orders and QA Management container was not found on the dashboard.",
        retryable: true,
      });
    } else {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaContainerFound);
    }

    if (inspection.resolvedCandidates.length === 0) {
      failures.push({
        code: WORKFLOW_FAILURE_CODES.interactiveCandidatesNotFound,
        message: "No interactive descendants were found inside the Orders and QA Management container.",
        retryable: true,
      });
    } else {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.interactiveCandidatesEnumerated);
    }

    logger.info("Orders QA interaction forensics baseline collected.", {
      landingUrl: landingPageObservation.url,
      landingTitle: landingPageObservation.title,
      targetFound: forensicsTarget.found,
      containerVisible: containerSummary.visible,
      candidateCount: interactiveCandidates.length,
    });

    if (
      failures.some((failure) =>
        failure.code === WORKFLOW_FAILURE_CODES.ordersQaContainerNotFound ||
        failure.code === WORKFLOW_FAILURE_CODES.interactiveCandidatesNotFound,
      )
    ) {
      options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaInteractionForensicsComplete);
      return buildForensicsResult({
        job,
        status: WORKFLOW_CHECKPOINTS.ordersQaInteractionForensicsComplete,
        summary: "Orders and QA Management interaction forensics completed.",
        landingPageObservation,
        forensicsTarget,
        containerSummary,
        interactiveCandidates,
        interactionAttempts,
        successfulAttempt,
        destinationSurface,
        failures,
      });
    }

    const rankedCandidates = rankCandidatesForAttempt(inspection.resolvedCandidates);

    for (const candidate of rankedCandidates) {
      const methods = buildAttemptMethods(candidate);

      for (const method of methods) {
        const attemptPage = await context.newPage();

        try {
          await attemptPage.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
          await new LandingPage(attemptPage).waitForAuthenticatedShell();

          if (!(await new DashboardPage(attemptPage).isLoaded())) {
            throw new WorkflowError(
              WORKFLOW_FAILURE_CODES.pageUnexpected,
              "Dashboard was not detected while preparing a forensic attempt.",
              true,
            );
          }

          const attemptCandidate = await new InteractionForensicsPage(attemptPage).resolveCandidateByIndex(
            candidate.metadata.candidateIndex,
          );

          if (!attemptCandidate || !attemptCandidate.metadata.visible || !attemptCandidate.metadata.enabled) {
            continue;
          }

          const transitionResult = await analyzeInteractionTransition(
            attemptPage,
            attemptCandidate.locator,
            method,
          );
          const attemptSummary: InteractionAttemptSummary = {
            ...transitionResult.attempt,
            candidateIndex: candidate.metadata.candidateIndex,
            method,
          };

          interactionAttempts.push(attemptSummary);
          options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.interactionAttempted);

          if (attemptSummary.success && isMeaningfulForensicsResultType(attemptSummary.resultType)) {
            successfulAttempt = {
              candidateIndex: attemptSummary.candidateIndex,
              method: attemptSummary.method,
              resultType: attemptSummary.resultType,
            };
            options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.meaningfulTransitionDetected);

            destinationSurface = await new DestinationSurfacePage(transitionResult.targetPage).mapSurface(true);

            if (destinationSurface.detected) {
              options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.destinationSurfaceDetected);
            } else {
              failures.push({
                code: WORKFLOW_FAILURE_CODES.destinationSurfaceNotDetected,
                message: "A meaningful Orders QA interaction occurred, but the destination surface could not be mapped.",
                retryable: true,
              });
            }

            options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaInteractionForensicsComplete);
            return buildForensicsResult({
              job,
              status: WORKFLOW_CHECKPOINTS.ordersQaInteractionForensicsComplete,
              summary: "Orders and QA Management interaction forensics completed.",
              landingPageObservation,
              forensicsTarget,
              containerSummary,
              interactiveCandidates,
              interactionAttempts,
              successfulAttempt,
              destinationSurface,
              failures,
            });
          }
        } finally {
          await closeAttemptPages(attemptPage, context.pages());
        }
      }
    }

    failures.push({
      code: WORKFLOW_FAILURE_CODES.noMeaningfulInteractionPathFound,
      message: "No tested Orders QA interaction path produced a meaningful state transition.",
      retryable: true,
    });

    options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.ordersQaInteractionForensicsComplete);
    return buildForensicsResult({
      job,
      status: WORKFLOW_CHECKPOINTS.ordersQaInteractionForensicsComplete,
      summary: "Orders and QA Management interaction forensics completed.",
      landingPageObservation,
      forensicsTarget,
      containerSummary,
      interactiveCandidates,
      interactionAttempts,
      successfulAttempt,
      destinationSurface,
      failures,
    });
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
      forensicsTarget,
      containerSummary,
      interactiveCandidates,
      interactionAttempts,
      successfulAttempt,
      destinationSurface,
      failures,
      error: failure,
    };
  } finally {
    await browser.close();
  }
}

function buildForensicsResult(input: {
  job: PortalJob;
  status: WorkflowCheckpointStatus;
  summary: string;
  landingPageObservation?: LandingPageObservation;
  forensicsTarget: OrdersQaForensicsTarget;
  containerSummary: OrdersQaContainerSummary;
  interactiveCandidates: InteractiveForensicsCandidate[];
  interactionAttempts: InteractionAttemptSummary[];
  successfulAttempt: SuccessfulInteractionAttempt | null;
  destinationSurface: DestinationSurfaceObservation;
  failures: PortalObservationFailure[];
}): PortalJobResult {
  const payload = ordersQaInteractionForensicsPayloadSchema.parse({
    target: input.forensicsTarget,
    container: input.containerSummary,
    interactiveCandidates: input.interactiveCandidates,
    attempts: input.interactionAttempts,
    successfulAttempt: input.successfulAttempt,
    destinationSurface: input.destinationSurface,
    failures: input.failures,
  });

  return {
    jobId: input.job.jobId,
    portal: input.job.portal,
    status: input.status,
    completedAt: new Date().toISOString(),
    summary: input.summary,
    landingPage: input.landingPageObservation,
    forensicsTarget: payload.target,
    containerSummary: payload.container,
    interactiveCandidates: payload.interactiveCandidates,
    interactionAttempts: payload.attempts,
    successfulAttempt: payload.successfulAttempt,
    destinationSurface: payload.destinationSurface,
    failures: payload.failures,
    data: payload as unknown as Record<string, unknown>,
  };
}

function rankCandidatesForAttempt(
  candidates: ResolvedInteractiveCandidate[],
): ResolvedInteractiveCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftScore = scoreCandidate(left);
    const rightScore = scoreCandidate(right);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.metadata.candidateIndex - right.metadata.candidateIndex;
  });
}

function scoreCandidate(candidate: ResolvedInteractiveCandidate): number {
  let score = 0;

  if (candidate.metadata.isPrimaryActionLike) {
    score += 100;
  }

  if (candidate.classification === "SAFE_NAV") {
    score += 50;
  }

  if (candidate.metadata.hasHref) {
    score += 20;
  }

  if (candidate.metadata.role === "button" || candidate.metadata.role === "link") {
    score += 10;
  }

  if (candidate.metadata.tagName === "button" || candidate.metadata.tagName === "a") {
    score += 10;
  }

  return score;
}

function buildAttemptMethods(
  candidate: ResolvedInteractiveCandidate,
): InteractionForensicsMethod[] {
  if (
    !candidate.metadata.visible ||
    !candidate.metadata.enabled ||
    candidate.classification === "RISKY_ACTION" ||
    (!candidate.metadata.isPrimaryActionLike &&
      candidate.classification !== "SAFE_NAV" &&
      !candidate.metadata.hasHref)
  ) {
    return [];
  }

  const methods: InteractionForensicsMethod[] = ["click", "hover_click"];

  if (candidate.supportsEnter) {
    methods.push("enter_key");
  }

  if (candidate.supportsSpace) {
    methods.push("space_key");
  }

  return methods;
}

async function closeAttemptPages(attemptPage: Page, pages: Page[]): Promise<void> {
  for (const page of pages) {
    if (page === attemptPage) {
      continue;
    }

    if (page.isClosed()) {
      continue;
    }

    await page.close().catch(() => undefined);
  }

  if (!attemptPage.isClosed()) {
    await attemptPage.close().catch(() => undefined);
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
