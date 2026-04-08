import { normalizeQaWhitespace } from "../../shared/textNormalization";
import type {
  CalendarDayCell,
  OasisBillingPeriodSegment,
  OasisCalendarHeaderSummary,
  OasisCalendarTile,
  RawOasisCalendarDayCellInput,
} from "./oasisCalendarTypes";

type ParsedBillingPeriod = {
  detected: boolean;
  label?: string;
  startDateText?: string;
  endDateText?: string;
  normalizedStartDate?: string;
  normalizedEndDate?: string;
  warnings: string[];
};

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatShortDate(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function parseMonthName(month: string): number | null {
  const normalized = month.toLowerCase().slice(0, 3);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(normalized);
  return index >= 0 ? index : null;
}

function parseDateText(value: string | undefined, fallbackYear?: number): Date | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeQaWhitespace(value);
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const slashMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = slashMatch[3]
      ? Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3])
      : fallbackYear;
    if (year) {
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const monthNameMatch = normalized.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{2,4}))?\b/);
  if (monthNameMatch) {
    const month = parseMonthName(monthNameMatch[1] ?? "");
    const day = Number(monthNameMatch[2]);
    const year = monthNameMatch[3]
      ? Number(monthNameMatch[3].length === 2 ? `20${monthNameMatch[3]}` : monthNameMatch[3])
      : fallbackYear;
    if (month !== null && year) {
      const date = new Date(year, month, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  return null;
}

function extractRangeDates(value: string | undefined): { startDateText?: string; endDateText?: string } {
  const normalized = normalizeQaWhitespace(value);
  const matches = normalized.match(/\b(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{2,4})?)\b/g) ?? [];
  return {
    startDateText: matches[0],
    endDateText: matches[1],
  };
}

function extractYearHint(value: string | undefined): number | undefined {
  const match = value?.match(/\b(20\d{2})\b/);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deriveCalendarYearHint(rawDayCells: RawOasisCalendarDayCellInput[]): number | undefined {
  for (const dayCell of rawDayCells) {
    const dayCellYear = extractYearHint(dayCell.normalizedDate) ??
      extractYearHint(dayCell.dateLabel) ??
      dayCell.attributeSummary.map(extractYearHint).find((value): value is number => Boolean(value));
    if (dayCellYear) {
      return dayCellYear;
    }

    for (const tile of dayCell.tiles) {
      const tileYear = extractYearHint(tile.dateLabel) ??
        tile.tooltipTitles.map(extractYearHint).find((value): value is number => Boolean(value)) ??
        tile.titleAttributes.map(extractYearHint).find((value): value is number => Boolean(value)) ??
        tile.attributeSummary.map(extractYearHint).find((value): value is number => Boolean(value)) ??
        extractYearHint(tile.rawText);
      if (tileYear) {
        return tileYear;
      }
    }
  }

  return undefined;
}

function detectBillingPeriodFromCalendarGrid(rawDayCells: RawOasisCalendarDayCellInput[]): ParsedBillingPeriod | null {
  const warnings: string[] = [];
  const fallbackYear = deriveCalendarYearHint(rawDayCells) ?? new Date().getFullYear();
  const populatedDates = rawDayCells
    .filter((dayCell) => dayCell.tiles.length > 0)
    .map((dayCell) => parseDateText(dayCell.normalizedDate ?? dayCell.dateLabel, fallbackYear))
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());

  const startDate = populatedDates[0];
  if (!startDate) {
    return null;
  }

  const endDate = addDays(startDate, 29);
  warnings.push("Billing period was approximated from the earliest populated calendar date because the chart header did not expose an explicit first-30-day range.");

  return {
    detected: true,
    label: "First 30 Days",
    startDateText: formatShortDate(startDate),
    endDateText: formatShortDate(endDate),
    normalizedStartDate: toIsoDate(startDate),
    normalizedEndDate: toIsoDate(endDate),
    warnings,
  };
}

export function detectBillingPeriod(
  header: OasisCalendarHeaderSummary,
  rawDayCells: RawOasisCalendarDayCellInput[],
): ParsedBillingPeriod {
  const warnings: string[] = [];
  const explicitRange = extractRangeDates(header.firstThirtyDaysLabel) || extractRangeDates(header.rawHeaderText);
  const socDate = parseDateText(header.socDate);
  const fallbackYear = socDate?.getFullYear();
  const explicitStart = parseDateText(explicitRange.startDateText, fallbackYear);
  const explicitEnd = parseDateText(explicitRange.endDateText, explicitStart?.getFullYear() ?? fallbackYear);

  if (explicitStart && explicitEnd) {
    return {
      detected: true,
      label: header.firstThirtyDaysLabel ?? "First 30 Days",
      startDateText: formatShortDate(explicitStart),
      endDateText: formatShortDate(explicitEnd),
      normalizedStartDate: toIsoDate(explicitStart),
      normalizedEndDate: toIsoDate(explicitEnd),
      warnings,
    };
  }

  if (socDate) {
    const endDate = addDays(socDate, 29);
    warnings.push("Billing period was approximated from the SOC date because an explicit first-30-day range was not available.");
    return {
      detected: true,
      label: header.firstThirtyDaysLabel ?? "First 30 Days",
      startDateText: formatShortDate(socDate),
      endDateText: formatShortDate(endDate),
      normalizedStartDate: toIsoDate(socDate),
      normalizedEndDate: toIsoDate(endDate),
      warnings,
    };
  }

  const calendarDerivedPeriod = detectBillingPeriodFromCalendarGrid(rawDayCells);
  if (calendarDerivedPeriod) {
    return calendarDerivedPeriod;
  }

  warnings.push("Billing period could not be confidently detected from the chart header.");
  return {
    detected: false,
    label: header.firstThirtyDaysLabel ?? "First 30 Days",
    warnings,
  };
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function weekdayOrder(value: string | undefined): number {
  const normalized = normalizeQaWhitespace(value).toLowerCase();
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = days.indexOf(normalized);
  return index >= 0 ? index : 99;
}

function weekOrder(value: string | undefined): number {
  const match = normalizeQaWhitespace(value).match(/\bweek\s*(\d+)\b/i);
  return match?.[1] ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function parseTimeOrder(value: string | undefined): number {
  const normalized = normalizeQaWhitespace(value);
  const match = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function compareMaybeString(left: string | undefined, right: string | undefined): number {
  return normalizeQaWhitespace(left).localeCompare(normalizeQaWhitespace(right));
}

function compareTiles(left: OasisCalendarTile, right: OasisCalendarTile): number {
  return (left.billingPeriodDayNumber ?? Number.MAX_SAFE_INTEGER) - (right.billingPeriodDayNumber ?? Number.MAX_SAFE_INTEGER) ||
    compareMaybeString(left.normalizedDate, right.normalizedDate) ||
    weekOrder(left.weekLabel) - weekOrder(right.weekLabel) ||
    weekdayOrder(left.weekday) - weekdayOrder(right.weekday) ||
    parseTimeOrder(left.timeText) - parseTimeOrder(right.timeText) ||
    compareMaybeString(left.title, right.title) ||
    compareMaybeString(left.staffText, right.staffText) ||
    compareMaybeString(left.subtitle, right.subtitle) ||
    compareMaybeString(left.rawText, right.rawText);
}

function compareDayCells(left: CalendarDayCell, right: CalendarDayCell): number {
  return compareMaybeString(left.normalizedDate, right.normalizedDate) ||
    (left.billingPeriodDayNumber ?? Number.MAX_SAFE_INTEGER) - (right.billingPeriodDayNumber ?? Number.MAX_SAFE_INTEGER) ||
    weekOrder(left.weekLabel) - weekOrder(right.weekLabel) ||
    weekdayOrder(left.weekday) - weekdayOrder(right.weekday) ||
    compareMaybeString(left.dateLabel, right.dateLabel);
}

export function normalizeCalendarCellDate(
  input: RawOasisCalendarDayCellInput,
  billingPeriod: ParsedBillingPeriod,
): string | undefined {
  if (input.normalizedDate) {
    return normalizeQaWhitespace(input.normalizedDate);
  }

  const fallbackYear = billingPeriod.normalizedStartDate ? new Date(billingPeriod.normalizedStartDate).getFullYear() : undefined;
  const parsed = parseDateText(input.dateLabel, fallbackYear);
  if (!parsed) {
    return undefined;
  }

  if (!billingPeriod.normalizedStartDate || !billingPeriod.normalizedEndDate) {
    return toIsoDate(parsed);
  }

  const start = new Date(billingPeriod.normalizedStartDate);
  const end = new Date(billingPeriod.normalizedEndDate);
  const candidate = new Date(parsed.getTime());
  const nextYearCandidate = new Date(parsed.getFullYear() + 1, parsed.getMonth(), parsed.getDate());
  const prevYearCandidate = new Date(parsed.getFullYear() - 1, parsed.getMonth(), parsed.getDate());
  const candidates = [candidate, nextYearCandidate, prevYearCandidate];
  const inRange = candidates.find((entry) => entry >= start && entry <= end);
  if (inRange) {
    return toIsoDate(inRange);
  }

  return toIsoDate(candidate);
}

export function buildCalendarDayCellsAndSegments(input: {
  rawDayCells: RawOasisCalendarDayCellInput[];
  tiles: OasisCalendarTile[];
  header: OasisCalendarHeaderSummary;
}): {
  billingPeriod: ParsedBillingPeriod;
  dayCells: CalendarDayCell[];
  visibleTiles: OasisCalendarTile[];
  segments: OasisBillingPeriodSegment[];
} {
  const billingPeriod = detectBillingPeriod(input.header, input.rawDayCells);
  const segments: OasisBillingPeriodSegment[] = Array.from({ length: 6 }, (_value, index) => ({
    segmentNumber: index + 1,
    dayRangeLabel: `days ${index * 5 + 1}-${index * 5 + 5}`,
    startDayNumber: index * 5 + 1,
    endDayNumber: index * 5 + 5,
    tileCount: 0,
    oasisTileCount: 0,
    tiles: [],
  }));

  const dayCells: CalendarDayCell[] = [];
  const visibleTiles: OasisCalendarTile[] = [];

  for (let index = 0; index < input.rawDayCells.length; index += 1) {
    const rawCell = input.rawDayCells[index]!;
    const normalizedDate = normalizeCalendarCellDate(rawCell, billingPeriod);
    let billingPeriodDayNumber: number | undefined;
    let segmentNumber: number | undefined;
    let inBillingPeriod = false;

    if (normalizedDate && billingPeriod.normalizedStartDate && billingPeriod.normalizedEndDate) {
      const dayOffset = daysBetween(billingPeriod.normalizedStartDate, normalizedDate);
      if (dayOffset >= 0 && dayOffset < 30) {
        billingPeriodDayNumber = dayOffset + 1;
        segmentNumber = Math.ceil(billingPeriodDayNumber / 5);
        inBillingPeriod = true;
      }
    } else if (rawCell.inBillingPeriodHint) {
      inBillingPeriod = true;
    }

    const cellTiles = input.tiles.filter((tile) =>
      tile.weekLabel === rawCell.weekLabel &&
      tile.weekday === rawCell.weekday &&
      tile.dateLabel === rawCell.dateLabel,
    ).map((tile) => ({
      ...tile,
      normalizedDate,
      billingPeriodDayNumber,
      billingPeriodSegmentNumber: segmentNumber,
      inFirstBillingPeriod: inBillingPeriod,
    })).sort(compareTiles);

    dayCells.push({
      weekLabel: rawCell.weekLabel,
      weekday: rawCell.weekday,
      dateLabel: rawCell.dateLabel,
      normalizedDate,
      inBillingPeriod,
      billingPeriodDayNumber,
      segmentNumber,
      tileCount: cellTiles.length,
    });

    if (inBillingPeriod || !billingPeriod.detected) {
      visibleTiles.push(...cellTiles);
    }

    if (segmentNumber) {
      const segment = segments[segmentNumber - 1];
      if (segment) {
        segment.tiles.push(...cellTiles);
        segment.tileCount += cellTiles.length;
        segment.oasisTileCount += cellTiles.filter((tile) => tile.oasisMatch).length;
      }
    }
  }

  const sortedDayCells = [...dayCells].sort(compareDayCells);
  const sortedVisibleTiles = [...visibleTiles].sort(compareTiles);
  const sortedSegments = segments.map((segment) => ({
    ...segment,
    tiles: [...segment.tiles].sort(compareTiles),
  }));

  return {
    billingPeriod,
    dayCells: sortedDayCells,
    visibleTiles: sortedVisibleTiles,
    segments: sortedSegments,
  };
}
