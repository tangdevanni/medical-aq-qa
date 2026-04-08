import { mapStageStatus } from "../domain/stageStatus";
import type {
  MappedEpisodeFragment,
  RawVisitNotesRow,
} from "../types/patientEpisodeWorkItem";
import {
  createEpisodeKey,
  normalizeDateInput,
  normalizePeriodText,
} from "../utils/dateMath";
import {
  formatPatientName,
  normalizePatientName,
} from "../utils/patientName";

function createRemarks(row: RawVisitNotesRow): MappedEpisodeFragment["sourceRemarks"] {
  const workflowTypes: MappedEpisodeFragment["workflowTypes"] = ["VISIT_NOTES", "BILLING_PREP"];
  const remarkEntries: Array<[string, string | null]> = [
    ["STATUS", row.status],
    ["OASIS QA", row.oasisQa],
    ["OASIS STATUS", row.oasisStatus],
    ["QA", row.qa],
    ["SN", row.sn],
    ["PT/OT/ST", row.ptOtSt],
    ["HHA/MSW", row.hhaMsw],
    ["BILLING STATUS", row.billingStatus],
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

export function mapVisitNotesRow(row: RawVisitNotesRow): MappedEpisodeFragment {
  const workflowTypes: MappedEpisodeFragment["workflowTypes"] = ["VISIT_NOTES", "BILLING_PREP"];
  const socDate = normalizeDateInput(row.socDate);
  const episodePeriod = normalizePeriodText(row.episodePeriod);
  const billingPeriod = normalizePeriodText(row.billingPeriod);
  const importWarnings: string[] = [];

  if (row.socDate && !socDate) {
    importWarnings.push(
      `Invalid SOC date in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.socDate}`,
    );
  }

  const episodeContext = {
    socDate,
    episodePeriod,
    billingPeriod,
    payer: row.payer,
    trackingDays: null,
    daysInPeriod: null,
    daysLeft: null,
  };

  return {
    workflowTypes,
    patientDisplayName: formatPatientName(row.patientName),
    patientNormalizedName: normalizePatientName(row.patientName),
    medicareNumber: row.medicareNumber,
    episodeKey: createEpisodeKey(episodeContext),
    episodeContext,
    stageStatuses: {
      oasisQaStatus: mapStageStatus(row.oasisQa, row.oasisStatus),
      visitNotesQaStatus: mapStageStatus(
        row.status,
        row.qa,
        row.sn,
        row.ptOtSt,
        row.hhaMsw,
      ),
      billingPrepStatus: mapStageStatus(row.billingStatus),
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
          medicareNumber: row.medicareNumber,
          payer: row.payer,
          socDate: row.socDate,
          episodePeriod: row.episodePeriod,
          billingPeriod: row.billingPeriod,
          status: row.status,
          oasisQa: row.oasisQa,
          oasisStatus: row.oasisStatus,
          qa: row.qa,
          sn: row.sn,
          ptOtSt: row.ptOtSt,
          hhaMsw: row.hhaMsw,
          billingStatus: row.billingStatus,
        },
      },
    ],
    importWarnings,
  };
}
