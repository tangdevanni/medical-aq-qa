import { DEFAULT_SERVICE_SETTINGS } from "@medical-ai-qa/shared-config";
import { type Locator, type Page } from "@playwright/test";
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
  passwordInputFound: boolean;
  loginButtonFound: boolean;
  visibleInputCount: number;
  headingMarkers: string[];
  signalCount: number;
  isLikelyLoginPage: boolean;
}

export type LoginAttemptOutcome =
  | "login_succeeded"
  | "login_failed"
  | "still_on_login"
  | "unexpected_page";

export interface LoginAttemptResult {
  outcome: LoginAttemptOutcome;
  diagnostics: LoginPageDiagnostics;
}

export class LoginPage {
  constructor(private readonly page: Page) {}

  async isLoaded(): Promise<boolean> {
    return (await this.collectDiagnostics()).isLikelyLoginPage;
  }

  async waitUntilLoaded(
    timeout = DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
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

    const signalCount = [
      hasBrandMarker,
      usernameInput !== null,
      passwordInput !== null,
      loginButton !== null,
    ].filter(Boolean).length;

    return {
      currentUrl: this.page.url(),
      title,
      passwordInputFound: passwordInput !== null,
      loginButtonFound: loginButton !== null,
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
    const usernameInput = await this.resolveUsernameInput();
    const passwordInput = await this.resolvePasswordInput();
    const submitButton = await this.resolveSubmitButton();

    if (!usernameInput || !passwordInput || !submitButton) {
      return {
        outcome: "unexpected_page",
        diagnostics: await this.collectDiagnostics(),
      };
    }

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const startingUrl = this.page.url();
    await submitButton.click();
    await this.page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    return this.waitForLoginOutcome(startingUrl);
  }

  private async waitForLoginOutcome(startingUrl: string): Promise<LoginAttemptResult> {
    const deadline = Date.now() + 15_000;
    let diagnostics = await this.collectDiagnostics();

    while (Date.now() < deadline) {
      if (!diagnostics.isLikelyLoginPage) {
        return {
          outcome: "login_succeeded",
          diagnostics,
        };
      }

      if (await hasVisibleLocator(this.page, LOGIN_SELECTORS.loginErrorSelectors, 500)) {
        return {
          outcome: "login_failed",
          diagnostics,
        };
      }

      if (this.page.url() !== startingUrl && diagnostics.signalCount < 2) {
        return {
          outcome: "unexpected_page",
          diagnostics,
        };
      }

      await this.page.waitForTimeout(500);
      diagnostics = await this.collectDiagnostics();
    }

    return {
      outcome: diagnostics.isLikelyLoginPage ? "still_on_login" : "unexpected_page",
      diagnostics,
    };
  }

  private async resolveUsernameInput(): Promise<Locator | null> {
    const emailLocator = this.page.getByLabel(/email/i).first();
    if (await emailLocator.isVisible().catch(() => false)) {
      return emailLocator;
    }

    const usernameLocator = this.page.getByLabel(/user(name)?/i).first();
    if (await usernameLocator.isVisible().catch(() => false)) {
      return usernameLocator;
    }

    return waitForFirstVisibleLocator(this.page, LOGIN_SELECTORS.usernameInputSelectors, 800);
  }

  private async resolvePasswordInput(): Promise<Locator | null> {
    return waitForFirstVisibleLocator(this.page, LOGIN_SELECTORS.passwordInputSelectors, 800);
  }

  private async resolveSubmitButton(): Promise<Locator | null> {
    for (const pattern of LOGIN_SELECTORS.submitButtonNamePatterns) {
      const button = this.page.getByRole("button", { name: pattern }).first();
      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }

    return waitForFirstVisibleLocator(this.page, LOGIN_SELECTORS.submitButtonSelectors, 800);
  }

  private async getHeadingMarkers(): Promise<string[]> {
    const headings = await collectVisibleTextsFromSelectors(
      this.page,
      [...LOGIN_SELECTORS.headingSelectors, ...LOGIN_SELECTORS.brandMarkerSelectors],
      8,
    );

    return headings.filter((heading) => heading.length <= 80).slice(0, 6);
  }
}
