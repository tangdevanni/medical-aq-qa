import { describe, expect, it } from "vitest";
import {
  buildOasisReadyDiagnosisDocument,
  mergeCanonicalWithSupplementalOasisDiagnoses,
} from "../services/codingInputExportService";
import type { CanonicalDiagnosisExtraction } from "../services/diagnosisCodingExtractionService";

describe("buildOasisReadyDiagnosisDocument", () => {
  it("keeps the first ranked diagnosis as primary and returns the rest as other diagnoses", () => {
    const canonical: CanonicalDiagnosisExtraction = {
      reason_for_admission: "Primary diagnosis pneumonia with respiratory failure and atrial fibrillation.",
      diagnosis_phrases: [
        "PNEUMONIA, UNSPECIFIED ORGANISM",
        "ACUTE RESPIRATORY FAILURE WITH HYPOXIA",
        "CHRONIC ATRIAL FIBRILLATION, UNSPECIFIED",
      ],
      diagnosis_code_pairs: [
        {
          diagnosis: "PNEUMONIA, UNSPECIFIED ORGANISM",
          code: "J18.9",
          code_source: "verbatim",
        },
        {
          diagnosis: "ACUTE RESPIRATORY FAILURE WITH HYPOXIA",
          code: "J96.01",
          code_source: "verbatim",
        },
        {
          diagnosis: "CHRONIC ATRIAL FIBRILLATION, UNSPECIFIED",
          code: "I48.20",
          code_source: "verbatim",
        },
      ],
      icd10_codes_found_verbatim: ["J18.9", "J96.01", "I48.20"],
      ordered_services: ["SN"],
      clinical_summary: "Read-only diagnosis extraction summary.",
      source_quotes: [],
      uncertain_items: [],
      document_type: "ORDER",
      extraction_confidence: "high",
    };

    const document = buildOasisReadyDiagnosisDocument(canonical);

    expect(document.primaryDiagnosis).toEqual({
      code: "J18.9",
      description: "PNEUMONIA, UNSPECIFIED ORGANISM",
      confidence: "high",
    });
    expect(document.otherDiagnoses).toEqual([
      {
        code: "J96.01",
        description: "ACUTE RESPIRATORY FAILURE WITH HYPOXIA",
        confidence: "high",
      },
      {
        code: "I48.20",
        description: "CHRONIC ATRIAL FIBRILLATION, UNSPECIFIED",
        confidence: "high",
      },
    ]);
  });

  it("splits packed fact-pack diagnosis summaries into clean primary and subsequent diagnoses", () => {
    const canonical: CanonicalDiagnosisExtraction = {
      reason_for_admission: "L PATELLA FX",
      diagnosis_phrases: [],
      diagnosis_code_pairs: [
        {
          diagnosis: "Diagnoses: - primary L PATELLA FX - E87.1 Hyponatremia I : Hypo-osmolality",
          code: null,
          code_source: null,
        },
      ],
      icd10_codes_found_verbatim: ["E87.1"],
      ordered_services: ["SN", "PT"],
      clinical_summary: "Read-only diagnosis extraction summary.",
      source_quotes: [],
      uncertain_items: [],
      document_type: "ORDER",
      extraction_confidence: "medium",
    };

    const document = buildOasisReadyDiagnosisDocument(canonical);

    expect(document.primaryDiagnosis).toMatchObject({
      code: "",
      description: "L PATELLA FX",
      confidence: "medium",
    });
    expect(document.otherDiagnoses).toEqual([
      {
        code: "E87.1",
        description: "Hyponatremia I : Hypo-osmolality",
        confidence: "high",
      },
    ]);
  });
});

describe("mergeCanonicalWithSupplementalOasisDiagnoses", () => {
  function emptyCanonical(): CanonicalDiagnosisExtraction {
    return {
      reason_for_admission: null,
      diagnosis_phrases: [],
      diagnosis_code_pairs: [],
      icd10_codes_found_verbatim: [],
      ordered_services: ["Physical Therapy"],
      clinical_summary: null,
      source_quotes: [],
      uncertain_items: [],
      document_type: null,
      extraction_confidence: "low",
    };
  }

  it("fills an empty coding context from selected OASIS diagnoses", () => {
    const merged = mergeCanonicalWithSupplementalOasisDiagnoses({
      canonical: emptyCanonical(),
      diagnoses: [
        {
          code: "Z47.89",
          description: "Encounter for other orthopedic aftercare",
          sourceLabel: "print_preview_dom:soc",
        },
        {
          code: "R53.1",
          description: "Weakness",
          sourceLabel: "print_preview_dom:soc",
        },
      ],
    });

    const document = buildOasisReadyDiagnosisDocument(merged);

    expect(document.primaryDiagnosis).toEqual({
      code: "Z47.89",
      description: "Encounter for other orthopedic aftercare",
      confidence: "high",
    });
    expect(document.otherDiagnoses[0]).toMatchObject({
      code: "R53.1",
      description: "Weakness",
      confidence: "high",
    });
    expect(merged.source_quotes[0]).toContain("Selected OASIS diagnoses");
  });

  it("does not override existing usable coding diagnosis pairs", () => {
    const canonical: CanonicalDiagnosisExtraction = {
      ...emptyCanonical(),
      diagnosis_phrases: ["PNEUMONIA, UNSPECIFIED ORGANISM"],
      diagnosis_code_pairs: [
        {
          diagnosis: "PNEUMONIA, UNSPECIFIED ORGANISM",
          code: "J18.9",
          code_source: "referral",
        },
      ],
      icd10_codes_found_verbatim: ["J18.9"],
      extraction_confidence: "high",
    };

    const merged = mergeCanonicalWithSupplementalOasisDiagnoses({
      canonical,
      diagnoses: [
        {
          code: "Z47.89",
          description: "Encounter for other orthopedic aftercare",
          sourceLabel: "print_preview_dom:soc",
        },
      ],
    });

    expect(merged).toBe(canonical);
    expect(buildOasisReadyDiagnosisDocument(merged).primaryDiagnosis.code).toBe("J18.9");
  });
});
