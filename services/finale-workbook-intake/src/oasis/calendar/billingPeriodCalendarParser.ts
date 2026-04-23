import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Locator, Page } from "@playwright/test";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { chartCalendarSelectors } from "../../portal/selectors/chart-calendar.selectors";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import {
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  type PortalDebugConfig,
  waitForPortalPageSettled,
} from "../../portal/utils/locatorResolution";
import type { EpisodeRangeOption } from "../navigation/episodeRangeDropdownService";
import type {
  BillingPeriodCalendarSummary,
  BillingPeriodBucket,
  CalendarDaySnapshot,
  NormalizedCalendarCard,
} from "../types/billingPeriodCalendarSummary";
import {
  classifyBillingPeriodDate,
  computeBillingPeriodBounds,
  formatIsoDate,
  parseSupportedDate,
} from "./billingPeriodClassifier";
import { buildBillingPeriodWorkbookColumns } from "./billingPeriodWorkbookSummary";
import { normalizeCalendarCard } from "./visitCardNormalizer";

export interface RawBillingCalendarCardInput {
  rawText: string;
  titleText?: string;
  tooltipTitles: string[];
  titleAttributes: string[];
  attributeSummary: string[];
  classNames?: string[];
}

export interface RawBillingCalendarDayCellInput {
  weekLabel?: string;
  rawDateLabel: string | null;
  normalizedDate?: string;
  visualPeriodHint?: "green" | "blue" | "other" | "unknown";
  warnings: string[];
  cards: RawBillingCalendarCardInput[];
}

export type SequentialCalendarNode =
  | {
      kind: "week_marker";
      weekLabel: string;
    }
  | {
      kind: "day_cell";
      rawDateLabel: string | null;
      normalizedDate?: string;
      visualPeriodHint?: "green" | "blue" | "other" | "unknown";
      warnings: string[];
    }
  | {
      kind: "card";
      card: RawBillingCalendarCardInput;
    };

export interface BillingPeriodCalendarParserParams {
  page: Page;
  logger: Logger;
  context: PatientPortalContext;
  workflowRunId?: string;
  outputDirectory: string;
  selectedEpisode: EpisodeRangeOption | null;
  debugConfig?: PortalDebugConfig;
}

export interface BillingPeriodCalendarParserResult {
  summary: BillingPeriodCalendarSummary;
  summaryPath: string;
  stepLogs: AutomationStepLog[];
}

export function buildBillingPeriodCalendarSummary(input: {
  chartUrl: string;
  selectedEpisode: EpisodeRangeOption | null;
  rawDayCells: RawBillingCalendarDayCellInput[];
  warnings?: string[];
}): BillingPeriodCalendarSummary {
  const selectedEpisodeBoundary = input.selectedEpisode
    ? {
        rawLabel: input.selectedEpisode.rawLabel,
        startDate: input.selectedEpisode.startDate,
        endDate: input.selectedEpisode.endDate,
      }
    : null;
  const visibleDays: CalendarDaySnapshot[] = input.rawDayCells.flatMap((rawDay) => {
    const classification = classifyBillingPeriodDate({
      selectedEpisode: selectedEpisodeBoundary,
      date: rawDay.normalizedDate ?? null,
    });
    if (classification.billingPeriod === "outside") {
      return [];
    }

    const cards = rawDay.cards.map((rawCard) =>
      normalizeCalendarCard({
        rawText: rawCard.rawText,
        title: rawCard.titleText ?? null,
        date: rawDay.normalizedDate ?? null,
        billingPeriod: classification.billingPeriod,
      }));

    return [{
      date: rawDay.normalizedDate ?? null,
      rawDateLabel: rawDay.rawDateLabel,
      weekLabel: rawDay.weekLabel,
      billingPeriod: classification.billingPeriod,
      visualPeriodHint: rawDay.visualPeriodHint ?? "unknown",
      cards,
      warnings: [...rawDay.warnings],
    }];
  });

  const allCards = visibleDays.flatMap((day) => day.cards);
  const first30Cards = allCards.filter((card) => card.billingPeriod === "first30");
  const second30Cards = allCards.filter((card) => card.billingPeriod === "second30");
  const outsideCards = allCards.filter((card) => card.billingPeriod === "outside" || card.billingPeriod === "unknown");
  const periodBounds = computeBillingPeriodBounds(input.selectedEpisode
    ? {
        rawLabel: input.selectedEpisode.rawLabel,
        startDate: input.selectedEpisode.startDate,
        endDate: input.selectedEpisode.endDate,
      }
    : null);

  const warnings = [...(input.warnings ?? [])];
  const inRangeDays = visibleDays.filter((day) => day.billingPeriod === "first30" || day.billingPeriod === "second30");
  if (input.selectedEpisode?.startDate && input.selectedEpisode?.endDate) {
    const minVisible = inRangeDays
      .map((day) => parseSupportedDate(day.date))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const maxVisible = [...inRangeDays]
      .map((day) => parseSupportedDate(day.date))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())
      .at(-1);
    const startDate = parseSupportedDate(input.selectedEpisode.startDate);
    const endDate = parseSupportedDate(input.selectedEpisode.endDate);
    if (startDate && minVisible && startDate < minVisible) {
      warnings.push("Visible calendar window starts after the selected episode start date; not all episode days are currently visible.");
    }
    if (endDate && maxVisible && endDate > maxVisible) {
      warnings.push("Visible calendar window ends before the selected episode end date; not all episode days are currently visible.");
    }
  }

  return {
    selectedEpisode: {
      rawLabel: input.selectedEpisode?.rawLabel ?? "unknown",
      startDate: formatIsoDate(parseSupportedDate(input.selectedEpisode?.startDate)),
      endDate: formatIsoDate(parseSupportedDate(input.selectedEpisode?.endDate)),
    },
    periods: {
      first30Days: {
        startDate: periodBounds.first30Days.startDate,
        endDate: periodBounds.first30Days.endDate,
        totalCards: first30Cards.length,
        countsByType: countByType(first30Cards),
        cards: first30Cards,
        workbookColumns: buildBillingPeriodWorkbookColumns(first30Cards),
      },
      second30Days: {
        startDate: periodBounds.second30Days.startDate,
        endDate: periodBounds.second30Days.endDate,
        totalCards: second30Cards.length,
        countsByType: countByType(second30Cards),
        cards: second30Cards,
        workbookColumns: buildBillingPeriodWorkbookColumns(second30Cards),
      },
      outsideRange: {
        startDate: null,
        endDate: null,
        totalCards: outsideCards.length,
        countsByType: countByType(outsideCards),
        cards: outsideCards,
        workbookColumns: buildBillingPeriodWorkbookColumns(outsideCards),
      },
    },
    visibleDays,
    warnings,
  };
}

export function buildRawBillingCalendarDayCellsFromSequentialNodes(
  nodes: SequentialCalendarNode[],
): RawBillingCalendarDayCellInput[] {
  const rawDayCells: RawBillingCalendarDayCellInput[] = [];
  let currentWeekLabel: string | undefined;
  let currentDayCell: RawBillingCalendarDayCellInput | null = null;

  for (const node of nodes) {
    if (node.kind === "week_marker") {
      currentWeekLabel = node.weekLabel;
      continue;
    }

    if (node.kind === "day_cell") {
      currentDayCell = {
        weekLabel: currentWeekLabel,
        rawDateLabel: node.rawDateLabel,
        normalizedDate: node.normalizedDate,
        visualPeriodHint: node.visualPeriodHint ?? "unknown",
        warnings: [...node.warnings],
        cards: [],
      };
      rawDayCells.push(currentDayCell);
      continue;
    }

    if (node.kind === "card" && currentDayCell) {
      currentDayCell.cards.push(node.card);
    }
  }

  return rawDayCells;
}

export async function parseBillingPeriodCalendar(
  params: BillingPeriodCalendarParserParams,
): Promise<BillingPeriodCalendarParserResult> {
  await waitForPortalPageSettled(params.page, params.debugConfig);
  const stepLogs: AutomationStepLog[] = [];
  logCalendarEvent(params, "billing_calendar_parse_start", "started", {
    selectedEpisodeRange: params.selectedEpisode?.rawLabel ?? null,
  }, "starting billing calendar parse");
  stepLogs.push(createCalendarStepLog(params.context, {
    step: "billing_calendar_parse_start",
    message: "Started read-only billing calendar parsing from the patient dashboard.",
    urlBefore: params.page.url(),
    urlAfter: params.page.url(),
    found: [`selectedEpisode=${params.selectedEpisode?.rawLabel ?? "none"}`],
  }));

  const rawDayCells = await extractRawBillingCalendarDayCells(params.page, params.debugConfig);
  stepLogs.push(createCalendarStepLog(params.context, {
    step: "billing_calendar_grid_located",
    message: "Located the patient dashboard calendar grid.",
    urlBefore: params.page.url(),
    urlAfter: params.page.url(),
    found: [rawDayCells.selectorUsed ?? "calendar grid"],
    evidence: [`dayCellCount=${rawDayCells.rawDayCells.length}`],
  }));
  logCalendarEvent(params, "billing_calendar_grid_located", rawDayCells.rawDayCells.length > 0 ? "completed" : "warning", {
    dayCount: rawDayCells.rawDayCells.length,
    selectedEpisodeRange: params.selectedEpisode?.rawLabel ?? null,
  }, "located billing calendar grid");

  stepLogs.push(createCalendarStepLog(params.context, {
    step: "billing_calendar_day_cells_discovered",
    message: `Discovered ${rawDayCells.rawDayCells.length} visible calendar day cell(s).`,
    urlBefore: params.page.url(),
    urlAfter: params.page.url(),
    found: rawDayCells.rawDayCells.map((cell) => cell.rawDateLabel ?? "unknown").slice(0, 10),
  }));

  const cardCount = rawDayCells.rawDayCells.reduce((sum, cell) => sum + cell.cards.length, 0);
  stepLogs.push(createCalendarStepLog(params.context, {
    step: "billing_calendar_cards_extracted",
    message: `Extracted ${cardCount} visible calendar card(s) from the current dashboard window.`,
    urlBefore: params.page.url(),
    urlAfter: params.page.url(),
    evidence: [`cardCount=${cardCount}`],
  }));

  const summary = buildBillingPeriodCalendarSummary({
    chartUrl: params.context.chartUrl,
    selectedEpisode: params.selectedEpisode,
    rawDayCells: rawDayCells.rawDayCells,
    warnings: rawDayCells.warnings,
  });

  stepLogs.push(createCalendarStepLog(params.context, {
    step: "billing_period_classification_complete",
    message: "Completed billing period classification for visible calendar days and cards.",
    urlBefore: params.page.url(),
    urlAfter: params.page.url(),
    evidence: [
      `first30=${summary.periods.first30Days.totalCards}`,
      `second30=${summary.periods.second30Days.totalCards}`,
      `outside=${summary.periods.outsideRange.totalCards}`,
    ],
  }));
  logCalendarEvent(params, "billing_period_classification_complete", "completed", {
    selectedEpisodeRange: params.selectedEpisode?.rawLabel ?? null,
    dayCount: summary.visibleDays.length,
    cardCount,
    countsByPeriod: {
      first30: summary.periods.first30Days.totalCards,
      second30: summary.periods.second30Days.totalCards,
      outside: summary.periods.outsideRange.totalCards,
    },
    warnings: summary.warnings,
  }, "completed billing period classification");

  const summaryPath = path.join(params.outputDirectory, "billing-period-calendar-summary.json");
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  stepLogs.push(createCalendarStepLog(params.context, {
    step: "billing_calendar_summary_persisted",
    message: "Persisted the billing-period calendar summary artifact for downstream dashboard use.",
    urlBefore: params.page.url(),
    urlAfter: params.page.url(),
    evidence: [summaryPath],
  }));
  logCalendarEvent(params, "billing_calendar_summary_persisted", "completed", {
    selectedEpisodeRange: params.selectedEpisode?.rawLabel ?? null,
    dayCount: summary.visibleDays.length,
    cardCount,
    countsByPeriod: {
      first30: summary.periods.first30Days.totalCards,
      second30: summary.periods.second30Days.totalCards,
      outside: summary.periods.outsideRange.totalCards,
    },
    warnings: summary.warnings,
  }, "persisted billing calendar summary");

  return {
    summary,
    summaryPath,
    stepLogs,
  };
}

async function extractRawBillingCalendarDayCells(
  page: Page,
  debugConfig?: PortalDebugConfig,
): Promise<{
  rawDayCells: RawBillingCalendarDayCellInput[];
  selectorUsed: string | null;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const calendarRootResolution = await resolveFirstVisibleLocator({
    page,
    candidates: chartCalendarSelectors.calendarRootSelectors,
    step: "billing_calendar_root",
    debugConfig,
    settle: async () => waitForPortalPageSettled(page, debugConfig),
  });
  const calendarRoot = calendarRootResolution.locator ?? page.locator("main").first();
  const sequentialDayCells = await extractRawBillingCalendarDayCellsFromSequentialLayout(calendarRoot);
  if (sequentialDayCells.length > 0) {
    return {
      rawDayCells: sequentialDayCells,
      selectorUsed: calendarRootResolution.matchedCandidate?.description ?? "calendar sequential layout",
      warnings,
    };
  }
  const weekdayHeaders = await resolveWeekdayHeaders(page, debugConfig);
  const weekRowResolution = await resolveVisibleLocatorList({
    page: calendarRoot,
    candidates: chartCalendarSelectors.weekRowSelectors,
    step: "billing_calendar_week_rows",
    debugConfig,
    maxItems: 12,
  });
  const rowLocators = weekRowResolution.items.length > 0
    ? weekRowResolution.items
    : [{ locator: calendarRoot, candidate: { description: "calendar root fallback" } }];

  const rawDayCells: RawBillingCalendarDayCellInput[] = [];
  for (let rowIndex = 0; rowIndex < rowLocators.length; rowIndex += 1) {
    const row = rowLocators[rowIndex]!;
    const weekLabel = await inferWeekLabel(row.locator, rowIndex);
    const dayCellResolution = await resolveVisibleLocatorList({
      page: row.locator,
      candidates: chartCalendarSelectors.dayCellSelectors,
      step: "billing_calendar_day_cells",
      debugConfig,
      maxItems: 14,
    });

    for (let cellIndex = 0; cellIndex < dayCellResolution.items.length; cellIndex += 1) {
      const cell = dayCellResolution.items[cellIndex]!;
      const rawDateLabel = await inferCalendarDateLabel(cell.locator);
      const normalizedDate = await inferCalendarNormalizedDate(cell.locator, rawDateLabel ?? null);
      const cards = await readRawCardsForDayCell(cell.locator);
      if (!normalizedDate) {
        continue;
      }
      if (!rawDateLabel && cards.length === 0) {
        continue;
      }

      rawDayCells.push({
        weekLabel,
        rawDateLabel: rawDateLabel ?? null,
        normalizedDate: normalizedDate ?? undefined,
        visualPeriodHint: await inferVisualPeriodHint(cell.locator),
        warnings: rawDateLabel ? [] : ["Date label could not be read from this visible calendar cell."],
        cards,
      });
    }
  }

  if (rawDayCells.length === 0) {
    warnings.push("No visible calendar day cells were parsed from the current dashboard window.");
  }

  return {
    rawDayCells,
    selectorUsed: calendarRootResolution.matchedCandidate?.description ?? null,
    warnings,
  };
}

async function extractRawBillingCalendarDayCellsFromSequentialLayout(
  calendarRoot: Locator,
): Promise<RawBillingCalendarDayCellInput[]> {
  const sequentialContainer = await resolveSequentialCalendarContainer(calendarRoot);
  if (!sequentialContainer) {
    return [];
  }

  const children = sequentialContainer.locator(":scope > *");
  const childCount = await children.count().catch(() => 0);
  if (childCount === 0) {
    return [];
  }

  const nodes: SequentialCalendarNode[] = [];
  for (let index = 0; index < childCount; index += 1) {
    const child = children.nth(index);
    if (!await child.isVisible().catch(() => false)) {
      continue;
    }

    const classValue = normalizeWhitespace(await child.getAttribute("class").catch(() => null));
    const idValue = normalizeWhitespace(await child.getAttribute("id").catch(() => null));
    const tagName = (await child.evaluate((node) => node.tagName.toLowerCase()).catch(() => "")) || "";

    if (tagName === "li" && /\bstickydate\b/i.test(classValue)) {
      nodes.push({
        kind: "week_marker",
        weekLabel: idValue || `Week ${nodes.filter((node) => node.kind === "week_marker").length + 1}`,
      });
      continue;
    }

    if (tagName === "li") {
      const normalizedDate = inferNormalizedDateFromValues([idValue]);
      if (!normalizedDate) {
        continue;
      }
      nodes.push({
        kind: "day_cell",
        rawDateLabel: idValue || normalizedDate,
        normalizedDate,
        visualPeriodHint: inferVisualPeriodHintFromText(`${classValue} ${normalizeWhitespace(await child.getAttribute("style").catch(() => null))}`),
        warnings: [],
      });
      continue;
    }

    if (looksLikeStandaloneCalendarCard(classValue)) {
      const cards = await readRawCardsForStandaloneNode(child);
      for (const card of cards) {
        nodes.push({
          kind: "card",
          card,
        });
      }
    }
  }

  return buildRawBillingCalendarDayCellsFromSequentialNodes(nodes);
}

async function readRawCardsForDayCell(cellLocator: Locator): Promise<RawBillingCalendarCardInput[]> {
  const tiles = await resolveTileLocatorsForCell(cellLocator);
  const cards: RawBillingCalendarCardInput[] = [];
  for (const tile of tiles) {
    const rawCard = await readRawCardFromLocator(tile.locator);
    if (rawCard) {
      cards.push(rawCard);
    }
  }
  return cards;
}

async function readRawCardsForStandaloneNode(cardRoot: Locator): Promise<RawBillingCalendarCardInput[]> {
  const nestedCards = await readRawCardsForDayCell(cardRoot);
  if (nestedCards.length > 0) {
    return nestedCards;
  }

  const directCard = await readRawCardFromLocator(cardRoot);
  return directCard ? [directCard] : [];
}

function countByType(cards: NormalizedCalendarCard[]): Record<string, number> {
  return cards.reduce<Record<string, number>>((acc, card) => {
    acc[card.eventType] = (acc[card.eventType] ?? 0) + 1;
    return acc;
  }, {});
}

async function resolveWeekdayHeaders(page: Page, debugConfig?: PortalDebugConfig): Promise<string[]> {
  const resolution = await resolveVisibleLocatorList({
    page,
    candidates: chartCalendarSelectors.weekdayHeaderSelectors,
    step: "billing_calendar_weekday_headers",
    debugConfig,
    maxItems: 7,
  });

  return (
    await Promise.all(
      resolution.items.map(async (item) => normalizeWhitespace(await item.locator.textContent().catch(() => null))),
    )
  ).filter((entry): entry is string => Boolean(entry && looksLikeWeekday(entry))).slice(0, 7);
}

async function inferWeekLabel(rowLocator: Locator, rowIndex: number): Promise<string> {
  const rowText = normalizeWhitespace(await rowLocator.textContent().catch(() => null));
  return rowText.match(/\bWeek\s*\d+\b/i)?.[0] ?? `Week ${rowIndex + 1}`;
}

async function inferCalendarDateLabel(locator: Locator): Promise<string | undefined> {
  const candidates = [
    normalizeWhitespace(await locator.getAttribute("id").catch(() => null)),
    normalizeWhitespace(await locator.getAttribute("data-date").catch(() => null)),
    normalizeWhitespace(await locator.locator('[class*="date"], [class*="day-number"], [class*="cell-date"], [class*="calendar-date"]').first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.locator("time").first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.getAttribute("aria-label").catch(() => null)),
  ].filter(Boolean).filter(looksLikeDateLabel);

  return candidates[0] || undefined;
}

async function inferCalendarNormalizedDate(locator: Locator, dateLabel: string | null): Promise<string | undefined> {
  const candidates = [
    normalizeWhitespace(await locator.getAttribute("id").catch(() => null)),
    normalizeWhitespace(await locator.getAttribute("data-date").catch(() => null)),
    normalizeWhitespace(await locator.locator("time").first().getAttribute("datetime").catch(() => null)),
    normalizeWhitespace(await locator.getAttribute("aria-label").catch(() => null)),
    dateLabel ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const isoMatch = candidate.match(/\b20\d{2}-\d{2}-\d{2}\b/);
    if (isoMatch?.[0]) {
      return isoMatch[0];
    }
    const slashMatch = candidate.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
    if (slashMatch?.[0]) {
      return formatIsoDate(parseSupportedDate(slashMatch[0])) ?? undefined;
    }
  }

  return undefined;
}

async function resolveTileLocatorsForCell(cellLocator: Locator): Promise<Array<{
  locator: Locator;
}>> {
  const items: Array<{ locator: Locator }> = [];
  for (const candidate of chartCalendarSelectors.tileSelectors) {
    if (candidate.strategy !== "css") {
      continue;
    }
    const locator = cellLocator.locator(candidate.selector);
    const count = Math.min(await locator.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        items.push({ locator: item });
      }
    }
    if (items.length > 0) {
      return items;
    }
  }
  return items;
}

async function readRawCardFromLocator(locator: Locator): Promise<RawBillingCalendarCardInput | null> {
  const rawText = normalizeWhitespace(await locator.innerText().catch(() => null));
  if (!rawText) {
    return null;
  }

  return {
    rawText,
    titleText: await readCalendarTileTitle(locator),
    tooltipTitles: await readTooltipTitles(locator),
    titleAttributes: await readCalendarTileTitleAttributes(locator),
    attributeSummary: await readCalendarTileAttributeSummary(locator),
    classNames: await readTileClassNames(locator),
  };
}

async function readCalendarTileTitle(locator: Locator): Promise<string | undefined> {
  const candidates = [
    normalizeWhitespace(await locator.locator("[title]").first().getAttribute("title").catch(() => null)),
    normalizeWhitespace(await locator.locator("strong, b, .title, [class*='title']").first().textContent().catch(() => null)),
    normalizeWhitespace(await locator.textContent().catch(() => null)),
  ].filter(Boolean);
  return candidates[0] || undefined;
}

async function readTooltipTitles(locator: Locator): Promise<string[]> {
  const titles = new Set<string>();
  const candidates = [
    locator,
    locator.locator("[title]"),
    locator.locator("span[title], div[title], i[title]"),
  ];
  for (const candidate of candidates) {
    const count = Math.min(await candidate.count().catch(() => 0), 10);
    for (let index = 0; index < count; index += 1) {
      const title = normalizeWhitespace(await candidate.nth(index).getAttribute("title").catch(() => null));
      if (title) {
        titles.add(title);
      }
    }
  }
  return [...titles];
}

async function readCalendarTileTitleAttributes(locator: Locator): Promise<string[]> {
  const ariaLabel = normalizeWhitespace(await locator.getAttribute("aria-label").catch(() => null));
  const title = normalizeWhitespace(await locator.getAttribute("title").catch(() => null));
  return [ariaLabel, title].filter(Boolean);
}

async function readCalendarTileAttributeSummary(locator: Locator): Promise<string[]> {
  const summary: string[] = [];
  const role = normalizeWhitespace(await locator.getAttribute("role").catch(() => null));
  const href = normalizeWhitespace(await locator.getAttribute("href").catch(() => null));
  const dataDate = normalizeWhitespace(await locator.getAttribute("data-date").catch(() => null));
  if (role) {
    summary.push(`role=${role}`);
  }
  if (href) {
    summary.push(`href=${href}`);
  }
  if (dataDate) {
    summary.push(`dataDate=${dataDate}`);
  }
  return summary;
}

async function readTileClassNames(locator: Locator): Promise<string[]> {
  const classValue = normalizeWhitespace(await locator.getAttribute("class").catch(() => null));
  return classValue ? classValue.split(/\s+/).filter(Boolean) : [];
}

async function inferVisualPeriodHint(locator: Locator): Promise<"green" | "blue" | "other" | "unknown"> {
  const classValue = normalizeWhitespace(await locator.getAttribute("class").catch(() => null));
  const styleValue = normalizeWhitespace(await locator.getAttribute("style").catch(() => null));
  return inferVisualPeriodHintFromText(`${classValue} ${styleValue}`);
}

function inferVisualPeriodHintFromText(value: string): "green" | "blue" | "other" | "unknown" {
  const haystack = value.toLowerCase();
  if (!haystack.trim()) {
    return "unknown";
  }
  if (/\bfirst30days\b/.test(haystack)) {
    return "green";
  }
  if (/\bsecond30days\b/.test(haystack)) {
    return "blue";
  }
  if (/green|success|#0f|#00ff00|rgb\(\s*0\s*,\s*128\s*,\s*0\s*\)|rgb\(\s*34\s*,\s*139\s*,\s*34\s*\)/i.test(haystack)) {
    return "green";
  }
  if (/blue|primary|#00f|#0000ff|rgb\(\s*0\s*,\s*0\s*,\s*255\s*\)|rgb\(\s*30\s*,\s*144\s*,\s*255\s*\)/i.test(haystack)) {
    return "blue";
  }
  return "other";
}

async function resolveSequentialCalendarContainer(calendarRoot: Locator): Promise<Locator | null> {
  const candidates = [
    calendarRoot.locator(".calendar-days").first(),
    calendarRoot.locator(".cdk-drop-list").first(),
    calendarRoot,
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}

function inferNormalizedDateFromValues(values: string[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      continue;
    }
    const isoMatch = normalized.match(/^\d{4}-\d{2}-\d{2}$/);
    if (isoMatch?.[0]) {
      return isoMatch[0];
    }
    const slashMatch = normalized.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
    if (slashMatch?.[0]) {
      return formatIsoDate(parseSupportedDate(slashMatch[0])) ?? undefined;
    }
  }

  return undefined;
}

function looksLikeStandaloneCalendarCard(classValue: string): boolean {
  return /\bcdk-drag\b|\bcard-drag\b|\bplot-event-card\b|\bpopoverclass-client-calendar\b/i.test(classValue);
}

function createCalendarStepLog(
  context: PatientPortalContext,
  input: {
    step: string;
    message: string;
    urlBefore: string;
    urlAfter: string;
    found?: string[];
    evidence?: string[];
  },
): AutomationStepLog {
  return createAutomationStepLog({
    step: input.step,
    message: input.message,
    patientName: context.patientName,
    urlBefore: input.urlBefore,
    urlAfter: input.urlAfter,
    found: [`workflowDomain=${context.workflowDomain}`, `patientRunId=${context.patientRunId}`, ...(input.found ?? [])],
    evidence: input.evidence,
    safeReadConfirmed: true,
  });
}

function logCalendarEvent(
  params: Pick<BillingPeriodCalendarParserParams, "logger" | "context" | "workflowRunId">,
  stepName: string,
  outcome: string,
  extra: {
    selectedEpisodeRange?: string | null;
    dayCount?: number;
    cardCount?: number;
    countsByPeriod?: Record<string, number>;
    warnings?: string[];
  },
  message: string,
): void {
  params.logger.info(
    {
      workflowDomain: params.context.workflowDomain,
      patientRunId: params.context.patientRunId,
      workflowRunId: params.workflowRunId ?? `${params.context.patientRunId}:${params.context.workflowDomain}`,
      stepName,
      outcome,
      chartUrl: params.context.chartUrl,
      currentUrl: params.context.chartUrl,
      selectedEpisodeRange: extra.selectedEpisodeRange ?? null,
      dayCount: extra.dayCount ?? null,
      cardCount: extra.cardCount ?? null,
      countsByPeriod: extra.countsByPeriod ?? {},
      warnings: extra.warnings ?? [],
    },
    message,
  );
}

function looksLikeDateLabel(value: string): boolean {
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s+\d{1,2}\b/i.test(value) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(value) ||
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    /\b20\d{2}-\d{2}-\d{2}\b/.test(value);
}

function looksLikeWeekday(value: string): boolean {
  return /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(value);
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
