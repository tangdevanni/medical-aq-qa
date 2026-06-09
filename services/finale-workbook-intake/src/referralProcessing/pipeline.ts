import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { FinaleBatchEnv } from "../config/env";
import type { ExtractedDocument } from "../services/documentExtractionService";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "./fieldContract";
import { compareProposedFieldsAgainstChart } from "./comparisonEngine";
import { classifySourceDocumentFileType } from "./extractionQuality";
import { generateReferralQaInsights } from "./referralQaInsightsService";
import { buildPatientQaReference } from "../qaReference/projection";
import { normalizePatientName } from "../utils/patientName";
import {
  extractReferralDirectDocument,
  REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION,
  ReferralDirectDocumentInvalidJsonError,
  type ReferralDirectDocumentFailureDiagnostic,
  type ReferralDirectDocumentExtractionResult,
} from "./directDocumentExtractor";
import type {
  ChartSnapshotValueSource,
  DocumentExtractionQuality,
  FieldComparisonResult,
  QaDocumentSummary,
  ReferralDocumentProcessingArtifacts,
  ReferralDocumentProcessingResult,
  ReferralExtractedFact,
  ReferralFieldProposal,
  ReferralLlmProposal,
  ReferralSourceDocumentType,
  SourceDocumentAcquisitionMethod,
  SourceDocumentArtifact,
  SourceDocumentFileType,
  SourceDocumentExtractionResult,
  SourceDocumentReference,
} from "./types";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";

export interface ReferralSourceDocumentInput {
  sourceLabel?: string | null;
  sourcePath?: string | null;
  extractedTextPath?: string | null;
  portalLabel?: string | null;
  acquisitionMethod?: SourceDocumentAcquisitionMethod | null;
}

type ReferralDirectDocumentExtractor = typeof extractReferralDirectDocument;

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
      sourceContentSha256: document.sourceContentSha256,
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
  configuredModelId: string | null;
}): string {
  return hashStableJson({
    uploadFingerprint: buildReferralUploadFingerprint({
      sourceMeta: input.sourceMeta,
      extractedText: input.extractedText,
    }),
    extractionMode: "direct_document_llm_only",
    directDocumentSchemaVersion: REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION,
    configuredModelId: input.configuredModelId,
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
    extractionResult.extractionSuccess !== true ||
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
      directDocumentResultPath: path.join(input.artifactDirectory, "direct-document-result.json"),
    },
  };
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";
}

function detectSourceTypeFromText(value: string | null | undefined): ReferralSourceDocumentType {
  const label = normalizeWhitespace(value);
  if (/discharge/i.test(label)) {
    return "HOSPITAL_DISCHARGE";
  }
  if (/admission/i.test(label)) {
    return "ADMISSION_ORDER";
  }
  if (/referral|order|physician/i.test(label)) {
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

async function readFileMetadata(filePath: string | null | undefined): Promise<{
  fileSizeBytes: number | null;
  sourceContentSha256: string | null;
}> {
  if (!filePath) {
    return {
      fileSizeBytes: null,
      sourceContentSha256: null,
    };
  }

  try {
    const bytes = await readFile(filePath);
    return {
      fileSizeBytes: bytes.byteLength,
      sourceContentSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    try {
      return {
        fileSizeBytes: (await stat(filePath)).size,
        sourceContentSha256: null,
      };
    } catch {
      return {
        fileSizeBytes: null,
        sourceContentSha256: null,
      };
    }
  }
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
  sourceDocuments?: ReferralSourceDocumentInput[];
  patientId: string;
  patientName: string;
  outputDir: string;
  includeManualSourceCandidates?: boolean;
}): Promise<SourceDocumentReference[]> {
  const references: SourceDocumentReference[] = [];
  const seenLocalPaths = new Set<string>();

  for (const [index, sourceDocument] of (input.sourceDocuments ?? []).entries()) {
    const sourcePath = normalizeWhitespace(sourceDocument.sourcePath);
    const extractedTextPath = normalizeWhitespace(sourceDocument.extractedTextPath);
    const localFilePath = sourcePath || extractedTextPath || null;
    if (!localFilePath) {
      continue;
    }
    seenLocalPaths.add(path.resolve(localFilePath));
    const sourceLabel =
      normalizeWhitespace(sourceDocument.sourceLabel) ||
      normalizeWhitespace(sourceDocument.portalLabel) ||
      path.basename(localFilePath);
    const fileMetadata = await readFileMetadata(localFilePath);

    references.push({
      documentId: `${input.patientId}-referral-source-${index + 1}`,
      sourceIndex: -1,
      sourceLabel,
      normalizedSourceLabel: slugify(sourceLabel),
      sourceType: detectSourceTypeFromText(`${sourceLabel} ${localFilePath}`),
      acquisitionMethod: sourceDocument.acquisitionMethod ?? "download",
      selectionStatus: "candidate",
      portalLabel: normalizeWhitespace(sourceDocument.portalLabel) || null,
      localFilePath,
      effectiveTextSource: null,
      fileType: classifySourceDocumentFileType(localFilePath),
      fileSizeBytes: fileMetadata.fileSizeBytes,
      sourceContentSha256: fileMetadata.sourceContentSha256,
      extractedTextLength: 0,
      selectedReason: null,
      rejectedReasons: [],
    });
  }

  for (const [index, document] of input.extractedDocuments.entries()) {
    if (document.type !== "ORDER") {
      continue;
    }

    const localFilePath = document.metadata.sourcePath ?? null;
    const fileMetadata = await readFileMetadata(localFilePath);
    if (localFilePath) {
      seenLocalPaths.add(path.resolve(localFilePath));
    }

    references.push({
      documentId: `${input.patientId}-referral-${index + 1}`,
      sourceIndex: index,
      sourceLabel: document.metadata.portalLabel ?? path.basename(localFilePath ?? `order-${index + 1}`),
      normalizedSourceLabel: slugify(document.metadata.portalLabel ?? localFilePath ?? `order-${index + 1}`),
      sourceType: detectSourceTypeFromText(`${document.metadata.portalLabel ?? ""} ${document.metadata.sourcePath ?? ""}`),
      acquisitionMethod: detectAcquisitionMethod(document),
      selectionStatus: "candidate",
      portalLabel: document.metadata.portalLabel ?? null,
      localFilePath,
      effectiveTextSource: document.metadata.effectiveTextSource ?? null,
      fileType: classifySourceDocumentFileType(localFilePath),
      fileSizeBytes: fileMetadata.fileSizeBytes,
      sourceContentSha256: fileMetadata.sourceContentSha256,
      extractedTextLength: document.text.length,
      selectedReason: null,
      rejectedReasons: [],
    });
  }

  if (input.includeManualSourceCandidates !== false) {
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
        const fileMetadata = await readFileMetadata(localFilePath);
        fileSizeBytes = fileMetadata.fileSizeBytes;

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
          sourceContentSha256: fileMetadata.sourceContentSha256,
          extractedTextLength: 0,
          selectedReason: null,
          rejectedReasons: [],
        });
        seenLocalPaths.add(resolvedPath);
      }
    } catch {
      // Manual batch-source documents are optional.
    }
  }

  return references;
}

function isDirectDocumentSupportedFileType(value: SourceDocumentFileType): value is "pdf" | "jpg" | "jpeg" | "png" {
  return value === "pdf" || value === "jpg" || value === "jpeg" || value === "png";
}

function sourceTypeRank(value: ReferralSourceDocumentType): number {
  switch (value) {
    case "REFERRAL_ORDER":
      return 4;
    case "ADMISSION_ORDER":
      return 3;
    case "HOSPITAL_DISCHARGE":
      return 2;
    default:
      return 1;
  }
}

async function localFileExists(filePath: string | null | undefined): Promise<boolean> {
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

async function selectDirectDocumentSource(references: SourceDocumentReference[]): Promise<SourceDocumentReference | null> {
  const candidates: SourceDocumentReference[] = [];
  for (const reference of references) {
    if (!reference.localFilePath || !isDirectDocumentSupportedFileType(reference.fileType)) {
      continue;
    }
    if (!(await localFileExists(reference.localFilePath))) {
      continue;
    }
    candidates.push(reference);
  }

  return candidates.sort((left, right) =>
    sourceTypeRank(right.sourceType) - sourceTypeRank(left.sourceType) ||
    Number(right.sourceContentSha256 !== null) - Number(left.sourceContentSha256 !== null) ||
    (right.fileSizeBytes ?? 0) - (left.fileSizeBytes ?? 0) ||
    left.sourceLabel.localeCompare(right.sourceLabel)
  )[0] ?? null;
}

function buildDirectExtractionQuality(input: {
  directDocumentResult: ReferralDirectDocumentExtractionResult | null;
  selectedSource: SourceDocumentReference | null;
  failureReasons: string[];
}): DocumentExtractionQuality {
  const diagnosisCount = input.directDocumentResult?.accepted.diagnoses.length ?? 0;
  const medicationCount = input.directDocumentResult?.accepted.medications.length ?? 0;
  const fieldProposalCount = input.directDocumentResult?.accepted.fieldProposals.length ?? 0;
  const acceptedFactCount = diagnosisCount + medicationCount + fieldProposalCount;
  const directEvidenceText = buildDirectDocumentEvidenceText(input.directDocumentResult);
  const characterCount = directEvidenceText.length;
  const rejectedReasons: DocumentExtractionQuality["rejectedReasons"] = [];
  if (!input.selectedSource) {
    rejectedReasons.push("unsupported_file_type");
  }
  if (acceptedFactCount === 0) {
    rejectedReasons.push(characterCount > 0 ? "no_clinical_vocabulary" : "empty_text");
  }
  if (input.failureReasons.length > 0 && rejectedReasons.length === 0) {
    rejectedReasons.push("empty_text");
  }

  return {
    characterCount,
    lineCount: directEvidenceText ? directEvidenceText.split(/\n+/).length : 0,
    normalizedTokenCount: directEvidenceText ? directEvidenceText.split(/\s+/).filter(Boolean).length : 0,
    containsClinicalVocabulary: acceptedFactCount > 0,
    containsDiagnosisLikePatterns: diagnosisCount > 0,
    containsDatePatterns: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(directEvidenceText),
    containsSectionLikeHeadings: acceptedFactCount > 0,
    likelyUsableForLlm: acceptedFactCount > 0,
    likelyRequiresOcrRetry: false,
    likelyCorruptedEncoding: false,
    rejectedReasons: Array.from(new Set(rejectedReasons)),
    usabilityStatus: acceptedFactCount > 0 && input.failureReasons.length === 0 ? "usable" : "rejected",
  };
}

function buildDirectExtractionResult(input: {
  selectedSource: SourceDocumentReference | null;
  directDocumentResult: ReferralDirectDocumentExtractionResult | null;
  failureReasons: string[];
  warnings: string[];
}): SourceDocumentExtractionResult {
  const extractionQuality = buildDirectExtractionQuality({
    directDocumentResult: input.directDocumentResult,
    selectedSource: input.selectedSource,
    failureReasons: input.failureReasons,
  });

  return {
    documentId: input.selectedSource?.documentId ?? "unselected",
    localFilePath: input.selectedSource?.localFilePath ?? null,
    fileType: input.selectedSource?.fileType ?? "unknown",
    extractionMethod: extractionQuality.usabilityStatus === "usable" ? "direct_document_llm" : "failed",
    extractionSuccess: extractionQuality.usabilityStatus === "usable",
    effectiveTextSource: "direct_document_llm",
    rawExtractedTextSource: "direct_document_llm",
    textSelectionReason: "direct_document_llm_source_quotes_only",
    domExtractionRejectedReasons: [],
    pdfType: input.selectedSource?.fileType === "pdf" ? null : null,
    ocrUsed: false,
    ocrProvider: null,
    ocrResultPath: null,
    extractedTextPath: null,
    extractionQuality,
    failureReasons: input.failureReasons,
    warnings: input.warnings,
    generatedAt: new Date().toISOString(),
  };
}

function buildDirectDocumentEvidenceText(result: ReferralDirectDocumentExtractionResult | null): string {
  if (!result) {
    return "";
  }
  return normalizeDocumentText([
    ...result.accepted.diagnoses.map((diagnosis) => diagnosis.source_quote),
    ...result.accepted.medications.map((medication) => medication.source_quote),
    ...result.accepted.fieldProposals.map((proposal) => proposal.source_quote),
  ].filter((value): value is string => Boolean(normalizeWhitespace(value))).join("\n"));
}

function buildDirectNormalizedSections(
  result: ReferralDirectDocumentExtractionResult | null,
): ReferralDocumentProcessingResult["normalizedSections"] {
  if (!result) {
    return [];
  }

  const sections: ReferralDocumentProcessingResult["normalizedSections"] = [];
  const diagnosisQuotes = result.accepted.diagnoses
    .map((diagnosis) => normalizeWhitespace(diagnosis.source_quote))
    .filter(Boolean);
  if (diagnosisQuotes.length > 0) {
    sections.push({
      sectionName: "diagnoses",
      extractedTextSpans: diagnosisQuotes,
      normalizedSummary: result.accepted.diagnoses
        .map((diagnosis) => [diagnosis.icd10_code, diagnosis.description].filter(Boolean).join(" "))
        .join("; "),
      confidence: Math.max(...result.accepted.diagnoses.map((diagnosis) => diagnosis.confidence)),
      lineReferences: [],
    });
  }

  const medicationQuotes = result.accepted.medications
    .map((medication) => normalizeWhitespace(medication.source_quote))
    .filter(Boolean);
  if (medicationQuotes.length > 0) {
    sections.push({
      sectionName: "medications",
      extractedTextSpans: medicationQuotes,
      normalizedSummary: result.accepted.medications
        .map((medication) => [
          medication.name,
          medication.dose,
          medication.route,
          medication.frequency,
          medication.start_date ? `start ${medication.start_date}` : null,
        ].filter(Boolean).join(" "))
        .join("; "),
      confidence: Math.max(...result.accepted.medications.map((medication) => medication.confidence)),
      lineReferences: [],
    });
  }

  const proposalsByField = new Map<string, string[]>();
  for (const proposal of result.accepted.fieldProposals) {
    const quote = normalizeWhitespace(proposal.source_quote);
    if (!quote) {
      continue;
    }
    const existing = proposalsByField.get(proposal.field_key) ?? [];
    existing.push(quote);
    proposalsByField.set(proposal.field_key, existing);
  }
  for (const [fieldKey, quotes] of proposalsByField) {
    sections.push({
      sectionName: fieldKey,
      extractedTextSpans: quotes.slice(0, 8),
      normalizedSummary: normalizeWhitespace(quotes.join("; ")) || null,
      confidence: Math.max(
        ...result.accepted.fieldProposals
          .filter((proposal) => proposal.field_key === fieldKey)
          .map((proposal) => proposal.confidence),
      ),
      lineReferences: [],
    });
  }

  return sections;
}

function buildEmptyLlmProposal(input: {
  fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"];
  extractedFacts: ReferralDocumentProcessingResult["extractedFacts"];
  warnings: string[];
}): ReferralLlmProposal {
  return {
    patient_context: input.extractedFacts.patient_context,
    proposed_field_values: [],
    diagnosis_candidates: input.extractedFacts.diagnosis_candidates,
    caregiver_candidates: [],
    unsupported_or_missing_fields: Array.from(new Set([
      ...input.extractedFacts.unsupported_or_missing_fields,
      ...input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral,
    ])),
    warnings: [
      ...input.extractedFacts.warnings,
      ...input.warnings,
    ],
  };
}

function mapDirectDiagnoses(
  result: ReferralDirectDocumentExtractionResult | null,
): ReferralDocumentProcessingResult["extractedFacts"]["diagnosis_candidates"] {
  return (result?.accepted.diagnoses ?? []).map((diagnosis) => ({
    description: diagnosis.description,
    icd10_code: diagnosis.icd10_code,
    confidence: diagnosis.confidence,
    source_spans: [diagnosis.source_quote].filter((value): value is string => Boolean(normalizeWhitespace(value))),
    is_primary_candidate: diagnosis.is_primary_candidate,
    requires_human_review: true,
  }));
}

function mapDirectMedicationList(result: ReferralDirectDocumentExtractionResult | null): Array<Record<string, unknown>> {
  return (result?.accepted.medications ?? []).map((medication) => ({
    name: medication.name,
    dose: medication.dose,
    route: medication.route,
    frequency: medication.frequency,
    start_date: medication.start_date,
    page: medication.page,
    source_quote: medication.source_quote,
    requires_human_review: medication.requires_human_review,
    review_reasons: medication.review_reasons,
  }));
}

function mapDirectFieldProposals(input: {
  directDocumentResult: ReferralDirectDocumentExtractionResult | null;
  fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"];
}): ReferralFieldProposal[] {
  const allowedFieldKeys = new Set(input.fieldMapSnapshot.fields.map((field) => field.key));
  const proposals: ReferralFieldProposal[] = [];
  for (const proposal of input.directDocumentResult?.accepted.fieldProposals ?? []) {
    const sourceQuote = normalizeWhitespace(proposal.source_quote);
    if (!allowedFieldKeys.has(proposal.field_key) || !sourceQuote) {
      continue;
    }
    const proposedValue = proposal.proposed_value;
    if (
      proposedValue === null ||
      proposedValue === "" ||
      (Array.isArray(proposedValue) && proposedValue.length === 0)
    ) {
      continue;
    }
    proposals.push({
      field_key: proposal.field_key,
      proposed_value: proposedValue,
      confidence: proposal.confidence,
      source_spans: [sourceQuote],
      rationale: "Referral field value was extracted directly from source-quoted referral/admission-order evidence.",
      requires_human_review: true,
    });
  }
  return proposals;
}

function referralFactCategoryForFieldKey(fieldKey: string): ReferralExtractedFact["category"] {
  if (/caregiver|emergency|contact/i.test(fieldKey)) return "caregiver";
  if (/living/i.test(fieldKey)) return "living_situation";
  if (/functional|mobility|gg_|prior_function|homebound/i.test(fieldKey)) return "functional";
  if (/therapy|plan|goal|intervention|coordination|visit/i.test(fieldKey)) return "therapy";
  if (/risk|fall|safety|norton|wound|hospitalization|medication|allergy|treatment/i.test(fieldKey)) return "risk";
  if (/code_status|directive/i.test(fieldKey)) return "directive";
  if (/reason|necessity|admit|summary|skilled/i.test(fieldKey)) return "medical_necessity";
  return "patient_context";
}

function buildDirectExtractedFacts(input: {
  fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"];
  directDocumentResult: ReferralDirectDocumentExtractionResult | null;
  warnings: string[];
}): ReferralDocumentProcessingResult["extractedFacts"] {
  const socDate = input.fieldMapSnapshot.fields.find((field) => field.key === "soc_date")?.currentChartValue;
  const diagnosisCandidates = mapDirectDiagnoses(input.directDocumentResult);
  const medications = mapDirectMedicationList(input.directDocumentResult);
  const facts: ReferralExtractedFact[] = [];

  if (medications.length > 0) {
    facts.push({
      fact_key: "medication_list",
      category: "risk",
      value: medications,
      confidence: Math.max(...(input.directDocumentResult?.accepted.medications ?? []).map((medication) => medication.confidence)),
      evidence_spans: (input.directDocumentResult?.accepted.medications ?? [])
        .map((medication) => medication.source_quote)
        .filter((value): value is string => Boolean(normalizeWhitespace(value)))
        .slice(0, 8),
      rationale: "Medication list was extracted directly from source-quoted referral/admission-order document evidence.",
      source_sections: ["medications"],
      requires_human_review: true,
    });
  }
  for (const proposal of input.directDocumentResult?.accepted.fieldProposals ?? []) {
    const sourceQuote = normalizeWhitespace(proposal.source_quote);
    if (!sourceQuote || proposal.proposed_value === null || proposal.proposed_value === "") {
      continue;
    }
    facts.push({
      fact_key: proposal.field_key,
      category: referralFactCategoryForFieldKey(proposal.field_key),
      value: proposal.proposed_value,
      confidence: proposal.confidence,
      evidence_spans: [sourceQuote],
      rationale: "Field proposal extracted directly from source-quoted referral/admission-order document evidence.",
      source_sections: [proposal.field_key],
      requires_human_review: true,
    });
  }

  return {
    patient_context: {
      patient_name: input.directDocumentResult?.payload.patient_context.patient_name ?? null,
      dob: input.directDocumentResult?.payload.patient_context.dob ?? null,
      soc_date: input.directDocumentResult?.payload.patient_context.soc_date ?? (typeof socDate === "string" ? socDate : null),
      referral_date: input.directDocumentResult?.payload.patient_context.referral_date ?? null,
    },
    facts,
    diagnosis_candidates: diagnosisCandidates,
    caregiver_candidates: [],
    unsupported_or_missing_fields: Array.from(new Set([
      ...input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral,
      ...(input.directDocumentResult?.payload.unsupported_or_missing_fields ?? []),
    ])),
    warnings: [
      ...input.warnings,
      ...(input.directDocumentResult?.warnings ?? []),
      ...(input.directDocumentResult?.rejected.diagnoses.length
        ? [`${input.directDocumentResult.rejected.diagnoses.length} uncited diagnosis candidate(s) held for review and not promoted.`]
        : []),
      ...(input.directDocumentResult?.rejected.medications.length
        ? [`${input.directDocumentResult.rejected.medications.length} uncited medication candidate(s) held for review and not promoted.`]
        : []),
      ...(input.directDocumentResult?.rejected.fieldProposals.length
        ? [`${input.directDocumentResult.rejected.fieldProposals.length} uncited field proposal(s) held for review and not promoted.`]
        : []),
    ],
  };
}

function buildDirectLlmProposal(input: {
  fieldMapSnapshot: ReferralDocumentProcessingResult["fieldMapSnapshot"];
  extractedFacts: ReferralDocumentProcessingResult["extractedFacts"];
  directDocumentResult: ReferralDirectDocumentExtractionResult | null;
  warnings: string[];
}): ReferralLlmProposal {
  const proposedFieldValues: ReferralLlmProposal["proposed_field_values"] = [];
  const directFieldProposals = mapDirectFieldProposals({
    directDocumentResult: input.directDocumentResult,
    fieldMapSnapshot: input.fieldMapSnapshot,
  });
  proposedFieldValues.push(...directFieldProposals);
  const medications = mapDirectMedicationList(input.directDocumentResult);
  const medicationQuotes = (input.directDocumentResult?.accepted.medications ?? [])
    .map((medication) => medication.source_quote)
    .filter((value): value is string => Boolean(normalizeWhitespace(value)));

  if (medications.length > 0 && !proposedFieldValues.some((proposal) => proposal.field_key === "medication_list")) {
    proposedFieldValues.push({
      field_key: "medication_list",
      proposed_value: medications,
      confidence: Math.max(...(input.directDocumentResult?.accepted.medications ?? []).map((medication) => medication.confidence)),
      source_spans: medicationQuotes.slice(0, 8),
      rationale: "Medication details, including start dates when present, were extracted directly from source-quoted referral/admission-order evidence.",
      requires_human_review: true,
    });
  }

  const unsupportedFields = new Set([
    ...input.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral,
    ...input.extractedFacts.unsupported_or_missing_fields,
    ...(input.directDocumentResult?.payload.unsupported_or_missing_fields ?? []),
  ]);
  for (const proposal of proposedFieldValues) {
    unsupportedFields.delete(proposal.field_key);
  }

  return {
    patient_context: input.extractedFacts.patient_context,
    proposed_field_values: proposedFieldValues,
    diagnosis_candidates: input.extractedFacts.diagnosis_candidates,
    caregiver_candidates: input.extractedFacts.caregiver_candidates,
    unsupported_or_missing_fields: Array.from(unsupportedFields),
    warnings: [
      ...input.extractedFacts.warnings,
      ...input.warnings,
    ],
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
  directDocumentResult?: ReferralDirectDocumentExtractionResult | null;
  directDocumentFailureDiagnostic?: ReferralDirectDocumentFailureDiagnostic | null;
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
  const directDocumentResultPath = path.join(input.artifactDirectory, "direct-document-result.json");
  const directDocumentFailureDiagnosticPath = path.join(input.artifactDirectory, "direct-document-failure-diagnostic.json");
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
    ...(input.directDocumentResult
      ? [writeFile(directDocumentResultPath, JSON.stringify(input.directDocumentResult, null, 2), "utf8")]
      : []),
    ...(input.directDocumentFailureDiagnostic
      ? [writeFile(directDocumentFailureDiagnosticPath, JSON.stringify(input.directDocumentFailureDiagnostic, null, 2), "utf8")]
      : []),
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
    ...(input.directDocumentResult ? { directDocumentResultPath } : {}),
    ...(input.directDocumentFailureDiagnostic ? { directDocumentFailureDiagnosticPath } : {}),
  };
}

export async function runReferralDocumentProcessingPipeline(input: {
  workItem: PatientEpisodeWorkItem;
  outputDir: string;
  env: FinaleBatchEnv;
  logger: Logger;
  extractedDocuments?: ExtractedDocument[];
  sourceDocuments?: ReferralSourceDocumentInput[];
  currentChartValues?: Record<string, unknown>;
  currentChartValueSource?: ChartSnapshotValueSource;
  directDocumentExtractor?: ReferralDirectDocumentExtractor;
  artifactDirectory?: string;
  includeManualSourceCandidates?: boolean;
}): Promise<{ result: ReferralDocumentProcessingResult | null; stepLogs: AutomationStepLog[] }> {
  const patientName = input.workItem.patientIdentity.displayName;
  const stepLogs: AutomationStepLog[] = [];
  const artifactDirectory =
    input.artifactDirectory ?? path.join(input.outputDir, "patients", input.workItem.id, "referral-document-processing");
  const extractedDocuments = input.extractedDocuments ?? [];
  const directDocumentExtractor = input.directDocumentExtractor ?? extractReferralDirectDocument;
  const configuredModelId = input.env.BEDROCK_MODEL_ID ?? input.env.BEDROCK_INFERENCE_PROFILE_ID ?? null;

  const sourceDocuments = await buildSourceReferences({
    extractedDocuments,
    sourceDocuments: input.sourceDocuments,
    patientId: input.workItem.id,
    patientName: input.workItem.patientIdentity.displayName,
    outputDir: input.outputDir,
    includeManualSourceCandidates: input.includeManualSourceCandidates,
  });
  const selectedSource = await selectDirectDocumentSource(sourceDocuments);
  const selectedDocumentId = selectedSource?.documentId ?? null;
  const sourceMeta: SourceDocumentArtifact = {
    patientId: input.workItem.id,
    selectedDocumentId,
    sourceDocuments: sourceDocuments.map((sourceDocument) => ({
      ...sourceDocument,
      selectionStatus: selectedDocumentId === sourceDocument.documentId
        ? "selected"
        : isDirectDocumentSupportedFileType(sourceDocument.fileType) && sourceDocument.localFilePath
          ? "candidate"
          : "rejected",
      selectedReason: selectedDocumentId === sourceDocument.documentId
        ? "captured local referral/admission-order source selected for direct-document LLM extraction"
        : sourceDocument.selectedReason,
      rejectedReasons: selectedDocumentId === sourceDocument.documentId
        ? []
        : [
            ...sourceDocument.rejectedReasons,
            ...(!sourceDocument.localFilePath ? ["missing_local_source_file"] : []),
            ...(!isDirectDocumentSupportedFileType(sourceDocument.fileType) ? [`unsupported_direct_document_file_type:${sourceDocument.fileType}`] : []),
          ],
    })),
    warnings: selectedSource
      ? []
      : ["No captured local referral/admission-order PDF or image was available for direct-document LLM extraction."],
    generatedAt: new Date().toISOString(),
  };
  stepLogs.push(createAutomationStepLog({
    step: "source_document_identified",
    message: selectedSource
      ? "Identified captured referral/admission-order source document for direct-document LLM processing."
      : "No direct-document-compatible referral/admission-order source document could be identified for processing.",
    patientName,
    found: sourceDocuments.map((document) => `${document.documentId}:${document.sourceType}:${document.localFilePath ?? "in_memory"}`),
    missing: selectedSource ? [] : ["captured local referral/admission-order PDF or image"],
    evidence: selectedDocumentId ? [`selectedDocumentId=${selectedDocumentId}`] : [],
    safeReadConfirmed: true,
  }));

  const fieldMapSnapshot = buildFieldMapSnapshot({
    chartSnapshotValues: createInitialChartSnapshotValues({
      workItem: input.workItem,
      currentChartValues: input.currentChartValues,
      currentChartValueSource: input.currentChartValueSource,
    }),
  });
  const preExtractionResult = buildDirectExtractionResult({
    selectedSource,
    directDocumentResult: null,
    failureReasons: selectedSource ? [] : ["Missing captured local referral source file for direct-document LLM extraction."],
    warnings: sourceMeta.warnings,
  });
  const referralUploadFingerprint = buildReferralUploadFingerprint({
    sourceMeta,
    extractedText: "",
  });
  const processingInputFingerprint = buildReferralProcessingInputFingerprint({
    sourceMeta,
    extractionResult: preExtractionResult,
    extractedText: "",
    fieldMapSnapshot,
    configuredModelId,
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
        "direct_document_llm_skipped=true",
        "ocr_skipped=true",
      ],
      safeReadConfirmed: true,
    }));
    return {
      result: reusableReferralArtifacts,
      stepLogs,
    };
  }

  let directDocumentResult: ReferralDirectDocumentExtractionResult | null = null;
  let directDocumentFailureDiagnostic: ReferralDirectDocumentFailureDiagnostic | null = null;
  const directFailureReasons: string[] = [];
  if (selectedSource?.localFilePath) {
    stepLogs.push(createAutomationStepLog({
      step: "direct_document_referral_extraction_started",
      message: "Started referral/admission-order direct-document LLM extraction from the captured local source file.",
      patientName,
      found: [
        selectedSource.localFilePath,
        `extractionMode=${input.env.REFERRAL_EXTRACTION_MODE}`,
        `schemaVersion=${REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION}`,
        `sourceSha256=${selectedSource.sourceContentSha256 ?? "unknown"}`,
      ],
      safeReadConfirmed: true,
    }));
    try {
      directDocumentResult = await directDocumentExtractor({
        env: input.env,
        filePath: selectedSource.localFilePath,
        patientName,
        sourceLabel: selectedSource.sourceLabel,
      });
    } catch (error) {
      if (error instanceof ReferralDirectDocumentInvalidJsonError) {
        directDocumentFailureDiagnostic = error.diagnostic;
      }
      directFailureReasons.push(`Direct-document referral extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    directFailureReasons.push("Missing captured local referral source file for direct-document LLM extraction.");
  }

  const extractionWarnings = [
    ...sourceMeta.warnings,
    ...(directDocumentResult?.warnings ?? []),
    ...directFailureReasons,
  ];
  const extractionResult = buildDirectExtractionResult({
    selectedSource,
    directDocumentResult,
    failureReasons: directFailureReasons,
    warnings: extractionWarnings,
  });
  const referralProcessingText = buildDirectDocumentEvidenceText(directDocumentResult);
  const normalizedReferralSections = buildDirectNormalizedSections(directDocumentResult);
  stepLogs.push(createAutomationStepLog({
    step: "direct_document_referral_extraction_completed",
    message: extractionResult.extractionSuccess
      ? "Completed direct-document referral extraction with source-quoted clinical facts."
      : "Direct-document referral extraction did not produce source-backed facts; referral facts require human review.",
    patientName,
    found: [
      `extractionMethod=${extractionResult.extractionMethod}`,
      `acceptedDiagnoses=${directDocumentResult?.accepted.diagnoses.length ?? 0}`,
      `acceptedMedications=${directDocumentResult?.accepted.medications.length ?? 0}`,
      `acceptedFieldProposals=${directDocumentResult?.accepted.fieldProposals.length ?? 0}`,
      `rejectedDiagnoses=${directDocumentResult?.rejected.diagnoses.length ?? 0}`,
      `rejectedMedications=${directDocumentResult?.rejected.medications.length ?? 0}`,
      `rejectedFieldProposals=${directDocumentResult?.rejected.fieldProposals.length ?? 0}`,
      `ocrUsed=${extractionResult.ocrUsed}`,
    ],
    missing: extractionResult.extractionSuccess ? [] : ["source-backed direct-document referral facts"],
    evidence: [
      ...directFailureReasons,
      ...((directDocumentResult?.accepted.diagnoses ?? []).map((diagnosis) => diagnosis.source_quote ?? "").filter(Boolean)),
      ...((directDocumentResult?.accepted.medications ?? []).map((medication) => medication.source_quote ?? "").filter(Boolean)),
    ].slice(0, 10),
    safeReadConfirmed: true,
  }));

  const extractedFacts = buildDirectExtractedFacts({
    fieldMapSnapshot,
    directDocumentResult,
    warnings: extractionWarnings,
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
    message: `Mapped ${extractedFacts.facts.length} direct-document referral fact group(s) and ${extractedFacts.diagnosis_candidates.length} diagnosis candidate(s).`,
    patientName,
    found: extractedFacts.facts.map((fact) => `${fact.fact_key}:${fact.category}`),
    missing: extractedFacts.unsupported_or_missing_fields,
    evidence: extractedFacts.facts.flatMap((fact) => fact.evidence_spans).slice(0, 8),
    safeReadConfirmed: true,
  }));

  stepLogs.push(createAutomationStepLog({
    step: "llm_field_proposal_started",
    message: "Mapped source-quoted direct-document output into referral dashboard field proposals.",
    patientName,
    found: [`candidateFieldCount=${fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral.length}`],
    safeReadConfirmed: true,
  }));

  const llmProposal = directDocumentResult
    ? buildDirectLlmProposal({
      fieldMapSnapshot,
      extractedFacts,
      directDocumentResult,
      warnings: extractionWarnings,
    })
    : buildEmptyLlmProposal({
      fieldMapSnapshot,
      extractedFacts,
      warnings: extractionWarnings,
    });
  stepLogs.push(createAutomationStepLog({
    step: "llm_field_proposal_completed",
    message: `Completed direct-document referral field mapping with ${llmProposal.proposed_field_values.length} field proposal(s).`,
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
    directDocumentResult,
    directDocumentFailureDiagnostic,
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
      ...(artifacts.directDocumentResultPath ? [artifacts.directDocumentResultPath] : []),
      ...(artifacts.directDocumentFailureDiagnosticPath ? [artifacts.directDocumentFailureDiagnosticPath] : []),
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
