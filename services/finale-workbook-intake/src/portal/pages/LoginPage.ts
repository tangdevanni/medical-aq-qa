import type { Page } from "@playwright/test";
import type { AutomationStepLog, PortalSafetyConfig } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { selectorRegistry } from "../selectorRegistry";
import { assertReadOnlyActionAllowed, resolvePortalSafetyConfig } from "../safety/readOnlySafety";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  resolveFirstVisibleLocator,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../utils/locatorResolution";
import {
  capturePageDebugArtifacts,
  pauseOnFailureIfRequested,
} from "../utils/pageDiagnostics";

export class LoginPage {
  private readonly safety: PortalSafetyConfig;

  constructor(
    private readonly page: Page,
    private readonly options: {
      logger?: Logger;
      debugConfig?: PortalDebugConfig;
      debugDir?: string;
      safety?: PortalSafetyConfig;
    } = {},
  ) {
    this.safety = resolvePortalSafetyConfig(this.options.safety);
  }

  async ensureLoggedIn(input: {
    baseUrl?: string;
    username?: string;
    password?: string;
  }): Promise<AutomationStepLog[]> {
    if (!input.baseUrl) {
      return [];
    }

    const stepLogs: AutomationStepLog[] = [];
    const urlBefore = this.page.url();
    await this.page.goto(input.baseUrl, { waitUntil: "domcontentloaded" });
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    const usernameResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.login.username,
      step: "login_username",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });
    const passwordResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.login.password,
      step: "login_password",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });
    const submitResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.login.submit,
      step: "login_submit",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });

    if (!usernameResolution.locator || !passwordResolution.locator || !submitResolution.locator) {
      const authenticatedResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: selectorRegistry.login.authenticatedIndicators,
        step: "login_authenticated_indicator",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
      });

      const failureArtifacts = authenticatedResolution.locator
        ? {
            screenshotPath: null,
            htmlPath: null,
            summaryPath: null,
            title: await this.page.title().catch(() => null),
            url: this.page.url(),
          }
        : await capturePageDebugArtifacts({
            page: this.page,
            outputDir: this.options.debugDir,
            step: "login",
            reason: "selectors-missing",
            debugConfig: this.options.debugConfig,
            textHints: ["login", "sign in", "dashboard", "patients"],
          });

      stepLogs.push(
        createAutomationStepLog({
          step: "login",
          message: authenticatedResolution.locator
            ? "Login form was not visible; assuming an existing authenticated session."
            : "Login form selectors were not resolved and no authenticated marker was found.",
          urlBefore,
          urlAfter: this.page.url(),
          selectorUsed: authenticatedResolution.matchedCandidate
            ? authenticatedResolution.matchedCandidate.description
            : null,
          found: authenticatedResolution.locator ? [this.page.url()] : [],
          missing: authenticatedResolution.locator
            ? []
            : ["login.username", "login.password", "login.submit"],
          evidence: [
            ...usernameResolution.attempts.map(selectorAttemptToEvidence),
            ...passwordResolution.attempts.map(selectorAttemptToEvidence),
            ...submitResolution.attempts.map(selectorAttemptToEvidence),
            ...authenticatedResolution.attempts.map(selectorAttemptToEvidence),
            failureArtifacts.summaryPath ? `Debug summary: ${failureArtifacts.summaryPath}` : "",
            failureArtifacts.htmlPath ? `Debug HTML: ${failureArtifacts.htmlPath}` : "",
            failureArtifacts.screenshotPath ? `Debug screenshot: ${failureArtifacts.screenshotPath}` : "",
            `Page title: ${failureArtifacts.title ?? "unknown"}`,
            `Page URL: ${failureArtifacts.url}`,
          ].filter(Boolean),
          safeReadConfirmed: true,
        }),
      );

      if (!authenticatedResolution.locator) {
        await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      }

      return stepLogs;
    }

    if (!input.username || !input.password) {
      throw new Error("Portal credentials are required when saved auth state is unavailable.");
    }

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "AUTH_ONLY",
      description: "portal username input fill",
    });
    await usernameResolution.locator.fill(input.username);
    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "AUTH_ONLY",
      description: "portal password input fill",
    });
    await passwordResolution.locator.fill(input.password);
    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "AUTH_ONLY",
      description: "portal login submit",
    });
    await submitResolution.locator.click();
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    stepLogs.push(
      createAutomationStepLog({
        step: "login",
        message: "Completed portal login flow in AUTH_ONLY mode.",
        urlBefore,
        urlAfter: this.page.url(),
        selectorUsed: submitResolution.matchedCandidate?.description ?? null,
        found: [this.page.url()],
        evidence: [
          ...usernameResolution.attempts.map(selectorAttemptToEvidence),
          ...passwordResolution.attempts.map(selectorAttemptToEvidence),
          ...submitResolution.attempts.map(selectorAttemptToEvidence),
        ],
        safeReadConfirmed: true,
      }),
    );

    return stepLogs;
  }
}
