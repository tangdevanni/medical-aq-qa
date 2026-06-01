import type { PatientMatchResult } from "./batch-pipeline";
import type { PatientEpisodeWorkItem } from "./patient-episode-work-item";

export type PortalPatientLookupContext = {
  socDate: string | null;
  dob: string | null;
  dischargeDate: string | null;
  lengthOfStayDays: number | null;
  daysInEpisode: number | null;
  daysLeftBeforeOasisDueDate: number | null;
  sourceText: string;
};

const OASIS_DUE_DAY = 30;

function normalizeLookupDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, "0");
    const day = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${month}-${day}`;
  }
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return trimmed;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseDateOnly(value: string | null | undefined): Date | null {
  const normalized = normalizeLookupDate(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(startDate: string | null, endDate: Date): number | null {
  const start = parseDateOnly(startDate);
  if (!start) {
    return null;
  }
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function captureDate(text: string, labelPattern: string): string | null {
  const match = text.match(new RegExp(`\\b${labelPattern}\\s*:\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})`, "i"));
  return normalizeLookupDate(match?.[1]);
}

function captureLengthOfStay(text: string): number | null {
  const match = text.match(/\bLOS\s*:\s*(\d+)\s*days?\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function extractPortalPatientLookupContext(
  matchResult: PatientMatchResult | null | undefined,
  now = new Date(),
): PortalPatientLookupContext | null {
  const sourceText = [
    matchResult?.portalDisplayName,
    ...(matchResult?.candidateNames ?? []),
  ].find((candidate): candidate is string => typeof candidate === "string" && /\bSOC\s*:/i.test(candidate));

  if (!sourceText) {
    return null;
  }

  const socDate = captureDate(sourceText, "SOC(?:\\s*Date)?");
  const dob = captureDate(sourceText, "DOB");
  const dischargeDate = captureDate(sourceText, "DC");
  const lengthOfStayDays = captureLengthOfStay(sourceText);
  const daysInEpisode = lengthOfStayDays ?? daysBetween(socDate, now);
  const daysLeftBeforeOasisDueDate = daysInEpisode === null ? null : OASIS_DUE_DAY - daysInEpisode;

  return {
    socDate,
    dob,
    dischargeDate,
    lengthOfStayDays,
    daysInEpisode,
    daysLeftBeforeOasisDueDate,
    sourceText,
  };
}

export function hydrateWorkItemWithPortalLookupContext(
  workItem: PatientEpisodeWorkItem | null | undefined,
  matchResult: PatientMatchResult | null | undefined,
  now = new Date(),
): PatientEpisodeWorkItem | null {
  if (!workItem) {
    return null;
  }

  const lookupContext = extractPortalPatientLookupContext(matchResult, now);
  if (!lookupContext) {
    return workItem;
  }

  return {
    ...workItem,
    episodeContext: {
      ...workItem.episodeContext,
      socDate: workItem.episodeContext.socDate ?? lookupContext.socDate,
    },
    timingMetadata: {
      trackingDays: workItem.timingMetadata?.trackingDays ?? lookupContext.daysInEpisode,
      daysInPeriod: workItem.timingMetadata?.daysInPeriod ?? lookupContext.daysInEpisode,
      daysLeft: workItem.timingMetadata?.daysLeft ?? lookupContext.daysLeftBeforeOasisDueDate,
      daysLeftBeforeOasisDueDate:
        workItem.timingMetadata?.daysLeftBeforeOasisDueDate ?? lookupContext.daysLeftBeforeOasisDueDate,
      rawTrackingValues: [
        ...(workItem.timingMetadata?.rawTrackingValues ?? []),
        ...(lookupContext.sourceText ? [`portal_lookup:${lookupContext.sourceText}`] : []),
      ],
      rawDaysInPeriodValues: [
        ...(workItem.timingMetadata?.rawDaysInPeriodValues ?? []),
        ...(lookupContext.daysInEpisode !== null ? [`portal_lookup_los:${lookupContext.daysInEpisode}`] : []),
      ],
      rawDaysLeftValues: [
        ...(workItem.timingMetadata?.rawDaysLeftValues ?? []),
        ...(lookupContext.daysLeftBeforeOasisDueDate !== null
          ? [`portal_lookup_oasis_days_left:${lookupContext.daysLeftBeforeOasisDueDate}`]
          : []),
      ],
    },
  };
}
