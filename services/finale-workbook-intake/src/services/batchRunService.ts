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
  WorkflowDomain,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { resolvePortalRuntimeConfig } from "../config/portalRuntime";
import { buildBatchSummary } from "../domain/batchSummary";
import { executeSharedPortalAccessWorkflow } from "../portal/workflows/sharedPortalAccessWorkflow";
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
import { writePatientDashboardState } from "./patientDashboardStateWriter";
import { intakeWorkbook } from "./workbookIntakeService";
import { extractCurrentChartValuesFromPrintedNote } from "../oasis/print/printedNoteChartValueExtractionService";
import type { OasisPrintedNoteReviewResult } from "../oasis/types/oasisPrintedNoteReview";
import { runReferralDocumentProcessingPipeline } from "../referralProcessing/pipeline";
import { runCodingWorkflowOrchestrator } from "../workflows/codingWorkflowOrchestrator";
import { runQaWorkflowOrchestrator } from "../workflows/qaWorkflowOrchestrator";
import { runSharedEvidenceWorkflow } from "../workflows/sharedEvidenceWorkflow";
import {
  buildWorkflowRun,
  createDefaultWorkflowRuns,
  findWorkflowRun,
  upsertWorkflowRun,
} from "../workflows/patientWorkflowRunState";

export interface RunFinaleBatchParams {
  batchId?: string;
  manifest?: BatchManifest;
  workItems?: PatientEpisodeWorkItem[];
  parserExceptions?: ParserException[];
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  workbookPath: string;
  outputDir?: string;
  parseOnly?: boolean;
  workflowDomains?: WorkflowDomain[];
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
  workflowDomains?: WorkflowDomain[];
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
}

export interface RunQaForPatientParams {
  batchId: string;
  patient: PatientEpisodeWorkItem;
  outputDir: string;
  workflowDomains?: WorkflowDomain[];
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
}

export interface RunBatchQaParams {
  batchId: string;
  patients: PatientEpisodeWorkItem[];
  outputDir: string;
  workflowDomains?: WorkflowDomain[];
  workbookPath?: string;
  billingPeriod?: string | null;
  parserExceptions?: ParserException[];
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
}

const PORTAL_NON_ADMIT_PATTERN = /\bnon[-\s]?admit(?:ted)?\b/i;
const PORTAL_PENDING_PATTERN = /\bpending\b/i;

function getPortalExclusionReason(statusLabel: string | null | undefined): string | null {
  const normalized = statusLabel?.trim();
  if (!normalized) {
    return null;
  }

  if (PORTAL_NON_ADMIT_PATTERN.test(normalized)) {
    return "non_admit";
  }

  if (PORTAL_PENDING_PATTERN.test(normalized)) {
    return "pending";
  }

  return null;
}

function createLogger(): Logger {
  const env = loadEnv();
  return pino({
    name: "finale-batch-runner",
    level: env.FINALE_LOG_LEVEL,
  });
}

function resolveWorkflowDomains(workflowDomains?: WorkflowDomain[]): WorkflowDomain[] {
  const normalized = workflowDomains?.filter((domain, index, values) => values.indexOf(domain) === index) ?? [];
  return normalized.length > 0 ? normalized : ["coding", "qa"];
}

function replaceRunOasisArtifactWithPrintedNoteReview(input: {
  artifacts: ArtifactRecord[];
  printedNoteReview: OasisPrintedNoteReviewResult | null | undefined;
}): ArtifactRecord[] {
  const printedNoteReview = input.printedNoteReview;
  if (!printedNoteReview) {
    return input.artifacts;
  }

  const capture = printedNoteReview.capture;
  const printedNoteArtifact: ArtifactRecord = {
    artifactType: "OASIS",
    status: capture.sourcePdfPath || capture.textLength > 0 ? "DOWNLOADED" : "FOUND",
    portalLabel: printedNoteReview.matchedAssessmentLabel ?? `${printedNoteReview.assessmentType} OASIS`,
    locatorUsed: capture.printButtonSelectorUsed,
    discoveredAt: new Date().toISOString(),
    downloadPath: capture.sourcePdfPath,
    extractedFields: {
      assessmentType: printedNoteReview.assessmentType,
      reviewSource: printedNoteReview.reviewSource,
      overallStatus: printedNoteReview.overallStatus,
      printProfileKey: capture.printProfileKey,
      printButtonDetected: String(capture.printButtonDetected),
      printModalDetected: String(capture.printModalDetected),
      printModalConfirmSucceeded: String(capture.printModalConfirmSucceeded),
      extractionMethod: capture.extractionMethod,
      textLength: String(capture.textLength),
      completedSectionCount: String(
        printedNoteReview.sections.filter((section) => section.status === "COMPLETED").length,
      ),
      incompleteSectionCount: String(
        printedNoteReview.sections.filter((section) => section.status !== "COMPLETED").length,
      ),
      extractedTextPath: capture.extractedTextPath,
      printedPdfPath: capture.sourcePdfPath,
      ocrResultPath: capture.ocrResultPath,
    },
    notes: [
      `Printed-note review status: ${printedNoteReview.overallStatus}`,
      ...printedNoteReview.warnings.slice(0, 6),
    ],
  };

  return [
    ...input.artifacts.filter((artifact) => artifact.artifactType !== "OASIS"),
    printedNoteArtifact,
  ];
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
  const startedAt = new Date().toISOString();
  const runId = `${batchId}-${workItem.id}`;

  return {
    runId,
    batchId,
    subsidiaryId: workItem.subsidiaryId,
    workItemId: workItem.id,
    patientName: workItem.patientIdentity.displayName,
    processingStatus: "MATCHING_PATIENT",
    executionStep: "MATCHING_PATIENT",
    progressPercent: 10,
    startedAt,
    completedAt: null,
    lastUpdatedAt: startedAt,
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
    workflowRuns: createDefaultWorkflowRuns(runId, startedAt),
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

function hasReferralDocumentEvidence(input: {
  artifacts: ArtifactRecord[];
  documentInventory: DocumentInventoryItem[];
  extractedDocuments: ExtractedDocument[];
}): boolean {
  const hasExtractedOrderText = input.extractedDocuments.some((document) =>
    document.type === "ORDER" && document.text.trim().length > 0);
  const hasOrderInventory = input.documentInventory.some((item) => item.normalizedType === "ORDER");
  const hasOrderArtifact = input.artifacts.some((artifact) => artifact.artifactType === "PHYSICIAN_ORDERS");
  return hasExtractedOrderText || hasOrderInventory || hasOrderArtifact;
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
  run.workflowRuns = run.workflowRuns.map((workflowRun) => ({
    ...workflowRun,
    workflowLogPath:
      workflowRun.status === "NOT_STARTED"
        ? workflowRun.workflowLogPath ?? null
        : run.logPath,
    workflowResultPath:
      workflowRun.workflowDomain === "coding" &&
      workflowRun.status !== "NOT_STARTED" &&
      (workflowRun.workflowResultPath ?? run.resultBundlePath)
        ? workflowRun.workflowResultPath ?? run.resultBundlePath
        : workflowRun.workflowResultPath ?? null,
  }));
  run.logPath = await writePatientRunLog(outputDirectory, run);
  await writePatientDashboardState({
    outputDirectory,
    run,
  });
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
      workflowRuns: [...run.workflowRuns],
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
  const selectedWorkflowDomains = resolveWorkflowDomains(params.workflowDomains);

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
      run.workflowRuns = selectedWorkflowDomains.reduce(
        (workflowRuns, workflowDomain) =>
          upsertWorkflowRun(
            workflowRuns,
            buildWorkflowRun({
              patientRunId: run.runId,
              workflowDomain,
              status: "FAILED",
              stepName: "FAILED",
              message: errorSummary,
              timestamp: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            }),
          ),
        run.workflowRuns,
      );
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
      if (selectedWorkflowDomains.includes("coding")) {
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
        const sharedAccess = await executeSharedPortalAccessWorkflow({
          batchId: params.batchId,
          patientRunId: run.runId,
          workflowDomains: selectedWorkflowDomains,
          workItem,
          evidenceDir,
          portalClient,
          logger,
        });
        run.matchResult = sharedAccess.matchResult;
        appendAutomationLogs(run, ensureCanonicalAutomationLogs({
          workItem,
          matchResult: run.matchResult,
          logs: sharedAccess.stepLogs,
        }));
        const portalExclusionReason = getPortalExclusionReason(sharedAccess.portalAdmissionStatus);
        if (run.matchResult.status === "EXACT" && portalExclusionReason) {
          const timestamp = new Date().toISOString();
          const blockedMessage = `Portal patient status '${sharedAccess.portalAdmissionStatus}' excludes this patient from autonomous QA evaluation.`;
          run.qaOutcome = "PORTAL_MISMATCH";
          run.processingStatus = "BLOCKED";
          run.executionStep = "PATIENT_STATUS_EXCLUDED";
          run.progressPercent = 100;
          run.errorSummary = blockedMessage;
          run.notes.push(blockedMessage);
          run.notes.push(`Portal admission status evidence: ${sharedAccess.portalAdmissionStatus}`);
          appendAutomationLogs(run, [
            createAutomationStepLog({
              step: "patient_status_gate",
              message: blockedMessage,
              patientName: run.patientName,
              found: [sharedAccess.portalAdmissionStatus!],
              evidence: [`portalExclusionReason=${portalExclusionReason}`],
              safeReadConfirmed: true,
            }),
          ]);
          run.workflowRuns = selectedWorkflowDomains.reduce(
            (workflowRuns, workflowDomain) =>
              upsertWorkflowRun(
                workflowRuns,
                buildWorkflowRun({
                  patientRunId: run.runId,
                  workflowDomain,
                  status: "BLOCKED",
                  stepName: "PATIENT_STATUS_EXCLUDED",
                  message: blockedMessage,
                  chartUrl:
                    sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === workflowDomain)?.chartUrl ??
                    sharedAccess.portalContexts[0]?.chartUrl ??
                    null,
                  timestamp,
                  startedAt: timestamp,
                  completedAt: timestamp,
                }),
              ),
            run.workflowRuns,
          );
          run.oasisQaSummary = buildOasisQaSummary({
            workItem,
            matchResult: run.matchResult,
            artifacts: run.artifacts,
            processingStatus: run.processingStatus,
            documentInventory: run.documentInventory,
          });
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
          continue;
        }
        if (run.matchResult.status === "EXACT" && sharedAccess.portalContexts.length > 0) {
          const sharedEvidenceContext =
            sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === "coding") ??
            sharedAccess.portalContexts[0]!;
          const sharedEvidenceResult = await runSharedEvidenceWorkflow({
            context: sharedEvidenceContext,
            workItem,
            evidenceDir,
            outputDir: params.outputDir,
            env,
            logger,
            portalClient,
          });
          run.artifacts = sharedEvidenceResult.sharedEvidence.artifacts;
          setDocumentInventory(run, sharedEvidenceResult.sharedEvidence.documentInventory);
          appendAutomationLogs(run, sharedEvidenceResult.stepLogs);

          if (sharedEvidenceResult.sharedEvidence.documentInventoryExportPath) {
            run.notes.push(`Document inventory exported: ${sharedEvidenceResult.sharedEvidence.documentInventoryExportPath}`);
          } else if (sharedEvidenceResult.sharedEvidence.documentInventoryExportError) {
            run.notes.push(`Document inventory export failed: ${sharedEvidenceResult.sharedEvidence.documentInventoryExportError}`);
          }
          if (sharedEvidenceResult.sharedEvidence.documentTextExportPath) {
            run.notes.push(`Document text exported: ${sharedEvidenceResult.sharedEvidence.documentTextExportPath}`);
          } else if (sharedEvidenceResult.sharedEvidence.documentTextExportError) {
            run.notes.push(`Document text export failed: ${sharedEvidenceResult.sharedEvidence.documentTextExportError}`);
          }
          if (sharedEvidenceResult.sharedEvidence.referralDocumentSummaryPath) {
            run.notes.push(`Referral document QA summary persisted: ${sharedEvidenceResult.sharedEvidence.referralDocumentSummaryPath}`);
          }

          const referralDocumentAvailable = hasReferralDocumentEvidence({
            artifacts: sharedEvidenceResult.sharedEvidence.artifacts,
            documentInventory: sharedEvidenceResult.sharedEvidence.documentInventory,
            extractedDocuments: sharedEvidenceResult.sharedEvidence.extractedDocuments,
          });
          appendAutomationLogs(run, [createAutomationStepLog({
            step: "referral_document_check",
            message: referralDocumentAvailable
              ? "Referral/admission-order evidence was found in shared chart documents."
              : "Referral/admission-order evidence was not found; downstream QA and coding workflows will be skipped for this patient.",
            patientName: run.patientName,
            found: [
              `artifactOrderCount:${sharedEvidenceResult.sharedEvidence.artifacts.filter((artifact) => artifact.artifactType === "PHYSICIAN_ORDERS").length}`,
              `inventoryOrderCount:${sharedEvidenceResult.sharedEvidence.documentInventory.filter((item) => item.normalizedType === "ORDER").length}`,
              `extractedOrderCount:${sharedEvidenceResult.sharedEvidence.extractedDocuments.filter((document) => document.type === "ORDER" && document.text.trim().length > 0).length}`,
            ],
            missing: referralDocumentAvailable ? [] : ["Referral/admission-order document text"],
            evidence: sharedEvidenceResult.sharedEvidence.extractedDocuments
              .filter((document) => document.type === "ORDER")
              .slice(0, 4)
              .map((document) =>
                `${document.metadata.portalLabel ?? "ORDER"}:${document.metadata.sourcePath ?? "in_memory"}:${document.text.slice(0, 180)}`),
            safeReadConfirmed: true,
          })]);

          if (!referralDocumentAvailable) {
            const timestamp = new Date().toISOString();
            const blockedMessage =
              "Referral/admission-order document text was not found in shared evidence; skipping this patient and continuing to the next.";
            run.qaOutcome = "MISSING_DOCUMENTS";
            run.processingStatus = processingStatusForOutcome(run);
            run.executionStep = "REFERRAL_DOCUMENT_REQUIRED";
            run.progressPercent = 100;
            run.errorSummary = blockedMessage;
            run.notes.push(blockedMessage);
            run.workflowRuns = selectedWorkflowDomains.reduce(
              (workflowRuns, workflowDomain) =>
                upsertWorkflowRun(
                  workflowRuns,
                  buildWorkflowRun({
                    patientRunId: run.runId,
                    workflowDomain,
                    status: "BLOCKED",
                    stepName: "REFERRAL_DOCUMENT_REQUIRED",
                    message: blockedMessage,
                    chartUrl:
                      sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === workflowDomain)?.chartUrl ??
                      sharedAccess.portalContexts[0]?.chartUrl ??
                      null,
                    timestamp,
                    startedAt: timestamp,
                    completedAt: timestamp,
                  }),
                ),
              run.workflowRuns,
            );
            run.oasisQaSummary = buildOasisQaSummary({
              workItem,
              matchResult: run.matchResult,
              artifacts: run.artifacts,
              processingStatus: run.processingStatus,
              documentInventory: run.documentInventory,
            });
            await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
            continue;
          }

          const qaPortalContext = sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === "qa");
          if (qaPortalContext) {
            const qaResult = await runQaWorkflowOrchestrator({
              context: qaPortalContext,
              run,
              workItem,
              evidenceDir,
              outputDir: params.outputDir,
              logger,
              portalClient,
              sharedEvidence: sharedEvidenceResult.sharedEvidence,
            });
            run.artifacts = replaceRunOasisArtifactWithPrintedNoteReview({
              artifacts: run.artifacts,
              printedNoteReview: qaResult.result.printedNoteReview,
            });
            appendAutomationLogs(run, qaResult.stepLogs);
            run.notes.push(`QA prefetch result persisted: ${qaResult.workflowResultPath}`);

            const printedNoteChartValues = await extractCurrentChartValuesFromPrintedNote({
              env,
              logger,
              outputDir: params.outputDir,
              workItem,
              extractedTextPath: qaResult.result.printedNoteReview?.capture.extractedTextPath ?? null,
            });
            run.notes.push(
              printedNoteChartValues.artifactPath
                ? `Printed-note chart values persisted: ${printedNoteChartValues.artifactPath}`
                : "Printed-note chart values were not extracted.",
            );
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "printed_note_chart_values",
              message:
                printedNoteChartValues.extractedFieldCount > 0
                  ? `Extracted ${printedNoteChartValues.extractedFieldCount} current chart value(s) from printed OASIS note text.`
                  : "Printed OASIS note text did not yield usable chart field values.",
              patientName: run.patientName,
              found: [
                `fieldCount=${printedNoteChartValues.extractedFieldCount}`,
                `artifactPath=${printedNoteChartValues.artifactPath ?? "none"}`,
                `invocationModelId=${printedNoteChartValues.invocationModelId ?? "none"}`,
              ],
              missing: printedNoteChartValues.extractedFieldCount > 0 ? [] : ["usable chart field values from printed OASIS note"],
              evidence: printedNoteChartValues.warnings.slice(0, 8),
              safeReadConfirmed: true,
            })]);

            if (printedNoteChartValues.extractedFieldCount > 0) {
              const refreshedReferralProcessing = await runReferralDocumentProcessingPipeline({
                workItem,
                outputDir: params.outputDir,
                env,
                logger,
                extractedDocuments: sharedEvidenceResult.sharedEvidence.extractedDocuments
                  .filter((document) => document.type === "ORDER"),
                currentChartValues: printedNoteChartValues.currentChartValues,
                currentChartValueSource: printedNoteChartValues.currentChartValueSource ?? undefined,
              });
              appendAutomationLogs(run, refreshedReferralProcessing.stepLogs);
              if (refreshedReferralProcessing.result) {
                sharedEvidenceResult.sharedEvidence.referralDocumentProcessing = refreshedReferralProcessing.result;
                sharedEvidenceResult.sharedEvidence.referralDocumentSummaryPath =
                  refreshedReferralProcessing.result.artifacts.qaDocumentSummaryPath ?? null;
                run.notes.push(
                  `Referral comparison refreshed from printed OASIS note: ${refreshedReferralProcessing.result.artifacts.qaDocumentSummaryPath ?? "artifacts updated"}`,
                );
              } else {
                run.notes.push("Referral comparison refresh from printed OASIS note did not produce updated artifacts.");
              }
            }
          }

          const codingPortalContext = sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === "coding");
          if (codingPortalContext) {
            const codingResult = await runCodingWorkflowOrchestrator({
              context: codingPortalContext,
              run,
              workItem,
              sharedEvidence: sharedEvidenceResult.sharedEvidence,
              outputDir: params.outputDir,
              logger,
              emitRunUpdate: async () => {
                await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
              },
            });
            appendAutomationLogs(run, codingResult.stepLogs);
            const codingWorkflowRun = findWorkflowRun(run.workflowRuns, "coding");
            codingInputExportPath = codingWorkflowRun?.workflowResultPath ?? codingInputExportPath;
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
          const qa = evaluateDeterministicQa({
            workItem,
            matchResult: run.matchResult,
            artifacts: run.artifacts,
            processingStatus: "BLOCKED",
            documentInventory: run.documentInventory,
          });
          run.findings = qa.findings;
          run.qaOutcome = qa.qaOutcome;
          run.processingStatus = "BLOCKED";
          run.executionStep = "BLOCKED";
          run.progressPercent = 100;
          run.oasisQaSummary = buildOasisQaSummary({
            workItem,
            matchResult: run.matchResult,
            artifacts: run.artifacts,
            processingStatus: run.processingStatus,
            documentInventory: run.documentInventory,
          });
          run.errorSummary = run.matchResult.note ?? `Patient lookup ended with status ${run.matchResult.status}.`;
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate);
        }

        if (
          !selectedWorkflowDomains.includes("coding") &&
          run.matchResult.status === "EXACT" &&
          run.processingStatus !== "BLOCKED" &&
          run.processingStatus !== "FAILED"
        ) {
          run.processingStatus = "COMPLETE";
          run.executionStep = "OASIS_QA_ENTRY_COMPLETE";
          run.progressPercent = 100;
          run.errorSummary = null;
        }
      } catch (error) {
        run.processingStatus = "FAILED";
        run.executionStep = "FAILED";
        run.progressPercent = 100;
        run.qaOutcome = "PORTAL_MISMATCH";
        run.workflowRuns = selectedWorkflowDomains.reduce(
          (workflowRuns, workflowDomain) =>
            upsertWorkflowRun(
              workflowRuns,
              buildWorkflowRun({
                patientRunId: run.runId,
                workflowDomain,
                status: "FAILED",
                stepName: "FAILED",
                message: error instanceof Error ? error.message : "Unknown batch worker error.",
                chartUrl: findWorkflowRun(run.workflowRuns, workflowDomain)?.chartUrl ?? null,
                timestamp: new Date().toISOString(),
                startedAt: run.startedAt,
                completedAt: new Date().toISOString(),
              }),
            ),
          run.workflowRuns,
        );
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
        if (selectedWorkflowDomains.includes("coding") && !codingInputExportPath) {
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
        run.workflowRuns = run.workflowRuns.map((workflowRun) =>
          workflowRun.workflowDomain === "coding" &&
          workflowRun.status !== "NOT_STARTED" &&
          (workflowRun.workflowResultPath ?? codingInputExportPath ?? run.resultBundlePath)
            ? {
                ...workflowRun,
                workflowResultPath:
                  workflowRun.workflowResultPath ??
                  codingInputExportPath ??
                  run.resultBundlePath,
              }
            : workflowRun,
        );
        await writePatientResultBundle(params.outputDir, run);
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
    workflowDomains: params.workflowDomains,
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
    workflowDomains: params.workflowDomains,
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
          workflowDomains: params.workflowDomains,
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
