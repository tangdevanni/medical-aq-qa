import {
  qaBoardCardSummarySchema,
  type QaBoardCardSummary,
  type OpenBehavior,
} from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { QA_BOARD_SELECTORS } from "../selectors/qa-board.selectors";
import { QA_CARD_SELECTORS } from "../selectors/qa-card.selectors";
import { QA_ITEM_DETAIL_SELECTORS } from "../selectors/qa-item-detail.selectors";
import { type OpenBehaviorResult } from "../../types/internal";
import {
  clickAndWaitForSettledState,
  hasVisibleLocator,
  normalizeText,
  uniqueTexts,
  waitForFirstVisibleLocator,
} from "../utils/page-helpers";

const SERVICE_DATE_PATTERNS = [
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i,
];

const MR_PATTERNS = [
  /\bMR(?:\s+Number|#)?\s*[:#-]?\s*([A-Za-z0-9-]+)\b/i,
  /\bMedical Record(?:\s+Number)?\s*[:#-]?\s*([A-Za-z0-9-]+)\b/i,
];

const WORK_ITEM_LINE_PATTERN =
  /\b(Visit Note|Discharge Summary|Phys\.?\s*Order Others|Physician Order Others|OASIS)\b/i;

export class QaBoardPage {
  constructor(private readonly page: Page) {}

  async isLoaded(): Promise<boolean> {
    const [hasMarkers, cardCount] = await Promise.all([
      hasVisibleLocator(this.page, QA_BOARD_SELECTORS.pageMarkers, 5_000),
      this.getVisibleCardCount(),
    ]);

    return hasMarkers || cardCount > 0;
  }

  async getVisibleCardCount(): Promise<number> {
    return (await this.getVisibleCardSummaries()).length;
  }

  async getVisibleStatuses(): Promise<string[]> {
    const summaries = await this.getVisibleCardSummaries();
    return uniqueTexts(summaries.map((summary) => summary.statusText));
  }

  async getVisibleWorkItemTypes(): Promise<string[]> {
    const summaries = await this.getVisibleCardSummaries();
    return uniqueTexts(summaries.map((summary) => summary.workItemTypeText));
  }

  async getVisibleCardSummaries(): Promise<QaBoardCardSummary[]> {
    const cards = await this.resolveVisibleCardLocators();
    const summaries: QaBoardCardSummary[] = [];

    for (let index = 0; index < cards.length; index += 1) {
      const cardText = normalizeText(await cards[index].innerText().catch(() => null));
      if (!cardText) {
        continue;
      }

      summaries.push(
        qaBoardCardSummarySchema.parse({
          cardIndex: index,
          serviceDateText: extractServiceDateText(cardText),
          patientDisplayText: extractPatientDisplayText(cardText),
          mrText: extractMrText(cardText),
          workItemTypeText: extractWorkItemTypeText(cardText),
          statusText: extractStatusText(cardText),
        }),
      );
    }

    return summaries;
  }

  async getFirstOpenableCardIndex(): Promise<number | null> {
    const cards = await this.resolveVisibleCardLocators();

    for (let index = 0; index < cards.length; index += 1) {
      const target = await this.resolveCardOpenTarget(cards[index]);
      if (target) {
        return index;
      }
    }

    return null;
  }

  async openVisibleCardByIndex(index: number): Promise<OpenBehaviorResult> {
    const cards = await this.resolveVisibleCardLocators();
    const card = cards[index];

    if (!card) {
      throw new Error(`Visible QA card at index ${index} was not found.`);
    }

    const clickTarget = await this.resolveCardOpenTarget(card);
    if (!clickTarget) {
      throw new Error(`Visible QA card at index ${index} is not openable.`);
    }

    const startingUrl = this.page.url();
    const newPagePromise = this.page
      .context()
      .waitForEvent("page", { timeout: 4_000 })
      .catch(() => null);

    await clickAndWaitForSettledState(this.page, clickTarget);
    const openedPage = await newPagePromise;

    if (openedPage) {
      await openedPage.waitForLoadState("domcontentloaded", { timeout: 7_500 }).catch(() => undefined);

      return {
        openBehavior: "new_tab",
        routeChanged: true,
        modalDetected: false,
        newTabDetected: true,
        splitViewDetected: false,
        targetPage: openedPage,
        ambiguousSignals: ["new_tab"],
      };
    }

    const routeChanged = this.page.url() !== startingUrl;
    const modalDetected = await hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.modalRootSelectors, 2_000);
    const splitViewDetected = await hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.splitViewSelectors, 2_000);
    const detailMarkersDetected = await hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.detailMarkers, 2_000);
    const ambiguousSignals = buildAmbiguousSignals({
      routeChanged,
      modalDetected,
      splitViewDetected,
      detailMarkersDetected,
    });

    return {
      openBehavior: classifyOpenBehavior({
        routeChanged,
        modalDetected,
        splitViewDetected,
        detailMarkersDetected,
      }),
      routeChanged,
      modalDetected,
      newTabDetected: false,
      splitViewDetected,
      targetPage: this.page,
      ambiguousSignals,
    };
  }

  private async resolveVisibleCardLocators(): Promise<Locator[]> {
    const scope =
      (await waitForFirstVisibleLocator(this.page, QA_BOARD_SELECTORS.rootSelectors, 2_500)) ??
      this.page.locator("body");
    const cards: Locator[] = [];
    const seenKeys = new Set<string>();

    for (const selector of QA_BOARD_SELECTORS.cardSelectors) {
      const candidates = scope.locator(selector);
      const count = Math.min(await candidates.count(), 75);

      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (!(await candidate.isVisible().catch(() => false))) {
          continue;
        }

        const cardText = normalizeText(await candidate.innerText().catch(() => null));
        if (!cardText || !looksLikeQaCard(cardText)) {
          continue;
        }

        const key = cardText.slice(0, 240);
        if (seenKeys.has(key)) {
          continue;
        }

        seenKeys.add(key);
        cards.push(candidate);
      }
    }

    return cards;
  }

  private async resolveCardOpenTarget(card: Locator): Promise<Locator | null> {
    for (const selector of QA_CARD_SELECTORS.openTargetSelectors) {
      const target = card.locator(selector).first();
      if (await target.isVisible().catch(() => false)) {
        return target;
      }
    }

    return (await card.isVisible().catch(() => false)) ? card : null;
  }
}

function classifyOpenBehavior(input: {
  routeChanged: boolean;
  modalDetected: boolean;
  splitViewDetected: boolean;
  detailMarkersDetected: boolean;
}): OpenBehavior {
  if (input.modalDetected && !input.splitViewDetected) {
    return "modal";
  }

  if (input.splitViewDetected && !input.modalDetected) {
    return "split_view";
  }

  if (input.routeChanged || input.detailMarkersDetected) {
    return "same_page";
  }

  return "unknown";
}

function buildAmbiguousSignals(input: {
  routeChanged: boolean;
  modalDetected: boolean;
  splitViewDetected: boolean;
  detailMarkersDetected: boolean;
}): string[] {
  const signals: string[] = [];

  if (input.routeChanged) {
    signals.push("route_changed");
  }

  if (input.modalDetected) {
    signals.push("modal");
  }

  if (input.splitViewDetected) {
    signals.push("split_view");
  }

  if (input.detailMarkersDetected) {
    signals.push("detail_markers");
  }

  return signals;
}

function looksLikeQaCard(text: string): boolean {
  return Boolean(
    extractStatusText(text) ||
      extractWorkItemTypeText(text) ||
      extractMrText(text) ||
      extractServiceDateText(text),
  );
}

function extractServiceDateText(text: string): string | null {
  for (const pattern of SERVICE_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return normalizeText(match[0]);
    }
  }

  return null;
}

function extractMrText(text: string): string | null {
  for (const pattern of MR_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return normalizeText(match[1] ?? match[0]);
    }
  }

  return null;
}

function extractStatusText(text: string): string | null {
  const matchedStatus = QA_BOARD_SELECTORS.statusTexts.find((status) =>
    text.toLowerCase().includes(status.toLowerCase()),
  );

  return matchedStatus ? normalizeText(matchedStatus) : null;
}

function extractWorkItemTypeText(text: string): string | null {
  const matchedKnownType = QA_BOARD_SELECTORS.workItemTypeTexts.find((type) =>
    text.toLowerCase().includes(type.toLowerCase()),
  );

  if (matchedKnownType) {
    return normalizeText(matchedKnownType);
  }

  const match = text.match(WORK_ITEM_LINE_PATTERN);
  return normalizeText(match?.[0]);
}

function extractPatientDisplayText(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter((line): line is string => Boolean(line));

  for (const line of lines) {
    if (line.toLowerCase().startsWith("patient:")) {
      return normalizeText(line.slice("patient:".length));
    }
  }

  return (
    lines.find((line) => {
      if (extractServiceDateText(line) || extractMrText(line) || extractStatusText(line)) {
        return false;
      }

      if (extractWorkItemTypeText(line)) {
        return false;
      }

      if (line.length < 4 || line.length > 80) {
        return false;
      }

      return /^[A-Za-z][A-Za-z ,.'-]+$/.test(line);
    }) ?? null
  );
}
