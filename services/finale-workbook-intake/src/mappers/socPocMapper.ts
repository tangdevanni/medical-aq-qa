import { mapStageStatus } from "../domain/stageStatus";
import { deriveSocWorkflowTypes } from "../domain/workflowTypes";
import type {
  MappedEpisodeFragment,
  RawSocPocRow,
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

function createRemarks(row: RawSocPocRow): MappedEpisodeFragment["sourceRemarks"] {
  const workflowTypes = deriveSocWorkflowTypes(row.rfa);
  const remarkEntries: Array<[string, string | null]> = [
    ["CODING", row.coding],
    ["OASIS QA REMARKS", row.oasisQaRemarks],
    ["POC QA REMARKS", row.pocQaRemarks],
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

export function mapSocPocRow(row: RawSocPocRow): MappedEpisodeFragment {
  const workflowTypes = deriveSocWorkflowTypes(row.rfa);
  const episodeDate = normalizeDateInput(row.episodeDate);
  const trackingDays = parseTrackingDays(row.trackingDays);
  const daysInPeriod = parseTrackingDays(row.daysInPeriod);
  const daysLeftBeforeOasisDueDate = parseTrackingDays(row.daysLeft ?? row.trackingDays);
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

  if (row.daysLeft && daysLeftBeforeOasisDueDate === null) {
    importWarnings.push(
      `Invalid days-left value in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.daysLeft}`,
    );
  }

  const episodeContext = {
    episodeDate,
    payer: row.payer,
    assignedStaff: row.assignedStaff,
    rfa: row.rfa,
    trackingDays: daysLeftBeforeOasisDueDate ?? trackingDays,
    daysInPeriod,
    daysLeft: daysLeftBeforeOasisDueDate,
  };

  return {
    workflowTypes,
    patientDisplayName: formatPatientName(row.patientName),
    patientNormalizedName: normalizePatientName(row.patientName),
    medicareNumber: null,
    episodeKey: createEpisodeKey(episodeContext),
    episodeContext,
    timingMetadata: {
      trackingDays: daysLeftBeforeOasisDueDate ?? trackingDays,
      daysInPeriod,
      daysLeft: daysLeftBeforeOasisDueDate,
      daysLeftBeforeOasisDueDate,
      rawTrackingValues: row.trackingDays ? [row.trackingDays] : [],
      rawDaysInPeriodValues: row.daysInPeriod ? [row.daysInPeriod] : [],
      rawDaysLeftValues: row.daysLeft ? [row.daysLeft] : [],
    },
    stageStatuses: {
      codingReviewStatus: mapStageStatus(row.coding),
      oasisQaStatus: mapStageStatus(row.oasisQaRemarks),
      pocQaStatus: mapStageStatus(row.pocQaRemarks),
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
          coding: row.coding,
          oasisQaRemarks: row.oasisQaRemarks,
          pocQaRemarks: row.pocQaRemarks,
        },
      },
    ],
    importWarnings,
  };
}
