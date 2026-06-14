import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { buildWorkItemFingerprint } from "../utils/workItemFingerprint";

function createWorkItem(overrides: Partial<PatientEpisodeWorkItem> = {}): PatientEpisodeWorkItem {
  return {
    id: "patient-1",
    subsidiaryId: "star-home-health",
    patientIdentity: {
      displayName: "Example Patient",
      normalizedName: "EXAMPLE PATIENT",
      medicareNumber: "1EG4TE5MK73",
    },
    episodeContext: {
      episodeDate: "2026-06-01",
      socDate: "2026-05-15",
      episodePeriod: "2026-06",
      billingPeriod: "2026-06",
      payer: "Medicare",
      assignedStaff: "Nurse A",
      clinician: "Clinician A",
      qaSpecialist: "QA A",
      rfa: "SOC",
    },
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    timingMetadata: {
      trackingDays: 30,
      daysInPeriod: 30,
      daysLeft: 7,
      daysLeftBeforeOasisDueDate: 5,
      rawTrackingValues: ["30"],
      rawDaysInPeriodValues: ["30"],
      rawDaysLeftValues: ["7"],
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    sourceRemarks: [{
      workflowTypes: ["SOC"],
      sourceSheet: "OASIS Tracking Report",
      field: "Diagnosis",
      value: "I50.9",
    }],
    sourceRowReferences: [{
      workflowTypes: ["SOC"],
      sourceSheet: "OASIS Tracking Report",
      sourceRowNumber: 12,
    }],
    sourceValues: [{
      sourceSheet: "OASIS Tracking Report",
      sourceRowNumber: 12,
      values: {
        Patient: "Example Patient",
        Diagnosis: "I50.9",
      },
    }],
    importWarnings: [],
    ...overrides,
  };
}

describe("buildWorkItemFingerprint", () => {
  it("ignores workbook row number noise", () => {
    const base = buildWorkItemFingerprint(createWorkItem());
    const shifted = buildWorkItemFingerprint(createWorkItem({
      sourceRowReferences: [{
        workflowTypes: ["SOC"],
        sourceSheet: "OASIS Tracking Report",
        sourceRowNumber: 99,
      }],
      sourceValues: [{
        sourceSheet: "OASIS Tracking Report",
        sourceRowNumber: 99,
        values: {
          Patient: "Example Patient",
          Diagnosis: "I50.9",
        },
      }],
    }));

    assert.equal(shifted.hash, base.hash);
  });

  it("changes when OASIS-relevant workbook values change", () => {
    const base = buildWorkItemFingerprint(createWorkItem());
    const changed = buildWorkItemFingerprint(createWorkItem({
      sourceValues: [{
        sourceSheet: "OASIS Tracking Report",
        sourceRowNumber: 12,
        values: {
          Patient: "Example Patient",
          Diagnosis: "J18.9",
        },
      }],
    }));

    assert.notEqual(changed.hash, base.hash);
    assert.notEqual(changed.componentHashes.oasis, base.componentHashes.oasis);
  });
});
