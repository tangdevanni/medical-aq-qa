import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("repairs stale extracted-text artifacts from saved Textract blocks", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ocr-doc-repair-"));

    try {
      const pdfPath = path.join(tempDir, "source.pdf");
      const ocrResultPath = path.join(tempDir, "ocr-result.json");
      const extractedTextPath = path.join(tempDir, "extracted-text.txt");
      const staleViewerText = "Automatic Zoom Actual Size Page Fit Page Width Tools";
      const repairedOcrText = [
        "Reason for referral: skilled nursing for CHF management.",
        "Primary diagnosis I50.9 Heart failure, unspecified.",
        "Homebound due to weakness and fall risk.",
      ].join("\n");

      await writeFile(
        pdfPath,
        `%PDF-1.4 /Subtype /Image BT (${staleViewerText}) Tj ET`,
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
          ocrTextLength: repairedOcrText.length,
          blocks: repairedOcrText.split("\n").map((text, index) => ({
            blockType: "LINE",
            text,
            page: index + 1,
          })),
        }),
        "utf8",
      );
      await writeFile(extractedTextPath, staleViewerText, "utf8");

      const documents = await extractDocumentsFromArtifacts([
        buildArtifact({
          artifactType: "OASIS",
          portalLabel: "OASIS",
          extractedFields: {
            admissionOrderTitle: "Nancy Haug Referral/Order",
            admissionOrderTextExcerpt: staleViewerText,
            admissionOrderSourcePdfPath: pdfPath,
          },
        }),
      ]);

      const orderDocument = documents.find((document) => document.type === "ORDER");
      expect(orderDocument).toBeDefined();
      expect(orderDocument?.text).toContain("Reason for referral: skilled nursing for CHF management.");
      expect(orderDocument?.text).toContain("\nPrimary diagnosis I50.9");
      expect(orderDocument?.metadata.rawExtractedTextSource).toBe("ocr");
      expect(orderDocument?.metadata.textSelectionReason).toBe("preferred_ocr_for_scanned_image_pdf");
      await expect(readFile(extractedTextPath, "utf8")).resolves.toContain("Primary diagnosis I50.9");
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

  it("uses a persisted html_text policy to prefer html over a noisier pdf path", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "html-policy-doc-"));

    try {
      const pdfPath = path.join(tempDir, "source.pdf");
      const htmlPath = path.join(tempDir, "source.html");
      const sourceMetaPath = path.join(tempDir, "source-meta.json");

      await writeFile(
        pdfPath,
        "%PDF-1.4 /Subtype /Image",
        "latin1",
      );
      await writeFile(
        htmlPath,
        "<html><body><h1>Admission Order</h1><p>Reason for admission pneumonia with skilled nursing follow-up and medication management.</p></body></html>",
        "utf8",
      );
      await writeFile(
        sourceMetaPath,
        JSON.stringify({
          extractionPolicyDecision: {
            mode: "html_text",
            confidence: "high",
            reasons: ["HTML source available and likely lower-noise than scanned print PDF"],
            recommendedSourcePath: htmlPath,
            fallbackSourcePath: pdfPath,
            hasUsablePdfTextLayer: false,
            hasPdfSource: true,
            hasPrintedPdfSource: false,
            hasHtmlSource: true,
          },
        }),
        "utf8",
      );

      const documents = await extractDocumentsFromArtifacts([
        buildArtifact({
          downloadPath: pdfPath,
        }),
      ]);

      const orderDocument = documents.find((document) => document.type === "ORDER");
      expect(orderDocument).toBeDefined();
      expect(orderDocument?.text).toContain("Reason for admission pneumonia");
      expect(orderDocument?.metadata.textSelectionReason).toBe("policy_html_text_selected");
      expect(orderDocument?.metadata.extractionPolicyMode).toBe("html_text");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses a persisted ocr_required policy to bypass native-first selection", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ocr-policy-doc-"));

    try {
      const pdfPath = path.join(tempDir, "source.pdf");
      const ocrResultPath = path.join(tempDir, "ocr-result.json");
      const extractedTextPath = path.join(tempDir, "extracted-text.txt");
      const sourceMetaPath = path.join(tempDir, "source-meta.json");
      const nativePdfText = "Primary Diagnosis J18.9 PNEUMONIA, UNSPECIFIED ORGANISM";
      const ocrText = [
        "Reason for referral: skilled nursing for CHF management.",
        "Primary diagnosis I50.9 Heart failure, unspecified.",
      ].join("\n");

      await writeFile(pdfPath, `%PDF-1.4 BT (${nativePdfText}) Tj ET`, "latin1");
      await writeFile(
        sourceMetaPath,
        JSON.stringify({
          extractionPolicyDecision: {
            mode: "ocr_required",
            confidence: "high",
            reasons: ["Printed PDF exists but appears image-based; OCR required"],
            recommendedSourcePath: pdfPath,
            fallbackSourcePath: pdfPath,
            hasUsablePdfTextLayer: false,
            hasPdfSource: true,
            hasPrintedPdfSource: false,
            hasHtmlSource: false,
          },
        }),
        "utf8",
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
          blocks: ocrText.split("\n").map((text, index) => ({
            blockType: "LINE",
            text,
            page: index + 1,
          })),
        }),
        "utf8",
      );
      await writeFile(extractedTextPath, ocrText, "utf8");

      const documents = await extractDocumentsFromArtifacts([
        buildArtifact({
          downloadPath: pdfPath,
        }),
      ]);

      const orderDocument = documents.find((document) => document.type === "ORDER");
      expect(orderDocument).toBeDefined();
      expect(orderDocument?.text).toContain("Reason for referral: skilled nursing for CHF management.");
      expect(orderDocument?.metadata.textSelectionReason).toContain("policy_ocr_required_direct_ocr");
      expect(orderDocument?.metadata.extractionPolicyMode).toBe("ocr_required");
      expect(orderDocument?.metadata.rawExtractedTextSource).toBe("ocr");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
