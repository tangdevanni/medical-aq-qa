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

  it("extracts structured OASIS caregiver, diagnosis, and narrative fields without matching option lists", () => {
    const sourceText = [
      "Patient INFO",
      "Name: YOUNG, CHRISTINE",
      "DOB: 1944-05-30",
      "(M0030) Start of Care Date",
      "02/27/2026",
      "(M0104) Date of Referral",
      "02/27/2026",
      "(M1005) Inpatient Discharge Date (most recent): 02/20/2026",
      "Primary Reason for Home Health / Medical Necessity",
      "Christine E. Young is being admitted to home health care following her discharge from Fountain Hills Post Acute after a prolonged hospitalization. Skilled nursing services will be essential for medication management. Additionally, skilled physical and occupational therapy are necessary to address her mobility challenges.",
      "Homebound Reason Document as Clinical Narrative",
      "The patient is homebound due to weakness and pain, requiring assistive devices and assistance from others for safe ambulation. Leaving home is exhausting and she uses a walker for mobility.",
      "Caregiver Contact Info: Primary Caregiver: Relationship to Patient Contact Number Emily Young Daughter 4807035881",
      "ACTIVE DIAGNOSES (M1021/1023)",
      "PRIMARY DIAGNOSIS",
      "02/27/2026",
      "R13.10- Dysphagia, unspecified 0 1 2 3 4",
      "OTHER DIAGNOSIS - 1",
      "02/27/2026",
      "I11.0- Hypertensive heart disease with heart failure 0 1 2 3 4",
      "OTHER DIAGNOSIS - 2",
      "02/27/2026",
      "I50.9 - Heart failure, unspecified 0 1 2 3 4",
      "A1110 Language",
      "A.What is your preferred language? B. Do you need or want an interpreter to communicate with a doctor or English health care staff?",
      "0. No 1. Yes 9. Unable to determine",
      "PLAN OF CARE AND PHYSICAL THERAPY EVALUATION",
      "PT Frequency: 1x.wk X 1 wk, 2x/wk X 3 wks",
      "Initiate physical therapy services focusing on strengthening, balance training, gait training, transfer training, and safety awareness to improve functional mobility and reduce fall risk.",
      "Comments: Lower back pain with a scale of 8/10; comfort measures and pain medication were provided. Re-checked after 30 minutes, resulting with a scale of 3/10.",
      "PATIENT SUMMARY & CLINICAL NARRATIVE Summary",
      "Christine Young is an 81-year-old female referred for home health services. She lives with a caregiver who provides support. Functionally, Christine requires supervision to minimal assistance for transfers and ambulation and uses a walker for mobility. Assessment findings indicate stable vital signs and intact skin integrity with no noted wounds. Despite intact cognition and stable mood, she requires assistance with activities of daily living.",
      "CARE PLAN (PROBLEMS / / INTERVENTIONS)",
      "Problem: Fall Risk Goals: Reduce the risk of falls in the home environment. Interventions: Assess the patient's gait and balance through physical therapy.",
    ].join("\n");

    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({ workItem: buildWorkItem() }),
    });

    const facts = extractReferralFacts({
      fieldMapSnapshot,
      sections: normalizeReferralSections(sourceText),
      sourceText,
    });

    const byKey = new Map(facts.facts.map((fact) => [fact.fact_key, fact]));

    expect(facts.patient_context.patient_name).toBe("YOUNG, CHRISTINE");
    expect(facts.patient_context.dob).toBe("05/30/1944");
    expect(facts.patient_context.referral_date).toBe("02/27/2026");
    expect(byKey.get("recent_hospitalization_discharge_date")?.value).toBe("02/20/2026");
    expect(byKey.get("recent_hospitalization_facility")?.value).toBe("Fountain Hills Post Acute");
    expect(byKey.get("caregiver_name")?.value).toBe("Emily Young");
    expect(byKey.get("caregiver_relationship")?.value).toBe("Daughter");
    expect(byKey.get("caregiver_phone")?.value).toBe("4807035881");
    expect(byKey.get("preferred_language")?.value).toBeUndefined();
    expect(byKey.get("medical_necessity_summary")?.value).toEqual(expect.stringContaining("Skilled nursing services will be essential"));
    expect(byKey.get("homebound_narrative")?.value).toEqual(expect.stringContaining("homebound due to weakness and pain"));
    expect(byKey.get("discipline_frequencies")?.value).toBe("1x.wk X 1 wk, 2x/wk X 3 wks");
    expect(byKey.get("prior_functioning")?.value).toEqual(expect.stringContaining("supervision to minimal assistance for transfers and ambulation"));
    expect(byKey.get("pain_assessment_narrative")?.value).toEqual(expect.stringContaining("Lower back pain with a scale of 8/10"));
    expect(byKey.get("integumentary_wound_status")?.value).toEqual(expect.stringContaining("no noted wounds"));
    expect(byKey.get("emotional_behavioral_status")?.value).toEqual(expect.stringContaining("stable mood"));
    expect(byKey.get("past_medical_history")?.value).toEqual(
      expect.arrayContaining([
        "Hypertensive heart disease with heart failure",
        "Heart failure",
        "Chronic atrial fibrillation",
        "Hypothyroidism",
        "Generalized weakness",
      ]),
    );
    expect(facts.diagnosis_candidates.map((candidate) => candidate.icd10_code)).toEqual(
      expect.arrayContaining(["R13.10", "I11.0", "I50.9"]),
    );
    expect(facts.unsupported_or_missing_fields).not.toContain("primary_reason_for_home_health_medical_necessity");
    expect(facts.unsupported_or_missing_fields).not.toContain("admit_reason_to_home_health");
    expect(facts.unsupported_or_missing_fields).not.toContain("prior_functioning");
  });
});
