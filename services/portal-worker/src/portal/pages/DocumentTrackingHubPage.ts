import {
  type DocumentTrackingHub,
  type DocumentTrackingTrustedLink,
  type DocumentTrackingSubviewHub,
} from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { DOCUMENT_TRACKING_SELECTORS } from "../selectors/document-tracking.selectors";
import { type ResolvedHubCard, HubCardPage } from "./HubCardPage";
import { normalizeText, waitForPageSettled } from "../utils/page-helpers";

const PREFERRED_SUBVIEW_ORDER = [
  "QA Monitoring",
  "Physician's Order",
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
    const links = this.page.locator(DOCUMENT_TRACKING_SELECTORS.sidebarNavLinkSelectors.join(", "));
    const count = Math.min(await links.count(), 32);

    for (let index = 0; index < count; index += 1) {
      const candidate = links.nth(index);
      const summary = await new HubCardPage(candidate).summarize();
      if (!summary?.summary.label) {
        continue;
      }

      const labelKey = normalizeText(summary.summary.label);
      if (!labelKey || seenLabels.has(labelKey)) {
        continue;
      }

      if (!looksLikeDocumentTrackingNavLabel(labelKey)) {
        continue;
      }

      seenLabels.add(labelKey);
      resolvedCards.push(summary);
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

  async discoverTrustedSidebarLinks(): Promise<Array<{
    summary: DocumentTrackingTrustedLink;
    locator: Locator;
  }>> {
    const links = this.page.locator(DOCUMENT_TRACKING_SELECTORS.trustedSidebarAnchorSelectors.join(", "));
    const count = Math.min(await links.count(), 32);
    const trustedLinks: Array<{
      summary: DocumentTrackingTrustedLink;
      locator: Locator;
    }> = [];
    const seenLabels = new Set<string>();

    for (let index = 0; index < count; index += 1) {
      const locator = links.nth(index);
      if (!(await locator.isVisible().catch(() => false))) {
        continue;
      }

      const label = await this.readSidebarAnchorLabel(locator);
      if (!label) {
        continue;
      }

      const normalizedLabel = normalizeText(label);
      if (!normalizedLabel || seenLabels.has(normalizedLabel.toLowerCase())) {
        continue;
      }

      if (!isTrustedSidebarLabel(normalizedLabel)) {
        continue;
      }

      seenLabels.add(normalizedLabel.toLowerCase());
      trustedLinks.push({
        summary: {
          label: normalizedLabel,
          classification: "SAFE_NAV",
          selectorKind: "sidebar_anchor",
        },
        locator,
      });
    }

    return trustedLinks;
  }

  async discoverTrustedSidebarHub(): Promise<DocumentTrackingSubviewHub> {
    const trustedLinks = await this.discoverTrustedSidebarLinks();

    return {
      url: this.page.url(),
      title: normalizeText(await this.page.title().catch(() => null)),
      trustedLinks: trustedLinks.map((link) => link.summary),
    };
  }

  selectPreferredTrustedSidebarLink(
    links: Array<{
      summary: DocumentTrackingTrustedLink;
      locator: Locator;
    }>,
  ): { summary: DocumentTrackingTrustedLink; locator: Locator } | null {
    const preferredLabels = new Set<string>(DOCUMENT_TRACKING_SELECTORS.preferredSidebarLabels);

    for (const label of [
      ...DOCUMENT_TRACKING_SELECTORS.preferredSidebarLabels,
      ...DOCUMENT_TRACKING_SELECTORS.safeSidebarLabels.filter(
        (candidate) => !preferredLabels.has(candidate),
      ),
    ]) {
      const match = links.find((link) => matchesPreferredLabel(link.summary.label, label));
      if (match) {
        return match;
      }
    }

    return null;
  }

  private async readSidebarAnchorLabel(locator: Locator): Promise<string | null> {
    for (const selector of DOCUMENT_TRACKING_SELECTORS.sidebarLabelSelectors) {
      const labelNode = locator.locator(selector).first();
      if (!(await labelNode.isVisible().catch(() => false))) {
        continue;
      }

      const value = normalizeText(await labelNode.innerText().catch(() => null));
      if (value) {
        return value;
      }
    }

    return normalizeText(await locator.innerText().catch(() => null));
  }
}

function looksLikeDocumentTrackingNavLabel(label: string): boolean {
  return /document statistics|physician'?s order|plan of care|\boasis\b|qa monitoring|need to send|need to receive/i.test(
    label,
  );
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

function isTrustedSidebarLabel(label: string): boolean {
  return [
    ...DOCUMENT_TRACKING_SELECTORS.safeSidebarLabels,
    ...DOCUMENT_TRACKING_SELECTORS.optionalSidebarLabels,
  ].some((candidate) => matchesPreferredLabel(label, candidate));
}
