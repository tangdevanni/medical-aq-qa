import { describe, expect, it } from "vitest";
import { evaluateDocumentExtractionQuality } from "../referralProcessing/extractionQuality";

describe("evaluateDocumentExtractionQuality", () => {
  it("rejects viewer-chrome-only extraction as unusable", () => {
    const result = evaluateDocumentExtractionQuality({
      text: "Automatic Zoom Actual Size Page Fit Page Width Tools Print",
      extraction: {
        pdfType: "digital_text_pdf",
        rawExtractedTextSource: "dom",
        domExtractionRejectedReasons: [],
      },
      fileType: "pdf",
    });

    expect(result.likelyUsableForLlm).toBe(false);
    expect(result.rejectedReasons).toContain("viewer_chrome_only");
    expect(result.usabilityStatus).toBe("rejected");
  });

  it("accepts clinically rich referral text as usable", () => {
    const result = evaluateDocumentExtractionQuality({
      text: [
        "Patient Name: Christine Young",
        "DOB: 05/30/1944",
        "Order Date: 02/17/2026",
        "Primary reason for home health is weakness after discharge.",
        "Skilled nursing for medication management and PT/OT for mobility were ordered.",
      ].join("\n"),
      extraction: {
        pdfType: "digital_text_pdf",
        rawExtractedTextSource: "dom",
        domExtractionRejectedReasons: [],
      },
      fileType: "pdf",
    });

    expect(result.likelyUsableForLlm).toBe(true);
    expect(result.containsClinicalVocabulary).toBe(true);
    expect(result.containsDatePatterns).toBe(true);
    expect(result.usabilityStatus).toBe("usable");
  });

  it("does not mistake printed dates or black stools for viewer chrome", () => {
    const result = evaluateDocumentExtractionQuality({
      text: [
        "Fax Server",
        "Printed Date: Feb 20, 2026 09:57:47 MT",
        "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care.",
        "Patient presented to the ER with fatigue and black stools.",
        "DIAGNOSIS INFORMATION J18.9 PNEUMONIA, UNSPECIFIED ORGANISM 12/23/2025 Primary",
      ].join("\n"),
      extraction: {
        pdfType: "scanned_image_pdf",
        rawExtractedTextSource: "ocr",
        domExtractionRejectedReasons: [],
      },
      fileType: "pdf",
    });

    expect(result.rejectedReasons).not.toContain("viewer_chrome_only");
    expect(result.lineCount).toBeGreaterThan(1);
    expect(result.likelyUsableForLlm).toBe(true);
    expect(result.usabilityStatus).toBe("usable");
  });

  it("flags likely corrupted encoding", () => {
    const result = evaluateDocumentExtractionQuality({
      text: "Patient discharged with purÃ©ed diet and â€” unclear encoding artifacts.",
      extraction: {
        pdfType: "digital_text_pdf",
        rawExtractedTextSource: "dom",
        domExtractionRejectedReasons: [],
      },
      fileType: "pdf",
    });

    expect(result.likelyCorruptedEncoding).toBe(true);
    expect(result.rejectedReasons).toContain("corrupted_encoding");
  });

  it("routes raw pdf structure text toward OCR retry instead of LLM use", () => {
    const result = evaluateDocumentExtractionQuality({
      text: [
        "PDF-1.4 1 0 obj Creator (Apache FOP Version 2.10)",
        "2 0 obj /Length 3 0 R /Filter /FlateDecode stream x QDEei g",
        "endstream endobj xref trailer startxref",
      ].join("\n"),
      extraction: {
        pdfType: "digital_text_pdf",
        rawExtractedTextSource: "dom",
        domExtractionRejectedReasons: [],
      },
      fileType: "pdf",
    });

    expect(result.likelyUsableForLlm).toBe(false);
    expect(result.likelyRequiresOcrRetry).toBe(true);
    expect(result.rejectedReasons).toContain("pdf_structure_text");
    expect(result.usabilityStatus).toBe("needs_ocr_retry");
  });
});
