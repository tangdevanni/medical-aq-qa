import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino, { type Logger } from "pino";
import type {
  ArtifactRecord,
  AutomationStepLog,
  BatchManifest,
  BatchSummary,
  DocumentInventoryItem,
  ParserException,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientRun,
  SubsidiaryRuntimeConfig,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { resolvePortalRuntimeConfig } from "../config/portalRuntime";
import { buildBatchSummary } from "../domain/batchSummary";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import { evaluateDeterministicQa } from "../qa/deterministicQaEngine";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import { PlaywrightBatchQaWorker } from "../workers/playwrightBatchQaWorker";
import {
  extractDocumentsFromArtifacts,
  getEffectiveTextSource,
  type ExtractedDocument,
} from "./documentExtractionService";
import { writeDocumentInventoryFile } from "./documentInventoryExportService";
import { writeDocumentTextFile } from "./documentTextExportService";
import {
  extractDiagnosisCodingContext,
  type CanonicalDiagnosisExtraction,
  verifyDiagnosisCodingLlmAccess,
} from "./diagnosisCodingExtractionService";
import {
  type CodingInputDocument,
  writeCodingInputFile,
} from "./codingInputExportService";
import { buildOasisQaSummary } from "./oasisQaEvaluator";
import { extractTechnicalReview } from "./technicalReviewExtractor";
import { writePatientRunLog } from "./patientRunLogWriter";
import { writePatientResultBundle } from "./patientResultBundleWriter";
import { intakeWorkbook } from "./workbookIntakeService";

export interface RunFinaleBatchParams {
  batchId?: string;
  manifest?: BatchManifest;
  workItems?: PatientEpisodeWorkItem[];
  parserExceptions?: ParserException[];
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  workbookPath: string;
  outputDir?: string;
  parseOnly?: boolean;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
}

export interface RunFinaleBatchResult {
  manifest: BatchManifest;
  workItems: PatientEpisodeWorkItem[];
  parserExceptions: ParserException[];
  patientRuns: PatientRun[];
  batchSummary: BatchSummary;
  manifestPath: string;
  workItemsPath: string;
  parserExceptionsPath: string;
  batchSummaryPath: string;
}

export interface ExecutePatientWorkItemsParams {
  batchId: string;
  workItems: PatientEpisodeWorkItem[];
  outputDir: string;
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
}

export interface RunQaForPatientParams {
  batchId: string;
  patient: PatientEpisodeWorkItem;
  outputDir: string;
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
}

export interface RunBatchQaParams {
  batchId: string;
  patients: PatientEpisodeWorkItem[];
  outputDir: string;
  workbookPath?: string;
  billingPeriod?: string | null;
  parserExceptions?: ParserException[];
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
}

function createLogger(): Logger {
  const env = loadEnv();
  return pino({
    name: "finale-batch-runner",
    level: env.FINALE_LOG_LEVEL,
  });
}

function createEmptyMatchResult(workItem: PatientEpisodeWorkItem): PatientMatchResult {
  return {
    status: "NOT_FOUND",
    searchQuery: workItem.patientIdentity.displayName,
    portalPatientId: null,
    portalDisplayName: null,
    candidateNames: [],
    note: "Patient was not searched yet.",
  };
}

function createInitialPatientRun(input: {
  batchId: string;
  workItem: PatientEpisodeWorkItem;
}): PatientRun {
  const { batchId, workItem } = input;

  return {
    runId: `${batchId}-${workItem.id}`,
    batchId,
    subsidiaryId: workItem.subsidiaryId,
    workItemId: workItem.id,
    patientName: workItem.patientIdentity.displayName,
    processingStatus: "MATCHING_PATIENT",
    executionStep: "MATCHING_PATIENT",
    progressPercent: 10,
    startedAt: new Date().toISOString(),
    completedAt: null,
    lastUpdatedAt: new Date().toISOString(),
    matchResult: createEmptyMatchResult(workItem),
    artifacts: [],
    artifactCount: 0,
    findings: [],
    hasFindings: false,
    qaOutcome: "INCOMPLETE",
    oasisQaSummary: buildOasisQaSummary({
      workItem,
      matchResult: createEmptyMatchResult(workItem),
      artifacts: [],
      processingStatus: "MATCHING_PATIENT",
      documentInventory: [],
    }),
    documentInventory: [],
    resultBundlePath: null,
    bundleAvailable: false,
    logPath: null,
    logAvailable: false,
    retryEligible: false,
    errorSummary: null,
    auditArtifacts: {
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
    },
    workItemSnapshot: workItem,
    automationStepLogs: [],
    notes: [],
  };
}

function createBatchManifestFromPatients(input: {
  batchId: string;
  subsidiaryId: string;
  workbookPath: string;
  outputDirectory: string;
  patients: PatientEpisodeWorkItem[];
  parserExceptions: ParserException[];
  billingPeriod?: string | null;
}): BatchManifest {
  return {
    batchId: input.batchId,
    subsidiaryId: input.subsidiaryId,
    createdAt: new Date().toISOString(),
    status: "READY",
    workbookPath: input.workbookPath,
    outputDirectory: input.outputDirectory,
    billingPeriod:
      input.billingPeriod ??
      input.patients[0]?.episodeContext.billingPeriod ??
      null,
    totalWorkItems: input.patients.length,
    parserExceptionCount: input.parserExceptions.length,
    automationEligibleWorkItemIds: input.patients.map((patient) => patient.id),
    blockedWorkItemIds: [],
  };
}

function processingStatusForOutcome(run: PatientRun): PatientRun["processingStatus"] {
  switch (run.qaOutcome) {
    case "READY_FOR_BILLING_PREP":
      return "COMPLETE";
    case "PORTAL_NOT_FOUND":
    case "AMBIGUOUS_PATIENT":
    case "PORTAL_MISMATCH":
    case "MISSING_DOCUMENTS":
      return "BLOCKED";
    case "NEEDS_MANUAL_QA":
      return "NEEDS_HUMAN_REVIEW";
    default:
      return "NEEDS_HUMAN_REVIEW";
  }
}

function canRetryPatientRun(run: PatientRun): boolean {
  return ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(run.processingStatus);
}

function appendAutomationLogs(
  run: PatientRun,
  logs: AutomationStepLog[],
): void {
  if (logs.length === 0) {
    return;
  }

  run.automationStepLogs.push(...logs);
}

function ensureCanonicalAutomationLogs(input: {
  workItem: PatientEpisodeWorkItem;
  matchResult: PatientMatchResult;
  logs: AutomationStepLog[];
}): AutomationStepLog[] {
  const { workItem, matchResult, logs } = input;
  const normalizedLogs = [...logs];
  const hasLogin = normalizedLogs.some((log) => log.step === "login");
  const hasPatientSearch = normalizedLogs.some((log) => log.step === "patient_search");

  if (!hasLogin) {
    normalizedLogs.unshift(
      createAutomationStepLog({
        step: "login",
        message: "Reused the authenticated portal session established for this batch.",
        patientName: workItem.patientIdentity.displayName,
        safeReadConfirmed: true,
      }),
    );
  }

  if (!hasPatientSearch) {
    normalizedLogs.push(
      createAutomationStepLog({
        step: "patient_search",
        message: `Patient search concluded with status ${matchResult.status}.`,
        patientName: workItem.patientIdentity.displayName,
        found: matchResult.candidateNames.slice(0, 8),
        evidence: [
          `Search query: ${matchResult.searchQuery}`,
          ...(matchResult.portalDisplayName ? [`Portal display name: ${matchResult.portalDisplayName}`] : []),
          ...(matchResult.note ? [matchResult.note] : []),
        ],
        safeReadConfirmed: true,
      }),
    );
  }

  return normalizedLogs;
}

function appendMissingBaselineFailureLogs(input: {
  run: PatientRun;
  workItem: PatientEpisodeWorkItem;
  failureMessage: string;
}): void {
  const { run, workItem, failureMessage } = input;
  const stepNames = new Set(run.automationStepLogs.map((log) => log.step));

  if (!stepNames.has("login")) {
    appendAutomationLogs(run, [createAutomationStepLog({
      step: "login",
      message: "Reused the authenticated portal session established for this batch.",
      patientName: workItem.patientIdentity.displayName,
      safeReadConfirmed: true,
    })]);
    stepNames.add("login");
  }

  if (!stepNames.has("patient_search")) {
    appendAutomationLogs(run, [createAutomationStepLog({
      step: "patient_search",
      message: `Patient search did not complete because the lookup workflow failed unexpectedly. ${failureMessage}`,
      patientName: workItem.patientIdentity.displayName,
      found: run.matchResult.candidateNames.slice(0, 8),
      evidence: [
        `Search query: ${run.matchResult.searchQuery}`,
        ...(run.matchResult.note ? [run.matchResult.note] : []),
        failureMessage,
      ],
      safeReadConfirmed: true,
    })]);
    stepNames.add("patient_search");
  }

  if (!stepNames.has("patient_search_match_resolution")) {
    appendAutomationLogs(run, [createAutomationStepLog({
      step: "patient_search_match_resolution",
      message: `Patient lookup stopped before a stable match result could complete. ${failureMessage}`,
      patientName: workItem.patientIdentity.displayName,
      missing: ["stable patient match resolution"],
      evidence: [
        `Match status at failure: ${run.matchResult.status}`,
        ...(run.matchResult.note ? [run.matchResult.note] : []),
        failureMessage,
      ],
      safeReadConfirmed: true,
    })]);
    stepNames.add("patient_search_match_resolution");
  }

  if (!stepNames.has("chart_open")) {
    appendAutomationLogs(run, [createAutomationStepLog({
      step: "chart_open",
      message: `Patient chart open was skipped because patient lookup failed before chart navigation completed. ${failureMessage}`,
      patientName: workItem.patientIdentity.displayName,
      missing: ["patient chart"],
      evidence: [
        `Match status at failure: ${run.matchResult.status}`,
        ...(run.matchResult.note ? [run.matchResult.note] : []),
        failureMessage,
      ],
      safeReadConfirmed: true,
    })]);
    stepNames.add("chart_open");
  }

  if (!stepNames.has("chart_discovery_skipped")) {
    appendAutomationLogs(run, [createAutomationStepLog({
      step: "chart_discovery_skipped",
      message: `Chart discovery skipped because patient match status was ${run.matchResult.status}.`,
      patientName: workItem.patientIdentity.displayName,
      found: run.matchResult.candidateNames.slice(0, 8),
      evidence: [
        ...(run.matchResult.note ? [run.matchResult.note] : []),
        failureMessage,
      ],
      safeReadConfirmed: true,
    })]);
  }
}

function appendFailureQaSummaryLogIfMissing(input: {
  run: PatientRun;
  message: string;
}): void {
  const { run, message } = input;
  const hasQaSummary = run.automationStepLogs.some((log) => log.step === "qa_summary");
  if (hasQaSummary) {
    return;
  }

  appendAutomationLogs(run, [{
    timestamp: new Date().toISOString(),
    step: "qa_summary",
    message,
    patientName: run.patientName,
    urlBefore: null,
    urlAfter: null,
    selectorUsed: null,
    found: run.oasisQaSummary.sections.map((section) => `${section.key}:${section.status}`),
    missing: run.oasisQaSummary.blockers,
    openedDocumentLabel: null,
    openedDocumentUrl: null,
    evidence: [
      ...(run.errorSummary ? [run.errorSummary] : []),
      ...run.oasisQaSummary.blockers,
    ],
    retryCount: 0,
    safeReadConfirmed: true,
  }]);
}

function setDocumentInventory(
  run: PatientRun,
  inventory: DocumentInventoryItem[],
): void {
  run.documentInventory = inventory;
}

function mergeDocumentInventoryItems(input: {
  currentInventory: DocumentInventoryItem[];
  nextInventory: DocumentInventoryItem[];
}): DocumentInventoryItem[] {
  const merged = new Map<string, DocumentInventoryItem>();
  for (const item of [...input.currentInventory, ...input.nextInventory]) {
    const key = [
      item.normalizedType,
      item.sourceLabel,
      item.sourceUrl ?? "",
      item.sourcePath ?? "",
    ].join("::");
    const existing = merged.get(key);
    if (!existing || item.confidence > existing.confidence) {
      merged.set(key, item);
    }
  }
  return [...merged.values()];
}

function buildFallbackCanonicalCodingInput(input: {
  run: PatientRun;
  reason?: string;
}): CanonicalDiagnosisExtraction {
  const failureReason = input.reason ?? input.run.errorSummary ?? input.run.matchResult.note ?? "coding_input_unavailable";
  return {
    reason_for_admission: null,
    diagnosis_phrases: [],
    diagnosis_code_pairs: [],
    icd10_codes_found_verbatim: [],
    ordered_services: [],
    clinical_summary: null,
    source_quotes: [],
    uncertain_items: [failureReason],
    document_type: null,
    extraction_confidence: "low",
  };
}

function buildExtractionStepLogs(input: {
  run: PatientRun;
  extractedDocuments: ExtractedDocument[];
}): AutomationStepLog[] {
  const { run, extractedDocuments } = input;
  const oasisDocuments = extractedDocuments.filter((document) => document.type === "OASIS");
  const pocDocuments = extractedDocuments.filter((document) => document.type === "POC");
  const visitNoteDocuments = extractedDocuments.filter((document) => document.type === "VISIT_NOTE");
  const orderDocuments = extractedDocuments.filter((document) => document.type === "ORDER");
  const technicalReview = extractTechnicalReview(run.artifacts, extractedDocuments, run.documentInventory);
  const documentEvidence = extractedDocuments.flatMap((document, index) => [
    `[${index}] type=${document.type} source=${document.metadata.source ?? "artifact_fallback"} effectiveTextSource=${getEffectiveTextSource(document)} portalLabel=${document.metadata.portalLabel ?? "none"} textLength=${document.metadata.textLength ?? document.text.length}`,
    `[${index}] rawExtractedTextSource=${document.metadata.rawExtractedTextSource ?? "none"} textSelectionReason=${document.metadata.textSelectionReason ?? "none"}`,
    `[${index}] domExtractionRejectedReasons=${document.metadata.domExtractionRejectedReasons?.join(" | ") || "none"}`,
    `[${index}] preview=${document.metadata.textPreview || document.text.slice(0, 500) || "none"}`,
    ...(document.type === "ORDER"
      ? [
          `[${index}] admissionReasonPrimary=${document.metadata.admissionReasonPrimary ?? "none"}`,
          `[${index}] admissionReasonSnippets=${document.metadata.admissionReasonSnippets?.join(" | ") || "none"}`,
          `[${index}] possibleIcd10Codes=${document.metadata.possibleIcd10Codes?.join(" | ") || "none"}`,
          `[${index}] possibleIcd10CodeCount=${document.metadata.possibleIcd10Codes?.length ?? 0}`,
        ]
      : []),
  ]);

  return [
    createAutomationStepLog({
      step: "document_extraction",
      message: `Extracted ${extractedDocuments.length} document(s) for QA evaluation.`,
      patientName: run.patientName,
      found: extractedDocuments.map((document, index) =>
        `${index}:${document.type}:${getEffectiveTextSource(document)}:${document.metadata.source ?? "artifact_fallback"}:${document.metadata.textLength ?? document.text.length}`),
      missing: extractedDocuments.length > 0 ? [] : ["extracted document text"],
      evidence: documentEvidence,
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "admission_document_extract",
      message: orderDocuments.length > 0
        ? `Extracted ${orderDocuments.length} Admission Order/referral document text block(s).`
        : "No Admission Order/referral text blocks were extracted.",
      patientName: run.patientName,
      found: orderDocuments.map((document) =>
        `${document.metadata.portalLabel ?? "Admission Order"}:${document.metadata.textLength}`),
      missing: orderDocuments.length > 0 ? [] : ["Admission Order/referral text"],
      evidence: orderDocuments.flatMap((document, index) => [
        `[${index}] source=${document.metadata.source ?? "artifact_fallback"}`,
        `[${index}] effectiveTextSource=${getEffectiveTextSource(document)}`,
        `[${index}] rawExtractedTextSource=${document.metadata.rawExtractedTextSource ?? "none"}`,
        `[${index}] textSelectionReason=${document.metadata.textSelectionReason ?? "none"}`,
        `[${index}] domExtractionRejectedReasons=${document.metadata.domExtractionRejectedReasons?.join(" | ") || "none"}`,
        `[${index}] preview=${document.metadata.textPreview || document.text.slice(0, 500) || "none"}`,
        `[${index}] admissionReasonPrimary=${document.metadata.admissionReasonPrimary ?? "none"}`,
        `[${index}] admissionReasonSnippets=${document.metadata.admissionReasonSnippets?.join(" | ") || "none"}`,
        `[${index}] possibleIcd10Codes=${document.metadata.possibleIcd10Codes?.join(" | ") || "none"}`,
      ]),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "oasis_extract",
      message: oasisDocuments.length > 0
        ? `Extracted ${oasisDocuments.length} OASIS document(s).`
        : "No OASIS document content was extracted.",
      patientName: run.patientName,
      found: oasisDocuments.map((document) => document.metadata.portalLabel ?? document.metadata.sourcePath ?? "OASIS"),
      missing: oasisDocuments.length > 0 ? [] : ["OASIS"],
      evidence: oasisDocuments.flatMap((document) => document.metadata.keyPhrases?.slice(0, 4) ?? []),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "poc_extract",
      message: pocDocuments.length > 0
        ? `Extracted ${pocDocuments.length} plan-of-care document(s).`
        : "No plan-of-care content was extracted.",
      patientName: run.patientName,
      found: pocDocuments.map((document) => document.metadata.portalLabel ?? document.metadata.sourcePath ?? "POC"),
      missing: pocDocuments.length > 0 ? [] : ["POC"],
      evidence: pocDocuments.flatMap((document) => document.metadata.keyPhrases?.slice(0, 4) ?? []),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "visit_note_extract",
      message: visitNoteDocuments.length > 0
        ? `Extracted ${visitNoteDocuments.length} visit-note document(s).`
        : "No visit-note content was extracted.",
      patientName: run.patientName,
      found: visitNoteDocuments.map((document) => document.metadata.portalLabel ?? document.metadata.sourcePath ?? "VISIT_NOTE"),
      missing: visitNoteDocuments.length > 0 ? [] : ["VISIT_NOTE"],
      evidence: visitNoteDocuments.flatMap((document) => document.metadata.keyPhrases?.slice(0, 6) ?? []),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "technical_review_extract",
      message: "Aggregated technical-review evidence from document inventory and extracted content.",
      patientName: run.patientName,
      found: [
        `orders:${technicalReview.orderCount}`,
        `summaries:${technicalReview.summaryCount}`,
        `supervisory:${technicalReview.supervisoryCount}`,
        `communication:${technicalReview.communicationCount}`,
        `missed_visits:${technicalReview.missedVisitCount}`,
        `sn_visits:${technicalReview.snVisitCount}`,
      ],
      evidence: [
        ...technicalReview.evidence.orderCount,
        ...technicalReview.evidence.summaryCount,
        ...technicalReview.evidence.supervisoryCount,
        ...technicalReview.evidence.communicationCount,
        ...technicalReview.evidence.missedVisitCount,
        ...technicalReview.evidence.snVisitCount,
      ],
      safeReadConfirmed: true,
    }),
  ];
}

function countCodingInputDiagnoses(document: Awaited<ReturnType<typeof writeCodingInputFile>>["document"]): number {
  return (document.primaryDiagnosis.description ? 1 : 0) + document.otherDiagnoses.length;
}

function formatPrimaryDiagnosisSelected(document: CodingInputDocument): string {
  if (!document.primaryDiagnosis.description) {
    return "none";
  }
  return [
    document.primaryDiagnosis.code,
    document.primaryDiagnosis.description,
  ].filter(Boolean).join(" ");
}

function summarizeCodeConfidence(document: CodingInputDocument): string {
  const counts = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const diagnosis of [document.primaryDiagnosis, ...document.otherDiagnoses]) {
    if (!diagnosis.description) {
      continue;
    }
    counts[diagnosis.confidence] += 1;
  }

  return `high:${counts.high} medium:${counts.medium} low:${counts.low}`;
}

function updatePatientRunDerivedFields(run: PatientRun): PatientRun {
  if (!["COMPLETE", "BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(run.processingStatus)) {
    run.oasisQaSummary = buildOasisQaSummary({
      workItem: run.workItemSnapshot,
      matchResult: run.matchResult,
      artifacts: run.artifacts,
      processingStatus: run.processingStatus,
      documentInventory: run.documentInventory,
    });
  }
  run.artifactCount = run.artifacts.length;
  run.hasFindings = run.findings.length > 0;
  run.bundleAvailable = Boolean(run.resultBundlePath);
  run.retryEligible = canRetryPatientRun(run);
  run.lastUpdatedAt = new Date().toISOString();
  return run;
}

async function emitPatientRunUpdate(
  run: PatientRun,
  outputDirectory: string,
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void,
): Promise<void> {
  updatePatientRunDerivedFields(run);
  run.logPath = await writePatientRunLog(outputDirectory, run);
  run.logAvailable = true;
  if (onPatientRunUpdate) {
    await onPatientRunUpdate({
      ...run,
      auditArtifacts: {
        tracePath: run.auditArtifacts.tracePath,
        screenshotPaths: [...run.auditArtifacts.screenshotPaths],
        downloadPaths: [...run.auditArtifacts.downloadPaths],
      },
      artifacts: [...run.artifacts],
      documentInventory: [...run.documentInventory],
      findings: [...run.findings],
      automationStepLogs: [...run.automationStepLogs],
      notes: [...run.notes],
    });
  }
}

export async function executePatientWorkItems(
  params: ExecutePatientWorkItemsParams,
): Promise<PatientRun[]> {
  const env = loadEnv();
  const logger = params.logger ?? createLogger();
  const patientRuns: PatientRun[] = [];

  await mkdir(params.outputDir, { recursive: true });

  await verifyDiagnosisCodingLlmAccess({
    env,
    logger,
  });

  const portalClient =
    params.portalClient ??
    new PlaywrightBatchQaWorker(
      resolvePortalRuntimeConfig({
        env,
        providedRuntimeConfig: params.subsidiaryRuntimeConfig,
        fallbackSubsidiaryId: params.workItems[0]?.subsidiaryId,
      }),
      env,
      logger,
    );

  try {
    await portalClient.initialize(params.outputDir);
  } catch (error) {
    const errorSummary =
      error instanceof Error ? error.message : "Unknown portal initialization error.";

    for (const workItem of params.workItems) {
      const run = createInitialPatientRun({
        batchId: params.batchId,
        workItem,
      });
      run.processingStatus = "FAILED";
      run.executionStep = "FAILED";
      run.progressPercent = 100;
      run.qaOutcome = "PORTAL_MISMATCH";
      run.errorSummary = errorSummary;
      run.notes.push(errorSummary);
      run.matchResult = {
        status: "ERROR",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: null,
        portalDisplayName: null,
        candidateNames: [],
        note: errorSummary,
      };
      appendAutomationLogs(run, [createAutomationStepLog({
        step: "login",
        message: `Portal initialization failed before patient search: ${errorSummary}`,
        patientName: workItem.patientIdentity.displayName,
        safeReadConfirmed: true,
      })]);
      appendMissingBaselineFailureLogs({
        run,
        workItem,
        failureMessage: errorSummary,
      });
      run.oasisQaSummary = buildOasisQaSummary({
        workItem,
        matchResult: run.matchResult,
        artifacts: [],
        processingStatus: "FAILED",
        documentInventory: [],
      });
      appendFailureQaSummaryLogIfMissing({
        run,
        message: `QA summary computed after portal initialization failure with overallStatus=${run.oasisQaSummary.overallStatus}.`,
      });
      try {
        const fallbackCodingInput = await writeCodingInputFile({
          outputDirectory: params.outputDir,
          patientId: workItem.id,
          batchId: params.batchId,
          canonical: buildFallbackCanonicalCodingInput({
            run,
            reason: "coding_input_export_fallback_for_portal_initialization_failure",
          }),
        });
        appendAutomationLogs(run, [createAutomationStepLog({
          step: "coding_input_export",
          message: "Wrote fallback coding-input.json after portal initialization failure.",
          patientName: workItem.patientIdentity.displayName,
          found: [
            `codingInputPath:${fallbackCodingInput.filePath}`,
            `diagnosisCount:${countCodingInputDiagnoses(fallbackCodingInput.document)}`,
          ],
          missing: ["primary diagnosis"],
          evidence: [
            `suggestedOnsetType:${fallbackCodingInput.document.suggestedOnsetType}`,
            errorSummary,
          ],
          safeReadConfirmed: true,
        })]);
        run.notes.push(`Fallback coding input exported: ${fallbackCodingInput.filePath}`);
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        appendAutomationLogs(run, [createAutomationStepLog({
          step: "coding_input_export",
          message: "Fallback coding-input export failed after portal initialization failure.",
          patientName: workItem.patientIdentity.displayName,
          found: [],
          missing: ["coding-input.json"],
          evidence: [fallbackMessage],
          safeReadConfirmed: true,
        })]);
        run.notes.push(`Fallback coding input export failed: ${fallbackMessage}`);
      }
      run.completedAt = new Date().toISOString();
      run.resultBundlePath = await writePatientResultBundle(params.outputDir, run);
      run.bundleAvailable = true;
      await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
      patientRuns.push(run);
    }

    await portalClient.dispose();
    return patientRuns;
  }

  try {
    for (const workItem of params.workItems) {
      const run = createInitialPatientRun({
        batchId: params.batchId,
        workItem,
      });
      let codingInputExportPath: string | null = null;

      await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);

      try {
        const evidenceDir = path.join(params.outputDir, "evidence", workItem.id);
        const patientResolution = await portalClient.resolvePatient(workItem, evidenceDir);
        run.matchResult = patientResolution.matchResult;
        appendAutomationLogs(run, ensureCanonicalAutomationLogs({
          workItem,
          matchResult: run.matchResult,
          logs: patientResolution.stepLogs,
        }));
        let extractedDocuments: ExtractedDocument[] = [];
        let documentTextExportPath: string | null = null;

        if (run.matchResult.status === "EXACT") {
          run.processingStatus = "DISCOVERING_CHART";
          run.executionStep = "DISCOVERING_CHART";
          run.progressPercent = 25;
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);

          run.processingStatus = "COLLECTING_EVIDENCE";
          run.executionStep = "COLLECTING_EVIDENCE";
          run.progressPercent = 55;
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
          const discoveryResult = await portalClient.discoverArtifacts(workItem, evidenceDir, {
            workflowPhase: "file_uploads_only",
          });
          run.artifacts = discoveryResult.artifacts;
          setDocumentInventory(run, discoveryResult.documentInventory);
          appendAutomationLogs(run, discoveryResult.stepLogs);
          try {
            const documentInventoryExport = await writeDocumentInventoryFile({
              outputDirectory: params.outputDir,
              patientId: workItem.id,
              batchId: params.batchId,
              documentInventory: run.documentInventory,
            });
            run.notes.push(`Document inventory exported: ${documentInventoryExport.filePath}`);
          } catch (error) {
            const documentInventoryExportError = error instanceof Error ? error.message : String(error);
            run.notes.push(`Document inventory export failed: ${documentInventoryExportError}`);
          }
          run.processingStatus = "RUNNING_QA";
          run.executionStep = "RUNNING_QA";
          run.progressPercent = 80;
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);

          extractedDocuments = await extractDocumentsFromArtifacts(run.artifacts);
          try {
            const documentTextExport = await writeDocumentTextFile({
              outputDirectory: params.outputDir,
              patientId: workItem.id,
              batchId: params.batchId,
              extractedDocuments,
            });
            documentTextExportPath = documentTextExport.filePath;
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "document_text_export",
              message: "Wrote normalized extracted document text for read-only dashboard reference and troubleshooting.",
              patientName: run.patientName,
              found: [
                `documentTextPath:${documentTextExport.filePath}`,
                `documentCount:${documentTextExport.document.documentCount}`,
                `orderDocumentCount:${documentTextExport.document.orderDocumentCount}`,
                `hasAdmissionOrderText:${documentTextExport.document.hasAdmissionOrderText}`,
              ],
              missing: documentTextExport.document.hasAdmissionOrderText
                ? []
                : ["Admission Order text"],
              evidence: documentTextExport.document.documents.flatMap((document) => [
                `[${document.documentIndex}] type=${document.type} source=${document.source} effectiveTextSource=${document.effectiveTextSource} textLength=${document.textLength}`,
                `[${document.documentIndex}] rawExtractedTextSource=${document.rawExtractedTextSource ?? "none"} textSelectionReason=${document.textSelectionReason ?? "none"}`,
                `[${document.documentIndex}] domExtractionRejectedReasons=${document.domExtractionRejectedReasons.join(" | ") || "none"}`,
                `[${document.documentIndex}] preview=${document.textPreview || "none"}`,
              ]),
              safeReadConfirmed: true,
            })]);
            run.notes.push(`Document text exported: ${documentTextExport.filePath}`);
          } catch (error) {
            const documentTextExportError = error instanceof Error ? error.message : String(error);
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "document_text_export",
              message: "Document text export failed; continuing with in-memory extracted document text.",
              patientName: run.patientName,
              found: [],
              missing: ["document-text.json"],
              evidence: [documentTextExportError],
              safeReadConfirmed: true,
            })]);
            run.notes.push(`Document text export failed: ${documentTextExportError}`);
          }
          run.notes.push(`Extracted ${extractedDocuments.length} document(s) for QA evaluation.`);
          appendAutomationLogs(run, buildExtractionStepLogs({
            run,
            extractedDocuments,
          }));

          const codingContext = await extractDiagnosisCodingContext({
            extractedDocuments,
            env,
          });
          appendAutomationLogs(run, [createAutomationStepLog({
            step: "diagnosis_code_extract",
            message:
              codingContext.icd10Codes.length > 0
                ? `Extracted ${codingContext.icd10Codes.length} diagnosis code candidate(s) from admission/referral/OASIS text.`
                : "No ICD-10 code candidates were extracted from admission/referral/OASIS text.",
            patientName: run.patientName,
            found: [
              `icd10CodeCount:${codingContext.icd10Codes.length}`,
              `diagnosisMentionCount:${codingContext.diagnosisMentions.length}`,
              `diagnosisCodePairCount:${codingContext.canonical.diagnosis_code_pairs.length}`,
              `extractionConfidence:${codingContext.canonical.extraction_confidence}`,
              `llmUsed:${codingContext.llmUsed}`,
            ],
            missing: codingContext.icd10Codes.length > 0 ? [] : ["ICD-10 code candidates"],
            evidence: codingContext.evidence,
            safeReadConfirmed: true,
          })]);

          let codingInputExport:
            | Awaited<ReturnType<typeof writeCodingInputFile>>
            | null = null;
          try {
            codingInputExport = await writeCodingInputFile({
              outputDirectory: params.outputDir,
              patientId: workItem.id,
              batchId: params.batchId,
              canonical: codingContext.canonical,
            });
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "coding_input_export",
              message:
                "Wrote read-only diagnosis reference output for dashboard consumption.",
              patientName: run.patientName,
              found: [
                `codingInputPath:${codingInputExport.filePath}`,
                `diagnosisCount:${countCodingInputDiagnoses(codingInputExport.document)}`,
                `primaryDiagnosisSelected:${formatPrimaryDiagnosisSelected(codingInputExport.document)}`,
                `otherDiagnosisCount:${codingInputExport.document.otherDiagnoses.length}`,
                `codeConfidenceSummary:${summarizeCodeConfidence(codingInputExport.document)}`,
                `noteCount:${codingInputExport.document.notes.length}`,
                `primaryDiagnosisCode:${codingInputExport.document.primaryDiagnosis.code || "none"}`,
              ],
              missing: [],
              evidence: [
                `primaryDiagnosisDescription:${codingInputExport.document.primaryDiagnosis.description || "none"}`,
                `suggestedOnsetType:${codingInputExport.document.suggestedOnsetType}`,
                `suggestedSeverity:${codingInputExport.document.suggestedSeverity}`,
                `comorbidityFlags:${JSON.stringify(codingInputExport.document.comorbidityFlags)}`,
              ],
              safeReadConfirmed: true,
            })]);
            run.notes.push(`Coding input exported: ${codingInputExport.filePath}`);
            codingInputExportPath = codingInputExport.filePath;
          } catch (error) {
            const exportError = error instanceof Error ? error.message : String(error);
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "coding_input_export",
              message: "Coding input export failed; continuing without exported coding-input.json.",
              patientName: run.patientName,
              found: [],
              missing: ["coding-input.json"],
              evidence: [exportError],
              safeReadConfirmed: true,
            })]);
            run.notes.push(`Coding input export failed: ${exportError}`);
          }

          if (run.artifacts.length > 0) {
            const firstArtifact = run.artifacts[0]!;
            firstArtifact.extractedFields = {
              ...firstArtifact.extractedFields,
              diagnosisMentionCount: String(codingContext.diagnosisMentions.length),
              diagnosisMentions: codingContext.diagnosisMentions.join(" | "),
              diagnosisCodeCount: String(codingContext.icd10Codes.length),
              diagnosisCodes: codingContext.icd10Codes.join(" | "),
              diagnosisCodeCategories: codingContext.codeCategories.join(" | "),
              diagnosisCanonicalJson: JSON.stringify(codingContext.canonical),
              codingInputPath: codingInputExport?.filePath ?? null,
              codingInputJson: codingInputExport ? JSON.stringify(codingInputExport.document) : null,
              reasonForAdmission: codingContext.canonical.reason_for_admission,
              diagnosisCodePairs: codingContext.canonical.diagnosis_code_pairs
                .map((pair) => `${pair.diagnosis} => ${pair.code ?? "null"} (${pair.code_source ?? "null"})`)
                .join(" | "),
              primaryDiagnosis: codingInputExport?.document.primaryDiagnosis.description ?? null,
              primaryDiagnosisCode: codingInputExport?.document.primaryDiagnosis.code ?? null,
              otherDiagnoses: codingInputExport?.document.otherDiagnoses
                .map((diagnosis) => `${diagnosis.description}${diagnosis.code ? ` (${diagnosis.code})` : ""}`)
                .join(" | ") ?? "",
              suggestedOnsetType: codingInputExport?.document.suggestedOnsetType ?? null,
              suggestedSeverity: codingInputExport?.document.suggestedSeverity != null
                ? String(codingInputExport.document.suggestedSeverity)
                : null,
              comorbidityFlags: codingInputExport
                ? JSON.stringify(codingInputExport.document.comorbidityFlags)
                : null,
              orderedServices: codingContext.canonical.ordered_services.join(" | "),
              extractionConfidence: codingContext.canonical.extraction_confidence,
              uncertainDiagnosisItems: codingContext.canonical.uncertain_items.join(" | "),
              codingLlmUsed: String(codingContext.llmUsed),
              codingLlmModel: codingContext.llmModel,
              codingLlmError: codingContext.llmError,
              documentTextPath: documentTextExportPath,
            };
          }
          if (codingContext.icd10Codes.length > 0) {
            run.notes.push(`Diagnosis code candidates: ${codingContext.icd10Codes.join(", ")}`);
          }
        } else {
          run.processingStatus = "RUNNING_QA";
          run.executionStep = "RUNNING_QA";
          run.progressPercent = 80;
          run.notes.push(run.matchResult.note ?? `Patient match status ${run.matchResult.status}.`);
          appendAutomationLogs(run, [createAutomationStepLog({
            step: "chart_discovery_skipped",
            message: `Chart discovery skipped because patient match status was ${run.matchResult.status}.`,
            patientName: run.patientName,
            found: run.matchResult.candidateNames.slice(0, 8),
            evidence: run.matchResult.note ? [run.matchResult.note] : [],
            safeReadConfirmed: true,
          })]);
          appendMissingBaselineFailureLogs({
            run,
            workItem,
            failureMessage:
              run.matchResult.note ??
              `Patient lookup ended with non-EXACT status ${run.matchResult.status} before chart discovery.`,
          });
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
        }

        const qa = evaluateDeterministicQa({
          workItem,
          matchResult: run.matchResult,
          artifacts: run.artifacts,
          processingStatus: "COMPLETE",
          extractedDocuments,
          documentInventory: run.documentInventory,
        });

        run.findings = qa.findings;
        run.qaOutcome = qa.qaOutcome;
        run.processingStatus = processingStatusForOutcome(run);
        run.executionStep = run.processingStatus;
        run.progressPercent = 100;
        run.oasisQaSummary = buildOasisQaSummary({
          workItem,
          matchResult: run.matchResult,
          artifacts: run.artifacts,
          processingStatus: run.processingStatus,
          extractedDocuments,
          documentInventory: run.documentInventory,
        });
        appendAutomationLogs(run, [{
          timestamp: new Date().toISOString(),
          step: "qa_summary",
          message: `QA summary computed with overallStatus=${run.oasisQaSummary.overallStatus}.`,
          patientName: run.patientName,
          urlBefore: null,
          urlAfter: null,
          selectorUsed: null,
          found: run.oasisQaSummary.sections.map((section) => `${section.key}:${section.status}`),
          missing: run.oasisQaSummary.blockers,
          openedDocumentLabel: null,
          openedDocumentUrl: null,
          evidence: run.oasisQaSummary.blockers,
          retryCount: 0,
          safeReadConfirmed: true,
        }]);
        run.errorSummary =
          run.processingStatus === "COMPLETE"
            ? null
            : run.notes.at(-1) ??
              run.matchResult.note ??
              `Patient run ended with status ${run.processingStatus}.`;
      } catch (error) {
        run.processingStatus = "FAILED";
        run.executionStep = "FAILED";
        run.progressPercent = 100;
        run.qaOutcome = "PORTAL_MISMATCH";
        run.errorSummary =
          error instanceof Error ? error.message : "Unknown batch worker error.";
        run.notes.push(run.errorSummary);
        run.matchResult = {
          status: "ERROR",
          searchQuery: run.matchResult.searchQuery || workItem.patientIdentity.displayName,
          portalPatientId: run.matchResult.portalPatientId,
          portalDisplayName: run.matchResult.portalDisplayName,
          candidateNames: run.matchResult.candidateNames,
          note: run.errorSummary,
        };
        appendMissingBaselineFailureLogs({
          run,
          workItem,
          failureMessage: run.errorSummary,
        });
        run.auditArtifacts = await portalClient.captureFailureArtifacts(
          workItem.id,
          params.outputDir,
        );
        appendAutomationLogs(run, [createAutomationStepLog({
          step: "failure_artifacts",
          message: "Captured failure artifacts for the active Playwright session.",
          patientName: run.patientName,
          found: [
            ...run.auditArtifacts.screenshotPaths,
            ...run.auditArtifacts.downloadPaths,
            ...(run.auditArtifacts.tracePath ? [run.auditArtifacts.tracePath] : []),
          ],
          safeReadConfirmed: true,
        })]);
        run.oasisQaSummary = buildOasisQaSummary({
          workItem,
          matchResult: run.matchResult,
          artifacts: run.artifacts,
          processingStatus: "FAILED",
          documentInventory: run.documentInventory,
        });
        appendFailureQaSummaryLogIfMissing({
          run,
          message: `QA summary computed after worker failure with overallStatus=${run.oasisQaSummary.overallStatus}.`,
        });
      } finally {
        if (!codingInputExportPath) {
          try {
            const fallbackCodingInput = await writeCodingInputFile({
              outputDirectory: params.outputDir,
              patientId: workItem.id,
              batchId: params.batchId,
              canonical: buildFallbackCanonicalCodingInput({
                run,
                reason:
                  run.matchResult.status === "EXACT"
                    ? "coding_input_export_skipped_after_exact_path_failure"
                    : `coding_input_export_fallback_for_match_status_${run.matchResult.status}`,
              }),
            });
            codingInputExportPath = fallbackCodingInput.filePath;
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "coding_input_export",
              message: "Wrote fallback coding-input.json for downstream read-only diagnosis consumers.",
              patientName: run.patientName,
              found: [
                `codingInputPath:${fallbackCodingInput.filePath}`,
                `diagnosisCount:${countCodingInputDiagnoses(fallbackCodingInput.document)}`,
                `primaryDiagnosisSelected:${formatPrimaryDiagnosisSelected(fallbackCodingInput.document)}`,
                `otherDiagnosisCount:${fallbackCodingInput.document.otherDiagnoses.length}`,
                `codeConfidenceSummary:${summarizeCodeConfidence(fallbackCodingInput.document)}`,
              ],
              missing: ["primary diagnosis"],
              evidence: [
                `suggestedOnsetType:${fallbackCodingInput.document.suggestedOnsetType}`,
                `matchStatus:${run.matchResult.status}`,
              ],
              safeReadConfirmed: true,
            })]);
            run.notes.push(`Fallback coding input exported: ${fallbackCodingInput.filePath}`);
          } catch (error) {
            const fallbackError = error instanceof Error ? error.message : String(error);
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "coding_input_export",
              message: "Fallback coding-input export failed.",
              patientName: run.patientName,
              found: [],
              missing: ["coding-input.json"],
              evidence: [fallbackError],
              safeReadConfirmed: true,
            })]);
            run.notes.push(`Fallback coding input export failed: ${fallbackError}`);
          }
        }
        run.completedAt = new Date().toISOString();
        run.resultBundlePath = await writePatientResultBundle(params.outputDir, run);
        run.bundleAvailable = true;
        await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
        patientRuns.push(run);
      }
    }
  } finally {
    await portalClient.dispose();
  }

  return patientRuns;
}

export async function runQAForPatient(
  params: RunQaForPatientParams,
): Promise<PatientRun> {
  const [patientRun] = await executePatientWorkItems({
    batchId: params.batchId,
    workItems: [params.patient],
    outputDir: params.outputDir,
    subsidiaryRuntimeConfig: params.subsidiaryRuntimeConfig,
    logger: params.logger,
    portalClient: params.portalClient,
    onPatientRunUpdate: params.onPatientRunUpdate,
  });

  if (!patientRun) {
    throw new Error(`No patient run was produced for patient: ${params.patient.id}`);
  }

  return patientRun;
}

export function createBatchSummary(params: {
  manifest: BatchManifest;
  parserExceptions: ParserException[];
  patientRuns: PatientRun[];
  startedAt: string;
  completedAt: string;
}): BatchSummary {
  return buildBatchSummary(params);
}

export async function persistBatchSummary(
  outputDirectory: string,
  batchSummary: BatchSummary,
): Promise<string> {
  const batchSummaryPath = path.join(outputDirectory, "batch-summary.json");
  await writeFile(batchSummaryPath, JSON.stringify(batchSummary, null, 2), "utf8");
  return batchSummaryPath;
}

export async function runBatchQA(
  params: RunBatchQaParams,
): Promise<{
  manifest: BatchManifest;
  patientRuns: PatientRun[];
  batchSummary: BatchSummary;
  manifestPath: string;
  workItemsPath: string;
  parserExceptionsPath: string;
  batchSummaryPath: string;
}> {
  const logger = params.logger ?? createLogger();
  await mkdir(params.outputDir, { recursive: true });

  const parserExceptions = params.parserExceptions ?? [];
  const manifest = createBatchManifestFromPatients({
    batchId: params.batchId,
    subsidiaryId: params.subsidiaryRuntimeConfig?.subsidiaryId ?? params.patients[0]?.subsidiaryId ?? "default",
    workbookPath: params.workbookPath ?? path.join(params.outputDir, "source.xlsx"),
    outputDirectory: params.outputDir,
    patients: params.patients,
    parserExceptions,
    billingPeriod: params.billingPeriod ?? null,
  });

  const manifestPath = path.join(params.outputDir, "batch-manifest.json");
  const workItemsPath = path.join(params.outputDir, "work-items.json");
  const parserExceptionsPath = path.join(params.outputDir, "parser-exceptions.json");

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(workItemsPath, JSON.stringify(params.patients, null, 2), "utf8");
  await writeFile(parserExceptionsPath, JSON.stringify(parserExceptions, null, 2), "utf8");

  const patientRuns = await executePatientWorkItems({
    batchId: params.batchId,
    workItems: params.patients,
    outputDir: params.outputDir,
    subsidiaryRuntimeConfig: params.subsidiaryRuntimeConfig,
    logger,
    portalClient: params.portalClient,
    onPatientRunUpdate: params.onPatientRunUpdate,
  });

  const completedAt = new Date().toISOString();
  const batchSummary = createBatchSummary({
    manifest,
    parserExceptions,
    patientRuns,
    startedAt: manifest.createdAt,
    completedAt,
  });
  const batchSummaryPath = await persistBatchSummary(params.outputDir, batchSummary);

  return {
    manifest,
    patientRuns,
    batchSummary,
    manifestPath,
    workItemsPath,
    parserExceptionsPath,
    batchSummaryPath,
  };
}

export async function runFinaleBatch(
  params: RunFinaleBatchParams,
): Promise<RunFinaleBatchResult> {
  const logger = params.logger ?? createLogger();
  const intake =
    params.manifest && params.workItems && params.parserExceptions
      ? {
          manifest: params.manifest,
          workItems: params.workItems,
          parserExceptions: params.parserExceptions,
          manifestPath: path.join(params.manifest.outputDirectory, "batch-manifest.json"),
          workItemsPath: path.join(params.manifest.outputDirectory, "work-items.json"),
          parserExceptionsPath: path.join(params.manifest.outputDirectory, "parser-exceptions.json"),
        }
      : await intakeWorkbook({
          batchId: params.batchId,
          subsidiaryId:
            params.subsidiaryRuntimeConfig?.subsidiaryId ??
            params.workItems?.[0]?.subsidiaryId ??
            "default",
          workbookPath: params.workbookPath,
          outputDir: params.outputDir,
          logger,
        });

  const patientRuns: PatientRun[] = [];
  const startedAt = new Date().toISOString();
  const outputDirectory = intake.manifest.outputDirectory;
  await mkdir(outputDirectory, { recursive: true });

  if (!params.parseOnly) {
    patientRuns.push(
      ...(
        await executePatientWorkItems({
          batchId: intake.manifest.batchId,
          workItems: intake.workItems,
          outputDir: outputDirectory,
          subsidiaryRuntimeConfig: params.subsidiaryRuntimeConfig,
          logger,
          portalClient: params.portalClient,
        })
      ),
    );
  }

  const completedAt = new Date().toISOString();
  const batchSummary = createBatchSummary({
    manifest: intake.manifest,
    parserExceptions: intake.parserExceptions,
    patientRuns,
    startedAt,
    completedAt,
  });
  const batchSummaryPath = await persistBatchSummary(outputDirectory, batchSummary);

  logger.info(
    {
      batchId: intake.manifest.batchId,
      processed: patientRuns.length,
      summaryStatus: batchSummary.status,
    },
    "batch run completed",
  );

  return {
    manifest: intake.manifest,
    workItems: intake.workItems,
    parserExceptions: intake.parserExceptions,
    patientRuns,
    batchSummary,
    manifestPath: intake.manifestPath,
    workItemsPath: intake.workItemsPath,
    parserExceptionsPath: intake.parserExceptionsPath,
    batchSummaryPath,
  };
}
