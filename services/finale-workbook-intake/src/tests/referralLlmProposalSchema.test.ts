import { describe, expect, it } from "vitest";
import { parseReferralLlmProposalPayload, referralLlmProposalSchema } from "../referralProcessing/llmProposalSchema";

describe("referralLlmProposalSchema", () => {
  it("accepts strict JSON-only proposal payloads", () => {
    const parsed = parseReferralLlmProposalPayload(JSON.stringify({
      patient_context: {
        patient_name: "Christine Young",
        dob: "05/30/1944",
        soc_date: "02/27/2026",
        referral_date: "02/20/2026",
      },
      proposed_field_values: [{
        field_key: "preferred_language",
        proposed_value: "English",
        confidence: 0.95,
        source_spans: ["Preferred Language: English"],
        rationale: "Explicitly stated in the referral.",
        requires_human_review: false,
      }],
      diagnosis_candidates: [{
        description: "Pneumonia, unspecified organism",
        icd10_code: "J18.9",
        confidence: 0.72,
        source_spans: ["J18.9 PNEUMONIA, UNSPECIFIED ORGANISM"],
        is_primary_candidate: true,
        requires_human_review: true,
      }],
      caregiver_candidates: [],
      unsupported_or_missing_fields: [],
      warnings: [],
    }));

    expect(parsed).not.toBeNull();
    expect(parsed?.proposed_field_values).toHaveLength(1);
  });

  it("rejects malformed payloads missing source evidence", () => {
    expect(() =>
      referralLlmProposalSchema.parse({
        patient_context: {
          patient_name: null,
          dob: null,
          soc_date: null,
          referral_date: null,
        },
        proposed_field_values: [{
          field_key: "preferred_language",
          proposed_value: "English",
          confidence: 0.95,
          source_spans: [],
          rationale: "Missing evidence list.",
          requires_human_review: false,
        }],
        diagnosis_candidates: [],
        caregiver_candidates: [],
        unsupported_or_missing_fields: [],
        warnings: [],
      }),
    ).toThrow();
  });
});
