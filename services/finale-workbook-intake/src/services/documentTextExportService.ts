import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getEffectiveTextSource,
  type EffectiveTextSource,
  type ExtractedDocument,
} from "./documentExtractionService";

export type DocumentTextExportDocument = {
  documentIndex: number;
  type: ExtractedDocument["type"];
  portalLabel: string | null;
  source: "download" | "artifact_fallback" | "admission_order_excerpt" | "printed_pdf";
  sourcePath: string | null;
  textLength: number;
  textPreview: string;
  text: string;
  sections: string[];
  keyPhrases: string[];
  admissionReasonPrimary: string | null;
  admissionReasonSnippets: string[];
  possibleIcd10Codes: string[];
  pdfType: "digital_text_pdf" | "scanned_image_pdf" | null;
  effectiveTextSource: EffectiveTextSource;
  ocrUsed: boolean;
  ocrProvider: "textract" | null;
  ocrMode: "sync_bytes" | "async_s3" | null;
  ocrTextLength: number;
  ocrSuccess: boolean;
  ocrResultPath: string | null;
  ocrError: string | null;
  ocrErrorCategory:
    | "s3UploadAuthorizationFailed"
    | "textractAuthorizationFailed"
    | "missingIamPermission"
    | "textractJobFailed"
    | "ocrConfigurationMissing"
    | "other"
    | null;
  configuredAwsRegion: string | null;
  resolvedBucketRegion: string | null;
  textractRegion: string | null;
  regionMatch: boolean | null;
  regionOverrideUsed: boolean | null;
  s3UploadSucceeded: boolean | null;
  s3UploadError: string | null;
  textractStartSucceeded: boolean | null;
  textractStartError: string | null;
};

export type DocumentTextExportFile = {
  schemaVersion: "1";
  generatedAt: string;
  patientId: string;
  batchId: string;
  documentCount: number;
  orderDocumentCount: number;
  readableDocumentCount: number;
  hasAdmissionOrderText: boolean;
  documents: DocumentTextExportDocument[];
};

export type DocumentTextExportResult = {
  filePath: string;
  document: DocumentTextExportFile;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeWhitespace(String(entry ?? "")))
    .filter(Boolean);
}

export async function writeDocumentTextFile(input: {
  outputDirectory: string;
  patientId: string;
  batchId: string;
  extractedDocuments: ExtractedDocument[];
}): Promise<DocumentTextExportResult> {
  const documents = input.extractedDocuments.map((document, documentIndex) => ({
    documentIndex,
    type: document.type,
    portalLabel: normalizeWhitespace(document.metadata.portalLabel) || null,
    source: document.metadata.source ?? "artifact_fallback",
    sourcePath: normalizeWhitespace(document.metadata.sourcePath) || null,
    textLength: document.metadata.textLength ?? normalizeWhitespace(document.text).length,
    textPreview: normalizeWhitespace(document.metadata.textPreview ?? document.text.slice(0, 500)),
    text: normalizeWhitespace(document.text),
    sections: asStringList(document.metadata.sections),
    keyPhrases: asStringList(document.metadata.keyPhrases),
    admissionReasonPrimary:
      normalizeWhitespace(document.metadata.admissionReasonPrimary) || null,
    admissionReasonSnippets: asStringList(document.metadata.admissionReasonSnippets),
    possibleIcd10Codes: asStringList(document.metadata.possibleIcd10Codes),
    pdfType: document.metadata.pdfType ?? null,
    effectiveTextSource: getEffectiveTextSource(document),
    ocrUsed: document.metadata.ocrUsed ?? false,
    ocrProvider: document.metadata.ocrProvider ?? null,
    ocrMode: document.metadata.ocrMode ?? null,
    ocrTextLength: document.metadata.ocrTextLength ?? 0,
    ocrSuccess: document.metadata.ocrSuccess ?? false,
    ocrResultPath: normalizeWhitespace(document.metadata.ocrResultPath) || null,
    ocrError: normalizeWhitespace(document.metadata.ocrError) || null,
    ocrErrorCategory: document.metadata.ocrErrorCategory ?? null,
    configuredAwsRegion: normalizeWhitespace(document.metadata.configuredAwsRegion) || null,
    resolvedBucketRegion: normalizeWhitespace(document.metadata.resolvedBucketRegion) || null,
    textractRegion: normalizeWhitespace(document.metadata.textractRegion) || null,
    regionMatch: document.metadata.regionMatch ?? null,
    regionOverrideUsed: document.metadata.regionOverrideUsed ?? null,
    s3UploadSucceeded: document.metadata.s3UploadSucceeded ?? null,
    s3UploadError: normalizeWhitespace(document.metadata.s3UploadError) || null,
    textractStartSucceeded: document.metadata.textractStartSucceeded ?? null,
    textractStartError: normalizeWhitespace(document.metadata.textractStartError) || null,
  }));

  const output: DocumentTextExportFile = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    patientId: input.patientId,
    batchId: input.batchId,
    documentCount: documents.length,
    orderDocumentCount: documents.filter((document) => document.type === "ORDER").length,
    readableDocumentCount: documents.filter((document) => document.textLength > 0).length,
    hasAdmissionOrderText: documents.some((document) =>
      document.type === "ORDER" && document.textLength > 0),
    documents,
  };

  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "document-text.json");
  await writeFile(filePath, JSON.stringify(output, null, 2), "utf8");

  return {
    filePath,
    document: output,
  };
}
