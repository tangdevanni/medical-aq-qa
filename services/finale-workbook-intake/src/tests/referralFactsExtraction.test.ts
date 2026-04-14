import { describe, expect, it } from "vitest";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "../referralProcessing/fieldContract";
import { extractReferralFacts } from "../referralProcessing/factsExtractionService";
import { normalizeReferralSections } from "../referralProcessing/sectionNormalization";

function buildWorkItem(): PatientEpisodeWorkItem {
  return {
    id: "CHRISTINE_YOUNG__facts",
    subsidiaryId: "default",
    patientIdentity: {
      displayName: "Christine Young",
      normalizedName: "CHRISTINE YOUNG",
      medicareNumber: "8A75MN2VE79",
    },
    episodeContext: {
      socDate: "02/27/2026",
      episodeDate: "02/27/2026",
      billingPeriod: "02/27/2026 - 03/31/2026",
      episodePeriod: "02/27/2026 - 04/27/2026",
      payer: null,
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "IN_PROGRESS",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
  };
}

describe("extractReferralFacts", () => {
  it("produces atomic facts before field mapping", () => {
    const sourceText = [
      "Resident: YOUNG, CHRISTINE E (41707) DOB: 05/30/1944",
      "Order Date: 02/17/2026 18:03",
      "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated.",
      "Primary Lang. English",
      "CONTACTS YOUNG, EMILY Daughter Cell:4807035881",
      "Admitted From Acute care hospital SCOTTSDALE SHEA MEDICAL CENTER Medicare Beneficiary ID",
      "ADVANCE DIRECTIVE CPR / Full Code",
      "Precautions Details: Falls, s/p Acute resp failure, PNA C O2, SOB, Confusion.",
      "DIAGNOSIS INFORMATION J18.9 PNEUMONIA, UNSPECIFIED ORGANISM 12/23/2025 Primary",
    ].join(" ");

    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({ workItem: buildWorkItem() }),
    });

    const facts = extractReferralFacts({
      fieldMapSnapshot,
      sections: normalizeReferralSections(sourceText),
      sourceText,
    });

    const byKey = new Map(facts.facts.map((fact) => [fact.fact_key, fact]));

    expect(facts.patient_context.patient_name).toBe("YOUNG, CHRISTINE E");
    expect(facts.patient_context.referral_date).toBe("02/17/2026");
    expect(byKey.get("medical_necessity_summary")?.value).toBe(
      "Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated.",
    );
    expect(byKey.get("caregiver_name")?.value).toBe("YOUNG, EMILY");
    expect(byKey.get("therapy_need")?.value).toBe("HH PT/OT eval and treat as indicated");
    expect(byKey.get("caregiver_relationship")?.value).toBe("Daughter");
    expect(byKey.get("recent_hospitalization_facility")?.value).toBe("SCOTTSDALE SHEA MEDICAL CENTER");
    expect(facts.diagnosis_candidates[0]?.description).toBe("PNEUMONIA, UNSPECIFIED ORGANISM");
    expect(facts.warnings).toContain("Deterministic referral facts extraction was used.");
  });

  it("avoids header contamination in patient and caregiver names for single-line fax text", () => {
    const sourceText = [
      "Resident Name Preferred Name Unit Room / Bed Admission Date Init. Adm. Date Orig Adm Date Resident #",
      "YOUNG, CHRISTINE E. 300 Hall 305-A 12/23/2025 12/23/2025 12/23/2025 41707",
      "CONTACTS Name Contact Type Relationship Address Phone/Email",
      "YOUNG, CHRISTINE Financial Responsible Party Self Cell:4803885075 Resident/Self",
      "YOUNG, EMILY Daughter Cell:4807035881",
      "DIAGNOSIS INFORMATION J18.9 PNEUMONIA, UNSPECIFIED ORGANISM 12/23/2025 Primary",
    ].join(" ");

    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({ workItem: buildWorkItem() }),
    });

    const facts = extractReferralFacts({
      fieldMapSnapshot,
      sections: normalizeReferralSections(sourceText),
      sourceText,
    });

    const byKey = new Map(facts.facts.map((fact) => [fact.fact_key, fact]));

    expect(facts.patient_context.patient_name).toBe("YOUNG, CHRISTINE E");
    expect(byKey.get("caregiver_name")?.value).toBe("YOUNG, EMILY");
    expect(byKey.get("caregiver_relationship")?.value).toBe("Daughter");
    expect(byKey.get("caregiver_phone")?.value).toBe("4807035881");
  });

  it("trims discharge operations text and extracts functional limits from long matched spans", () => {
    const longDiagnosisLine = [
      "DIAGNOSIS INFORMATION",
      ...Array.from({ length: 18 }, (_, index) => `Z${(index + 10).toString().padStart(2, "0")}.00 FILLER CONDITION ${index + 1}`),
      "M62.81 MUSCLE WEAKNESS (GENERALIZED) 12/23/2025 9",
      "R26.2 DIFFICULTY IN WALKING, NOT ELSEWHERE CLASSIFIED 12/23/2025 10",
    ].join(" ");

    const sourceText = [
      "Resident: YOUNG, CHRISTINE E (41707) DOB: 05/30/1944",
      "Order Date: 02/17/2026 18:03",
      "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated. Please send pt home with all remaining medications including narcs",
      longDiagnosisLine,
      "ADVANCE DIRECTIVE CPR / Full Code MISCELLANEOUS INFORMATION Date of Discharge Time Length of Stay Discharged to (Mortician Name and Licence No.) 59",
    ].join(" ");

    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({ workItem: buildWorkItem() }),
    });

    const facts = extractReferralFacts({
      fieldMapSnapshot,
      sections: normalizeReferralSections(sourceText),
      sourceText,
    });

    const byKey = new Map(facts.facts.map((fact) => [fact.fact_key, fact]));

    expect(byKey.get("medical_necessity_summary")?.value).toBe(
      "Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated",
    );
    expect(byKey.get("functional_limitations")?.value).toEqual(
      expect.arrayContaining(["weakness", "difficulty_walking"]),
    );
    expect(byKey.get("living_situation")?.value).toBeUndefined();
  });
});
