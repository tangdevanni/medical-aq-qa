import { normalizeQaWhitespace } from "../../shared/textNormalization";
import { buildCalendarDayCellsAndSegments } from "./extractFirstBillingPeriodSegments";
import { buildOasisCalendarTile } from "./oasisCalendarMatchers";
import type {
  ExtractOasisCalendarScopeInput,
  OasisCalendarHeaderSummary,
  OasisCalendarScopeResult,
  OasisCalendarTile,
} from "./oasisCalendarTypes";

function captureLabeledValue(rawText: string, labelPattern: string): string | undefined {
  return rawText.match(new RegExp(`${labelPattern}\\s*:?\\s*([^|\\n]+)`, "i"))?.[1]?.trim();
}

function captureDateRange(rawText: string): string | undefined {
  return rawText.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*(?:-|through|to)\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i)?.[0] ??
    rawText.match(/\b[A-Za-z]{3,9}\s+\d{1,2}\s*(?:-|through|to)\s*[A-Za-z]{3,9}\s+\d{1,2}\b/i)?.[0];
}

function captureThirtyDayLabel(rawText: string, ordinal: "first" | "second"): string | undefined {
  const pattern = ordinal === "first"
    ? /\b(?:first|1st)\s*30\s*days?[^|.\n]*/i
    : /\b(?:second|2nd)\s*30\s*days?[^|.\n]*/i;
  return rawText.match(pattern)?.[0]?.trim();
}

function buildHeaderSummary(rawHeaderText: string): OasisCalendarHeaderSummary {
  const normalized = normalizeQaWhitespace(rawHeaderText);
  const dateRange = captureDateRange(normalized);
  const thresholds = [...new Set((normalized.match(/\bthreshold[^|.\n]*/gi) ?? []).map((entry) => entry.trim()))];

  return {
    patientDisplayName: normalized.split("|")[0]?.split("SOC")[0]?.trim() || undefined,
    socDate: captureLabeledValue(normalized, "SOC(?:\\s*Date)?"),
    status: captureLabeledValue(normalized, "Status"),
    payer: captureLabeledValue(normalized, "Payer"),
    episodeLabel: captureLabeledValue(normalized, "Episode(?:\\s*Number)?") ?? normalized.match(/\bEpisode\s*\d+\b/i)?.[0] ?? undefined,
    episodeDateRange: dateRange,
    firstThirtyDaysLabel: captureThirtyDayLabel(normalized, "first"),
    secondThirtyDaysLabel: captureThirtyDayLabel(normalized, "second"),
    thresholds: thresholds.length > 0 ? thresholds : undefined,
    visitFrequencyText: captureLabeledValue(normalized, "Visit\\s*Frequency") ?? normalized.match(/\bvisit frequency[^|.\n]*/i)?.[0] ?? undefined,
    rawHeaderText: normalized,
  };
}

export function extractOasisCalendarScope(input: ExtractOasisCalendarScopeInput): OasisCalendarScopeResult {
  const header = buildHeaderSummary(input.rawHeaderText);
  const baseTiles: OasisCalendarTile[] = input.rawDayCells.flatMap((dayCell) =>
    dayCell.tiles.map((tile) => ({
      ...buildOasisCalendarTile({
        ...tile,
        dateLabel: dayCell.dateLabel,
      }),
      weekLabel: dayCell.weekLabel,
      weekday: dayCell.weekday,
      dateLabel: dayCell.dateLabel,
    })),
  );

  const segmented = buildCalendarDayCellsAndSegments({
    rawDayCells: input.rawDayCells,
    tiles: baseTiles,
    header,
  });
  const oasisTiles = segmented.visibleTiles.filter((tile) => tile.oasisMatch);
  const billingPeriodCellCount = segmented.dayCells.filter((cell) => cell.inBillingPeriod).length;
  const warnings = [
    ...(input.diagnostics.warnings ?? []),
    ...segmented.billingPeriod.warnings,
  ];

  if (segmented.visibleTiles.length === 0) {
    warnings.push("No tiles were captured from billing-period day cells; falling back to all parsed cell tiles may be required.");
  }

  return {
    chartUrl: input.chartUrl,
    billingPeriod: {
      detected: segmented.billingPeriod.detected,
      startDateText: segmented.billingPeriod.startDateText,
      endDateText: segmented.billingPeriod.endDateText,
      normalizedStartDate: segmented.billingPeriod.normalizedStartDate,
      normalizedEndDate: segmented.billingPeriod.normalizedEndDate,
    },
    header,
    dayCells: segmented.dayCells,
    visibleTiles: segmented.visibleTiles,
    oasisTiles,
    segments: segmented.segments,
    diagnostics: {
      weekRowCount: input.diagnostics.weekRowCount,
      dayCellCount: input.diagnostics.dayCellCount,
      tileSelectorUsed: input.diagnostics.tileSelectorUsed,
      headerSelectorUsed: input.diagnostics.headerSelectorUsed,
      calendarSelectorUsed: input.diagnostics.calendarSelectorUsed,
      visibleTileCount: segmented.visibleTiles.length,
      oasisTileCount: oasisTiles.length,
      firstBillingPeriodTileCount: segmented.visibleTiles.filter((tile) => tile.inFirstBillingPeriod).length,
      billingPeriodCellCount,
      pageMarkersFound: input.diagnostics.pageMarkersFound,
      warnings,
    },
  };
}
