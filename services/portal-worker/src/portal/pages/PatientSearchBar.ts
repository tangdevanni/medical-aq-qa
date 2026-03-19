import { type Locator, type Page } from "@playwright/test";
import { PATIENT_SEARCH_SELECTORS } from "../selectors/patient-search.selectors";
import { waitForFirstVisibleLocator } from "../utils/page-helpers";

export class PatientSearchBar {
  constructor(private readonly page: Page) {}

  async isVisible(): Promise<boolean> {
    return (await this.getLocator()) !== null;
  }

  async getLocator(): Promise<Locator | null> {
    for (const pattern of PATIENT_SEARCH_SELECTORS.placeholderPatterns) {
      const locator = this.page.getByPlaceholder(pattern).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    for (const pattern of PATIENT_SEARCH_SELECTORS.labelPatterns) {
      const locator = this.page.getByLabel(pattern).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    return waitForFirstVisibleLocator(this.page, PATIENT_SEARCH_SELECTORS.inputSelectors, 1_500);
  }
}
