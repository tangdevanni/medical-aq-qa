import { type Logger } from "@medical-ai-qa/shared-logging";
import { type Page } from "@playwright/test";
import { formatLoginDiagnostics } from "./login-diagnostics";
import { LandingPage } from "../portal/pages/LandingPage";
import { LoginPage } from "../portal/pages/LoginPage";

export async function executeLoginWorkflow(
  page: Page,
  portalUrl: string,
  username: string,
  password: string,
  logger: Logger,
): Promise<{ heading: string | null }> {
  const loginPage = new LoginPage(page);
  const landingPage = new LandingPage(page);

  logger.info("Opening portal login page.", { portalUrl });
  await loginPage.goto(portalUrl);
  const detection = await loginPage.waitUntilLoaded();

  if (!detection.isLikelyLoginPage) {
    throw new Error(
      formatLoginDiagnostics("Login page was not detected before credential submission.", detection),
    );
  }

  const loginResult = await loginPage.login(username, password);
  if (loginResult.outcome !== "login_succeeded") {
    throw new Error(
      formatLoginDiagnostics(
        `Login did not complete successfully: ${loginResult.outcome}.`,
        loginResult.diagnostics,
      ),
    );
  }

  await landingPage.waitForAuthenticatedShell();

  logger.info("Reading landing page heading after login.");
  const heading = await landingPage.readHeading();
  return { heading };
}
