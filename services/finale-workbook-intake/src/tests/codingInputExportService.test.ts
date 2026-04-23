import { describe, expect, it } from "vitest";
import { buildOasisReadyDiagnosisDocument } from "../services/codingInputExportService";
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
});
