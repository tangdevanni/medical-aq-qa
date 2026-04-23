import { type DestinationSurfaceObservation } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { PortalDiscoveryPage } from "./PortalDiscoveryPage";

export class DestinationSurfacePage {
  private readonly discoveryPage: PortalDiscoveryPage;

  constructor(private readonly page: Page) {
    this.discoveryPage = new PortalDiscoveryPage(page);
  }

  async mapSurface(detected: boolean): Promise<DestinationSurfaceObservation> {
    if (!detected) {
      return {
        detected: false,
        pageType: null,
        url: null,
        title: null,
        tabs: [],
        sectionHeaders: [],
        tables: [],
        buttons: [],
        searchBars: [],
        cards: [],
        layoutPatterns: [],
      };
    }

    const observation = await this.discoveryPage.discoverDestinationPage({
      opened: true,
      openBehavior: "same_page",
    });

    return {
      detected: true,
      pageType: classifyDestinationSurfaceType(observation),
      url: observation.url,
      title: observation.title,
      tabs: observation.tabs,
      sectionHeaders: observation.sectionHeaders,
      tables: observation.tables,
      buttons: observation.buttons,
      searchBars: observation.searchBars,
      cards: observation.cards,
      layoutPatterns: observation.layoutPatterns,
    };
  }
}

function classifyDestinationSurfaceType(input: {
  title: string | null;
  tabs: string[];
  sectionHeaders: string[];
  tables: Array<{ label: string | null; columnHeaders: string[] }>;
  cards: string[];
  searchBars: string[];
  layoutPatterns: string[];
}): string | null {
  const combinedText = [
    input.title,
    ...input.tabs,
    ...input.sectionHeaders,
    ...input.cards,
    ...input.searchBars,
    ...input.tables.flatMap((table) => [table.label, ...table.columnHeaders]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (/board|not started|in progress|review/i.test(combinedText)) {
    return "review_board";
  }

  if (/queue|orders|management/i.test(combinedText) && input.tables.length > 0) {
    return "work_queue";
  }

  if (/patient/i.test(combinedText) && input.tables.length > 0) {
    return "patient_list";
  }

  if (input.layoutPatterns.includes("forms") || /form|intake|search/i.test(combinedText)) {
    return "form_hub";
  }

  return "unknown";
}
