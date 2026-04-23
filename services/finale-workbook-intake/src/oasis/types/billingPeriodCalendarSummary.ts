export type BillingPeriodBucket = "first30" | "second30" | "outside" | "unknown";

export type CalendarEventType =
  | "oasis"
  | "pt_visit"
  | "st_visit"
  | "ot_visit"
  | "sn_visit"
  | "hha_visit"
  | "msw_visit"
  | "physician_order"
  | "communication_note"
  | "admission_order"
  | "transfer"
  | "evaluation"
  | "missed_visit"
  | "other";

export interface NormalizedCalendarCard {
  rawText: string;
  title: string | null;
  eventType: CalendarEventType;
  date: string | null;
  billingPeriod: BillingPeriodBucket;
  timeLabel?: string | null;
  clinician?: string | null;
  statusLabel?: string | null;
}

export interface BillingPeriodWorkbookColumns {
  sn: string;
  ptOtSt: string;
  hhaMsw: string;
}

export interface CalendarDaySnapshot {
  date: string | null;
  rawDateLabel: string | null;
  weekLabel?: string | null;
  billingPeriod: BillingPeriodBucket;
  visualPeriodHint?: "green" | "blue" | "other" | "unknown";
  cards: NormalizedCalendarCard[];
  warnings: string[];
}

export interface BillingPeriodCardGroup {
  startDate: string | null;
  endDate: string | null;
  totalCards: number;
  countsByType: Record<string, number>;
  cards: NormalizedCalendarCard[];
  workbookColumns: BillingPeriodWorkbookColumns;
}

export interface BillingPeriodCalendarSummary {
  selectedEpisode: {
    rawLabel: string;
    startDate: string | null;
    endDate: string | null;
  };
  periods: {
    first30Days: BillingPeriodCardGroup;
    second30Days: BillingPeriodCardGroup;
    outsideRange: Omit<BillingPeriodCardGroup, "startDate" | "endDate"> & {
      startDate: null;
      endDate: null;
    };
  };
  visibleDays: CalendarDaySnapshot[];
  warnings: string[];
}
