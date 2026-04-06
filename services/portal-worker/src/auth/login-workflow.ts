import { type Logger } from "@medical-ai-qa/shared-logging";
import { WORKFLOW_CHECKPOINTS, type WorkflowCheckpointStatus } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { formatLoginDiagnostics } from "./login-diagnostics";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";

export interface ExecuteLoginWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function executeLoginWorkflow(
  page: Page,
  portalUrl: string,
  username: string,
  password: string,
  logger: Logger,
  options: ExecuteLoginWorkflowOptions = {},
): Promise<{ heading: string | null }> {
  const loginPage = new LoginPage(page);
  const landingPage = new LandingPage(page);

  logger.info("Opening portal login page.", { portalUrl });
  await loginPage.goto(portalUrl);
  const detection = await loginPage.waitUntilLoaded();

  if (!detection.isLikelyLoginPage) {
    throw new WorkflowError(
      WORKFLOW_FAILURE_CODES.pageUnexpected,
      formatLoginDiagnostics("Login page was not detected before credential submission.", detection),
      true,
    );
  }

  logger.info("Finale Health login page detected.", buildSafeLoginLog(detection));
  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.loginPageDetected);

  const loginResult = await loginPage.login(username, password);
  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.credentialsSubmitted);

  logger.info("Finale Health login submit assessed.", {
    outcome: loginResult.outcome,
    submitAttempts: loginResult.submitAttempts,
    ...buildSafeLoginLog(loginResult.diagnostics),
  });

  if (loginResult.outcome !== "login_succeeded") {
    throw new WorkflowError(
      WORKFLOW_FAILURE_CODES.loginFailed,
      formatLoginDiagnostics(
        `Login did not complete successfully: ${loginResult.outcome}.`,
        loginResult.diagnostics,
      ),
      true,
    );
  }

  await landingPage.waitForAuthenticatedShell();
  options.onCheckpoint?.(WORKFLOW_CHECKPOINTS.authenticated);

  logger.info("Reading landing page heading after login.");
  const heading = await landingPage.readHeading();
  return { heading };
}

function buildSafeLoginLog(input: {
  currentUrl: string;
  title: string | null;
  usernameFieldPopulated: boolean;
  passwordFieldPopulated: boolean;
  loginButtonEnabled: boolean;
  inlineErrorDetected: boolean;
  inlineErrorText: string | null;
  authenticatedPageDetected: boolean;
}) {
  return {
    currentUrl: input.currentUrl,
    title: input.title,
    usernameFieldPopulated: input.usernameFieldPopulated,
    passwordFieldPopulated: input.passwordFieldPopulated,
    loginButtonEnabled: input.loginButtonEnabled,
    inlineErrorDetected: input.inlineErrorDetected,
    inlineErrorText: input.inlineErrorText,
    authenticatedPageDetected: input.authenticatedPageDetected,
  };
}
