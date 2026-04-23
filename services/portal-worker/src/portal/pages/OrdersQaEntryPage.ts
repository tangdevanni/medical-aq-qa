import { type OrdersQaTargetCandidate } from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { ORDERS_QA_ENTRY_PATTERNS, ORDERS_QA_ENTRY_SELECTORS } from "../selectors/orders-qa-entry.selectors";
import { classifyControl, sanitizeStructuralLabel } from "../discovery/control-classification";
import { getScrollMetrics, normalizeText, scrollPageTo } from "../utils/page-helpers";

interface RankedOrdersQaCandidate {
  label: string | null;
  classification: OrdersQaTargetCandidate["classification"];
  reason: string | null;
  score: number;
  container: Locator | null;
  target: Locator | null;
  textSummary: string | null;
}

export interface OrdersQaEntryMatch {
  label: string | null;
  classification: OrdersQaTargetCandidate["classification"];
  reason: string | null;
  container: Locator | null;
  target: Locator | null;
  textSummary: string | null;
}

export interface OrdersQaShortcutTile {
  tileIndex: number;
  label: string | null;
  textSummary: string | null;
  locator: Locator;
}

export class OrdersQaEntryPage {
  constructor(private readonly page: Page) {}

  async findTargetCandidate(): Promise<{
    candidate: OrdersQaTargetCandidate;
    target: Locator | null;
  }> {
    const match = await this.findTargetMatch();
    if (match) {
      return {
        candidate: {
          label: match.label,
          classification: match.classification,
          reason: match.reason,
          found: true,
        },
        target: match.classification === "SAFE_NAV" ? match.target : null,
      };
    }

    return {
      candidate: {
        label: null,
        classification: "UNKNOWN",
        reason: "Orders and QA Management entry was not found on the dashboard.",
        found: false,
      },
      target: null,
    };
  }

  async findTargetMatch(): Promise<OrdersQaEntryMatch | null> {
    const shortcutMatch = await this.findShortcutTileMatch();
    if (shortcutMatch) {
      return shortcutMatch;
    }

    const directCandidate = await this.findDirectCandidate();
    if (directCandidate) {
      return rankedCandidateToMatch(directCandidate);
    }

    let bestCandidate: RankedOrdersQaCandidate | null = null;
    const scrollPositions = await this.buildScrollPositions();

    for (const scrollTop of scrollPositions) {
      await scrollPageTo(this.page, scrollTop);
      const candidates = await this.collectLooseCandidates();

      for (const candidate of candidates) {
        if (!bestCandidate || compareRankedCandidate(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }

    if (scrollPositions.length > 1) {
      await scrollPageTo(this.page, 0);
    }

    return bestCandidate ? rankedCandidateToMatch(bestCandidate) : null;
  }

  async discoverShortcutTiles(): Promise<OrdersQaShortcutTile[]> {
    const row = await this.findShortcutRow();
    if (!row) {
      return [];
    }

    const tiles = row.locator(ORDERS_QA_ENTRY_SELECTORS.shortcutTileSelectors.join(", "));
    const count = Math.min(await tiles.count(), 8);
    const discoveredTiles: OrdersQaShortcutTile[] = [];
    const seenLabels = new Set<string>();

    for (let index = 0; index < count; index += 1) {
      const tile = tiles.nth(index);
      if (!(await this.isClickableTile(tile))) {
        continue;
      }

      const label = await this.readTileLabel(tile);
      const textSummary = buildTextSummary(await tile.innerText().catch(() => null));
      const labelKey = normalizeText(label ?? textSummary ?? `tile-${index}`) ?? `tile-${index}`;

      if (seenLabels.has(labelKey)) {
        continue;
      }

      seenLabels.add(labelKey);
      discoveredTiles.push({
        tileIndex: discoveredTiles.length,
        label,
        textSummary,
        locator: tile,
      });
    }

    return discoveredTiles;
  }

  async findOrdersQaShortcutTile(): Promise<OrdersQaShortcutTile | null> {
    const tiles = await this.discoverShortcutTiles();
    let bestTile: OrdersQaShortcutTile | null = null;
    let bestScore = -1;

    for (const tile of tiles) {
      const score = scoreOrdersQaTile(tile.label ?? tile.textSummary);
      if (score > bestScore) {
        bestTile = tile;
        bestScore = score;
      }
    }

    return bestScore > 0 ? bestTile : null;
  }

  private async findShortcutTileMatch(): Promise<OrdersQaEntryMatch | null> {
    const tile = await this.findOrdersQaShortcutTile();
    if (!tile) {
      return null;
    }

    const label = tile.label ?? tile.textSummary;
    if (!label) {
      return null;
    }

    const classification = classifyControl({
      label,
      kind: "tile",
      href: await tile.locator.getAttribute("href").catch(() => null),
      withinForm: false,
      inNavigation: false,
    });

    return {
      label,
      classification: classification.classification,
      reason: classification.reason ?? "Matched the dashboard shortcut tile row.",
      container: tile.locator,
      target: tile.locator,
      textSummary: tile.textSummary,
    };
  }

  private async findShortcutRow(): Promise<Locator | null> {
    for (const selector of ORDERS_QA_ENTRY_SELECTORS.shortcutRowSelectors) {
      const row = this.page.locator(selector).first();
      if (await row.isVisible().catch(() => false)) {
        return row;
      }
    }

    return null;
  }

  private async findDirectCandidate(): Promise<RankedOrdersQaCandidate | null> {
    for (const selector of ORDERS_QA_ENTRY_SELECTORS.directEntrySelectors) {
      const target = this.page.locator(selector).first();
      if (!(await target.isVisible().catch(() => false))) {
        continue;
      }

      const container = await this.resolveContainerForTarget(target);
      return this.buildCandidate(container, target, 200);
    }

    return null;
  }

  private async collectLooseCandidates(): Promise<RankedOrdersQaCandidate[]> {
    const candidates: RankedOrdersQaCandidate[] = [];
    const seen = new Set<string>();

    for (const selector of ORDERS_QA_ENTRY_SELECTORS.candidateContainerSelectors) {
      const containers = this.page.locator(selector);
      const count = Math.min(await containers.count(), 36);

      for (let index = 0; index < count; index += 1) {
        const container = containers.nth(index);
        if (!(await container.isVisible().catch(() => false))) {
          continue;
        }

        const combinedText = await container.innerText().catch(() => "");
        if (!looksLikeOrdersQaText(combinedText)) {
          continue;
        }

        const target = await this.resolveClickableTarget(container);
        if (!target) {
          continue;
        }

        const candidate = await this.buildCandidate(container, target, 100);
        if (!candidate || !candidate.label) {
          continue;
        }

        const key = `${candidate.label}:${candidate.classification}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  private async buildCandidate(
    container: Locator,
    target: Locator,
    baseScore: number,
  ): Promise<RankedOrdersQaCandidate | null> {
    const label =
      sanitizeStructuralLabel(await target.innerText().catch(() => null)) ??
      sanitizeStructuralLabel(await target.getAttribute("aria-label").catch(() => null)) ??
      sanitizeStructuralLabel(await target.getAttribute("title").catch(() => null)) ??
      (await this.readNestedCandidateLabel(container));

    if (!label) {
      return null;
    }

    const href = await target.getAttribute("href").catch(() => null);
    const role = await target.getAttribute("role").catch(() => null);
    const inNavigation = await target
      .locator("xpath=ancestor::nav[1]")
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    const withinForm = await target
      .locator("xpath=ancestor::form[1]")
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    const classification = classifyControl({
      label,
      kind: href !== null || role === "link" ? "link" : "tile",
      href,
      withinForm,
      inNavigation,
    });
    const textSummary = buildTextSummary(await container.innerText().catch(() => null));

    return {
      label,
      classification: classification.classification,
      reason: classification.reason,
      score: baseScore + scoreOrdersQaLabel(label),
      container,
      target,
      textSummary,
    };
  }

  private async resolveClickableTarget(container: Locator): Promise<Locator | null> {
    if (await this.isClickableTile(container)) {
      return container;
    }

    const tagName = await container.evaluate((node) => node.tagName.toLowerCase()).catch(() => null);
    const role = await container.getAttribute("role").catch(() => null);

    if (tagName === "a" || tagName === "button" || role === "link" || role === "button") {
      return container;
    }

    for (const selector of ORDERS_QA_ENTRY_SELECTORS.interactiveSelectors) {
      const interactive = container.locator(selector).first();
      if (await interactive.isVisible().catch(() => false)) {
        return interactive;
      }
    }

    return null;
  }

  private async resolveContainerForTarget(target: Locator): Promise<Locator> {
    if (await this.isClickableTile(target)) {
      return target;
    }

    for (const selector of ORDERS_QA_ENTRY_SELECTORS.containerAncestorSelectors) {
      const candidate = target.locator(`xpath=ancestor-or-self::*[self::${selectorToXPathNodeTest(selector)}][1]`).first();
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    return target;
  }

  private async readNestedCandidateLabel(container: Locator): Promise<string | null> {
    const tileLabel = await this.readTileLabel(container);
    if (tileLabel) {
      return tileLabel;
    }

    for (const selector of ORDERS_QA_ENTRY_SELECTORS.nestedLabelSelectors) {
      const nested = container.locator(selector).first();
      if (!(await nested.isVisible().catch(() => false))) {
        continue;
      }

      const label = sanitizeStructuralLabel(await nested.textContent().catch(() => null));
      if (label && looksLikeOrdersQaText(label)) {
        return label;
      }
    }

    const lines = (await container.innerText().catch(() => ""))
      .split(/\r?\n/)
      .map((line) => sanitizeStructuralLabel(line))
      .filter((line): line is string => Boolean(line));

    return lines.find((line) => looksLikeOrdersQaText(line)) ?? null;
  }

  private async buildScrollPositions(): Promise<number[]> {
    const metrics = await getScrollMetrics(this.page);
    const maxScrollTop = Math.max(metrics.scrollHeight - metrics.viewportHeight, 0);

    if (maxScrollTop <= 0) {
      return [0];
    }

    const stepSize = Math.max(Math.floor(metrics.viewportHeight * 0.7), 360);
    const positions = new Set<number>([0]);

    for (let scrollTop = stepSize; scrollTop < maxScrollTop; scrollTop += stepSize) {
      positions.add(scrollTop);
      if (positions.size >= 8) {
        break;
      }
    }

    positions.add(maxScrollTop);

    return [...positions].sort((left, right) => left - right);
  }

  private async isClickableTile(locator: Locator): Promise<boolean> {
    const isVisible = await locator.isVisible().catch(() => false);
    if (!isVisible) {
      return false;
    }

    const hasShortcutClass = await locator
      .evaluate((node) => {
        const element = node as { className?: string | { baseVal?: string } };
        const className =
          typeof element.className === "string"
            ? element.className
            : element.className?.baseVal ?? "";

        return /shortcut-item|cursor-pointer/i.test(className);
      })
      .catch(() => false);

    if (hasShortcutClass) {
      return true;
    }

    const cursor = await locator
      .evaluate((node) => {
        const runtime = globalThis as unknown as {
          getComputedStyle: (target: unknown) => { cursor?: string };
        };

        return runtime.getComputedStyle(node).cursor ?? null;
      })
      .catch(() => null);

    return cursor === "pointer";
  }

  private async readTileLabel(tile: Locator): Promise<string | null> {
    const text = normalizeText(await tile.innerText().catch(() => null));
    if (!text) {
      return null;
    }

    const lines = text
      .split(/\s{2,}|\r?\n/)
      .map((line) => sanitizeStructuralLabel(line))
      .filter((line): line is string => Boolean(line));

    return lines[0] ?? sanitizeStructuralLabel(text) ?? text.slice(0, 80);
  }
}

function rankedCandidateToMatch(candidate: RankedOrdersQaCandidate): OrdersQaEntryMatch {
  return {
    label: candidate.label,
    classification: candidate.classification,
    reason: candidate.reason,
    container: candidate.container,
    target: candidate.target,
    textSummary: candidate.textSummary,
  };
}

function selectorToXPathNodeTest(selector: string): string {
  switch (selector) {
    case "section":
    case "article":
      return selector;
    case "[role=\"group\"]":
      return "*[@role='group']";
    case "[role=\"region\"]":
      return "*[@role='region']";
    default: {
      const normalized = selector.replace(/^\[class\*="(.+)"\]$/, "$1").toLowerCase();
      return `*[contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${normalized.toLowerCase()}')]`;
    }
  }
}

function buildTextSummary(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 160);
}

function looksLikeOrdersQaText(value: string | null | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  return (
    ORDERS_QA_ENTRY_PATTERNS.exact.some((pattern) => pattern.test(normalized)) ||
    ORDERS_QA_ENTRY_PATTERNS.loose.every((pattern) => pattern.test(normalized))
  );
}

function scoreOrdersQaTile(value: string | null | undefined): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }

  if (ORDERS_QA_ENTRY_PATTERNS.exact.some((pattern) => pattern.test(normalized))) {
    return 200;
  }

  const hasOrders = /\borders?\b/i.test(normalized);
  const hasQa = /\bqa\b/i.test(normalized);

  if (hasOrders && hasQa) {
    return 150;
  }

  if (hasOrders || hasQa) {
    return 50;
  }

  return 0;
}

function scoreOrdersQaLabel(label: string): number {
  if (ORDERS_QA_ENTRY_PATTERNS.exact.some((pattern) => pattern.test(label))) {
    return 100;
  }

  if (ORDERS_QA_ENTRY_PATTERNS.loose.every((pattern) => pattern.test(label))) {
    return 60;
  }

  return 0;
}

function compareRankedCandidate(left: RankedOrdersQaCandidate, right: RankedOrdersQaCandidate): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return classificationRank(right.classification) - classificationRank(left.classification);
}

function classificationRank(classification: OrdersQaTargetCandidate["classification"]): number {
  switch (classification) {
    case "SAFE_NAV":
      return 4;
    case "SEARCH_TRIGGER":
      return 3;
    case "UNKNOWN":
      return 2;
    case "RISKY_ACTION":
      return 1;
    default:
      return 0;
  }
}
