import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { CapturedChartDocument } from "../portal/services/chartDocumentCaptureService";
import {
  analyzeDocumentText,
  type PdfTextKind,
} from "./documentTextAnalysis";

export type ExtractionMode =
  | "native_text"
  | "ocr_required"
  | "hybrid_candidate"
  | "html_text"
  | "unusable";

export interface DocumentExtractionPolicyDecision {
  mode: ExtractionMode;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  recommendedSourcePath?: string;
  fallbackSourcePath?: string;
  hasUsablePdfTextLayer: boolean;
  hasPdfSource: boolean;
  hasPrintedPdfSource: boolean;
  hasHtmlSource: boolean;
}

interface HtmlProbe {
  exists: boolean;
  path?: string;
  usable: boolean;
  textLength: number;
  reasons: string[];
}

interface PdfProbe {
  exists: boolean;
  path?: string;
  pdfType?: PdfTextKind;
  usableTextLayer: boolean;
  ambiguous: boolean;
  textLength: number;
  reasons: string[];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&"),
  );
}

function extractPdfText(buffer: Buffer): string {
  const latin1 = buffer.toString("latin1");
  const textOperators = Array.from(
    latin1.matchAll(/\(([^()]*)\)\s*T[Jj]/g),
    (match) => match[1]?.replace(/\\([()\\])/g, "$1") ?? "",
  );
  const printableRuns = latin1.match(/[A-Za-z0-9][A-Za-z0-9 ,.;:()\/_\-\n]{4,}/g) ?? [];
  return normalizeWhitespace([...textOperators, ...printableRuns].join(" "));
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function classifyPdfBuffer(buffer: Buffer, extractedText: string): PdfTextKind {
  const latin1 = buffer.toString("latin1");
  const normalizedText = normalizeWhitespace(extractedText);
  const imageObjectCount = countMatches(latin1, /\/Subtype\s*\/Image\b/g);
  const pdfStructureTokenCount = countMatches(
    normalizedText,
    /\b(?:obj|endobj|stream|endstream|FlateDecode|XObject|BitsPerComponent|ColorSpace|MediaBox|xref|trailer|startxref)\b/g,
  );
  const clinicalSignalCount = countMatches(
    normalizedText,
    /\b(?:patient|diagnosis|admission|referral|home health|history|physical|medication|allergies|assessment|icd|skilled)\b/gi,
  );
  const alphaLength = normalizedText.replace(/[^A-Za-z]/g, "").length;
  const alphaRatio = normalizedText.length > 0 ? alphaLength / normalizedText.length : 0;

  if (
    imageObjectCount > 0 &&
    (
      normalizedText.length < 500 ||
      (pdfStructureTokenCount >= 12 && clinicalSignalCount < 6) ||
      alphaRatio < 0.55
    )
  ) {
    return "scanned_image_pdf";
  }

  return "digital_text_pdf";
}

async function hasFile(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function probeHtmlSource(filePath: string | undefined): Promise<HtmlProbe> {
  if (!(await hasFile(filePath))) {
    return {
      exists: false,
      usable: false,
      textLength: 0,
      reasons: ["html source missing"],
    };
  }

  const html = await readFile(filePath!, "utf8");
  const text = stripHtml(html);
  const analysis = analyzeDocumentText(text);
  const usable = analysis.accepted && analysis.normalizedText.length >= 120;

  return {
    exists: true,
    path: filePath,
    usable,
    textLength: analysis.normalizedText.length,
    reasons: usable
      ? ["HTML source available and likely lower-noise than PDF viewer capture"]
      : analysis.rejectionReasons.length > 0
      ? analysis.rejectionReasons
      : ["html text too short for clinically meaningful extraction"],
  };
}

async function probePdfSource(filePath: string | undefined): Promise<PdfProbe> {
  if (!(await hasFile(filePath))) {
    return {
      exists: false,
      usableTextLayer: false,
      ambiguous: false,
      textLength: 0,
      reasons: ["pdf source missing"],
    };
  }

  const buffer = await readFile(filePath!);
  const extractedText = extractPdfText(buffer);
  const pdfType = classifyPdfBuffer(buffer, extractedText);
  const analysis = analyzeDocumentText(extractedText);
  const usableTextLayer =
    pdfType === "digital_text_pdf" &&
    analysis.accepted &&
    analysis.normalizedText.length >= 160;
  const ambiguous =
    pdfType === "digital_text_pdf" &&
    !usableTextLayer &&
    analysis.normalizedText.length >= 40;

  return {
    exists: true,
    path: filePath,
    pdfType,
    usableTextLayer,
    ambiguous,
    textLength: analysis.normalizedText.length,
    reasons: usableTextLayer
      ? ["PDF contains usable text layer; OCR unnecessary"]
      : pdfType === "scanned_image_pdf"
      ? ["PDF appears image-based/scanned; OCR likely required"]
      : ambiguous
      ? ["PDF has partial text layer signals but native extraction quality is uncertain"]
      : analysis.rejectionReasons.length > 0
      ? analysis.rejectionReasons
      : ["pdf text layer is too weak for reliable native extraction"],
  };
}

function buildDecision(input: DocumentExtractionPolicyDecision): DocumentExtractionPolicyDecision {
  return input;
}

export async function decideDocumentExtractionPolicy(
  captured: CapturedChartDocument,
): Promise<DocumentExtractionPolicyDecision> {
  const hasHtmlSource = Boolean(captured.htmlPath && path.extname(captured.htmlPath).toLowerCase().includes("htm"));
  const hasPdfSource = Boolean(captured.sourcePdfPath && path.extname(captured.sourcePdfPath).toLowerCase() === ".pdf");
  const hasPrintedPdfSource = Boolean(captured.printedPdfPath && path.extname(captured.printedPdfPath).toLowerCase() === ".pdf");

  const htmlProbe = await probeHtmlSource(captured.htmlPath);
  const sourcePdfProbe = await probePdfSource(captured.sourcePdfPath);
  const printedPdfProbe = await probePdfSource(captured.printedPdfPath);
  const hasUsablePdfTextLayer = sourcePdfProbe.usableTextLayer || printedPdfProbe.usableTextLayer;

  if (htmlProbe.usable) {
    return buildDecision({
      mode: "html_text",
      confidence: sourcePdfProbe.usableTextLayer ? "medium" : "high",
      reasons: [
        ...htmlProbe.reasons,
        sourcePdfProbe.usableTextLayer
          ? "HTML chosen because it is likely smaller and lower-noise than the available PDF text layer"
          : "HTML chosen because it avoids unnecessary OCR cost",
      ],
      recommendedSourcePath: htmlProbe.path,
      fallbackSourcePath: sourcePdfProbe.path ?? printedPdfProbe.path,
      hasUsablePdfTextLayer,
      hasPdfSource,
      hasPrintedPdfSource,
      hasHtmlSource,
    });
  }

  if (sourcePdfProbe.usableTextLayer) {
    return buildDecision({
      mode: "native_text",
      confidence: "high",
      reasons: sourcePdfProbe.reasons,
      recommendedSourcePath: sourcePdfProbe.path,
      fallbackSourcePath: printedPdfProbe.path,
      hasUsablePdfTextLayer,
      hasPdfSource,
      hasPrintedPdfSource,
      hasHtmlSource,
    });
  }

  if (printedPdfProbe.usableTextLayer) {
    return buildDecision({
      mode: "native_text",
      confidence: "medium",
      reasons: [
        ...printedPdfProbe.reasons,
        "Printed PDF text layer is acceptable and cheaper than OCR",
      ],
      recommendedSourcePath: printedPdfProbe.path,
      fallbackSourcePath: sourcePdfProbe.path,
      hasUsablePdfTextLayer,
      hasPdfSource,
      hasPrintedPdfSource,
      hasHtmlSource,
    });
  }

  if (sourcePdfProbe.ambiguous || printedPdfProbe.ambiguous) {
    return buildDecision({
      mode: "hybrid_candidate",
      confidence: "medium",
      reasons: [
        sourcePdfProbe.ambiguous
          ? "Source PDF shows partial text-layer signals; native extraction may be incomplete"
          : "Source PDF is not clearly usable for native extraction",
        printedPdfProbe.ambiguous
          ? "Printed PDF also shows partial text-layer signals"
          : "Printed PDF is not clearly usable for native extraction",
        "Mixed signals suggest trying native extraction first with OCR fallback",
      ],
      recommendedSourcePath: sourcePdfProbe.path ?? printedPdfProbe.path,
      fallbackSourcePath: printedPdfProbe.path ?? sourcePdfProbe.path,
      hasUsablePdfTextLayer,
      hasPdfSource,
      hasPrintedPdfSource,
      hasHtmlSource,
    });
  }

  if (sourcePdfProbe.exists || printedPdfProbe.exists) {
    return buildDecision({
      mode: "ocr_required",
      confidence: "high",
      reasons: [
        sourcePdfProbe.exists
          ? sourcePdfProbe.reasons[0] ?? "Source PDF requires OCR"
          : "No native source PDF available",
        printedPdfProbe.exists
          ? printedPdfProbe.reasons[0] ?? "Printed PDF requires OCR"
          : "No printed PDF available",
        "OCR is the cheapest acceptable option that preserves clinically meaningful content",
      ],
      recommendedSourcePath: sourcePdfProbe.path ?? printedPdfProbe.path,
      fallbackSourcePath: printedPdfProbe.path ?? sourcePdfProbe.path,
      hasUsablePdfTextLayer,
      hasPdfSource,
      hasPrintedPdfSource,
      hasHtmlSource,
    });
  }

  return buildDecision({
    mode: "unusable",
    confidence: "low",
    reasons: ["No viable HTML or PDF source exists for extraction"],
    hasUsablePdfTextLayer,
    hasPdfSource,
    hasPrintedPdfSource,
    hasHtmlSource,
  });
}
