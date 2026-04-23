export type RawExtractedTextSource = "dom" | "ocr" | "hybrid";

export type PdfTextKind = "digital_text_pdf" | "scanned_image_pdf";

export type DocumentTextAnalysis = {
  normalizedText: string;
  viewerChromePhrases: string[];
  viewerChromeDetected: boolean;
  lowSignal: boolean;
  clinicalSignalCount: number;
  possibleIcd10CodeCount: number;
  pdfStructureTokenCount: number;
  rawPdfStructureDetected: boolean;
  rejectionReasons: string[];
  accepted: boolean;
};

export type PreferredDocumentTextSelection = {
  text: string;
  rawExtractedTextSource: RawExtractedTextSource;
  usedOcr: boolean;
  selectionReason: string;
  domAnalysis: DocumentTextAnalysis;
};

const ICD10_EXACT_REGEX = /^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/;
const ICD10_OCR_FRIENDLY_CAPTURE_REGEX =
  /(?:^|[^A-Z0-9])([A-TV-Z1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)(?=$|[^A-Z0-9])/gi;

const VIEWER_CHROME_PHRASES = [
  "AUTOMATIC ZOOM",
  "ACTUAL SIZE",
  "PAGE FIT",
  "PAGE WIDTH",
  "TOOLS",
  "PRINT",
];

const CLINICAL_SIGNAL_PATTERNS = [
  /\bPATIENT\b/i,
  /\bDIAGNOS(?:IS|ES)\b/i,
  /\bADMISSION\b/i,
  /\bREFERRAL\b/i,
  /\bHOME HEALTH\b/i,
  /\bMEDICATION\b/i,
  /\bALLERG(?:Y|IES)\b/i,
  /\bASSESSMENT\b/i,
  /\bSKILLED\b/i,
  /\bPHYSICIAN\b/i,
  /\bORDER\b/i,
  /\bREASON FOR ADMISSION\b/i,
];

const PDF_STRUCTURE_TOKEN_PATTERN =
  /\b(?:obj|endobj|stream|endstream|xref|trailer|startxref|catalog|pages|mediaBox|cropBox|bleedBox|trimBox|flateDecode|xobject|iccBased|metadata|producer|creationdate)\b/gi;
const RAW_PDF_HEADER_PATTERN = /^(?:%?PDF-\d\.\d\b)/i;

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeDocumentText(value: string | null | undefined): string {
  return value
    ?.replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPhrasePattern(phrase: string): RegExp {
  const pattern = phrase
    .split(/\s+/)
    .map((part) => escapeRegExp(part))
    .join("\\s+");
  return new RegExp(`(?:^|\\b)${pattern}(?=\\b|$)`, "i");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeIcd10Code(value: unknown): string | null {
  const normalized = normalizeWhitespace(typeof value === "string" ? value : String(value ?? ""))
    .toUpperCase()
    .replace(/^[^A-Z0-9|L]+|[^A-Z0-9.]+$/g, "");

  if (!normalized) {
    return null;
  }

  if (ICD10_EXACT_REGEX.test(normalized)) {
    return normalized;
  }

  if (/^[1|L][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/.test(normalized)) {
    const repaired = `I${normalized.slice(1)}`;
    return ICD10_EXACT_REGEX.test(repaired) ? repaired : null;
  }

  return null;
}

export function extractPossibleIcd10Codes(text: string): string[] {
  const normalized = normalizeWhitespace(text).toUpperCase();
  if (!normalized) {
    return [];
  }

  const matches = Array.from(
    normalized.matchAll(ICD10_OCR_FRIENDLY_CAPTURE_REGEX),
    (match) => normalizeIcd10Code(match[1] ?? ""),
  ).filter((code): code is string => Boolean(code));

  return unique(matches);
}

export function analyzeDocumentText(text: string): DocumentTextAnalysis {
  const normalizedText = normalizeWhitespace(text);
  const viewerChromePhrases = VIEWER_CHROME_PHRASES.filter((phrase) => buildPhrasePattern(phrase).test(normalizedText));
  const clinicalSignalCount = CLINICAL_SIGNAL_PATTERNS.filter((pattern) => pattern.test(normalizedText)).length;
  const possibleIcd10CodeCount = extractPossibleIcd10Codes(normalizedText).length;
  const pdfStructureTokenCount = normalizedText.match(PDF_STRUCTURE_TOKEN_PATTERN)?.length ?? 0;
  const viewerChromeDetected =
    viewerChromePhrases.length >= 2 ||
    (viewerChromePhrases.length >= 1 && clinicalSignalCount === 0 && possibleIcd10CodeCount === 0);
  const lowSignal =
    normalizedText.length > 0 &&
    normalizedText.length < 160 &&
    clinicalSignalCount === 0 &&
    possibleIcd10CodeCount === 0;
  const rawPdfStructureDetected =
    normalizedText.length > 0 &&
    (
      RAW_PDF_HEADER_PATTERN.test(normalizedText) ||
      pdfStructureTokenCount >= 8
    ) &&
    clinicalSignalCount < 4 &&
    possibleIcd10CodeCount < 2;

  const rejectionReasons: string[] = [];
  if (viewerChromeDetected) {
    rejectionReasons.push(
      `viewer_chrome_text:${viewerChromePhrases.join("|") || "viewer_controls_detected"}`,
    );
  }
  if (rawPdfStructureDetected) {
    rejectionReasons.push("pdf_structure_text");
  }
  if (lowSignal) {
    rejectionReasons.push("low_signal_text");
  }

  return {
    normalizedText,
    viewerChromePhrases,
    viewerChromeDetected,
    lowSignal,
    clinicalSignalCount,
    possibleIcd10CodeCount,
    pdfStructureTokenCount,
    rawPdfStructureDetected,
    rejectionReasons,
    accepted: rejectionReasons.length === 0,
  };
}

export function selectPreferredDocumentText(input: {
  pdfType: PdfTextKind | null;
  domText: string;
  ocrText?: string | null;
  ocrSuccess?: boolean;
}): PreferredDocumentTextSelection {
  const domAnalysis = analyzeDocumentText(input.domText);
  const normalizedOcrText = normalizeDocumentText(input.ocrText ?? "");
  const ocrSuccess = Boolean(input.ocrSuccess && normalizedOcrText);

  if (ocrSuccess && input.pdfType === "scanned_image_pdf") {
    return {
      text: normalizedOcrText,
      rawExtractedTextSource: "ocr",
      usedOcr: true,
      selectionReason: "preferred_ocr_for_scanned_image_pdf",
      domAnalysis,
    };
  }

  if (ocrSuccess && !domAnalysis.accepted) {
    return {
      text: normalizedOcrText,
      rawExtractedTextSource: "ocr",
      usedOcr: true,
      selectionReason: `preferred_ocr_after_dom_rejection:${domAnalysis.rejectionReasons.join("|")}`,
      domAnalysis,
    };
  }

  if (domAnalysis.accepted) {
    return {
      text: domAnalysis.normalizedText,
      rawExtractedTextSource: "dom",
      usedOcr: false,
      selectionReason: "accepted_dom_text",
      domAnalysis,
    };
  }

  return {
    text: "",
    rawExtractedTextSource: "dom",
    usedOcr: false,
    selectionReason: `rejected_dom_without_usable_ocr:${domAnalysis.rejectionReasons.join("|")}`,
    domAnalysis,
  };
}
