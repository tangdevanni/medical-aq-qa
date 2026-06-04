import { describe, expect, it } from "vitest";
import { parseReferralDirectDocumentPayload } from "../referralProcessing/directDocumentExtractor";

describe("parseReferralDirectDocumentPayload", () => {
  it("parses source-quoted diagnosis and medication facts", () => {
    const parsed = parseReferralDirectDocumentPayload(JSON.stringify({
      patient_context: {
        patient_name: "Test Patient",
        dob: null,
        soc_date: null,
        referral_date: "04/28/2026",
      },
      diagnoses: [{
        description: "Encounter for other orthopedic aftercare",
        icd10_code: "Z47.89",
        is_primary_candidate: true,
        confidence: 0.94,
        source_quote: "Encounter for other orthopedic aftercare (Z47.89) located on the right shoulder.",
        page: 1,
        laterality_terms: ["right"],
        body_site_terms: ["shoulder"],
        requires_human_review: false,
        review_reasons: [],
      }],
      medications: [{
        name: "oxycodone",
        dose: "5 mg",
        route: "Oral",
        frequency: "q4 prn",
        start_date: null,
        confidence: 0.82,
        source_quote: "oxycodone 5 mg Oral tablet",
        page: 1,
        requires_human_review: true,
        review_reasons: ["start_date_not_visible"],
      }],
      field_proposals: [{
        field_key: "living_situation",
        proposed_value: "Lives with caregiver support",
        confidence: 0.82,
        source_quote: "Patient lives with caregiver support and requires assistance for safety.",
        page: 1,
        requires_human_review: true,
        review_reasons: [],
      }],
      unsupported_or_missing_fields: ["medication_start_dates"],
      warnings: [],
    }));

    expect(parsed?.diagnoses[0]?.icd10_code).toBe("Z47.89");
    expect(parsed?.diagnoses[0]?.body_site_terms).toEqual(["shoulder"]);
    expect(parsed?.medications[0]?.start_date).toBeNull();
    expect(parsed?.field_proposals[0]?.field_key).toBe("living_situation");
  });

  it("rejects non-JSON model text", () => {
    expect(parseReferralDirectDocumentPayload("The document says the patient has Z47.89.")).toBeNull();
  });

  it("parses facts without source_quote fields so promotion can reject them downstream", () => {
    const parsed = parseReferralDirectDocumentPayload(JSON.stringify({
      patient_context: {
        patient_name: null,
        dob: null,
        soc_date: null,
        referral_date: null,
      },
      diagnoses: [{
        description: "Encounter for other orthopedic aftercare",
        icd10_code: "Z47.89",
        is_primary_candidate: true,
        confidence: 0.94,
        page: 1,
        laterality_terms: ["right"],
        body_site_terms: ["shoulder"],
        requires_human_review: false,
        review_reasons: [],
      }],
      medications: [],
      unsupported_or_missing_fields: [],
      warnings: [],
    }));

    expect(parsed?.diagnoses[0]).toMatchObject({
      description: "Encounter for other orthopedic aftercare",
      source_quote: null,
      requires_human_review: false,
    });
  });

  it("tolerates extra model keys and missing optional metadata", () => {
    const parsed = parseReferralDirectDocumentPayload(JSON.stringify({
      patient_context: {
        patient_name: "Test Patient",
      },
      diagnoses: [{
        description: "History of arthroplasty of left knee",
        icd10_code: "Z47.89",
        source_quote: "Z47.89) History of arthroplasty of left knee",
      }],
      allergies: [{
        allergen: "No known drug allergies",
      }],
    }));

    expect(parsed?.patient_context.patient_name).toBe("Test Patient");
    expect(parsed?.patient_context.dob).toBeNull();
    expect(parsed?.diagnoses[0]).toMatchObject({
      icd10_code: "Z47.89",
      confidence: 0.5,
      source_quote: "Z47.89) History of arthroplasty of left knee",
    });
    expect(parsed?.medications).toEqual([]);
    expect(parsed?.warnings).toEqual([]);
  });
});
