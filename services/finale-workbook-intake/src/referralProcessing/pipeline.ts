import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { FinaleBatchEnv } from "../config/env";
import type { ExtractedDocument } from "../services/documentExtractionService";
import { extractTextFromLocalFile } from "../services/documentExtractionService";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "./fieldContract";
import { compareProposedFieldsAgainstChart } from "./comparisonEngine";
import { evaluateDocumentExtractionQuality, classifySourceDocumentFileType } from "./extractionQuality";
import { extractReferralFacts } from "./factsExtractionService";
import { generateReferralFieldProposals } from "./llmProposalService";
import { generateReferralQaInsights } from "./referralQaInsightsService";
import { normalizeReferralSections } from "./sectionNormalization";
import { buildPatientQaReference } from "../qaReference/projection";
import { normalizePatientName } from "../utils/patientName";
import type {
  ChartSnapshotValueSource,
  FieldComparisonResult,
  QaDocumentSummary,
  ReferralDocumentProcessingArtifacts,
  ReferralDocumentProcessingResult,
  ReferralSourceDocumentType,
  SourceDocumentAcquisitionMethod,
  SourceDocumentArtifact,
  SourceDocumentExtractionResult,
  SourceDocumentReference,
} from "./types";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";

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

function hashReferralSuggestionInputs(input: {
  sourceMeta: SourceDocumentArtifact;
  extractionResult: SourceDocumentExtractionResult;
  extractedText: string;
  normalizedSections: ReferralDocumentProcessingResult["normalizedSections"];
  extractedFacts: ReferralDocumentProcessingResult["extractedFacts"];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sourceMeta: input.sourceMeta,
      extractionResult: input.extractionResult,
      extractedText: normalizeDocumentText(input.extractedText),
      normalizedSections: input.normalizedSections,
      extractedFacts: input.extractedFacts,
    }))
    .digest("hex");
}

function hashStableJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function buildReferralUploadFingerprint(input: {
  sourceMeta: SourceDocumentArtifact;
  extractedText: string;
}): string {
  return hashStableJson({
    selectedDocumentId: input.sourceMeta.selectedDocumentId,
    sourceDocuments: input.sourceMeta.sourceDocuments.map((document) => ({
      documentId: document.documentId,
      sourceLabel: document.sourceLabel,
      sourceType: document.sourceType,
      acquisitionMethod: document.acquisitionMethod,
      localFilePath: document.localFilePath,
      fileSizeBytes: document.fileSizeBytes,
      extractedTextLength: document.extractedTextLength,
      effectiveTextSource: document.effectiveTextSource,
      selectionStatus: document.selectionStatus,
    })),
    extractedTextHash: hashStableJson(normalizeDocumentText(input.extractedText)),
  });
}

function buildReferralProcessingInputFingerprint(input: {
  sourceMeta: SourceDocumentArtifact;
  extractionResult: SourceDocumentExtractionResult;
  extractedText: string;
  fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"];
}): string {
  return hashStableJson({
    uploadFingerprint: buildReferralUploadFingerprint({
      sourceMeta: input.sourceMeta,
      extractedText: input.extractedText,
    }),
    extractionUsabilityStatus: input.extractionResult.extractionQuality.usabilityStatus,
    extractionMethod: input.extractionResult.extractionMethod,
    currentChartValues: input.fieldMapSnapshot.fields.map((field) => ({
      key: field.key,
      currentChartValue: field.currentChartValue,
      currentChartValueSource: field.currentChartValueSource,
      populatedInChart: field.populatedInChart,
    })),
  });
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

type ReferralReuseMetadata = {
  schemaVersion: "referral-reuse-metadata.v1";
  generatedAt: string;
  referralUploadFingerprint: string;
  processingInputFingerprint: string;
  reusedFromPreviousRun: boolean;
};

async function loadReusableReferralArtifacts(input: {
  artifactDirectory: string;
  processingInputFingerprint: string;
}): Promise<ReferralDocumentProcessingResult | null> {
  const metadata = await readJsonIfExists<ReferralReuseMetadata>(
    path.join(input.artifactDirectory, "referral-reuse-metadata.json"),
  );
  if (metadata?.processingInputFingerprint !== input.processingInputFingerprint) {
    return null;
  }

  const [
    sourceMeta,
    extractionResult,
    extractedText,
    normalizedSections,
    extractedFacts,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    patientQaReference,
    qaDocumentSummary,
  ] = await Promise.all([
    readJsonIfExists<SourceDocumentArtifact>(path.join(input.artifactDirectory, "source-meta.json")),
    readJsonIfExists<SourceDocumentExtractionResult>(path.join(input.artifactDirectory, "extraction-result.json")),
    readFile(path.join(input.artifactDirectory, "extracted-text.txt"), "utf8").catch(() => null),
    readJsonIfExists<ReferralDocumentProcessingResult["normalizedSections"]>(path.join(input.artifactDirectory, "normalized-sections.json")),
    readJsonIfExists<ReferralDocumentProcessingResult["extractedFacts"]>(path.join(input.artifactDirectory, "extracted-facts.json")),
    readJsonIfExists<ReferralDocumentProcessingResult["fieldMapSnapshot"]>(path.join(input.artifactDirectory, "field-map-snapshot.json")),
    readJsonIfExists<ReferralDocumentProcessingResult["llmProposal"]>(path.join(input.artifactDirectory, "llm-proposal.json")),
    readJsonIfExists<ReferralDocumentProcessingResult["fieldComparisons"]>(path.join(input.artifactDirectory, "field-comparison.json")),
    readJsonIfExists<ReferralDocumentProcessingResult["patientQaReference"]>(path.join(input.artifactDirectory, "patient-qa-reference.json")),
    readJsonIfExists<QaDocumentSummary>(path.join(input.artifactDirectory, "qa-document-summary.json")),
  ]);

  if (
    !sourceMeta ||
    !extractionResult ||
    extractedText === null ||
    !normalizedSections ||
    !extractedFacts ||
    !fieldMapSnapshot ||
    !llmProposal ||
    !fieldComparisons ||
    !patientQaReference ||
    !qaDocumentSummary
  ) {
    return null;
  }

  return {
    sourceMeta,
    extractionResult,
    normalizedSections,
    extractedFacts,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    patientQaReference,
    qaDocumentSummary,
    artifacts: {
      artifactDirectory: input.artifactDirectory,
      sourceMetaPath: path.join(input.artifactDirectory, "source-meta.json"),
      extractionResultPath: path.join(input.artifactDirectory, "extraction-result.json"),
      extractedTextPath: path.join(input.artifactDirectory, "extracted-text.txt"),
      normalizedSectionsPath: path.join(input.artifactDirectory, "normalized-sections.json"),
      extractedFactsPath: path.join(input.artifactDirectory, "extracted-facts.json"),
      fieldMapSnapshotPath: path.join(input.artifactDirectory, "field-map-snapshot.json"),
      llmProposalPath: path.join(input.artifactDirectory, "llm-proposal.json"),
      fieldComparisonPath: path.join(input.artifactDirectory, "field-comparison.json"),
      patientQaReferencePath: path.join(input.artifactDirectory, "patient-qa-reference.json"),
      qaDocumentSummaryPath: path.join(input.artifactDirectory, "qa-document-summary.json"),
      reviewOnlyOasisSuggestionsMetadataPath: path.join(input.artifactDirectory, "review-only-oasis-suggestions-metadata.json"),
    },
  };
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";
}

function detectSourceType(document: ExtractedDocument): ReferralSourceDocumentType {
  const label = `${document.metadata.portalLabel ?? ""} ${document.metadata.sourcePath ?? ""}`;
  if (/discharge/i.test(label)) {
    return "HOSPITAL_DISCHARGE";
  }
  if (/admission/i.test(label)) {
    return "ADMISSION_ORDER";
  }
  if (document.type === "ORDER") {
    return "REFERRAL_ORDER";
  }
  return "OTHER";
}

function detectAcquisitionMethod(document: ExtractedDocument): SourceDocumentAcquisitionMethod {
  switch (document.metadata.source) {
    case "download":
      return "download";
    case "printed_pdf":
      return "printed_pdf";
    default:
      return document.metadata.sourcePath ? "local_file" : "in_memory_fallback";
  }
}

function effectiveSourceRank(value: string | null | undefined): number {
  switch (value) {
    case "digital_pdf_text":
      return 4;
    case "ocr_text":
      return 3;
    case "raw_pdf_fallback":
      return 2;
    case "viewer_text_fallback":
      return 1;
    default:
      return 0;
  }
}

function buildPatientNameTokens(value: string): string[] {
  return normalizePatientName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildFileNameTokens(filePath: string): string[] {
  return normalizePatientName(path.parse(filePath).name)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

async function readBatchWorkItemCount(outputDir: string): Promise<number | null> {
  try {
    const payload = await readFile(path.join(outputDir, "work-items.json"), "utf8");
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function fileLooksLikePatientSource(input: {
  filePath: string;
  patientName: string;
  batchWorkItemCount: number | null;
}): boolean {
  const extension = path.extname(input.filePath).toLowerCase();
  if (![".pdf", ".jpg", ".jpeg", ".png"].includes(extension)) {
    return false;
  }

  const patientTokens = buildPatientNameTokens(input.patientName);
  const fileTokens = new Set(buildFileNameTokens(input.filePath));
  const overlappingTokens = patientTokens.filter((token) => fileTokens.has(token));

  if (overlappingTokens.length >= Math.min(2, patientTokens.length)) {
    return true;
  }

  if (patientTokens.length > 0 && fileTokens.has(patientTokens[patientTokens.length - 1]!)) {
    return true;
  }

  return input.batchWorkItemCount === 1;
}

async function buildSourceReferences(input: {
  extractedDocuments: ExtractedDocument[];
  patientId: string;
  patientName: string;
  outputDir: string;
}): Promise<SourceDocumentReference[]> {
  const references: SourceDocumentReference[] = [];
  const seenLocalPaths = new Set<string>();

  for (const [index, document] of input.extractedDocuments.entries()) {
    if (document.type !== "ORDER") {
      continue;
    }

    const localFilePath = document.metadata.sourcePath ?? null;
    let fileSizeBytes: number | null = null;
    if (localFilePath) {
      seenLocalPaths.add(path.resolve(localFilePath));
      try {
        fileSizeBytes = (await stat(localFilePath)).size;
      } catch {
        fileSizeBytes = null;
      }
    }

    references.push({
      documentId: `${input.patientId}-referral-${index + 1}`,
      sourceIndex: index,
      sourceLabel: document.metadata.portalLabel ?? path.basename(localFilePath ?? `order-${index + 1}`),
      normalizedSourceLabel: slugify(document.metadata.portalLabel ?? localFilePath ?? `order-${index + 1}`),
      sourceType: detectSourceType(document),
      acquisitionMethod: detectAcquisitionMethod(document),
      selectionStatus: "candidate",
      portalLabel: document.metadata.portalLabel ?? null,
      localFilePath,
      effectiveTextSource: document.metadata.effectiveTextSource ?? null,
      fileType: classifySourceDocumentFileType(localFilePath),
      fileSizeBytes,
      extractedTextLength: document.text.length,
      selectedReason: null,
      rejectedReasons: [],
    });
  }

  const batchSourceDir = path.resolve(input.outputDir, "..", "source");
  const batchWorkItemCount = await readBatchWorkItemCount(input.outputDir);
  try {
    const entries = await readdir(batchSourceDir, { withFileTypes: true });
    const manualCandidates = entries.filter((entry) => entry.isFile());

    for (const entry of manualCandidates) {
      const localFilePath = path.join(batchSourceDir, entry.name);
      const resolvedPath = path.resolve(localFilePath);
      if (seenLocalPaths.has(resolvedPath)) {
        continue;
      }
      if (!fileLooksLikePatientSource({
        filePath: localFilePath,
        patientName: input.patientName,
        batchWorkItemCount,
      })) {
        continue;
      }

      let fileSizeBytes: number | null = null;
      try {
        fileSizeBytes = (await stat(localFilePath)).size;
      } catch {
        fileSizeBytes = null;
      }

      references.push({
        documentId: `${input.patientId}-manual-source-${references.length + 1}`,
        sourceIndex: -1,
        sourceLabel: entry.name,
        normalizedSourceLabel: slugify(entry.name),
        sourceType: "REFERRAL_ORDER",
        acquisitionMethod: "local_file",
        selectionStatus: "candidate",
        portalLabel: null,
        localFilePath,
        effectiveTextSource: null,
        fileType: classifySourceDocumentFileType(localFilePath),
        fileSizeBytes,
        extractedTextLength: 0,
        selectedReason: null,
        rejectedReasons: [],
      });
      seenLocalPaths.add(resolvedPath);
    }
  } catch {
    // Manual batch-source documents are optional.
  }

  return references;
}

type CandidateEvaluation = {
  reference: SourceDocumentReference;
  localExtraction: Awaited<ReturnType<typeof extractTextFromLocalFile>> | null;
  extractedText: string;
  extractionQuality: ReturnType<typeof evaluateDocumentExtractionQuality>;
};

function resolveReferralExtractionText(input: {
  localExtraction: Awaited<ReturnType<typeof extractTextFromLocalFile>> | null;
  fallbackText: string;
  fileType: SourceDocumentReference["fileType"];
}): string {
  const localText = normalizeDocumentText(input.localExtraction?.text);
  if (localText) {
    return localText;
  }

  const fallbackText = normalizeDocumentText(input.fallbackText);
  if (!fallbackText) {
    return "";
  }

  const fallbackQuality = evaluateDocumentExtractionQuality({
    text: fallbackText,
    extraction: {
      pdfType: input.localExtraction?.pdfType ?? null,
      rawExtractedTextSource: "dom",
      domExtractionRejectedReasons: input.localExtraction?.domExtractionRejectedReasons ?? [],
    },
    fileType: input.fileType,
  });

  if (fallbackQuality.usabilityStatus === "usable") {
    return fallbackText;
  }

  return "";
}

async function evaluateSourceDocuments(input: {
  references: SourceDocumentReference[];
  extractedDocuments: ExtractedDocument[];
}): Promise<CandidateEvaluation[]> {
  const evaluations: CandidateEvaluation[] = [];

  for (const reference of input.references) {
    const extractedDocument = reference.sourceIndex >= 0
      ? input.extractedDocuments[reference.sourceIndex] ?? null
      : null;
    const fallbackText = extractedDocument?.text ?? "";

    let localExtraction: Awaited<ReturnType<typeof extractTextFromLocalFile>> | null = null;
    if (reference.localFilePath) {
      try {
        localExtraction = await extractTextFromLocalFile(reference.localFilePath);
      } catch {
        localExtraction = null;
      }
    }

    const extractedText = resolveReferralExtractionText({
      localExtraction,
      fallbackText,
      fileType: reference.fileType,
    });
    const extractionQuality = evaluateDocumentExtractionQuality({
      text: extractedText,
      extraction: {
        pdfType: localExtraction?.pdfType ?? null,
        rawExtractedTextSource: localExtraction?.rawExtractedTextSource ?? "dom",
        domExtractionRejectedReasons: localExtraction?.domExtractionRejectedReasons ?? [],
      },
      fileType: reference.fileType,
    });

    evaluations.push({
      reference,
      localExtraction,
      extractedText,
      extractionQuality,
    });
  }

  const usabilityRank = (value: CandidateEvaluation["extractionQuality"]["usabilityStatus"]): number => {
    switch (value) {
      case "usable":
        return 3;
      case "needs_ocr_retry":
        return 2;
      default:
        return 1;
    }
  };

  const ordered = evaluations.sort((left, right) =>
    usabilityRank(right.extractionQuality.usabilityStatus) - usabilityRank(left.extractionQuality.usabilityStatus) ||
    Number(right.extractionQuality.likelyUsableForLlm) - Number(left.extractionQuality.likelyUsableForLlm) ||
    effectiveSourceRank(right.localExtraction?.effectiveTextSource ?? right.reference.effectiveTextSource) -
      effectiveSourceRank(left.localExtraction?.effectiveTextSource ?? left.reference.effectiveTextSource) ||
    Number(right.extractionQuality.containsSectionLikeHeadings) - Number(left.extractionQuality.containsSectionLikeHeadings) ||
    Number(right.extractionQuality.containsDiagnosisLikePatterns) - Number(left.extractionQuality.containsDiagnosisLikePatterns) ||
    right.extractionQuality.characterCount - left.extractionQuality.characterCount ||
    right.extractionQuality.lineCount - left.extractionQuality.lineCount ||
    (right.reference.fileSizeBytes ?? 0) - (left.reference.fileSizeBytes ?? 0) ||
    right.reference.extractedTextLength - left.reference.extractedTextLength
  );

  return ordered;
}

async function selectPrimarySourceDocument(input: {
  references: SourceDocumentReference[];
  extractedDocuments: ExtractedDocument[];
}): Promise<CandidateEvaluation | null> {
  const ordered = await evaluateSourceDocuments(input);
  return ordered[0] ?? null;
}

function buildCombinedReferralText(candidates: CandidateEvaluation[]): string {
  return normalizeDocumentText(
    candidates
      .map((candidate, index) => {
        const label = normalizeWhitespace(candidate.reference.sourceLabel);
        const documentText = normalizeDocumentText(candidate.extractedText);
        if (!documentText) {
          return "";
        }
        return [
          `REFERRAL SOURCE ${index + 1}: ${label || candidate.reference.documentId}`,
          documentText,
        ].join("\n");
      })
      .filter(Boolean)
      .join("\n\n"),
  );
}

function buildExtractionResult(input: {
  sourceReference: SourceDocumentReference | null;
  localExtraction: Awaited<ReturnType<typeof extractTextFromLocalFile>> | null;
  fallbackText: string;
}): SourceDocumentExtractionResult {
  const fileType = input.sourceReference?.fileType ?? "unknown";
  const attemptedText =
    normalizeDocumentText(input.localExtraction?.text) ||
    normalizeDocumentText(input.fallbackText);
  const extractedText = resolveReferralExtractionText({
    localExtraction: input.localExtraction,
    fallbackText: input.fallbackText,
    fileType,
  });
  const extractionQuality = evaluateDocumentExtractionQuality({
    text: extractedText || attemptedText,
    extraction: {
      pdfType: input.localExtraction?.pdfType ?? null,
      rawExtractedTextSource: input.localExtraction?.rawExtractedTextSource ?? "dom",
      domExtractionRejectedReasons: input.localExtraction?.domExtractionRejectedReasons ?? [],
    },
    fileType,
  });
  const failureReasons: string[] = [];
  if (!extractedText) {
    failureReasons.push("No extracted text was produced from the selected referral source.");
  }
  if (extractionQuality.usabilityStatus === "needs_ocr_retry") {
    failureReasons.push("OCR retry required before referral facts can be promoted.");
  }
  if (extractionQuality.usabilityStatus === "rejected") {
    failureReasons.push(`Extraction quality rejected: ${extractionQuality.rejectedReasons.join(", ")}`);
  }
  if (input.localExtraction?.ocrUsed) {
    failureReasons.push(
      [
        `ocrUsed=${input.localExtraction.ocrUsed}`,
        `ocrSuccess=${input.localExtraction.ocrSuccess}`,
        `ocrMode=${input.localExtraction.ocrMode ?? "unknown"}`,
        `ocrTextLength=${input.localExtraction.ocrTextLength}`,
        input.localExtraction.ocrError ? `ocrError=${input.localExtraction.ocrError}` : null,
        input.localExtraction.ocrErrorCategory ? `ocrErrorCategory=${input.localExtraction.ocrErrorCategory}` : null,
      ].filter(Boolean).join("; "),
    );
  }

  return {
    documentId: input.sourceReference?.documentId ?? "unselected",
    localFilePath: input.sourceReference?.localFilePath ?? null,
    fileType,
    extractionMethod: !extractedText
      ? "failed"
      : input.localExtraction
      ? input.localExtraction.effectiveTextSource === "ocr_text"
        ? fileType === "pdf"
          ? "ocr_text"
          : "image_ocr"
        : "digital_pdf_text"
      : extractedText
        ? "in_memory_fallback"
        : "failed",
    extractionSuccess: Boolean(extractedText),
    effectiveTextSource: input.localExtraction?.effectiveTextSource ?? null,
    rawExtractedTextSource: input.localExtraction?.rawExtractedTextSource ?? null,
    textSelectionReason: input.localExtraction?.textSelectionReason ?? (extractedText ? "selected_in_memory_fallback_text" : null),
    domExtractionRejectedReasons: input.localExtraction?.domExtractionRejectedReasons ?? [],
    pdfType: input.localExtraction?.pdfType ?? null,
    ocrUsed: input.localExtraction?.ocrUsed ?? false,
    ocrProvider: input.localExtraction?.ocrProvider ?? null,
    ocrResultPath: input.localExtraction?.ocrResultPath ?? null,
    extractedTextPath: null,
    extractionQuality,
    failureReasons,
    warnings: [],
    generatedAt: new Date().toISOString(),
  };
}

function buildQaDocumentSummary(input: {
  selectedDocumentId: string | null;
  extractionResult: SourceDocumentExtractionResult;
  normalizedSectionCount: number;
  llmProposalCount: number;
  fieldComparisons: FieldComparisonResult[];
  warnings: string[];
}): QaDocumentSummary {
  const comparisonStatusCounts: QaDocumentSummary["comparisonStatusCounts"] = {
    match: 0,
    missing_in_chart: 0,
    missing_in_referral: 0,
    possible_conflict: 0,
    unsupported: 0,
    requires_human_review: 0,
  };

  for (const result of input.fieldComparisons) {
    comparisonStatusCounts[result.comparison_status] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    selectedDocumentId: input.selectedDocumentId,
    extractionUsabilityStatus: input.extractionResult.extractionQuality.usabilityStatus,
    normalizedSectionCount: input.normalizedSectionCount,
    llmProposalCount: input.llmProposalCount,
    comparisonStatusCounts,
    highPriorityFieldKeys: input.fieldComparisons
      .filter((result) => result.reviewer_priority === "high")
      .map((result) => result.field_key),
    warnings: input.warnings,
  };
}

function buildEmptyExtractedFacts(fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"]): ReferralDocumentProcessingResult["extractedFacts"] {
  const socDate = fieldMapSnapshot.fields.find((field) => field.key === "soc_date")?.currentChartValue;
  return {
    patient_context: {
      patient_name: null,
      dob: null,
      soc_date: typeof socDate === "string" ? socDate : null,
      referral_date: null,
    },
    facts: [],
    diagnosis_candidates: [],
    caregiver_candidates: [],
    unsupported_or_missing_fields: [...fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral],
    warnings: ["No extracted referral facts were available because no source document was selected."],
  };
}

async function persistArtifacts(input: {
  artifactDirectory: string;
  sourceMeta: SourceDocumentArtifact;
  extractionResult: SourceDocumentExtractionResult;
  extractedText: string;
  normalizedSections: ReferralDocumentProcessingResult["normalizedSections"];
  extractedFacts: ReferralDocumentProcessingResult["extractedFacts"];
  fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"];
  llmProposal: ReferralDocumentProcessingResult["llmProposal"];
  fieldComparisons: ReferralDocumentProcessingResult["fieldComparisons"];
  patientQaReference: ReferralDocumentProcessingResult["patientQaReference"];
  qaDocumentSummary: QaDocumentSummary;
  reuseMetadata: ReferralReuseMetadata;
}): Promise<ReferralDocumentProcessingArtifacts> {
  await mkdir(input.artifactDirectory, { recursive: true });

  const sourceMetaPath = path.join(input.artifactDirectory, "source-meta.json");
  const extractionResultPath = path.join(input.artifactDirectory, "extraction-result.json");
  const extractedTextPath = path.join(input.artifactDirectory, "extracted-text.txt");
  const normalizedSectionsPath = path.join(input.artifactDirectory, "normalized-sections.json");
  const extractedFactsPath = path.join(input.artifactDirectory, "extracted-facts.json");
  const fieldMapSnapshotPath = path.join(input.artifactDirectory, "field-map-snapshot.json");
  const llmProposalPath = path.join(input.artifactDirectory, "llm-proposal.json");
  const fieldComparisonPath = path.join(input.artifactDirectory, "field-comparison.json");
  const patientQaReferencePath = path.join(input.artifactDirectory, "patient-qa-reference.json");
  const qaDocumentSummaryPath = path.join(input.artifactDirectory, "qa-document-summary.json");
  const reviewOnlyOasisSuggestionsMetadataPath = path.join(
    input.artifactDirectory,
    "review-only-oasis-suggestions-metadata.json",
  );
  const referralReuseMetadataPath = path.join(input.artifactDirectory, "referral-reuse-metadata.json");
  const referralDocumentationFingerprint = hashReferralSuggestionInputs({
    sourceMeta: input.sourceMeta,
    extractionResult: input.extractionResult,
    extractedText: input.extractedText,
    normalizedSections: input.normalizedSections,
    extractedFacts: input.extractedFacts,
  });
  const reviewOnlyOasisSuggestionsMetadata = {
    schemaVersion: "review-only-oasis-suggestions-metadata.v1",
    generatedAt: new Date().toISOString(),
    referralDocumentationFingerprint,
    suggestionPolicy: "review_only",
    regenerationRule: "regenerate_when_referral_documentation_fingerprint_changes",
  };

  await Promise.all([
    writeFile(sourceMetaPath, JSON.stringify(input.sourceMeta, null, 2), "utf8"),
    writeFile(extractionResultPath, JSON.stringify(input.extractionResult, null, 2), "utf8"),
    writeFile(extractedTextPath, `${input.extractedText}\n`, "utf8"),
    writeFile(normalizedSectionsPath, JSON.stringify(input.normalizedSections, null, 2), "utf8"),
    writeFile(extractedFactsPath, JSON.stringify(input.extractedFacts, null, 2), "utf8"),
    writeFile(fieldMapSnapshotPath, JSON.stringify(input.fieldMapSnapshot, null, 2), "utf8"),
    writeFile(llmProposalPath, JSON.stringify(input.llmProposal, null, 2), "utf8"),
    writeFile(fieldComparisonPath, JSON.stringify(input.fieldComparisons, null, 2), "utf8"),
    writeFile(patientQaReferencePath, JSON.stringify(input.patientQaReference, null, 2), "utf8"),
    writeFile(qaDocumentSummaryPath, JSON.stringify(input.qaDocumentSummary, null, 2), "utf8"),
    writeFile(reviewOnlyOasisSuggestionsMetadataPath, JSON.stringify(reviewOnlyOasisSuggestionsMetadata, null, 2), "utf8"),
    writeFile(referralReuseMetadataPath, JSON.stringify(input.reuseMetadata, null, 2), "utf8"),
  ]);

  return {
    artifactDirectory: input.artifactDirectory,
    sourceMetaPath,
    extractionResultPath,
    extractedTextPath,
    normalizedSectionsPath,
    extractedFactsPath,
    fieldMapSnapshotPath,
    llmProposalPath,
    fieldComparisonPath,
    patientQaReferencePath,
    qaDocumentSummaryPath,
    reviewOnlyOasisSuggestionsMetadataPath,
  };
}

export async function runReferralDocumentProcessingPipeline(input: {
  workItem: PatientEpisodeWorkItem;
  outputDir: string;
  env: FinaleBatchEnv;
  logger: Logger;
  extractedDocuments: ExtractedDocument[];
  currentChartValues?: Record<string, unknown>;
  currentChartValueSource?: ChartSnapshotValueSource;
}): Promise<{ result: ReferralDocumentProcessingResult | null; stepLogs: AutomationStepLog[] }> {
  const patientName = input.workItem.patientIdentity.displayName;
  const stepLogs: AutomationStepLog[] = [];
  const artifactDirectory = path.join(input.outputDir, "patients", input.workItem.id, "referral-document-processing");

  const sourceDocuments = await buildSourceReferences({
    extractedDocuments: input.extractedDocuments,
    patientId: input.workItem.id,
    patientName: input.workItem.patientIdentity.displayName,
    outputDir: input.outputDir,
  });
  const evaluatedCandidates = await evaluateSourceDocuments({
    references: sourceDocuments,
    extractedDocuments: input.extractedDocuments,
  });
  const usableCandidates = evaluatedCandidates.filter(
    (candidate) =>
      candidate.extractionQuality.usabilityStatus === "usable" &&
      normalizeDocumentText(candidate.extractedText).length > 0,
  );
  const selectedCandidates = usableCandidates.length > 0
    ? usableCandidates
    : evaluatedCandidates.slice(0, 1);
  const selectedCandidate = selectedCandidates[0] ?? null;
  const selectedSource = selectedCandidate?.reference ?? null;
  const selectedDocumentIds = new Set(selectedCandidates.map((candidate) => candidate.reference.documentId));
  const selectedDocumentId = selectedCandidates.length > 1
    ? `combined:${selectedCandidates.map((candidate) => candidate.reference.documentId).join(",")}`
    : selectedSource?.documentId ?? null;
  const sourceMeta: SourceDocumentArtifact = {
    patientId: input.workItem.id,
    selectedDocumentId,
    sourceDocuments: sourceDocuments.map((sourceDocument) => ({
      ...sourceDocument,
      selectionStatus: selectedDocumentIds.has(sourceDocument.documentId)
        ? "selected"
        : evaluatedCandidates.find((candidate) => candidate.reference.documentId === sourceDocument.documentId)
          ?.extractionQuality.usabilityStatus === "rejected"
          ? "rejected"
          : sourceDocument.selectionStatus,
      selectedReason: selectedDocumentIds.has(sourceDocument.documentId)
        ? "usable referral source included in combined referral processing"
        : sourceDocument.selectedReason,
      rejectedReasons:
        evaluatedCandidates.find((candidate) => candidate.reference.documentId === sourceDocument.documentId)
          ?.extractionQuality.rejectedReasons ?? sourceDocument.rejectedReasons,
    })),
    warnings: selectedSource
      ? evaluatedCandidates
        .filter((candidate) => candidate.extractionQuality.usabilityStatus !== "usable")
        .map((candidate) =>
          `${candidate.reference.sourceLabel}: ${candidate.extractionQuality.usabilityStatus} (${candidate.extractionQuality.rejectedReasons.join(", ") || "no usable text"})`,
        )
      : ["No referral/admission-order source document was available for processing."],
    generatedAt: new Date().toISOString(),
  };
  stepLogs.push(createAutomationStepLog({
    step: "source_document_identified",
    message: selectedSource
      ? `Identified referral/admission-order source document candidates and selected ${selectedCandidates.length} usable source document(s) for combined processing.`
      : "No referral/admission-order source document could be identified for processing.",
    patientName,
    found: sourceDocuments.map((document) => `${document.documentId}:${document.sourceType}:${document.localFilePath ?? "in_memory"}`),
    missing: selectedSource ? [] : ["referral/admission-order source document"],
    evidence: selectedDocumentId ? [`selectedDocumentId=${selectedDocumentId}`] : [],
    safeReadConfirmed: true,
  }));

  if (!selectedSource) {
    const extractionResult = buildExtractionResult({
      sourceReference: null,
      localExtraction: null,
      fallbackText: "",
    });
    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({
        workItem: input.workItem,
        currentChartValues: input.currentChartValues,
        currentChartValueSource: input.currentChartValueSource,
      }),
    });
    const extractedFacts = buildEmptyExtractedFacts(fieldMapSnapshot);
    const llmProposal = await generateReferralFieldProposals({
      env: input.env,
      fieldMapSnapshot,
      extractedFacts,
      sourceText: "",
    });
    const fieldComparisons = compareProposedFieldsAgainstChart({
      fieldMapSnapshot,
      proposals: llmProposal.proposed_field_values,
      diagnosisCandidates: llmProposal.diagnosis_candidates,
    });
    const referralQaInsights = await generateReferralQaInsights({
      env: input.env,
      extractedFacts,
      fieldMapSnapshot,
      llmProposal,
      fieldComparisons,
      normalizedSections: [],
      sourceText: "",
    });
    const patientQaReference = buildPatientQaReference({
      workItem: input.workItem,
      sourceMeta,
      extractedText: "",
      normalizedSections: [],
      fieldMapSnapshot,
      llmProposal,
      fieldComparisons,
      referralQaInsights,
    });
    const qaDocumentSummary = buildQaDocumentSummary({
      selectedDocumentId: null,
      extractionResult,
      normalizedSectionCount: 0,
      llmProposalCount: llmProposal.proposed_field_values.length,
      fieldComparisons,
      warnings: sourceMeta.warnings,
    });
    const artifacts = await persistArtifacts({
      artifactDirectory,
      sourceMeta,
      extractionResult,
      extractedText: "",
      normalizedSections: [],
      extractedFacts,
      fieldMapSnapshot,
      llmProposal,
      fieldComparisons,
      patientQaReference,
      qaDocumentSummary,
      reuseMetadata: {
        schemaVersion: "referral-reuse-metadata.v1",
        generatedAt: new Date().toISOString(),
        referralUploadFingerprint: buildReferralUploadFingerprint({ sourceMeta, extractedText: "" }),
        processingInputFingerprint: buildReferralProcessingInputFingerprint({
          sourceMeta,
          extractionResult,
          extractedText: "",
          fieldMapSnapshot,
        }),
        reusedFromPreviousRun: false,
      },
    });
    return {
      result: {
        sourceMeta,
        extractionResult,
        normalizedSections: [],
        extractedFacts,
        fieldMapSnapshot,
        llmProposal,
        fieldComparisons,
        patientQaReference,
        qaDocumentSummary,
        artifacts,
      },
      stepLogs,
    };
  }

  let localExtraction: Awaited<ReturnType<typeof extractTextFromLocalFile>> | null = selectedCandidate?.localExtraction ?? null;
  const selectedExtractedDocument = selectedSource.sourceIndex >= 0
    ? input.extractedDocuments[selectedSource.sourceIndex] ?? null
    : null;
  if (selectedSource.localFilePath && !localExtraction) {
    try {
      localExtraction = await extractTextFromLocalFile(selectedSource.localFilePath);
    } catch (error) {
      sourceMeta.warnings.push(`Local file extraction failed for ${selectedSource.localFilePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  stepLogs.push(createAutomationStepLog({
    step: "source_document_acquired",
    message: selectedSource.localFilePath
      ? "Selected referral/admission-order file is available locally for read-only processing."
      : "Selected referral/admission-order source is only available as in-memory extracted text fallback.",
    patientName,
    found: selectedSource.localFilePath ? [selectedSource.localFilePath] : [],
    missing: selectedSource.localFilePath ? [] : ["local referral/admission-order file"],
    evidence: [`acquisitionMethod=${selectedSource.acquisitionMethod}`],
    safeReadConfirmed: true,
  }));

  const fallbackText = selectedExtractedDocument?.text ?? "";
  stepLogs.push(createAutomationStepLog({
    step: "document_extraction_started",
    message: "Started referral/admission-order document extraction from the canonical local file when available.",
    patientName,
    found: [selectedSource.localFilePath ?? "in_memory_fallback"],
    safeReadConfirmed: true,
  }));

  const extractionResult = buildExtractionResult({
    sourceReference: selectedSource,
    localExtraction,
    fallbackText,
  });
  const combinedReferralText = buildCombinedReferralText(usableCandidates);
  const selectedExtractionText = resolveReferralExtractionText({
    localExtraction,
    fallbackText,
    fileType: selectedSource.fileType,
  });
  const extractedText = combinedReferralText || selectedExtractionText;
  const combinedExtractionQuality = evaluateDocumentExtractionQuality({
    text: extractedText || normalizeDocumentText(localExtraction?.text) || normalizeDocumentText(fallbackText),
    extraction: {
      pdfType: extractionResult.pdfType,
      rawExtractedTextSource: extractionResult.rawExtractedTextSource === "ocr" ||
        extractionResult.rawExtractedTextSource === "hybrid"
        ? extractionResult.rawExtractedTextSource
        : "dom",
      domExtractionRejectedReasons: extractionResult.domExtractionRejectedReasons,
    },
    fileType: extractionResult.fileType,
  });
  extractionResult.documentId = selectedDocumentId ?? extractionResult.documentId;
  extractionResult.extractionQuality = combinedExtractionQuality;
  extractionResult.extractionSuccess = combinedExtractionQuality.usabilityStatus === "usable";
  extractionResult.warnings = [
    ...extractionResult.warnings,
    ...(selectedCandidates.length > 1 ? [`Combined ${selectedCandidates.length} usable referral source documents.`] : []),
  ];
  const extractedTextUsableForReferralFacts = combinedExtractionQuality.usabilityStatus === "usable";
  const referralProcessingText = extractedTextUsableForReferralFacts ? extractedText : "";
  const referralProcessingDocuments = extractedTextUsableForReferralFacts
    ? selectedCandidates
      .map((candidate) =>
        candidate.reference.sourceIndex >= 0
          ? input.extractedDocuments[candidate.reference.sourceIndex] ?? null
          : null,
      )
      .filter((document): document is ExtractedDocument => document !== null)
    : [];
  stepLogs.push(createAutomationStepLog({
    step: "document_extraction_completed",
    message: extractionResult.extractionSuccess
      ? "Completed referral/admission-order extraction."
      : "Referral/admission-order extraction did not produce usable text.",
    patientName,
    found: [
      `extractionMethod=${extractionResult.extractionMethod}`,
      `effectiveTextSource=${extractionResult.effectiveTextSource ?? "none"}`,
      `textLength=${extractedText.length}`,
      `selectedSourceCount=${selectedCandidates.length}`,
    ],
    missing: extractionResult.extractionSuccess ? [] : ["usable extracted text"],
    evidence: extractionResult.failureReasons,
    safeReadConfirmed: true,
  }));

  stepLogs.push(createAutomationStepLog({
    step: "extraction_quality_evaluated",
    message: `Evaluated extraction quality with usability status ${extractionResult.extractionQuality.usabilityStatus}.`,
    patientName,
    found: [
      `characterCount=${extractionResult.extractionQuality.characterCount}`,
      `tokenCount=${extractionResult.extractionQuality.normalizedTokenCount}`,
      `likelyUsableForLlm=${extractionResult.extractionQuality.likelyUsableForLlm}`,
      `likelyRequiresOcrRetry=${extractionResult.extractionQuality.likelyRequiresOcrRetry}`,
    ],
    missing: extractionResult.extractionQuality.rejectedReasons.length === 0 ? [] : extractionResult.extractionQuality.rejectedReasons,
    safeReadConfirmed: true,
  }));

  const normalizedSections = extractedTextUsableForReferralFacts
    ? normalizeReferralSections(extractedText)
    : [];
  const normalizedReferralSections = extractedTextUsableForReferralFacts
    ? normalizedSections
    : [];
  stepLogs.push(createAutomationStepLog({
    step: "referral_sections_normalized",
    message: extractedTextUsableForReferralFacts
      ? `Normalized referral text into ${normalizedReferralSections.length} semantic sections.`
      : "Skipped referral section normalization because extraction quality was not usable.",
    patientName,
    found: normalizedReferralSections.map((section) => `${section.sectionName}:${section.confidence}`),
    missing: extractedTextUsableForReferralFacts ? [] : extractionResult.extractionQuality.rejectedReasons,
    safeReadConfirmed: true,
  }));

  const fieldMapSnapshot = buildFieldMapSnapshot({
    chartSnapshotValues: createInitialChartSnapshotValues({
      workItem: input.workItem,
      currentChartValues: input.currentChartValues,
      currentChartValueSource: input.currentChartValueSource,
    }),
  });
  const referralUploadFingerprint = buildReferralUploadFingerprint({
    sourceMeta,
    extractedText: referralProcessingText,
  });
  const processingInputFingerprint = buildReferralProcessingInputFingerprint({
    sourceMeta,
    extractionResult,
    extractedText: referralProcessingText,
    fieldMapSnapshot,
  });
  const reusableReferralArtifacts = await loadReusableReferralArtifacts({
    artifactDirectory,
    processingInputFingerprint,
  });
  if (reusableReferralArtifacts) {
    await writeFile(
      path.join(artifactDirectory, "referral-reuse-metadata.json"),
      JSON.stringify({
        schemaVersion: "referral-reuse-metadata.v1",
        generatedAt: new Date().toISOString(),
        referralUploadFingerprint,
        processingInputFingerprint,
        reusedFromPreviousRun: true,
      } satisfies ReferralReuseMetadata, null, 2),
      "utf8",
    );
    stepLogs.push(createAutomationStepLog({
      step: "referral_processing_reused",
      message: "Reused referral facts, comparison rows, and LLM outputs because referral source and chart snapshot fingerprints were unchanged.",
      patientName,
      found: [
        `referralUploadFingerprint=${referralUploadFingerprint}`,
        `processingInputFingerprint=${processingInputFingerprint}`,
      ],
      evidence: [
        `artifactDirectory=${artifactDirectory}`,
        "ocr_llm_skipped=true",
      ],
      safeReadConfirmed: true,
    }));
    return {
      result: reusableReferralArtifacts,
      stepLogs,
    };
  }
  const extractedFacts = extractReferralFacts({
    fieldMapSnapshot,
    sections: normalizedReferralSections,
    sourceText: referralProcessingText,
  });
  stepLogs.push(createAutomationStepLog({
    step: "chart_snapshot_created",
    message: "Built a read-only chart/OASIS field snapshot and categorization buckets for referral comparison.",
    patientName,
    found: [
      `alreadyPopulated=${fieldMapSnapshot.already_populated_from_chart.length}`,
      `llmCandidates=${fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral.length}`,
      `humanReviewRequired=${fieldMapSnapshot.required_human_review_fields.length}`,
      `referenceOnly=${fieldMapSnapshot.non_fillable_reference_only_fields.length}`,
    ],
    safeReadConfirmed: true,
  }));
  stepLogs.push(createAutomationStepLog({
    step: "referral_facts_extracted",
    message: `Extracted ${extractedFacts.facts.length} referral facts before field mapping.`,
    patientName,
    found: extractedFacts.facts.map((fact) => `${fact.fact_key}:${fact.category}`),
    missing: extractedFacts.unsupported_or_missing_fields,
    evidence: extractedFacts.facts.flatMap((fact) => fact.evidence_spans).slice(0, 8),
    safeReadConfirmed: true,
  }));

  stepLogs.push(createAutomationStepLog({
    step: "llm_field_proposal_started",
    message: "Started referral-to-field proposal generation using the strict JSON contract.",
    patientName,
    found: [`candidateFieldCount=${fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral.length}`],
    safeReadConfirmed: true,
  }));

  const llmProposal = await generateReferralFieldProposals({
    env: input.env,
    fieldMapSnapshot,
    extractedFacts,
    sourceText: referralProcessingText,
    extractedDocuments: referralProcessingDocuments,
  });
  stepLogs.push(createAutomationStepLog({
    step: "llm_field_proposal_completed",
    message: `Completed referral-to-field proposal generation with ${llmProposal.proposed_field_values.length} field proposals.`,
    patientName,
    found: [
      `proposalCount=${llmProposal.proposed_field_values.length}`,
      `diagnosisCandidateCount=${llmProposal.diagnosis_candidates.length}`,
    ],
    evidence: llmProposal.warnings,
    safeReadConfirmed: true,
  }));

  const fieldComparisons = compareProposedFieldsAgainstChart({
    fieldMapSnapshot,
    proposals: llmProposal.proposed_field_values,
    diagnosisCandidates: llmProposal.diagnosis_candidates,
  });
  stepLogs.push(createAutomationStepLog({
    step: "field_comparison_completed",
    message: `Completed referral proposal comparison across ${fieldComparisons.length} fields.`,
    patientName,
    found: fieldComparisons.map((result) => `${result.field_key}:${result.comparison_status}`),
    safeReadConfirmed: true,
  }));

  stepLogs.push(createAutomationStepLog({
    step: "llm_qa_insights_started",
    message: "Started referral QA insight synthesis for comparisons, source highlights, and draft narratives.",
    patientName,
    safeReadConfirmed: true,
  }));

  const referralQaInsights = await generateReferralQaInsights({
    env: input.env,
    extractedFacts,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    normalizedSections: normalizedReferralSections,
    sourceText: referralProcessingText,
  });

  stepLogs.push(createAutomationStepLog({
    step: "llm_qa_insights_completed",
    message: `Completed referral QA insight synthesis with ${referralQaInsights.consistency_checks.length} consistency checks and ${referralQaInsights.draft_narratives.length} narrative drafts.`,
    patientName,
    found: [
      `consistencyChecks=${referralQaInsights.consistency_checks.length}`,
      `sourceHighlights=${referralQaInsights.source_highlights.length}`,
      `draftNarratives=${referralQaInsights.draft_narratives.length}`,
    ],
    evidence: referralQaInsights.warnings,
    safeReadConfirmed: true,
  }));

  const patientQaReference = buildPatientQaReference({
    workItem: input.workItem,
    sourceMeta,
    extractedText: referralProcessingText,
    normalizedSections: normalizedReferralSections,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    referralQaInsights,
  });

  const qaDocumentSummary = buildQaDocumentSummary({
    selectedDocumentId,
    extractionResult,
    normalizedSectionCount: normalizedReferralSections.length,
    llmProposalCount: llmProposal.proposed_field_values.length,
    fieldComparisons,
    warnings: [
      ...sourceMeta.warnings,
      ...extractionResult.failureReasons,
      ...extractionResult.warnings,
      ...llmProposal.warnings,
    ],
  });

  const artifacts = await persistArtifacts({
    artifactDirectory,
    sourceMeta,
    extractionResult: {
      ...extractionResult,
      extractedTextPath: path.join(artifactDirectory, "extracted-text.txt"),
    },
    extractedText: referralProcessingText,
    normalizedSections: normalizedReferralSections,
    extractedFacts,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    patientQaReference,
    qaDocumentSummary,
    reuseMetadata: {
      schemaVersion: "referral-reuse-metadata.v1",
      generatedAt: new Date().toISOString(),
      referralUploadFingerprint,
      processingInputFingerprint,
      reusedFromPreviousRun: false,
    },
  });

  input.logger.info({
    patientId: input.workItem.id,
    patientName,
    selectedDocumentId,
    artifactDirectory,
    extractionUsabilityStatus: qaDocumentSummary.extractionUsabilityStatus,
      normalizedSectionCount: qaDocumentSummary.normalizedSectionCount,
    extractedFactCount: extractedFacts.facts.length,
    llmProposalCount: qaDocumentSummary.llmProposalCount,
  }, "referral document processing pipeline completed");

  stepLogs.push(createAutomationStepLog({
    step: "qa_document_summary_persisted",
    message: "Persisted read-only referral document QA artifacts.",
    patientName,
    found: [
      artifacts.sourceMetaPath,
      artifacts.extractionResultPath,
      artifacts.normalizedSectionsPath,
      artifacts.extractedFactsPath,
      artifacts.fieldMapSnapshotPath,
      artifacts.llmProposalPath,
      artifacts.fieldComparisonPath,
      artifacts.patientQaReferencePath,
      artifacts.qaDocumentSummaryPath,
      artifacts.reviewOnlyOasisSuggestionsMetadataPath,
    ],
    safeReadConfirmed: true,
  }));

  return {
    result: {
      sourceMeta,
      extractionResult: {
        ...extractionResult,
        extractedTextPath: artifacts.extractedTextPath,
      },
      normalizedSections: normalizedReferralSections,
      extractedFacts,
      fieldMapSnapshot,
      llmProposal,
      fieldComparisons,
      patientQaReference,
      qaDocumentSummary,
      artifacts,
    },
    stepLogs,
  };
}
