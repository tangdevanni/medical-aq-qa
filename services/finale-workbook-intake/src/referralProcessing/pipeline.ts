import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

async function selectPrimarySourceDocument(input: {
  references: SourceDocumentReference[];
  extractedDocuments: ExtractedDocument[];
}): Promise<CandidateEvaluation | null> {
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

    const extractedText = normalizeDocumentText(localExtraction?.text) || normalizeDocumentText(fallbackText);
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

  return ordered[0] ?? null;
}

function buildExtractionResult(input: {
  sourceReference: SourceDocumentReference | null;
  localExtraction: Awaited<ReturnType<typeof extractTextFromLocalFile>> | null;
  fallbackText: string;
}): SourceDocumentExtractionResult {
  const extractedText = normalizeDocumentText(input.localExtraction?.text) || normalizeDocumentText(input.fallbackText);
  const fileType = input.sourceReference?.fileType ?? "unknown";
  const extractionQuality = evaluateDocumentExtractionQuality({
    text: extractedText,
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
  if (extractionQuality.usabilityStatus === "rejected") {
    failureReasons.push(`Extraction quality rejected: ${extractionQuality.rejectedReasons.join(", ")}`);
  }

  return {
    documentId: input.sourceReference?.documentId ?? "unselected",
    localFilePath: input.sourceReference?.localFilePath ?? null,
    fileType,
    extractionMethod: input.localExtraction
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
  };
}

export async function runReferralDocumentProcessingPipeline(input: {
  workItem: PatientEpisodeWorkItem;
  outputDir: string;
  env: FinaleBatchEnv;
  logger: Logger;
  extractedDocuments: ExtractedDocument[];
  currentChartValues?: Record<string, unknown>;
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
  const selectedCandidate = await selectPrimarySourceDocument({
    references: sourceDocuments,
    extractedDocuments: input.extractedDocuments,
  });
  const selectedSource = selectedCandidate?.reference ?? null;
  const sourceMeta: SourceDocumentArtifact = {
    patientId: input.workItem.id,
    selectedDocumentId: selectedSource?.documentId ?? null,
    sourceDocuments: sourceDocuments.map((sourceDocument) => ({
      ...sourceDocument,
      selectionStatus: sourceDocument.documentId === selectedSource?.documentId ? "selected" : sourceDocument.selectionStatus,
      selectedReason: sourceDocument.documentId === selectedSource?.documentId
        ? "highest-ranked referral/admission-order source with local file preference"
        : sourceDocument.selectedReason,
    })),
    warnings: selectedSource ? [] : ["No referral/admission-order source document was available for processing."],
    generatedAt: new Date().toISOString(),
  };
  stepLogs.push(createAutomationStepLog({
    step: "source_document_identified",
    message: selectedSource
      ? "Identified referral/admission-order source document candidates and selected the best source for processing."
      : "No referral/admission-order source document could be identified for processing.",
    patientName,
    found: sourceDocuments.map((document) => `${document.documentId}:${document.sourceType}:${document.localFilePath ?? "in_memory"}`),
    missing: selectedSource ? [] : ["referral/admission-order source document"],
    evidence: selectedSource ? [`selectedDocumentId=${selectedSource.documentId}`] : [],
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
  const extractedText = normalizeDocumentText(localExtraction?.text) || normalizeDocumentText(fallbackText);
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

  const normalizedSections = normalizeReferralSections(extractedText);
  stepLogs.push(createAutomationStepLog({
    step: "referral_sections_normalized",
    message: `Normalized referral text into ${normalizedSections.length} semantic sections.`,
    patientName,
    found: normalizedSections.map((section) => `${section.sectionName}:${section.confidence}`),
    safeReadConfirmed: true,
  }));

  const fieldMapSnapshot = buildFieldMapSnapshot({
    chartSnapshotValues: createInitialChartSnapshotValues({
      workItem: input.workItem,
      currentChartValues: input.currentChartValues,
    }),
  });
  const extractedFacts = extractReferralFacts({
    fieldMapSnapshot,
    sections: normalizedSections,
    sourceText: extractedText,
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
    sourceText: extractedText,
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
    normalizedSections,
    sourceText: extractedText,
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
    extractedText,
    normalizedSections,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    referralQaInsights,
  });

  const qaDocumentSummary = buildQaDocumentSummary({
    selectedDocumentId: selectedSource.documentId,
    extractionResult,
    normalizedSectionCount: normalizedSections.length,
    llmProposalCount: llmProposal.proposed_field_values.length,
    fieldComparisons,
    warnings: [
      ...sourceMeta.warnings,
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
    extractedText,
    normalizedSections,
    extractedFacts,
    fieldMapSnapshot,
    llmProposal,
    fieldComparisons,
    patientQaReference,
    qaDocumentSummary,
  });

  input.logger.info({
    patientId: input.workItem.id,
    patientName,
    selectedDocumentId: selectedSource.documentId,
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
      normalizedSections,
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
