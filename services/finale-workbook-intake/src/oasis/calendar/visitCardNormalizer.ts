import type {
  BillingPeriodBucket,
  CalendarEventType,
  NormalizedCalendarCard,
} from "../types/billingPeriodCalendarSummary";

export interface NormalizeVisitCardInput {
  rawText: string;
  title?: string | null;
  date?: string | null;
  billingPeriod?: BillingPeriodBucket;
}

export function normalizeCalendarCard(input: NormalizeVisitCardInput): NormalizedCalendarCard {
  const rawText = normalizeWhitespace(input.rawText);
  const title = normalizeWhitespace(input.title) || extractTitle(rawText);
  const haystack = normalizeWhitespace([title, rawText].filter(Boolean).join(" "));

  return {
    rawText,
    title,
    eventType: classifyCalendarEventType(haystack),
    date: input.date ?? null,
    billingPeriod: input.billingPeriod ?? "unknown",
    timeLabel: extractTimeLabel(rawText),
    clinician: extractClinician(rawText),
    statusLabel: extractStatusLabel(rawText),
  };
}

export function classifyCalendarEventType(value: string): CalendarEventType {
  const haystack = normalizeWhitespace(value);
  const matchers: Array<[RegExp, CalendarEventType]> = [
    [/\badmission\s+order\b/i, "admission_order"],
    [/\bphys(?:ician)?\.?\s*order\b|\border\b/i, "physician_order"],
    [/\bcommunication\s+note\b|\bcomm\s*note\b|\bcn\b/i, "communication_note"],
    [/\bmissed\s+visit\b|\bmissed\b/i, "missed_visit"],
    [/\btransfer\b/i, "transfer"],
    [/\beval(?:uation)?\b|\breassessment\b/i, "evaluation"],
    [/\b(?:sn|rn|lvn|lpn)(?:\s+regular)?\s+visit\b|\bregular\s+visit\b.*\b(?:sn|rn|lvn|lpn)\b|\b(?:sn|rn|lvn|lpn)\b.*\bvisit\b/i, "sn_visit"],
    [/\bpt\s+visit\b/i, "pt_visit"],
    [/\b(?:st|slp)\s+visit\b/i, "st_visit"],
    [/\bot\s+visit\b/i, "ot_visit"],
    [/\bhha\b.*\bvisit\b|\bvisit\b.*\bhha\b/i, "hha_visit"],
    [/\b(?:msw|social\s+work(?:er)?)\b.*\bvisit\b|\bvisit\b.*\b(?:msw|social\s+work(?:er)?)\b/i, "msw_visit"],
    [/\boasis\b|\bstart of care\b|\brecert(?:ification)?\b|\broc\b/i, "oasis"],
  ];

  return matchers.find(([pattern]) => pattern.test(haystack))?.[1] ?? "other";
}

function extractTitle(rawText: string): string | null {
  return rawText.split(/\s{2,}|\n+/).map((part) => normalizeWhitespace(part)).find(Boolean) ?? null;
}

function extractTimeLabel(value: string): string | null {
  return value.match(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/)?.[0] ??
    value.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*-\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i)?.[0] ??
    value.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i)?.[0] ??
    null;
}

function extractClinician(value: string): string | null {
  return value.match(/\b[A-Z][A-Za-z'-]+,\s*[A-Z](?:\.)?(?:\s+[A-Z](?:\.)?)?\s+(?:PT|OT|RN|LPN|LVN|SLP|ST|SN|HHA|MSW)\b/i)?.[0] ??
    value.match(/\b[A-Z][A-Za-z'-]+,\s*[A-Z](?:\.)?\s+(?:PT|OT|RN|LPN|LVN|SLP|ST|SN|HHA|MSW)\b/i)?.[0] ??
    null;
}

function extractStatusLabel(value: string): string | null {
  const matches = value.match(/\b(?:validated|exported|locked|signed|completed|cancelled|pending|missed)\b/gi) ?? [];
  return matches.length > 0 ? [...new Set(matches.map((entry) => normalizeWhitespace(entry)))].join(", ") : null;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
