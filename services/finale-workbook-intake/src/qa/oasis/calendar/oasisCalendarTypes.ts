import type { QaExtractionDiagnostics } from "../../shared/qaTypes";

export type RawOasisCalendarTileInput = {
  titleText?: string;
  rawText: string;
  tooltipTitles: string[];
  titleAttributes: string[];
  href?: string;
  dateLabel?: string;
  attributeSummary: string[];
  selectorFamily?: string;
  classNames?: string[];
};

export type RawOasisCalendarDayCellInput = {
  weekLabel?: string;
  weekday?: string;
  dateLabel: string;
  normalizedDate?: string;
  inBillingPeriodHint?: boolean;
  attributeSummary: string[];
  tileSelectorUsed?: string;
  tiles: RawOasisCalendarTileInput[];
};

export type OasisCalendarHeaderSummary = {
  patientDisplayName?: string;
  socDate?: string;
  status?: string;
  payer?: string;
  episodeLabel?: string;
  episodeDateRange?: string;
  firstThirtyDaysLabel?: string;
  secondThirtyDaysLabel?: string;
  thresholds?: string[];
  visitFrequencyText?: string;
  rawHeaderText: string;
};

export type CalendarDayCell = {
  weekLabel?: string;
  weekday?: string;
  dateLabel: string;
  normalizedDate?: string;
  inBillingPeriod: boolean;
  billingPeriodDayNumber?: number;
  segmentNumber?: number;
  tileCount: number;
};

export type OasisBillingPeriodSegment = {
  segmentNumber: number;
  dayRangeLabel: string;
  startDayNumber: number;
  endDayNumber: number;
  tileCount: number;
  oasisTileCount: number;
  tiles: OasisCalendarTile[];
};

export type OasisCalendarTile = {
  title: string;
  subtitle?: string;
  staffText?: string;
  timeText?: string;
  statusText?: string;
  rawText: string;
  tooltipTitles: string[];
  titleAttributes: string[];
  href?: string;
  attributeSummary: string[];
  selectorFamily?: string;
  classNames?: string[];
  weekLabel?: string;
  weekday?: string;
  dateLabel?: string;
  normalizedDate?: string;
  billingPeriodDayNumber?: number;
  billingPeriodSegmentNumber?: number;
  inFirstBillingPeriod?: boolean;
  oasisMatch: boolean;
  oasisReason?: string;
};

export type OasisCalendarScopeResult = {
  chartUrl: string;
  billingPeriod: {
    detected: boolean;
    startDateText?: string;
    endDateText?: string;
    normalizedStartDate?: string;
    normalizedEndDate?: string;
  };
  header: OasisCalendarHeaderSummary;
  dayCells: CalendarDayCell[];
  visibleTiles: OasisCalendarTile[];
  oasisTiles: OasisCalendarTile[];
  segments: OasisBillingPeriodSegment[];
  diagnostics: QaExtractionDiagnostics & {
    weekRowCount: number;
    dayCellCount: number;
    tileSelectorUsed?: string;
    headerSelectorUsed?: string;
    calendarSelectorUsed?: string;
    visibleTileCount: number;
    oasisTileCount: number;
    firstBillingPeriodTileCount: number;
    billingPeriodCellCount: number;
    pageMarkersFound: string[];
  };
};

export type ExtractOasisCalendarScopeInput = {
  chartUrl: string;
  rawHeaderText: string;
  rawDayCells: RawOasisCalendarDayCellInput[];
  diagnostics: {
    weekRowCount: number;
    dayCellCount: number;
    tileSelectorUsed?: string;
    headerSelectorUsed?: string;
    calendarSelectorUsed?: string;
    pageMarkersFound: string[];
    warnings?: string[];
  };
};
