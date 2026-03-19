import {
  type InteractionAttemptSummary,
  type InteractionForensicsMethod,
  type InteractionForensicsResultType,
  type LandingPageObservation,
  type OrdersQaTransition,
  type OrdersQaTransitionResultType,
} from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { PortalDiscoveryPage } from "../pages/PortalDiscoveryPage";
import { PAGE_TRANSITION_SELECTORS } from "../selectors/page-transition.selectors";
import {
  clickAndWaitForSettledState,
  collectVisibleTextsFromSelectors,
  countVisibleSelectors,
  hasVisibleLocator,
  waitForPageSettled,
} from "./page-helpers";

interface TransitionFingerprint {
  url: string | null;
  title: string | null;
  headings: string[];
  tabs: string[];
  tiles: string[];
  searchBars: string[];
  layoutPatterns: string[];
  headingMarkers: string[];
  rootViewCount: number;
  dashboardMarkersVisible: boolean;
  destinationMarkersVisible: boolean;
  commandPaletteVisible: boolean;
}

interface TransitionSignals {
  routeChanged: boolean;
  modalDetected: boolean;
  newTabDetected: boolean;
  splitViewDetected: boolean;
  meaningfulStructureChanged: boolean;
}

export interface TransitionDetectionResult {
  transition: OrdersQaTransition;
  targetPage: Page;
  beforeObservation: LandingPageObservation;
  afterObservation: LandingPageObservation;
}

export interface InteractionTransitionDetectionResult {
  attempt: InteractionAttemptSummary;
  targetPage: Page;
  beforeObservation: LandingPageObservation;
  afterObservation: LandingPageObservation;
}

export async function analyzeClickTransition(
  page: Page,
  target: Locator,
): Promise<TransitionDetectionResult> {
  const result = await analyzeInteractionTransition(page, target, "click");

  return {
    transition: {
      clicked: true,
      resultType: mapForensicsResultTypeToOrdersQaTransition(result.attempt.resultType),
      urlBefore: result.beforeObservation.url ?? page.url(),
      urlAfter: result.afterObservation.url ?? result.targetPage.url(),
      routeChanged: result.attempt.routeChanged,
      modalDetected: result.attempt.modalDetected,
      newTabDetected: result.attempt.newTabDetected,
      splitViewDetected: result.attempt.splitViewDetected,
      meaningfulStructureChanged: result.attempt.meaningfulStructureChanged,
    },
    targetPage: result.targetPage,
    beforeObservation: result.beforeObservation,
    afterObservation: result.afterObservation,
  };
}

export async function analyzeInteractionTransition(
  page: Page,
  target: Locator,
  method: InteractionForensicsMethod,
): Promise<InteractionTransitionDetectionResult> {
  const discoveryPage = new PortalDiscoveryPage(page);
  const beforeObservation = await discoveryPage.discover();
  const beforeFingerprint = await captureFingerprint(page, beforeObservation);
  const beforePageCount = page.context().pages().length;
  const beforeModalDetected = await hasVisibleLocator(page, PAGE_TRANSITION_SELECTORS.modalSelectors, 500);
  const beforeSplitViewDetected = await hasVisibleLocator(page, PAGE_TRANSITION_SELECTORS.splitViewSelectors, 500);

  const newPagePromise = page.context().waitForEvent("page", { timeout: 4_000 }).catch(() => null);
  await performInteraction(page, target, method);
  const openedPage = await newPagePromise;
  const targetPage = openedPage ?? page;

  await waitForPageSettled(targetPage);

  const postDiscoveryPage = new PortalDiscoveryPage(targetPage);
  const afterObservation = await postDiscoveryPage.discover();
  const afterFingerprint = await captureFingerprint(targetPage, afterObservation);
  const afterPageCount = page.context().pages().length;
  const routeChanged = beforeFingerprint.url !== afterFingerprint.url;
  const modalDetected =
    !beforeModalDetected &&
    (await hasVisibleLocator(targetPage, PAGE_TRANSITION_SELECTORS.modalSelectors, 1_000));
  const splitViewDetected =
    !beforeSplitViewDetected &&
    (await hasVisibleLocator(targetPage, PAGE_TRANSITION_SELECTORS.splitViewSelectors, 1_000));
  const newTabDetected = openedPage !== null || afterPageCount > beforePageCount;
  const meaningfulStructureChanged = detectMeaningfulStructureChange(
    beforeFingerprint,
    afterFingerprint,
    {
      routeChanged,
      modalDetected,
      newTabDetected,
      splitViewDetected,
    },
  );
  const signals: TransitionSignals = {
    routeChanged,
    modalDetected,
    newTabDetected,
    splitViewDetected,
    meaningfulStructureChanged,
  };
  const resultType = classifyForensicsResultType(beforeFingerprint, afterFingerprint, signals);

  return {
    attempt: {
      candidateIndex: 0,
      method,
      resultType,
      routeChanged,
      modalDetected,
      newTabDetected,
      splitViewDetected,
      meaningfulStructureChanged,
      success: isMeaningfulForensicsResultType(resultType),
    },
    targetPage,
    beforeObservation,
    afterObservation,
  };
}

async function captureFingerprint(
  page: Page,
  observation: LandingPageObservation,
): Promise<TransitionFingerprint> {
  return {
    url: page.url() || null,
    title: observation.title ?? null,
    headings: observation.sectionHeaders ?? [],
    tabs: observation.tabs ?? [],
    tiles: observation.tiles ?? [],
    searchBars: observation.searchBars ?? [],
    layoutPatterns: observation.layoutPatterns ?? [],
    headingMarkers: await collectVisibleTextsFromSelectors(
      page,
      PAGE_TRANSITION_SELECTORS.headingSelectors,
      8,
    ),
    rootViewCount: await countVisibleSelectors(
      page,
      PAGE_TRANSITION_SELECTORS.rootViewSelectors,
      6,
    ),
    dashboardMarkersVisible: await hasVisibleLocator(
      page,
      PAGE_TRANSITION_SELECTORS.dashboardPersistenceSelectors,
      500,
    ),
    destinationMarkersVisible: await hasVisibleLocator(
      page,
      PAGE_TRANSITION_SELECTORS.destinationSurfaceMarkers,
      500,
    ),
    commandPaletteVisible: await hasVisibleLocator(
      page,
      PAGE_TRANSITION_SELECTORS.commandPaletteSelectors,
      500,
    ),
  };
}

async function performInteraction(
  page: Page,
  target: Locator,
  method: InteractionForensicsMethod,
): Promise<void> {
  switch (method) {
    case "click":
      await clickAndWaitForSettledState(page, target);
      return;
    case "hover_click":
      await target.hover();
      await clickAndWaitForSettledState(page, target);
      return;
    case "enter_key":
      await target.focus();
      await target.press("Enter");
      await waitForPageSettled(page);
      return;
    case "space_key":
      await target.focus();
      await target.press(" ");
      await waitForPageSettled(page);
      return;
    default:
      return;
  }
}

function detectMeaningfulStructureChange(
  beforeFingerprint: TransitionFingerprint,
  afterFingerprint: TransitionFingerprint,
  signals: {
    routeChanged: boolean;
    modalDetected: boolean;
    newTabDetected: boolean;
    splitViewDetected: boolean;
  },
): boolean {
  if (signals.routeChanged || signals.modalDetected || signals.newTabDetected || signals.splitViewDetected) {
    return true;
  }

  if (
    afterFingerprint.commandPaletteVisible &&
    beforeFingerprint.url === afterFingerprint.url &&
    buildFingerprintSignature(beforeFingerprint) === buildFingerprintSignature(afterFingerprint)
  ) {
    return false;
  }

  let changeScore = 0;

  if (beforeFingerprint.title !== afterFingerprint.title) {
    changeScore += 1;
  }

  if (!sameStringList(beforeFingerprint.headings, afterFingerprint.headings)) {
    changeScore += 1;
  }

  if (!sameStringList(beforeFingerprint.headingMarkers, afterFingerprint.headingMarkers)) {
    changeScore += 1;
  }

  if (!sameStringList(beforeFingerprint.tabs, afterFingerprint.tabs)) {
    changeScore += 1;
  }

  if (!sameStringList(beforeFingerprint.layoutPatterns, afterFingerprint.layoutPatterns)) {
    changeScore += 1;
  }

  if (!sameStringList(beforeFingerprint.tiles, afterFingerprint.tiles)) {
    changeScore += 1;
  }

  if (beforeFingerprint.rootViewCount !== afterFingerprint.rootViewCount) {
    changeScore += 1;
  }

  if (
    beforeFingerprint.destinationMarkersVisible !== afterFingerprint.destinationMarkersVisible &&
    afterFingerprint.destinationMarkersVisible
  ) {
    changeScore += 1;
  }

  return changeScore >= 2;
}

function classifyForensicsResultType(
  beforeFingerprint: TransitionFingerprint,
  afterFingerprint: TransitionFingerprint,
  signals: TransitionSignals,
): InteractionForensicsResultType {
  if (signals.newTabDetected) {
    return "new_tab";
  }

  if (signals.modalDetected) {
    return "modal";
  }

  if (signals.splitViewDetected) {
    return "split_view";
  }

  if (signals.routeChanged) {
    return "route_change";
  }

  if (signals.meaningfulStructureChanged) {
    return "new_view";
  }

  if (
    beforeFingerprint.dashboardMarkersVisible &&
    afterFingerprint.dashboardMarkersVisible &&
    buildFingerprintSignature(beforeFingerprint) === buildFingerprintSignature(afterFingerprint)
  ) {
    return "no_change";
  }

  return "unknown";
}

function mapForensicsResultTypeToOrdersQaTransition(
  value: InteractionForensicsResultType,
): OrdersQaTransitionResultType {
  switch (value) {
    case "route_change":
      return "route_change";
    case "modal":
      return "modal";
    case "new_tab":
      return "new_tab";
    case "split_view":
      return "split_view";
    case "new_view":
      return "same_page_new_view";
    case "no_change":
      return "same_page_dashboard_no_change";
    default:
      return "unknown";
  }
}

export function isMeaningfulForensicsResultType(
  value: InteractionForensicsResultType,
): boolean {
  return (
    value === "route_change" ||
    value === "modal" ||
    value === "new_tab" ||
    value === "split_view" ||
    value === "new_view"
  );
}

function buildFingerprintSignature(fingerprint: TransitionFingerprint): string {
  return JSON.stringify({
    title: fingerprint.title,
    headings: fingerprint.headings.slice(0, 8),
    headingMarkers: fingerprint.headingMarkers.slice(0, 8),
    tabs: fingerprint.tabs.slice(0, 8),
    tiles: fingerprint.tiles.slice(0, 8),
    searchBars: fingerprint.searchBars.slice(0, 4),
    layoutPatterns: fingerprint.layoutPatterns.slice(0, 8),
    rootViewCount: fingerprint.rootViewCount,
    dashboardMarkersVisible: fingerprint.dashboardMarkersVisible,
    destinationMarkersVisible: fingerprint.destinationMarkersVisible,
  });
}

function sameStringList(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
