import { type DocumentTrackingHub } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { DOCUMENT_TRACKING_SELECTORS } from "../selectors/document-tracking.selectors";
import { HUB_CARD_SELECTORS } from "../selectors/hub-card.selectors";
import { type ResolvedHubCard, HubCardPage } from "./HubCardPage";
import { normalizeText, waitForPageSettled } from "../utils/page-helpers";

const PREFERRED_SUBVIEW_ORDER = [
  "QA Monitoring",
  "Physician's Order",
  "Plan of Care",
  "OASIS",
] as const;

export class DocumentTrackingHubPage {
  constructor(private readonly page: Page) {}

  async isLoaded(): Promise<boolean> {
    await waitForPageSettled(this.page);

    const url = this.page.url();
    if (
      DOCUMENT_TRACKING_SELECTORS.hubUrlPattern.test(url) &&
      DOCUMENT_TRACKING_SELECTORS.hubQueryPattern.test(url)
    ) {
      return true;
    }

    for (const marker of DOCUMENT_TRACKING_SELECTORS.hubMarkers) {
      const locator = this.page.locator(marker).first();
      if (await locator.isVisible().catch(() => false)) {
        return true;
      }
    }

    return false;
  }

  async discoverResolvedCards(): Promise<ResolvedHubCard[]> {
    const resolvedCards: ResolvedHubCard[] = [];
    const seenLabels = new Set<string>();

    for (const selector of HUB_CARD_SELECTORS.cardCandidateSelectors) {
      const candidates = this.page.locator(selector);
      const count = Math.min(await candidates.count(), 24);

      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        const summary = await new HubCardPage(candidate).summarize();
        if (!summary?.summary.label) {
          continue;
        }

        const labelKey = normalizeText(summary.summary.label);
        if (!labelKey || seenLabels.has(labelKey)) {
          continue;
        }

        if (!looksLikeDocumentTrackingCard(labelKey, summary.summary.clickable)) {
          continue;
        }

        seenLabels.add(labelKey);
        resolvedCards.push(summary);
      }
    }

    return resolvedCards;
  }

  async discoverHub(): Promise<DocumentTrackingHub> {
    const cards = await this.discoverResolvedCards();

    return {
      url: this.page.url(),
      title: normalizeText(await this.page.title().catch(() => null)),
      cards: cards.map((card) => card.summary),
    };
  }

  selectPreferredSafeCard(cards: ResolvedHubCard[]): ResolvedHubCard | null {
    for (const label of PREFERRED_SUBVIEW_ORDER) {
      const match = cards.find(
        (card) =>
          card.summary.classification === "SAFE_NAV" &&
          matchesPreferredLabel(card.summary.label, label),
      );

      if (match) {
        return match;
      }
    }

    return null;
  }
}

function looksLikeDocumentTrackingCard(label: string, clickable: boolean): boolean {
  if (/document statistics|physician'?s order|plan of care|\boasis\b|qa monitoring|need to send|need to receive/i.test(label)) {
    return true;
  }

  return clickable && label.split(" ").length <= 5;
}

function matchesPreferredLabel(
  value: string | null,
  preferredLabel: string,
): boolean {
  const normalizedValue = normalizeText(value)?.toLowerCase();
  const normalizedPreferred = preferredLabel.toLowerCase();

  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue === normalizedPreferred) {
    return true;
  }

  if (normalizedPreferred === "physician's order") {
    return /physician'?s order/.test(normalizedValue);
  }

  return normalizedValue.includes(normalizedPreferred);
}
