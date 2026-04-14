import type { BillingPeriodBucket } from "../types/billingPeriodCalendarSummary";

export interface EpisodeRangeBoundary {
  rawLabel: string;
  startDate: string | null;
  endDate: string | null;
}

export interface BillingPeriodClassification {
  billingPeriod: BillingPeriodBucket;
  episodeDayNumber: number | null;
}

export function classifyBillingPeriodDate(input: {
  selectedEpisode: EpisodeRangeBoundary | null;
  date: string | null | undefined;
}): BillingPeriodClassification {
  const episodeStart = parseSupportedDate(input.selectedEpisode?.startDate);
  const episodeEnd = parseSupportedDate(input.selectedEpisode?.endDate);
  const targetDate = parseSupportedDate(input.date);

  if (!episodeStart || !episodeEnd || !targetDate) {
    return {
      billingPeriod: "unknown",
      episodeDayNumber: null,
    };
  }

  const episodeStartTime = startOfDayUtc(episodeStart).getTime();
  const episodeEndTime = startOfDayUtc(episodeEnd).getTime();
  const targetTime = startOfDayUtc(targetDate).getTime();
  if (targetTime < episodeStartTime || targetTime > episodeEndTime) {
    return {
      billingPeriod: "outside",
      episodeDayNumber: null,
    };
  }

  const episodeDayNumber = Math.floor((targetTime - episodeStartTime) / DAY_MS) + 1;
  if (episodeDayNumber <= 30) {
    return {
      billingPeriod: "first30",
      episodeDayNumber,
    };
  }
  if (episodeDayNumber <= 60) {
    return {
      billingPeriod: "second30",
      episodeDayNumber,
    };
  }

  return {
    billingPeriod: "outside",
    episodeDayNumber,
  };
}

export function computeBillingPeriodBounds(selectedEpisode: EpisodeRangeBoundary | null): {
  first30Days: { startDate: string | null; endDate: string | null };
  second30Days: { startDate: string | null; endDate: string | null };
} {
  const episodeStart = parseSupportedDate(selectedEpisode?.startDate);
  const episodeEnd = parseSupportedDate(selectedEpisode?.endDate);
  if (!episodeStart || !episodeEnd) {
    return {
      first30Days: { startDate: null, endDate: null },
      second30Days: { startDate: null, endDate: null },
    };
  }

  const first30End = minDate(addDays(episodeStart, 29), episodeEnd);
  const second30Start = addDays(episodeStart, 30);
  const second30End = second30Start <= episodeEnd
    ? minDate(addDays(episodeStart, 59), episodeEnd)
    : null;

  return {
    first30Days: {
      startDate: formatIsoDate(episodeStart),
      endDate: formatIsoDate(first30End),
    },
    second30Days: {
      startDate: second30End ? formatIsoDate(second30Start) : null,
      endDate: second30End ? formatIsoDate(second30End) : null,
    },
  };
}

export function parseSupportedDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const parsed = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const parsed = new Date(Date.UTC(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatIsoDate(value: Date | null): string | null {
  if (!value) {
    return null;
  }
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const copy = new Date(value.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfDayUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function minDate(left: Date, right: Date): Date {
  return left <= right ? left : right;
}

const DAY_MS = 24 * 60 * 60 * 1000;
