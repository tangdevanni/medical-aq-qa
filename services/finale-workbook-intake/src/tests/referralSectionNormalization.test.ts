import { describe, expect, it } from "vitest";
import { normalizeReferralSections } from "../referralProcessing/sectionNormalization";

describe("normalizeReferralSections", () => {
  it("maps referral text into stable semantic sections", () => {
    const sections = normalizeReferralSections([
      "Patient Name: Christine Young",
      "DOB: 05/30/1944",
      "Primary Reason for Home Health / Medical Necessity",
      "Patient requires skilled nursing and PT/OT after hospital discharge.",
      "Homebound Status",
      "Uses walker and leaving home is exhausting.",
      "Primary Caregiver: Emily Young",
      "Relationship: Daughter",
      "Diagnosis Information",
      "J18.9 Pneumonia, unspecified organism",
    ].join("\n"));

    expect(sections.some((section) => section.sectionName === "patient_identity")).toBe(true);
    expect(sections.some((section) => section.sectionName === "medical_necessity")).toBe(true);
    expect(sections.some((section) => section.sectionName === "homebound_evidence")).toBe(true);
    expect(sections.some((section) => section.sectionName === "caregiver_support")).toBe(true);
    expect(sections.some((section) => section.sectionName === "diagnoses")).toBe(true);
  });

  it("segments single-line fax text before matching sections", () => {
    const sections = normalizeReferralSections([
      "Fax Server 2/20/2026 1:17:59 PM PAGE 1/011 Fax Server From: Fountain Hills Post Acute",
      "Resident: YOUNG, CHRISTINE E (41707) DOB: 05/30/1944",
      "Order Date: 02/17/2026 18:03 Communication Method: Phone Order ID: 247187734",
      "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated.",
      "Primary Caregiver: Emily Young Relationship: Daughter",
      "Diagnosis Information J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
      "ADVANCE DIRECTIVE CPR / Full Code",
      "Precautions Details: Falls, s/p Acute resp failure, PNA C O2, SOB, Confusion.",
    ].join(" "));

    const therapyNeed = sections.find((section) => section.sectionName === "therapy_need");
    const caregiverSupport = sections.find((section) => section.sectionName === "caregiver_support");

    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(therapyNeed?.normalizedSummary).toContain("HH PT/OT eval and treat as indicated.");
    expect(caregiverSupport?.normalizedSummary).toContain("Relationship: Daughter");
    expect(sections.some((section) => section.sectionName === "diagnoses")).toBe(true);
    expect(sections.some((section) => section.sectionName === "code_status")).toBe(true);
    expect(therapyNeed?.normalizedSummary).not.toMatch(/\bFax Server\b/);
  });

  it("does not misclassify discharge boilerplate as living situation", () => {
    const sections = normalizeReferralSections(
      "ADVANCE DIRECTIVE CPR / Full Code MISCELLANEOUS INFORMATION Date of Discharge Time Length of Stay Discharged to (Mortician Name and Licence No.) 59",
    );

    expect(sections.some((section) => section.sectionName === "living_situation")).toBe(false);
    expect(sections.some((section) => section.sectionName === "code_status")).toBe(true);
  });
});
