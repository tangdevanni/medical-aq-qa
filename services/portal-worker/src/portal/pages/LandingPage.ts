import { type Page } from "@playwright/test";
import { LANDING_SELECTORS } from "../selectors/landing.selectors";
import { normalizeText, waitForFirstVisibleLocator } from "../utils/page-helpers";
import { LOGIN_SELECTORS } from "../selectors/login.selectors";

export class LandingPage {
  constructor(private readonly page: Page) {}

  async waitForAuthenticatedShell(): Promise<void> {
    await this.page.locator("body").waitFor({ state: "visible", timeout: 15_000 });
    const usernameInput = await waitForFirstVisibleLocator(
      this.page,
      LOGIN_SELECTORS.usernameInputSelectors,
      1_000,
    );
    const passwordInput = await waitForFirstVisibleLocator(
      this.page,
      LOGIN_SELECTORS.passwordInputSelectors,
      1_000,
    );

    await usernameInput?.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
    await passwordInput?.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
  }

  async readHeading(): Promise<string | null> {
    const heading = this.page.locator(LANDING_SELECTORS.heading).first();
    await heading.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    return normalizeText(await heading.textContent().catch(() => null));
  }
}
