import { describe, expect, it } from "vitest";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "../referralProcessing/fieldContract";

describe("referral field contract", () => {
  it("generates deterministic field buckets from the contract", () => {
    const snapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({
        workItem: {
          id: "patient-1",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Christine Young",
            normalizedName: "CHRISTINE YOUNG",
            medicareNumber: "8A75MN2VE79",
            mrn: null,
          },
          episodeContext: {
            socDate: "02/27/2026",
            episodeDate: "02/27/2026",
            billingPeriod: "02/27/2026 - 03/31/2026",
            episodePeriod: "02/27/2026 - 04/27/2026",
          },
          codingReviewStatus: "NOT_STARTED",
          oasisQaStatus: "IN_PROGRESS",
          pocQaStatus: "NOT_STARTED",
          visitNotesQaStatus: "NOT_STARTED",
          billingPrepStatus: "NOT_STARTED",
          sourceSheets: ["OASIS Tracking Report"],
          assignedStaff: null,
          payer: null,
          rfa: "SOC",
        } as any,
        currentChartValues: {
          preferred_language: "English",
        },
      }),
    });

    expect(snapshot.already_populated_from_chart).toContain("preferred_language");
    expect(snapshot.already_populated_from_chart).toContain("patient_name");
    expect(snapshot.candidate_fields_for_llm_inference_from_referral).toContain("homebound_narrative");
    expect(snapshot.required_human_review_fields).toContain("diagnosis_candidates");
    expect(snapshot.non_fillable_reference_only_fields).toContain("patient_name");
  });
});
