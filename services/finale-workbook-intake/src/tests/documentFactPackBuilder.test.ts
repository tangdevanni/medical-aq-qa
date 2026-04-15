import { describe, expect, it } from "vitest";
import { buildDocumentFactPack } from "../services/documentFactPackBuilder";
import type { ExtractedDocument } from "../services/documentExtractionService";

function buildDocument(overrides: Partial<ExtractedDocument>): ExtractedDocument {
  return {
    type: "OASIS",
    text: "",
    metadata: {},
    ...overrides,
  };
}

describe("buildDocumentFactPack", () => {
  it("builds a compact oasis fact pack from extracted chart text", () => {
    const factPack = buildDocumentFactPack([
      buildDocument({
        type: "OASIS",
        text: [
          "Primary Diagnosis: J18.9 Pneumonia, unspecified organism",
          "Secondary Diagnoses: I50.9 Heart failure, unspecified; E03.9 Hypothyroidism",
          "Allergies: NKDA",
          "Patient is homebound due to weakness, fall risk, and taxing effort to leave home.",
          "Skilled nursing needed for medication management, cardiopulmonary assessment, and education.",
          "Pain score 8/10 lower back pain.",
          "Blood pressure 134/72, pulse 82, temperature 98.3, O2 sat 95%",
        ].join("\n"),
        metadata: {
          portalLabel: "OASIS Tracking Report",
          possibleIcd10Codes: ["J18.9", "I50.9", "E03.9"],
        },
      }),
      buildDocument({
        type: "ORDER",
        text: [
          "Reason for referral: Hospital discharge follow-up after pneumonia admission.",
          "Medications: Furosemide 20 mg PO daily; Levothyroxine 50 mcg PO daily",
          "Patient is homebound due to weakness, fall risk, and taxing effort to leave home.",
        ].join("\n"),
        metadata: {
          portalLabel: "Admission Order",
        },
      }),
    ]);

    expect(factPack.documentType).toBe("oasis");
    expect(factPack.diagnoses.some((fact) => fact.code === "J18.9")).toBe(true);
    expect(factPack.diagnoses.some((fact) => fact.code === "I50.9")).toBe(true);
    expect(factPack.medications.some((fact) => /furosemide/i.test(fact.name))).toBe(true);
    expect(factPack.allergies).toContain("No known drug allergies");
    expect(factPack.homeboundEvidence.length).toBeGreaterThan(0);
    expect(factPack.skilledNeedEvidence.length).toBeGreaterThan(0);
    expect(factPack.hospitalizationReasons.length).toBeGreaterThan(0);
    expect(factPack.assessmentValues.some((fact) => /8\/10|blood pressure/i.test(fact.text))).toBe(true);
    expect(factPack.stats.rawCharacters).toBeGreaterThan(factPack.stats.packedCharacters);
    expect(factPack.stats.reductionPercent).toBeGreaterThan(0);
  });
});
