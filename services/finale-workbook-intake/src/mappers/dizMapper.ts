import { mapStageStatus } from "../domain/stageStatus";
import type {
  MappedEpisodeFragment,
  RawDizRow,
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

function createRemarks(row: RawDizRow): MappedEpisodeFragment["sourceRemarks"] {
  const workflowTypes: MappedEpisodeFragment["workflowTypes"] = ["BILLING_PREP"];
  const remarkEntries: Array<[string, string | null]> = [
    ["SN", row.sn],
    ["REHAB", row.rehab],
    ["HHA AND MSW", row.hhaAndMsw],
    ["PO AND ORDER", row.poAndOrder],
    ["STATUS", row.status],
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

export function mapDizRow(row: RawDizRow): MappedEpisodeFragment {
  const workflowTypes: MappedEpisodeFragment["workflowTypes"] = ["BILLING_PREP"];
  const episodeDate = normalizeDateInput(row.episodeDateOrBillingPeriod);
  const billingPeriod = episodeDate
    ? null
    : normalizePeriodText(row.episodeDateOrBillingPeriod);
  const importWarnings: string[] = [];

  if (row.episodeDateOrBillingPeriod && !episodeDate && !billingPeriod) {
    importWarnings.push(
      `Invalid DIZ period value in ${row.sourceSheet} row ${row.sourceRowNumber}: ${row.episodeDateOrBillingPeriod}`,
    );
  }

  const episodeContext = {
    episodeDate,
    billingPeriod,
    clinician: row.clinician,
    qaSpecialist: row.qaSpecialist,
    trackingDays: null,
  };

  return {
    workflowTypes,
    patientDisplayName: formatPatientName(row.patientName),
    patientNormalizedName: normalizePatientName(row.patientName),
    medicareNumber: null,
    episodeKey: createEpisodeKey(episodeContext),
    episodeContext,
    stageStatuses: {
      visitNotesQaStatus: mapStageStatus(row.sn, row.rehab, row.hhaAndMsw),
      billingPrepStatus: mapStageStatus(row.poAndOrder, row.status),
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
          episodeDateOrBillingPeriod: row.episodeDateOrBillingPeriod,
          clinician: row.clinician,
          qaSpecialist: row.qaSpecialist,
          sn: row.sn,
          rehab: row.rehab,
          hhaAndMsw: row.hhaAndMsw,
          poAndOrder: row.poAndOrder,
          status: row.status,
        },
      },
    ],
    importWarnings,
  };
}
