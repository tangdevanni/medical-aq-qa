import {
  destinationPageObservationSchema,
  landingPageObservationSchema,
  type DestinationPageObservation,
  type OpenBehavior,
  type PortalButtonSummary,
  type PortalFormSummary,
  type PortalSectionGroup,
  type PortalTableSummary,
} from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { DISCOVERY_SELECTORS } from "../selectors/discovery.selectors";
import {
  buildButtonSummary,
  classifyControl,
  sanitizeStructuralLabel,
} from "../discovery/control-classification";
import {
  collectVisibleTexts,
  collectVisibleTextsFromSelectors,
  countVisibleElements,
  getScrollMetrics,
  hasVisibleLocator,
  normalizeText,
  scrollPageTo,
  uniqueTexts,
  waitForFirstVisibleLocator,
  waitForPageSettled,
} from "../utils/page-helpers";

type DiscoveryScope = Page | Locator;

interface ScanAccumulator {
  navItems: Set<string>;
  sideNavItems: Set<string>;
  searchBars: Set<string>;
  widgets: Set<string>;
  tiles: Set<string>;
  cards: Set<string>;
  sectionHeaders: Set<string>;
  tabs: Set<string>;
  layoutPatterns: Set<string>;
  buttonMap: Map<string, PortalButtonSummary>;
  tableMap: Map<string, PortalTableSummary>;
  formMap: Map<string, PortalFormSummary>;
  sectionGroupMap: Map<string, SectionGroupAccumulator>;
  modalsPresent: boolean;
}

interface SectionGroupAccumulator {
  sectionLabel: string | null;
  tiles: Set<string>;
  buttons: Map<string, PortalButtonSummary>;
  tables: Map<string, PortalTableSummary>;
  searchBars: Set<string>;
}

interface StructuralScanResult {
  url: string;
  title: string | null;
  navItems: string[];
  sideNavItems: string[];
  searchBars: string[];
  widgets: string[];
  tiles: string[];
  cards: string[];
  sectionHeaders: string[];
  tabs: string[];
  tables: PortalTableSummary[];
  forms: PortalFormSummary[];
  buttons: PortalButtonSummary[];
  modalsPresent: boolean;
  layoutPatterns: string[];
  sectionGroups: PortalSectionGroup[];
}

export class PortalDiscoveryPage {
  constructor(private readonly page: Page) {}

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  async getTitle(): Promise<string | null> {
    return this.page.title().then(normalizeText).catch(() => null);
  }

  async discover(): Promise<ReturnType<typeof landingPageObservationSchema.parse>> {
    const scan = await this.scanPage();

    return landingPageObservationSchema.parse({
      type: "portal_discovery",
      url: scan.url,
      title: scan.title,
      navItems: scan.navItems,
      sideNavItems: scan.sideNavItems,
      searchBars: scan.searchBars,
      widgets: scan.widgets,
      tiles: scan.tiles,
      sectionHeaders: scan.sectionHeaders,
      tables: scan.tables,
      forms: scan.forms,
      buttons: scan.buttons,
      modalsPresent: scan.modalsPresent,
      layoutPatterns: scan.layoutPatterns,
      sectionGroups: scan.sectionGroups,
      tabs: scan.tabs,
    });
  }

  async discoverDestinationPage(input: {
    opened: boolean;
    openBehavior: OpenBehavior;
  }): Promise<DestinationPageObservation> {
    if (!input.opened) {
      return destinationPageObservationSchema.parse({
        opened: false,
        openBehavior: "unknown",
        url: null,
        title: null,
        pageType: null,
        tabs: [],
        sectionHeaders: [],
        tables: [],
        buttons: [],
        searchBars: [],
        cards: [],
        layoutPatterns: [],
      });
    }

    const scan = await this.scanPage();

    return destinationPageObservationSchema.parse({
      opened: true,
      openBehavior: input.openBehavior,
      url: scan.url,
      title: scan.title,
      pageType: classifyPageType(scan),
      tabs: scan.tabs,
      sectionHeaders: scan.sectionHeaders,
      tables: scan.tables,
      buttons: scan.buttons,
      searchBars: scan.searchBars,
      cards: scan.cards.length > 0 ? scan.cards : scan.tiles,
      layoutPatterns: scan.layoutPatterns,
    });
  }

  private async scanPage(): Promise<StructuralScanResult> {
    await waitForPageSettled(this.page);

    const accumulator = createAccumulator();
    const scrollPositions = await this.buildScrollPositions();

    for (const scrollTop of scrollPositions) {
      await scrollPageTo(this.page, scrollTop);
      await this.collectSnapshot(accumulator);
    }

    if (scrollPositions.length > 1) {
      await scrollPageTo(this.page, 0);
    }

    return {
      url: await this.getCurrentUrl(),
      title: await this.getTitle(),
      navItems: [...accumulator.navItems],
      sideNavItems: [...accumulator.sideNavItems],
      searchBars: [...accumulator.searchBars],
      widgets: [...accumulator.widgets],
      tiles: [...accumulator.tiles],
      cards: [...accumulator.cards],
      sectionHeaders: [...accumulator.sectionHeaders],
      tabs: [...accumulator.tabs],
      tables: [...accumulator.tableMap.values()],
      forms: [...accumulator.formMap.values()],
      buttons: [...accumulator.buttonMap.values()],
      modalsPresent: accumulator.modalsPresent,
      layoutPatterns: [...accumulator.layoutPatterns],
      sectionGroups: [...accumulator.sectionGroupMap.values()].map((group) => ({
        sectionLabel: group.sectionLabel,
        tiles: [...group.tiles],
        buttons: [...group.buttons.values()],
        tables: [...group.tables.values()],
        searchBars: [...group.searchBars],
      })),
    };
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

  private async collectSnapshot(accumulator: ScanAccumulator): Promise<void> {
    const [
      navItems,
      sideNavItems,
      searchBars,
      widgets,
      tiles,
      cards,
      sectionHeaders,
      tabs,
      buttons,
      tables,
      forms,
      sectionGroups,
      modalsPresent,
      layoutPatterns,
    ] = await Promise.all([
      this.collectNavItems(DISCOVERY_SELECTORS.topNavContainers),
      this.collectNavItems(DISCOVERY_SELECTORS.sideNavContainers),
      this.collectSearchBarLabels(this.page, 12),
      this.collectContainerLabels(this.page, DISCOVERY_SELECTORS.widgetContainers, 14),
      this.collectContainerLabels(this.page, DISCOVERY_SELECTORS.tileContainers, 24),
      this.collectContainerLabels(this.page, DISCOVERY_SELECTORS.cardSelectors, 24),
      this.collectVisibleSectionHeaders(),
      this.collectTabs(),
      this.collectButtonSummaries(this.page, 50),
      this.collectTableSummaries(this.page, 10),
      this.collectFormSummaries(this.page, 10),
      this.collectSectionGroups(),
      this.hasModalsPresent(),
      this.getLayoutPatterns(),
    ]);

    mergeStrings(accumulator.navItems, navItems);
    mergeStrings(accumulator.sideNavItems, sideNavItems);
    mergeStrings(accumulator.searchBars, searchBars);
    mergeStrings(accumulator.widgets, widgets);
    mergeStrings(accumulator.tiles, tiles);
    mergeStrings(accumulator.cards, cards);
    mergeStrings(accumulator.sectionHeaders, sectionHeaders);
    mergeStrings(accumulator.tabs, tabs);

    for (const button of buttons) {
      accumulator.buttonMap.set(buttonKey(button), button);
    }

    for (const table of tables) {
      accumulator.tableMap.set(tableKey(table), table);
    }

    for (const form of forms) {
      accumulator.formMap.set(formKey(form), form);
    }

    for (const group of sectionGroups) {
      const groupKey = deriveSectionGroupKey(group);
      const existingGroup =
        accumulator.sectionGroupMap.get(groupKey) ??
        createSectionAccumulator(group.sectionLabel);

      mergeStrings(existingGroup.tiles, group.tiles);
      mergeStrings(existingGroup.searchBars, group.searchBars);

      for (const button of group.buttons) {
        existingGroup.buttons.set(buttonKey(button), button);
      }

      for (const table of group.tables) {
        existingGroup.tables.set(tableKey(table), table);
      }

      accumulator.sectionGroupMap.set(groupKey, existingGroup);
    }

    accumulator.modalsPresent ||= modalsPresent;
    mergeStrings(accumulator.layoutPatterns, layoutPatterns);
  }

  private async collectNavItems(containerSelectors: readonly string[]): Promise<string[]> {
    const container = await waitForFirstVisibleLocator(this.page, containerSelectors, 1_500);
    if (!container) {
      return [];
    }

    const navTexts = await collectVisibleTexts(
      container.locator(DISCOVERY_SELECTORS.navItemSelectors.join(", ")),
      24,
    );

    return navTexts
      .map((text) => sanitizeStructuralLabel(text))
      .filter((text): text is string => Boolean(text));
  }

  private async collectVisibleSectionHeaders(): Promise<string[]> {
    const headers = await collectVisibleTextsFromSelectors(
      this.page,
      DISCOVERY_SELECTORS.sectionHeaderSelectors,
      24,
    );

    return headers
      .map((header) => sanitizeStructuralLabel(header))
      .filter((header): header is string => Boolean(header));
  }

  private async collectTabs(): Promise<string[]> {
    const tabTexts = await collectVisibleTextsFromSelectors(
      this.page,
      DISCOVERY_SELECTORS.tabSelectors,
      16,
    );

    return tabTexts
      .map((text) => sanitizeStructuralLabel(text))
      .filter((text): text is string => Boolean(text));
  }

  private async collectSearchBarLabels(
    scope: DiscoveryScope,
    limit: number,
  ): Promise<string[]> {
    const labels: string[] = [];

    for (const selector of DISCOVERY_SELECTORS.searchInputSelectors) {
      const inputs = scope.locator(selector);
      const count = Math.min(await inputs.count(), limit);

      for (let index = 0; index < count; index += 1) {
        const input = inputs.nth(index);
        if (!(await input.isVisible().catch(() => false))) {
          continue;
        }

        const label =
          sanitizeStructuralLabel(await input.getAttribute("placeholder").catch(() => null)) ??
          sanitizeStructuralLabel(await input.getAttribute("aria-label").catch(() => null)) ??
          sanitizeStructuralLabel(await input.getAttribute("name").catch(() => null)) ??
          sanitizeStructuralLabel(
            await input.locator("xpath=ancestor-or-self::*[self::form or @role='search'][1]").textContent().catch(() => null),
          );

        if (label) {
          labels.push(label);
        }
      }
    }

    return uniqueTexts(labels);
  }

  private async collectButtonSummaries(
    scope: DiscoveryScope,
    limit: number,
  ): Promise<PortalButtonSummary[]> {
    const summaries: PortalButtonSummary[] = [];
    const seen = new Set<string>();

    for (const selector of DISCOVERY_SELECTORS.buttonSelectors) {
      const controls = scope.locator(selector);
      const count = Math.min(await controls.count(), limit);

      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        if (!(await control.isVisible().catch(() => false))) {
          continue;
        }

        const summary = await this.buildControlSummary(control);
        if (!summary) {
          continue;
        }

        const key = buttonKey(summary);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        summaries.push(summary);
      }
    }

    return summaries;
  }

  private async collectTableSummaries(
    scope: DiscoveryScope,
    limit: number,
  ): Promise<PortalTableSummary[]> {
    const tables = scope.locator(DISCOVERY_SELECTORS.tableSelectors.join(", "));
    const count = Math.min(await tables.count(), limit);
    const summaries: PortalTableSummary[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < count; index += 1) {
      const table = tables.nth(index);
      if (!(await table.isVisible().catch(() => false))) {
        continue;
      }

      const summary = await this.buildTableSummary(table);
      if (!summary) {
        continue;
      }

      const key = tableKey(summary);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      summaries.push(summary);
    }

    return summaries;
  }

  private async collectFormSummaries(
    scope: DiscoveryScope,
    limit: number,
  ): Promise<PortalFormSummary[]> {
    const forms = scope.locator(DISCOVERY_SELECTORS.formSelectors.join(", "));
    const count = Math.min(await forms.count(), limit);
    const summaries: PortalFormSummary[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < count; index += 1) {
      const form = forms.nth(index);
      if (!(await form.isVisible().catch(() => false))) {
        continue;
      }

      const label =
        sanitizeStructuralLabel(await form.getAttribute("aria-label").catch(() => null)) ??
        sanitizeStructuralLabel(await form.locator("legend, h1, h2, h3, h4").first().textContent().catch(() => null));

      const summary: PortalFormSummary = {
        label,
        inputCount: await countVisibleElements(form.locator("input"), 20),
        selectCount: await countVisibleElements(form.locator("select"), 20),
        textareaCount: await countVisibleElements(form.locator("textarea"), 20),
      };

      const key = formKey(summary);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      summaries.push(summary);
    }

    return summaries;
  }

  private async collectSectionGroups(): Promise<PortalSectionGroup[]> {
    const groups: PortalSectionGroup[] = [];
    const seen = new Set<string>();

    for (const selector of DISCOVERY_SELECTORS.sectionGroupContainers) {
      const containers = this.page.locator(selector);
      const count = Math.min(await containers.count(), 18);

      for (let index = 0; index < count; index += 1) {
        const container = containers.nth(index);
        if (!(await container.isVisible().catch(() => false))) {
          continue;
        }

        const sectionLabel = await this.readSectionLabel(container);
        const tiles = await this.collectContainerLabels(container, DISCOVERY_SELECTORS.tileContainers, 10);
        const buttons = await this.collectButtonSummaries(container, 14);
        const tables = await this.collectTableSummaries(container, 4);
        const searchBars = await this.collectSearchBarLabels(container, 6);

        if (!shouldIncludeSectionGroup(sectionLabel, tiles, buttons, tables, searchBars)) {
          continue;
        }

        const group: PortalSectionGroup = {
          sectionLabel,
          tiles,
          buttons,
          tables,
          searchBars,
        };
        const groupKey = deriveSectionGroupKey(group);

        if (seen.has(groupKey)) {
          continue;
        }

        seen.add(groupKey);
        groups.push(group);
      }
    }

    return groups;
  }

  private async hasModalsPresent(): Promise<boolean> {
    return hasVisibleLocator(this.page, DISCOVERY_SELECTORS.modalSelectors, 1_000);
  }

  private async getLayoutPatterns(): Promise<string[]> {
    const patterns: string[] = [];

    for (const [patternName, selectors] of Object.entries(DISCOVERY_SELECTORS.layoutPatterns)) {
      if (await hasVisibleLocator(this.page, selectors, 1_000)) {
        patterns.push(patternName);
      }
    }

    return patterns;
  }

  private async collectContainerLabels(
    scope: DiscoveryScope,
    selectors: readonly string[],
    limit: number,
  ): Promise<string[]> {
    const labels: string[] = [];

    for (const selector of selectors) {
      const containers = scope.locator(selector);
      const count = Math.min(await containers.count(), limit);

      for (let index = 0; index < count; index += 1) {
        const container = containers.nth(index);
        if (!(await container.isVisible().catch(() => false))) {
          continue;
        }

        const label = await this.readContainerLabel(container);
        if (label) {
          labels.push(label);
        }
      }
    }

    return uniqueTexts(labels);
  }

  private async buildControlSummary(control: Locator): Promise<PortalButtonSummary | null> {
    const role = await control.getAttribute("role").catch(() => null);
    const href = await control.getAttribute("href").catch(() => null);
    const kind = role === "tab"
      ? "tab"
      : href !== null
        ? "link"
        : "button";
    const label =
      sanitizeStructuralLabel(await control.innerText().catch(() => null)) ??
      sanitizeStructuralLabel(await control.getAttribute("aria-label").catch(() => null)) ??
      sanitizeStructuralLabel(await control.getAttribute("title").catch(() => null));

    if (!label) {
      return null;
    }

    return {
      label,
      classification: classifyControl({
        label,
        kind,
        href,
        withinForm: await control.locator("xpath=ancestor::form[1]").count().then((count) => count > 0).catch(() => false),
        inNavigation: await control.locator("xpath=ancestor::nav[1]").count().then((count) => count > 0).catch(() => false),
      }).classification,
    };
  }

  private async buildTableSummary(table: Locator): Promise<PortalTableSummary | null> {
    const label =
      sanitizeStructuralLabel(await table.getAttribute("aria-label").catch(() => null)) ??
      sanitizeStructuralLabel(await table.locator("caption").first().textContent().catch(() => null)) ??
      sanitizeStructuralLabel(
        await table.locator("xpath=ancestor-or-self::*[self::section or self::article][1]").locator("h1, h2, h3, h4").first().textContent().catch(() => null),
      );
    const columnHeaders = (
      await collectVisibleTexts(table.locator('th, [role="columnheader"]'), 12)
    )
      .map((text) => sanitizeStructuralLabel(text))
      .filter((text): text is string => Boolean(text));
    const tbodyRows = await countVisibleElements(table.locator("tbody tr"), 50);
    const roleRows = await countVisibleElements(table.locator('[role="row"]'), 50);

    return {
      label,
      columnHeaders,
      approxRowCount: tbodyRows > 0 ? tbodyRows : Math.max(roleRows - 1, 0),
    };
  }

  private async readSectionLabel(container: Locator): Promise<string | null> {
    const heading = container.locator(DISCOVERY_SELECTORS.containerHeadingSelectors.join(", ")).first();
    if (await heading.isVisible().catch(() => false)) {
      return sanitizeStructuralLabel(await heading.textContent().catch(() => null));
    }

    return sanitizeStructuralLabel(await container.getAttribute("aria-label").catch(() => null));
  }

  private async readContainerLabel(container: Locator): Promise<string | null> {
    const heading = await this.readSectionLabel(container);
    if (heading) {
      return heading;
    }

    const directActionLabel = await this.readInteractiveLabel(container);
    if (directActionLabel) {
      return directActionLabel;
    }

    const ariaLabel =
      sanitizeStructuralLabel(await container.getAttribute("aria-label").catch(() => null)) ??
      sanitizeStructuralLabel(await container.getAttribute("title").catch(() => null));
    if (ariaLabel) {
      return ariaLabel;
    }

    const lines = (await container.innerText().catch(() => ""))
      .split(/\r?\n/)
      .map((line) => sanitizeStructuralLabel(line))
      .filter((line): line is string => Boolean(line));

    return lines[0] ?? null;
  }

  private async readInteractiveLabel(container: Locator): Promise<string | null> {
    const action = container
      .locator('a, button, [role="button"], [role="link"], [role="tab"]')
      .first();

    if (!(await action.isVisible().catch(() => false))) {
      return null;
    }

    return (
      sanitizeStructuralLabel(await action.innerText().catch(() => null)) ??
      sanitizeStructuralLabel(await action.getAttribute("aria-label").catch(() => null)) ??
      sanitizeStructuralLabel(await action.getAttribute("title").catch(() => null))
    );
  }
}

function createAccumulator(): ScanAccumulator {
  return {
    navItems: new Set<string>(),
    sideNavItems: new Set<string>(),
    searchBars: new Set<string>(),
    widgets: new Set<string>(),
    tiles: new Set<string>(),
    cards: new Set<string>(),
    sectionHeaders: new Set<string>(),
    tabs: new Set<string>(),
    layoutPatterns: new Set<string>(),
    buttonMap: new Map<string, PortalButtonSummary>(),
    tableMap: new Map<string, PortalTableSummary>(),
    formMap: new Map<string, PortalFormSummary>(),
    sectionGroupMap: new Map<string, SectionGroupAccumulator>(),
    modalsPresent: false,
  };
}

function createSectionAccumulator(sectionLabel: string | null): SectionGroupAccumulator {
  return {
    sectionLabel,
    tiles: new Set<string>(),
    buttons: new Map<string, PortalButtonSummary>(),
    tables: new Map<string, PortalTableSummary>(),
    searchBars: new Set<string>(),
  };
}

function mergeStrings(target: Set<string>, values: readonly string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function buttonKey(button: PortalButtonSummary): string {
  return `${button.label}:${button.classification}`;
}

function tableKey(table: PortalTableSummary): string {
  return `${table.label ?? "table"}:${table.columnHeaders.join("|")}:${table.approxRowCount}`;
}

function formKey(form: PortalFormSummary): string {
  return `${form.label ?? "form"}:${form.inputCount}:${form.selectCount}:${form.textareaCount}`;
}

function deriveSectionGroupKey(group: PortalSectionGroup): string {
  return (
    group.sectionLabel ??
    group.tiles[0] ??
    group.buttons[0]?.label ??
    group.tables[0]?.label ??
    group.searchBars[0] ??
    "section"
  );
}

function shouldIncludeSectionGroup(
  sectionLabel: string | null,
  tiles: string[],
  buttons: PortalButtonSummary[],
  tables: PortalTableSummary[],
  searchBars: string[],
): boolean {
  const itemCount = tiles.length + buttons.length + tables.length + searchBars.length;

  if (itemCount === 0) {
    return false;
  }

  if (sectionLabel) {
    return true;
  }

  return itemCount >= 2;
}

function classifyPageType(scan: StructuralScanResult): string | null {
  const combinedText = [
    scan.title,
    ...scan.sectionHeaders,
    ...scan.tabs,
    ...scan.cards,
    ...scan.tiles,
    ...scan.searchBars,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (/orders and qa management|qapi|board/i.test(combinedText)) {
    return "orders_qa_management";
  }

  if (/search patient|patient search/i.test(combinedText)) {
    return "patient_search";
  }

  if (/admission|discharge/i.test(combinedText)) {
    return "admission_discharge";
  }

  if (scan.tabs.length > 0 && scan.tables.length > 0) {
    return "tabbed_workspace";
  }

  if (scan.tables.length > 0) {
    return "table_view";
  }

  if (scan.cards.length > 0 || scan.tiles.length > 0) {
    return "card_view";
  }

  return null;
}
