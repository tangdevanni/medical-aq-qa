import { mapStageStatus } from "../domain/stageStatus";
import { deriveDcWorkflowTypes } from "../domain/workflowTypes";
import type {
  MappedEpisodeFragment,
  RawDcRow,
} from "../types/patientEpisodeWorkItem";
import {
  createEpisodeKey,
  normalizeDateInput,
  parseTrackingDays,
} from "../utils/dateMath";
import {
  formatPatientName,
  normalizePatientName,
} from "../utils/patientName";

function createRemarks(row: RawDcRow): MappedEpisodeFragment["sourceRemarks"] {
  const workflowTypes = deriveDcWorkflowTypes(row.rfa);
  const remarkEntries: Array<[string, string | null]> = [
    ["OASIS QA REMARKS", row.oasisQaRemarks],
    ["DC SUMMARY", row.dcSummary],
  ];

  return remarkEntries
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([field, value]) => ({
      workflowTypes,
      sourceSheet: row.sourceSheet,
      field,
      value: value!.trim(),
    }));
}

export function mapDcTransferRow(row: RawDcRow): MappedEpisodeFragment {
  const workflowTypes = deriveDcWorkflowTypes(row.rfa);
  const episodeDate = normalizeDateInput(row.episodeDate);
  const trackingDays = parseTrackingDays(row.trackingDays);
  const daysInPeriod = parseTrackingDays(row.daysInPeriod);
  const daysLeft = parseTrackingDays(row.daysLeft ?? row.trackingDays);
  const importWarnings: string[] = [];

  if (row.episodeDate && !episodeDate) {
    importWarnings.push(
      `Invalid episode date in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.episodeDate}`,
    );
  }

  if (row.trackingDays && trackingDays === null) {
    importWarnings.push(
      `Invalid tracking value in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.trackingDays}`,
    );
  }

  if (row.daysInPeriod && daysInPeriod === null) {
    importWarnings.push(
      `Invalid total-day value in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.daysInPeriod}`,
    );
  }

  if (row.daysLeft && daysLeft === null) {
    importWarnings.push(
      `Invalid days-left value in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.daysLeft}`,
    );
  }

  const episodeContext = {
    episodeDate,
    payer: row.payer,
    assignedStaff: row.assignedStaff,
    rfa: row.rfa,
    trackingDays: daysLeft ?? trackingDays,
    daysInPeriod,
    daysLeft,
  };

  return {
    workflowTypes,
    patientDisplayName: formatPatientName(row.patientName),
    patientNormalizedName: normalizePatientName(row.patientName),
    medicareNumber: null,
    episodeKey: createEpisodeKey(episodeContext),
    episodeContext,
    timingMetadata: {
      trackingDays: daysLeft ?? trackingDays,
      daysInPeriod,
      daysLeft,
      rawTrackingValues: row.trackingDays ? [row.trackingDays] : [],
      rawDaysInPeriodValues: row.daysInPeriod ? [row.daysInPeriod] : [],
      rawDaysLeftValues: row.daysLeft ? [row.daysLeft] : [],
    },
    stageStatuses: {
      oasisQaStatus: mapStageStatus(row.oasisQaRemarks),
      billingPrepStatus: mapStageStatus(row.dcSummary),
    },
    sourceRemarks: createRemarks(row),
    sourceRowReferences: [
      {
        workflowTypes,
        sourceSheet: row.sourceSheet,
        sourceRowNumber: row.sourceRowNumber,
      },
    ],
    sourceValues: [
      {
        sourceSheet: row.sourceSheet,
        sourceRowNumber: row.sourceRowNumber,
        values: {
          patientName: row.patientName,
          episodeDate: row.episodeDate,
          assignedStaff: row.assignedStaff,
          payer: row.payer,
          rfa: row.rfa,
          trackingDays: row.trackingDays,
          daysInPeriod: row.daysInPeriod,
          daysLeft: row.daysLeft,
          oasisQaRemarks: row.oasisQaRemarks,
          dcSummary: row.dcSummary,
        },
      },
    ],
    importWarnings,
  };
}
