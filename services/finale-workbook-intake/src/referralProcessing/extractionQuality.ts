import path from "node:path";
import type { LocalFileTextExtractionResult } from "../services/documentExtractionService";
import { analyzeDocumentText, extractPossibleIcd10Codes } from "../services/documentTextAnalysis";
import type { DocumentExtractionQuality, SourceDocumentFileType } from "./types";

const CLINICAL_VOCABULARY_PATTERNS = [
  /\bpatient\b/i,
  /\bdiagnos(?:is|es)\b/i,
  /\bhome health\b/i,
  /\bskilled\b/i,
  /\btherapy\b/i,
  /\bmedication\b/i,
  /\ballerg(?:y|ies)\b/i,
  /\bdischarge\b/i,
  /\bphysician\b/i,
  /\bcaregiver\b/i,
  /\bhomebound\b/i,
];

const DATE_PATTERNS = [
  /\b\d{2}\/\d{2}\/\d{4}\b/,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i,
];

const SECTION_HEADING_PATTERNS = [
  /^[A-Z][A-Za-z/& ,()-]{3,}$/m,
  /\b(?:Administrative Information|Primary Reason|Medical Necessity|Homebound Status|Past Medical History|Living Situation|Caregiver Info|Diagnosis|Medications and Allergies)\b/i,
];

const CORRUPTED_ENCODING_PATTERNS = [/Ã./, /â./, /�/];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeDocumentText(value: string | null | undefined): string {
  return value
    ?.replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim() ?? "";
}

export function classifySourceDocumentFileType(filePath: string | null | undefined): SourceDocumentFileType {
  const extension = path.extname(filePath ?? "").toLowerCase();
  if (extension === ".pdf") {
    return "pdf";
  }
  if (extension === ".jpg") {
    return "jpg";
  }
  if (extension === ".jpeg") {
    return "jpeg";
  }
  if (extension === ".png") {
    return "png";
  }
  return "unknown";
}

export function evaluateDocumentExtractionQuality(input: {
  text: string;
  extraction: Pick<LocalFileTextExtractionResult, "pdfType" | "rawExtractedTextSource" | "domExtractionRejectedReasons">;
  fileType: SourceDocumentFileType;
}): DocumentExtractionQuality {
  const normalizedText = normalizeDocumentText(input.text);
  const flattenedText = normalizeWhitespace(normalizedText);
  const domAnalysis = analyzeDocumentText(normalizedText);
  const lineCount = normalizedText ? normalizedText.split(/\n+/).filter(Boolean).length : 0;
  const normalizedTokenCount = flattenedText ? flattenedText.split(/\s+/).filter(Boolean).length : 0;
  const clinicalSignalCount = CLINICAL_VOCABULARY_PATTERNS.filter((pattern) => pattern.test(flattenedText)).length;
  const containsClinicalVocabulary = clinicalSignalCount >= 2;
  const containsDiagnosisLikePatterns =
    extractPossibleIcd10Codes(flattenedText).length > 0 ||
    /\b(?:diagnosis|primary diagnosis|other diagnoses|icd-?10|dx)\b/i.test(flattenedText);
  const containsDatePatterns = DATE_PATTERNS.some((pattern) => pattern.test(flattenedText));
  const containsSectionLikeHeadings = SECTION_HEADING_PATTERNS.some((pattern) => pattern.test(normalizedText));
  const likelyCorruptedEncoding = CORRUPTED_ENCODING_PATTERNS.some((pattern) => pattern.test(flattenedText));
  const likelyRequiresOcrRetry =
    (input.fileType === "pdf" && input.extraction.pdfType === "scanned_image_pdf" && flattenedText.length < 300) ||
    ((input.fileType === "jpg" || input.fileType === "jpeg" || input.fileType === "png") && flattenedText.length < 200);

  const rejectedReasons = new Set<DocumentExtractionQuality["rejectedReasons"][number]>();
  if (!normalizedText) {
    rejectedReasons.add("empty_text");
  }
  if (domAnalysis.viewerChromeDetected) {
    rejectedReasons.add("viewer_chrome_only");
  }
  if (flattenedText.length > 0 && flattenedText.length < 180) {
    rejectedReasons.add("too_short");
  }
  if (!containsClinicalVocabulary) {
    rejectedReasons.add("no_clinical_vocabulary");
  }
  if (!containsDatePatterns) {
    rejectedReasons.add("no_date_patterns");
  }
  if (likelyCorruptedEncoding) {
    rejectedReasons.add("corrupted_encoding");
  }
  if (likelyRequiresOcrRetry) {
    rejectedReasons.add("ocr_retry_recommended");
  }
  if (input.fileType === "unknown") {
    rejectedReasons.add("unsupported_file_type");
  }

  const likelyUsableForLlm =
    flattenedText.length >= 120 &&
    containsClinicalVocabulary &&
    (containsDiagnosisLikePatterns || containsSectionLikeHeadings || containsDatePatterns) &&
    !domAnalysis.viewerChromeDetected &&
    !likelyCorruptedEncoding;

  return {
    characterCount: normalizedText.length,
    lineCount,
    normalizedTokenCount,
    containsClinicalVocabulary,
    containsDiagnosisLikePatterns,
    containsDatePatterns,
    containsSectionLikeHeadings,
    likelyUsableForLlm,
    likelyRequiresOcrRetry,
    likelyCorruptedEncoding,
    rejectedReasons: [...rejectedReasons],
    usabilityStatus: likelyUsableForLlm
      ? "usable"
      : likelyRequiresOcrRetry
        ? "needs_ocr_retry"
        : "rejected",
  };
}
