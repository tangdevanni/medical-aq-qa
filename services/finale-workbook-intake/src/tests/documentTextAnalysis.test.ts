import { describe, expect, it } from "vitest";
import {
  analyzeDocumentText,
  extractPossibleIcd10Codes,
  selectPreferredDocumentText,
} from "../services/documentTextAnalysis";

describe("documentTextAnalysis", () => {
  it("rejects viewer-only toolbar text", () => {
    const analysis = analyzeDocumentText(
      "Automatic Zoom Actual Size Page Fit Page Width Tools Print Download",
    );

    expect(analysis.accepted).toBe(false);
    expect(analysis.viewerChromeDetected).toBe(true);
    expect(analysis.rejectionReasons.join(" ")).toContain("viewer_chrome_text");
  });

  it("rejects raw pdf structure text that masquerades as a digital text layer", () => {
    const analysis = analyzeDocumentText(
      "PDF-1.4 1 0 obj Creator (Apache FOP Version 2.10) endobj 2 0 obj /Length 3 0 R /Filter /FlateDecode stream x QDEei g endstream endobj xref trailer startxref",
    );

    expect(analysis.accepted).toBe(false);
    expect(analysis.rawPdfStructureDetected).toBe(true);
    expect(analysis.rejectionReasons).toContain("pdf_structure_text");
  });

  it("normalizes OCR-distorted leading I codes", () => {
    const codes = extractPossibleIcd10Codes(
      "Diagnoses include 148.20, 150.33, 187.313, and 111.0.",
    );

    expect(codes).toEqual(["I48.20", "I50.33", "I87.313", "I11.0"]);
  });

  it("returns deduplicated normalized ICD-10 codes", () => {
    const codes = extractPossibleIcd10Codes(
      "J18.9 J18.9 148.20 I48.20 R13.12 R13.12",
    );

    expect(codes).toEqual(["J18.9", "I48.20", "R13.12"]);
  });

  it("prefers OCR for scanned-image PDFs", () => {
    const selection = selectPreferredDocumentText({
      pdfType: "scanned_image_pdf",
      domText: "Automatic Zoom Actual Size Page Fit Tools",
      ocrText: "Primary diagnosis J18.9 pneumonia.",
      ocrSuccess: true,
    });

    expect(selection.rawExtractedTextSource).toBe("ocr");
    expect(selection.usedOcr).toBe(true);
    expect(selection.selectionReason).toBe("preferred_ocr_for_scanned_image_pdf");
  });

  it("prefers OCR when a digital pdf text layer is actually raw pdf structure noise", () => {
    const selection = selectPreferredDocumentText({
      pdfType: "digital_text_pdf",
      domText:
        "PDF-1.4 1 0 obj Creator (Apache FOP Version 2.10) endobj 2 0 obj /Length 3 0 R /Filter /FlateDecode stream x QDEei g endstream endobj xref trailer startxref",
      ocrText: "Primary diagnosis J18.9 pneumonia unspecified organism.",
      ocrSuccess: true,
    });

    expect(selection.rawExtractedTextSource).toBe("ocr");
    expect(selection.usedOcr).toBe(true);
    expect(selection.selectionReason).toContain("preferred_ocr_after_dom_rejection:pdf_structure_text");
  });

  it("keeps DOM text for selectable PDFs without unnecessary OCR", () => {
    const selection = selectPreferredDocumentText({
      pdfType: "digital_text_pdf",
      domText: "Primary diagnosis J18.9 pneumonia unspecified organism.",
      ocrText: "",
      ocrSuccess: false,
    });

    expect(selection.rawExtractedTextSource).toBe("dom");
    expect(selection.usedOcr).toBe(false);
    expect(selection.text).toContain("J18.9");
  });
});
