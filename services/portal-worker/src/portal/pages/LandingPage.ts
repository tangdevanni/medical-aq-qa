import { type Page } from "@playwright/test";
import { LANDING_SELECTORS } from "../selectors/landing.selectors";
import { hasVisibleLocator, normalizeText, waitForFirstVisibleLocator } from "../utils/page-helpers";
import { LOGIN_SELECTORS } from "../selectors/login.selectors";

export class LandingPage {
  constructor(private readonly page: Page) {}

  async isAuthenticatedShell(timeout = 1_500): Promise<boolean> {
    await this.page.locator("body").waitFor({ state: "visible", timeout: 15_000 });
    const usernameInput = await waitForFirstVisibleLocator(
      this.page,
      LOGIN_SELECTORS.usernameInputSelectors,
      Math.min(timeout, 1_000),
    );
    const passwordInput = await waitForFirstVisibleLocator(
      this.page,
      LOGIN_SELECTORS.passwordInputSelectors,
      Math.min(timeout, 1_000),
    );

    if (usernameInput || passwordInput) {
      return false;
    }

    return hasVisibleLocator(
      this.page,
      ["main", "nav", "aside", '[role="main"]', '[role="navigation"]'],
      timeout,
    );
  }

  async waitForAuthenticatedShell(timeout = 15_000): Promise<void> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (await this.isAuthenticatedShell(Math.min(1_000, timeout))) {
        return;
      }

      await this.page.waitForTimeout(400);
    }

    throw new Error("Authenticated shell was not detected.");
  }

  async readHeading(): Promise<string | null> {
    const heading = this.page.locator(LANDING_SELECTORS.heading).first();
    await heading.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    return normalizeText(await heading.textContent().catch(() => null));
  }
}
