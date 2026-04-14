import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
  type DetectDocumentTextCommandOutput,
  type GetDocumentTextDetectionCommandOutput,
} from "@aws-sdk/client-textract";
import type { ArtifactRecord, DocumentInventoryItem } from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import {
  analyzeDocumentText,
  extractPossibleIcd10Codes,
  selectPreferredDocumentText,
  type PdfTextKind,
  type RawExtractedTextSource,
} from "./documentTextAnalysis";

export type ExtractedDocument = {
  type: "OASIS" | "POC" | "VISIT_NOTE" | "ORDER" | "OTHER";
  text: string;
  metadata: Record<string, any> & {
    source?: "download" | "artifact_fallback" | "admission_order_excerpt" | "printed_pdf";
    effectiveTextSource?: EffectiveTextSource;
    rawExtractedTextSource?: RawExtractedTextSource;
    textSelectionReason?: string;
    domExtractionRejectedReasons?: string[];
    textLength?: number;
    textPreview?: string;
    admissionReasonPrimary?: string | null;
    admissionReasonSnippets?: string[];
    possibleIcd10Codes?: string[];
    pdfType?: "digital_text_pdf" | "scanned_image_pdf" | null;
    ocrUsed?: boolean;
    ocrProvider?: "textract" | null;
    ocrTextLength?: number;
    ocrSuccess?: boolean;
    ocrResultPath?: string | null;
    ocrError?: string | null;
    ocrErrorCategory?: "s3UploadAuthorizationFailed" | "textractAuthorizationFailed" | "missingIamPermission" | "textractJobFailed" | "ocrConfigurationMissing" | "other" | null;
    ocrMode?: "sync_bytes" | "async_s3" | null;
    configuredAwsRegion?: string | null;
    resolvedBucketRegion?: string | null;
    textractRegion?: string | null;
    regionMatch?: boolean | null;
    regionOverrideUsed?: boolean | null;
    s3UploadSucceeded?: boolean | null;
    s3UploadError?: string | null;
    textractStartSucceeded?: boolean | null;
    textractStartError?: string | null;
    inventoryItem?: DocumentInventoryItem | null;
  };
};

export type EffectiveTextSource =
  | "ocr_text"
  | "digital_pdf_text"
  | "raw_pdf_fallback"
  | "viewer_text_fallback";

export type LocalFileTextExtractionResult = {
  text: string;
  pdfType: PdfTextKind | null;
  effectiveTextSource: EffectiveTextSource;
  rawExtractedTextSource: RawExtractedTextSource;
  textSelectionReason: string;
  domExtractionRejectedReasons: string[];
  ocrUsed: boolean;
  ocrProvider: "textract" | null;
  ocrTextLength: number;
  ocrSuccess: boolean;
  ocrResultPath: string | null;
  ocrError: string | null;
  ocrErrorCategory: "s3UploadAuthorizationFailed" | "textractAuthorizationFailed" | "missingIamPermission" | "textractJobFailed" | "ocrConfigurationMissing" | "other" | null;
  ocrMode: "sync_bytes" | "async_s3" | null;
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

type ExtractedTextReadResult = LocalFileTextExtractionResult;

function createExtractedTextReadResult(
  input: Partial<LocalFileTextExtractionResult> & {
    text: string;
    effectiveTextSource: EffectiveTextSource;
  },
): LocalFileTextExtractionResult {
  return {
    text: input.text,
    pdfType: input.pdfType ?? null,
    effectiveTextSource: input.effectiveTextSource,
    rawExtractedTextSource: input.rawExtractedTextSource ?? "dom",
    textSelectionReason: input.textSelectionReason ?? "selected_text_without_explicit_reason",
    domExtractionRejectedReasons: input.domExtractionRejectedReasons ?? [],
    ocrUsed: input.ocrUsed ?? false,
    ocrProvider: input.ocrProvider ?? null,
    ocrTextLength: input.ocrTextLength ?? 0,
    ocrSuccess: input.ocrSuccess ?? false,
    ocrResultPath: input.ocrResultPath ?? null,
    ocrError: input.ocrError ?? null,
    ocrErrorCategory: input.ocrErrorCategory ?? null,
    ocrMode: input.ocrMode ?? null,
    configuredAwsRegion: input.configuredAwsRegion ?? null,
    resolvedBucketRegion: input.resolvedBucketRegion ?? null,
    textractRegion: input.textractRegion ?? null,
    regionMatch: input.regionMatch ?? null,
    regionOverrideUsed: input.regionOverrideUsed ?? null,
    s3UploadSucceeded: input.s3UploadSucceeded ?? null,
    s3UploadError: input.s3UploadError ?? null,
    textractStartSucceeded: input.textractStartSucceeded ?? null,
    textractStartError: input.textractStartError ?? null,
  };
}

const MIN_DIGITAL_PDF_TEXT_LENGTH = 500;
const TEXTRACT_UNSUPPORTED_SYNC_PDF_ERROR = /unsupported document format/i;
const textractClientByRegion = new Map<string, TextractClient>();
const s3ClientByRegion = new Map<string, S3Client>();

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function resolveEffectiveTextSource(input: {
  pdfType?: PdfTextKind | null;
  ocrSuccess?: boolean;
  ocrUsed?: boolean;
}): EffectiveTextSource {
  if (input.ocrSuccess && input.ocrUsed) {
    return "ocr_text";
  }
  if (input.pdfType === "digital_text_pdf") {
    return "digital_pdf_text";
  }
  if (input.pdfType === "scanned_image_pdf") {
    return "raw_pdf_fallback";
  }
  return "viewer_text_fallback";
}

export function getEffectiveTextSource(document: Pick<ExtractedDocument, "metadata">): EffectiveTextSource {
  return resolveEffectiveTextSource({
    pdfType: document.metadata.pdfType ?? null,
    ocrSuccess: document.metadata.ocrSuccess ?? false,
    ocrUsed: document.metadata.ocrUsed ?? false,
  });
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
      normalizedText.length < MIN_DIGITAL_PDF_TEXT_LENGTH ||
      (pdfStructureTokenCount >= 12 && clinicalSignalCount < 6) ||
      alphaRatio < 0.55
    )
  ) {
    return "scanned_image_pdf";
  }

  return "digital_text_pdf";
}

function getTextractClient(region: string): TextractClient {
  const existing = textractClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new TextractClient({ region });
  textractClientByRegion.set(region, client);
  return client;
}

function getS3Client(region: string): S3Client {
  const existing = s3ClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new S3Client({ region });
  s3ClientByRegion.set(region, client);
  return client;
}

function resolveTextractRegionConfig(): {
  configuredAwsRegion: string;
  textractRegion: string;
  resolvedBucketRegion: string;
  regionOverrideUsed: boolean;
  regionMatch: boolean;
} {
  const env = loadEnv();
  const configuredAwsRegion = normalizeWhitespace(env.BEDROCK_REGION ?? "") || "us-east-1";
  const overrideRegion = normalizeWhitespace(env.TEXTRACT_S3_REGION ?? "");
  const textractRegion = overrideRegion || configuredAwsRegion;
  const regionOverrideUsed = Boolean(overrideRegion);
  return {
    configuredAwsRegion,
    textractRegion,
    resolvedBucketRegion: textractRegion,
    regionOverrideUsed,
    regionMatch: true,
  };
}

function resolveTextractS3Bucket(): string | null {
  const env = loadEnv();
  return normalizeWhitespace(env.TEXTRACT_S3_BUCKET ?? "") || null;
}

function resolveTextractS3Prefix(): string {
  const env = loadEnv();
  const prefix = normalizeWhitespace(env.TEXTRACT_S3_PREFIX ?? "");
  return prefix || "finale-workbook-intake/textract";
}

function resolveTextractPollIntervalMs(): number {
  return loadEnv().TEXTRACT_POLL_INTERVAL_MS;
}

function resolveTextractJobTimeoutMs(): number {
  return loadEnv().TEXTRACT_JOB_TIMEOUT_MS;
}

function extractTextractTextFromBlocks(blocks: Block[] | undefined): string {
  const lines = (blocks ?? [])
    .filter((block): block is Block => Boolean(block) && block.BlockType === "LINE")
    .map((block: Block) => normalizeWhitespace(block.Text ?? ""))
    .filter(Boolean);
  return normalizeWhitespace(lines.join("\n"));
}

function extractTextractText(response: DetectDocumentTextCommandOutput): string {
  return extractTextractTextFromBlocks(response.Blocks);
}

function shouldFallbackToAsyncTextract(ocrError: string): boolean {
  return TEXTRACT_UNSUPPORTED_SYNC_PDF_ERROR.test(ocrError);
}

function classifyOcrError(input: {
  message: string;
  s3UploadSucceeded: boolean;
  textractStartSucceeded: boolean;
}): ExtractedTextReadResult["ocrErrorCategory"] {
  if (/TEXTRACT_S3_BUCKET is not set/i.test(input.message)) {
    return "ocrConfigurationMissing";
  }

  if (/not authorized|accessdenied|no identity-based policy/i.test(input.message)) {
    if (!input.s3UploadSucceeded) {
      return "s3UploadAuthorizationFailed";
    }
    if (!input.textractStartSucceeded) {
      return "textractAuthorizationFailed";
    }
    return "missingIamPermission";
  }

  if (/Textract async OCR job failed/i.test(input.message)) {
    return "textractJobFailed";
  }

  return "other";
}

async function readExistingOcrArtifacts(input: {
  filePath: string;
  pdfType: PdfTextKind;
  fallbackText: string;
}): Promise<ExtractedTextReadResult | null> {
  const ocrResultPath = path.join(path.dirname(input.filePath), "ocr-result.json");
  const extractedTextPath = path.join(path.dirname(input.filePath), "extracted-text.txt");

  try {
    await access(ocrResultPath);
    await access(extractedTextPath);
  } catch {
    return null;
  }

  try {
    const [ocrPayloadRaw, extractedTextRaw] = await Promise.all([
      readFile(ocrResultPath, "utf8"),
      readFile(extractedTextPath, "utf8"),
    ]);
    const ocrPayload = JSON.parse(ocrPayloadRaw) as Record<string, unknown>;
    const extractedText = normalizeWhitespace(extractedTextRaw);
    const ocrSuccess = Boolean(ocrPayload.ocrSuccess) && extractedText.length > 0;
    return {
      text: ocrSuccess ? extractedText : input.fallbackText,
      pdfType: input.pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType: input.pdfType,
        ocrSuccess,
        ocrUsed: true,
      }),
      rawExtractedTextSource: ocrSuccess ? "ocr" : "dom",
      textSelectionReason: ocrSuccess ? "reused_existing_ocr_artifacts" : "existing_ocr_artifacts_without_usable_text",
      domExtractionRejectedReasons: [],
      ocrUsed: true,
      ocrProvider: ocrPayload.ocrProvider === "textract" ? "textract" : null,
      ocrTextLength:
        typeof ocrPayload.ocrTextLength === "number" ? ocrPayload.ocrTextLength : extractedText.length,
      ocrSuccess,
      ocrResultPath,
      ocrError: typeof ocrPayload.error === "string"
        ? ocrPayload.error
        : typeof ocrPayload.ocrError === "string"
          ? ocrPayload.ocrError
          : null,
      ocrErrorCategory:
        typeof ocrPayload.ocrErrorCategory === "string"
          ? (ocrPayload.ocrErrorCategory as ExtractedTextReadResult["ocrErrorCategory"])
          : null,
      ocrMode:
        ocrPayload.ocrMode === "sync_bytes" || ocrPayload.ocrMode === "async_s3"
          ? ocrPayload.ocrMode
          : null,
      configuredAwsRegion:
        typeof ocrPayload.configuredAwsRegion === "string" ? ocrPayload.configuredAwsRegion : null,
      resolvedBucketRegion:
        typeof ocrPayload.resolvedBucketRegion === "string" ? ocrPayload.resolvedBucketRegion : null,
      textractRegion:
        typeof ocrPayload.textractRegion === "string" ? ocrPayload.textractRegion : null,
      regionMatch: typeof ocrPayload.regionMatch === "boolean" ? ocrPayload.regionMatch : null,
      regionOverrideUsed:
        typeof ocrPayload.regionOverrideUsed === "boolean" ? ocrPayload.regionOverrideUsed : null,
      s3UploadSucceeded:
        typeof ocrPayload.s3UploadSucceeded === "boolean" ? ocrPayload.s3UploadSucceeded : null,
      s3UploadError: typeof ocrPayload.s3UploadError === "string" ? ocrPayload.s3UploadError : null,
      textractStartSucceeded:
        typeof ocrPayload.textractStartSucceeded === "boolean"
          ? ocrPayload.textractStartSucceeded
          : null,
      textractStartError:
        typeof ocrPayload.textractStartError === "string" ? ocrPayload.textractStartError : null,
    };
  } catch {
    return null;
  }
}

function buildTextractS3Key(input: {
  filePath: string;
  buffer: Buffer;
  prefix: string;
}): string {
  const normalizedPrefix = input.prefix
    .replace(/^[\/\\]+/, "")
    .replace(/[\/\\]+$/g, "")
    .replace(/\\/g, "/");
  const digest = createHash("sha1")
    .update(input.filePath)
    .update(input.buffer)
    .digest("hex");
  const fileName = path.basename(input.filePath).replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${normalizedPrefix}/${digest}/${fileName}`;
}

async function writeTextractArtifacts(input: {
  filePath: string;
  ocrResultPath: string;
  extractedTextPath: string;
  payload: Record<string, unknown>;
  text: string;
}): Promise<void> {
  await writeFile(input.ocrResultPath, JSON.stringify(input.payload, null, 2), "utf8");
  await writeFile(input.extractedTextPath, `${input.text}\n`, "utf8");
}

async function pollTextractDocumentTextDetection(input: {
  client: TextractClient;
  jobId: string;
  pollIntervalMs: number;
  timeoutMs: number;
}): Promise<{
  blocks: Block[];
  jobStatus: string;
  statusMessage: string | null;
  pollAttemptCount: number;
}> {
  const deadline = Date.now() + input.timeoutMs;
  const blocks: Block[] = [];
  let pollAttemptCount = 0;
  let nextToken: string | undefined;
  let jobStatus = "IN_PROGRESS";
  let statusMessage: string | null = null;

  while (Date.now() <= deadline) {
    pollAttemptCount += 1;
    const response: GetDocumentTextDetectionCommandOutput = await input.client.send(
      new GetDocumentTextDetectionCommand({
        JobId: input.jobId,
        NextToken: nextToken,
      }),
    );
    jobStatus = response.JobStatus ?? "UNKNOWN";
    statusMessage = normalizeWhitespace(response.StatusMessage ?? "") || null;

    if (jobStatus === "SUCCEEDED" || jobStatus === "PARTIAL_SUCCESS") {
      blocks.push(...(response.Blocks ?? []));
      nextToken = response.NextToken;
      if (!nextToken) {
        return {
          blocks,
          jobStatus,
          statusMessage,
          pollAttemptCount,
        };
      }
      continue;
    }

    if (jobStatus === "FAILED") {
      throw new Error(statusMessage || "Textract async OCR job failed.");
    }

    nextToken = undefined;
    await delay(input.pollIntervalMs);
  }

  throw new Error(
    `Textract async OCR timed out after ${pollAttemptCount} poll attempts for job ${input.jobId}.`,
  );
}

async function runTextractAsyncS3Ocr(input: {
  filePath: string;
  buffer: Buffer;
  pdfType: PdfTextKind;
  fallbackText: string;
  ocrResultPath: string;
  extractedTextPath: string;
  syncError: string;
}): Promise<ExtractedTextReadResult> {
  const regionConfig = resolveTextractRegionConfig();
  const bucket = resolveTextractS3Bucket();
  if (!bucket) {
    const ocrError = `${input.syncError}; TEXTRACT_S3_BUCKET is not set for async Textract fallback.`;
    await writeTextractArtifacts({
      filePath: input.filePath,
      ocrResultPath: input.ocrResultPath,
      extractedTextPath: input.extractedTextPath,
      payload: {
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        sourcePath: input.filePath,
        pdfType: input.pdfType,
        ocrUsed: true,
        ocrMode: "async_s3",
        ocrProvider: "textract",
        ocrSuccess: false,
        ocrTextLength: 0,
        configuredAwsRegion: regionConfig.configuredAwsRegion,
        resolvedBucketRegion: regionConfig.resolvedBucketRegion,
        textractRegion: regionConfig.textractRegion,
        regionMatch: regionConfig.regionMatch,
        regionOverrideUsed: regionConfig.regionOverrideUsed,
        s3UploadSucceeded: false,
        s3UploadError: ocrError,
        textractStartSucceeded: false,
        textractStartError: null,
        ocrErrorCategory: "ocrConfigurationMissing",
        syncError: input.syncError,
        error: ocrError,
      },
      text: input.fallbackText,
    });

    return createExtractedTextReadResult({
      text: input.fallbackText,
      pdfType: input.pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType: input.pdfType,
        ocrSuccess: false,
        ocrUsed: true,
      }),
      rawExtractedTextSource: "dom",
      textSelectionReason: "ocr_unavailable_async_bucket_missing",
      domExtractionRejectedReasons: [],
      ocrUsed: true,
      ocrProvider: "textract",
      ocrTextLength: 0,
      ocrSuccess: false,
      ocrResultPath: input.ocrResultPath,
      ocrError,
      ocrMode: "async_s3",
      configuredAwsRegion: regionConfig.configuredAwsRegion,
      resolvedBucketRegion: regionConfig.resolvedBucketRegion,
      textractRegion: regionConfig.textractRegion,
      regionMatch: regionConfig.regionMatch,
      regionOverrideUsed: regionConfig.regionOverrideUsed,
      s3UploadSucceeded: false,
      s3UploadError: ocrError,
      textractStartSucceeded: false,
      textractStartError: null,
      ocrErrorCategory: "ocrConfigurationMissing",
    });
  }

  const key = buildTextractS3Key({
    filePath: input.filePath,
    buffer: input.buffer,
    prefix: resolveTextractS3Prefix(),
  });
  const s3Client = getS3Client(regionConfig.resolvedBucketRegion);
  const textractClient = getTextractClient(regionConfig.textractRegion);
  const pollIntervalMs = resolveTextractPollIntervalMs();
  const timeoutMs = resolveTextractJobTimeoutMs();
  let s3UploadSucceeded = false;
  let s3UploadError: string | null = null;
  let textractStartSucceeded = false;
  let textractStartError: string | null = null;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.buffer,
        ContentType: "application/pdf",
      }),
    );
    s3UploadSucceeded = true;

    const startResponse = await textractClient.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
      }),
    );
    textractStartSucceeded = true;
    const jobId = normalizeWhitespace(startResponse.JobId ?? "");
    if (!jobId) {
      throw new Error("Textract async OCR did not return a JobId.");
    }

    const pollResult = await pollTextractDocumentTextDetection({
      client: textractClient,
      jobId,
      pollIntervalMs,
      timeoutMs,
    });
    const text = extractTextractTextFromBlocks(pollResult.blocks);
    const ocrSuccess = text.length > 0;
    await writeTextractArtifacts({
      filePath: input.filePath,
      ocrResultPath: input.ocrResultPath,
      extractedTextPath: input.extractedTextPath,
      payload: {
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        sourcePath: input.filePath,
        pdfType: input.pdfType,
        ocrUsed: true,
        ocrMode: "async_s3",
        ocrProvider: "textract",
        ocrSuccess,
        ocrTextLength: text.length,
        configuredAwsRegion: regionConfig.configuredAwsRegion,
        resolvedBucketRegion: regionConfig.resolvedBucketRegion,
        textractRegion: regionConfig.textractRegion,
        regionMatch: regionConfig.regionMatch,
        regionOverrideUsed: regionConfig.regionOverrideUsed,
        s3UploadSucceeded,
        s3UploadError,
        textractStartSucceeded,
        textractStartError,
        ocrErrorCategory: null,
        syncError: input.syncError,
        textractS3Bucket: bucket,
        textractS3Key: key,
        textractJobId: jobId,
        textractJobStatus: pollResult.jobStatus,
        textractStatusMessage: pollResult.statusMessage,
        textractPollAttemptCount: pollResult.pollAttemptCount,
        blockCount: pollResult.blocks.length,
        blocks: pollResult.blocks.map((block: Block) => ({
          blockType: block.BlockType ?? null,
          text: block.Text ?? null,
          confidence: block.Confidence ?? null,
          page: block.Page ?? null,
        })),
      },
      text: text || input.fallbackText,
    });

    return createExtractedTextReadResult({
      text: text || input.fallbackText,
      pdfType: input.pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType: input.pdfType,
        ocrSuccess,
        ocrUsed: true,
      }),
      rawExtractedTextSource: ocrSuccess ? "ocr" : "dom",
      textSelectionReason: ocrSuccess ? "textract_async_text_selected" : "textract_async_empty_using_fallback",
      domExtractionRejectedReasons: [],
      ocrUsed: true,
      ocrProvider: "textract",
      ocrTextLength: text.length,
      ocrSuccess,
      ocrResultPath: input.ocrResultPath,
      ocrError: null,
      ocrMode: "async_s3",
      configuredAwsRegion: regionConfig.configuredAwsRegion,
      resolvedBucketRegion: regionConfig.resolvedBucketRegion,
      textractRegion: regionConfig.textractRegion,
      regionMatch: regionConfig.regionMatch,
      regionOverrideUsed: regionConfig.regionOverrideUsed,
      s3UploadSucceeded,
      s3UploadError,
      textractStartSucceeded,
      textractStartError,
      ocrErrorCategory: null,
    });
  } catch (error) {
    const ocrError = error instanceof Error ? error.message : String(error);
    if (!s3UploadSucceeded && !s3UploadError) {
      s3UploadError = ocrError;
    } else if (s3UploadSucceeded && !textractStartSucceeded && !textractStartError) {
      textractStartError = ocrError;
    }
    const ocrErrorCategory = classifyOcrError({
      message: ocrError,
      s3UploadSucceeded,
      textractStartSucceeded,
    });
    await writeTextractArtifacts({
      filePath: input.filePath,
      ocrResultPath: input.ocrResultPath,
      extractedTextPath: input.extractedTextPath,
      payload: {
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        sourcePath: input.filePath,
        pdfType: input.pdfType,
        ocrUsed: true,
        ocrMode: "async_s3",
        ocrProvider: "textract",
        ocrSuccess: false,
        ocrTextLength: 0,
        configuredAwsRegion: regionConfig.configuredAwsRegion,
        resolvedBucketRegion: regionConfig.resolvedBucketRegion,
        textractRegion: regionConfig.textractRegion,
        regionMatch: regionConfig.regionMatch,
        regionOverrideUsed: regionConfig.regionOverrideUsed,
        s3UploadSucceeded,
        s3UploadError,
        textractStartSucceeded,
        textractStartError,
        ocrErrorCategory,
        syncError: input.syncError,
        textractS3Bucket: bucket,
        textractS3Key: key,
        error: ocrError,
      },
      text: input.fallbackText,
    }).catch(() => undefined);

    return createExtractedTextReadResult({
      text: input.fallbackText,
      pdfType: input.pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType: input.pdfType,
        ocrSuccess: false,
        ocrUsed: true,
      }),
      rawExtractedTextSource: "dom",
      textSelectionReason: "textract_async_failed_using_fallback",
      domExtractionRejectedReasons: [],
      ocrUsed: true,
      ocrProvider: "textract",
      ocrTextLength: 0,
      ocrSuccess: false,
      ocrResultPath: input.ocrResultPath,
      ocrError,
      ocrMode: "async_s3",
      configuredAwsRegion: regionConfig.configuredAwsRegion,
      resolvedBucketRegion: regionConfig.resolvedBucketRegion,
      textractRegion: regionConfig.textractRegion,
      regionMatch: regionConfig.regionMatch,
      regionOverrideUsed: regionConfig.regionOverrideUsed,
      s3UploadSucceeded,
      s3UploadError,
      textractStartSucceeded,
      textractStartError,
      ocrErrorCategory,
    });
  }
}

async function runTextractOcr(input: {
  filePath: string;
  buffer: Buffer;
  pdfType: PdfTextKind;
  fallbackText: string;
}): Promise<ExtractedTextReadResult> {
  const ocrResultPath = path.join(path.dirname(input.filePath), "ocr-result.json");
  const extractedTextPath = path.join(path.dirname(input.filePath), "extracted-text.txt");
  const existingArtifacts = await readExistingOcrArtifacts(input);
  if (existingArtifacts) {
    return existingArtifacts;
  }
  const regionConfig = resolveTextractRegionConfig();
  const client = getTextractClient(regionConfig.textractRegion);

  try {
    const response = await client.send(
      new DetectDocumentTextCommand({
        Document: {
          Bytes: input.buffer,
        },
      }),
    );
    const text = extractTextractText(response);
    const ocrSuccess = text.length > 0;
    await writeFile(
      ocrResultPath,
      JSON.stringify(
        {
          schemaVersion: "1",
          generatedAt: new Date().toISOString(),
          sourcePath: input.filePath,
          pdfType: input.pdfType,
          ocrUsed: true,
          ocrMode: "sync_bytes",
          ocrProvider: "textract",
          ocrSuccess,
          ocrTextLength: text.length,
          configuredAwsRegion: regionConfig.configuredAwsRegion,
          resolvedBucketRegion: null,
          textractRegion: regionConfig.textractRegion,
          regionMatch: null,
          regionOverrideUsed: regionConfig.regionOverrideUsed,
          s3UploadSucceeded: null,
          s3UploadError: null,
          textractStartSucceeded: null,
          textractStartError: null,
          ocrErrorCategory: null,
          blockCount: response.Blocks?.length ?? 0,
          blocks: (response.Blocks ?? []).map((block: Block) => ({
            blockType: block.BlockType ?? null,
            text: block.Text ?? null,
            confidence: block.Confidence ?? null,
            page: block.Page ?? null,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(extractedTextPath, `${text || input.fallbackText}\n`, "utf8");

    return createExtractedTextReadResult({
      text: text || input.fallbackText,
      pdfType: input.pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType: input.pdfType,
        ocrSuccess,
        ocrUsed: true,
      }),
      rawExtractedTextSource: ocrSuccess ? "ocr" : "dom",
      textSelectionReason: ocrSuccess ? "textract_sync_text_selected" : "textract_sync_empty_using_fallback",
      domExtractionRejectedReasons: [],
      ocrUsed: true,
      ocrProvider: "textract",
      ocrTextLength: text.length,
      ocrSuccess,
      ocrResultPath,
      ocrError: null,
      ocrMode: "sync_bytes",
      configuredAwsRegion: regionConfig.configuredAwsRegion,
      resolvedBucketRegion: null,
      textractRegion: regionConfig.textractRegion,
      regionMatch: null,
      regionOverrideUsed: regionConfig.regionOverrideUsed,
      s3UploadSucceeded: null,
      s3UploadError: null,
      textractStartSucceeded: null,
      textractStartError: null,
      ocrErrorCategory: null,
    });
  } catch (error) {
    const ocrError = error instanceof Error ? error.message : String(error);
    if (shouldFallbackToAsyncTextract(ocrError)) {
      return runTextractAsyncS3Ocr({
        filePath: input.filePath,
        buffer: input.buffer,
        pdfType: input.pdfType,
        fallbackText: input.fallbackText,
        ocrResultPath,
        extractedTextPath,
        syncError: ocrError,
      });
    }

    await writeFile(
      ocrResultPath,
      JSON.stringify(
        {
          schemaVersion: "1",
          generatedAt: new Date().toISOString(),
          sourcePath: input.filePath,
          pdfType: input.pdfType,
          ocrUsed: true,
          ocrMode: "sync_bytes",
          ocrProvider: "textract",
          ocrSuccess: false,
          ocrTextLength: 0,
          configuredAwsRegion: regionConfig.configuredAwsRegion,
          resolvedBucketRegion: null,
          textractRegion: regionConfig.textractRegion,
          regionMatch: null,
          regionOverrideUsed: regionConfig.regionOverrideUsed,
          s3UploadSucceeded: null,
          s3UploadError: null,
          textractStartSucceeded: null,
          textractStartError: null,
          ocrErrorCategory: classifyOcrError({
            message: ocrError,
            s3UploadSucceeded: false,
            textractStartSucceeded: false,
          }),
          error: ocrError,
        },
        null,
        2,
      ),
      "utf8",
    ).catch(() => undefined);

    return createExtractedTextReadResult({
      text: input.fallbackText,
      pdfType: input.pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType: input.pdfType,
        ocrSuccess: false,
        ocrUsed: true,
      }),
      rawExtractedTextSource: "dom",
      textSelectionReason: "textract_sync_failed_using_fallback",
      domExtractionRejectedReasons: [],
      ocrUsed: true,
      ocrProvider: "textract",
      ocrTextLength: 0,
      ocrSuccess: false,
      ocrResultPath,
      ocrError,
      ocrMode: "sync_bytes",
      configuredAwsRegion: regionConfig.configuredAwsRegion,
      resolvedBucketRegion: null,
      textractRegion: regionConfig.textractRegion,
      regionMatch: null,
      regionOverrideUsed: regionConfig.regionOverrideUsed,
      s3UploadSucceeded: null,
      s3UploadError: null,
      textractStartSucceeded: null,
      textractStartError: null,
      ocrErrorCategory: classifyOcrError({
        message: ocrError,
        s3UploadSucceeded: false,
        textractStartSucceeded: false,
      }),
    });
  }
}

function extractPrintableText(buffer: Buffer): string {
  const printableRuns = buffer
    .toString("utf8")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ");
  return normalizeWhitespace(printableRuns);
}

function deriveDocumentType(artifact: ArtifactRecord): ExtractedDocument["type"] {
  switch (artifact.artifactType) {
    case "OASIS":
      return "OASIS";
    case "PLAN_OF_CARE":
      return "POC";
    case "VISIT_NOTES":
      return "VISIT_NOTE";
    case "PHYSICIAN_ORDERS":
      return "ORDER";
    default:
      return "OTHER";
  }
}

function deriveSections(text: string): string[] {
  const headings = text.match(/\b[A-Z][A-Z ]{3,}\b/g) ?? [];
  return Array.from(new Set(headings.map((heading) => heading.trim()))).slice(0, 12);
}

function deriveKeyPhrases(text: string): string[] {
  const tokens = [
    "homebound",
    "medical necessity",
    "health assessment",
    "skilled nursing",
    "intervention",
    "patient response",
    "progress toward goals",
    "vitals",
    "medication",
    "physician order",
    "communication note",
    "supervisory visit",
  ];

  const lowercaseText = text.toLowerCase();
  return tokens.filter((token) => lowercaseText.includes(token));
}

export async function extractTextFromLocalFile(filePath: string): Promise<LocalFileTextExtractionResult> {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);

  if (extension === ".html" || extension === ".htm") {
    const text = stripHtml(buffer.toString("utf8"));
    const analysis = analyzeDocumentText(text);
    return createExtractedTextReadResult({
      text: analysis.accepted ? analysis.normalizedText : "",
      pdfType: null,
      effectiveTextSource: "viewer_text_fallback",
      rawExtractedTextSource: "dom",
      textSelectionReason: analysis.accepted
        ? "accepted_html_text"
        : `rejected_html_text:${analysis.rejectionReasons.join("|")}`,
      domExtractionRejectedReasons: analysis.rejectionReasons,
    });
  }

  if (extension === ".pdf") {
    const domText = extractPdfText(buffer);
    const pdfType = classifyPdfBuffer(buffer, domText);
    const domAnalysis = analyzeDocumentText(domText);
    let ocrResult: LocalFileTextExtractionResult | null = null;

    if (pdfType === "scanned_image_pdf" || !domAnalysis.accepted) {
      ocrResult = await runTextractOcr({
        filePath,
        buffer,
        pdfType,
        fallbackText: domAnalysis.normalizedText,
      });
    }

    const selected = selectPreferredDocumentText({
      pdfType,
      domText: domAnalysis.normalizedText,
      ocrText: ocrResult?.ocrSuccess ? ocrResult.text : "",
      ocrSuccess: ocrResult?.ocrSuccess ?? false,
    });
    const extractedTextPath = path.join(path.dirname(filePath), "extracted-text.txt");
    await writeFile(extractedTextPath, `${selected.text}\n`, "utf8").catch(() => undefined);

    return createExtractedTextReadResult({
      ...(ocrResult ?? {}),
      text: selected.text,
      pdfType,
      effectiveTextSource: resolveEffectiveTextSource({
        pdfType,
        ocrSuccess: selected.rawExtractedTextSource === "ocr" && (ocrResult?.ocrSuccess ?? false),
        ocrUsed: selected.rawExtractedTextSource === "ocr",
      }),
      rawExtractedTextSource: selected.rawExtractedTextSource,
      textSelectionReason: selected.selectionReason,
      domExtractionRejectedReasons: selected.domAnalysis.rejectionReasons,
      ocrUsed: ocrResult?.ocrUsed ?? false,
    });
  }

  const text = extractPrintableText(buffer);
  const analysis = analyzeDocumentText(text);
  return createExtractedTextReadResult({
    text: analysis.accepted ? analysis.normalizedText : "",
    pdfType: null,
    effectiveTextSource: "viewer_text_fallback",
    rawExtractedTextSource: "dom",
    textSelectionReason: analysis.accepted
      ? "accepted_printable_text"
      : `rejected_printable_text:${analysis.rejectionReasons.join("|")}`,
    domExtractionRejectedReasons: analysis.rejectionReasons,
  });
}

function buildFallbackText(artifact: ArtifactRecord): string {
  return normalizeWhitespace(
    [
      artifact.portalLabel,
      artifact.locatorUsed,
      ...Object.values(artifact.extractedFields).filter((value): value is string => Boolean(value)),
      ...artifact.notes,
    ].join(" "),
  );
}

function readStringField(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized || null;
}

function readStringListField(value: string | null | undefined): string[] {
  return normalizeWhitespace(value ?? "")
    .split("|")
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
}

function readRawExtractedTextSource(value: string | null | undefined): RawExtractedTextSource | null {
  const normalized = normalizeWhitespace(value ?? "");
  if (normalized === "dom" || normalized === "ocr" || normalized === "hybrid") {
    return normalized;
  }
  return null;
}

function buildExtractedDocument(input: {
  type: ExtractedDocument["type"];
  text: string;
  metadata: Omit<
    ExtractedDocument["metadata"],
    "keyPhrases" | "sections" | "textLength" | "textPreview"
  >;
}): ExtractedDocument | null {
  const text = normalizeWhitespace(input.text);
  if (!text) {
    return null;
  }

  const possibleIcd10Codes = Array.from(new Set([
    ...extractPossibleIcd10Codes(text),
    ...extractPossibleIcd10Codes(
      Array.isArray(input.metadata.possibleIcd10Codes)
        ? input.metadata.possibleIcd10Codes.join(" ")
        : "",
    ),
  ]));

  return {
    type: input.type,
    text,
    metadata: {
      ...input.metadata,
      possibleIcd10Codes,
      textLength: text.length,
      textPreview: text.slice(0, 500),
      sections: deriveSections(text),
      keyPhrases: deriveKeyPhrases(text),
    },
  };
}

export async function extractDocumentsFromArtifacts(
  artifacts: ArtifactRecord[],
): Promise<ExtractedDocument[]> {
  const extracted: ExtractedDocument[] = [];

  for (const artifact of artifacts) {
    let text = "";
    let source: "download" | "artifact_fallback" = "artifact_fallback";
    let effectiveTextSource: EffectiveTextSource = "viewer_text_fallback";
    let baseReadResult: LocalFileTextExtractionResult | null = null;

    if (artifact.downloadPath) {
      try {
        await access(artifact.downloadPath);
        baseReadResult = await extractTextFromLocalFile(artifact.downloadPath);
        text = baseReadResult.text;
        source = "download";
        effectiveTextSource = baseReadResult.effectiveTextSource;
      } catch {
        text = "";
      }
    }

    if (!text) {
      text = buildFallbackText(artifact);
      effectiveTextSource = "viewer_text_fallback";
    }

    if (!text) {
      continue;
    }

    const baseDocument = buildExtractedDocument({
      type: deriveDocumentType(artifact),
      text,
      metadata: {
        artifactType: artifact.artifactType,
        source,
        sourcePath: artifact.downloadPath,
        effectiveTextSource,
        rawExtractedTextSource: baseReadResult?.rawExtractedTextSource ?? "dom",
        textSelectionReason: baseReadResult?.textSelectionReason ?? "artifact_fallback_text",
        domExtractionRejectedReasons: baseReadResult?.domExtractionRejectedReasons ?? [],
        pdfType: baseReadResult?.pdfType ?? null,
        ocrUsed: baseReadResult?.ocrUsed ?? false,
        ocrProvider: baseReadResult?.ocrProvider ?? null,
        ocrTextLength: baseReadResult?.ocrTextLength ?? 0,
        ocrSuccess: baseReadResult?.ocrSuccess ?? false,
        ocrResultPath: baseReadResult?.ocrResultPath ?? null,
        ocrError: baseReadResult?.ocrError ?? null,
        ocrErrorCategory: baseReadResult?.ocrErrorCategory ?? null,
        ocrMode: baseReadResult?.ocrMode ?? null,
        configuredAwsRegion: baseReadResult?.configuredAwsRegion ?? null,
        resolvedBucketRegion: baseReadResult?.resolvedBucketRegion ?? null,
        textractRegion: baseReadResult?.textractRegion ?? null,
        regionMatch: baseReadResult?.regionMatch ?? null,
        regionOverrideUsed: baseReadResult?.regionOverrideUsed ?? null,
        s3UploadSucceeded: baseReadResult?.s3UploadSucceeded ?? null,
        s3UploadError: baseReadResult?.s3UploadError ?? null,
        textractStartSucceeded: baseReadResult?.textractStartSucceeded ?? null,
        textractStartError: baseReadResult?.textractStartError ?? null,
        portalLabel: artifact.portalLabel,
        discoveredAt: artifact.discoveredAt,
        inventoryItem: null,
      },
    });
    if (baseDocument) {
      extracted.push(baseDocument);
    }

    const admissionOrderTextExcerpt = readStringField(
      artifact.extractedFields?.admissionOrderTextExcerpt,
    );
    const admissionOrderSourcePdfPath = readStringField(
      artifact.extractedFields?.admissionOrderSourcePdfPath,
    );
    const admissionOrderPrintedPdfPath = readStringField(
      artifact.extractedFields?.admissionOrderPrintedPdfPath,
    );
    const admissionExcerptAnalysis = analyzeDocumentText(admissionOrderTextExcerpt ?? "");
    const artifactDomExtractionRejectedReasons = readStringListField(
      artifact.extractedFields?.domExtractionRejectedReasons,
    );
    const admissionExcerptRejectedReasons = Array.from(new Set([
      ...artifactDomExtractionRejectedReasons,
      ...admissionExcerptAnalysis.rejectionReasons,
    ]));
    const admissionExcerptAccepted =
      admissionExcerptAnalysis.accepted && admissionExcerptRejectedReasons.length === 0;
    let admissionDocumentText = admissionExcerptAccepted ? admissionExcerptAnalysis.normalizedText : "";
    let admissionDocumentSourcePath =
      admissionOrderSourcePdfPath ??
      admissionOrderPrintedPdfPath ??
      artifact.downloadPath;
    let admissionDocumentSource: "admission_order_excerpt" | "printed_pdf" = "admission_order_excerpt";
    let admissionEffectiveTextSource: EffectiveTextSource = "viewer_text_fallback";
    let admissionReadResult: LocalFileTextExtractionResult | null = null;
    const admissionExcerptRawExtractedTextSource = readRawExtractedTextSource(
      artifact.extractedFields?.rawExtractedTextSource,
    ) ?? "dom";
    const admissionExcerptTextSelectionReason =
      readStringField(artifact.extractedFields?.textSelectionReason) ??
      (admissionExcerptAccepted
        ? "accepted_admission_excerpt_text"
        : `rejected_admission_excerpt_text:${admissionExcerptRejectedReasons.join("|") || "unknown"}`);

    const capturedPdfPath = admissionOrderSourcePdfPath ?? admissionOrderPrintedPdfPath;
    if (capturedPdfPath) {
      try {
        await access(capturedPdfPath);
        admissionReadResult = await extractTextFromLocalFile(capturedPdfPath);
        if (admissionReadResult.text) {
          admissionDocumentText = admissionReadResult.text;
          admissionDocumentSource = "printed_pdf";
          admissionEffectiveTextSource = admissionReadResult.effectiveTextSource;
        } else {
          admissionDocumentText = "";
        }
      } catch {
        admissionDocumentText = admissionExcerptAccepted ? admissionExcerptAnalysis.normalizedText : "";
      }
    }

    if (!admissionDocumentText) {
      continue;
    }

    const admissionDocument = buildExtractedDocument({
      type: "ORDER",
      text: admissionDocumentText,
      metadata: {
        artifactType: artifact.artifactType,
        source: admissionDocumentSource,
        sourcePath: admissionDocumentSourcePath,
        effectiveTextSource: admissionEffectiveTextSource,
        rawExtractedTextSource:
          admissionReadResult?.rawExtractedTextSource ?? admissionExcerptRawExtractedTextSource,
        textSelectionReason:
          admissionReadResult?.textSelectionReason ?? admissionExcerptTextSelectionReason,
        domExtractionRejectedReasons:
          admissionReadResult?.domExtractionRejectedReasons ?? admissionExcerptRejectedReasons,
        pdfType: admissionReadResult?.pdfType ?? null,
        ocrUsed: admissionReadResult?.ocrUsed ?? false,
        ocrProvider: admissionReadResult?.ocrProvider ?? null,
        ocrTextLength: admissionReadResult?.ocrTextLength ?? 0,
        ocrSuccess: admissionReadResult?.ocrSuccess ?? false,
        ocrResultPath: admissionReadResult?.ocrResultPath ?? null,
        ocrError: admissionReadResult?.ocrError ?? null,
        ocrErrorCategory: admissionReadResult?.ocrErrorCategory ?? null,
        ocrMode: admissionReadResult?.ocrMode ?? null,
        configuredAwsRegion: admissionReadResult?.configuredAwsRegion ?? null,
        resolvedBucketRegion: admissionReadResult?.resolvedBucketRegion ?? null,
        textractRegion: admissionReadResult?.textractRegion ?? null,
        regionMatch: admissionReadResult?.regionMatch ?? null,
        regionOverrideUsed: admissionReadResult?.regionOverrideUsed ?? null,
        s3UploadSucceeded: admissionReadResult?.s3UploadSucceeded ?? null,
        s3UploadError: admissionReadResult?.s3UploadError ?? null,
        textractStartSucceeded: admissionReadResult?.textractStartSucceeded ?? null,
        textractStartError: admissionReadResult?.textractStartError ?? null,
        portalLabel: readStringField(artifact.extractedFields?.admissionOrderTitle) ?? "Admission Order",
        discoveredAt: artifact.discoveredAt,
        inventoryItem: null,
        admissionReasonPrimary: readStringField(artifact.extractedFields?.admissionReasonPrimary),
        admissionReasonSnippets: readStringListField(
          artifact.extractedFields?.admissionReasonSnippets,
        ),
        possibleIcd10Codes: readStringListField(
          artifact.extractedFields?.possibleIcd10Codes,
        ),
      },
    });
    if (admissionDocument) {
      extracted.push(admissionDocument);
    }
  }

  return extracted;
}
