import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CapturedChartDocument } from "../portal/services/chartDocumentCaptureService";
import { decideDocumentExtractionPolicy } from "../services/documentExtractionPolicyService";

function buildCapturedChartDocument(
  overrides: Partial<CapturedChartDocument>,
): CapturedChartDocument {
  return {
    targetType: "admission_order",
    sourceLabel: "Admission Order",
    sourceType: "ORDER",
    captureMethod: "download",
    evidenceDirectory: "C:/tmp/evidence",
    downloaded: true,
    warnings: [],
    notes: [],
    ...overrides,
  };
}

describe("decideDocumentExtractionPolicy", () => {
  it("prefers usable html when it is available and cheaper than scanned pdf OCR", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "doc-policy-html-"));

    try {
      const htmlPath = path.join(tempDir, "source.html");
      const pdfPath = path.join(tempDir, "source.pdf");
      await writeFile(
        htmlPath,
        [
          "<html><body>",
          "<h1>Admission Order</h1>",
          "<p>Patient Name: Christine Young</p>",
          "<p>Referral Date: 02/17/2026</p>",
          "<p>Reason for admission pneumonia with weakness after discharge.</p>",
          "<p>Skilled nursing for medication management and assessment.</p>",
          "</body></html>",
        ].join(""),
        "utf8",
      );
      await writeFile(pdfPath, "%PDF-1.4 /Subtype /Image", "latin1");

      const decision = await decideDocumentExtractionPolicy(buildCapturedChartDocument({
        htmlPath,
        sourcePdfPath: pdfPath,
      }));

      expect(decision.mode).toBe("html_text");
      expect(decision.recommendedSourcePath).toBe(htmlPath);
      expect(decision.hasHtmlSource).toBe(true);
      expect(decision.reasons.join(" ")).toContain("HTML");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers native text when the source pdf has a usable text layer", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "doc-policy-native-"));

    try {
      const pdfPath = path.join(tempDir, "source.pdf");
      const selectableText = [
        "Primary Diagnosis J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
        "Reason for admission home health nursing for assessment and medication management",
        "Patient requires skilled home health follow up",
      ].join(" ");
      await writeFile(pdfPath, `%PDF-1.4 BT (${selectableText}) Tj ET`, "latin1");

      const decision = await decideDocumentExtractionPolicy(buildCapturedChartDocument({
        sourcePdfPath: pdfPath,
      }));

      expect(decision.mode).toBe("native_text");
      expect(decision.confidence).toBe("high");
      expect(decision.recommendedSourcePath).toBe(pdfPath);
      expect(decision.hasUsablePdfTextLayer).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not trust raw pdf structure text as a usable native text layer", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "doc-policy-raw-pdf-"));

    try {
      const pdfPath = path.join(tempDir, "source.pdf");
      const rawPdfText = [
        "PDF-1.4",
        "1 0 obj Creator (Apache FOP Version 2.10)",
        "2 0 obj /Length 3 0 R /Filter /FlateDecode stream",
        "endstream endobj",
        "xref trailer startxref",
      ].join(" ");
      await writeFile(pdfPath, `%PDF-1.4 BT (${rawPdfText}) Tj ET`, "latin1");

      const decision = await decideDocumentExtractionPolicy(buildCapturedChartDocument({
        sourcePdfPath: pdfPath,
      }));

      expect(decision.mode).not.toBe("native_text");
      expect(decision.hasUsablePdfTextLayer).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires ocr when only scanned-style pdf sources exist", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "doc-policy-ocr-"));

    try {
      const printedPdfPath = path.join(tempDir, "printed-source.pdf");
      await writeFile(printedPdfPath, "%PDF-1.4 /Subtype /Image", "latin1");

      const decision = await decideDocumentExtractionPolicy(buildCapturedChartDocument({
        printedPdfPath,
      }));

      expect(decision.mode).toBe("ocr_required");
      expect(decision.recommendedSourcePath).toBe(printedPdfPath);
      expect(decision.hasPrintedPdfSource).toBe(true);
      expect(decision.hasUsablePdfTextLayer).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("marks documents unusable when no viable source exists", async () => {
    const decision = await decideDocumentExtractionPolicy(buildCapturedChartDocument({
      sourcePdfPath: undefined,
      printedPdfPath: undefined,
      htmlPath: undefined,
    }));

    expect(decision.mode).toBe("unusable");
    expect(decision.confidence).toBe("low");
    expect(decision.hasPdfSource).toBe(false);
    expect(decision.hasPrintedPdfSource).toBe(false);
    expect(decision.hasHtmlSource).toBe(false);
  });
});
