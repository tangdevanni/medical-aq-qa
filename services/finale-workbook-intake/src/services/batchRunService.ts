import { createHash } from "node:crypto";
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
import { loadEnv, type FinaleBatchEnv } from "../config/env";
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
import {
  createPatientRunTimingTracker,
  formatPatientRunTimingSummary,
  writePatientRunCacheSummary,
} from "./patientRunReuseSummaryService";
import { intakeWorkbook } from "./workbookIntakeService";
import { extractCurrentChartValuesFromPrintedNote } from "../oasis/print/printedNoteChartValueExtractionService";
import type { OasisPrintedNoteReviewResult } from "../oasis/types/oasisPrintedNoteReview";
import { filterArtifactsForNonReferralTextExtraction } from "../referralProcessing/sourceDocumentHandoff";
import { runCodingWorkflowOrchestrator } from "../workflows/codingWorkflowOrchestrator";
import { runQaWorkflowOrchestrator } from "../workflows/qaWorkflowOrchestrator";
import { runSharedEvidenceWorkflow } from "../workflows/sharedEvidenceWorkflow";
import { writePortalCarePlanDraftFromOasisDom } from "./portalCarePlanDraftService";
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
  stopAfterSharedEvidence?: boolean;
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
  stopAfterSharedEvidence?: boolean;
  targetOasisAssessmentId?: string | null;
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  logger?: Logger;
  portalClient?: BatchPortalAutomationClient;
  onPatientRunUpdate?: (patientRun: PatientRun) => Promise<void> | void;
  skipStartupVerification?: boolean;
}

type IndexedWorkItem = {
  index: number;
  workItem: PatientEpisodeWorkItem;
};

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

function resolvePatientWorkerConcurrency(
  params: ExecutePatientWorkItemsParams,
  env: FinaleBatchEnv,
): number {
  if (params.portalClient || params.workItems.length <= 1) {
    return 1;
  }

  return Math.min(env.FINALE_PATIENT_CONCURRENCY, params.workItems.length);
}

function splitWorkItemsForWorkers(
  workItems: PatientEpisodeWorkItem[],
  workerCount: number,
): IndexedWorkItem[][] {
  const chunks = Array.from({ length: workerCount }, () => [] as IndexedWorkItem[]);
  workItems.forEach((workItem, index) => {
    chunks[index % workerCount]!.push({ index, workItem });
  });
  return chunks.filter((chunk) => chunk.length > 0);
}

function buildPlanOfCareInterventionDrafts(input: {
  label: string;
  code: string | null;
  diagnosisKey: string;
}): Array<{
  selectedText: string;
  rationale: string;
  confidence: number;
  evidenceFactIds: string[];
  interventionScope: string;
}> {
  const normalized = `${input.code ?? ""} ${input.label}`.toLowerCase();
  const evidenceFactIds = [`diagnosis:${input.diagnosisKey}`];
  const makeIntervention = (
    selectedText: string,
    interventionScope: string,
    confidence = 0.74,
  ) => ({
    selectedText,
    rationale: "Generated from extracted diagnosis context after OASIS review.",
    confidence,
    evidenceFactIds,
    interventionScope,
  });

  if (/\b(j1[2-8]|pneumonia|respiratory failure|hypoxia|copd|chronic obstructive)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Skilled nurse to assess respiratory status each visit, including breath sounds, dyspnea, cough, oxygen saturation, and activity tolerance.",
        "respiratory_assessment",
      ),
      makeIntervention(
        "Teach patient and caregiver signs of respiratory decline and when to report increased shortness of breath, fever, productive cough, or oxygen desaturation.",
        "respiratory_education",
      ),
      makeIntervention(
        "Reinforce ordered medication, oxygen, breathing exercise, and energy-conservation instructions as applicable.",
        "respiratory_self_management",
      ),
    ];
  }

  if (/\b(r13|dysphagia|swallow)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess swallowing safety, diet tolerance, hydration, coughing or choking with intake, and aspiration-risk symptoms each visit.",
        "swallowing_assessment",
      ),
      makeIntervention(
        "Teach patient and caregiver aspiration precautions, ordered diet texture, safe positioning, and when to report swallowing changes.",
        "swallowing_education",
      ),
    ];
  }

  if (/\b(g93|encephalopathy|confusion|cognitive|mental status)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess mental status, orientation, safety awareness, and changes from baseline each visit.",
        "neurological_assessment",
      ),
      makeIntervention(
        "Teach caregiver to report acute confusion, decreased responsiveness, unsafe behavior, or other neurological changes.",
        "neurological_education",
      ),
    ];
  }

  if (/\b(m62|r53|weakness|fall|z91\.81|mobility|gait)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess strength, transfers, gait safety, assistive-device use, and fall-risk factors each visit.",
        "mobility_assessment",
      ),
      makeIntervention(
        "Teach fall-prevention measures, safe transfer technique, clear pathways, and proper use of ordered assistive devices.",
        "fall_prevention_education",
      ),
    ];
  }

  if (/\b(i50|heart failure|chf|i11|hypertensive heart)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess cardiopulmonary status, edema, weight trend, dyspnea, blood pressure, and medication response each visit.",
        "cardiac_assessment",
      ),
      makeIntervention(
        "Teach heart-failure zone guidance, low-sodium diet instructions as ordered, daily weight monitoring, and reportable symptoms.",
        "cardiac_education",
      ),
    ];
  }

  if (/\b(e11|diabetes|diabetic)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess blood-glucose monitoring, diet adherence, medication use, skin integrity, and symptoms of hypo- or hyperglycemia.",
        "diabetes_assessment",
      ),
      makeIntervention(
        "Teach diabetes self-management, glucose log review, foot care, medication adherence, and reportable blood-sugar parameters.",
        "diabetes_education",
      ),
    ];
  }

  if (/\b(n18|kidney|renal|ckd)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess fluid status, edema, blood pressure, medication adherence, and symptoms requiring provider notification.",
        "renal_assessment",
      ),
      makeIntervention(
        "Teach renal disease precautions, ordered diet or fluid instructions, medication safety, and follow-up lab/provider instructions.",
        "renal_education",
      ),
    ];
  }

  if (/\b(d63|anemia)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess fatigue, activity tolerance, dizziness, shortness of breath, and signs of worsening anemia each visit.",
        "anemia_assessment",
      ),
      makeIntervention(
        "Teach energy conservation, fall precautions related to weakness or dizziness, and reportable anemia symptoms.",
        "anemia_education",
      ),
    ];
  }

  if (/\b(i48|atrial fibrillation|anticoag)\b/i.test(normalized)) {
    return [
      makeIntervention(
        "Assess heart rate, rhythm-related symptoms, anticoagulant use if ordered, bleeding risk, and medication adherence each visit.",
        "arrhythmia_assessment",
      ),
      makeIntervention(
        "Teach bleeding precautions, medication adherence, and when to report palpitations, chest pain, dizziness, or bleeding.",
        "arrhythmia_education",
      ),
    ];
  }

  return [
    makeIntervention(
      `Assess patient status related to ${input.label}, response to the current plan, medication adherence, and changes requiring provider notification.`,
      "skilled_assessment",
      0.7,
    ),
    makeIntervention(
      `Teach patient and caregiver self-management for ${input.label}, including safety precautions, medication instructions, and reportable symptoms.`,
      "patient_caregiver_education",
      0.7,
    ),
  ];
}

async function writeDeterministicPlanOfCareReviewDraft(input: {
  outputDir: string;
  workItem: PatientEpisodeWorkItem;
  codingContext: {
    canonical: CanonicalDiagnosisExtraction;
    llmUsed: boolean;
    llmModel: string | null;
    llmError: string | null;
  };
}): Promise<string | null> {
  const diagnoses = input.codingContext.canonical.diagnosis_code_pairs
    .filter((pair) => pair.diagnosis.trim().length > 0 || pair.code)
    .slice(0, 8);
  if (diagnoses.length === 0) {
    return null;
  }

  const generatedAt = new Date().toISOString();
  const sourceHash = createHash("sha256")
    .update(JSON.stringify(diagnoses.map((pair) => ({ code: pair.code ?? null, diagnosis: pair.diagnosis.trim() }))))
    .digest("hex")
    .slice(0, 12);
  const pocSource = {
    sourceType: "generated_suggestion" as const,
    sourceLabel: "Suggested" as const,
    sourceHash,
    capturedAt: generatedAt,
  };
  const diagnosisDrafts = diagnoses.map((pair, index) => {
    const label = pair.diagnosis.trim() || pair.code || `Diagnosis ${index + 1}`;
    const diagnosisKey = `${pair.code ?? label}-${index}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return {
      diagnosisKey,
      diagnosisLabel: label,
      icdCode: pair.code ?? undefined,
      sourceType: pocSource.sourceType,
      sourceLabel: pocSource.sourceLabel,
      sourceHash: pocSource.sourceHash,
      capturedAt: pocSource.capturedAt,
      clinicalDomain: "general_skilled_need",
      selectedCandidateDomain: "general_skilled_need",
      domainMatchStatus: "weak_match",
      domainWarnings: ["Review deterministic Plan of Care draft before use."],
      problem: {
        selectedText: `Skilled need related to ${label}`,
        rationale: "Generated from extracted diagnosis context after OASIS review.",
        confidence: 0.72,
        evidenceFactIds: [`diagnosis:${diagnosisKey}`],
      },
      goal: {
        selectedText: `Patient will demonstrate stable status and safe self-management for ${label}.`,
        rationale: "General home health goal generated from diagnosis context.",
        confidence: 0.7,
        evidenceFactIds: [`diagnosis:${diagnosisKey}`],
      },
      interventions: buildPlanOfCareInterventionDrafts({
        label,
        code: pair.code ?? null,
        diagnosisKey,
      }),
      needsHumanReview: true,
      warnings: ["Review-only deterministic draft; not written to the portal."],
    };
  });

  const artifact = {
    schemaVersion: "plan-of-care-review-draft.v1",
    generatedAt,
    pocSource,
    sourcePriorityUsed: "coding_input_fallback",
    llmStatus: input.codingContext.llmUsed ? "success" : "disabled",
    llmModelId: input.codingContext.llmModel,
    llmErrorCategory: input.codingContext.llmError ? "coding_context_llm_error" : null,
    promptDiagnosisCount: diagnoses.length,
    llmTailoredDiagnosisCount: input.codingContext.llmUsed ? diagnoses.length : 0,
    diagnosisDrafts,
    summary: {
      diagnosisCount: diagnoses.length,
      draftedDiagnosisCount: diagnosisDrafts.length,
      needsReviewCount: diagnosisDrafts.length,
      lowConfidenceCount: diagnosisDrafts.length,
      missingCandidateCount: 0,
      sourcePriorityUsed: "coding_input_fallback",
      llmStatus: input.codingContext.llmUsed ? "success" : "disabled",
      promptDiagnosisCount: diagnoses.length,
      llmTailoredDiagnosisCount: input.codingContext.llmUsed ? diagnoses.length : 0,
      warnings: ["Review-only Plan of Care draft generated from diagnosis context."],
    },
    warnings: ["Review-only Plan of Care draft generated from diagnosis context."],
  };
  const artifactPath = path.join(input.outputDir, "patients", input.workItem.id, "plan-of-care-review-draft.json");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return artifactPath;
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

async function refreshSharedEvidenceDocumentText(input: {
  batchId: string;
  workItem: PatientEpisodeWorkItem;
  outputDir: string;
  artifacts: ArtifactRecord[];
  previousDocuments: ExtractedDocument[];
}): Promise<{
  extractedDocuments: ExtractedDocument[];
  documentTextExportPath: string;
}> {
  const refreshedDocuments = await extractDocumentsFromArtifacts(
    filterArtifactsForNonReferralTextExtraction(input.artifacts),
  );
  const extractedDocuments = mergeSharedEvidenceDocuments({
    previousDocuments: input.previousDocuments,
    refreshedDocuments,
  });
  const documentTextExport = await writeDocumentTextFile({
    outputDirectory: input.outputDir,
    patientId: input.workItem.id,
    batchId: input.batchId,
    extractedDocuments,
  });

  return {
    extractedDocuments,
    documentTextExportPath: documentTextExport.filePath,
  };
}

function buildExtractedDocumentKey(document: ExtractedDocument): string {
  const sourcePath =
    typeof document.metadata?.sourcePath === "string" ? document.metadata.sourcePath.trim().toLowerCase() : "";
  const portalLabel =
    typeof document.metadata?.portalLabel === "string" ? document.metadata.portalLabel.trim().toLowerCase() : "";
  const extractionSource =
    typeof document.metadata?.source === "string" ? document.metadata.source.trim().toLowerCase() : "";

  return [document.type, sourcePath, portalLabel, extractionSource].join("::");
}

function mergeSharedEvidenceDocuments(input: {
  previousDocuments: ExtractedDocument[];
  refreshedDocuments: ExtractedDocument[];
}): ExtractedDocument[] {
  const merged = new Map<string, ExtractedDocument>();

  for (const document of input.previousDocuments) {
    if (document.type === "OASIS") {
      continue;
    }
    merged.set(buildExtractedDocumentKey(document), document);
  }

  for (const document of input.refreshedDocuments) {
    merged.set(buildExtractedDocumentKey(document), document);
  }

  return Array.from(merged.values());
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

function partitionWorkItemsForPortalWorkers(
  workItems: PatientEpisodeWorkItem[],
  workerCount: number,
): PatientEpisodeWorkItem[][] {
  const boundedWorkerCount = Math.min(Math.max(1, workerCount), workItems.length);
  const partitions = Array.from({ length: boundedWorkerCount }, () => [] as PatientEpisodeWorkItem[]);
  workItems.forEach((workItem, index) => {
    partitions[index % boundedWorkerCount]!.push(workItem);
  });
  return partitions.filter((partition) => partition.length > 0);
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

function isTerminalProblemStatus(status: PatientRun["processingStatus"]): boolean {
  return ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(status);
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
  env?: FinaleBatchEnv,
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
    env,
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
  const workerCount = resolvePatientWorkerConcurrency(params, env);

  if (workerCount <= 1) {
    return executePatientWorkItemsSequential(params);
  }

  const chunks = splitWorkItemsForWorkers(params.workItems, workerCount);
  logger.info(
    {
      batchId: params.batchId,
      workItemCount: params.workItems.length,
      workerCount: chunks.length,
    },
    "starting portal patient worker pool",
  );

  const indexedRuns = (
    await Promise.all(
      chunks.map(async (chunk, workerIndex) => {
        const workerLogger = logger.child({
          portalWorkerIndex: workerIndex + 1,
          portalWorkerCount: chunks.length,
        });
        const runs = await executePatientWorkItemsSequential({
          ...params,
          workItems: chunk.map((entry) => entry.workItem),
          logger: workerLogger,
          portalClient: undefined,
        });

        return runs.map((run, runIndex) => ({
          index: chunk[runIndex]?.index ?? Number.MAX_SAFE_INTEGER,
          run,
        }));
      }),
    )
  ).flat();

  return indexedRuns
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.run);
}

async function executePatientWorkItemsSequential(
  params: ExecutePatientWorkItemsParams,
): Promise<PatientRun[]> {
  const env = loadEnv();
  const logger = params.logger ?? createLogger();
  const patientRuns: PatientRun[] = [];
  const selectedWorkflowDomains = resolveWorkflowDomains(params.workflowDomains);

  await mkdir(params.outputDir, { recursive: true });

  if (!params.skipStartupVerification) {
    try {
      await verifyDiagnosisCodingLlmAccess({
        env,
        logger,
      });
    } catch (error) {
      const llmStartupWarning = error instanceof Error ? error.message : String(error);
      logger.warn(
        {
          llmProvider: env.LLM_PROVIDER,
          codeLlmEnabled: env.CODE_LLM_ENABLED,
          warning: llmStartupWarning,
        },
        "Bedrock startup verification failed; continuing with per-patient fallback handling",
      );
    }
  }

  const portalPatientWorkerCount = params.portalClient
    ? 1
    : Math.min(env.PORTAL_PATIENT_WORKER_COUNT, Math.max(1, params.workItems.length));
  if (portalPatientWorkerCount > 1) {
    const partitions = partitionWorkItemsForPortalWorkers(params.workItems, portalPatientWorkerCount);
    logger.info(
      {
        batchId: params.batchId,
        totalWorkItems: params.workItems.length,
        portalPatientWorkerCount,
        partitionSizes: partitions.map((partition) => partition.length),
      },
      "parallel portal patient workers enabled",
    );

    const workerResults = await Promise.all(
      partitions.map((partition, workerIndex) => {
        const workerLogger = logger.child({
          portalPatientWorkerIndex: workerIndex + 1,
          portalPatientWorkerCount,
        });
        const workerPortalClient = new PlaywrightBatchQaWorker(
          resolvePortalRuntimeConfig({
            env,
            providedRuntimeConfig: params.subsidiaryRuntimeConfig,
            fallbackSubsidiaryId: partition[0]?.subsidiaryId,
          }),
          env,
          workerLogger,
        );
        return executePatientWorkItems({
          ...params,
          workItems: partition,
          logger: workerLogger,
          portalClient: workerPortalClient,
          skipStartupVerification: true,
        });
      }),
    );
    const runsByWorkItemId = new Map(
      workerResults.flat().map((patientRun) => [patientRun.workItemId, patientRun]),
    );
    return params.workItems
      .map((workItem) => runsByWorkItemId.get(workItem.id))
      .filter((patientRun): patientRun is PatientRun => Boolean(patientRun));
  }

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
      await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
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
      const timing = createPatientRunTimingTracker();

      await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);

      try {
        const evidenceDir = path.join(params.outputDir, "evidence", workItem.id);
        const sharedAccess = await timing.time("portal_lookup", () => executeSharedPortalAccessWorkflow({
          batchId: params.batchId,
          patientRunId: run.runId,
          workflowDomains: selectedWorkflowDomains,
          workItem,
          evidenceDir,
          portalClient,
          logger,
        }));
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
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
          continue;
        }
        if (run.matchResult.status === "EXACT" && sharedAccess.portalContexts.length > 0) {
          const sharedEvidenceContext =
            sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === "coding") ??
            sharedAccess.portalContexts[0]!;
          run.processingStatus = "COLLECTING_EVIDENCE";
          run.executionStep = "COLLECTING_EVIDENCE";
          run.progressPercent = Math.max(run.progressPercent, 35);
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
          const sharedEvidenceResult = await timing.time("shared_evidence", () => runSharedEvidenceWorkflow({
            context: sharedEvidenceContext,
            workItem,
            evidenceDir,
            outputDir: params.outputDir,
            env,
            logger,
            portalClient,
            fileUploadsDiscoveryEnabled: params.stopAfterSharedEvidence === true,
          }));
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

          const liveReferralDocumentCheckEnabled = params.stopAfterSharedEvidence === true;
          const referralDocumentAvailable = liveReferralDocumentCheckEnabled
            ? hasReferralDocumentEvidence({
                artifacts: sharedEvidenceResult.sharedEvidence.artifacts,
                documentInventory: sharedEvidenceResult.sharedEvidence.documentInventory,
                extractedDocuments: sharedEvidenceResult.sharedEvidence.extractedDocuments,
              })
            : true;
          const missingReferralDocumentReviewMessage = liveReferralDocumentCheckEnabled && !referralDocumentAvailable
            ? "Referral/admission-order document text was not found in shared evidence."
            : null;
          if (liveReferralDocumentCheckEnabled) {
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "referral_document_check",
              message: referralDocumentAvailable
                ? "Referral/admission-order evidence was found in shared chart documents."
                : "Referral/admission-order evidence was not found in shared chart documents.",
              patientName: run.patientName,
              found: [
                `artifactOrderCount:${sharedEvidenceResult.sharedEvidence.artifacts.filter((artifact) => artifact.artifactType === "PHYSICIAN_ORDERS").length}`,
                `inventoryOrderCount:${sharedEvidenceResult.sharedEvidence.documentInventory.filter((item) => item.normalizedType === "ORDER").length}`,
                `extractedOrderCount:${sharedEvidenceResult.sharedEvidence.extractedDocuments.filter((document) => document.type === "ORDER" && document.text.trim().length > 0).length}`,
              ],
              missing: referralDocumentAvailable ? [] : ["Referral/admission-order source document"],
              evidence: sharedEvidenceResult.sharedEvidence.extractedDocuments
                .filter((document) => document.type === "ORDER")
                .slice(0, 4)
                .map((document) =>
                  `${document.metadata.portalLabel ?? "ORDER"}:${document.metadata.sourcePath ?? "in_memory"}:${document.text.slice(0, 180)}`),
              safeReadConfirmed: true,
            })]);
          } else {
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "referral_document_check_skipped_static_intake",
              message:
                "Skipped referral/admission-order File Uploads check during live OASIS, Plan of Care, and Visit Notes automation; referral documents are processed by static referral intake.",
              patientName: run.patientName,
              found: ["static_referral_intake_required=true"],
              missing: [],
              evidence: [],
              safeReadConfirmed: true,
            })]);
          }

          const referralDirectDocumentNeedsReview =
            sharedEvidenceResult.sharedEvidence.referralDocumentProcessing?.extractionResult.extractionSuccess === false;
          if (referralDirectDocumentNeedsReview) {
            const reviewMessage =
              "Referral direct-document LLM extraction did not produce source-backed clinical facts; patient requires human review.";
            run.qaOutcome = "NEEDS_MANUAL_QA";
            run.processingStatus = "NEEDS_HUMAN_REVIEW";
            run.executionStep = "REFERRAL_DIRECT_DOCUMENT_REVIEW";
            run.errorSummary = reviewMessage;
            run.notes.push(reviewMessage);
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "referral_direct_document_review_required",
              message: reviewMessage,
              patientName: run.patientName,
              found: [
                sharedEvidenceResult.sharedEvidence.referralDocumentProcessing?.artifacts.qaDocumentSummaryPath ??
                  "referral-direct-document-review",
              ],
              missing: ["source-backed direct-document referral facts"],
              evidence: sharedEvidenceResult.sharedEvidence.referralDocumentProcessing?.qaDocumentSummary.warnings.slice(0, 8) ?? [],
              safeReadConfirmed: true,
            })]);
          }

          if (params.stopAfterSharedEvidence) {
            run.qaOutcome = referralDocumentAvailable ? "NEEDS_MANUAL_QA" : "MISSING_DOCUMENTS";
            run.processingStatus = referralDirectDocumentNeedsReview
              ? "NEEDS_HUMAN_REVIEW"
              : referralDocumentAvailable
                ? "COMPLETE"
                : "BLOCKED";
            run.executionStep = referralDocumentAvailable
              ? referralDirectDocumentNeedsReview
                ? "REFERRAL_DIRECT_DOCUMENT_REVIEW"
                : "REFERRAL_DOCUMENT_ACQUIRED"
              : "REFERRAL_DOCUMENT_REQUIRED";
            run.progressPercent = 100;
            run.errorSummary = referralDocumentAvailable
              ? referralDirectDocumentNeedsReview
                ? run.errorSummary
                : null
              : "Referral/admission-order document text was not found in shared evidence.";
              run.oasisQaSummary = buildOasisQaSummary({
                workItem,
                matchResult: run.matchResult,
                artifacts: run.artifacts,
                processingStatus: run.processingStatus,
              documentInventory: run.documentInventory,
            });
            await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
            continue;
          }

          if (missingReferralDocumentReviewMessage) {
            run.notes.push(missingReferralDocumentReviewMessage!);
            appendAutomationLogs(run, [createAutomationStepLog({
              step: "referral_document_review_required",
              message: missingReferralDocumentReviewMessage!,
              patientName: run.patientName,
              found: [],
              missing: ["Referral/admission-order source document"],
              evidence: sharedEvidenceResult.sharedEvidence.extractedDocuments
                .filter((document) => document.type === "ORDER")
                .slice(0, 4)
                .map((document) =>
                  `${document.metadata.portalLabel ?? "ORDER"}:${document.metadata.sourcePath ?? "in_memory"}:${document.text.slice(0, 180)}`),
              safeReadConfirmed: true,
            })]);
          }

          const qaPortalContext = sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === "qa");
          if (qaPortalContext) {
            run.processingStatus = "RUNNING_QA";
            run.executionStep = "RUNNING_QA";
            run.progressPercent = Math.max(run.progressPercent, 70);
            await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
            const qaResult = await timing.time("oasis_dom_and_qa", () => runQaWorkflowOrchestrator({
              context: qaPortalContext,
              run,
              workItem,
              evidenceDir,
              outputDir: params.outputDir,
              logger,
              portalClient,
              sharedEvidence: sharedEvidenceResult.sharedEvidence,
              targetOasisAssessmentId: params.targetOasisAssessmentId ?? null,
            }));
            run.artifacts = replaceRunOasisArtifactWithPrintedNoteReview({
              artifacts: run.artifacts,
              printedNoteReview: qaResult.result.printedNoteReview,
            });
            sharedEvidenceResult.sharedEvidence.artifacts = run.artifacts;
            appendAutomationLogs(run, qaResult.stepLogs);
            run.notes.push(`QA prefetch result persisted: ${qaResult.workflowResultPath}`);

            const printedNoteReview = qaResult.result.printedNoteReview;
            if (printedNoteReview) {
              try {
                const refreshedSharedEvidence = await refreshSharedEvidenceDocumentText({
                  batchId: qaPortalContext.batchId,
                  workItem,
                  outputDir: params.outputDir,
                  artifacts: run.artifacts,
                  previousDocuments: sharedEvidenceResult.sharedEvidence.extractedDocuments,
                });
                sharedEvidenceResult.sharedEvidence.extractedDocuments = refreshedSharedEvidence.extractedDocuments;
                sharedEvidenceResult.sharedEvidence.documentTextExportPath =
                  refreshedSharedEvidence.documentTextExportPath;
                sharedEvidenceResult.sharedEvidence.documentTextExportError = null;
                run.notes.push(
                  `Document text refreshed after printed OASIS review: ${refreshedSharedEvidence.documentTextExportPath}`,
                );
                appendAutomationLogs(run, [createAutomationStepLog({
                  step: "document_text_refresh_after_qa",
                  message: "Refreshed document-text.json after the QA printed-note review replaced the shared OASIS artifact.",
                  patientName: run.patientName,
                  found: [
                    `documentTextPath=${refreshedSharedEvidence.documentTextExportPath}`,
                    `documentCount=${refreshedSharedEvidence.extractedDocuments.length}`,
                    `oasisDocumentCount=${refreshedSharedEvidence.extractedDocuments.filter((document) => document.type === "OASIS").length}`,
                    `orderDocumentCount=${refreshedSharedEvidence.extractedDocuments.filter((document) => document.type === "ORDER").length}`,
                  ],
                  missing: [],
                  evidence: refreshedSharedEvidence.extractedDocuments
                    .slice(0, 4)
                    .map((document, index) =>
                      `[${index}] ${document.type}:${document.metadata.sourcePath ?? document.metadata.portalLabel ?? "in_memory"}:${document.metadata.textLength ?? document.text.length}`),
                  safeReadConfirmed: true,
                })]);
              } catch (error) {
                const refreshError = error instanceof Error ? error.message : String(error);
                sharedEvidenceResult.sharedEvidence.documentTextExportError = refreshError;
                run.notes.push(`Document text refresh after printed OASIS review failed: ${refreshError}`);
                appendAutomationLogs(run, [createAutomationStepLog({
                  step: "document_text_refresh_after_qa",
                  message: "Refreshing document-text.json after QA failed; continuing with the earlier shared-evidence export.",
                  patientName: run.patientName,
                  found: [],
                  missing: ["refreshed document-text.json after QA"],
                  evidence: [refreshError],
                  safeReadConfirmed: true,
                })]);
              }

              const printedNoteChartValues = await timing.time("printed_oasis_chart_values", () => extractCurrentChartValuesFromPrintedNote({
                env,
                logger,
                outputDir: params.outputDir,
                workItem,
                extractedTextPath: printedNoteReview.capture.extractedTextPath,
              }));
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
                run.notes.push(
                  "Referral comparison refresh skipped during live automation; referral files are processed by static referral intake.",
                );
                appendAutomationLogs(run, [createAutomationStepLog({
                  step: "static_referral_intake_deferred",
                  message:
                    "Skipped referral comparison refresh during live automation because referral documents are now handled by static referral intake.",
                  patientName: run.patientName,
                  found: [
                    `printedNoteFieldCount=${printedNoteChartValues.extractedFieldCount}`,
                  ],
                  missing: [],
                  evidence: [],
                  safeReadConfirmed: true,
                })]);
              }
            }
            const portalPlanOfCareDraftPath = await timing.time("plan_of_care", () => writePortalCarePlanDraftFromOasisDom({
              outputDir: params.outputDir,
              workItem,
            }));
            const planOfCareDraftPath = portalPlanOfCareDraftPath ?? await timing.time("plan_of_care", () => writeDeterministicPlanOfCareReviewDraft({
              outputDir: params.outputDir,
              workItem,
              codingContext: sharedEvidenceResult.sharedEvidence.diagnosisCodingContext,
            }));
            if (planOfCareDraftPath) {
              run.notes.push(
                portalPlanOfCareDraftPath
                  ? `Existing OASIS Plan of Care draft persisted from portal DOM: ${planOfCareDraftPath}`
                  : `Plan of Care review draft persisted: ${planOfCareDraftPath}`,
              );
              appendAutomationLogs(run, [createAutomationStepLog({
                step: "plan_of_care_review_draft",
                message: portalPlanOfCareDraftPath
                  ? "Captured existing OASIS Plan of Care from portal DOM; skipped generated Plan of Care draft."
                  : "Generated a review-only Plan of Care draft from diagnosis context after OASIS review.",
                patientName: run.patientName,
                found: [planOfCareDraftPath],
                evidence: [
                  "review_only=true",
                  portalPlanOfCareDraftPath ? "source=oasis_portal_care_plan" : "source=diagnosis_context",
                ],
                safeReadConfirmed: true,
              })]);
            }

            if (!planOfCareDraftPath) {
              appendAutomationLogs(run, [createAutomationStepLog({
                step: "visit_notes_discovery_skipped_pending_plan_of_care",
                message: "Skipped Visit Notes discovery because no Plan of Care review artifact exists yet.",
                patientName: run.patientName,
                found: [],
                missing: ["plan-of-care-review-draft.json"],
                evidence: ["poc_to_visit_notes_gate=true"],
                safeReadConfirmed: true,
              })]);
              run.notes.push("Visit Notes discovery skipped until Plan of Care review is available.");
            } else if (env.VISIT_NOTES_DOM_EXTRACTION_ENABLED && typeof portalClient.discoverVisitNotesForReview === "function") {
              try {
                const visitNotesResult = await timing.time("visit_notes_dom_and_llm", () => portalClient.discoverVisitNotesForReview!({
                  context: qaPortalContext,
                  workItem,
                  patientArtifactsDirectory: path.join(params.outputDir, "patients", workItem.id),
                  evidenceDir,
                  episode: qaResult.result.episodeSelection.selectedRange
                    ? {
                        label: qaResult.result.episodeSelection.selectedRange.rawLabel,
                        startDate: qaResult.result.episodeSelection.selectedRange.startDate ?? undefined,
                        endDate: qaResult.result.episodeSelection.selectedRange.endDate ?? undefined,
                      }
                    : undefined,
                  captureVisitNotesLimit: env.VISIT_NOTE_CAPTURE_MAX_NOTES,
                  forceRerunVisitNotes: false,
                }));
                appendAutomationLogs(run, visitNotesResult.stepLogs);
                run.notes.push(`Visit Notes DOM discovery persisted: ${visitNotesResult.discoveryPath}`);
              } catch (error) {
                const visitNotesError = error instanceof Error ? error.message : String(error);
                appendAutomationLogs(run, [createAutomationStepLog({
                  step: "visit_notes_discovery",
                  message: "Visit Notes DOM discovery failed without interrupting the patient run.",
                  patientName: run.patientName,
                  found: [],
                  missing: ["visit-notes-discovery.json"],
                  evidence: [visitNotesError.slice(0, 240)],
                  safeReadConfirmed: true,
                })]);
                run.notes.push(`Visit Notes DOM discovery failed: ${visitNotesError}`);
              }
            } else {
              appendAutomationLogs(run, [createAutomationStepLog({
                step: "visit_notes_discovery_skipped",
                message: "Skipped Visit Notes discovery because DOM extraction is disabled or unsupported.",
                patientName: run.patientName,
                found: [],
                missing: ["visit-notes-discovery.json"],
                evidence: [`VISIT_NOTES_DOM_EXTRACTION_ENABLED=${String(env.VISIT_NOTES_DOM_EXTRACTION_ENABLED)}`],
                safeReadConfirmed: true,
              })]);
              run.notes.push("Visit Notes DOM discovery skipped because the portal client does not support it or the feature is disabled.");
            }
          }

          const codingPortalContext = sharedAccess.portalContexts.find((portalContext) => portalContext.workflowDomain === "coding");
          if (codingPortalContext) {
            const codingResult = await timing.time("coding_export", () => runCodingWorkflowOrchestrator({
              context: codingPortalContext,
              run,
              workItem,
              sharedEvidence: sharedEvidenceResult.sharedEvidence,
              outputDir: params.outputDir,
              logger,
              emitRunUpdate: async () => {
                await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
              },
            }));
            appendAutomationLogs(run, codingResult.stepLogs);
            const codingWorkflowRun = findWorkflowRun(run.workflowRuns, "coding");
            codingInputExportPath = codingWorkflowRun?.workflowResultPath ?? codingInputExportPath;
          }

          if (
            missingReferralDocumentReviewMessage &&
            !isTerminalProblemStatus(run.processingStatus)
          ) {
            run.qaOutcome = "NEEDS_MANUAL_QA";
            run.processingStatus = "NEEDS_HUMAN_REVIEW";
            run.executionStep = "REFERRAL_DOCUMENT_REQUIRED_REVIEW";
            run.progressPercent = 100;
            run.errorSummary = missingReferralDocumentReviewMessage;
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
          await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
        }

        if (
          !selectedWorkflowDomains.includes("coding") &&
          run.matchResult.status === "EXACT" &&
          !isTerminalProblemStatus(run.processingStatus)
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
        try {
          const { filePath: cacheSummaryPath, summary: cacheSummary } = await writePatientRunCacheSummary({
            outputDirectory: params.outputDir,
            run,
            stageTimings: timing.stageTimings,
            startedAtMs: timing.startedAtMs,
          });
          run.notes.push(`${formatPatientRunTimingSummary(cacheSummary)}; cacheSummary=${cacheSummaryPath}`);
          appendAutomationLogs(run, [createAutomationStepLog({
            step: "incremental_reuse_summary",
            message: formatPatientRunTimingSummary(cacheSummary),
            patientName: run.patientName,
            found: [
              `cacheSummaryPath=${cacheSummaryPath}`,
              `referral=${cacheSummary.reuseSummary.referral}`,
              `visitNotesProcessed=${cacheSummary.visitNotes.processed}`,
              `visitNotesReused=${cacheSummary.visitNotes.reused}`,
            ],
            evidence: timing.stageTimings.map((stage) => `${stage.stage}:${stage.durationMs}ms`),
            safeReadConfirmed: true,
          })]);

        } catch (error) {
          const cacheSummaryError = error instanceof Error ? error.message : String(error);
          run.notes.push(`Incremental run cache summary failed: ${cacheSummaryError}`);
          appendAutomationLogs(run, [createAutomationStepLog({
            step: "incremental_reuse_summary",
            message: "Incremental run cache summary failed.",
            patientName: run.patientName,
            missing: ["patient-run-cache-summary.json"],
            evidence: [cacheSummaryError],
            safeReadConfirmed: true,
          })]);
        }
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
        await emitPatientRunUpdate(run, params.outputDir, params.onPatientRunUpdate, env);
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
          stopAfterSharedEvidence: params.stopAfterSharedEvidence,
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
