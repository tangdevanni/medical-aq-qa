import { DEFAULT_SERVICE_SETTINGS } from "@medical-ai-qa/shared-config";
import { type Locator, type Page } from "@playwright/test";
import { LandingPage } from "./LandingPage";
import { LOGIN_SELECTORS } from "../selectors/login.selectors";
import {
  collectVisibleTextsFromSelectors,
  countVisibleElements,
  hasVisibleLocator,
  normalizeText,
  waitForFirstVisibleLocator,
} from "../utils/page-helpers";

export interface LoginPageDiagnostics {
  currentUrl: string;
  title: string | null;
  usernameInputFound: boolean;
  passwordInputFound: boolean;
  loginButtonFound: boolean;
  usernameFieldPopulated: boolean;
  passwordFieldPopulated: boolean;
  loginButtonEnabled: boolean;
  inlineErrorDetected: boolean;
  inlineErrorText: string | null;
  authenticatedPageDetected: boolean;
  visibleInputCount: number;
  headingMarkers: string[];
  signalCount: number;
  isLikelyLoginPage: boolean;
}

export type LoginAttemptOutcome =
  | "login_succeeded"
  | "login_failed_inline_error"
  | "login_failed_still_on_login"
  | "login_failed_unknown"
  | "unexpected_page";

export interface LoginAttemptResult {
  outcome: LoginAttemptOutcome;
  diagnostics: LoginPageDiagnostics;
  submitAttempts: number;
}

export class LoginPage {
  constructor(private readonly page: Page) {}

  async isLoaded(): Promise<boolean> {
    return (await this.collectDiagnostics()).isLikelyLoginPage;
  }

  async waitUntilLoaded(
    timeout: number = DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
  ): Promise<LoginPageDiagnostics> {
    const deadline = Date.now() + timeout;
    let diagnostics = await this.collectDiagnostics();

    while (Date.now() < deadline) {
      if (diagnostics.isLikelyLoginPage) {
        return diagnostics;
      }

      await this.page.waitForTimeout(400);
      diagnostics = await this.collectDiagnostics();
    }

    return diagnostics;
  }

  async collectDiagnostics(): Promise<LoginPageDiagnostics> {
    const landingPage = new LandingPage(this.page);
    const [title, hasBrandMarker, usernameInput, passwordInput, loginButton, visibleInputCount, headingMarkers] =
      await Promise.all([
        this.page.title().then(normalizeText).catch(() => null),
        hasVisibleLocator(this.page, LOGIN_SELECTORS.brandMarkerSelectors, 600),
        this.resolveUsernameInput(),
        this.resolvePasswordInput(),
        this.resolveSubmitButton(),
        countVisibleElements(this.page.locator("input"), 20),
        this.getHeadingMarkers(),
      ]);
    const [usernameFieldPopulated, passwordFieldPopulated, loginButtonEnabled, inlineErrorText, authenticatedPageDetected] =
      await Promise.all([
        this.isFieldPopulated(usernameInput),
        this.isFieldPopulated(passwordInput),
        this.isButtonEnabled(loginButton),
        this.readInlineErrorText(),
        landingPage.isAuthenticatedShell(800).catch(() => false),
      ]);
    const inlineErrorDetected = inlineErrorText !== null;

    const signalCount = [
      hasBrandMarker,
      usernameInput !== null,
      passwordInput !== null,
      loginButton !== null,
    ].filter(Boolean).length;

    return {
      currentUrl: this.page.url(),
      title,
      usernameInputFound: usernameInput !== null,
      passwordInputFound: passwordInput !== null,
      loginButtonFound: loginButton !== null,
      usernameFieldPopulated,
      passwordFieldPopulated,
      loginButtonEnabled,
      inlineErrorDetected,
      inlineErrorText,
      authenticatedPageDetected,
      visibleInputCount,
      headingMarkers,
      signalCount,
      isLikelyLoginPage: signalCount >= 3 || (signalCount >= 2 && passwordInput !== null),
    };
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle", { timeout: 7_500 }).catch(() => undefined);
  }

  async login(username: string, password: string): Promise<LoginAttemptResult> {
    const usernameInput = await this.waitForUsernameInputVisible();
    const passwordInput = await this.waitForPasswordInputVisible();
    const submitButton = await this.waitForSubmitButtonReady();

    if (!usernameInput || !passwordInput || !submitButton) {
      return {
        outcome: "unexpected_page",
        diagnostics: await this.collectDiagnostics(),
        submitAttempts: 0,
      };
    }

    const usernameFieldPopulated = await this.clearAndFill(usernameInput, username);
    const passwordFieldPopulated = await this.clearAndFill(passwordInput, password);
    await passwordInput.press("Tab").catch(() => undefined);
    await this.page.waitForTimeout(150);

    if (!usernameFieldPopulated || !passwordFieldPopulated) {
      return {
        outcome: "login_failed_unknown",
        diagnostics: await this.collectDiagnostics(),
        submitAttempts: 0,
      };
    }

    const firstAttempt = await this.submitAndWaitForOutcome(submitButton);
    if (!this.shouldRetrySubmit(firstAttempt)) {
      return {
        ...firstAttempt,
        submitAttempts: 1,
      };
    }

    const retryButton = await this.waitForSubmitButtonReady(4_000);
    if (!retryButton) {
      return {
        ...firstAttempt,
        submitAttempts: 1,
      };
    }

    await this.page.waitForTimeout(500);
    const retryAttempt = await this.submitAndWaitForOutcome(retryButton);

    return {
      ...retryAttempt,
      submitAttempts: 2,
    };
  }

  private async submitAndWaitForOutcome(submitButton: Locator): Promise<Omit<LoginAttemptResult, "submitAttempts">> {
    const startingUrl = this.page.url();
    await submitButton.click();
    await this.page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    return this.waitForLoginOutcome(startingUrl);
  }

  private async waitForLoginOutcome(
    startingUrl: string,
  ): Promise<Omit<LoginAttemptResult, "submitAttempts">> {
    const deadline = Date.now() + 15_000;
    let diagnostics = await this.collectDiagnostics();

    while (Date.now() < deadline) {
      if (diagnostics.authenticatedPageDetected && !diagnostics.isLikelyLoginPage) {
        return {
          outcome: "login_succeeded",
          diagnostics,
        };
      }

      if (diagnostics.inlineErrorDetected) {
        return {
          outcome: "login_failed_inline_error",
          diagnostics,
        };
      }

      if (this.page.url() !== startingUrl && !diagnostics.isLikelyLoginPage && !diagnostics.authenticatedPageDetected) {
        return {
          outcome: "unexpected_page",
          diagnostics,
        };
      }

      await this.page.waitForTimeout(500);
      diagnostics = await this.collectDiagnostics();
    }

    diagnostics = await this.collectDiagnostics();

    if (diagnostics.authenticatedPageDetected && !diagnostics.isLikelyLoginPage) {
      return {
        outcome: "login_succeeded",
        diagnostics,
      };
    }

    if (diagnostics.inlineErrorDetected) {
      return {
        outcome: "login_failed_inline_error",
        diagnostics,
      };
    }

    return {
      outcome: diagnostics.isLikelyLoginPage
        ? "login_failed_still_on_login"
        : this.page.url() !== startingUrl
          ? "unexpected_page"
          : "login_failed_unknown",
      diagnostics,
    };
  }

  private async waitForUsernameInputVisible(
    timeout: number = DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
  ): Promise<Locator | null> {
    return this.resolveUsernameInput(timeout);
  }

  private async waitForPasswordInputVisible(
    timeout: number = DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
  ): Promise<Locator | null> {
    return this.resolvePasswordInput(timeout);
  }

  private async waitForSubmitButtonReady(
    timeout: number = DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
  ): Promise<Locator | null> {
    const submitButton = await this.resolveSubmitButton(timeout);
    if (!submitButton) {
      return null;
    }

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.isButtonEnabled(submitButton)) {
        return submitButton;
      }

      await this.page.waitForTimeout(250);
    }

    return (await this.isButtonEnabled(submitButton)) ? submitButton : null;
  }

  private async resolveUsernameInput(
    timeout: number = 1_000,
  ): Promise<Locator | null> {
    const emailLocator = this.page.getByLabel(/email/i).first();
    if (await emailLocator.isVisible().catch(() => false)) {
      return emailLocator;
    }

    const usernameLocator = this.page.getByLabel(/user(name)?/i).first();
    if (await usernameLocator.isVisible().catch(() => false)) {
      return usernameLocator;
    }

    return waitForFirstVisibleLocator(
      this.page,
      LOGIN_SELECTORS.usernameInputSelectors,
      timeout,
    );
  }

  private async resolvePasswordInput(
    timeout: number = 1_000,
  ): Promise<Locator | null> {
    return waitForFirstVisibleLocator(this.page, LOGIN_SELECTORS.passwordInputSelectors, timeout);
  }

  private async resolveSubmitButton(
    timeout: number = 1_000,
  ): Promise<Locator | null> {
    for (const pattern of LOGIN_SELECTORS.submitButtonNamePatterns) {
      const button = this.page.getByRole("button", { name: pattern }).first();
      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }

    return waitForFirstVisibleLocator(this.page, LOGIN_SELECTORS.submitButtonSelectors, timeout);
  }

  private async getHeadingMarkers(): Promise<string[]> {
    const headings = await collectVisibleTextsFromSelectors(
      this.page,
      [...LOGIN_SELECTORS.headingSelectors, ...LOGIN_SELECTORS.brandMarkerSelectors],
      8,
    );

    return headings.filter((heading) => heading.length <= 80).slice(0, 6);
  }

  private async clearAndFill(locator: Locator, value: string): Promise<boolean> {
    await locator.click({ clickCount: 3 }).catch(() => undefined);
    await locator.fill("").catch(() => undefined);
    await locator.press("ControlOrMeta+A").catch(() => undefined);
    await locator.press("Delete").catch(() => undefined);
    await locator.fill(value);

    if (await this.isFieldPopulated(locator)) {
      return true;
    }

    await locator.click({ clickCount: 3 }).catch(() => undefined);
    await locator.fill(value).catch(() => undefined);
    return this.isFieldPopulated(locator);
  }

  private async isFieldPopulated(locator: Locator | null): Promise<boolean> {
    if (!locator) {
      return false;
    }

    const value = await locator.inputValue().catch(() => "");
    return value.length > 0;
  }

  private async isButtonEnabled(locator: Locator | null): Promise<boolean> {
    if (!locator) {
      return false;
    }

    return locator.isEnabled().catch(() => false);
  }

  private async readInlineErrorText(): Promise<string | null> {
    const candidates = await collectVisibleTextsFromSelectors(
      this.page,
      LOGIN_SELECTORS.loginErrorSelectors,
      8,
    );

    for (const candidate of candidates) {
      if (candidate.length > 160) {
        continue;
      }

      if (!LOGIN_SELECTORS.genericInlineErrorPatterns.some((pattern) => pattern.test(candidate))) {
        continue;
      }

      return candidate;
    }

    return null;
  }

  private shouldRetrySubmit(
    result: Omit<LoginAttemptResult, "submitAttempts">,
  ): boolean {
    return (
      result.outcome === "login_failed_still_on_login" &&
      result.diagnostics.usernameFieldPopulated &&
      result.diagnostics.passwordFieldPopulated &&
      !result.diagnostics.inlineErrorDetected
    );
  }
}
