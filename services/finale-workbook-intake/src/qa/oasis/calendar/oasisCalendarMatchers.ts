import { normalizeQaComparable, normalizeQaWhitespace } from "../../shared/textNormalization";
import type { OasisCalendarTile, RawOasisCalendarTileInput } from "./oasisCalendarTypes";

const OASIS_MATCHERS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\boasis\b/i, reason: "text contains OASIS" },
  { pattern: /\bpt\s*-\s*soc\s*oasis\b/i, reason: "text contains PT - SOC OASIS" },
  { pattern: /\bstart of care\b/i, reason: "text contains Start of Care" },
  { pattern: /\btransfer\b/i, reason: "text contains Transfer" },
  { pattern: /\broc\b/i, reason: "text contains ROC" },
  { pattern: /\brecert(?:ification)?\b/i, reason: "text contains Recert/Recertification" },
  { pattern: /\bdischarge\b/i, reason: "text contains Discharge" },
  { pattern: /\boasis validated\b/i, reason: "tooltip/status contains OASIS Validated" },
  { pattern: /\boasis exported\b/i, reason: "tooltip/status contains OASIS Exported" },
  { pattern: /\boasis locked\b/i, reason: "tooltip/status contains OASIS Locked" },
  { pattern: /\boasis signed\b/i, reason: "tooltip/status contains OASIS signed" },
  { pattern: /\bprint preview oasis\b/i, reason: "tooltip contains Print Preview OASIS" },
];

function detectTimeText(value: string): string | undefined {
  return value.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i)?.[0];
}

function detectStaffText(value: string): string | undefined {
  return value.match(/\b[A-Z][A-Za-z'-]+,\s*[A-Z](?:\.)?(?:\s+[A-Z](?:\.)?)?\s+(?:PT|OT|RN|LPN|LVN|SLP|ST|SN|HHA|MSW)\b/i)?.[0];
}

function detectStatusText(value: string): string | undefined {
  const statuses = value.match(/\b(?:validated|exported|locked|signed|completed|cancelled|missed|pending)\b/gi) ?? [];
  if (statuses.length === 0) {
    return undefined;
  }

  return [...new Set(statuses.map((entry) => normalizeQaWhitespace(entry)))].join(", ");
}

function deriveTitle(input: RawOasisCalendarTileInput): string {
  const normalizedTitle = normalizeQaWhitespace(input.titleText);
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const sources = [
    ...input.tooltipTitles,
    input.rawText,
  ].map((entry) => normalizeQaWhitespace(entry));

  for (const source of sources) {
    const matchedReason = OASIS_MATCHERS.find((matcher) => matcher.pattern.test(source));
    if (matchedReason) {
      const reasonText = source.match(matchedReason.pattern)?.[0];
      if (reasonText) {
        return normalizeQaWhitespace(reasonText);
      }
    }
  }

  return normalizeQaWhitespace(input.rawText).slice(0, 120) || "Untitled calendar event";
}

export function classifyOasisCalendarTile(input: RawOasisCalendarTileInput): Pick<OasisCalendarTile, "oasisMatch" | "oasisReason"> {
  const haystacks = [
    normalizeQaWhitespace(input.titleText),
    normalizeQaWhitespace(input.rawText),
    ...input.tooltipTitles.map((entry) => normalizeQaWhitespace(entry)),
    ...input.attributeSummary.map((entry) => normalizeQaWhitespace(entry)),
  ].filter(Boolean);

  for (const haystack of haystacks) {
    for (const matcher of OASIS_MATCHERS) {
      if (matcher.pattern.test(haystack)) {
        return {
          oasisMatch: true,
          oasisReason: matcher.reason,
        };
      }
    }
  }

  return {
    oasisMatch: false,
    oasisReason: undefined,
  };
}

export function buildOasisCalendarTile(input: RawOasisCalendarTileInput): OasisCalendarTile {
  const normalizedRawText = normalizeQaWhitespace(input.rawText);
  const subtitle = normalizeQaComparable(normalizedRawText) !== normalizeQaComparable(input.titleText)
    ? normalizeQaWhitespace(input.titleText)
    : undefined;
  const classification = classifyOasisCalendarTile(input);

  return {
    title: deriveTitle(input),
    subtitle: subtitle || undefined,
    staffText: detectStaffText(normalizedRawText),
    timeText: detectTimeText(normalizedRawText),
    statusText: detectStatusText(`${normalizedRawText} ${input.tooltipTitles.join(" ")}`),
    rawText: normalizedRawText,
    tooltipTitles: input.tooltipTitles.map((entry) => normalizeQaWhitespace(entry)).filter(Boolean),
    titleAttributes: input.titleAttributes.map((entry) => normalizeQaWhitespace(entry)).filter(Boolean),
    href: input.href,
    attributeSummary: input.attributeSummary.map((entry) => normalizeQaWhitespace(entry)).filter(Boolean),
    selectorFamily: input.selectorFamily,
    classNames: input.classNames?.map((entry) => normalizeQaWhitespace(entry)).filter(Boolean),
    dateLabel: normalizeQaWhitespace(input.dateLabel) || undefined,
    normalizedDate: normalizeQaWhitespace(input.dateLabel) || undefined,
    oasisMatch: classification.oasisMatch,
    oasisReason: classification.oasisReason,
  };
}
