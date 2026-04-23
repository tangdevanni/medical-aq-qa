import {
  type OpenBehavior,
  type SafeNavigationCandidate,
} from "@medical-ai-qa/shared-types";
import { DEFAULT_SERVICE_SETTINGS } from "@medical-ai-qa/shared-config";
import { type Locator, type Page } from "@playwright/test";
import { OrdersQaManagementPage } from "./OrdersQaManagementPage";
import { PatientSearchBar } from "./PatientSearchBar";
import {
  DASHBOARD_ENTRY_PRIORITIES,
  DASHBOARD_SELECTORS,
  FINALE_TOP_NAV_ITEMS,
} from "../selectors/dashboard.selectors";
import { DISCOVERY_SELECTORS } from "../selectors/discovery.selectors";
import { classifyControl, sanitizeStructuralLabel } from "../discovery/control-classification";
import { type OpenBehaviorResult } from "../../types/internal";
import {
  clickAndWaitForSettledState,
  collectVisibleTexts,
  getScrollMetrics,
  hasVisibleLocator,
  normalizeText,
  scrollPageTo,
  uniqueTexts,
  waitForFirstVisibleLocator,
} from "../utils/page-helpers";

interface RankedNavigationCandidate {
  label: string | null;
  classification: SafeNavigationCandidate["classification"];
  reason: string | null;
  priority: number;
  target: Locator | null;
}

export class DashboardPage {
  private readonly patientSearchBar: PatientSearchBar;
  private readonly ordersQaManagementPage: OrdersQaManagementPage;

  constructor(private readonly page: Page) {
    this.patientSearchBar = new PatientSearchBar(page);
    this.ordersQaManagementPage = new OrdersQaManagementPage(page);
  }

  async isLoaded(): Promise<boolean> {
    const [navItems, hasPatientSearch, hasOrdersQaManagementTile, hasDashboardMarkers] =
      await Promise.all([
        this.getVisibleTopNavItems(),
        this.hasGlobalPatientSearch(),
        this.hasOrdersQaManagementTile(),
        hasVisibleLocator(
          this.page,
          DASHBOARD_SELECTORS.loadedMarkers,
          DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
        ),
      ]);

    return navItems.length >= 3 && (hasPatientSearch || hasOrdersQaManagementTile || hasDashboardMarkers);
  }

  async getVisibleTopNavItems(): Promise<string[]> {
    const detectedNavItems: string[] = [];

    for (const item of FINALE_TOP_NAV_ITEMS) {
      const link = this.page.getByRole("link", { name: new RegExp(`^${escapeRegExp(item)}$`, "i") }).first();
      if (await link.isVisible().catch(() => false)) {
        detectedNavItems.push(item);
        continue;
      }

      const button = this.page.getByRole("button", {
        name: new RegExp(`^${escapeRegExp(item)}$`, "i"),
      }).first();
      if (await button.isVisible().catch(() => false)) {
        detectedNavItems.push(item);
      }
    }

    if (detectedNavItems.length > 0) {
      return detectedNavItems;
    }

    const navContainer = await waitForFirstVisibleLocator(
      this.page,
      DASHBOARD_SELECTORS.navContainers,
      DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
    );

    if (!navContainer) {
      return [];
    }

    const rawNavTexts = await collectVisibleTexts(
      navContainer.locator('a, button, [role="link"], [role="button"]'),
      30,
    );

    return uniqueTexts(rawNavTexts.filter((text) => text.length <= 32));
  }

  async hasGlobalPatientSearch(): Promise<boolean> {
    return this.patientSearchBar.isVisible();
  }

  async hasOrdersQaManagementTile(): Promise<boolean> {
    return this.ordersQaManagementPage.isEntryVisible();
  }

  async openOrdersQaManagement(): Promise<void> {
    await this.ordersQaManagementPage.open();
  }

  async findSafeNavigationCandidate(): Promise<{
    candidate: SafeNavigationCandidate;
    target: Locator | null;
  }> {
    let bestCandidate: RankedNavigationCandidate | null = null;
    const scrollPositions = await this.buildScrollPositions();

    for (const scrollTop of scrollPositions) {
      await scrollPageTo(this.page, scrollTop);
      const rankedCandidates = await this.collectRankedCandidates();

      for (const candidate of rankedCandidates) {
        if (!bestCandidate || compareCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }

    if (scrollPositions.length > 1) {
      await scrollPageTo(this.page, 0);
    }

    if (!bestCandidate) {
      return {
        candidate: {
          label: null,
          classification: "UNKNOWN",
          reason: "No likely dashboard-level navigation target was found.",
        },
        target: null,
      };
    }

    return {
      candidate: {
        label: bestCandidate.label,
        classification: bestCandidate.classification,
        reason: bestCandidate.reason,
      },
      target: bestCandidate.classification === "SAFE_NAV" ? bestCandidate.target : null,
    };
  }

  async openNavigationTarget(target: Locator): Promise<OpenBehaviorResult> {
    const startingUrl = this.page.url();
    const newPagePromise = this.page
      .context()
      .waitForEvent("page", { timeout: 4_000 })
      .catch(() => null);

    await clickAndWaitForSettledState(this.page, target);
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
    const modalDetected = await hasVisibleLocator(this.page, DISCOVERY_SELECTORS.modalSelectors, 2_000);
    const splitViewDetected = await hasVisibleLocator(
      this.page,
      DISCOVERY_SELECTORS.layoutPatterns.splitPanes,
      2_000,
    );
    const destinationMarkersDetected = await hasVisibleLocator(
      this.page,
      DASHBOARD_SELECTORS.safeDestinationMarkers,
      2_000,
    );
    const ambiguousSignals = buildAmbiguousSignals({
      routeChanged,
      modalDetected,
      splitViewDetected,
      destinationMarkersDetected,
    });

    return {
      openBehavior: classifyOpenBehavior({
        routeChanged,
        modalDetected,
        splitViewDetected,
        destinationMarkersDetected,
      }),
      routeChanged,
      modalDetected,
      newTabDetected: false,
      splitViewDetected,
      targetPage: this.page,
      ambiguousSignals,
    };
  }

  private async collectRankedCandidates(): Promise<RankedNavigationCandidate[]> {
    const candidates: RankedNavigationCandidate[] = [];
    const seen = new Set<string>();

    for (const selector of DASHBOARD_SELECTORS.navigationCandidateSelectors) {
      const elements = this.page.locator(selector);
      const count = Math.min(await elements.count(), 40);

      for (let index = 0; index < count; index += 1) {
        const element = elements.nth(index);
        if (!(await element.isVisible().catch(() => false))) {
          continue;
        }

        const rankedCandidate = await this.buildRankedCandidate(element);
        if (!rankedCandidate || !rankedCandidate.label) {
          continue;
        }

        const key = `${rankedCandidate.label}:${rankedCandidate.classification}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push(rankedCandidate);
      }
    }

    return candidates;
  }

  private async buildRankedCandidate(element: Locator): Promise<RankedNavigationCandidate | null> {
    const target = await this.resolveNavigationTarget(element);
    if (!target) {
      return null;
    }

    const label =
      sanitizeStructuralLabel(await target.innerText().catch(() => null)) ??
      sanitizeStructuralLabel(await target.getAttribute("aria-label").catch(() => null)) ??
      sanitizeStructuralLabel(await target.getAttribute("title").catch(() => null)) ??
      sanitizeStructuralLabel(await element.innerText().catch(() => null));

    if (!label) {
      return null;
    }

    const href = await target.getAttribute("href").catch(() => null);
    const role = await target.getAttribute("role").catch(() => null);
    const inNavigation = await target.locator("xpath=ancestor::nav[1]").count().then((count) => count > 0).catch(() => false);
    const withinForm = await target.locator("xpath=ancestor::form[1]").count().then((count) => count > 0).catch(() => false);
    const kind = role === "tab"
      ? "tab"
      : href !== null
        ? "link"
        : element === target
          ? "button"
          : "tile";
    const classification = classifyControl({
      label,
      kind,
      href,
      withinForm,
      inNavigation,
    });
    const priority = rankCandidateLabel(label);

    if (priority <= 0 && classification.classification !== "SAFE_NAV") {
      return null;
    }

    return {
      label,
      classification: classification.classification,
      reason: classification.reason,
      priority: priority > 0 ? priority : 20,
      target,
    };
  }

  private async resolveNavigationTarget(element: Locator): Promise<Locator | null> {
    const role = await element.getAttribute("role").catch(() => null);
    const tagName = await element.evaluate((node) => node.tagName.toLowerCase()).catch(() => null);

    if (tagName === "a" || tagName === "button" || role === "link" || role === "button" || role === "tab") {
      return element;
    }

    const interactiveChild = element
      .locator('a, button, [role="link"], [role="button"], [role="tab"]')
      .first();

    if (await interactiveChild.isVisible().catch(() => false)) {
      return interactiveChild;
    }

    return (await element.isVisible().catch(() => false)) ? element : null;
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
}

function rankCandidateLabel(label: string): number {
  for (const entry of DASHBOARD_ENTRY_PRIORITIES) {
    if (entry.patterns.some((pattern) => pattern.test(label))) {
      return entry.priority;
    }
  }

  return 0;
}

function compareCandidates(
  left: RankedNavigationCandidate,
  right: RankedNavigationCandidate,
): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  const leftRank = classificationRank(left.classification);
  const rightRank = classificationRank(right.classification);

  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }

  return (left.label ?? "").localeCompare(right.label ?? "");
}

function classificationRank(classification: SafeNavigationCandidate["classification"]): number {
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

function classifyOpenBehavior(input: {
  routeChanged: boolean;
  modalDetected: boolean;
  splitViewDetected: boolean;
  destinationMarkersDetected: boolean;
}): OpenBehavior {
  if (input.modalDetected && !input.splitViewDetected) {
    return "modal";
  }

  if (input.splitViewDetected && !input.modalDetected) {
    return "split_view";
  }

  if (input.routeChanged || input.destinationMarkersDetected) {
    return "same_page";
  }

  return "unknown";
}

function buildAmbiguousSignals(input: {
  routeChanged: boolean;
  modalDetected: boolean;
  splitViewDetected: boolean;
  destinationMarkersDetected: boolean;
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

  if (input.destinationMarkersDetected) {
    signals.push("destination_markers");
  }

  return signals;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
