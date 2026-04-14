import { describe, expect, it } from "vitest";
import {
  classifyBillingPeriodDate,
  computeBillingPeriodBounds,
} from "../oasis/calendar/billingPeriodClassifier";

describe("billingPeriodClassifier", () => {
  const selectedEpisode = {
    rawLabel: "03/01/2026 - 04/29/2026",
    startDate: "03/01/2026",
    endDate: "04/29/2026",
  };

  it("classifies dates into first30, second30, and outside using the episode range", () => {
    expect(classifyBillingPeriodDate({ selectedEpisode, date: "2026-03-01" })).toEqual({
      billingPeriod: "first30",
      episodeDayNumber: 1,
    });
    expect(classifyBillingPeriodDate({ selectedEpisode, date: "2026-03-30" })).toEqual({
      billingPeriod: "first30",
      episodeDayNumber: 30,
    });
    expect(classifyBillingPeriodDate({ selectedEpisode, date: "2026-03-31" })).toEqual({
      billingPeriod: "second30",
      episodeDayNumber: 31,
    });
    expect(classifyBillingPeriodDate({ selectedEpisode, date: "2026-04-29" })).toEqual({
      billingPeriod: "second30",
      episodeDayNumber: 60,
    });
    expect(classifyBillingPeriodDate({ selectedEpisode, date: "2026-04-30" })).toEqual({
      billingPeriod: "outside",
      episodeDayNumber: null,
    });
  });

  it("handles malformed or null dates without crashing", () => {
    expect(classifyBillingPeriodDate({ selectedEpisode, date: null })).toEqual({
      billingPeriod: "unknown",
      episodeDayNumber: null,
    });
    expect(classifyBillingPeriodDate({ selectedEpisode, date: "not-a-date" })).toEqual({
      billingPeriod: "unknown",
      episodeDayNumber: null,
    });
  });

  it("computes billing period boundaries from the selected episode", () => {
    expect(computeBillingPeriodBounds(selectedEpisode)).toEqual({
      first30Days: {
        startDate: "2026-03-01",
        endDate: "2026-03-30",
      },
      second30Days: {
        startDate: "2026-03-31",
        endDate: "2026-04-29",
      },
    });
  });
});
