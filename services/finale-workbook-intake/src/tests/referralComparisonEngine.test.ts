import { describe, expect, it } from "vitest";
import { compareProposedFieldsAgainstChart } from "../referralProcessing/comparisonEngine";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "../referralProcessing/fieldContract";

describe("compareProposedFieldsAgainstChart", () => {
  it("marks missing chart values and conflicts deterministically", () => {
    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({
        workItem: {
          id: "patient-1",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Christine Young",
            normalizedName: "CHRISTINE YOUNG",
            medicareNumber: null,
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
          caregiver_name: "Emily Young",
        },
      }),
    });

    const comparisons = compareProposedFieldsAgainstChart({
      fieldMapSnapshot,
      proposals: [
        {
          field_key: "preferred_language",
          proposed_value: "English",
          confidence: 0.95,
          source_spans: ["Preferred Language: English"],
          rationale: "Explicitly stated in referral.",
          requires_human_review: false,
        },
        {
          field_key: "caregiver_name",
          proposed_value: "Emma Young",
          confidence: 0.76,
          source_spans: ["Primary Caregiver: Emma Young"],
          rationale: "Extracted from caregiver section.",
          requires_human_review: false,
        },
        {
          field_key: "homebound_narrative",
          proposed_value: "Uses walker and leaving home is exhausting.",
          confidence: 0.81,
          source_spans: ["Uses walker and leaving home is exhausting."],
          rationale: "Summarized from homebound section.",
          requires_human_review: true,
        },
      ],
      diagnosisCandidates: [],
    });

    expect(comparisons.find((result) => result.field_key === "preferred_language")?.comparison_status).toBe("match");
    expect(comparisons.find((result) => result.field_key === "caregiver_name")?.comparison_status).toBe("possible_conflict");
    expect(comparisons.find((result) => result.field_key === "homebound_narrative")?.comparison_status).toBe("requires_human_review");
  });
});
