import type { OasisBillingPeriodSegment, OasisCalendarScopeResult } from "./oasisCalendarTypes";

function compactTile(tile: OasisCalendarScopeResult["visibleTiles"][number]) {
  return {
    title: tile.title,
    subtitle: tile.subtitle,
    staffText: tile.staffText,
    timeText: tile.timeText,
    statusText: tile.statusText,
    selectorFamily: tile.selectorFamily,
    weekLabel: tile.weekLabel,
    weekday: tile.weekday,
    dateLabel: tile.dateLabel,
    normalizedDate: tile.normalizedDate,
    billingPeriodDayNumber: tile.billingPeriodDayNumber,
    billingPeriodSegmentNumber: tile.billingPeriodSegmentNumber,
    inBillingPeriod: tile.inFirstBillingPeriod,
    oasisMatch: tile.oasisMatch,
    oasisReason: tile.oasisReason,
    classNames: tile.classNames?.slice(0, 8) ?? [],
    attributeSummary: tile.attributeSummary.filter((entry) =>
      entry.startsWith("category=") ||
      entry.startsWith("marker=") ||
      entry.startsWith("cellTileIndex=") ||
      entry.startsWith("normalizedDate="),
    ),
    tooltipTitles: tile.tooltipTitles.slice(0, 6),
  };
}

function tilesForCell(
  calendarScope: OasisCalendarScopeResult,
  cell: OasisCalendarScopeResult["dayCells"][number],
) {
  return calendarScope.visibleTiles
    .filter((tile) =>
      tile.weekLabel === cell.weekLabel &&
      tile.weekday === cell.weekday &&
      tile.dateLabel === cell.dateLabel,
    )
    .map(compactTile);
}

export function buildAllTileLogPayload(calendarScope: OasisCalendarScopeResult) {
  return {
    visibleTileCount: calendarScope.visibleTiles.length,
    tiles: calendarScope.visibleTiles.map(compactTile),
  };
}

export function buildDateCellLogPayloads(calendarScope: OasisCalendarScopeResult): Array<{
  weekLabel?: string;
  weekday?: string;
  dateLabel: string;
  normalizedDate?: string;
  inBillingPeriod: boolean;
  billingPeriodDayNumber?: number;
  segmentNumber?: number;
  tileCount: number;
  tiles: ReturnType<typeof compactTile>[];
}> {
  return calendarScope.dayCells
    .filter((cell) => cell.inBillingPeriod)
    .map((cell) => ({
      weekLabel: cell.weekLabel,
      weekday: cell.weekday,
      dateLabel: cell.dateLabel,
      normalizedDate: cell.normalizedDate,
      inBillingPeriod: cell.inBillingPeriod,
      billingPeriodDayNumber: cell.billingPeriodDayNumber,
      segmentNumber: cell.segmentNumber,
      tileCount: cell.tileCount,
      tiles: tilesForCell(calendarScope, cell),
    }));
}

export function buildDateCountPayload(calendarScope: OasisCalendarScopeResult) {
  return {
    dates: buildDateCellLogPayloads(calendarScope).map((entry) => ({
      weekLabel: entry.weekLabel,
      weekday: entry.weekday,
      dateLabel: entry.dateLabel,
      normalizedDate: entry.normalizedDate,
      billingPeriodDayNumber: entry.billingPeriodDayNumber,
      segmentNumber: entry.segmentNumber,
      tileCount: entry.tileCount,
      oasisTileCount: entry.tiles.filter((tile) => tile.oasisMatch).length,
    })),
  };
}

export function buildSegmentLogPayloads(calendarScope: OasisCalendarScopeResult): Array<{
  segmentNumber: number;
  dayRangeLabel: string;
  startDayNumber: number;
  endDayNumber: number;
  tileCount: number;
  oasisTileCount: number;
  tiles: ReturnType<typeof compactTile>[];
}> {
  return calendarScope.segments.map((segment: OasisBillingPeriodSegment) => ({
    segmentNumber: segment.segmentNumber,
    dayRangeLabel: segment.dayRangeLabel,
    startDayNumber: segment.startDayNumber,
    endDayNumber: segment.endDayNumber,
    tileCount: segment.tileCount,
    oasisTileCount: segment.oasisTileCount,
    tiles: segment.tiles.map(compactTile),
  }));
}

export function buildOasisDateLogPayloads(calendarScope: OasisCalendarScopeResult): Array<{
  weekLabel?: string;
  weekday?: string;
  dateLabel: string;
  normalizedDate?: string;
  oasisTileCount: number;
  tiles: ReturnType<typeof compactTile>[];
}> {
  return buildDateCellLogPayloads(calendarScope)
    .map((entry) => ({
      ...entry,
      tiles: entry.tiles.filter((tile) => tile.oasisMatch),
      oasisTileCount: entry.tiles.filter((tile) => tile.oasisMatch).length,
    }))
    .filter((entry) => entry.oasisTileCount > 0);
}

export function buildOasisSegmentLogPayloads(calendarScope: OasisCalendarScopeResult): Array<{
  segmentNumber: number;
  dayRangeLabel: string;
  oasisTileCount: number;
  tiles: ReturnType<typeof compactTile>[];
}> {
  return calendarScope.segments
    .filter((segment) => segment.oasisTileCount > 0)
    .map((segment) => ({
      segmentNumber: segment.segmentNumber,
      dayRangeLabel: segment.dayRangeLabel,
      oasisTileCount: segment.oasisTileCount,
      tiles: segment.tiles.filter((tile) => tile.oasisMatch).map(compactTile),
    }));
}
