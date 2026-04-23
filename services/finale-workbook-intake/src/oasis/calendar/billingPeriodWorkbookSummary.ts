import type {
  BillingPeriodWorkbookColumns,
  NormalizedCalendarCard,
} from "../types/billingPeriodCalendarSummary";

type DisciplineCode = "SN" | "PT" | "OT" | "ST" | "HHA" | "MSW";
type DisciplineGroupKey = "sn" | "ptOtSt" | "hhaMsw";
type CardAlertType =
  | "not_started"
  | "unassigned"
  | "nyd"
  | "signed_but_empty"
  | "validated"
  | "eval_order";

type CardAlert = {
  type: CardAlertType;
  discipline: DisciplineCode | null;
  date: string | null;
};

type DisciplineBucket = {
  counts: Record<DisciplineCode, number>;
  missedVisits: number;
  alerts: CardAlert[];
};

const DISCIPLINE_ORDER: DisciplineCode[] = ["SN", "PT", "OT", "ST", "HHA", "MSW"];

export function buildBillingPeriodWorkbookColumns(
  cards: NormalizedCalendarCard[],
): BillingPeriodWorkbookColumns {
  const buckets: Record<DisciplineGroupKey, DisciplineBucket> = {
    sn: createDisciplineBucket(),
    ptOtSt: createDisciplineBucket(),
    hhaMsw: createDisciplineBucket(),
  };

  for (const card of cards) {
    const discipline = inferDiscipline(card);
    if (!discipline) {
      continue;
    }
    const groupKey = getDisciplineGroupKey(discipline);
    if (!groupKey) {
      continue;
    }

    const alert = inferCardAlert(card, discipline);
    if (card.eventType === "missed_visit") {
      buckets[groupKey].missedVisits += 1;
      if (alert) {
        buckets[groupKey].alerts.push(alert);
      }
      continue;
    }

    if (isCountableVisit(card, discipline, alert)) {
      buckets[groupKey].counts[discipline] += 1;
    }

    if (alert) {
      buckets[groupKey].alerts.push(alert);
    }
  }

  return {
    sn: formatBucketSummary(buckets.sn, ["SN"]),
    ptOtSt: formatBucketSummary(buckets.ptOtSt, ["PT", "OT", "ST"]),
    hhaMsw: formatBucketSummary(buckets.hhaMsw, ["HHA", "MSW"]),
  };
}

function createDisciplineBucket(): DisciplineBucket {
  return {
    counts: {
      SN: 0,
      PT: 0,
      OT: 0,
      ST: 0,
      HHA: 0,
      MSW: 0,
    },
    missedVisits: 0,
    alerts: [],
  };
}

function formatBucketSummary(
  bucket: DisciplineBucket,
  disciplines: DisciplineCode[],
): string {
  const summaryParts = disciplines
    .filter((discipline) => bucket.counts[discipline] > 0)
    .map((discipline) => `${discipline} - ${bucket.counts[discipline]}`);

  if (bucket.missedVisits > 0) {
    summaryParts.push(`${disciplines.length === 1 && summaryParts.length === 0 ? `${disciplines[0]} ` : ""}MV - ${bucket.missedVisits}`);
  }

  const alertLines = formatAlertLines(bucket.alerts, disciplines);
  if (summaryParts.length === 0 && alertLines.length === 0) {
    return "NA";
  }

  if (summaryParts.length === 0) {
    return alertLines.join("\n");
  }

  if (alertLines.length === 0) {
    return summaryParts.join(", ");
  }

  return `${summaryParts.join(", ")}\n${alertLines.join("\n")}`;
}

function formatAlertLines(
  alerts: CardAlert[],
  disciplines: DisciplineCode[],
): string[] {
  const lines: string[] = [];
  const groupedByType = new Map<CardAlertType, CardAlert[]>();
  for (const alert of alerts) {
    const current = groupedByType.get(alert.type) ?? [];
    current.push(alert);
    groupedByType.set(alert.type, current);
  }

  const notStartedLine = formatDateAlertLine(groupedByType.get("not_started") ?? [], disciplines, {
    singleDisciplinePrefix: {
      SN: "SNV",
      PT: "PTV",
      OT: "OTV",
      ST: "STV",
      HHA: "HHA visit",
      MSW: "MSW visit",
    },
    multiDisciplineLabel: "visits",
    suffix: "not started",
  });
  if (notStartedLine) {
    lines.push(notStartedLine);
  }

  const unassignedLine = formatDateAlertLine(groupedByType.get("unassigned") ?? [], disciplines, {
    singleDisciplinePrefix: {
      SN: "SN visit",
      PT: "PT visit",
      OT: "OT visit",
      ST: "ST visit",
      HHA: "visits",
      MSW: "visits",
    },
    multiDisciplineLabel: "visits",
    suffix: "unassigned",
  });
  if (unassignedLine) {
    lines.push(unassignedLine);
  }

  const nydLine = formatDateAlertLine(groupedByType.get("nyd") ?? [], disciplines, {
    singleDisciplinePrefix: {
      SN: "SNV",
      PT: "PT visit",
      OT: "OT visit",
      ST: "ST visit",
      HHA: "HHA visit",
      MSW: "MSW visit",
    },
    multiDisciplineLabel: "visits",
    suffix: "NYD",
  });
  if (nydLine) {
    lines.push(nydLine);
  }

  lines.push(
    ...formatIndividualAlertLines(groupedByType.get("signed_but_empty") ?? [], "signed but empty"),
  );
  lines.push(
    ...formatIndividualAlertLines(groupedByType.get("validated") ?? [], "validated", ": "),
  );
  lines.push(...formatEvalOrderLines(groupedByType.get("eval_order") ?? []));

  return dedupeLines(lines);
}

function formatDateAlertLine(
  alerts: CardAlert[],
  disciplines: DisciplineCode[],
  options: {
    singleDisciplinePrefix: Record<DisciplineCode, string>;
    multiDisciplineLabel: string;
    suffix: string;
  },
): string | null {
  if (alerts.length === 0) {
    return null;
  }

  const dateLabels = dedupeLines(
    alerts
      .map((alert) => formatCalendarShortDate(alert.date))
      .filter((value): value is string => Boolean(value)),
  );

  if (dateLabels.length === 0) {
    return `${options.multiDisciplineLabel} ${options.suffix === "NYD" ? "not yet determined" : options.suffix}`;
  }

  const disciplinesInAlerts = dedupeDisciplines(alerts);
  const prefix = disciplinesInAlerts.length === 1
    ? options.singleDisciplinePrefix[disciplinesInAlerts[0]!]
    : options.multiDisciplineLabel;

  return `${prefix} ${dateLabels.join(", ")} - ${options.suffix}`;
}

function formatIndividualAlertLines(
  alerts: CardAlert[],
  suffix: string,
  joiner = " - ",
): string[] {
  return alerts
    .map((alert) => {
      const discipline = alert.discipline ? `${alert.discipline} visit` : "visit";
      const dateLabel = formatCalendarShortDate(alert.date);
      if (!dateLabel) {
        return `${discipline}${joiner}${suffix}`;
      }
      return `${discipline} ${dateLabel}${joiner}${suffix}`;
    });
}

function formatEvalOrderLines(alerts: CardAlert[]): string[] {
  return alerts.map((alert) => {
    const discipline = alert.discipline ?? "visit";
    const dateLabel = formatCalendarShortDate(alert.date);
    return `${discipline} Eval Order${dateLabel ? ` ${dateLabel}` : ""}`;
  });
}

function isCountableVisit(
  card: NormalizedCalendarCard,
  discipline: DisciplineCode,
  alert: CardAlert | null,
): boolean {
  if (!["sn_visit", "pt_visit", "ot_visit", "st_visit", "hha_visit", "msw_visit"].includes(card.eventType)) {
    return false;
  }

  if (!DISCIPLINE_ORDER.includes(discipline)) {
    return false;
  }

  if (!alert) {
    return true;
  }

  return alert.type === "validated";
}

function inferCardAlert(
  card: NormalizedCalendarCard,
  discipline: DisciplineCode | null,
): CardAlert | null {
  const haystack = normalizeWhitespace([card.title, card.rawText, card.statusLabel].filter(Boolean).join(" "));
  if (!haystack) {
    return null;
  }

  if (/\bnot started\b/i.test(haystack)) {
    return {
      type: "not_started",
      discipline,
      date: card.date,
    };
  }

  if (/\bunassigned\b/i.test(haystack)) {
    return {
      type: "unassigned",
      discipline,
      date: card.date,
    };
  }

  if (/\bnyd\b/i.test(haystack)) {
    return {
      type: "nyd",
      discipline,
      date: card.date,
    };
  }

  if (/\bsigned but empty\b/i.test(haystack)) {
    return {
      type: "signed_but_empty",
      discipline,
      date: card.date,
    };
  }

  if (/\bvalidated\b/i.test(haystack)) {
    return {
      type: "validated",
      discipline,
      date: card.date,
    };
  }

  if (/\beval order\b/i.test(haystack) || (card.eventType === "evaluation" && discipline !== null)) {
    return {
      type: "eval_order",
      discipline,
      date: card.date,
    };
  }

  return null;
}

function inferDiscipline(card: NormalizedCalendarCard): DisciplineCode | null {
  const haystack = normalizeWhitespace([card.title, card.rawText].filter(Boolean).join(" "));
  switch (card.eventType) {
    case "sn_visit":
      return "SN";
    case "pt_visit":
      return "PT";
    case "ot_visit":
      return "OT";
    case "st_visit":
      return "ST";
    case "hha_visit":
      return "HHA";
    case "msw_visit":
      return "MSW";
    default:
      return inferDisciplineFromText(haystack);
  }
}

function inferDisciplineFromText(value: string): DisciplineCode | null {
  const haystack = value.toUpperCase();
  if (!haystack) {
    return null;
  }
  if (/\b(?:SN|RN|LVN|LPN)\b/.test(haystack)) {
    return "SN";
  }
  if (/\bPT\b/.test(haystack)) {
    return "PT";
  }
  if (/\bOT\b/.test(haystack)) {
    return "OT";
  }
  if (/\b(?:ST|SLP)\b/.test(haystack)) {
    return "ST";
  }
  if (/\bHHA\b/.test(haystack)) {
    return "HHA";
  }
  if (/\b(?:MSW|SOCIAL WORK)\b/.test(haystack)) {
    return "MSW";
  }
  return null;
}

function getDisciplineGroupKey(
  discipline: DisciplineCode | null,
): DisciplineGroupKey | null {
  switch (discipline) {
    case "SN":
      return "sn";
    case "PT":
    case "OT":
    case "ST":
      return "ptOtSt";
    case "HHA":
    case "MSW":
      return "hhaMsw";
    default:
      return null;
  }
}

function dedupeDisciplines(alerts: CardAlert[]): DisciplineCode[] {
  return dedupeLines(
    alerts
      .map((alert) => alert.discipline)
      .filter((discipline): discipline is DisciplineCode => discipline !== null),
  ) as DisciplineCode[];
}

function formatCalendarShortDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) {
    return value;
  }

  const month = String(Number(isoMatch[2]));
  const day = String(Number(isoMatch[3]));
  return `${month}/${day}`;
}

function dedupeLines(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
