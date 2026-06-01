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
    expect(factPack.stats.rawCharacters).toBeGreaterThan(0);
    expect(factPack.stats.packedCharacters).toBeGreaterThan(0);
  });

  it("does not promote failed OCR PDF stream text into diagnosis or medication facts", () => {
    const factPack = buildDocumentFactPack([
      buildDocument({
        type: "ORDER",
        text: [
          "%PDF-1.3 3 0 obj /Filter /FlateDecode stream x qyyrz",
          "Z69 lm UUgkk( A--M nomcOP 4HKr/ 3pQ,9 w051UW auUcm ZDbJHd",
          "Tzvndtttl Pgtl Vw,Ry ,Z0 Oltuuuvv Raa1Jc11Q Paqal Zaiaai 3g sL",
          "endstream endobj xref trailer startxref",
        ].join("\n"),
        metadata: {
          portalLabel: "Admission Packet",
          pdfType: "scanned_image_pdf",
          ocrUsed: true,
          ocrSuccess: false,
          rawExtractedTextSource: "dom",
        },
      }),
    ]);

    expect(factPack.diagnoses).toEqual([]);
    expect(factPack.medications).toEqual([]);
    expect(factPack.allergies).toEqual([]);
  });

  it("does not promote OCR-looking random text into diagnosis or medication facts", () => {
    const factPack = buildDocumentFactPack([
      buildDocument({
        type: "ORDER",
        text: [
          "Primary Diagnosis: Z69 lm UUgkk( A--M nomcOP 4HKr/ 3pQ,9 w051UW auUcm ZDbJHd vmgcisme Z u2",
          "Secondary Diagnoses: E23 q WWG; N68 U AsYj0 1; R75 M 1faIsicRC fFZpP s-8 CHrJ6 dflhU",
          "Medications: Tzvndtttl Pgtl Vw Ry Z0 Oltuuuvv Raa1Jc11Q Paqal Zaiaai 3g sL",
        ].join("\n"),
        metadata: {
          portalLabel: "Admission Packet",
        },
      }),
    ]);

    expect(factPack.diagnoses).toEqual([]);
    expect(factPack.medications).toEqual([]);
  });

  it("does not pair ICD codes with allergy text as diagnosis descriptions", () => {
    const factPack = buildDocumentFactPack([
      buildDocument({
        type: "ORDER",
        text: [
          "Active Diagnoses",
          "Z47.89) No known drug allergies",
          "Z47.89) History of arthroplasty of left knee",
          "Allergies: No known drug allergies",
        ].join("\n"),
        metadata: {
          portalLabel: "New Referral Allen Coleman 04282026.pdf",
          ocrUsed: true,
          ocrSuccess: true,
        },
      }),
    ]);

    expect(factPack.diagnoses).toEqual([
      expect.objectContaining({
        code: "Z47.89",
        description: "History of arthroplasty of left knee",
      }),
    ]);
    expect(factPack.diagnoses.some((fact) => /allerg/i.test(fact.description))).toBe(false);
    expect(factPack.allergies.some((allergy) => /no known drug/i.test(allergy))).toBe(true);
  });
});
