import { describe, expect, it } from "vitest";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { shouldEvaluatePatient } from "../patient-vetting/shouldEvaluatePatient";

function createWorkItem(overrides?: Partial<PatientEpisodeWorkItem>): PatientEpisodeWorkItem {
  return {
    id: "PATIENT__test",
    subsidiaryId: "default",
    patientIdentity: {
      displayName: "Test Patient",
      normalizedName: "TEST PATIENT",
      medicareNumber: null,
    },
    episodeContext: {
      episodeDate: "2026-04-01",
      socDate: "2026-04-01",
      episodePeriod: null,
      billingPeriod: null,
      payer: "Medicare",
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    timingMetadata: {
      trackingDays: 12,
      daysInPeriod: 15,
      daysLeft: 12,
      daysLeftBeforeOasisDueDate: 12,
      rawTrackingValues: ["12"],
      rawDaysInPeriodValues: ["15"],
      rawDaysLeftValues: ["12"],
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    sourceRemarks: [],
    sourceRowReferences: [{
      workflowTypes: ["SOC"],
      sourceSheet: "OASIS Tracking Report",
      sourceRowNumber: 8,
    }],
    sourceValues: [{
      sourceSheet: "OASIS Tracking Report",
      sourceRowNumber: 8,
      values: {
        patientName: "Test Patient",
        status: null,
      },
    }],
    importWarnings: [],
    ...overrides,
  };
}

describe("shouldEvaluatePatient", () => {
  it("marks non-admit patients as skipped", () => {
    const decision = shouldEvaluatePatient(createWorkItem({
      sourceValues: [{
        sourceSheet: "VISIT NOTES",
        sourceRowNumber: 4,
        values: {
          patientName: "Test Patient",
          status: "Non-Admit",
        },
      }],
    }));

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("non_admit");
  });

  it("marks pending patients as skipped", () => {
    const decision = shouldEvaluatePatient(createWorkItem({
      sourceRemarks: [{
        workflowTypes: ["SOC"],
        sourceSheet: "VISIT NOTES",
        field: "STATUS",
        value: "Pending review",
      }],
    }));

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("pending");
  });

  it("keeps evaluable patients eligible", () => {
    const decision = shouldEvaluatePatient(createWorkItem());

    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBeNull();
  });
});
