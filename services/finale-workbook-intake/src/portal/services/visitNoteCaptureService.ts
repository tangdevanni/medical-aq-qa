import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VisitNoteDiscoveryRow, VisitNoteStatus, VisitNoteType } from "@medical-ai-qa/shared-types";
import {
  getClinicalTextQualityReason,
  sanitizeClinicalSnippet,
} from "../../services/clinicalTextQualityService";
import { buildVisitNoteCacheKey } from "./visitNotesControlledCaptureService";

export const VISIT_NOTE_SOURCE_META_FILE_NAME = "source-meta.json";
export const VISIT_NOTE_EXTRACTED_TEXT_FILE_NAME = "extracted-text.txt";
export const VISIT_NOTE_EXTRACTION_RESULT_FILE_NAME = "extraction-result.json";
export const VISIT_NOTE_OCR_RESULT_FILE_NAME = "ocr-result.json";

const UNSAFE_ACTION_PATTERN = /\b(delete|edit|submit|sign|e-?sign|approve|save|void|remove|archive|update|create|add|mark\s+ready\s+for\s+billing|ready\s+for\s+billing)\b/i;
const SAFE_ACTION_PATTERN = /\b(open|view|print|download|pdf|preview)\b/i;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type VisitNoteSourceMeta = {
  visitNoteKey: string;
  rawDocumentType: string;
  normalizedVisitType: VisitNoteType;
  visitDate?: string;
  visitTime?: string;
  assignedStaff?: string;
  statusRaw?: string;
  normalizedStatus?: VisitNoteStatus;
  createdBy?: string;
  portalDocumentId?: string;
  sanitizedEndpointPattern?: string;
  urlHash?: string;
  contentHash?: string;
  textHash?: string;
  captureStrategy:
    | "pdf_export"
    | "print_pdf"
    | "html_text"
    | "source_text"
    | "screenshot_ocr"
    | "unavailable"
    | "safe_row_action"
    | "viewer_endpoint"
    | "screenshot_fallback"
    | "fixture_text";
  captureStatus: "captured" | "failed" | "unavailable";
  extractionQualityStatus?: "usable" | "partial" | "degraded" | "failed";
  failureReason?: string;
  cacheKey: string;
  capturedAt: string;
};

export type VisitNoteExtractionResult = {
  schemaVersion: "visit-note-extraction-result.v1";
  visitNoteKey: string;
  extractionSource: "text_export" | "html_text" | "pdf_text" | "ocr" | "unavailable";
  extractionQualityStatus: NonNullable<VisitNoteSourceMeta["extractionQualityStatus"]>;
  textHash: string | null;
  qualityReason: string | null;
  extractedAt: string;
};

function stripHtmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseExtractedText(input: {
  sourceText?: string | null;
  sourceHtml?: string | null;
  ocrText?: string | null;
}): { text: string; extractionSource: VisitNoteExtractionResult["extractionSource"] } {
  if (input.sourceText?.trim()) {
    return { text: input.sourceText.trim(), extractionSource: "text_export" };
  }
  if (input.sourceHtml?.trim()) {
    return { text: stripHtmlToText(input.sourceHtml), extractionSource: "html_text" };
  }
  if (input.ocrText?.trim()) {
    return { text: input.ocrText.trim(), extractionSource: "ocr" };
  }
  return { text: "", extractionSource: "unavailable" };
}

function qualityStatusForText(text: string): {
  extractionQualityStatus: NonNullable<VisitNoteSourceMeta["extractionQualityStatus"]>;
  qualityReason: string | null;
} {
  const reason = getClinicalTextQualityReason(text);
  if (!text.trim()) {
    return { extractionQualityStatus: "failed", qualityReason: reason ?? "empty_text" };
  }
  if (reason) {
    return { extractionQualityStatus: "degraded", qualityReason: reason };
  }
  const sanitized = sanitizeClinicalSnippet(text, 120);
  return { extractionQualityStatus: sanitized.length >= 20 ? "usable" : "partial", qualityReason: null };
}

export function isUnsafeVisitNoteAction(label: string | null | undefined): boolean {
  return UNSAFE_ACTION_PATTERN.test(label ?? "");
}

export function isSafeVisitNoteAction(label: string | null | undefined): boolean {
  const value = label ?? "";
  return SAFE_ACTION_PATTERN.test(value) && !isUnsafeVisitNoteAction(value);
}

export function isSafeVisitNoteOpenCandidate(label: string | null | undefined): boolean {
  const value = label ?? "";
  return isSafeVisitNoteAction(value) || (/\bvisit\s*note\b/i.test(value) && !isUnsafeVisitNoteAction(value));
}

export function sanitizeVisitNoteEndpoint(url: string | null | undefined): string | undefined {
  const value = (url ?? "").trim();
  if (!value) {
    return undefined;
  }
  return value
    .replace(/\/client\/[^/?#]+/i, "/client/<client-id>")
    .replace(/\/document\/[^/?#]+/i, "/document/<document-id>")
    .replace(/[?&](token|auth|signature|download|file)=[^&#]+/gi, "$1=<redacted>");
}

export function buildVisitNoteSourceMeta(input: {
  row: VisitNoteDiscoveryRow;
  capturedAt?: string;
  sourceUrl?: string | null;
  sourceContent?: string | Buffer | null;
  extractedText?: string | null;
  captureStrategy: VisitNoteSourceMeta["captureStrategy"];
  captureStatus?: VisitNoteSourceMeta["captureStatus"];
  extractionQualityStatus?: VisitNoteSourceMeta["extractionQualityStatus"];
  failureReason?: string | null;
}): VisitNoteSourceMeta {
  const contentHash = input.sourceContent
    ? sha256(Buffer.isBuffer(input.sourceContent) ? input.sourceContent.toString("base64") : input.sourceContent)
    : undefined;
  const textHash = input.extractedText?.trim() ? sha256(input.extractedText) : undefined;
  const sanitizedEndpointPattern = sanitizeVisitNoteEndpoint(input.sourceUrl);
  return {
    visitNoteKey: input.row.visitNoteKey,
    rawDocumentType: input.row.rawDocumentType,
    normalizedVisitType: input.row.normalizedVisitType,
    ...(input.row.visitDate ? { visitDate: input.row.visitDate } : {}),
    ...(input.row.visitTime ? { visitTime: input.row.visitTime } : {}),
    ...(input.row.assignedStaffRaw ? { assignedStaff: input.row.assignedStaffRaw } : {}),
    ...(input.row.statusRaw ? { statusRaw: input.row.statusRaw } : {}),
    ...(input.row.normalizedStatus ? { normalizedStatus: input.row.normalizedStatus } : {}),
    ...(input.row.createdBy ? { createdBy: input.row.createdBy } : {}),
    ...(input.row.portalDocumentId ? { portalDocumentId: input.row.portalDocumentId } : {}),
    ...(sanitizedEndpointPattern ? { sanitizedEndpointPattern } : {}),
    ...(input.sourceUrl ? { urlHash: sha256(input.sourceUrl) } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(textHash ? { textHash } : {}),
    captureStrategy: input.captureStrategy,
    captureStatus: input.captureStatus ?? "captured",
    ...(input.extractionQualityStatus ? { extractionQualityStatus: input.extractionQualityStatus } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    cacheKey: buildVisitNoteCacheKey(input.row),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export async function persistVisitNoteCaptureResult(input: {
  patientArtifactsDirectory: string;
  row: VisitNoteDiscoveryRow;
  sourceText?: string | null;
  sourceHtml?: string | null;
  sourcePdf?: Buffer | null;
  ocrText?: string | null;
  sourceUrl?: string | null;
  captureStrategy: VisitNoteSourceMeta["captureStrategy"];
  captureStatus?: VisitNoteSourceMeta["captureStatus"];
  failureReason?: string | null;
  capturedAt?: string;
}): Promise<{
  noteDirectory: string;
  sourceMetaPath: string;
  extractedTextPath: string;
  extractionResultPath: string;
  sourceMeta: VisitNoteSourceMeta;
  extractionResult: VisitNoteExtractionResult;
}> {
  const noteDirectory = path.join(input.patientArtifactsDirectory, "documents", "visit-notes", input.row.visitNoteKey);
  await mkdir(noteDirectory, { recursive: true });
  const { text, extractionSource } = chooseExtractedText(input);
  const quality = qualityStatusForText(text);
  const sourceContent = input.sourceText ?? input.sourceHtml ?? input.sourcePdf ?? input.ocrText ?? "";
  const sourceMeta = buildVisitNoteSourceMeta({
    row: input.row,
    extractedText: text,
    sourceContent,
    sourceUrl: input.sourceUrl,
    captureStrategy: input.captureStrategy,
    captureStatus: input.captureStatus ?? (text.trim() ? "captured" : "failed"),
    extractionQualityStatus: quality.extractionQualityStatus,
    failureReason: input.failureReason ?? quality.qualityReason,
    capturedAt: input.capturedAt,
  });
  const sourceMetaPath = path.join(noteDirectory, VISIT_NOTE_SOURCE_META_FILE_NAME);
  const extractedTextPath = path.join(noteDirectory, VISIT_NOTE_EXTRACTED_TEXT_FILE_NAME);
  const extractionResultPath = path.join(noteDirectory, VISIT_NOTE_EXTRACTION_RESULT_FILE_NAME);
  const extractionResult: VisitNoteExtractionResult = {
    schemaVersion: "visit-note-extraction-result.v1",
    visitNoteKey: input.row.visitNoteKey,
    extractionSource,
    extractionQualityStatus: quality.extractionQualityStatus,
    textHash: sourceMeta.textHash ?? null,
    qualityReason: quality.qualityReason,
    extractedAt: sourceMeta.capturedAt,
  };
  if (input.sourceText != null) {
    await writeFile(path.join(noteDirectory, "source.txt"), input.sourceText, "utf8");
  }
  if (input.sourceHtml != null) {
    await writeFile(path.join(noteDirectory, "source.html"), input.sourceHtml, "utf8");
  }
  if (input.sourcePdf) {
    await writeFile(path.join(noteDirectory, "source.pdf"), input.sourcePdf);
  }
  if (input.ocrText != null) {
    await writeFile(path.join(noteDirectory, VISIT_NOTE_OCR_RESULT_FILE_NAME), JSON.stringify({
      schemaVersion: "visit-note-ocr-result.v1",
      visitNoteKey: input.row.visitNoteKey,
      textHash: input.ocrText.trim() ? sha256(input.ocrText) : null,
      capturedAt: sourceMeta.capturedAt,
    }, null, 2), "utf8");
  }
  await writeFile(sourceMetaPath, JSON.stringify(sourceMeta, null, 2), "utf8");
  await writeFile(extractedTextPath, text, "utf8");
  await writeFile(extractionResultPath, JSON.stringify(extractionResult, null, 2), "utf8");
  return { noteDirectory, sourceMetaPath, extractedTextPath, extractionResultPath, sourceMeta, extractionResult };
}

export async function writeVisitNoteTextCaptureFixture(input: {
  patientArtifactsDirectory: string;
  row: VisitNoteDiscoveryRow;
  text: string;
  capturedAt?: string;
}): Promise<{
  noteDirectory: string;
  sourceMetaPath: string;
  extractedTextPath: string;
  sourceMeta: VisitNoteSourceMeta;
}> {
  const written = await persistVisitNoteCaptureResult({
    patientArtifactsDirectory: input.patientArtifactsDirectory,
    row: input.row,
    sourceText: input.text,
    captureStrategy: "fixture_text",
    capturedAt: input.capturedAt,
  });
  return {
    noteDirectory: written.noteDirectory,
    sourceMetaPath: written.sourceMetaPath,
    extractedTextPath: written.extractedTextPath,
    sourceMeta: written.sourceMeta,
  };
}
