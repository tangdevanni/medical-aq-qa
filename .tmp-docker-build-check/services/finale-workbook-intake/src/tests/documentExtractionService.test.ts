import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactRecord } from "@medical-ai-qa/shared-types";
import { extractDocumentsFromArtifacts } from "../services/documentExtractionService";

function buildArtifact(overrides: Partial<ArtifactRecord>): ArtifactRecord {
  return {
    artifactType: "PHYSICIAN_ORDERS",
    status: "FOUND",
    portalLabel: "Admission Order",
    locatorUsed: "text=Admission Order",
    discoveredAt: "2026-04-06T00:00:00.000Z",
    downloadPath: null,
    extractedFields: {},
    notes: [],
    ...overrides,
  };
}

describe("extractDocumentsFromArtifacts", () => {
  it("prefers OCR artifacts for scanned-image PDFs and extracts normalized ICD-10 codes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ocr-doc-"));

    try {
      const pdfPath = path.join(tempDir, "source.pdf");
      const ocrResultPath = path.join(tempDir, "ocr-result.json");
      const extractedTextPath = path.join(tempDir, "extracted-text.txt");
      const viewerText = "Automatic Zoom Actual Size Page Fit Page Width Tools Print";
      const ocrText = [
        "Primary diagnosis J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
        "Other diagnoses J96.01 acute respiratory failure with hypoxia",
        "R13.12 dysphagia",
        "148.20 chronic atrial fibrillation",
        "150.33 acute on chronic diastolic heart failure",
        "G93.41 metabolic encephalopathy",
        "187.313 venous hypertension with ulcer",
        "R41.841 cognitive communication deficit",
        "M62.81 muscle weakness",
        "R26.2 difficulty walking",
        "E03.9 hypothyroidism",
        "F32.A depression",
        "111.0 hypertensive heart disease with heart failure",
        "K92.1 melena",
        "N17.9 acute kidney failure",
      ].join("\n");

      await writeFile(
        pdfPath,
        `%PDF-1.4 /Subtype /Image BT (${viewerText}) Tj ET`,
        "latin1",
      );
      await writeFile(
        ocrResultPath,
        JSON.stringify({
          schemaVersion: "1",
          pdfType: "scanned_image_pdf",
          ocrProvider: "textract",
          ocrMode: "async_s3",
          ocrSuccess: true,
          ocrTextLength: ocrText.length,
          textractJobStatus: "SUCCEEDED",
        }),
        "utf8",
      );
      await writeFile(extractedTextPath, ocrText, "utf8");

      const documents = await extractDocumentsFromArtifacts([
        buildArtifact({
          artifactType: "OASIS",
          portalLabel: "OASIS",
          extractedFields: {
            admissionOrderTitle: "Christine Young Referral/Order",
            admissionOrderTextExcerpt: viewerText,
            admissionOrderSourcePdfPath: pdfPath,
            possibleIcd10Codes: "",
          },
        }),
      ]);

      const orderDocument = documents.find((document) => document.type === "ORDER");
      expect(orderDocument).toBeDefined();
      expect(orderDocument?.metadata.rawExtractedTextSource).toBe("ocr");
      expect(orderDocument?.metadata.textSelectionReason).toBe("preferred_ocr_for_scanned_image_pdf");
      expect(orderDocument?.metadata.possibleIcd10Codes).toEqual(expect.arrayContaining([
        "J18.9",
        "J96.01",
        "R13.12",
        "I48.20",
        "I50.33",
        "G93.41",
        "I87.313",
        "R41.841",
        "M62.81",
        "R26.2",
        "E03.9",
        "F32.A",
        "I11.0",
        "K92.1",
        "N17.9",
      ]));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps selectable PDFs on the DOM extraction path", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dom-doc-"));

    try {
      const pdfPath = path.join(tempDir, "digital.pdf");
      const selectableText = [
        "Primary Diagnosis J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
        "Other Diagnosis R13.12 DYSPHAGIA, OROPHARYNGEAL PHASE",
      ].join(" ");

      await writeFile(
        pdfPath,
        `%PDF-1.4 BT (${selectableText}) Tj ET`,
        "latin1",
      );

      const documents = await extractDocumentsFromArtifacts([
        buildArtifact({
          downloadPath: pdfPath,
        }),
      ]);

      const orderDocument = documents.find((document) => document.type === "ORDER");
      expect(orderDocument).toBeDefined();
      expect(orderDocument?.metadata.rawExtractedTextSource).toBe("dom");
      expect(orderDocument?.metadata.ocrUsed).toBe(false);
      expect(orderDocument?.metadata.possibleIcd10Codes).toEqual(expect.arrayContaining([
        "J18.9",
        "R13.12",
      ]));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not create an ORDER document from rejected viewer-only excerpt text", async () => {
    const documents = await extractDocumentsFromArtifacts([
      buildArtifact({
        artifactType: "OASIS",
        extractedFields: {
          admissionOrderTitle: "Viewer Capture",
          admissionOrderTextExcerpt: "Automatic Zoom Actual Size Page Fit Page Width Tools Print",
          rawExtractedTextSource: "dom",
          domExtractionRejectedReasons: "viewer_chrome_text:AUTOMATIC ZOOM|ACTUAL SIZE|PAGE FIT|PAGE WIDTH|TOOLS",
        },
      }),
    ]);

    expect(documents.some((document) => document.type === "ORDER")).toBe(false);
  });
});
