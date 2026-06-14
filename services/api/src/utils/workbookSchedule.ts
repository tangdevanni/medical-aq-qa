const MANILA_UTC_OFFSET_HOURS = 8;
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type WeekdayName = (typeof DAY_NAMES)[number];

export const DEFAULT_WORKBOOK_INTAKE_DAY: WeekdayName = "Sunday";
export const DEFAULT_WORKBOOK_INTAKE_LOCAL_TIME = "20:30";
export const DEFAULT_DELTA_RUN_WEEKDAYS: WeekdayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

export function parseWeekdayName(value: string): WeekdayName {
  const normalized = value.trim().toLowerCase();
  const day = DAY_NAMES.find((candidate) => candidate.toLowerCase() === normalized);
  if (!day) {
    throw new Error(`Invalid weekday: ${value}.`);
  }
  return day;
}

export function parseWeekdayList(value: string): WeekdayName[] {
  const days = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseWeekdayName);
  if (days.length === 0) {
    throw new Error("At least one weekday is required.");
  }
  return Array.from(new Set(days));
}

function parseLocalTime(localTime: string): { hour: number; minute: number } {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    throw new Error(`Invalid schedule local time: ${localTime}. Expected HH:mm.`);
  }
  const [hourText, minuteText] = localTime.split(":");
  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}

function formatManilaDateParts(value: Date): {
  year: number;
  month: number;
  day: number;
  weekday: WeekdayName;
} {
  const manila = new Date(value.getTime() + MANILA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: manila.getUTCFullYear(),
    month: manila.getUTCMonth() + 1,
    day: manila.getUTCDate(),
    weekday: DAY_NAMES[manila.getUTCDay()],
  };
}

function buildManilaUtcCandidate(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): Date {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour - MANILA_UTC_OFFSET_HOURS,
    parts.minute,
    0,
    0,
  ));
}

function nextManilaCandidate(input: {
  fromIsoTimestamp: string;
  weekdays: readonly WeekdayName[];
  localTimes: readonly string[];
}): string {
  const from = new Date(input.fromIsoTimestamp);
  const base = formatManilaDateParts(from);
  const allowedWeekdays = new Set(input.weekdays);

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const candidateDate = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset, 0, 0, 0, 0));
    const dateParts = formatManilaDateParts(candidateDate);
    if (!allowedWeekdays.has(dateParts.weekday)) {
      continue;
    }

    const candidates = input.localTimes
      .map((localTime) => {
        const { hour, minute } = parseLocalTime(localTime);
        return buildManilaUtcCandidate({
          year: dateParts.year,
          month: dateParts.month,
          day: dateParts.day,
          hour,
          minute,
        });
      })
      .sort((left, right) => left.getTime() - right.getTime());

    const next = candidates.find((candidate) => candidate.getTime() > from.getTime());
    if (next) {
      return next.toISOString();
    }
  }

  return new Date(Date.parse(input.fromIsoTimestamp) + 24 * 60 * 60 * 1000).toISOString();
}

export function calculateNextWorkbookIntakeAt(input: {
  fromIsoTimestamp: string;
  timezone: string;
  weekday: WeekdayName;
  localTime: string;
}): string {
  if (input.timezone !== "Asia/Manila") {
    return new Date(Date.parse(input.fromIsoTimestamp) + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  return nextManilaCandidate({
    fromIsoTimestamp: input.fromIsoTimestamp,
    weekdays: [input.weekday],
    localTimes: [input.localTime],
  });
}

export function calculateNextWeekdayDeltaRunAt(input: {
  fromIsoTimestamp: string;
  timezone: string;
  weekdays: readonly WeekdayName[];
  localTimes: readonly string[];
  intervalHours: number;
}): string {
  if (input.timezone !== "Asia/Manila") {
    return new Date(Date.parse(input.fromIsoTimestamp) + input.intervalHours * 60 * 60 * 1000).toISOString();
  }
  return nextManilaCandidate({
    fromIsoTimestamp: input.fromIsoTimestamp,
    weekdays: input.weekdays,
    localTimes: input.localTimes,
  });
}

export function earliestTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  const parsed = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((left, right) => left.time - right.time);
  return parsed[0]?.value ?? null;
}
