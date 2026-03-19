import { type DocumentTrackingDestinationSurface } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { PortalDiscoveryPage } from "./PortalDiscoveryPage";
import { SUBVIEW_TRANSITION_SELECTORS } from "../selectors/subview-transition.selectors";

export class SubviewSurfacePage {
  private readonly discoveryPage: PortalDiscoveryPage;

  constructor(private readonly page: Page) {
    this.discoveryPage = new PortalDiscoveryPage(page);
  }

  async mapSurface(detected: boolean): Promise<DocumentTrackingDestinationSurface> {
    if (!detected) {
      return {
        detected: false,
        pageType: "unknown",
        url: null,
        title: null,
        tabs: [],
        sectionHeaders: [],
        tables: [],
        buttons: [],
        searchBars: [],
        cards: [],
        layoutPatterns: [],
        hasVisibleRows: false,
      };
    }

    const observation = await this.discoveryPage.discoverDestinationPage({
      opened: true,
      openBehavior: "same_page",
    });
    const hasVisibleRows = await this.hasVisibleRows();

    return {
      detected: true,
      pageType: classifySubviewSurfaceType(observation, hasVisibleRows),
      url: observation.url,
      title: observation.title,
      tabs: observation.tabs,
      sectionHeaders: observation.sectionHeaders,
      tables: observation.tables,
      buttons: observation.buttons,
      searchBars: observation.searchBars,
      cards: observation.cards,
      layoutPatterns: observation.layoutPatterns,
      hasVisibleRows,
    };
  }

  private async hasVisibleRows(): Promise<boolean> {
    for (const selector of SUBVIEW_TRANSITION_SELECTORS.visibleRowSelectors) {
      const rows = this.page.locator(selector);
      const count = Math.min(await rows.count(), 12);

      for (let index = 0; index < count; index += 1) {
        if (await rows.nth(index).isVisible().catch(() => false)) {
          return true;
        }
      }
    }

    return false;
  }
}

function classifySubviewSurfaceType(
  input: {
    title: string | null;
    sectionHeaders: string[];
    tabs: string[];
    tables: Array<{ label: string | null; columnHeaders: string[] }>;
    cards: string[];
    layoutPatterns: string[];
  },
  hasVisibleRows: boolean,
): DocumentTrackingDestinationSurface["pageType"] {
  const combinedText = [
    input.title,
    ...input.sectionHeaders,
    ...input.tabs,
    ...input.cards,
    ...input.tables.flatMap((table) => [table.label, ...table.columnHeaders]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (/statistics/i.test(combinedText) && !hasVisibleRows) {
    return "statistics_view";
  }

  if (/worklist/i.test(combinedText)) {
    return "worklist";
  }

  if (hasVisibleRows || input.tables.length > 0) {
    return "queue";
  }

  if (input.layoutPatterns.includes("forms") || /hub|document/i.test(combinedText)) {
    return "form_hub";
  }

  return "unknown";
}
