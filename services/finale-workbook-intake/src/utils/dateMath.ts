const EXCEL_EPOCH_OFFSET = 25569;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return formatIsoDate(date);
}

function parseNumericDate(value: number): string | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const utcMilliseconds = Math.round((value - EXCEL_EPOCH_OFFSET) * MILLISECONDS_PER_DAY);
  return formatIsoDate(new Date(utcMilliseconds));
}

function parseDateToken(rawValue: string): string | null {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return buildDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
    return buildDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return formatIsoDate(parsed);
}

export function normalizeDateInput(value: unknown): string | null {
  if (typeof value === "number") {
    return parseNumericDate(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  return parseDateToken(value);
}

export function normalizePeriodText(rawValue: string | null | undefined): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const matches = trimmed.match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/g) ?? [];
  if (matches.length >= 2) {
    const start = normalizeDateInput(matches[0]);
    const end = normalizeDateInput(matches[1]);
    if (start && end) {
      return `${start} to ${end}`;
    }
  }

  const singleDate = normalizeDateInput(trimmed);
  return singleDate ?? trimmed.replace(/\s+/g, " ");
}

export function createEpisodeKey(context: {
  episodeDate?: string | null;
  billingPeriod?: string | null;
  episodePeriod?: string | null;
  socDate?: string | null;
}): string {
  const billingStart = context.billingPeriod?.split(" to ")[0] ?? null;
  const episodeStart = context.episodePeriod?.split(" to ")[0] ?? null;

  return (
    context.episodeDate ??
    billingStart ??
    episodeStart ??
    context.socDate ??
    "UNSPECIFIED_EPISODE"
  );
}

export function parseTrackingDays(rawValue: string | number | null | undefined): number | null {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return Math.trunc(rawValue);
  }

  if (typeof rawValue !== "string") {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/-?\d+/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[0], 10);
}
