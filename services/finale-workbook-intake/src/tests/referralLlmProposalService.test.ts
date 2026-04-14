import { describe, expect, it } from "vitest";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "../referralProcessing/fieldContract";
import { extractReferralFacts } from "../referralProcessing/factsExtractionService";
import { generateReferralFieldProposals } from "../referralProcessing/llmProposalService";
import { normalizeReferralSections } from "../referralProcessing/sectionNormalization";

function buildWorkItem(): PatientEpisodeWorkItem {
  return {
    id: "CHRISTINE_YOUNG__test",
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

describe("generateReferralFieldProposals", () => {
  it("keeps deterministic fallback proposals field-specific for fax-style referral text", async () => {
    const sourceText = [
      "Fax Server 2/20/2026 1:17:59 PM PAGE 1/011 Fax Server From: Fountain Hills Post Acute",
      "Resident: YOUNG, CHRISTINE E (41707) DOB: 05/30/1944",
      "Order Date: 02/17/2026 18:03 Communication Method: Phone Order ID: 247187734",
      "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated. Please send pt home with all remaining medications including narcs Confirmed By: Barbara Barbagallo (RN)",
      "Admitted From Admission Location Birth Place Citizenship Maiden Name Acute care hospital SCOTTSDALE SHEA MEDICAL CENTER Medicare Beneficiary ID Medicaid #",
      "Primary Lang. F 05/30/1944 81 Widowed White English Admitted From",
      "PHARMACY Pharmacy Phone/Fax Address MEDICAL ARTS (Primary) Phone: (480) 253-3100 Fax: (480) 497-3784",
      "CONTACTS Name Contact Type Relationship Address Phone/Email YOUNG, CHRISTINE Financial Responsible Party Self Cell:4803885075 Resident/Self YOUNG, EMILY Daughter Cell:4807035881",
      "DIAGNOSIS INFORMATION Code Description Onset Date Rank Classification J18.9 PNEUMONIA, UNSPECIFIED ORGANISM 12/23/2025 Primary J96.01 ACUTE RESPIRATORY FAILURE WITH HYPOXIA 12/23/2025 2",
      "ADVANCE DIRECTIVE CPR / Full Code",
      "Precautions Details: Falls, s/p Acute resp failure, PNA C O2, SOB, Confusion; G: 2WW 100', WC 150'",
    ].join(" ");

    const workItem = buildWorkItem();
    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({ workItem }),
    });
    const extractedFacts = extractReferralFacts({
      fieldMapSnapshot,
      sections: normalizeReferralSections(sourceText),
      sourceText,
    });
    const proposal = await generateReferralFieldProposals({
      env: loadEnv({
        ...process.env,
        CODE_LLM_ENABLED: "false",
      }),
      fieldMapSnapshot,
      extractedFacts,
      sourceText,
    });

    const byField = new Map(proposal.proposed_field_values.map((entry) => [entry.field_key, entry]));

    expect(proposal.patient_context.patient_name).toBe("YOUNG, CHRISTINE E");
    expect(byField.get("referral_date")?.proposed_value).toBe("02/17/2026");
    expect(byField.get("recent_hospitalization_facility")?.proposed_value)
      .toBe("SCOTTSDALE SHEA MEDICAL CENTER");
    expect(byField.get("caregiver_name")?.proposed_value).toBe("YOUNG, EMILY");
    expect(byField.get("caregiver_relationship")?.proposed_value).toBe("Daughter");
    expect(byField.get("caregiver_phone")?.proposed_value).toBe("4807035881");
    expect(byField.get("primary_reason_for_home_health_medical_necessity")?.proposed_value)
      .toBe("Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated");
    expect(byField.get("therapy_need")?.proposed_value).toBe("HH PT/OT eval and treat as indicated");
    expect(byField.get("fall_risk_narrative")?.proposed_value).toBe("Precautions Details: Falls, s/p Acute resp failure, PNA C O2, SOB, Confusion; G: 2WW 100', WC 150'");
    expect(proposal.diagnosis_candidates[0]?.description).toBe("PNEUMONIA, UNSPECIFIED ORGANISM");

    for (const proposed of proposal.proposed_field_values) {
      if (typeof proposed.proposed_value === "string") {
        expect(proposed.proposed_value).not.toMatch(/\bFax Server\b/);
        expect(proposed.proposed_value.length).toBeLessThanOrEqual(520);
      }
      expect(proposed.source_spans.join(" ")).not.toMatch(/\bBirth Place Citizenship Maiden Name\b/);
    }
    expect(proposal.unsupported_or_missing_fields).toContain("living_situation");
    expect(proposal.unsupported_or_missing_fields).not.toContain("referral_date");
  });
});
