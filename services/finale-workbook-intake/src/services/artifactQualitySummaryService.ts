import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { pino } from "pino";
import { loadEnv } from "../config/env";
import { extractCurrentChartValuesFromPrintedNote } from "../oasis/print/printedNoteChartValueExtractionService";
import { generateReferralFieldProposals } from "../referralProcessing/llmProposalService";
import type { ReferralExtractedFacts, FieldMapSnapshot } from "../referralProcessing/types";
import { extractDiagnosisCodingContext, type LlmInputSource } from "./diagnosisCodingExtractionService";
import { buildDocumentFactPack } from "./documentFactPackBuilder";
import type { ExtractedDocument } from "./documentExtractionService";

const SUPPORTED_INPUT_SOURCES: LlmInputSource[] = [
  "fact_pack_primary",
  "fact_pack_plus_raw_fallback",
  "raw_text_fallback",
];
const CONSUMER_THRESHOLDS = {
  diagnosisCoding: 0.6,
  referralProposal: 0.65,
  printedNoteChartValues: 0.55,
} as const;

export interface ConsumerQualitySummary {
  sampleCount: number;
  evaluatedSampleCount: number;
  llmInputSourceCounts: Record<LlmInputSource, number>;
  avgFactPackCoverageScore?: number;
  avgPromptCharacterEstimate?: number;
  avgRawCharacters?: number;
  avgPackedCharacters?: number;
  commonMissingCriticalSections: string[];
  commonFallbackReasons: string[];
  warnings: string[];
  artifactCompleteness: {
    extractedTextPresentCount: number;
    factPackArtifactPresentCount: number;
    consumerArtifactPresentCount: number;
    missingExtractedTextCount: number;
    missingFactPackArtifactCount: number;
    missingConsumerArtifactCount: number;
  };
  likelyTooStrictCount: number;
  likelyTooLooseCount: number;
}

export interface ArtifactQualitySummary {
  generatedAt: string;
  sampleCount: number;
  sampleRoots: string[];
  consumers: {
    diagnosisCoding?: ConsumerQualitySummary;
    referralProposal?: ConsumerQualitySummary;
    printedNoteChartValues?: ConsumerQualitySummary;
  };
  commonIssues: string[];
  recommendedThresholdActions: string[];
  warnings: string[];
}

interface ArtifactQualitySummaryOptions {
  artifactRoots: string[];
  outputPath: string;
  scratchDir?: string;
}

interface ConsumerSampleMetrics {
  samplePath: string;
  llmInputSource: LlmInputSource | null;
  factPackCoverageScore?: number;
  promptCharacterEstimate?: number;
  rawCharacters?: number;
  packedCharacters?: number;
  missingCriticalSections: string[];
  fallbackReason?: string;
  hasExtractedText: boolean;
  hasFactPackArtifact: boolean;
  hasConsumerArtifact: boolean;
  warnings: string[];
}

interface DocumentTextArtifact {
  documents?: Array<Record<string, unknown>>;
}

interface PrintedNoteReviewArtifact {
  patientName?: string;
  capture?: {
    extractedTextPath?: string | null;
  };
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFilesByName(root: string, fileName: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (currentPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) {
        matches.push(fullPath);
      }
    }
  };

  await visit(root);
  return matches;
}

function isRealArtifactPath(filePath: string): boolean {
  return /oasis-qa-demo-/i.test(filePath);
}

function createInputSourceCounts(): Record<LlmInputSource, number> {
  return {
    fact_pack_primary: 0,
    fact_pack_plus_raw_fallback: 0,
    raw_text_fallback: 0,
  };
}

function countOccurrences(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function topKeysByCount(counts: Map<string, number>, limit = 5): string[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function average(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => Number.isFinite(value));
  if (numeric.length === 0) {
    return undefined;
  }
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
}

function parseListValue(value: string): string[] {
  const normalized = normalizeWhitespace(value)
    .replace(/\.$/, "");
  if (!normalized || normalized.toLowerCase() === "none") {
    return [];
  }
  return normalized
    .split(/[,|]/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function parseDiagnostics(entries: string[]): {
  llmInputSource: LlmInputSource | null;
  factPackCoverageScore?: number;
  promptCharacterEstimate?: number;
  rawCharacters?: number;
  packedCharacters?: number;
  missingCriticalSections: string[];
  fallbackReason?: string;
} {
  let llmInputSource: LlmInputSource | null = null;
  let factPackCoverageScore: number | undefined;
  let promptCharacterEstimate: number | undefined;
  let rawCharacters: number | undefined;
  let packedCharacters: number | undefined;
  let missingCriticalSections: string[] = [];
  let fallbackReason: string | undefined;

  for (const entry of entries) {
    const normalized = normalizeWhitespace(entry);
    if (!normalized) {
      continue;
    }

    if (normalized.startsWith("llmInputSource:")) {
      const value = normalized.slice("llmInputSource:".length) as LlmInputSource;
      if (SUPPORTED_INPUT_SOURCES.includes(value)) {
        llmInputSource = value;
      }
      continue;
    }

    if (normalized.startsWith("LLM input source:")) {
      const value = normalizeWhitespace(normalized.slice("LLM input source:".length).replace(/\.$/, "")) as LlmInputSource;
      if (SUPPORTED_INPUT_SOURCES.includes(value)) {
        llmInputSource = value;
      }
      continue;
    }

    if (normalized.startsWith("factPackCoverageScore:")) {
      factPackCoverageScore = Number(normalized.slice("factPackCoverageScore:".length));
      continue;
    }

    if (normalized.startsWith("Fact pack coverage score:")) {
      factPackCoverageScore = Number(normalized.slice("Fact pack coverage score:".length).replace(/\.$/, ""));
      continue;
    }

    if (normalized.startsWith("promptCharacterEstimate:")) {
      promptCharacterEstimate = Number(normalized.slice("promptCharacterEstimate:".length));
      continue;
    }

    if (normalized.startsWith("Prompt character estimate:")) {
      promptCharacterEstimate = Number(normalized.slice("Prompt character estimate:".length).replace(/\.$/, ""));
      continue;
    }

    if (normalized.startsWith("factPackRawCharacters:")) {
      rawCharacters = Number(normalized.slice("factPackRawCharacters:".length));
      continue;
    }

    if (normalized.startsWith("factPackPackedCharacters:")) {
      packedCharacters = Number(normalized.slice("factPackPackedCharacters:".length));
      continue;
    }

    if (normalized.startsWith("missingCriticalSections:")) {
      missingCriticalSections = parseListValue(normalized.slice("missingCriticalSections:".length));
      continue;
    }

    if (normalized.startsWith("Fallback reason:")) {
      fallbackReason = normalizeWhitespace(normalized.slice("Fallback reason:".length).replace(/\.$/, ""));
      continue;
    }

    if (normalized.startsWith("fallbackReason:")) {
      fallbackReason = normalizeWhitespace(normalized.slice("fallbackReason:".length));
      continue;
    }
  }

  return {
    llmInputSource,
    factPackCoverageScore: Number.isFinite(factPackCoverageScore) ? factPackCoverageScore : undefined,
    promptCharacterEstimate: Number.isFinite(promptCharacterEstimate) ? promptCharacterEstimate : undefined,
    rawCharacters: Number.isFinite(rawCharacters) ? rawCharacters : undefined,
    packedCharacters: Number.isFinite(packedCharacters) ? packedCharacters : undefined,
    missingCriticalSections:
      missingCriticalSections.length > 0
        ? missingCriticalSections
        : (
            fallbackReason &&
            !["none", "coverage_score_below_threshold", "missing_fact_pack"].includes(fallbackReason.toLowerCase())
          )
          ? parseListValue(fallbackReason)
          : [],
    fallbackReason,
  };
}

function createSyntheticWorkItem(patientId: string, patientName: string): PatientEpisodeWorkItem {
  return {
    id: patientId,
    subsidiaryId: "artifact-summary",
    patientIdentity: {
      displayName: patientName,
      normalizedName: patientName.toUpperCase(),
      medicareNumber: "",
    },
    episodeContext: {
      socDate: "",
      episodeDate: "",
      billingPeriod: "",
      episodePeriod: "",
      payer: null,
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: null,
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    workflowTypes: [],
    sourceSheets: [],
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
  };
}

function toExtractedDocuments(documentTextArtifact: DocumentTextArtifact | null): ExtractedDocument[] {
  return (documentTextArtifact?.documents ?? [])
    .map((document) => ({
      type: String(document.type ?? "OTHER") as ExtractedDocument["type"],
      text: String(document.text ?? ""),
      metadata: {
        source: document.source as ExtractedDocument["metadata"]["source"],
        sourcePath: typeof document.sourcePath === "string" ? document.sourcePath : undefined,
        portalLabel: typeof document.portalLabel === "string" ? document.portalLabel : undefined,
        effectiveTextSource: document.effectiveTextSource as ExtractedDocument["metadata"]["effectiveTextSource"],
        rawExtractedTextSource: document.rawExtractedTextSource as ExtractedDocument["metadata"]["rawExtractedTextSource"],
        textSelectionReason: typeof document.textSelectionReason === "string" ? document.textSelectionReason : undefined,
        domExtractionRejectedReasons: Array.isArray(document.domExtractionRejectedReasons)
          ? document.domExtractionRejectedReasons.filter((value): value is string => typeof value === "string")
          : undefined,
        textLength: typeof document.textLength === "number" ? document.textLength : undefined,
        textPreview: typeof document.textPreview === "string" ? document.textPreview : undefined,
        admissionReasonPrimary: document.admissionReasonPrimary as string | null | undefined,
        admissionReasonSnippets: Array.isArray(document.admissionReasonSnippets)
          ? document.admissionReasonSnippets.filter((value): value is string => typeof value === "string")
          : undefined,
        possibleIcd10Codes: Array.isArray(document.possibleIcd10Codes)
          ? document.possibleIcd10Codes.filter((value): value is string => typeof value === "string")
          : undefined,
        pdfType: document.pdfType as ExtractedDocument["metadata"]["pdfType"],
        ocrUsed: typeof document.ocrUsed === "boolean" ? document.ocrUsed : undefined,
        ocrProvider: document.ocrProvider as ExtractedDocument["metadata"]["ocrProvider"],
        ocrTextLength: typeof document.ocrTextLength === "number" ? document.ocrTextLength : undefined,
        ocrSuccess: typeof document.ocrSuccess === "boolean" ? document.ocrSuccess : undefined,
        ocrResultPath: document.ocrResultPath as string | null | undefined,
        ocrError: document.ocrError as string | null | undefined,
        ocrErrorCategory: document.ocrErrorCategory as ExtractedDocument["metadata"]["ocrErrorCategory"],
        ocrMode: document.ocrMode as ExtractedDocument["metadata"]["ocrMode"],
        configuredAwsRegion: document.configuredAwsRegion as string | null | undefined,
        resolvedBucketRegion: document.resolvedBucketRegion as string | null | undefined,
        textractRegion: document.textractRegion as string | null | undefined,
        regionMatch: document.regionMatch as boolean | null | undefined,
        regionOverrideUsed: document.regionOverrideUsed as boolean | null | undefined,
        s3UploadSucceeded: document.s3UploadSucceeded as boolean | null | undefined,
        s3UploadError: document.s3UploadError as string | null | undefined,
        textractStartSucceeded: document.textractStartSucceeded as boolean | null | undefined,
        textractStartError: document.textractStartError as string | null | undefined,
      },
    }))
    .filter((document) => normalizeWhitespace(document.text).length > 0);
}

async function evaluateDiagnosisSample(samplePath: string): Promise<ConsumerSampleMetrics> {
  const patientDir = path.dirname(samplePath);
  const documentTextPath = path.join(patientDir, "document-text.json");
  const documentText = await readJsonIfExists<DocumentTextArtifact>(documentTextPath);
  const extractedDocuments = toExtractedDocuments(documentText);
  const hasExtractedText = extractedDocuments.some((document) => document.text.length > 0);
  const hasFactPackArtifact = await pathExists(path.join(patientDir, "document-fact-pack.json"));
  const warnings: string[] = [];

  if (extractedDocuments.length === 0) {
    warnings.push("No extracted documents were available to re-evaluate diagnosis coding input source.");
    return {
      samplePath,
      llmInputSource: null,
      missingCriticalSections: [],
      hasExtractedText,
      hasFactPackArtifact,
      hasConsumerArtifact: await pathExists(samplePath),
      warnings,
    };
  }

  const env = loadEnv({
    ...process.env,
    CODE_LLM_ENABLED: "false",
  });
  const result = await extractDiagnosisCodingContext({
    extractedDocuments,
    env,
  });
  const diagnostics = parseDiagnostics(result.evidence);

  return {
    samplePath,
    llmInputSource: diagnostics.llmInputSource ?? result.llmInputSource,
    factPackCoverageScore: diagnostics.factPackCoverageScore,
    promptCharacterEstimate: diagnostics.promptCharacterEstimate,
    rawCharacters: diagnostics.rawCharacters,
    packedCharacters: diagnostics.packedCharacters,
    missingCriticalSections: diagnostics.missingCriticalSections,
    fallbackReason: diagnostics.fallbackReason,
    hasExtractedText,
    hasFactPackArtifact,
    hasConsumerArtifact: await pathExists(samplePath),
    warnings,
  };
}

async function evaluateReferralSample(samplePath: string): Promise<ConsumerSampleMetrics> {
  const referralDir = path.dirname(samplePath);
  const extractedFacts = await readJsonIfExists<ReferralExtractedFacts>(path.join(referralDir, "extracted-facts.json"));
  const fieldMapSnapshot = await readJsonIfExists<FieldMapSnapshot>(path.join(referralDir, "field-map-snapshot.json"));
  const sourceText = normalizeWhitespace(await readFile(path.join(referralDir, "extracted-text.txt"), "utf8").catch(() => ""));
  const hasExtractedText = sourceText.length > 0;
  const hasFactPackArtifact = await pathExists(path.join(path.dirname(referralDir), "document-fact-pack.json"));
  const warnings: string[] = [];

  if (!extractedFacts || !fieldMapSnapshot || !sourceText) {
    warnings.push("Referral processing artifacts were incomplete; could not re-evaluate proposal input source.");
    return {
      samplePath,
      llmInputSource: null,
      missingCriticalSections: [],
      hasExtractedText,
      hasFactPackArtifact,
      hasConsumerArtifact: await pathExists(path.join(referralDir, "llm-proposal.json")),
      warnings,
    };
  }

  const env = loadEnv({
    ...process.env,
    CODE_LLM_ENABLED: "false",
  });
  const proposal = await generateReferralFieldProposals({
    env,
    fieldMapSnapshot,
    extractedFacts,
    sourceText,
  });
  const diagnostics = parseDiagnostics(proposal.warnings);
  const factPack = buildDocumentFactPack([{
    type: "ORDER",
    text: sourceText,
    metadata: {
      source: "artifact_fallback",
      effectiveTextSource: "viewer_text_fallback",
      textSelectionReason: "artifact_quality_summary",
      textLength: sourceText.length,
    },
  }]);

  return {
    samplePath,
    llmInputSource: diagnostics.llmInputSource,
    factPackCoverageScore: diagnostics.factPackCoverageScore,
    promptCharacterEstimate: diagnostics.promptCharacterEstimate,
    rawCharacters: factPack.stats.rawCharacters,
    packedCharacters: factPack.stats.packedCharacters,
    missingCriticalSections: diagnostics.missingCriticalSections,
    fallbackReason: diagnostics.fallbackReason,
    hasExtractedText,
    hasFactPackArtifact,
    hasConsumerArtifact: await pathExists(path.join(referralDir, "llm-proposal.json")),
    warnings,
  };
}

async function evaluatePrintedNoteSample(samplePath: string, scratchDir: string): Promise<ConsumerSampleMetrics> {
  const patientDir = path.dirname(samplePath);
  const review = await readJsonIfExists<PrintedNoteReviewArtifact>(samplePath);
  const extractedTextPath = review?.capture?.extractedTextPath ?? null;
  const hasExtractedText = Boolean(extractedTextPath && await pathExists(extractedTextPath));
  const hasFactPackArtifact = await pathExists(path.join(patientDir, "document-fact-pack.json"));
  const warnings: string[] = [];

  if (!extractedTextPath || !hasExtractedText) {
    warnings.push("Printed-note review artifact did not include a readable extracted text path.");
    return {
      samplePath,
      llmInputSource: null,
      missingCriticalSections: [],
      hasExtractedText,
      hasFactPackArtifact,
      hasConsumerArtifact: await pathExists(path.join(patientDir, "printed-note-chart-values.json")),
      warnings,
    };
  }

  const patientId = path.basename(patientDir);
  const patientName = normalizeWhitespace(review?.patientName ?? patientId) || patientId;
  const env = loadEnv({
    ...process.env,
    CODE_LLM_ENABLED: "false",
  });
  const summaryOutputDir = path.join(scratchDir, patientId);
  await mkdir(summaryOutputDir, { recursive: true });
  const result = await extractCurrentChartValuesFromPrintedNote({
    env,
    logger: pino({ level: "silent" }),
    outputDir: summaryOutputDir,
    workItem: createSyntheticWorkItem(patientId, patientName),
    extractedTextPath,
  });
  const diagnostics = parseDiagnostics(result.warnings);
  const sourceText = normalizeWhitespace(await readFile(extractedTextPath, "utf8").catch(() => ""));
  const factPack = buildDocumentFactPack([{
    type: "OASIS",
    text: sourceText,
    metadata: {
      source: "artifact_fallback",
      effectiveTextSource: "viewer_text_fallback",
      textSelectionReason: "artifact_quality_summary",
      textLength: sourceText.length,
    },
  }]);

  return {
    samplePath,
    llmInputSource: result.llmInputSource ?? diagnostics.llmInputSource,
    factPackCoverageScore: diagnostics.factPackCoverageScore,
    promptCharacterEstimate: diagnostics.promptCharacterEstimate,
    rawCharacters: factPack.stats.rawCharacters,
    packedCharacters: factPack.stats.packedCharacters,
    missingCriticalSections: diagnostics.missingCriticalSections,
    fallbackReason: diagnostics.fallbackReason,
    hasExtractedText,
    hasFactPackArtifact,
    hasConsumerArtifact: await pathExists(path.join(patientDir, "printed-note-chart-values.json")),
    warnings,
  };
}

function buildConsumerQualitySummary(
  consumer: keyof typeof CONSUMER_THRESHOLDS,
  samples: ConsumerSampleMetrics[],
): ConsumerQualitySummary | undefined {
  if (samples.length === 0) {
    return undefined;
  }

  const llmInputSourceCounts = createInputSourceCounts();
  const missingCriticalSections = countOccurrences(samples.flatMap((sample) => sample.missingCriticalSections));
  const fallbackReasons = countOccurrences(samples.flatMap((sample) => sample.fallbackReason ? [sample.fallbackReason] : []));
  const summaryWarnings = countOccurrences(samples.flatMap((sample) => sample.warnings));
  const threshold = CONSUMER_THRESHOLDS[consumer];

  let likelyTooStrictCount = 0;
  let likelyTooLooseCount = 0;
  for (const sample of samples) {
    if (sample.llmInputSource) {
      llmInputSourceCounts[sample.llmInputSource] += 1;
    }
    if (
      sample.llmInputSource === "fact_pack_plus_raw_fallback" &&
      typeof sample.factPackCoverageScore === "number" &&
      sample.factPackCoverageScore >= threshold - 0.05 &&
      sample.missingCriticalSections.length <= 1
    ) {
      likelyTooStrictCount += 1;
    }
    if (
      sample.llmInputSource === "fact_pack_primary" &&
      typeof sample.factPackCoverageScore === "number" &&
      sample.factPackCoverageScore < threshold &&
      sample.missingCriticalSections.length > 1
    ) {
      likelyTooLooseCount += 1;
    }
  }

  return {
    sampleCount: samples.length,
    evaluatedSampleCount: samples.filter((sample) => sample.llmInputSource !== null).length,
    llmInputSourceCounts,
    avgFactPackCoverageScore: average(samples.map((sample) => sample.factPackCoverageScore)),
    avgPromptCharacterEstimate: average(samples.map((sample) => sample.promptCharacterEstimate)),
    avgRawCharacters: average(samples.map((sample) => sample.rawCharacters)),
    avgPackedCharacters: average(samples.map((sample) => sample.packedCharacters)),
    commonMissingCriticalSections: topKeysByCount(missingCriticalSections),
    commonFallbackReasons: topKeysByCount(fallbackReasons),
    warnings: topKeysByCount(summaryWarnings),
    artifactCompleteness: {
      extractedTextPresentCount: samples.filter((sample) => sample.hasExtractedText).length,
      factPackArtifactPresentCount: samples.filter((sample) => sample.hasFactPackArtifact).length,
      consumerArtifactPresentCount: samples.filter((sample) => sample.hasConsumerArtifact).length,
      missingExtractedTextCount: samples.filter((sample) => !sample.hasExtractedText).length,
      missingFactPackArtifactCount: samples.filter((sample) => !sample.hasFactPackArtifact).length,
      missingConsumerArtifactCount: samples.filter((sample) => !sample.hasConsumerArtifact).length,
    },
    likelyTooStrictCount,
    likelyTooLooseCount,
  };
}

function buildRecommendedThresholdActions(summary: ArtifactQualitySummary): string[] {
  const actions: string[] = [];

  const diagnosis = summary.consumers.diagnosisCoding;
  if (diagnosis) {
    if (diagnosis.likelyTooStrictCount > 0) {
      actions.push("Diagnosis coding: review the weighted gate once more; some mixed-fallback cases are close to fact-pack-primary.");
    } else {
      actions.push("Diagnosis coding: keep current thresholds; mixed fallback appears appropriately constrained.");
    }
  }

  const referral = summary.consumers.referralProposal;
  if (referral) {
    if (referral.likelyTooStrictCount >= 2) {
      actions.push("Referral proposal: thresholds are close, but one more tuning pass is recommended before freezing.");
    } else if (referral.commonMissingCriticalSections.includes("supportingEvidence")) {
      actions.push("Referral proposal: improve fact-pack supporting snippet coverage before further relaxing thresholds.");
    } else {
      actions.push("Referral proposal: keep current thresholds; weighted coverage looks reasonable on sampled runs.");
    }
  }

  const printed = summary.consumers.printedNoteChartValues;
  if (printed) {
    if (printed.artifactCompleteness.consumerArtifactPresentCount === 0) {
      actions.push("Printed-note chart values: add more direct consumer artifacts before making a final freeze decision.");
    } else if (printed.likelyTooStrictCount > 0) {
      actions.push("Printed-note chart values: relax the threshold slightly only after more artifact diversity is available.");
    } else {
      actions.push("Printed-note chart values: keep current threshold; fact-pack-first behavior looks acceptable on sampled captures.");
    }
  }

  return actions;
}

function buildCommonIssues(summary: ArtifactQualitySummary): string[] {
  const issues: string[] = [];
  const diagnosis = summary.consumers.diagnosisCoding;
  const referral = summary.consumers.referralProposal;
  const printed = summary.consumers.printedNoteChartValues;

  if (diagnosis && diagnosis.artifactCompleteness.factPackArtifactPresentCount === 0) {
    issues.push("Diagnosis samples did not include persisted document-fact-pack artifacts; validation relied on recomputation from extracted documents.");
  }
  if (referral && referral.artifactCompleteness.factPackArtifactPresentCount === 0) {
    issues.push("Referral-processing samples did not include persisted document-fact-pack artifacts; validation relied on recomputation from extracted text.");
  }
  if (printed && printed.artifactCompleteness.consumerArtifactPresentCount === 0) {
    issues.push("Printed-note chart-value consumer artifacts were absent in the sampled runs; only recomputed evaluations were available.");
  }
  if ((diagnosis?.sampleCount ?? 0) + (referral?.sampleCount ?? 0) + (printed?.sampleCount ?? 0) < 10) {
    issues.push("The local artifact sample set is still small for a final threshold freeze decision.");
  }

  return issues;
}

export async function buildArtifactQualitySummary(
  options: ArtifactQualitySummaryOptions,
): Promise<ArtifactQualitySummary> {
  const artifactRoots = options.artifactRoots.map((root) => path.resolve(root));
  const scratchDir = path.resolve(options.scratchDir ?? path.join(path.dirname(options.outputPath), "artifact-quality-summary-work"));
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await mkdir(scratchDir, { recursive: true });

  const warnings: string[] = [];
  const diagnosisSamplePaths = new Set<string>();
  const referralSamplePaths = new Set<string>();
  const printedSamplePaths = new Set<string>();

  for (const root of artifactRoots) {
    if (!await pathExists(root)) {
      warnings.push(`Artifact root not found: ${root}`);
      continue;
    }
    for (const filePath of await findFilesByName(root, "coding-input.json")) {
      if (isRealArtifactPath(filePath)) {
        diagnosisSamplePaths.add(filePath);
      }
    }
    for (const filePath of await findFilesByName(root, "qa-document-summary.json")) {
      if (isRealArtifactPath(filePath) && /referral-document-processing/i.test(filePath)) {
        referralSamplePaths.add(filePath);
      }
    }
    for (const filePath of await findFilesByName(root, "oasis-printed-note-review.json")) {
      if (isRealArtifactPath(filePath)) {
        printedSamplePaths.add(filePath);
      }
    }
  }

  const diagnosisSamples: ConsumerSampleMetrics[] = [];
  for (const samplePath of [...diagnosisSamplePaths].sort()) {
    diagnosisSamples.push(await evaluateDiagnosisSample(samplePath));
  }

  const referralSamples: ConsumerSampleMetrics[] = [];
  for (const samplePath of [...referralSamplePaths].sort()) {
    referralSamples.push(await evaluateReferralSample(samplePath));
  }

  const printedSamples: ConsumerSampleMetrics[] = [];
  for (const samplePath of [...printedSamplePaths].sort()) {
    printedSamples.push(await evaluatePrintedNoteSample(samplePath, scratchDir));
  }

  const summary: ArtifactQualitySummary = {
    generatedAt: new Date().toISOString(),
    sampleCount: diagnosisSamples.length + referralSamples.length + printedSamples.length,
    sampleRoots: artifactRoots,
    consumers: {
      diagnosisCoding: buildConsumerQualitySummary("diagnosisCoding", diagnosisSamples),
      referralProposal: buildConsumerQualitySummary("referralProposal", referralSamples),
      printedNoteChartValues: buildConsumerQualitySummary("printedNoteChartValues", printedSamples),
    },
    commonIssues: [],
    recommendedThresholdActions: [],
    warnings,
  };

  summary.commonIssues = buildCommonIssues(summary);
  summary.recommendedThresholdActions = buildRecommendedThresholdActions(summary);

  await writeFile(options.outputPath, JSON.stringify(summary, null, 2), "utf8");
  return summary;
}
