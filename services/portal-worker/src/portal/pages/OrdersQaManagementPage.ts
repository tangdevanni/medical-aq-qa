import { type Locator, type Page } from "@playwright/test";
import { QA_MANAGEMENT_SELECTORS } from "../selectors/qa-management.selectors";
import { clickAndWaitForSettledState, waitForFirstVisibleLocator } from "../utils/page-helpers";

export class OrdersQaManagementPage {
  constructor(private readonly page: Page) {}

  async isEntryVisible(): Promise<boolean> {
    return (await this.getEntryLocator()) !== null;
  }

  async open(): Promise<void> {
    const entry = await this.getEntryLocator();

    if (!entry) {
      throw new Error("Orders and QA Management entry is not visible.");
    }

    await clickAndWaitForSettledState(this.page, entry);
  }

  private async getEntryLocator(): Promise<Locator | null> {
    const linkLocator = this.page
      .getByRole("link", { name: /Orders and QA Management/i })
      .first();
    if (await linkLocator.isVisible().catch(() => false)) {
      return linkLocator;
    }

    const buttonLocator = this.page
      .getByRole("button", { name: /Orders and QA Management/i })
      .first();
    if (await buttonLocator.isVisible().catch(() => false)) {
      return buttonLocator;
    }

    return waitForFirstVisibleLocator(this.page, QA_MANAGEMENT_SELECTORS.entrySelectors, 2_500);
  }
}
