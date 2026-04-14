import { describe, expect, it } from "vitest";
import {
  buildBillingPeriodCalendarSummary,
  buildRawBillingCalendarDayCellsFromSequentialNodes,
} from "../oasis/calendar/billingPeriodCalendarParser";

describe("billingPeriodCalendarParser", () => {
  it("builds visible day snapshots and aggregates counts by billing period and card type", () => {
    const summary = buildBillingPeriodCalendarSummary({
      chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      selectedEpisode: {
        rawLabel: "03/01/2026 - 04/29/2026",
        startDate: "03/01/2026",
        endDate: "04/29/2026",
        isSelected: true,
      },
      rawDayCells: [
        {
          weekLabel: "Week 1",
          rawDateLabel: "03/01/2026",
          normalizedDate: "2026-03-01",
          visualPeriodHint: "green",
          warnings: [],
          cards: [
            {
              rawText: "OASIS",
              titleText: "OASIS",
              tooltipTitles: [],
              titleAttributes: [],
              attributeSummary: [],
            },
            {
              rawText: "SN Visit 9:00 AM",
              titleText: "SN Visit",
              tooltipTitles: [],
              titleAttributes: [],
              attributeSummary: [],
            },
          ],
        },
        {
          weekLabel: "Week 5",
          rawDateLabel: "04/05/2026",
          normalizedDate: "2026-04-05",
          visualPeriodHint: "blue",
          warnings: [],
          cards: [
            {
              rawText: "PT Visit",
              titleText: "PT Visit",
              tooltipTitles: [],
              titleAttributes: [],
              attributeSummary: [],
            },
            {
              rawText: "Phys. Order",
              titleText: "Phys. Order",
              tooltipTitles: [],
              titleAttributes: [],
              attributeSummary: [],
            },
          ],
        },
        {
          weekLabel: "Week 9",
          rawDateLabel: "05/01/2026",
          normalizedDate: "2026-05-01",
          visualPeriodHint: "other",
          warnings: [],
          cards: [
            {
              rawText: "Admin Pay",
              titleText: "Admin Pay",
              tooltipTitles: [],
              titleAttributes: [],
              attributeSummary: [],
            },
          ],
        },
      ],
    });

    expect(summary.visibleDays).toHaveLength(2);
    expect(summary.visibleDays[0]?.billingPeriod).toBe("first30");
    expect(summary.visibleDays[1]?.billingPeriod).toBe("second30");
    expect(summary.periods.first30Days.totalCards).toBe(2);
    expect(summary.periods.second30Days.totalCards).toBe(2);
    expect(summary.periods.outsideRange.totalCards).toBe(0);
    expect(summary.periods.first30Days.countsByType).toEqual({
      oasis: 1,
      sn_visit: 1,
    });
    expect(summary.periods.second30Days.countsByType).toEqual({
      pt_visit: 1,
      physician_order: 1,
    });
    expect(summary.periods.outsideRange.countsByType).toEqual({});
  });

  it("emits a warning when the visible window does not cover the full selected episode", () => {
    const summary = buildBillingPeriodCalendarSummary({
      chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      selectedEpisode: {
        rawLabel: "03/01/2026 - 04/29/2026",
        startDate: "03/01/2026",
        endDate: "04/29/2026",
        isSelected: true,
      },
      rawDayCells: [
        {
          rawDateLabel: "03/15/2026",
          normalizedDate: "2026-03-15",
          visualPeriodHint: "green",
          warnings: [],
          cards: [],
        },
      ],
    });

    expect(summary.warnings.some((warning) => /visible calendar window/i.test(warning))).toBe(true);
  });

  it("assigns standalone calendar cards to the most recent episode date in sequential dashboard flow", () => {
    const rawDayCells = buildRawBillingCalendarDayCellsFromSequentialNodes([
      {
        kind: "week_marker",
        weekLabel: "week2",
      },
      {
        kind: "day_cell",
        rawDateLabel: "2026-03-12",
        normalizedDate: "2026-03-12",
        visualPeriodHint: "green",
        warnings: [],
      },
      {
        kind: "day_cell",
        rawDateLabel: "2026-03-13",
        normalizedDate: "2026-03-13",
        visualPeriodHint: "green",
        warnings: [],
      },
      {
        kind: "day_cell",
        rawDateLabel: "2026-03-14",
        normalizedDate: "2026-03-14",
        visualPeriodHint: "green",
        warnings: [],
      },
      {
        kind: "card",
        card: {
          rawText: "Lara, T. RN Validated RN Regular Visit - Direct Care 08:00 - 09:00",
          titleText: "Lara, T. RN",
          tooltipTitles: [],
          titleAttributes: [],
          attributeSummary: [],
          classNames: ["plot-event-card"],
        },
      },
      {
        kind: "day_cell",
        rawDateLabel: "2026-03-15",
        normalizedDate: "2026-03-15",
        visualPeriodHint: "green",
        warnings: [],
      },
    ]);

    expect(rawDayCells).toHaveLength(4);
    expect(rawDayCells[2]?.normalizedDate).toBe("2026-03-14");
    expect(rawDayCells[2]?.cards).toHaveLength(1);
    expect(rawDayCells[2]?.cards[0]?.titleText).toBe("Lara, T. RN");
    expect(rawDayCells[3]?.cards).toHaveLength(0);
  });

  it("builds a billing summary from sequential dashboard cards and preserves important card details", () => {
    const rawDayCells = buildRawBillingCalendarDayCellsFromSequentialNodes([
      {
        kind: "week_marker",
        weekLabel: "week2",
      },
      {
        kind: "day_cell",
        rawDateLabel: "2026-03-14",
        normalizedDate: "2026-03-14",
        visualPeriodHint: "green",
        warnings: [],
      },
      {
        kind: "card",
        card: {
          rawText: "Lara, T. RN Validated RN Regular Visit - Direct Care 08:00 - 09:00",
          titleText: "Lara, T. RN",
          tooltipTitles: [],
          titleAttributes: ["Validated"],
          attributeSummary: [],
          classNames: ["plot-event-card"],
        },
      },
      {
        kind: "day_cell",
        rawDateLabel: "2026-04-03",
        normalizedDate: "2026-04-03",
        visualPeriodHint: "blue",
        warnings: [],
      },
      {
        kind: "card",
        card: {
          rawText: "Case Manager CN 10:00 AM",
          titleText: "Case Manager",
          tooltipTitles: [],
          titleAttributes: [],
          attributeSummary: [],
          classNames: ["plot-event-card"],
        },
      },
    ]);

    const summary = buildBillingPeriodCalendarSummary({
      chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake/calendar",
      selectedEpisode: {
        rawLabel: "02/27/2026 - 04/27/2026",
        startDate: "02/27/2026",
        endDate: "04/27/2026",
        isSelected: true,
      },
      rawDayCells,
    });

    expect(summary.visibleDays).toHaveLength(2);
    expect(summary.periods.first30Days.totalCards).toBe(1);
    expect(summary.periods.second30Days.totalCards).toBe(1);
    expect(summary.periods.first30Days.countsByType).toEqual({ sn_visit: 1 });
    expect(summary.periods.second30Days.countsByType).toEqual({ communication_note: 1 });
    expect(summary.periods.first30Days.cards[0]).toMatchObject({
      title: "Lara, T. RN",
      clinician: "Lara, T. RN",
      statusLabel: "Validated",
      timeLabel: "08:00 - 09:00",
      date: "2026-03-14",
      billingPeriod: "first30",
      eventType: "sn_visit",
    });
  });
});
