import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AgencyDashboardSnapshot,
  Agency,
  BatchManifest,
  BatchSummary,
  ConciseQaIssue,
  DashboardPatientRecord,
  PatientDashboardState,
  ParserException,
  PatientRunCacheSummary,
  PatientQueueArtifact,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientRunLog,
  PatientRun,
  ReviewWindow,
  SubsidiaryRuntimeConfig,
  SubsidiaryRecord,
  WorkbookSource,
} from "@medical-ai-qa/shared-types";
import { extractPortalPatientLookupContext } from "@medical-ai-qa/shared-types";
import {
  buildOasisQaSummary,
  createBatchSummary,
  createReviewWindow,
  createDefaultWorkflowRuns,
  executePatientWorkItems,
  intakeWorkbook,
  persistBatchSummary,
  loadEnv,
  capturePatientReferralFiles,
  capturePatientPortalStatusSnapshot,
  buildOasisInternalMismatchReview,
  REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION,
  runReferralDocumentProcessingPipeline,
  writePatientDashboardState,
  type ChartSnapshotValueSource,
  type OasisDomSectionOutputsArtifact,
  type OasisInternalMismatchReviewResult,
  type OasisMggFieldSnapshotArtifact,
  type PatientPortalStatusSnapshot,
  type ReferralDirectDocumentExtractionResult,
  type ReferralSourceDocumentInput,
  type SourceDocumentArtifact,
} from "@medical-ai-qa/finale-workbook-intake";
import type { Logger } from "pino";
import type { WorkbookAcquisitionService } from "../acquisition/workbookAcquisitionService";
import type { ManualUploadWorkbookInput } from "../acquisition/manualUploadWorkbookProvider";
import type { WorkbookAcquisitionProviderId } from "../acquisition/workbookAcquisitionProvider";
import type { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import type { FilesystemScheduledRunRepository } from "../repositories/filesystemScheduledRunRepository";
import type { BatchRecord } from "../types/batchControlPlane";
import type { ScheduledRunRecord } from "../types/scheduledRun";
import { writeJsonFile } from "../utils/jsonFile";
import {
  DEFAULT_DELTA_RUN_WEEKDAYS,
  DEFAULT_WORKBOOK_INTAKE_DAY,
  DEFAULT_WORKBOOK_INTAKE_LOCAL_TIME,
  calculateNextWeekdayDeltaRunAt,
  calculateNextWorkbookIntakeAt,
  earliestTimestamp,
  type WeekdayName,
} from "../utils/workbookSchedule";
import {
  WORK_ITEM_FINGERPRINT_SCHEMA_VERSION,
  buildWorkItemFingerprint,
  type WorkItemFingerprint,
} from "../utils/workItemFingerprint";
import {
  AmbiguousPatientMemoryIdentityError,
  type PatientMemoryService,
} from "./patientMemoryService";
import type { SubsidiaryConfigService } from "./subsidiaryConfigService";
import { toDashboardPatientSummary } from "../mappers/dashboardRunViews";

const DEFAULT_RERUN_INTERVAL_HOURS = 24;
const SCHEDULE_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REFRESH_TIMEZONE = "Asia/Manila";
const DEFAULT_REFRESH_LOCAL_TIMES = ["20:30"] as const;
const DEFAULT_REQUIRED_MEMORY_ARTIFACTS = [
  "patient-dashboard-state.json",
  "qa-prefetch-result.json",
  "patient-run-cache-summary.json",
] as const;
const WORK_ITEM_FINGERPRINT_FILE_NAME = "work-item-fingerprint.json";
const REFERRAL_MEMORY_ARTIFACTS = [
  path.join("referral-document-processing", "patient-qa-reference.json"),
  path.join("referral-document-processing", "qa-document-summary.json"),
  path.join("referral-document-processing", "field-map-snapshot.json"),
  path.join("referral-document-processing", "extracted-facts.json"),
] as const;
const OASIS_MEMORY_ARTIFACTS = [
  "printed-note-chart-values.json",
  "oasis-printed-note-review.json",
  "oasis-dom-extracted-state.json",
  "oasis-dom-acquisition-state.json",
  "oasis-dom-vs-existing-extraction-comparison.json",
  "oasis-dom-section-processing-manifest.json",
  "oasis-dom-section-outputs.json",
  "oasis-assessment-processing-manifest.json",
  "oasis-mgg-field-snapshot.json",
  "canonical-oasis-document.json",
  "canonical-oasis-section-index.json",
  "canonical-oasis-section-hashes.json",
  "canonical-oasis-structured.json",
  "oasis-clinical-fact-pack.json",
] as const;
const PLAN_VISIT_MEMORY_ARTIFACTS = [
  "plan-of-care-review-draft.json",
  "plan-of-care-review-summary.json",
  "generated-plan-of-care.json",
  "visit-notes-discovery.json",
  "visit-note-processing-manifest.json",
  "visit-note-fact-pack.json",
  "visit-note-qa-review.json",
] as const;
const DASHBOARD_REVIEWER_STATUS_FILE_NAME = "dashboard-reviewer-statuses.json";
const POST_BATCH_REFERRAL_INTAKE_SUMMARY_FILE_NAME = "post-batch-referral-intake-summary.json";
const CLINICAL_REFRESH_STATE_FILE_NAME = "clinical-refresh-state.json";
const PATIENT_PORTAL_STATUS_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const REFERRAL_INTAKE_ACTIVE_PATIENT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const REFERRAL_INTAKE_ACTIVE_PATIENT_WAIT_INTERVAL_MS = 5_000;
const CLINICAL_REFRESH_PROMOTION_EXCLUDED_PATHS = new Set([
  "patient-dashboard-state.json",
  CLINICAL_REFRESH_STATE_FILE_NAME,
  "referral-intake-state.json",
  "referral-source-documents-manifest.json",
  "referral-document-results-manifest.json",
  "oasis-check-state.json",
]);
const CLINICAL_REFRESH_PROMOTION_EXCLUDED_DIRECTORIES = new Set([
  "referral-document-processing",
]);

type RunControlOptions = {
  mode?: "delta" | "full";
  reprojectOnly?: boolean;
  forceStages?: Array<"referral" | "oasis" | "poc" | "visit_notes" | "dashboard">;
};

type ReferralIntakeStatus = "idle" | "pending" | "running" | "completed" | "failed";
type ReferralIntakeExecutionTrigger = "manual" | "post_batch";
type OasisCheckJobStatus = "idle" | "pending" | "running" | "completed" | "failed";
type ClinicalRefreshStatus = "idle" | "pending" | "running" | "completed" | "failed";

type ReferralSourceDocumentManifestEntry = {
  documentId: string;
  title: string | null;
  documentDate?: string | null;
  sourceLabel: string | null;
  sourcePath: string | null;
  extractedTextPath: string | null;
  portalLabel: string | null;
  acquisitionMethod: string | null;
  sourceContentHash?: string | null;
  contentType?: string | null;
  captureStatus?: string | null;
  processStatus?: string | null;
  error?: string | null;
  notes?: string[];
};

type ReferralSourceDocumentsManifest = {
  schemaVersion: "referral-source-documents-manifest.v1";
  batchId: string;
  patientId: string;
  generatedAt: string;
  source: string;
  documents: ReferralSourceDocumentManifestEntry[];
};

type ReferralDocumentResultsManifestEntry = {
  documentId: string;
  title: string | null;
  sourceLabel: string | null;
  sourcePath: string | null;
  sourceContentHash: string | null;
  status: "processed" | "reused" | "failed" | "skipped";
  processedAt: string;
  artifactDirectory: string | null;
  selectedDocumentId: string | null;
  extractionUsabilityStatus: string | null;
  error: string | null;
};

type ReferralDocumentResultsManifest = {
  schemaVersion: "referral-document-results-manifest.v1";
  batchId: string;
  patientId: string;
  generatedAt: string;
  defaultReferralDocumentId: string | null;
  documents: ReferralDocumentResultsManifestEntry[];
};

type ResolvedOasisCheckAssessment = {
  assessmentId: string;
  assessmentType: string | null;
  title: string | null;
  date: string | null;
  sourceRowText: string | null;
  artifactDirectory: string;
  sectionOutputsPath: string | null;
  domStatePath: string | null;
  mggSnapshotPath: string | null;
};

type ReferralDirectDocumentCacheMetadata = {
  schemaVersion: "referral-direct-document-cache-metadata.v1";
  patientId: string;
  documentId: string;
  sourceContentHash: string;
  promptVersion: string;
  modelId: string;
  extractionMode: "direct_document_llm_only";
  directDocumentResultPath: string;
  generatedAt: string;
};

export type ReferralIntakeState = {
  schemaVersion: "referral-intake-state.v1";
  batchId: string;
  patientId: string;
  status: ReferralIntakeStatus;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  processedCount: number;
  reusedCount: number;
  newOrChangedCount: number;
  failedCount: number;
  skippedCount: number;
  documentCount: number;
  sourceDocumentCount: number;
  statusUrl: string;
  message: string | null;
};

export type PatientOasisCheckAssessmentState = {
  assessmentId: string;
  status: OasisCheckJobStatus;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  resultPath: string | null;
  statusUrl: string;
  message: string | null;
  result: OasisInternalMismatchReviewResult | null;
};

export type PatientOasisCheckState = {
  schemaVersion: "oasis-check-state.v1";
  batchId: string;
  patientId: string;
  updatedAt: string;
  checks: Record<string, PatientOasisCheckAssessmentState>;
};

export type PatientClinicalRefreshState = {
  schemaVersion: "clinical-refresh-state.v1";
  batchId: string;
  patientId: string;
  refreshId: string | null;
  targetOasisAssessmentId: string | null;
  status: ClinicalRefreshStatus;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  attemptOutputRoot: string | null;
  promotedAt: string | null;
  statusUrl: string;
  message: string | null;
  reuseSummary: PatientRunCacheSummary["reuseSummary"] | null;
  preflight: {
    ok: boolean;
    checkedAt: string;
    reasons: string[];
    portalCredentialsConfigured: boolean;
    portalDashboardUrlConfigured: boolean;
  } | null;
};

type PostBatchReferralIntakePatientResult = {
  patientId: string;
  patientName: string;
  status: "processed" | "failed" | "skipped";
  referralIntakeStatus: ReferralIntakeStatus | null;
  processedCount: number;
  reusedCount: number;
  newOrChangedCount: number;
  failedCount: number;
  skippedCount: number;
  documentCount: number;
  sourceDocumentCount: number;
  reason: string | null;
  error: string | null;
};

type PostBatchReferralIntakeSummary = {
  schemaVersion: "post-batch-referral-intake-summary.v1";
  batchId: string;
  subsidiaryId: string;
  trigger: "post_batch";
  reason: string;
  startedAt: string;
  completedAt: string;
  processedPatientCount: number;
  failedPatientCount: number;
  skippedPatientCount: number;
  documentCount: number;
  sourceDocumentCount: number;
  results: PostBatchReferralIntakePatientResult[];
};

type ClinicalRefreshJobRunnerInput = {
  batchId: string;
  patientId: string;
  targetOasisAssessmentId: string | null;
  workItem: PatientEpisodeWorkItem;
  attemptOutputRoot: string;
  subsidiaryRuntimeConfig: SubsidiaryRuntimeConfig;
  onPatientRunUpdate: (patientRun: PatientRun) => Promise<void> | void;
};

export class ReferralIntakeAlreadyRunningError extends Error {
  constructor(batchId: string, patientId: string) {
    super(`Referral intake is already running for patient ${patientId} in batch ${batchId}.`);
    this.name = "ReferralIntakeAlreadyRunningError";
  }
}

export class OasisCheckAlreadyRunningError extends Error {
  constructor(batchId: string, patientId: string, assessmentId: string) {
    super(`OASIS check is already running for assessment ${assessmentId} on patient ${patientId} in batch ${batchId}.`);
    this.name = "OasisCheckAlreadyRunningError";
  }
}

export class ClinicalRefreshAlreadyRunningError extends Error {
  constructor(patientId: string) {
    super(`Clinical refresh is already running for patient ${patientId}.`);
    this.name = "ClinicalRefreshAlreadyRunningError";
  }
}

type BatchControlPlaneOptions = {
  patientMemoryWriteEnabled?: boolean;
  deltaReuseEnabled?: boolean;
  autonomousMode?: "full" | "manual_only";
  scheduleLocalTimes?: readonly string[];
  workbookIntakeDay?: WeekdayName;
  workbookIntakeLocalTime?: string;
  deltaRunWeekdays?: readonly WeekdayName[];
  referralIntakeJobRunner?: (input: {
    batchId: string;
    patientId: string;
    patientArtifactsDirectory: string;
    workItem: PatientEpisodeWorkItem;
    trigger: ReferralIntakeExecutionTrigger;
  }) => Promise<ReferralIntakeState | void>;
  clinicalRefreshJobRunner?: (input: ClinicalRefreshJobRunnerInput) => Promise<PatientRun>;
};

type CreateBatchFromProviderParams = {
  providerId: WorkbookAcquisitionProviderId;
  billingPeriod?: string | null;
  originalFileName?: string | null;
  subsidiaryId?: string | null;
  input: ManualUploadWorkbookInput | { exportName?: string | null };
};

type BatchRunStartOptions = {
  allowActiveJob?: boolean;
};

type ReusablePatientRunOutcome = {
  processingStatus?: string | null;
  executionStep?: string | null;
  errorSummary?: string | null;
  qaOutcome?: string | null;
  matchResult?: {
    status?: string | null;
  } | null;
};

function isVisitNotesArtifactReprocessRequest(options: RunControlOptions): boolean {
  const forceStages = new Set(options.forceStages ?? []);
  return (
    options.mode !== "full" &&
    forceStages.has("visit_notes") &&
    [...forceStages].every((stage) => stage === "visit_notes" || stage === "dashboard")
  );
}

function isArtifactOnlyClinicalReprocessRequest(options: RunControlOptions): boolean {
  const forceStages = new Set(options.forceStages ?? []);
  return (
    options.mode !== "full" &&
    (forceStages.has("referral") || forceStages.has("visit_notes")) &&
    [...forceStages].every((stage) => stage === "referral" || stage === "visit_notes" || stage === "dashboard")
  );
}

function shouldReprocessReferral(options: RunControlOptions): boolean {
  return new Set(options.forceStages ?? []).has("referral");
}

function shouldReprocessVisitNotes(options: RunControlOptions): boolean {
  return new Set(options.forceStages ?? []).has("visit_notes");
}

function isStatusOnlyQueueStatus(status: PatientQueueArtifact["entries"][number]["status"] | undefined): boolean {
  return status === "skipped_pending" || status === "skipped_non_admit";
}

function isStatusOnlyExcludedPatientRun(patientRun: ReusablePatientRunOutcome | undefined): boolean {
  if (!patientRun) {
    return false;
  }
  if (patientRun.executionStep === "PATIENT_STATUS_EXCLUDED") {
    return true;
  }
  return /Portal patient status '\s*(?:Pending|Non[-\s]?Admit)/i.test(patientRun.errorSummary ?? "");
}

function isReusableNoMatchPatientRun(patientRun: ReusablePatientRunOutcome | undefined): boolean {
  return Boolean(
    patientRun &&
    patientRun.matchResult?.status === "NOT_FOUND" &&
    patientRun.qaOutcome === "PORTAL_NOT_FOUND" &&
    patientRun.processingStatus === "BLOCKED",
  );
}

function isReusablePatientRunOutcome(patientRun: ReusablePatientRunOutcome | undefined): boolean {
  return Boolean(
    patientRun &&
    (patientRun.processingStatus === "COMPLETE" ||
      isStatusOnlyExcludedPatientRun(patientRun) ||
      isReusableNoMatchPatientRun(patientRun)),
  );
}

function createBatchId(subsidiarySlug?: string): string {
  const slugPrefix = subsidiarySlug?.trim() ? `${subsidiarySlug.trim()}-` : "";
  return `batch-${slugPrefix}${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function createRunId(batchId: string, workItemId: string): string {
  return `${batchId}-${workItemId}`;
}

function createPlaceholderMatchResult(patientName: string): PatientMatchResult {
  return {
    status: "NOT_FOUND",
    searchQuery: patientName,
    portalPatientId: null,
    portalDisplayName: null,
    candidateNames: [],
    note: "Patient has not been processed yet.",
  };
}

function isTransientPatientStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["PENDING", "MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
    status,
  );
}

function isActivePatientChartWorkStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(status);
}

function isRetryEligibleStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(status);
}

function getSubsidiaryLookupKeys(
  subsidiary: Pick<SubsidiaryRecord, "id" | "slug" | "lookupAliases">,
): Set<string> {
  return new Set([subsidiary.id, subsidiary.slug, ...subsidiary.lookupAliases].filter(Boolean));
}

function batchBelongsToSubsidiary(
  batch: BatchRecord,
  subsidiary: Pick<SubsidiaryRecord, "id" | "slug" | "lookupAliases">,
): boolean {
  const lookupKeys = getSubsidiaryLookupKeys(subsidiary);
  return lookupKeys.has(batch.subsidiary.id) || lookupKeys.has(batch.subsidiary.slug);
}

const ISSUE_SEVERITY_RANK: Record<ConciseQaIssue["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CLINICALLY_IMPORTANT_OASIS_FIELD_PATTERN =
  /\b(?:diagnos|m10|vital|temperature|pulse|blood pressure|respir|oxygen|o2|pain|medication|allerg|wound|incision|skin|fall|mahc|m1033|risk|orientation|mental|cognitive|appetite|nutrition|toilet|bathing|dressing|transfer|ambulat|mobility|gg0130|gg0170|plan of care|skilled|intervention|frequency|goal)\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasDischargeOasisMarker(value: string | null | undefined): boolean {
  return /\b(?:dc|d\/c|discharge|discharged)\b/i.test(value ?? "");
}

function isDischargedOasisAssessment(input: {
  assessmentType?: string | null;
  title?: string | null;
  sourceRowText?: string | null;
}): boolean {
  return input.assessmentType?.trim().toUpperCase() === "DC" ||
    hasDischargeOasisMarker(input.title) ||
    hasDischargeOasisMarker(input.sourceRowText);
}

function oasisAssessmentDateSortValue(value: string | null | undefined): number {
  const parsed = parseDateOnly(value);
  return parsed ? parsed.getTime() : Number.MAX_SAFE_INTEGER;
}

function asChartSnapshotValueSource(value: unknown): ChartSnapshotValueSource | null {
  if (
    value === "chart_read" ||
    value === "workbook_context" ||
    value === "unavailable"
  ) {
    return value;
  }
  return null;
}

function extractReferralChartSnapshotValues(fieldMapSnapshot: unknown): {
  currentChartValues: Record<string, unknown>;
  currentChartValueSource?: ChartSnapshotValueSource;
} {
  const fields = asArray(asRecord(fieldMapSnapshot)?.fields);
  const currentChartValues: Record<string, unknown> = {};
  let currentChartValueSource: ChartSnapshotValueSource | undefined;

  for (const field of fields) {
    const fieldRecord = asRecord(field);
    const key = asString(fieldRecord?.key);
    if (!key) {
      continue;
    }

    const source = asChartSnapshotValueSource(fieldRecord?.currentChartValueSource);
    const legacyPrintedNoteSource = fieldRecord?.currentChartValueSource === "printed_note_ocr";
    const currentChartValue = legacyPrintedNoteSource ? null : fieldRecord?.currentChartValue;
    if (currentChartValue !== null && currentChartValue !== undefined && currentChartValue !== "") {
      currentChartValues[key] = currentChartValue;
    }

    if (
      !currentChartValueSource &&
      source &&
      source !== "unavailable" &&
      source !== "workbook_context"
    ) {
      currentChartValueSource = source;
    }
  }

  return {
    currentChartValues,
    currentChartValueSource,
  };
}

function buildReferralIntakeStatusUrl(batchId: string, patientId: string): string {
  return `/api/runs/${encodeURIComponent(batchId)}/patients/${encodeURIComponent(patientId)}/referral-intake/status`;
}

function buildOasisCheckStatusUrl(batchId: string, patientId: string, assessmentId: string): string {
  return `/api/runs/${encodeURIComponent(batchId)}/patients/${encodeURIComponent(patientId)}/oasis-check/status?assessmentId=${encodeURIComponent(assessmentId)}`;
}

function buildClinicalRefreshStatusUrl(batchId: string, patientId: string): string {
  return `/api/runs/${encodeURIComponent(batchId)}/patients/${encodeURIComponent(patientId)}/clinical-refresh/status`;
}

function getPatientArtifactsDirectory(batch: BatchRecord, patientId: string): string {
  return path.join(batch.storage.outputRoot, "patients", patientId);
}

function getReferralIntakeStatePath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "referral-intake-state.json");
}

function getReferralSourceDocumentsManifestPath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "referral-source-documents-manifest.json");
}

function getReferralDocumentResultsManifestPath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "referral-document-results-manifest.json");
}

function getPatientPortalStatusSnapshotPath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "patient-portal-status-snapshot.json");
}

function getOasisCheckStatePath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "oasis-check-state.json");
}

function getClinicalRefreshStatePath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, CLINICAL_REFRESH_STATE_FILE_NAME);
}

function createClinicalRefreshState(input: {
  batchId: string;
  patientId: string;
  targetOasisAssessmentId?: string | null;
  refreshId?: string | null;
  status: ClinicalRefreshStatus;
  now: string;
  existing?: Partial<PatientClinicalRefreshState> | null;
  message?: string | null;
  lastError?: string | null;
  attemptOutputRoot?: string | null;
  promotedAt?: string | null;
  reuseSummary?: PatientRunCacheSummary["reuseSummary"] | null;
  preflight?: PatientClinicalRefreshState["preflight"];
}): PatientClinicalRefreshState {
  return {
    schemaVersion: "clinical-refresh-state.v1",
    batchId: input.batchId,
    patientId: input.patientId,
    refreshId: input.refreshId ?? input.existing?.refreshId ?? null,
    targetOasisAssessmentId: input.targetOasisAssessmentId ?? input.existing?.targetOasisAssessmentId ?? null,
    status: input.status,
    acceptedAt: input.status === "pending"
      ? input.now
      : input.existing?.acceptedAt ?? (input.status === "running" ? input.now : null),
    startedAt: input.status === "running" ? input.now : input.existing?.startedAt ?? null,
    completedAt: input.status === "completed" || input.status === "failed" ? input.now : null,
    lastCheckedAt: input.status === "completed" || input.status === "failed" ? input.now : input.existing?.lastCheckedAt ?? null,
    lastError: input.lastError ?? null,
    attemptOutputRoot: input.attemptOutputRoot ?? input.existing?.attemptOutputRoot ?? null,
    promotedAt: input.promotedAt ?? input.existing?.promotedAt ?? null,
    statusUrl: buildClinicalRefreshStatusUrl(input.batchId, input.patientId),
    message: input.message ?? null,
    reuseSummary: input.reuseSummary ?? input.existing?.reuseSummary ?? null,
    preflight: input.preflight ?? input.existing?.preflight ?? null,
  };
}

function createOasisCheckAssessmentState(input: {
  batchId: string;
  patientId: string;
  assessmentId: string;
  status: OasisCheckJobStatus;
  now: string;
  existing?: Partial<PatientOasisCheckAssessmentState> | null;
  message?: string | null;
  lastError?: string | null;
  resultPath?: string | null;
  result?: OasisInternalMismatchReviewResult | null;
}): PatientOasisCheckAssessmentState {
  return {
    assessmentId: input.assessmentId,
    status: input.status,
    acceptedAt: input.status === "pending"
      ? input.now
      : input.existing?.acceptedAt ?? (input.status === "running" ? input.now : null),
    startedAt: input.status === "running" ? input.now : input.existing?.startedAt ?? null,
    completedAt: input.status === "completed" || input.status === "failed" ? input.now : null,
    lastCheckedAt: input.status === "completed" || input.status === "failed" ? input.now : input.existing?.lastCheckedAt ?? null,
    lastError: input.lastError ?? null,
    resultPath: input.resultPath ?? input.existing?.resultPath ?? null,
    statusUrl: buildOasisCheckStatusUrl(input.batchId, input.patientId, input.assessmentId),
    message: input.message ?? null,
    result: input.result ?? input.existing?.result ?? null,
  };
}

function createOasisCheckState(input: {
  batchId: string;
  patientId: string;
  now: string;
  existing?: PatientOasisCheckState | null;
  assessmentState?: PatientOasisCheckAssessmentState;
}): PatientOasisCheckState {
  return {
    schemaVersion: "oasis-check-state.v1",
    batchId: input.batchId,
    patientId: input.patientId,
    updatedAt: input.now,
    checks: {
      ...(input.existing?.checks ?? {}),
      ...(input.assessmentState ? { [input.assessmentState.assessmentId]: input.assessmentState } : {}),
    },
  };
}

function createReferralIntakeState(input: {
  batchId: string;
  patientId: string;
  status: ReferralIntakeStatus;
  now: string;
  existing?: Partial<ReferralIntakeState> | null;
  message?: string | null;
  lastError?: string | null;
}): ReferralIntakeState {
  return {
    schemaVersion: "referral-intake-state.v1",
    batchId: input.batchId,
    patientId: input.patientId,
    status: input.status,
    acceptedAt: input.status === "pending"
      ? input.now
      : input.existing?.acceptedAt ?? (input.status === "running" ? input.now : null),
    startedAt: input.status === "running" ? input.now : input.existing?.startedAt ?? null,
    completedAt: input.status === "completed" || input.status === "failed" ? input.now : null,
    lastCheckedAt: input.status === "completed" || input.status === "failed" ? input.now : input.existing?.lastCheckedAt ?? null,
    lastError: input.lastError ?? null,
    processedCount: input.existing?.processedCount ?? 0,
    reusedCount: input.existing?.reusedCount ?? 0,
    newOrChangedCount: input.existing?.newOrChangedCount ?? 0,
    failedCount: input.existing?.failedCount ?? 0,
    skippedCount: input.existing?.skippedCount ?? 0,
    documentCount: input.existing?.documentCount ?? 0,
    sourceDocumentCount: input.existing?.sourceDocumentCount ?? 0,
    statusUrl: buildReferralIntakeStatusUrl(input.batchId, input.patientId),
    message: input.message ?? null,
  };
}

function createPendingPatientPortalStatusSnapshot(input: {
  batchId: string;
  patientId: string;
  patientName: string;
  now: string;
  activePatientRunStatus: string | null;
  existing?: PatientPortalStatusSnapshot | null;
}): PatientPortalStatusSnapshot {
  return {
    schemaVersion: "patient-portal-status-snapshot.v1",
    batchId: input.batchId,
    patientId: input.patientId,
    patientName: input.patientName,
    status: "pending_due_to_active_patient_run",
    capturedAt: input.existing?.capturedAt ?? null,
    generatedAt: input.now,
    staleAfter: input.existing?.staleAfter ?? null,
    matchResult: input.existing?.matchResult ?? null,
    chartUrl: input.existing?.chartUrl ?? null,
    dashboardUrl: input.existing?.dashboardUrl ?? null,
    portalAdmissionStatus: input.existing?.portalAdmissionStatus ?? null,
    oasisAssessments: input.existing?.oasisAssessments ?? [],
    currentOasisAssessmentId: input.existing?.currentOasisAssessmentId ?? null,
    referralFileArea: input.existing?.referralFileArea ?? { available: false, labels: [] },
    documentTableSignals: input.existing?.documentTableSignals ?? [],
    activePatientRunStatus: input.activePatientRunStatus,
    error: input.existing
      ? null
      : "Patient portal status preflight is pending because this patient is actively being processed.",
  };
}

async function copyDirectoryContents(input: {
  sourceDirectory: string;
  targetDirectory: string;
  shouldCopy?: (relativePath: string, entryName: string, isDirectory: boolean) => boolean;
}): Promise<void> {
  const entries = await readdir(input.sourceDirectory, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) {
    return;
  }

  await mkdir(input.targetDirectory, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(input.sourceDirectory, entry.name);
    const targetPath = path.join(input.targetDirectory, entry.name);
    const relativePath = entry.name;
    if (entry.isDirectory()) {
      if (input.shouldCopy && !input.shouldCopy(relativePath, entry.name, true)) {
        continue;
      }
      await copyDirectoryContents({
        sourceDirectory: sourcePath,
        targetDirectory: targetPath,
        shouldCopy: input.shouldCopy
          ? (childRelativePath, childEntryName, isDirectory) =>
              input.shouldCopy!(path.join(relativePath, childRelativePath), childEntryName, isDirectory)
          : undefined,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (input.shouldCopy && !input.shouldCopy(relativePath, entry.name, false)) {
      continue;
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

function shouldPromoteClinicalRefreshPath(
  relativePath: string,
  entryName: string,
  isDirectory: boolean,
): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const topLevel = normalized.split("/")[0] ?? normalized;
  if (isDirectory && CLINICAL_REFRESH_PROMOTION_EXCLUDED_DIRECTORIES.has(topLevel)) {
    return false;
  }
  if (CLINICAL_REFRESH_PROMOTION_EXCLUDED_PATHS.has(normalized)) {
    return false;
  }
  if (entryName === "oasis-check-result.json") {
    return false;
  }
  return true;
}

function replacePathPrefix(value: string | null | undefined, fromRoot: string, toRoot: string): string | null {
  if (!value) {
    return value ?? null;
  }
  const resolvedValue = path.resolve(value);
  const resolvedFromRoot = path.resolve(fromRoot);
  if (resolvedValue === resolvedFromRoot) {
    return toRoot;
  }
  if (!resolvedValue.startsWith(`${resolvedFromRoot}${path.sep}`)) {
    return value;
  }
  return path.join(toRoot, path.relative(resolvedFromRoot, resolvedValue));
}

function markPatientPortalStatusSnapshotFreshness(
  snapshot: PatientPortalStatusSnapshot,
  now = new Date(),
): PatientPortalStatusSnapshot {
  if (snapshot.status !== "fresh" || !snapshot.staleAfter) {
    return snapshot;
  }
  const staleAt = Date.parse(snapshot.staleAfter);
  if (Number.isFinite(staleAt) && staleAt <= now.getTime()) {
    return {
      ...snapshot,
      status: "stale",
    };
  }
  return snapshot;
}

function normalizeDocumentTitle(document: ReferralSourceDocumentManifestEntry): string | null {
  return asString(document.title) ?? asString(document.sourceLabel) ?? asString(document.portalLabel) ??
    (document.sourcePath ? path.basename(document.sourcePath) : null);
}

function normalizeReferralDocumentIdentityKey(value: string | null | undefined): string | null {
  const normalized = value
    ?.replace(/[^\x20-\x7E]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function safeDocumentKey(input: {
  patientId: string;
  documentId: string;
  title?: string | null;
  index: number;
}): string {
  const raw = input.documentId || input.title || `document-${input.index + 1}`;
  const slug = raw
    .replace(input.patientId, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || `document-${input.index + 1}`;
}

function safeOasisAssessmentKey(input: {
  assessmentId: string;
  title?: string | null;
  date?: string | null;
}): string {
  const raw = [input.assessmentId, input.title, input.date].filter(Boolean).join("-");
  const slug = raw
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "selected-oasis";
}

async function sha256FileIfExists(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath) {
    return null;
  }
  try {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
  } catch {
    return null;
  }
}

async function fileExistsAtPath(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDashboardLabel(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "OASIS field";
  }
  return normalized
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bOasis\b/g, "OASIS")
    .replace(/\bPoc\b/g, "POC")
    .replace(/\bSoc\b/g, "SOC")
    .replace(/\bQa\b/g, "QA");
}

function clipIssueText(value: string | null | undefined, maxLength = 160): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function issueSort(left: ConciseQaIssue, right: ConciseQaIssue): number {
  const severityDelta = ISSUE_SEVERITY_RANK[left.severity] - ISSUE_SEVERITY_RANK[right.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return left.problemSummary.localeCompare(right.problemSummary);
}

function topIssue(issues: ConciseQaIssue[]): ConciseQaIssue | null {
  return [...issues].sort(issueSort)[0] ?? null;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function deriveDaysSinceSoc(socDate: string | null | undefined, now = new Date()): number | null {
  const start = parseDateOnly(socDate);
  if (!start) {
    return null;
  }
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
}

function deriveOasisStage(input: {
  queueStatus: string;
  daysLeft: number | null;
  hasOasisDom: boolean;
  oasisQaIssueCount: number;
  oasisValidatedForPlanOfCare: boolean;
}): DashboardPatientRecord["oasisStage"] {
  if (input.queueStatus !== "eligible") {
    return input.queueStatus === "skipped_pending" ? "pending_patient" : "not_applicable";
  }
  if (input.oasisValidatedForPlanOfCare) {
    return "validated";
  }
  if (!input.hasOasisDom && input.oasisQaIssueCount > 0) {
    return "oasis_not_filled_out";
  }
  if (input.daysLeft !== null && input.daysLeft <= 15) {
    return "assist_oasis_fill";
  }
  if (input.daysLeft !== null && input.daysLeft <= 30) {
    return "scrape_and_prepare";
  }
  if (input.daysLeft !== null && input.daysLeft > 30) {
    return "clinician_fill_later";
  }
  return input.oasisQaIssueCount > 0 ? "ready_for_review" : "not_applicable";
}

function deriveDashboardPipelineStage(input: {
  queueStatus: string;
  processingStatus: string | null;
  missingReferralDocumentation: boolean;
  planOfCareAvailable: boolean;
  workItem: PatientEpisodeWorkItem | null;
  oasisStage: DashboardPatientRecord["oasisStage"];
}): DashboardPatientRecord["pipelineStage"] {
  if (input.queueStatus === "skipped_pending" || !input.processingStatus || input.processingStatus === "PENDING") {
    return "pending";
  }

  if (input.planOfCareAvailable || input.oasisStage === "validated") {
    return "plan_of_care_visit_notes";
  }

  if (input.missingReferralDocumentation) {
    return "documentation";
  }

  if (
    input.oasisStage === "oasis_not_filled_out" ||
    input.oasisStage === "scrape_and_prepare" ||
    input.oasisStage === "assist_oasis_fill" ||
    input.workItem?.oasisQaStatus !== "DONE"
  ) {
    return "oasis";
  }

  return "plan_of_care_visit_notes";
}

function buildIssue(input: {
  domain: ConciseQaIssue["domain"];
  section: string;
  itemId?: string | null;
  severity: ConciseQaIssue["severity"];
  problemSummary: string;
  recommendedFix: string;
  evidenceSnippet?: string | null;
  source: string;
}): ConciseQaIssue {
  const issueKey = [
    input.domain,
    input.section,
    input.itemId ?? input.problemSummary,
    input.problemSummary,
  ].join(":").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    issueId: issueKey || `${input.domain}-issue`,
    domain: input.domain,
    section: input.section,
    itemId: input.itemId ?? null,
    severity: input.severity,
    problemSummary: input.problemSummary,
    recommendedFix: input.recommendedFix,
    evidenceSnippet: clipIssueText(input.evidenceSnippet, 220),
    source: input.source,
  };
}

function valueLooksEmpty(value: unknown, normalizedValue: string | null): boolean {
  if (typeof value === "boolean") {
    return value === false;
  }
  const text = normalizedValue ?? (typeof value === "string" ? value : "");
  return !text.trim() || /^(?:false|unchecked|undefined|null|not provided|n\/a|na|\[object object\])$/i.test(text.trim());
}

function deriveOasisDomIssues(input: {
  oasisDomExtractedState: unknown | null;
  oasisDomAcquisitionState: unknown | null;
  oasisDomComparison: unknown | null;
  oasisQaSummary: PatientDashboardState["oasisQaSummary"] | null | undefined;
}): { issues: ConciseQaIssue[]; emptyOasisInputCount: number; mismatchCount: number; hasOasisDom: boolean } {
  const issues: ConciseQaIssue[] = [];
  const acquisition = asRecord(input.oasisDomAcquisitionState);
  const domState = asRecord(input.oasisDomExtractedState);
  const comparison = asRecord(input.oasisDomComparison);
  const hasOasisDom = Boolean(acquisition || domState);

  const missingSections = asArray(acquisition?.missingRequiredSections)
    .map(asString)
    .filter((value): value is string => value !== null);
  for (const section of missingSections.slice(0, 4)) {
    issues.push(buildIssue({
      domain: "oasis",
      section: normalizeDashboardLabel(section),
      severity: "high",
      problemSummary: `${normalizeDashboardLabel(section)} is missing`,
      recommendedFix: `Open ${normalizeDashboardLabel(section)} and complete the required OASIS fields.`,
      source: "oasis_dom_acquisition",
    }));
  }

  const missingFields = asArray(acquisition?.missingRequiredFields)
    .map(asString)
    .filter((value): value is string => value !== null);
  if (missingFields.length > 0) {
    issues.push(buildIssue({
      domain: "oasis",
      section: "Required OASIS Fields",
      severity: "high",
      problemSummary: `${missingFields.length} required OASIS area${missingFields.length === 1 ? "" : "s"} missing`,
      recommendedFix: `Complete ${missingFields.slice(0, 3).map(normalizeDashboardLabel).join(", ")}${missingFields.length > 3 ? " and remaining required areas" : ""}.`,
      evidenceSnippet: missingFields.slice(0, 6).join("; "),
      source: "oasis_dom_acquisition",
    }));
  }

  const importantEmptyFields: Array<{ label: string; section: string; itemId: string | null }> = [];
  for (const sectionValue of asArray(acquisition?.sections)) {
    const section = asRecord(sectionValue);
    const sectionLabel = normalizeDashboardLabel(asString(section?.title) ?? asString(section?.sectionKey));
    for (const fieldValue of asArray(section?.fields)) {
      const field = asRecord(fieldValue);
      if (!field) {
        continue;
      }
      const label = normalizeDashboardLabel(asString(field.label) ?? asString(field.fieldKey) ?? asString(field.oasisItemCode));
      const itemId = asString(field.oasisItemCode) ?? asString(field.fieldKey);
      const normalizedValue = asString(field.normalizedValue);
      if (!CLINICALLY_IMPORTANT_OASIS_FIELD_PATTERN.test(`${label} ${itemId ?? ""}`)) {
        continue;
      }
      if (asString(field.status) === "empty" || valueLooksEmpty(field.value, normalizedValue)) {
        importantEmptyFields.push({ label, section: sectionLabel, itemId });
      }
    }
  }

  const fieldsBySection = new Map<string, Array<{ label: string; itemId: string | null }>>();
  for (const field of importantEmptyFields) {
    const bucket = fieldsBySection.get(field.section) ?? [];
    bucket.push({ label: field.label, itemId: field.itemId });
    fieldsBySection.set(field.section, bucket);
  }
  for (const [section, fields] of Array.from(fieldsBySection.entries()).slice(0, 5)) {
    const firstLabels = fields.slice(0, 3).map((field) => field.label);
    issues.push(buildIssue({
      domain: "oasis",
      section,
      itemId: fields[0]?.itemId ?? null,
      severity: fields.length >= 3 ? "high" : "medium",
      problemSummary: `${fields.length} important ${section} field${fields.length === 1 ? "" : "s"} empty`,
      recommendedFix: `Complete ${firstLabels.join(", ")}${fields.length > 3 ? " and related fields" : ""}.`,
      evidenceSnippet: fields.map((field) => field.itemId ?? field.label).slice(0, 6).join("; "),
      source: "oasis_dom_acquisition",
    }));
  }

  const regressedFields = asArray(acquisition?.regressedFields)
    .map(asString)
    .filter((value): value is string => value !== null);
  if (regressedFields.length > 0) {
    issues.push(buildIssue({
      domain: "oasis",
      section: "OASIS Internal Consistency",
      severity: "high",
      problemSummary: `${regressedFields.length} OASIS field${regressedFields.length === 1 ? "" : "s"} lost a prior value`,
      recommendedFix: "Review the changed OASIS fields and restore the clinically correct values.",
      evidenceSnippet: regressedFields.slice(0, 5).join("; "),
      source: "oasis_dom_acquisition",
    }));
  }

  const recommendedDecision = asString(comparison?.recommendedDecision);
  if (recommendedDecision && !/accept|no_change|unchanged/i.test(recommendedDecision)) {
    issues.push(buildIssue({
      domain: "oasis",
      section: "OASIS Internal Consistency",
      severity: "medium",
      problemSummary: "OASIS DOM values changed since the prior QA input",
      recommendedFix: "Review changed OASIS values before final QA.",
      evidenceSnippet: recommendedDecision,
      source: "oasis_dom_comparison",
    }));
  }

  for (const section of input.oasisQaSummary?.sections ?? []) {
    for (const item of section.items) {
      if (item.status !== "FAIL" && item.status !== "MISSING") {
        continue;
      }
      issues.push(buildIssue({
        domain: "oasis",
        section: section.label,
        itemId: item.key,
        severity: item.status === "FAIL" ? "high" : "medium",
        problemSummary: item.label,
        recommendedFix: item.notes ?? `Complete ${item.label.toLowerCase()}.`,
        evidenceSnippet: item.evidence.slice(0, 2).join("; "),
        source: "existing_oasis_qa_summary",
      }));
    }
  }

  const deduped = Array.from(new Map(issues.map((issue) => [issue.issueId, issue])).values()).sort(issueSort);
  return {
    issues: deduped.slice(0, 12),
    emptyOasisInputCount: importantEmptyFields.length,
    mismatchCount: regressedFields.length + (recommendedDecision && !/accept|no_change|unchanged/i.test(recommendedDecision) ? 1 : 0),
    hasOasisDom,
  };
}

function deriveVisitNoteIssues(input: {
  visitNoteQaReview: unknown | null;
  visitNotesDiscovery: unknown | null;
  visitNoteProcessingManifest: unknown | null;
}): {
  issues: ConciseQaIssue[];
  mismatchCount: number;
  activeQaCount: number;
  reviewStatus: DashboardPatientRecord["visitNoteReviewStatus"];
  domStatus: string | null;
} {
  const review = asRecord(input.visitNoteQaReview);
  const discovery = asRecord(input.visitNotesDiscovery);
  const manifest = asRecord(input.visitNoteProcessingManifest);
  const issues: ConciseQaIssue[] = [];

  for (const findingValue of asArray(review?.findings)) {
    const finding = asRecord(findingValue);
    if (!finding) {
      continue;
    }
    const title = asString(finding.title) ?? "Visit note issue";
    issues.push(buildIssue({
      domain: "visit_notes",
      section: normalizeDashboardLabel(asString(finding.visitType) ?? asString(finding.category) ?? "Visit Notes"),
      itemId: asString(finding.findingId) ?? asString(finding.visitNoteKey),
      severity: asString(finding.severity) === "critical" || asString(finding.severity) === "high" ? "high" : "medium",
      problemSummary: title,
      recommendedFix:
        asString(finding.suggestedReviewerAction) ??
        "Update the visit note so it clearly documents the performed intervention and patient response.",
      evidenceSnippet: asString(finding.description),
      source: "visit_note_qa_review",
    }));
  }

  for (const noteValue of asArray(review?.noteSummaries)) {
    const note = asRecord(noteValue);
    if (!note) {
      continue;
    }
    const missingFields = asArray(note.missingFields).map(asString).filter((value): value is string => value !== null);
    if (missingFields.length > 0) {
      issues.push(buildIssue({
        domain: "visit_notes",
        section: normalizeDashboardLabel(asString(note.visitType) ?? "Visit Notes"),
        itemId: asString(note.visitNoteKey),
        severity: "medium",
        problemSummary: `${missingFields.length} visit note detail${missingFields.length === 1 ? "" : "s"} missing`,
        recommendedFix: `Add ${missingFields.slice(0, 3).map(normalizeDashboardLabel).join(", ")} to the note.`,
        evidenceSnippet: asString(note.summary),
        source: "visit_note_qa_review",
      }));
    }
  }

  const summary = asRecord(review?.summary);
  const activeQaCount = asNumber(summary?.activeMonitoringCount) ?? 0;
  const failed = asNumber(summary?.failedVisitNotes) ?? 0;
  const degraded = asNumber(summary?.degradedVisitNotes) ?? 0;
  const capped = asNumber(summary?.cappedVisitNotes) ?? 0;
  if (failed + degraded + capped > 0) {
    issues.push(buildIssue({
      domain: "visit_notes",
      section: "Visit Notes DOM Capture",
      severity: failed > 0 ? "high" : "medium",
      problemSummary: `${failed + degraded + capped} visit note capture issue${failed + degraded + capped === 1 ? "" : "s"}`,
      recommendedFix: "Reopen the affected visit notes and confirm DOM capture completed.",
      source: "visit_note_qa_review",
    }));
  }

  const manifestInputs = asArray(manifest?.visitNoteInputs);
  const domCapturedCount = manifestInputs.filter((entryValue) => {
    const entry = asRecord(entryValue);
    return /text_export|html_text|cache/i.test(asString(entry?.extractionSource) ?? "");
  }).length;
  const totalRows = asArray(discovery?.rows).length || manifestInputs.length;
  const domStatus = totalRows > 0
    ? `${domCapturedCount}/${totalRows} DOM/text captured`
    : asString(review?.status) ?? null;
  const incompleteNoteCount = asNumber(summary?.incompleteNoteCount) ?? 0;
  const pocAlignmentIssueCount = asNumber(summary?.pocAlignmentIssueCount) ?? 0;
  const contradictionCount = asNumber(summary?.contradictionCount) ?? 0;
  const analyzedVisitNotes = asNumber(summary?.analyzedVisitNotes) ?? 0;
  const reviewStatus: DashboardPatientRecord["visitNoteReviewStatus"] =
    activeQaCount > 0
      ? "new_visit_note_to_qa"
      : failed + degraded + capped + incompleteNoteCount + pocAlignmentIssueCount + contradictionCount > 0
        ? "needs_review"
        : analyzedVisitNotes > 0
          ? "reviewed"
          : totalRows > 0
            ? "not_started"
            : "not_applicable";

  const deduped = Array.from(new Map(issues.map((issue) => [issue.issueId, issue])).values()).sort(issueSort);
  return {
    issues: deduped.slice(0, 8),
    mismatchCount: contradictionCount + pocAlignmentIssueCount + incompleteNoteCount,
    activeQaCount,
    reviewStatus,
    domStatus,
  };
}

function countReferralMedications(input: unknown | null): number {
  const factPack = asRecord(input);
  const facts = asArray(factPack?.facts);
  if (facts.length > 0) {
    return facts.filter((factValue) => /^(?:medication|allergy|allergies)$/i.test(asString(asRecord(factValue)?.category) ?? "")).length;
  }
  return asArray(factPack?.medications).length + asArray(factPack?.allergies).length;
}

function getReferralExtractionUsabilityStatus(artifactContents: {
  qaDocumentSummary?: unknown | null;
  patientQaReference?: unknown | null;
}): string | null {
  const qaDocumentSummary = asRecord(artifactContents.qaDocumentSummary);
  const patientQaReference = asRecord(artifactContents.patientQaReference);
  return asString(qaDocumentSummary?.extractionUsabilityStatus) ??
    asString(patientQaReference?.extractionUsabilityStatus);
}

function canCountReferralStructuredFacts(artifactContents: {
  qaDocumentSummary?: unknown | null;
  patientQaReference?: unknown | null;
}): boolean {
  const status = getReferralExtractionUsabilityStatus(artifactContents);
  return status === null || /^usable$/i.test(status);
}

type DashboardReviewerStatus = NonNullable<DashboardPatientRecord["reviewerStatus"]>;

type DashboardReviewerStatusEntry = {
  workItemId: string;
  status: DashboardReviewerStatus;
  updatedAt: string;
  updatedBy: string | null;
};

type DashboardReviewCycleSignal = {
  oasisInternalMismatchCount: number;
  visitNoteMismatchCount: number;
  visitNoteActiveQaCount: number;
};

function derivePortalExcludedQueueStatus(input: {
  queueStatus: PatientQueueArtifact["entries"][number]["status"];
  patientRun: BatchRecord["patientRuns"][number] | undefined;
}): PatientQueueArtifact["entries"][number]["status"] {
  if (input.queueStatus !== "eligible") {
    return input.queueStatus;
  }
  if (input.patientRun?.executionStep !== "PATIENT_STATUS_EXCLUDED") {
    return input.queueStatus;
  }

  const statusEvidence = [
    input.patientRun.errorSummary,
    input.patientRun.matchResult.portalDisplayName,
    input.patientRun.matchResult.note,
    ...input.patientRun.matchResult.candidateNames,
  ].filter((value): value is string => Boolean(value));
  const statusText = statusEvidence.join(" ");
  if (/\bnon[-\s]?admit(?:ted)?\b/i.test(statusText)) {
    return "skipped_non_admit";
  }
  if (/\bpending\b/i.test(statusText)) {
    return "skipped_pending";
  }

  return input.queueStatus;
}

function deriveResolvedQueueEligibility(
  queueEntry: PatientQueueArtifact["entries"][number],
  queueStatus: PatientQueueArtifact["entries"][number]["status"],
): PatientQueueArtifact["entries"][number]["eligibility"] {
  if (queueStatus === queueEntry.status) {
    return queueEntry.eligibility;
  }

  if (queueStatus === "skipped_pending") {
    return {
      eligible: false,
      reason: "pending",
      rationale: "Patient is excluded from autonomous QA evaluation because the portal status is Pending.",
      matchedSignals: queueEntry.eligibility.matchedSignals,
    };
  }

  if (queueStatus === "skipped_non_admit") {
    return {
      eligible: false,
      reason: "non_admit",
      rationale: "Patient is excluded from autonomous QA evaluation because the portal status is Non-Admit.",
      matchedSignals: queueEntry.eligibility.matchedSignals,
    };
  }

  return queueEntry.eligibility;
}

function summarizeQueueEntries(
  entries: readonly PatientQueueArtifact["entries"][number][],
): PatientQueueArtifact["summary"] {
  return {
    total: entries.length,
    eligible: entries.filter((entry) => entry.status === "eligible").length,
    skippedNonAdmit: entries.filter((entry) => entry.status === "skipped_non_admit").length,
    skippedPending: entries.filter((entry) => entry.status === "skipped_pending").length,
    excludedOther: entries.filter((entry) => entry.status === "excluded_other").length,
  };
}

type DashboardReviewerStatusArtifact = {
  schemaVersion: "dashboard-reviewer-statuses.v1";
  generatedAt: string;
  agencyId: string;
  batchId: string;
  statuses: Record<string, DashboardReviewerStatusEntry>;
};

function parseDashboardReviewerStatusArtifact(input: unknown): DashboardReviewerStatusArtifact | null {
  const record = asRecord(input);
  const statusesRecord = asRecord(record?.statuses);
  if (!record || !statusesRecord) {
    return null;
  }
  const statuses: Record<string, DashboardReviewerStatusEntry> = {};
  for (const [workItemId, value] of Object.entries(statusesRecord)) {
    const entry = asRecord(value);
    const status = asString(entry?.status);
    if (status !== "red" && status !== "yellow" && status !== "green") {
      continue;
    }
    statuses[workItemId] = {
      workItemId,
      status,
      updatedAt: asString(entry?.updatedAt) ?? new Date().toISOString(),
      updatedBy: asString(entry?.updatedBy),
    };
  }
  return {
    schemaVersion: "dashboard-reviewer-statuses.v1",
    generatedAt: asString(record.generatedAt) ?? new Date().toISOString(),
    agencyId: asString(record.agencyId) ?? "",
    batchId: asString(record.batchId) ?? "",
    statuses,
  };
}

function reviewerStatusPathForBatch(batch: BatchRecord): string {
  return path.join(batch.storage.outputRoot, DASHBOARD_REVIEWER_STATUS_FILE_NAME);
}

function parseTimestampMillis(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function patientRunCycleTimestamp(patientRun: BatchRecord["patientRuns"][number] | undefined): string | null {
  return patientRun?.lastUpdatedAt ?? patientRun?.completedAt ?? patientRun?.startedAt ?? null;
}

function hasCurrentCycleDiscrepancy(signal: DashboardReviewCycleSignal): boolean {
  return signal.oasisInternalMismatchCount > 0 || signal.visitNoteMismatchCount > 0 || signal.visitNoteActiveQaCount > 0;
}

function deriveEffectiveDashboardReviewerStatus(input: {
  workItemId: string;
  reviewerStatus: DashboardReviewerStatusEntry | null;
  patientRun: BatchRecord["patientRuns"][number] | undefined;
  documentationSignal: DashboardReviewCycleSignal;
}): DashboardReviewerStatusEntry | null {
  if (!hasCurrentCycleDiscrepancy(input.documentationSignal)) {
    return input.reviewerStatus;
  }
  if (input.reviewerStatus?.status === "red") {
    return input.reviewerStatus;
  }

  const cycleTimestamp = patientRunCycleTimestamp(input.patientRun);
  const cycleMillis = parseTimestampMillis(cycleTimestamp);
  const reviewerMillis = parseTimestampMillis(input.reviewerStatus?.updatedAt);
  const isStale = cycleMillis !== null && (reviewerMillis === null || reviewerMillis < cycleMillis);

  if (!input.reviewerStatus || isStale) {
    return {
      workItemId: input.workItemId,
      status: "red",
      updatedAt: cycleTimestamp ?? new Date().toISOString(),
      updatedBy: "System",
    };
  }

  return input.reviewerStatus;
}

async function canReuseCompletedPatientRun(
  repository: FilesystemBatchRepository,
  patientRun: BatchRecord["patientRuns"][number] | undefined,
  patientArtifactsDirectory: string,
  workItem: PatientEpisodeWorkItem,
): Promise<boolean> {
  if (!isReusablePatientRunOutcome(patientRun) || !patientRun?.bundleAvailable) {
    return false;
  }

  const seededFingerprint = await repository.readJsonIfExists<WorkItemFingerprint>(
    path.join(patientArtifactsDirectory, WORK_ITEM_FINGERPRINT_FILE_NAME),
  );
  if (!isSameWorkItemFingerprint(seededFingerprint, buildWorkItemFingerprint(workItem))) {
    return false;
  }

  return repository.fileExists(patientRun.resultBundlePath);
}

function createPendingPatientRunState(
  batch: BatchRecord,
  workItem: PatientEpisodeWorkItem,
  previous?: BatchRecord["patientRuns"][number],
): BatchRecord["patientRuns"][number] {
  const runId = createRunId(batch.id, workItem.id);
  const resultBundlePath = path.join(
    batch.storage.patientResultsDirectory,
    `${workItem.id}.json`,
  );

  return {
    runId,
    subsidiaryId: workItem.subsidiaryId ?? batch.subsidiary.id,
    workItemId: workItem.id,
    patientName: workItem.patientIdentity.displayName,
    processingStatus: "PENDING",
    executionStep: "PENDING",
    progressPercent: 0,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: batch.updatedAt,
    matchResult: createPlaceholderMatchResult(workItem.patientIdentity.displayName),
    qaOutcome: "INCOMPLETE",
    oasisQaSummary: buildOasisQaSummary({
      workItem,
      matchResult: createPlaceholderMatchResult(workItem.patientIdentity.displayName),
      artifacts: [],
      processingStatus: "PENDING",
    }),
    artifactCount: 0,
    hasFindings: false,
    bundleAvailable: false,
    logPath: null,
    logAvailable: false,
    retryEligible: false,
    errorSummary: null,
    resultBundlePath,
    evidenceDirectory: path.join(batch.storage.evidenceDirectory, workItem.id),
    tracePath: null,
    screenshotPaths: [],
    downloadPaths: [],
    workflowRuns: createDefaultWorkflowRuns(runId, batch.updatedAt),
    lastAttemptAt: previous?.lastAttemptAt ?? null,
    attemptCount: previous?.attemptCount ?? 0,
  };
}

function toPersistedPatientRun(
  batch: BatchRecord,
  patientRun: PatientRun,
  previous?: BatchRecord["patientRuns"][number],
): BatchRecord["patientRuns"][number] {
  return {
    runId: patientRun.runId,
    subsidiaryId: patientRun.subsidiaryId ?? batch.subsidiary.id,
    workItemId: patientRun.workItemId,
    patientName: patientRun.patientName,
    processingStatus: patientRun.processingStatus,
    executionStep: patientRun.executionStep,
    progressPercent: patientRun.progressPercent,
    startedAt: patientRun.startedAt,
    completedAt: patientRun.completedAt,
    lastUpdatedAt: patientRun.lastUpdatedAt,
    matchResult: patientRun.matchResult,
    qaOutcome: patientRun.qaOutcome,
    oasisQaSummary: patientRun.oasisQaSummary,
    artifactCount: patientRun.artifactCount,
    hasFindings: patientRun.hasFindings,
    bundleAvailable: patientRun.bundleAvailable || Boolean(patientRun.resultBundlePath),
    logPath: patientRun.logPath,
    logAvailable: patientRun.logAvailable,
    retryEligible: patientRun.retryEligible,
    errorSummary: patientRun.errorSummary,
    resultBundlePath:
      patientRun.resultBundlePath ??
      path.join(batch.storage.patientResultsDirectory, `${patientRun.workItemId}.json`),
    evidenceDirectory: path.join(batch.storage.evidenceDirectory, patientRun.workItemId),
    tracePath: patientRun.auditArtifacts.tracePath,
    screenshotPaths: patientRun.auditArtifacts.screenshotPaths,
    downloadPaths: patientRun.auditArtifacts.downloadPaths,
    workflowRuns: patientRun.workflowRuns,
    lastAttemptAt: patientRun.completedAt ?? patientRun.lastUpdatedAt,
    attemptCount: previous ? previous.attemptCount + 1 : 1,
  };
}

function toArtifactReprocessPatientRun(
  batch: BatchRecord,
  workItem: PatientEpisodeWorkItem,
  previous?: BatchRecord["patientRuns"][number],
): PatientRun {
  const now = new Date().toISOString();
  const runId = previous?.runId ?? createRunId(batch.id, workItem.id);
  const resultBundlePath =
    previous?.resultBundlePath ?? path.join(batch.storage.patientResultsDirectory, `${workItem.id}.json`);

  return {
    runId,
    batchId: batch.id,
    subsidiaryId: workItem.subsidiaryId ?? batch.subsidiary.id,
    workItemId: workItem.id,
    patientName: previous?.patientName ?? workItem.patientIdentity.displayName,
    processingStatus: previous?.processingStatus === "PENDING" ? "COMPLETE" : previous?.processingStatus ?? "COMPLETE",
    executionStep: "VISIT_NOTES_REPROCESSED_FROM_ARTIFACTS",
    progressPercent: 100,
    startedAt: previous?.startedAt ?? now,
    completedAt: now,
    lastUpdatedAt: now,
    matchResult: previous?.matchResult ?? createPlaceholderMatchResult(workItem.patientIdentity.displayName),
    artifacts: [],
    artifactCount: previous?.artifactCount ?? 0,
    findings: [],
    hasFindings: previous?.hasFindings ?? false,
    qaOutcome: previous?.qaOutcome ?? "INCOMPLETE",
    oasisQaSummary: previous?.oasisQaSummary ?? buildOasisQaSummary({
      workItem,
      matchResult: previous?.matchResult ?? createPlaceholderMatchResult(workItem.patientIdentity.displayName),
      artifacts: [],
      processingStatus: previous?.processingStatus ?? "COMPLETE",
    }),
    documentInventory: [],
    resultBundlePath,
    bundleAvailable: previous?.bundleAvailable ?? Boolean(resultBundlePath),
    logPath: previous?.logPath ?? null,
    logAvailable: previous?.logAvailable ?? false,
    retryEligible: false,
    errorSummary: previous?.errorSummary ?? null,
    auditArtifacts: {
      tracePath: previous?.tracePath ?? null,
      screenshotPaths: previous?.screenshotPaths ?? [],
      downloadPaths: previous?.downloadPaths ?? [],
    },
    workflowRuns: previous?.workflowRuns ?? createDefaultWorkflowRuns(runId, now),
    workItemSnapshot: workItem,
    automationStepLogs: [],
    notes: [
      `Visit Notes QA reprocessed from existing captured artifacts at ${now}; portal acquisition was not run.`,
    ],
  };
}

function clearResolvedReferralReviewStatus(patientRun: PatientRun): void {
  if (
    patientRun.processingStatus !== "NEEDS_HUMAN_REVIEW" ||
    !/Referral direct-document extraction is .*review source-backed evidence/i.test(
      patientRun.errorSummary ?? "",
    )
  ) {
    return;
  }

  patientRun.processingStatus = "COMPLETE";
  patientRun.qaOutcome = "READY_FOR_BILLING_PREP";
  patientRun.errorSummary = null;
}

function countProcessedPatientRuns(batch: BatchRecord): number {
  return batch.patientRuns.filter((patientRun) => !isTransientPatientStatus(patientRun.processingStatus))
    .length;
}

function deriveBatchErrorSummary(batch: BatchRecord): string | null {
  return (
    batch.run.lastError ??
    batch.parse.lastError ??
    batch.patientRuns.find((patientRun) => patientRun.errorSummary)?.errorSummary ??
    null
  );
}

function createBatchSchedule(
  now: string,
  subsidiary: SubsidiaryRecord,
  localTimes: readonly string[] = DEFAULT_REFRESH_LOCAL_TIMES,
  scheduler: {
    workbookIntakeDay?: WeekdayName;
    workbookIntakeLocalTime?: string;
    deltaRunWeekdays?: readonly WeekdayName[];
  } = {},
): BatchRecord["schedule"] {
  const timezone = subsidiary.timezone || DEFAULT_REFRESH_TIMEZONE;
  const intervalHours = subsidiary.rerunIntervalHours || DEFAULT_RERUN_INTERVAL_HOURS;
  const nextWorkbookIntakeAt = subsidiary.rerunEnabled
    ? calculateNextWorkbookIntakeAt({
        fromIsoTimestamp: now,
        timezone,
        weekday: scheduler.workbookIntakeDay ?? DEFAULT_WORKBOOK_INTAKE_DAY,
        localTime: scheduler.workbookIntakeLocalTime ?? DEFAULT_WORKBOOK_INTAKE_LOCAL_TIME,
      })
    : null;
  const nextDeltaRunAt = subsidiary.rerunEnabled
    ? calculateNextWeekdayDeltaRunAt({
        fromIsoTimestamp: now,
        timezone,
        weekdays: scheduler.deltaRunWeekdays ?? DEFAULT_DELTA_RUN_WEEKDAYS,
        localTimes,
        intervalHours,
      })
    : null;
  return {
    scheduledRunId: null,
    active: subsidiary.rerunEnabled,
    rerunEnabled: subsidiary.rerunEnabled,
    intervalHours,
    timezone,
    localTimes: [...localTimes],
    lastRunAt: null,
    nextScheduledRunAt: earliestTimestamp(nextWorkbookIntakeAt, nextDeltaRunAt),
    lastWorkbookAcquiredAt: null,
    nextWorkbookIntakeAt,
    lastDeltaRunAt: null,
    nextDeltaRunAt,
  };
}

function mapWorkbookSourceKind(providerId: WorkbookAcquisitionProviderId): WorkbookSource["kind"] {
  switch (providerId) {
    case "MANUAL_UPLOAD":
      return "manual_upload";
    case "FINALE":
      return "finale_download";
    default:
      return "unknown";
  }
}

function createFallbackWorkbookSource(batch: BatchRecord): WorkbookSource {
  return {
    agencyId: batch.subsidiary.id,
    batchId: batch.id,
    kind: mapWorkbookSourceKind(batch.sourceWorkbook.acquisitionProvider),
    path: batch.sourceWorkbook.storedPath,
    originalFileName: batch.sourceWorkbook.originalFileName,
    sourceLabel: batch.sourceWorkbook.originalFileName,
    acquiredAt: batch.sourceWorkbook.uploadedAt,
    ingestedAt: batch.sourceWorkbook.uploadedAt,
    acquisition: batch.sourceWorkbook.acquisitionMetadata ?? {
      providerId: batch.sourceWorkbook.acquisitionProvider,
      acquisitionReference: batch.sourceWorkbook.acquisitionReference,
      metadataPath: batch.sourceWorkbook.acquisitionReference,
      selectedAgencyName: null,
      selectedAgencyUrl: null,
      dashboardUrl: null,
      notes: batch.sourceWorkbook.acquisitionNotes,
    },
    verification: batch.sourceWorkbook.verification,
  };
}

function isSameWorkItemFingerprint(
  left: WorkItemFingerprint | null | undefined,
  right: WorkItemFingerprint | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.schemaVersion === WORK_ITEM_FINGERPRINT_SCHEMA_VERSION &&
    right.schemaVersion === WORK_ITEM_FINGERPRINT_SCHEMA_VERSION &&
    left.hash === right.hash,
  );
}

function asWorkItemFingerprint(input: unknown): WorkItemFingerprint | null {
  const record = asRecord(input);
  const componentHashes = asRecord(record?.componentHashes);
  if (
    !record ||
    record.schemaVersion !== WORK_ITEM_FINGERPRINT_SCHEMA_VERSION ||
    typeof record.hash !== "string" ||
    !componentHashes
  ) {
    return null;
  }
  const parsedComponentHashes = Object.fromEntries(
    Object.entries(componentHashes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return {
    schemaVersion: WORK_ITEM_FINGERPRINT_SCHEMA_VERSION,
    hash: record.hash,
    componentHashes: {
      identity: parsedComponentHashes.identity ?? "",
      referral: parsedComponentHashes.referral ?? "",
      oasis: parsedComponentHashes.oasis ?? "",
      planOfCare: parsedComponentHashes.planOfCare ?? "",
    },
  };
}

function selectSeedArtifactPathsForFingerprint(input: {
  previous: WorkItemFingerprint | null | undefined;
  current: WorkItemFingerprint;
}): string[] | null {
  if (isSameWorkItemFingerprint(input.previous, input.current)) {
    return null;
  }

  if (!input.previous || input.previous.schemaVersion !== input.current.schemaVersion) {
    return [];
  }

  const artifactPaths = new Set<string>();
  if (input.previous.componentHashes.referral === input.current.componentHashes.referral) {
    REFERRAL_MEMORY_ARTIFACTS.forEach((relativePath) => artifactPaths.add(relativePath));
  }
  if (input.previous.componentHashes.oasis === input.current.componentHashes.oasis) {
    OASIS_MEMORY_ARTIFACTS.forEach((relativePath) => artifactPaths.add(relativePath));
  }
  if (input.previous.componentHashes.planOfCare === input.current.componentHashes.planOfCare) {
    PLAN_VISIT_MEMORY_ARTIFACTS.forEach((relativePath) => artifactPaths.add(relativePath));
  }
  return [...artifactPaths];
}

function filterEligibleWorkItems(
  workItems: PatientEpisodeWorkItem[],
  manifest: BatchManifest,
): PatientEpisodeWorkItem[] {
  const eligibleIds = new Set(manifest.automationEligibleWorkItemIds);
  return workItems.filter((workItem) => eligibleIds.has(workItem.id));
}

function selectSampleWorkItems(input: {
  workItems: PatientEpisodeWorkItem[];
  patientIds?: string[] | null;
  limit?: number | null;
}): PatientEpisodeWorkItem[] {
  const limit = input.limit && input.limit > 0 ? input.limit : 5;
  if (input.patientIds && input.patientIds.length > 0) {
    const requestedIds = Array.from(
      new Set(input.patientIds.map((patientId) => patientId.trim()).filter((patientId) => patientId.length > 0)),
    );
    return requestedIds
      .map((patientId) => input.workItems.find((workItem) => workItem.id === patientId) ?? null)
      .filter((workItem): workItem is PatientEpisodeWorkItem => workItem !== null);
  }

  return input.workItems.slice(0, limit);
}

type PatientArtifactOverlay = {
  rootDirectory: string;
  patientArtifactsDirectory: string;
  patientDashboardStatePath: string;
  resultBundlePath: string | null;
  logPath: string | null;
  evidenceDirectory: string;
  modifiedAt: string;
};

type DashboardReadContext = {
  batch: BatchRecord;
  workItemsPromise: Promise<PatientEpisodeWorkItem[]> | null;
  workItemsByIdPromise: Promise<Map<string, PatientEpisodeWorkItem>> | null;
  patientRunsByWorkItemId: Map<string, BatchRecord["patientRuns"][number]>;
  preferredOverlaysByPatientId: Map<string, Promise<PatientArtifactOverlay | null>>;
  resolvedSummariesByWorkItemId: Map<string, Promise<BatchRecord["patientRuns"][number]>>;
  patientRunDetailsByPath: Map<string, Promise<PatientRun>>;
  jsonArtifactsByPath: Map<string, Promise<unknown | null>>;
};

type KnownPatientArtifacts = {
  batch: BatchRecord;
  summary: BatchRecord["patientRuns"][number];
  detail: PatientRun | null;
  workItem: PatientEpisodeWorkItem | null;
  patientArtifactsDirectory: string;
  artifactPaths: {
    codingInput: string;
    documentText: string;
    qaPrefetch: string | null;
    patientQaReference: string;
    qaDocumentSummary: string;
    fieldMapSnapshot: string;
    referralIntakeState?: string | null;
    oasisCheckState?: string | null;
    referralSourceDocumentsManifest?: string | null;
    referralDocumentResultsManifest?: string | null;
    patientPortalStatusSnapshot?: string | null;
    printedNoteChartValues: string | null;
    printedNoteReview: string | null;
    oasisDomExtractedState?: string | null;
    oasisDomAcquisitionState?: string | null;
    oasisDomComparison?: string | null;
    sourceClinicalFactPack?: string | null;
    documentFactPack?: string | null;
    oasisClinicalFactPack?: string | null;
    referralExtractedFacts?: string | null;
    planOfCareReviewDraft?: string | null;
    generatedPlanOfCare?: string | null;
    visitNotesDiscovery?: string | null;
    visitNoteProcessingManifest?: string | null;
    visitNoteQaReview?: string | null;
    oasisDomSectionProcessingManifest?: string | null;
    oasisDomSectionOutputs?: string | null;
    oasisAssessmentProcessingManifest?: string | null;
    patientRunCacheSummary?: string | null;
  };
  artifactContents: {
    codingInput: unknown | null;
    documentText: unknown | null;
    qaPrefetch: unknown | null;
    patientQaReference: unknown | null;
    qaDocumentSummary: unknown | null;
    fieldMapSnapshot: unknown | null;
    referralIntakeState?: unknown | null;
    oasisCheckState?: unknown | null;
    referralSourceDocumentsManifest?: unknown | null;
    referralDocumentResultsManifest?: unknown | null;
    referralDocumentArtifacts?: unknown | null;
    patientPortalStatusSnapshot?: unknown | null;
    printedNoteChartValues: unknown | null;
    printedNoteReview: unknown | null;
    oasisDomExtractedState?: unknown | null;
    oasisDomAcquisitionState?: unknown | null;
    oasisDomComparison?: unknown | null;
    sourceClinicalFactPack?: unknown | null;
    documentFactPack?: unknown | null;
    oasisClinicalFactPack?: unknown | null;
    referralExtractedFacts?: unknown | null;
    planOfCareReviewDraft?: unknown | null;
    generatedPlanOfCare?: unknown | null;
    visitNotesDiscovery?: unknown | null;
    visitNoteProcessingManifest?: unknown | null;
    visitNoteQaReview?: unknown | null;
    oasisDomSectionProcessingManifest?: unknown | null;
    oasisDomSectionOutputs?: unknown | null;
    oasisAssessmentProcessingManifest?: unknown | null;
    oasisAssessmentArtifacts?: unknown | null;
    patientRunCacheSummary?: unknown | null;
  };
};

const DASHBOARD_PATIENT_SUMMARY_CONCURRENCY = 12;

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

export class BatchControlPlaneService {
  private readonly activeBatchJobs = new Map<string, Promise<void>>();
  private readonly batchUpdateLocks = new Map<string, Promise<void>>();
  private readonly activeClinicalRefreshJobs = new Map<string, Promise<void>>();
  private readonly activeReferralIntakeJobs = new Map<string, Promise<void>>();
  private readonly activeOasisCheckJobs = new Map<string, Promise<void>>();
  private rerunTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: FilesystemBatchRepository,
    private readonly scheduledRunRepository: FilesystemScheduledRunRepository,
    private readonly patientMemoryService: PatientMemoryService,
    private readonly acquisitionService: WorkbookAcquisitionService,
    private readonly subsidiaryConfigService: SubsidiaryConfigService,
    private readonly logger: Logger,
    private readonly options: BatchControlPlaneOptions = {},
  ) {}

  private get deltaRunWeekdays(): readonly WeekdayName[] {
    return this.options.deltaRunWeekdays ?? DEFAULT_DELTA_RUN_WEEKDAYS;
  }

  private get workbookIntakeDay(): WeekdayName {
    return this.options.workbookIntakeDay ?? DEFAULT_WORKBOOK_INTAKE_DAY;
  }

  private get workbookIntakeLocalTime(): string {
    return this.options.workbookIntakeLocalTime ?? DEFAULT_WORKBOOK_INTAKE_LOCAL_TIME;
  }

  private ensureSchedulePointers(batch: BatchRecord, fromIsoTimestamp: string): void {
    if (!batch.schedule.active || !batch.schedule.rerunEnabled) {
      batch.schedule.nextWorkbookIntakeAt = null;
      batch.schedule.nextDeltaRunAt = null;
      batch.schedule.nextScheduledRunAt = null;
      return;
    }

    batch.schedule.nextWorkbookIntakeAt =
      batch.schedule.nextWorkbookIntakeAt ??
      calculateNextWorkbookIntakeAt({
        fromIsoTimestamp,
        timezone: batch.schedule.timezone,
        weekday: this.workbookIntakeDay,
        localTime: this.workbookIntakeLocalTime,
      });
    batch.schedule.nextDeltaRunAt =
      batch.schedule.nextDeltaRunAt ??
      calculateNextWeekdayDeltaRunAt({
        fromIsoTimestamp,
        timezone: batch.schedule.timezone,
        weekdays: this.deltaRunWeekdays,
        localTimes: batch.schedule.localTimes,
        intervalHours: batch.schedule.intervalHours,
      });
    batch.schedule.nextScheduledRunAt = earliestTimestamp(
      batch.schedule.nextWorkbookIntakeAt,
      batch.schedule.nextDeltaRunAt,
    );
  }

  private markWorkbookIntakeAcquired(batch: BatchRecord, acquiredAt: string): void {
    batch.schedule.lastWorkbookAcquiredAt = acquiredAt;
    batch.schedule.nextWorkbookIntakeAt =
      batch.schedule.active && batch.schedule.rerunEnabled
        ? calculateNextWorkbookIntakeAt({
            fromIsoTimestamp: acquiredAt,
            timezone: batch.schedule.timezone,
            weekday: this.workbookIntakeDay,
            localTime: this.workbookIntakeLocalTime,
          })
        : null;
    this.ensureSchedulePointers(batch, acquiredAt);
  }

  private markDeltaRunCompleted(batch: BatchRecord, completedAt: string): void {
    batch.schedule.lastRunAt = completedAt;
    batch.schedule.lastDeltaRunAt = completedAt;
    batch.schedule.nextDeltaRunAt =
      batch.schedule.active && batch.schedule.rerunEnabled
        ? calculateNextWeekdayDeltaRunAt({
            fromIsoTimestamp: completedAt,
            timezone: batch.schedule.timezone,
            weekdays: this.deltaRunWeekdays,
            localTimes: batch.schedule.localTimes,
            intervalHours: batch.schedule.intervalHours,
          })
        : null;
    this.ensureSchedulePointers(batch, completedAt);
  }

  async initialize(): Promise<void> {
    await this.repository.ensureReady();
    await this.scheduledRunRepository.ensureReady();
    await this.patientMemoryService.ensureReady();
    await this.subsidiaryConfigService.initialize();
    await this.reconcileInterruptedBatches();
    if (this.options.autonomousMode !== "manual_only") {
      await this.ensureAutonomousAgencyBatches();
      this.ensureScheduler();
      await this.triggerDueScheduledRuns();
    }
  }

  async createBatchUpload(input: {
    fileName: string;
    fileBuffer: Buffer;
    billingPeriod?: string | null;
    subsidiaryId?: string | null;
  }): Promise<BatchRecord> {
    return this.createBatchFromProvider({
      providerId: "MANUAL_UPLOAD",
      billingPeriod: input.billingPeriod ?? null,
      originalFileName: input.fileName,
      subsidiaryId: input.subsidiaryId ?? null,
      input: {
        fileName: input.fileName,
        fileBuffer: input.fileBuffer,
      },
    });
  }

  async createBatchFromProvider(params: CreateBatchFromProviderParams): Promise<BatchRecord> {
    const { batch, subsidiary } = await this.createPendingBatchFromProvider(params);
    return this.acquireWorkbookForBatch(batch, subsidiary, params);
  }

  private async createPendingBatchFromProvider(params: CreateBatchFromProviderParams): Promise<{
    batch: BatchRecord;
    subsidiary: SubsidiaryRecord;
  }> {
    const subsidiary = params.subsidiaryId
      ? await this.subsidiaryConfigService.getSubsidiaryConfig(params.subsidiaryId)
      : await this.subsidiaryConfigService.getDefaultActiveSubsidiary();
    const batchId = createBatchId(subsidiary.slug);
    const fileName = params.originalFileName?.trim() || "finale-workbook.xlsx";
    const paths = this.repository.createBatchPaths(batchId, fileName, subsidiary.slug);
    const now = new Date().toISOString();

    const batch: BatchRecord = {
      id: batchId,
      subsidiary: {
        id: subsidiary.id,
        slug: subsidiary.slug,
        name: subsidiary.name,
      },
      createdAt: now,
      updatedAt: now,
      runMode: "read_only",
      billingPeriod: params.billingPeriod ?? null,
      status: "CREATED",
      schedule: createBatchSchedule(
        now,
        subsidiary,
        this.options.scheduleLocalTimes ?? DEFAULT_REFRESH_LOCAL_TIMES,
        {
          workbookIntakeDay: this.options.workbookIntakeDay,
          workbookIntakeLocalTime: this.options.workbookIntakeLocalTime,
          deltaRunWeekdays: this.options.deltaRunWeekdays,
        },
      ),
      sourceWorkbook: {
        subsidiaryId: subsidiary.id,
        acquisitionProvider: params.providerId,
        acquisitionStatus: "PENDING",
        acquisitionReference: null,
        acquisitionNotes: [],
        acquisitionMetadata: null,
        originalFileName: fileName,
        storedPath: paths.sourceWorkbookPath,
        uploadedAt: now,
        verification: null,
      },
      storage: {
        batchRoot: paths.batchRoot,
        outputRoot: paths.outputRoot,
        manifestPath: null,
        workItemsPath: null,
        parserExceptionsPath: null,
        batchSummaryPath: null,
        patientResultsDirectory: paths.patientResultsDirectory,
        evidenceDirectory: paths.evidenceDirectory,
      },
      parse: {
        requestedAt: null,
        completedAt: null,
        workItemCount: 0,
        eligibleWorkItemCount: 0,
        parserExceptionCount: 0,
        sourceDetections: [],
        sheetSummaries: [],
        lastError: null,
      },
      run: {
        requestedAt: null,
        completedAt: null,
        patientRunCount: 0,
        lastError: null,
      },
      patientRuns: [],
    };

    await this.repository.saveBatch(batch);

    return { batch, subsidiary };
  }

  private async acquireWorkbookForBatch(
    batch: BatchRecord,
    subsidiary: SubsidiaryRecord,
    params: CreateBatchFromProviderParams,
  ): Promise<BatchRecord> {
    try {
      const acquisition = await this.acquisitionService.acquireWorkbook({
        batch,
        billingPeriod: params.billingPeriod ?? null,
        providerId: params.providerId,
        input: params.input,
      });

      batch.updatedAt = acquisition.acquiredAt;
      batch.sourceWorkbook.acquisitionStatus = "ACQUIRED";
      batch.sourceWorkbook.acquisitionReference = acquisition.acquisitionReference;
      batch.sourceWorkbook.acquisitionNotes = acquisition.notes;
      batch.sourceWorkbook.acquisitionMetadata = acquisition.acquisitionMetadata ?? null;
      batch.sourceWorkbook.originalFileName = acquisition.originalFileName;
      batch.sourceWorkbook.storedPath = acquisition.storedPath;
      batch.sourceWorkbook.uploadedAt = acquisition.acquiredAt;
      batch.sourceWorkbook.verification = acquisition.verification ?? null;
      if (params.providerId === "FINALE") {
        this.markWorkbookIntakeAcquired(batch, acquisition.acquiredAt);
      }
      await this.repository.saveBatch(batch);

      const scheduledRun = await this.createOrRefreshScheduledRun(batch, subsidiary, acquisition.acquiredAt);
      batch.schedule.scheduledRunId = scheduledRun.id;
      await this.repository.saveBatch(batch);

      await this.deactivateOtherActiveSchedules(batch.id, batch.subsidiary.id, acquisition.acquiredAt);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          subsidiarySlug: batch.subsidiary.slug,
          acquisitionProvider: params.providerId,
          rerunEnabled: batch.schedule.rerunEnabled,
          runMode: batch.runMode,
        },
        "workbook uploaded and batch created",
      );
      return batch;
    } catch (error) {
      await this.markWorkbookAcquisitionFailed(
        batch.id,
        error,
        "Unknown workbook acquisition error.",
      );
      throw error;
    }
  }

  private async markWorkbookAcquisitionFailed(
    batchId: string,
    error: unknown,
    fallbackMessage: string,
  ): Promise<BatchRecord | null> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      return null;
    }

    const message = error instanceof Error ? error.message : fallbackMessage;
    batch.status = "FAILED";
    batch.updatedAt = new Date().toISOString();
    batch.sourceWorkbook.acquisitionStatus = "FAILED";
    batch.sourceWorkbook.acquisitionMetadata = null;
    batch.sourceWorkbook.acquisitionNotes = [message];
    batch.sourceWorkbook.verification = null;
    batch.parse.completedAt = batch.parse.completedAt ?? batch.updatedAt;
    batch.parse.lastError = message;
    batch.run.completedAt = batch.run.completedAt ?? batch.updatedAt;
    batch.run.lastError = message;
    await this.repository.saveBatch(batch);
    return batch;
  }

  async listBatches(): Promise<BatchRecord[]> {
    return this.repository.listBatches();
  }

  async listAgencies(): Promise<Agency[]> {
    const subsidiaries = await this.subsidiaryConfigService.listSubsidiaries();
    return subsidiaries.map((subsidiary) => ({
      id: subsidiary.id,
      slug: subsidiary.slug,
      name: subsidiary.name,
      status: subsidiary.status,
      timezone: subsidiary.timezone,
    }));
  }

  async startAgencyRefresh(agencyId: string, options: RunControlOptions = {}): Promise<BatchRecord> {
    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(agencyId);
    const batches = await this.repository.listBatches();
    const activeBatch = batches.find((batch) =>
      batchBelongsToSubsidiary(batch, subsidiary) && this.activeBatchJobs.has(batch.id),
    );
    if (activeBatch) {
      throw new Error(`Agency refresh already running for ${subsidiary.name}.`);
    }

    const exportName = `${subsidiary.slug}-oasis-30-days.xlsx`;
    const params: CreateBatchFromProviderParams = {
      providerId: "FINALE",
      subsidiaryId: subsidiary.id,
      originalFileName: exportName,
      input: {
        exportName,
      },
    };
    const { batch } = await this.createPendingBatchFromProvider(params);
    const now = new Date().toISOString();
    batch.status = "RUNNING";
    batch.updatedAt = now;
    batch.run.requestedAt = now;
    batch.run.completedAt = null;
    batch.run.lastError = null;
    await this.repository.saveBatch(batch);

    const task = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        void this.executeAgencyRefresh(batch.id, subsidiary, params, options).then(resolve, reject);
      });
    });
    this.activeBatchJobs.set(batch.id, task);
    void task;
    return batch;
  }

  async triggerAgencyRefresh(agencyId: string, options: RunControlOptions = {}): Promise<BatchRecord> {
    const batch = await this.startAgencyRefresh(agencyId, options);
    await this.activeBatchJobs.get(batch.id);
    return (await this.repository.getBatch(batch.id)) ?? batch;
  }

  private async executeAgencyRefresh(
    batchId: string,
    subsidiary: SubsidiaryRecord,
    params: CreateBatchFromProviderParams,
    options: RunControlOptions,
  ): Promise<void> {
    const initialTask = this.activeBatchJobs.get(batchId);
    try {
      const pendingBatch = await this.mustGetBatch(batchId);
      const acquiredBatch = await this.acquireWorkbookForBatch(pendingBatch, subsidiary, params);
      await this.parseBatch(acquiredBatch.id, { allowActiveJob: true });
      const refreshedBatch = await this.startBatchRun(acquiredBatch.id, options, { allowActiveJob: true });
      await this.removeSupersededAgencyBatches(refreshedBatch);
      if (this.activeBatchJobs.get(batchId) === initialTask) {
        this.activeBatchJobs.delete(batchId);
      }
    } catch (error) {
      await this.markWorkbookAcquisitionFailed(
        batchId,
        error,
        "Unknown agency refresh error.",
      );
      this.activeBatchJobs.delete(batchId);
      this.logger.error(
        {
          batchId,
          subsidiaryId: subsidiary.id,
          errorMessage: error instanceof Error ? error.message : "Unknown agency refresh error.",
        },
        "agency refresh failed",
      );
    }
  }

  async createPatientSampleBatch(input: {
    sourceBatchId: string;
    patientIds?: string[] | null;
    limit?: number | null;
    seedFromMemory?: boolean;
  }): Promise<BatchRecord> {
    const sourceBatch = await this.mustGetBatch(input.sourceBatchId);
    if (this.activeBatchJobs.has(sourceBatch.id)) {
      throw new Error(`Source batch is already running: ${sourceBatch.id}`);
    }

    const sourceManifest = await this.repository.readManifest(sourceBatch);
    const sourceWorkItems = await this.repository.readWorkItems(sourceBatch);
    const parserExceptions = await this.repository.readParserExceptions(sourceBatch);
    const eligibleWorkItems = filterEligibleWorkItems(sourceWorkItems, sourceManifest);
    const selectedWorkItems = selectSampleWorkItems({
      workItems: eligibleWorkItems,
      patientIds: input.patientIds ?? null,
      limit: input.limit ?? 5,
    });

    if (selectedWorkItems.length === 0) {
      throw new Error(`No eligible patients were selected from batch: ${sourceBatch.id}`);
    }

    const batchId = createBatchId(`${sourceBatch.subsidiary.slug}-sample`);
    const paths = this.repository.createBatchPaths(
      batchId,
      sourceBatch.sourceWorkbook.originalFileName,
      sourceBatch.subsidiary.slug,
    );
    const now = new Date().toISOString();
    const manifestPath = path.join(paths.outputRoot, "batch-manifest.json");
    const workItemsPath = path.join(paths.outputRoot, "work-items.json");
    const parserExceptionsPath = path.join(paths.outputRoot, "parser-exceptions.json");
    await mkdir(path.dirname(paths.sourceWorkbookPath), { recursive: true });
    await copyFile(sourceBatch.sourceWorkbook.storedPath, paths.sourceWorkbookPath);
    const manifest: BatchManifest = {
      ...sourceManifest,
      batchId,
      workbookPath: paths.sourceWorkbookPath,
      outputDirectory: paths.outputRoot,
      totalWorkItems: selectedWorkItems.length,
      parserExceptionCount: parserExceptions.length,
      automationEligibleWorkItemIds: selectedWorkItems.map((workItem) => workItem.id),
      blockedWorkItemIds: [],
    };

    await writeJsonFile(manifestPath, manifest);
    await writeJsonFile(workItemsPath, selectedWorkItems);
    await writeJsonFile(parserExceptionsPath, parserExceptions);

    const batch: BatchRecord = {
      id: batchId,
      subsidiary: {
        ...sourceBatch.subsidiary,
      },
      createdAt: now,
      updatedAt: now,
      runMode: sourceBatch.runMode,
      billingPeriod: sourceBatch.billingPeriod,
      status: "READY",
      schedule: {
        scheduledRunId: null,
        active: false,
        rerunEnabled: false,
        intervalHours: sourceBatch.schedule.intervalHours,
        timezone: sourceBatch.schedule.timezone,
        localTimes: [...sourceBatch.schedule.localTimes],
        lastRunAt: null,
        nextScheduledRunAt: null,
      },
      sourceWorkbook: {
        ...sourceBatch.sourceWorkbook,
        acquisitionNotes: [
          ...sourceBatch.sourceWorkbook.acquisitionNotes,
          `Sample patient batch created from ${sourceBatch.id}.`,
        ],
        storedPath: paths.sourceWorkbookPath,
      },
      storage: {
        batchRoot: paths.batchRoot,
        outputRoot: paths.outputRoot,
        manifestPath,
        workItemsPath,
        parserExceptionsPath,
        batchSummaryPath: null,
        patientResultsDirectory: paths.patientResultsDirectory,
        evidenceDirectory: paths.evidenceDirectory,
      },
      parse: {
        requestedAt: sourceBatch.parse.requestedAt ?? sourceBatch.createdAt,
        completedAt: sourceBatch.parse.completedAt ?? now,
        workItemCount: selectedWorkItems.length,
        eligibleWorkItemCount: selectedWorkItems.length,
        parserExceptionCount: parserExceptions.length,
        sourceDetections: sourceBatch.parse.sourceDetections,
        sheetSummaries: sourceBatch.parse.sheetSummaries,
        lastError: null,
      },
      run: {
        requestedAt: null,
        completedAt: null,
        patientRunCount: 0,
        lastError: null,
      },
      patientRuns: [],
    };

    batch.patientRuns = selectedWorkItems.map((workItem) => createPendingPatientRunState(batch, workItem));
    await this.repository.saveBatch(batch);
    if (this.options.deltaReuseEnabled && input.seedFromMemory !== false) {
      await this.seedPatientMemoryForWorkItems(batch, selectedWorkItems, { overwrite: false });
    }
    return batch;
  }

  private async ensureAutonomousAgencyBatches(): Promise<void> {
    const subsidiaries = await this.subsidiaryConfigService.listSubsidiaries();
    const batches = await this.repository.listBatches();

    for (const subsidiary of subsidiaries) {
      if (subsidiary.status !== "ACTIVE") {
        continue;
      }

      const activeAgencyBatch = batches.find((batch) =>
        batchBelongsToSubsidiary(batch, subsidiary) &&
        batch.schedule.active &&
        batch.sourceWorkbook.acquisitionProvider === "FINALE" &&
        batch.sourceWorkbook.acquisitionStatus === "ACQUIRED"
      );
      if (activeAgencyBatch) {
        continue;
      }

      try {
        const batch = await this.createBatchFromProvider({
          providerId: "FINALE",
          subsidiaryId: subsidiary.id,
          originalFileName: `${subsidiary.slug}-oasis-30-days.xlsx`,
          input: {
            exportName: `${subsidiary.slug}-oasis-30-days.xlsx`,
          },
        });
        await this.parseBatch(batch.id);
        const startedBatch = await this.startBatchRun(batch.id);
        await this.removeSupersededAgencyBatches(startedBatch);
        this.logger.info(
          {
            batchId: batch.id,
            subsidiaryId: subsidiary.id,
            subsidiarySlug: subsidiary.slug,
          },
          "initialized autonomous Finale workbook batch for active agency",
        );
      } catch (error) {
        this.logger.error(
          {
            subsidiaryId: subsidiary.id,
            subsidiarySlug: subsidiary.slug,
            errorMessage:
              error instanceof Error ? error.message : "Unknown autonomous workbook bootstrap error.",
          },
          "failed to initialize autonomous Finale workbook batch for active agency",
        );
      }
    }
  }

  async getBatch(batchId: string): Promise<BatchRecord | null> {
    return this.repository.getBatch(batchId);
  }

  async migratePatientMemory(input: {
    agencyId?: string | null;
    dryRun?: boolean;
    now?: Date;
  } = {}): Promise<{
    migrationId: string;
    generatedAt: string;
    agencyFilter: string | null;
    scannedBatchCount: number;
    promotedPatientCount: number;
    skippedPatientCount: number;
    failureCount: number;
    failures: Array<{ batchId: string; workItemId: string; reason: string }>;
    summaryPath: string | null;
  }> {
    if (this.options.patientMemoryWriteEnabled === false && input.dryRun !== true) {
      throw new Error("Patient memory migration requires PATIENT_MEMORY_WRITE_ENABLED=true.");
    }

    const generatedAt = (input.now ?? new Date()).toISOString();
    const migrationId = `patient-memory-migration-${generatedAt}`;
    const batches = await this.repository.listBatches();
    const agencyFilter = input.agencyId?.trim() || null;
    const agencyRecord = agencyFilter
      ? await this.subsidiaryConfigService.getSubsidiaryConfig(agencyFilter)
      : null;
    const filteredBatches = agencyRecord
      ? batches.filter((batch) => batchBelongsToSubsidiary(batch, agencyRecord))
      : batches;
    const failures: Array<{ batchId: string; workItemId: string; reason: string }> = [];
    let promotedPatientCount = 0;
    let skippedPatientCount = 0;

    for (const batch of filteredBatches) {
      if (this.activeBatchJobs.has(batch.id)) {
        skippedPatientCount += batch.patientRuns.length;
        failures.push({
          batchId: batch.id,
          workItemId: "*",
          reason: "batch_active",
        });
        continue;
      }

      const promotableRuns = [];
      for (const patientRun of batch.patientRuns) {
        const patientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", patientRun.workItemId);
        if (!(await this.repository.fileExists(patientArtifactsDirectory))) {
          skippedPatientCount += 1;
          continue;
        }
        promotableRuns.push(patientRun);
      }

      if (input.dryRun === true) {
        promotedPatientCount += promotableRuns.length;
        continue;
      }

      const promotionFailures = await this.promoteBatchPatientsToMemory(batch);
      promotedPatientCount += Math.max(0, promotableRuns.length - promotionFailures.length);
      skippedPatientCount += batch.patientRuns.length - promotableRuns.length;
      for (const workItemId of promotionFailures) {
        failures.push({
          batchId: batch.id,
          workItemId,
          reason: "promotion_failed",
        });
      }
    }

    const summary = {
      schemaVersion: "patient-memory-migration-summary.v1",
      migrationId,
      generatedAt,
      agencyFilter,
      dryRun: input.dryRun === true,
      scannedBatchCount: filteredBatches.length,
      promotedPatientCount,
      skippedPatientCount,
      failureCount: failures.length,
      failures,
    };
    const summaryPath =
      filteredBatches[0] && input.dryRun !== true
        ? await this.patientMemoryService.writeMigrationSummary(
            filteredBatches[0].subsidiary.slug,
            migrationId,
            summary,
          )
        : null;

    return {
      ...summary,
      summaryPath,
    };
  }

  async parseBatch(
    batchId: string,
    options: BatchRunStartOptions = {},
  ): Promise<BatchRecord> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (this.activeBatchJobs.has(batchId) && !options.allowActiveJob) {
      throw new Error(`Batch is already running: ${batchId}`);
    }

    const now = new Date().toISOString();
    batch.status = "PARSING";
    batch.updatedAt = now;
    batch.parse.requestedAt = now;
    batch.parse.lastError = null;
    await this.repository.saveBatch(batch);

    try {
      const result = await intakeWorkbook({
        batchId: batch.id,
        subsidiaryId: batch.subsidiary.id,
        workbookPath: batch.sourceWorkbook.storedPath,
        outputDir: batch.storage.outputRoot,
        ingestedAt: batch.sourceWorkbook.uploadedAt,
        workbookOriginalFileName: batch.sourceWorkbook.originalFileName,
        workbookSourceKind: mapWorkbookSourceKind(batch.sourceWorkbook.acquisitionProvider),
        workbookAcquisitionMetadata: batch.sourceWorkbook.acquisitionMetadata ?? {
          providerId: batch.sourceWorkbook.acquisitionProvider,
          acquisitionReference: batch.sourceWorkbook.acquisitionReference,
          metadataPath: batch.sourceWorkbook.acquisitionReference,
          selectedAgencyName: null,
          selectedAgencyUrl: null,
          dashboardUrl: null,
          notes: batch.sourceWorkbook.acquisitionNotes,
        },
        workbookVerification: batch.sourceWorkbook.verification,
        reviewWindowTimezone: batch.schedule.timezone,
      });
      const eligibleWorkItemIds = new Set(
        result.patientQueue.entries
          .filter((entry) => entry.status === "eligible")
          .map((entry) => entry.workItemId),
      );
      const eligibleWorkItems = result.workItems.filter((workItem) => eligibleWorkItemIds.has(workItem.id));

      batch.status = "READY";
      batch.updatedAt = new Date().toISOString();
      batch.billingPeriod = result.manifest.billingPeriod ?? batch.billingPeriod;
      batch.storage.manifestPath = result.manifestPath;
      batch.storage.workItemsPath = result.workItemsPath;
      batch.storage.parserExceptionsPath = result.parserExceptionsPath;
      batch.storage.batchSummaryPath = null;
      batch.parse.completedAt = batch.updatedAt;
      batch.parse.workItemCount = result.workItems.length;
      batch.parse.eligibleWorkItemCount = result.patientQueue.summary.eligible;
      batch.parse.parserExceptionCount = result.parserExceptions.length;
      batch.parse.sourceDetections = result.diagnostics.sourceDetections;
      batch.parse.sheetSummaries = result.diagnostics.sheetSummaries;
      batch.parse.lastError = null;
      batch.run.requestedAt = null;
      batch.run.completedAt = null;
      batch.run.patientRunCount = 0;
      batch.run.lastError = null;
      batch.patientRuns = eligibleWorkItems.map((workItem) =>
        createPendingPatientRunState(batch, workItem),
      );
      await this.repository.saveBatch(batch);
      if (this.options.deltaReuseEnabled) {
        await this.seedPatientMemoryForWorkItems(batch, eligibleWorkItems, { overwrite: false });
      }

      this.logger.info(
        {
          batchId,
          subsidiaryId: batch.subsidiary.id,
          workItems: result.workItems.length,
        },
        "batch parsed",
      );
      return batch;
    } catch (error) {
      batch.status = "FAILED";
      batch.updatedAt = new Date().toISOString();
      batch.parse.completedAt = batch.updatedAt;
      batch.parse.lastError = error instanceof Error ? error.message : "Unknown parse error.";
      await this.repository.saveBatch(batch);
      throw error;
    }
  }

  async startBatchRun(
    batchId: string,
    options: RunControlOptions = {},
    startOptions: BatchRunStartOptions = {},
  ): Promise<BatchRecord> {
    let batch = await this.mustGetBatch(batchId);

    if (this.activeBatchJobs.has(batchId) && !startOptions.allowActiveJob) {
      return batch;
    }

    if (batch.status === "CREATED" || (batch.status === "PARSING" && !batch.storage.manifestPath)) {
      batch = await this.parseBatch(batchId, { allowActiveJob: startOptions.allowActiveJob });
    }

    const manifest = await this.repository.readManifest(batch);
    const workItems = filterEligibleWorkItems(await this.repository.readWorkItems(batch), manifest);
    const deltaReuseEnabled = this.options.deltaReuseEnabled || options.reprojectOnly === true;
    if (options.mode !== "full" && deltaReuseEnabled) {
      await this.seedPatientMemoryForWorkItems(batch, workItems, { overwrite: false });
    }

    if (options.reprojectOnly) {
      return this.reprojectBatchFromPatientMemory(batch, workItems);
    }

    if (isArtifactOnlyClinicalReprocessRequest(options)) {
      await this.seedPatientMemoryForWorkItems(batch, workItems, { overwrite: false });
      batch.patientRuns = workItems.map((workItem) => {
        const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
        return previous ?? createPendingPatientRunState(batch, workItem);
      });
      batch.status = "RUNNING";
      batch.updatedAt = new Date().toISOString();
      batch.run.requestedAt = batch.updatedAt;
      batch.run.completedAt = null;
      batch.run.lastError = null;
      await this.repository.saveBatch(batch);

      const task = this.reprocessClinicalArtifactsFromExistingCaptures(batchId, workItems, options).finally(() => {
        this.activeBatchJobs.delete(batchId);
      });
      this.activeBatchJobs.set(batchId, task);
      void task;

      return batch;
    }

    const plannedRuns = await Promise.all(
      workItems.map(async (workItem) => {
        const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
        const reuseBatchLocal =
          options.mode !== "full" &&
          this.options.deltaReuseEnabled === true &&
          (await canReuseCompletedPatientRun(
            this.repository,
            previous,
            path.join(batch.storage.outputRoot, "patients", workItem.id),
            workItem,
          ));
        const memoryBackedPatientRun =
          !reuseBatchLocal && options.mode !== "full" && this.options.deltaReuseEnabled === true
            ? await this.createMemoryBackedCompletedPatientRun(batch, workItem, previous)
            : null;
        const reuseExisting = reuseBatchLocal || memoryBackedPatientRun !== null;
        return {
          workItem,
          patientRun: reuseBatchLocal && previous
            ? previous
            : memoryBackedPatientRun ?? createPendingPatientRunState(batch, workItem, previous),
          reuseExisting,
        };
      }),
    );

    const workItemsToRun = plannedRuns
      .filter((plannedRun) => !plannedRun.reuseExisting)
      .map((plannedRun) => plannedRun.workItem);

    this.logger.info(
      {
        batchId: batch.id,
        subsidiaryId: batch.subsidiary.id,
        mode: options.mode ?? "delta",
        reprojectOnly: Boolean(options.reprojectOnly),
        totalPatients: plannedRuns.length,
        reusedPatients: plannedRuns.length - workItemsToRun.length,
        patientsToProcess: workItemsToRun.length,
      },
      "batch delta run plan prepared",
    );

    batch.patientRuns = plannedRuns.map((plannedRun) => plannedRun.patientRun);
    batch.status = "RUNNING";
    batch.updatedAt = new Date().toISOString();
    batch.run.requestedAt = batch.updatedAt;
    batch.run.completedAt = null;
    batch.run.lastError = null;
    batch.run.patientRunCount = 0;
    await this.repository.saveBatch(batch);

    if (workItemsToRun.length === 0) {
      batch.status = "COMPLETED";
      batch.updatedAt = new Date().toISOString();
      batch.run.completedAt = batch.updatedAt;
      batch.run.patientRunCount = countProcessedPatientRuns(batch);
      batch.run.lastError = deriveBatchErrorSummary(batch);
      this.markDeltaRunCompleted(batch, batch.updatedAt);
      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          reusedPatients: plannedRuns.length,
        },
        "scheduled batch run skipped because existing patient bundles were reused",
      );
      const postBatchReferralTask = this.runPostBatchReferralIntakePhaseSafely(
        batch.id,
        "no_patient_work_required",
      ).finally(() => {
        this.activeBatchJobs.delete(batch.id);
      });
      this.activeBatchJobs.set(batch.id, postBatchReferralTask);
      void postBatchReferralTask;
      return batch;
    }

    const task = this.executeBatchRun(batchId, workItemsToRun).finally(() => {
      this.activeBatchJobs.delete(batchId);
    });
    this.activeBatchJobs.set(batchId, task);
    void task;

    return batch;
  }

  async startBatchRunDetached(batchId: string, options: RunControlOptions = {}): Promise<BatchRecord> {
    const batch = await this.mustGetBatch(batchId);
    if (this.activeBatchJobs.has(batchId)) {
      return batch;
    }

    const now = new Date().toISOString();
    if (batch.status === "CREATED" || (batch.status === "PARSING" && !batch.storage.manifestPath)) {
      batch.status = "PARSING";
      batch.updatedAt = now;
      batch.parse.requestedAt = batch.parse.requestedAt ?? now;
      batch.parse.completedAt = null;
      batch.parse.lastError = null;
    } else {
      batch.status = "RUNNING";
      batch.updatedAt = now;
      batch.run.requestedAt = now;
      batch.run.completedAt = null;
      batch.run.lastError = null;
    }
    await this.repository.saveBatch(batch);

    const task = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        void this.executeDetachedBatchStart(batch.id, options).then(resolve, reject);
      });
    });
    this.activeBatchJobs.set(batch.id, task);
    void task;
    return batch;
  }

  private async executeDetachedBatchStart(
    batchId: string,
    options: RunControlOptions,
  ): Promise<void> {
    const initialTask = this.activeBatchJobs.get(batchId);
    try {
      await this.startBatchRun(batchId, options, { allowActiveJob: true });
      if (this.activeBatchJobs.get(batchId) === initialTask) {
        this.activeBatchJobs.delete(batchId);
      }
    } catch (error) {
      await this.failBatch(batchId, error, "run");
      this.activeBatchJobs.delete(batchId);
      this.logger.error(
        {
          batchId,
          errorMessage: error instanceof Error ? error.message : "Unknown batch start error.",
        },
        "detached batch start failed",
      );
    }
  }

  async deactivateBatch(batchId: string): Promise<BatchRecord> {
    const batch = await this.mustGetBatch(batchId);
    const now = new Date().toISOString();
    batch.updatedAt = now;
    batch.schedule.active = false;
    batch.schedule.rerunEnabled = false;
    batch.schedule.nextScheduledRunAt = null;
    batch.schedule.nextWorkbookIntakeAt = null;
    batch.schedule.nextDeltaRunAt = null;
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
    this.logger.info(
      { batchId, subsidiaryId: batch.subsidiary.id },
      "batch rerun schedule deactivated",
    );
    return batch;
  }

  async retryBlockedPatientRuns(batchId: string): Promise<BatchRecord> {
    const batch = await this.mustGetBatch(batchId);
    if (this.activeBatchJobs.has(batchId)) {
      return batch;
    }

    const retryCandidates = batch.patientRuns.filter((patientRun) =>
      isRetryEligibleStatus(patientRun.processingStatus),
    );

    if (retryCandidates.length === 0) {
      throw new Error(`No blocked patient runs are eligible for retry in batch: ${batchId}`);
    }

    const workItems = await this.repository.readWorkItems(batch);
    const workItemsToRetry = workItems.filter((workItem) =>
      retryCandidates.some((candidate) => candidate.workItemId === workItem.id),
    );

    const updatedBatch = await this.prepareRetryBatch(batch, workItemsToRetry);
    const task = this.executeRetryWorkItems(updatedBatch.id, workItemsToRetry).finally(() => {
      this.activeBatchJobs.delete(updatedBatch.id);
    });
    this.activeBatchJobs.set(updatedBatch.id, task);
    void task;

    return updatedBatch;
  }

  async getWorkItems(batchId: string): Promise<PatientEpisodeWorkItem[]> {
    const batch = await this.mustGetBatch(batchId);
    return this.repository.readWorkItems(batch);
  }

  async getPatientReferralIntakeStatus(batchId: string, patientId: string): Promise<ReferralIntakeState> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const state = await this.repository.readJsonIfExists<ReferralIntakeState>(
      getReferralIntakeStatePath(patientArtifactsDirectory),
    );
    if (state) {
      const jobKey = this.buildReferralIntakeJobKey(batchId, patientId);
      return this.activeReferralIntakeJobs.has(jobKey) && state.status !== "running"
        ? { ...state, status: "running", message: state.message ?? "Referral intake is running." }
        : state;
    }

    return createReferralIntakeState({
      batchId,
      patientId,
      status: "idle",
      now: new Date().toISOString(),
      message: "Referral intake has not been run for this patient.",
    });
  }

  async getPatientClinicalRefreshStatus(batchId: string, patientId: string): Promise<PatientClinicalRefreshState> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const state = await this.repository.readJsonIfExists<PatientClinicalRefreshState>(
      getClinicalRefreshStatePath(patientArtifactsDirectory),
    );
    const jobKey = this.buildClinicalRefreshJobKey(batch, patientId);
    if (state) {
      const preflight = state.preflight ?? await this.evaluateClinicalRefreshPreflight(batch);
      return this.activeClinicalRefreshJobs.has(jobKey) && state.status !== "running"
        ? { ...state, preflight, status: "running", message: state.message ?? "Patient refresh is running." }
        : { ...state, preflight };
    }

    const preflight = await this.evaluateClinicalRefreshPreflight(batch);
    return createClinicalRefreshState({
      batchId,
      patientId,
      status: "idle",
      now: new Date().toISOString(),
      message: "Patient refresh has not been run.",
      preflight,
    });
  }

  async startPatientClinicalRefresh(
    batchId: string,
    patientId: string,
    options: { targetOasisAssessmentId?: string | null } = {},
  ): Promise<PatientClinicalRefreshState> {
    const batch = await this.mustGetBatch(batchId);
    const targetOasisAssessmentId = options.targetOasisAssessmentId?.trim() || null;
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const jobKey = this.buildClinicalRefreshJobKey(batch, patientId);
    if (this.activeClinicalRefreshJobs.has(jobKey)) {
      throw new ClinicalRefreshAlreadyRunningError(patientId);
    }
    const activePatientRun = await this.findActivePatientChartWorkRunForSubsidiary(batch, patientId);
    if (activePatientRun) {
      throw new ClinicalRefreshAlreadyRunningError(patientId);
    }

    const now = new Date().toISOString();
    const preflight = await this.evaluateClinicalRefreshPreflight(batch);
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const existing = await this.repository.readJsonIfExists<PatientClinicalRefreshState>(
      getClinicalRefreshStatePath(patientArtifactsDirectory),
    );
    if (!preflight.ok) {
      const blockedState = createClinicalRefreshState({
        batchId,
        patientId,
        targetOasisAssessmentId,
        status: "failed",
        now,
        existing,
        preflight,
        message: `Patient refresh is not available: ${preflight.reasons.join("; ")}`,
        lastError: preflight.reasons.join("; "),
      });
      await this.writeClinicalRefreshState(patientArtifactsDirectory, blockedState);
      return blockedState;
    }
    const refreshId = `clinical-refresh-${now.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const attemptOutputRoot = path.join(
      batch.storage.outputRoot,
      "clinical-refresh-attempts",
      patientId,
      refreshId,
    );
    const state = createClinicalRefreshState({
      batchId,
      patientId,
      targetOasisAssessmentId,
      refreshId,
      status: "pending",
      now,
      existing,
      preflight,
      attemptOutputRoot,
      message: targetOasisAssessmentId
        ? "Patient refresh accepted and queued for the selected OASIS assessment."
        : "Patient refresh accepted and queued.",
    });
    await this.writeClinicalRefreshState(patientArtifactsDirectory, state);

    const task = this.executePatientClinicalRefreshJob({
      batchId,
      patientId,
      targetOasisAssessmentId,
      refreshId,
      attemptOutputRoot,
      workItem,
    })
      .catch((error: unknown) => {
        this.logger.error(
          {
            batchId,
            patientId,
            refreshId,
            errorMessage: error instanceof Error ? error.message : "Unknown patient refresh error.",
          },
          "patient clinical refresh job failed",
        );
      })
      .finally(() => {
        this.activeClinicalRefreshJobs.delete(jobKey);
      });
    this.activeClinicalRefreshJobs.set(jobKey, task);
    void task;

    return state;
  }

  async ensurePatientPortalStatusSnapshot(
    batchId: string,
    patientId: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<PatientPortalStatusSnapshot> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const snapshotPath = getPatientPortalStatusSnapshotPath(patientArtifactsDirectory);
    const existingSnapshot = await this.repository.readJsonIfExists<PatientPortalStatusSnapshot>(snapshotPath);
    const existingWithFreshness = existingSnapshot
      ? markPatientPortalStatusSnapshotFreshness(existingSnapshot, now)
      : null;
    const activePatientRun = this.getActivePatientChartWorkRun(batch, patientId);

    if (activePatientRun) {
      if (existingWithFreshness) {
        return existingWithFreshness;
      }
      const pendingSnapshot = createPendingPatientPortalStatusSnapshot({
        batchId,
        patientId,
        patientName: workItem.patientIdentity.displayName,
        now: nowIso,
        activePatientRunStatus: activePatientRun.processingStatus,
      });
      await writeJsonFile(snapshotPath, pendingSnapshot);
      return pendingSnapshot;
    }

    if (!options.forceRefresh && existingWithFreshness?.status === "fresh") {
      return existingWithFreshness;
    }

    const staleAfter = new Date(now.getTime() + PATIENT_PORTAL_STATUS_SNAPSHOT_TTL_MS).toISOString();
    const refreshingSnapshot: PatientPortalStatusSnapshot = {
      ...(existingWithFreshness ?? createPendingPatientPortalStatusSnapshot({
        batchId,
        patientId,
        patientName: workItem.patientIdentity.displayName,
        now: nowIso,
        activePatientRunStatus: null,
      })),
      status: "refreshing",
      generatedAt: nowIso,
      staleAfter,
      activePatientRunStatus: null,
      error: null,
    };
    await writeJsonFile(snapshotPath, refreshingSnapshot);

    const env = loadEnv();
    const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(batch.subsidiary.id);
    const captureResult = await capturePatientPortalStatusSnapshot({
      batchId,
      workItem,
      outputDir: batch.storage.outputRoot,
      patientArtifactsDirectory,
      env,
      logger: this.logger,
      subsidiaryRuntimeConfig,
      staleAfter,
    });
    await writeJsonFile(snapshotPath, captureResult.snapshot);
    return captureResult.snapshot;
  }

  async startPatientReferralIntake(batchId: string, patientId: string): Promise<ReferralIntakeState> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const jobKey = this.buildReferralIntakeJobKey(batchId, patientId);
    if (this.activeReferralIntakeJobs.has(jobKey)) {
      throw new ReferralIntakeAlreadyRunningError(batchId, patientId);
    }

    const now = new Date().toISOString();
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const existing = await this.repository.readJsonIfExists<ReferralIntakeState>(
      getReferralIntakeStatePath(patientArtifactsDirectory),
    );
    const state = createReferralIntakeState({
      batchId,
      patientId,
      status: "pending",
      now,
      existing,
      message: "Referral intake accepted and queued for this patient.",
    });
    await writeJsonFile(getReferralIntakeStatePath(patientArtifactsDirectory), state);

    const task = this.executePatientReferralIntakeJob({
      batchId,
      patientId,
      patientArtifactsDirectory,
      workItem,
      trigger: "manual",
    })
      .catch((error: unknown) => {
        this.logger.error(
          {
            batchId,
            patientId,
            errorMessage: error instanceof Error ? error.message : "Unknown referral intake error.",
          },
          "patient referral intake job failed",
        );
      })
      .finally(() => {
        this.activeReferralIntakeJobs.delete(jobKey);
      });
    this.activeReferralIntakeJobs.set(jobKey, task);
    void task;

    return state;
  }

  async getPatientOasisCheckStatus(
    batchId: string,
    patientId: string,
    assessmentId: string,
  ): Promise<PatientOasisCheckAssessmentState> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }
    if (!assessmentId.trim()) {
      throw new Error("assessmentId is required.");
    }

    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const state = await this.repository.readJsonIfExists<PatientOasisCheckState>(
      getOasisCheckStatePath(patientArtifactsDirectory),
    );
    const existing = state?.checks?.[assessmentId] ?? null;
    const jobKey = this.buildOasisCheckJobKey(batchId, patientId, assessmentId);
    if (existing) {
      return this.activeOasisCheckJobs.has(jobKey) && existing.status !== "running"
        ? { ...existing, status: "running", message: existing.message ?? "OASIS check is running." }
        : existing;
    }

    return createOasisCheckAssessmentState({
      batchId,
      patientId,
      assessmentId,
      status: "idle",
      now: new Date().toISOString(),
      message: "OASIS check has not been run for this assessment.",
    });
  }

  async startPatientOasisCheck(input: {
    batchId: string;
    patientId: string;
    assessmentId: string;
    force?: boolean;
  }): Promise<PatientOasisCheckAssessmentState> {
    const batch = await this.mustGetBatch(input.batchId);
    const workItems = await this.repository.readWorkItems(batch);
    if (!workItems.some((item) => item.id === input.patientId)) {
      throw new Error(`Patient not found: ${input.patientId}`);
    }
    const assessmentId = input.assessmentId.trim();
    if (!assessmentId) {
      throw new Error("assessmentId is required.");
    }

    const jobKey = this.buildOasisCheckJobKey(input.batchId, input.patientId, assessmentId);
    if (this.activeOasisCheckJobs.has(jobKey)) {
      throw new OasisCheckAlreadyRunningError(input.batchId, input.patientId, assessmentId);
    }

    const now = new Date().toISOString();
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, input.patientId);
    const existingState = await this.repository.readJsonIfExists<PatientOasisCheckState>(
      getOasisCheckStatePath(patientArtifactsDirectory),
    );
    const existingAssessmentState = existingState?.checks?.[assessmentId] ?? null;
    const assessmentState = createOasisCheckAssessmentState({
      batchId: input.batchId,
      patientId: input.patientId,
      assessmentId,
      status: "pending",
      now,
      existing: existingAssessmentState,
      message: "OASIS check accepted and queued for this assessment.",
    });
    await this.writeOasisCheckState(patientArtifactsDirectory, createOasisCheckState({
      batchId: input.batchId,
      patientId: input.patientId,
      now,
      existing: existingState,
      assessmentState,
    }));

    const task = this.runPatientOasisCheckJob({
      batchId: input.batchId,
      patientId: input.patientId,
      assessmentId,
    })
      .catch((error: unknown) => {
        this.logger.error(
          {
            batchId: input.batchId,
            patientId: input.patientId,
            assessmentId,
            errorMessage: error instanceof Error ? error.message : "Unknown OASIS check error.",
          },
          "patient OASIS check job failed",
        );
      })
      .finally(() => {
        this.activeOasisCheckJobs.delete(jobKey);
      });
    this.activeOasisCheckJobs.set(jobKey, task);
    void task;

    return assessmentState;
  }

  async getParserExceptions(batchId: string): Promise<ParserException[]> {
    const batch = await this.mustGetBatch(batchId);
    return this.repository.readParserExceptions(batch);
  }

  async getBatchSummary(batchId: string): Promise<BatchSummary | null> {
    const batch = await this.mustGetBatch(batchId);
    return this.repository.readBatchSummary(batch);
  }

  async getPatientRuns(batchId: string): Promise<BatchRecord["patientRuns"]> {
    const batch = await this.mustGetBatch(batchId);
    const context = this.createDashboardReadContext(batch);
    const patientRuns = await Promise.all(
      batch.patientRuns.map((patientRun) =>
        this.resolvePreferredPatientRunSummary(batch, patientRun, context),
      ),
    );
    return patientRuns.sort((left, right) => left.patientName.localeCompare(right.patientName));
  }

  async getPatientRun(runId: string): Promise<{
    batchId: string;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
  } | null> {
    const result = await this.repository.findPatientRun(runId);
    if (!result) {
      return null;
    }

    const summary = result.batch.patientRuns.find((patientRun) => patientRun.runId === runId) ?? null;
    if (!summary) {
      return null;
    }

    return {
      batchId: result.batch.id,
      summary,
      detail: summary.bundleAvailable ? result.patientRun : null,
    };
  }

  async getBatchDetailWithPatients(batchId: string): Promise<{
    batch: BatchRecord;
    patients: BatchRecord["patientRuns"];
  }> {
    const batch = await this.mustGetBatch(batchId);
    const patients = [...batch.patientRuns].sort((left, right) =>
      left.patientName.localeCompare(right.patientName),
    );

    return {
      batch,
      patients,
    };
  }

  private createDashboardReadContext(batch: BatchRecord): DashboardReadContext {
    return {
      batch,
      workItemsPromise: null,
      workItemsByIdPromise: null,
      patientRunsByWorkItemId: new Map(
        batch.patientRuns.map((patientRun) => [patientRun.workItemId, patientRun]),
      ),
      preferredOverlaysByPatientId: new Map(),
      resolvedSummariesByWorkItemId: new Map(),
      patientRunDetailsByPath: new Map(),
      jsonArtifactsByPath: new Map(),
    };
  }

  private async getContextWorkItems(context: DashboardReadContext): Promise<PatientEpisodeWorkItem[]> {
    context.workItemsPromise ??= this.repository.readWorkItems(context.batch);
    return context.workItemsPromise;
  }

  private async getContextWorkItemsById(
    context: DashboardReadContext,
  ): Promise<Map<string, PatientEpisodeWorkItem>> {
    context.workItemsByIdPromise ??= this.getContextWorkItems(context).then(
      (workItems) => new Map(workItems.map((workItem) => [workItem.id, workItem])),
    );
    return context.workItemsByIdPromise;
  }

  private async getContextWorkItem(
    context: DashboardReadContext,
    patientId: string,
  ): Promise<PatientEpisodeWorkItem | null> {
    return (await this.getContextWorkItemsById(context)).get(patientId) ?? null;
  }

  private async readPatientRunWithContext(
    context: DashboardReadContext | null,
    bundlePath: string,
  ): Promise<PatientRun> {
    if (!context) {
      return this.repository.readPatientRun(bundlePath);
    }

    const cacheKey = path.resolve(bundlePath);
    let cached = context.patientRunDetailsByPath.get(cacheKey);
    if (!cached) {
      cached = this.repository.readPatientRun(bundlePath);
      context.patientRunDetailsByPath.set(cacheKey, cached);
    }
    return cached;
  }

  private async readJsonIfExistsWithContext<T = unknown>(
    context: DashboardReadContext | null,
    filePath: string | null | undefined,
  ): Promise<T | null> {
    if (!filePath) {
      return null;
    }
    if (!context) {
      return this.repository.readJsonIfExists<T>(filePath);
    }

    const cacheKey = path.resolve(filePath);
    let cached = context.jsonArtifactsByPath.get(cacheKey);
    if (!cached) {
      cached = this.repository.readJsonIfExists(filePath);
      context.jsonArtifactsByPath.set(cacheKey, cached);
    }
    return (await cached) as T | null;
  }

  private async computePreferredPatientArtifactOverlay(
    batch: BatchRecord,
    patientId: string,
  ): Promise<PatientArtifactOverlay | null> {
    const candidateRoots = [batch.storage.outputRoot];
    const batchRootEntries = await readdir(batch.storage.batchRoot, { withFileTypes: true }).catch(() => []);

    for (const entry of batchRootEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith("verification-rerun-")) {
        continue;
      }

      candidateRoots.push(path.join(batch.storage.batchRoot, entry.name));
    }

    const candidates: PatientArtifactOverlay[] = [];
    for (const rootDirectory of candidateRoots) {
      const patientArtifactsDirectory = path.join(rootDirectory, "patients", patientId);
      const patientDashboardStatePath = path.join(
        patientArtifactsDirectory,
        "patient-dashboard-state.json",
      );
      if (!(await this.repository.fileExists(patientDashboardStatePath))) {
        continue;
      }

      const dashboardStateStat = await stat(patientDashboardStatePath);
      const resultBundlePathCandidate = path.join(rootDirectory, "patient-results", `${patientId}.json`);
      const logPathCandidate = path.join(rootDirectory, "logs", `${patientId}.json`);
      candidates.push({
        rootDirectory,
        patientArtifactsDirectory,
        patientDashboardStatePath,
        resultBundlePath: (await this.repository.fileExists(resultBundlePathCandidate))
          ? resultBundlePathCandidate
          : null,
        logPath: (await this.repository.fileExists(logPathCandidate)) ? logPathCandidate : null,
        evidenceDirectory: path.join(rootDirectory, "evidence", patientId),
        modifiedAt: dashboardStateStat.mtime.toISOString(),
      });
    }

    return candidates.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))[0] ?? null;
  }

  private async findPreferredPatientArtifactOverlay(
    batch: BatchRecord,
    patientId: string,
    context: DashboardReadContext | null = null,
  ): Promise<PatientArtifactOverlay | null> {
    if (!context) {
      return this.computePreferredPatientArtifactOverlay(batch, patientId);
    }

    let cached = context.preferredOverlaysByPatientId.get(patientId);
    if (!cached) {
      cached = this.computePreferredPatientArtifactOverlay(batch, patientId);
      context.preferredOverlaysByPatientId.set(patientId, cached);
    }
    return cached;
  }

  private async computePreferredPatientRunSummary(
    batch: BatchRecord,
    summary: BatchRecord["patientRuns"][number],
    context: DashboardReadContext | null,
  ): Promise<BatchRecord["patientRuns"][number]> {
    const overlay = await this.findPreferredPatientArtifactOverlay(batch, summary.workItemId, context);
    if (!overlay?.resultBundlePath) {
      return summary;
    }

    const overlaidDetail = await this.readPatientRunWithContext(context, overlay.resultBundlePath);
    const overlaidLogAvailable = overlay.logPath
      ? await this.repository.fileExists(overlay.logPath)
      : false;

    return {
      ...summary,
      runId: overlaidDetail.runId,
      processingStatus: overlaidDetail.processingStatus,
      executionStep: overlaidDetail.executionStep,
      progressPercent: overlaidDetail.progressPercent,
      startedAt: overlaidDetail.startedAt,
      completedAt: overlaidDetail.completedAt,
      lastUpdatedAt: overlaidDetail.lastUpdatedAt,
      matchResult: overlaidDetail.matchResult,
      qaOutcome: overlaidDetail.qaOutcome,
      oasisQaSummary: overlaidDetail.oasisQaSummary,
      artifactCount: overlaidDetail.artifactCount,
      hasFindings: overlaidDetail.hasFindings,
      bundleAvailable: true,
      logPath: overlay.logPath ?? summary.logPath,
      logAvailable: overlaidLogAvailable,
      errorSummary: overlaidDetail.errorSummary,
      resultBundlePath: overlay.resultBundlePath,
      evidenceDirectory: overlay.evidenceDirectory,
      tracePath: overlaidDetail.auditArtifacts.tracePath,
      screenshotPaths: overlaidDetail.auditArtifacts.screenshotPaths,
      downloadPaths: overlaidDetail.auditArtifacts.downloadPaths,
      workflowRuns: overlaidDetail.workflowRuns,
    };
  }

  private async resolvePreferredPatientRunSummary(
    batch: BatchRecord,
    summary: BatchRecord["patientRuns"][number],
    context: DashboardReadContext | null = null,
  ): Promise<BatchRecord["patientRuns"][number]> {
    if (!context) {
      return this.computePreferredPatientRunSummary(batch, summary, null);
    }

    let cached = context.resolvedSummariesByWorkItemId.get(summary.workItemId);
    if (!cached) {
      cached = this.computePreferredPatientRunSummary(batch, summary, context);
      context.resolvedSummariesByWorkItemId.set(summary.workItemId, cached);
    }
    return cached;
  }

  private async getBatchPatientFromContext(
    context: DashboardReadContext,
    patientId: string,
  ): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
  } | null> {
    const summary = context.patientRunsByWorkItemId.get(patientId);
    if (!summary) {
      return null;
    }

    let detail =
      summary.bundleAvailable && (await this.repository.fileExists(summary.resultBundlePath))
        ? await this.readPatientRunWithContext(context, summary.resultBundlePath)
        : null;
    const resolvedSummary = await this.resolvePreferredPatientRunSummary(context.batch, summary, context);
    if (resolvedSummary.resultBundlePath !== summary.resultBundlePath) {
      detail = await this.readPatientRunWithContext(context, resolvedSummary.resultBundlePath);
    }

    return {
      batch: context.batch,
      summary: resolvedSummary,
      detail,
    };
  }

  async getBatchPatient(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
  } | null> {
    const batch = await this.mustGetBatch(batchId);
    return this.getBatchPatientFromContext(this.createDashboardReadContext(batch), patientId);
  }

  async getLatestPatientForSubsidiary(input: {
    subsidiaryId: string;
    patientId: string;
  }): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
  } | null> {
    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(input.subsidiaryId);
    const candidateBatches = (await this.repository.listBatches())
      .filter((batch) => batchBelongsToSubsidiary(batch, subsidiary))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    const candidates = await Promise.all(
      candidateBatches.map(async (batch) => this.getBatchPatient(batch.id, input.patientId)),
    );

    return candidates
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((left, right) => {
        const leftScore = left.detail ? 1 : 0;
        const rightScore = right.detail ? 1 : 0;
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }

        const leftCompletedAt = left.summary.completedAt ?? "";
        const rightCompletedAt = right.summary.completedAt ?? "";
        if (leftCompletedAt !== rightCompletedAt) {
          return rightCompletedAt.localeCompare(leftCompletedAt);
        }

        if (left.summary.lastUpdatedAt !== right.summary.lastUpdatedAt) {
          return right.summary.lastUpdatedAt.localeCompare(left.summary.lastUpdatedAt);
        }

        return right.batch.updatedAt.localeCompare(left.batch.updatedAt);
      })[0] ?? null;
  }

  async getBatchPatientLog(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    log: PatientRunLog | null;
  } | null> {
    const patient = await this.getBatchPatient(batchId, patientId);
    if (!patient) {
      return null;
    }

    const log =
      patient.summary.logAvailable &&
      patient.summary.logPath &&
      (await this.repository.fileExists(patient.summary.logPath))
        ? await this.repository.readPatientRunLog(patient.summary.logPath)
        : null;

    return {
      batch: patient.batch,
      summary: patient.summary,
      log,
    };
  }

  async getBatchPatientArtifacts(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    artifacts: Array<{
      kind:
        | "bundle"
        | "log"
        | "failure_trace"
        | "failure_screenshot"
        | "download"
        | "evidence"
        | "workflow_result"
        | "workflow_log";
      name: string;
      path: string;
      exists: boolean;
      modifiedAt: string | null;
      sizeBytes: number | null;
    }>;
  } | null> {
    const patient = await this.getBatchPatient(batchId, patientId);
    if (!patient) {
      return null;
    }

    const artifacts: Array<{
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download" | "evidence" | "workflow_result" | "workflow_log";
      name: string;
      path: string;
      exists: boolean;
      modifiedAt: string | null;
      sizeBytes: number | null;
    }> = [];

    const pushFileArtifact = async (
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download" | "workflow_result" | "workflow_log",
      filePath: string | null,
    ): Promise<void> => {
      if (!filePath) {
        return;
      }

      const exists = await this.repository.fileExists(filePath);
      if (!exists) {
        artifacts.push({
          kind,
          name: path.basename(filePath),
          path: filePath,
          exists: false,
          modifiedAt: null,
          sizeBytes: null,
        });
        return;
      }

      const fileStat = await stat(filePath);
      artifacts.push({
        kind,
        name: path.basename(filePath),
        path: filePath,
        exists: true,
        modifiedAt: fileStat.isFile() ? fileStat.mtime.toISOString() : null,
        sizeBytes: fileStat.isFile() ? fileStat.size : null,
      });
    };

    await pushFileArtifact("bundle", patient.summary.resultBundlePath);
    await pushFileArtifact("log", patient.summary.logPath);
    await pushFileArtifact("failure_trace", patient.summary.tracePath);
    for (const workflowRun of patient.summary.workflowRuns) {
      if (workflowRun.workflowResultPath && workflowRun.workflowResultPath !== patient.summary.resultBundlePath) {
        await pushFileArtifact("workflow_result", workflowRun.workflowResultPath);
      }
      if (workflowRun.workflowLogPath && workflowRun.workflowLogPath !== patient.summary.logPath) {
        await pushFileArtifact("workflow_log", workflowRun.workflowLogPath);
      }
    }

    for (const screenshotPath of patient.summary.screenshotPaths) {
      await pushFileArtifact("failure_screenshot", screenshotPath);
    }

    for (const downloadPath of patient.summary.downloadPaths) {
      await pushFileArtifact("download", downloadPath);
    }

    if (await this.repository.fileExists(patient.summary.evidenceDirectory)) {
      const evidenceFiles = await this.repository.listFilesRecursive(patient.summary.evidenceDirectory);
      artifacts.push(
        ...evidenceFiles.map((file) => ({
          kind: "evidence" as const,
          name: file.name,
          path: file.path,
          exists: true,
          modifiedAt: file.modifiedAt,
          sizeBytes: file.sizeBytes,
        })),
      );
    }

    return {
      batch: patient.batch,
      summary: patient.summary,
      artifacts,
    };
  }

  async getBatchWorkItem(
    batchId: string,
    patientId: string,
  ): Promise<PatientEpisodeWorkItem | null> {
    const batch = await this.mustGetBatch(batchId);
    return this.getContextWorkItem(this.createDashboardReadContext(batch), patientId);
  }

  async getKnownPatientArtifacts(batchId: string, patientId: string): Promise<KnownPatientArtifacts | null> {
    const batch = await this.mustGetBatch(batchId);
    return this.getKnownPatientArtifactsFromContext(this.createDashboardReadContext(batch), patientId);
  }

  async getKnownPatientArtifactsForBatch(batchId: string): Promise<{
    batch: BatchRecord;
    patients: KnownPatientArtifacts[];
  } | null> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      return null;
    }

    const context = this.createDashboardReadContext(batch);
    const resolvedSummaries = await Promise.all(
      batch.patientRuns.map((patientRun) =>
        this.resolvePreferredPatientRunSummary(batch, patientRun, context),
      ),
    );
    const patients = await Promise.all(
      resolvedSummaries
        .sort((left, right) => left.patientName.localeCompare(right.patientName))
        .map((patientRun) => this.getKnownPatientArtifactsFromContext(context, patientRun.workItemId)),
    );

    return {
      batch,
      patients: patients.filter((patient): patient is KnownPatientArtifacts => patient !== null),
    };
  }

  async getKnownPatientSummaryArtifactsForBatch(batchId: string): Promise<{
    batch: BatchRecord;
    patients: KnownPatientArtifacts[];
  } | null> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      return null;
    }

    const context = this.createDashboardReadContext(batch);
    const resolvedSummaries = await mapWithConcurrency(
      batch.patientRuns,
      DASHBOARD_PATIENT_SUMMARY_CONCURRENCY,
      (patientRun) => this.resolvePreferredPatientRunSummary(batch, patientRun, context),
    );
    const sortedSummaries = resolvedSummaries
      .slice()
      .sort((left, right) => left.patientName.localeCompare(right.patientName));
    const patients = await mapWithConcurrency(
      sortedSummaries,
      DASHBOARD_PATIENT_SUMMARY_CONCURRENCY,
      (patientRun) => this.getKnownPatientSummaryArtifactsFromContext(context, patientRun),
    );

    return {
      batch,
      patients: patients.filter((patient): patient is KnownPatientArtifacts => patient !== null),
    };
  }

  private getPatientDashboardStateArtifactContent(
    patientDashboardState: PatientDashboardState | null,
    key: string,
  ): unknown | null {
    if (!patientDashboardState?.artifactContents || typeof patientDashboardState.artifactContents !== "object") {
      return null;
    }

    return (patientDashboardState.artifactContents as Record<string, unknown>)[key] ?? null;
  }

  private buildKnownPatientArtifactPaths(
    patientArtifactsDirectory: string,
    patientDashboardState: PatientDashboardState | null,
  ): KnownPatientArtifacts["artifactPaths"] {
    const artifactPaths = patientDashboardState?.artifactPaths;

    return {
      codingInput: artifactPaths?.codingInput ?? path.join(patientArtifactsDirectory, "coding-input.json"),
      documentText: artifactPaths?.documentText ?? path.join(patientArtifactsDirectory, "document-text.json"),
      qaPrefetch: artifactPaths?.qaPrefetch ?? path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
      patientQaReference:
        artifactPaths?.patientQaReference ?? path.join(patientArtifactsDirectory, "patient-qa-reference.json"),
      qaDocumentSummary:
        artifactPaths?.qaDocumentSummary ?? path.join(patientArtifactsDirectory, "qa-document-summary.json"),
      fieldMapSnapshot:
        artifactPaths?.fieldMapSnapshot ?? path.join(patientArtifactsDirectory, "field-map-snapshot.json"),
      referralIntakeState:
        artifactPaths?.referralIntakeState ?? getReferralIntakeStatePath(patientArtifactsDirectory),
      oasisCheckState:
        artifactPaths?.oasisCheckState ?? getOasisCheckStatePath(patientArtifactsDirectory),
      referralSourceDocumentsManifest:
        artifactPaths?.referralSourceDocumentsManifest ??
        getReferralSourceDocumentsManifestPath(patientArtifactsDirectory),
      referralDocumentResultsManifest:
        artifactPaths?.referralDocumentResultsManifest ??
        getReferralDocumentResultsManifestPath(patientArtifactsDirectory),
      patientPortalStatusSnapshot:
        artifactPaths?.patientPortalStatusSnapshot ??
        getPatientPortalStatusSnapshotPath(patientArtifactsDirectory),
      printedNoteChartValues:
        artifactPaths?.printedNoteChartValues ?? path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
      printedNoteReview:
        artifactPaths?.printedNoteReview ?? path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
      oasisDomExtractedState: path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
      oasisDomAcquisitionState: path.join(patientArtifactsDirectory, "oasis-dom-acquisition-state.json"),
      oasisDomComparison: path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
      sourceClinicalFactPack:
        artifactPaths?.sourceClinicalFactPack ?? path.join(patientArtifactsDirectory, "source-clinical-fact-pack.json"),
      documentFactPack:
        artifactPaths?.documentFactPack ?? path.join(patientArtifactsDirectory, "document-fact-pack.json"),
      oasisClinicalFactPack:
        artifactPaths?.oasisClinicalFactPack ?? path.join(patientArtifactsDirectory, "oasis-clinical-fact-pack.json"),
      referralExtractedFacts: path.join(patientArtifactsDirectory, "referral-document-processing", "extracted-facts.json"),
      planOfCareReviewDraft:
        artifactPaths?.planOfCareReviewDraft ?? path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
      generatedPlanOfCare:
        artifactPaths?.generatedPlanOfCare ?? path.join(patientArtifactsDirectory, "generated-plan-of-care.json"),
      visitNotesDiscovery:
        artifactPaths?.visitNotesDiscovery ?? path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
      visitNoteProcessingManifest:
        artifactPaths?.visitNoteProcessingManifest ??
        path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
      visitNoteQaReview:
        artifactPaths?.visitNoteQaReview ?? path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
      oasisDomSectionProcessingManifest:
        artifactPaths?.oasisDomSectionProcessingManifest ??
        path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
      oasisDomSectionOutputs:
        artifactPaths?.oasisDomSectionOutputs ?? path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
      oasisAssessmentProcessingManifest:
        artifactPaths?.oasisAssessmentProcessingManifest ??
        path.join(patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
      patientRunCacheSummary:
        artifactPaths?.patientRunCacheSummary ?? path.join(patientArtifactsDirectory, "patient-run-cache-summary.json"),
    };
  }

  private buildKnownPatientSummaryArtifactContents(
    patientDashboardState: PatientDashboardState | null,
  ): KnownPatientArtifacts["artifactContents"] {
    return {
      codingInput: this.getPatientDashboardStateArtifactContent(patientDashboardState, "codingInput"),
      documentText: this.getPatientDashboardStateArtifactContent(patientDashboardState, "documentText"),
      qaPrefetch: this.getPatientDashboardStateArtifactContent(patientDashboardState, "qaPrefetch"),
      patientQaReference: this.getPatientDashboardStateArtifactContent(patientDashboardState, "patientQaReference"),
      qaDocumentSummary: this.getPatientDashboardStateArtifactContent(patientDashboardState, "qaDocumentSummary"),
      fieldMapSnapshot: this.getPatientDashboardStateArtifactContent(patientDashboardState, "fieldMapSnapshot"),
      referralIntakeState: this.getPatientDashboardStateArtifactContent(patientDashboardState, "referralIntakeState"),
      oasisCheckState: this.getPatientDashboardStateArtifactContent(patientDashboardState, "oasisCheckState"),
      referralSourceDocumentsManifest: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "referralSourceDocumentsManifest",
      ),
      referralDocumentResultsManifest: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "referralDocumentResultsManifest",
      ),
      referralDocumentArtifacts: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "referralDocumentArtifacts",
      ),
      patientPortalStatusSnapshot: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "patientPortalStatusSnapshot",
      ),
      printedNoteChartValues: this.getPatientDashboardStateArtifactContent(patientDashboardState, "printedNoteChartValues"),
      printedNoteReview: this.getPatientDashboardStateArtifactContent(patientDashboardState, "printedNoteReview"),
      oasisDomExtractedState: this.getPatientDashboardStateArtifactContent(patientDashboardState, "oasisDomExtractedState"),
      oasisDomAcquisitionState: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "oasisDomAcquisitionState",
      ),
      oasisDomComparison: this.getPatientDashboardStateArtifactContent(patientDashboardState, "oasisDomComparison"),
      sourceClinicalFactPack: this.getPatientDashboardStateArtifactContent(patientDashboardState, "sourceClinicalFactPack"),
      documentFactPack: this.getPatientDashboardStateArtifactContent(patientDashboardState, "documentFactPack"),
      oasisClinicalFactPack: this.getPatientDashboardStateArtifactContent(patientDashboardState, "oasisClinicalFactPack"),
      referralExtractedFacts: this.getPatientDashboardStateArtifactContent(patientDashboardState, "referralExtractedFacts"),
      planOfCareReviewDraft: this.getPatientDashboardStateArtifactContent(patientDashboardState, "planOfCareReviewDraft"),
      generatedPlanOfCare: this.getPatientDashboardStateArtifactContent(patientDashboardState, "generatedPlanOfCare"),
      visitNotesDiscovery: this.getPatientDashboardStateArtifactContent(patientDashboardState, "visitNotesDiscovery"),
      visitNoteProcessingManifest: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "visitNoteProcessingManifest",
      ),
      visitNoteQaReview: this.getPatientDashboardStateArtifactContent(patientDashboardState, "visitNoteQaReview"),
      oasisDomSectionProcessingManifest: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "oasisDomSectionProcessingManifest",
      ),
      oasisDomSectionOutputs: this.getPatientDashboardStateArtifactContent(patientDashboardState, "oasisDomSectionOutputs"),
      oasisAssessmentProcessingManifest: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "oasisAssessmentProcessingManifest",
      ),
      oasisAssessmentArtifacts: this.getPatientDashboardStateArtifactContent(
        patientDashboardState,
        "oasisAssessmentArtifacts",
      ),
      patientRunCacheSummary: this.getPatientDashboardStateArtifactContent(patientDashboardState, "patientRunCacheSummary"),
    };
  }

  private async getKnownPatientSummaryArtifactsFromContext(
    context: DashboardReadContext,
    summary: BatchRecord["patientRuns"][number],
  ): Promise<KnownPatientArtifacts | null> {
    const workItem = await this.getContextWorkItem(context, summary.workItemId);
    const overlay = await this.findPreferredPatientArtifactOverlay(context.batch, summary.workItemId, context);
    let patientArtifactsDirectory =
      overlay?.patientArtifactsDirectory ??
      path.join(context.batch.storage.outputRoot, "patients", summary.workItemId);
    let patientDashboardStatePath =
      overlay?.patientDashboardStatePath ?? path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
    let patientDashboardState = await this.readJsonIfExistsWithContext<PatientDashboardState>(
      context,
      patientDashboardStatePath,
    );

    if (!patientDashboardState && workItem) {
      const memoryDirectory = await this.findPatientMemoryCurrentDirectory(
        context.batch,
        workItem,
        summary.matchResult,
      );
      if (memoryDirectory) {
        patientArtifactsDirectory = memoryDirectory;
        patientDashboardStatePath = path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
        patientDashboardState = await this.readJsonIfExistsWithContext<PatientDashboardState>(
          context,
          patientDashboardStatePath,
        );
      }
    }

    return {
      batch: context.batch,
      summary,
      detail: null,
      workItem: patientDashboardState?.workItem ?? workItem,
      patientArtifactsDirectory,
      artifactPaths: this.buildKnownPatientArtifactPaths(patientArtifactsDirectory, patientDashboardState),
      artifactContents: this.buildKnownPatientSummaryArtifactContents(patientDashboardState),
    };
  }

  private async getKnownPatientArtifactsFromContext(
    context: DashboardReadContext,
    patientId: string,
  ): Promise<KnownPatientArtifacts | null> {
    const patient = await this.getBatchPatientFromContext(context, patientId);
    if (!patient) {
      return null;
    }

    const workItem = await this.getContextWorkItem(context, patientId);
    const overlay = await this.findPreferredPatientArtifactOverlay(patient.batch, patientId, context);
    let patientArtifactsDirectory =
      overlay?.patientArtifactsDirectory ??
      path.join(patient.batch.storage.outputRoot, "patients", patientId);
    let patientDashboardStatePath =
      overlay?.patientDashboardStatePath ??
      path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
    let patientDashboardState = await this.readJsonIfExistsWithContext<PatientDashboardState>(
      context,
      patientDashboardStatePath,
    );

    if (!patientDashboardState && workItem) {
      const memoryDirectory = await this.findPatientMemoryCurrentDirectory(
        patient.batch,
        workItem,
        patient.summary.matchResult,
      );
      if (memoryDirectory) {
        patientArtifactsDirectory = memoryDirectory;
        patientDashboardStatePath = path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
        patientDashboardState = await this.readJsonIfExistsWithContext<PatientDashboardState>(
          context,
          patientDashboardStatePath,
        );
      }
    }

    if (patientDashboardState) {
      return {
        batch: patient.batch,
        summary: patient.summary,
        detail: patient.detail,
        workItem: patientDashboardState.workItem ?? workItem,
        patientArtifactsDirectory,
        artifactPaths: {
          codingInput: patientDashboardState.artifactPaths.codingInput,
          documentText: patientDashboardState.artifactPaths.documentText,
          qaPrefetch: patientDashboardState.artifactPaths.qaPrefetch,
          patientQaReference: patientDashboardState.artifactPaths.patientQaReference,
          qaDocumentSummary: patientDashboardState.artifactPaths.qaDocumentSummary,
          fieldMapSnapshot: patientDashboardState.artifactPaths.fieldMapSnapshot,
          referralIntakeState:
            patientDashboardState.artifactPaths.referralIntakeState ??
            getReferralIntakeStatePath(patientArtifactsDirectory),
          oasisCheckState:
            patientDashboardState.artifactPaths.oasisCheckState ??
            getOasisCheckStatePath(patientArtifactsDirectory),
          referralSourceDocumentsManifest:
            patientDashboardState.artifactPaths.referralSourceDocumentsManifest ??
            getReferralSourceDocumentsManifestPath(patientArtifactsDirectory),
          referralDocumentResultsManifest:
            patientDashboardState.artifactPaths.referralDocumentResultsManifest ??
            getReferralDocumentResultsManifestPath(patientArtifactsDirectory),
          patientPortalStatusSnapshot:
            patientDashboardState.artifactPaths.patientPortalStatusSnapshot ??
            getPatientPortalStatusSnapshotPath(patientArtifactsDirectory),
          printedNoteChartValues:
            patientDashboardState.artifactPaths.printedNoteChartValues ??
            path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
          printedNoteReview:
            patientDashboardState.artifactPaths.printedNoteReview ??
            path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
          oasisDomExtractedState: path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
          oasisDomAcquisitionState: path.join(patientArtifactsDirectory, "oasis-dom-acquisition-state.json"),
          oasisDomComparison: path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
          sourceClinicalFactPack: path.join(patientArtifactsDirectory, "source-clinical-fact-pack.json"),
          documentFactPack: path.join(patientArtifactsDirectory, "document-fact-pack.json"),
          oasisClinicalFactPack: path.join(patientArtifactsDirectory, "oasis-clinical-fact-pack.json"),
          referralExtractedFacts: path.join(patientArtifactsDirectory, "referral-document-processing", "extracted-facts.json"),
          planOfCareReviewDraft: path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
          generatedPlanOfCare: path.join(patientArtifactsDirectory, "generated-plan-of-care.json"),
          visitNotesDiscovery: path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
          visitNoteProcessingManifest: path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
          visitNoteQaReview: path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
          oasisDomSectionProcessingManifest: path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
          oasisDomSectionOutputs: path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
          oasisAssessmentProcessingManifest: path.join(patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
          patientRunCacheSummary: path.join(patientArtifactsDirectory, "patient-run-cache-summary.json"),
        },
        artifactContents: {
          codingInput: patientDashboardState.artifactContents.codingInput ?? null,
          documentText: patientDashboardState.artifactContents.documentText ?? null,
          qaPrefetch: patientDashboardState.artifactContents.qaPrefetch ?? null,
          patientQaReference: patientDashboardState.artifactContents.patientQaReference ?? null,
          qaDocumentSummary: patientDashboardState.artifactContents.qaDocumentSummary ?? null,
          fieldMapSnapshot: patientDashboardState.artifactContents.fieldMapSnapshot ?? null,
          referralIntakeState:
            await this.readJsonIfExistsWithContext(context, getReferralIntakeStatePath(patientArtifactsDirectory)) ??
            patientDashboardState.artifactContents.referralIntakeState ??
            null,
          oasisCheckState:
            await this.readJsonIfExistsWithContext(context, getOasisCheckStatePath(patientArtifactsDirectory)) ??
            patientDashboardState.artifactContents.oasisCheckState ??
            null,
          referralSourceDocumentsManifest:
            await this.readJsonIfExistsWithContext(context, getReferralSourceDocumentsManifestPath(patientArtifactsDirectory)) ??
            patientDashboardState.artifactContents.referralSourceDocumentsManifest ??
            null,
          referralDocumentResultsManifest:
            await this.readJsonIfExistsWithContext(context, getReferralDocumentResultsManifestPath(patientArtifactsDirectory)) ??
            patientDashboardState.artifactContents.referralDocumentResultsManifest ??
            null,
          referralDocumentArtifacts:
            patientDashboardState.artifactContents.referralDocumentArtifacts ??
            null,
          patientPortalStatusSnapshot:
            await this.readJsonIfExistsWithContext(context, getPatientPortalStatusSnapshotPath(patientArtifactsDirectory)) ??
            patientDashboardState.artifactContents.patientPortalStatusSnapshot ??
            null,
          printedNoteChartValues:
            await this.readJsonIfExistsWithContext(
              context,
              patientDashboardState.artifactPaths.printedNoteChartValues ??
                path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
            ) ??
            patientDashboardState.artifactContents.printedNoteChartValues ??
            null,
          printedNoteReview:
            await this.readJsonIfExistsWithContext(
              context,
              patientDashboardState.artifactPaths.printedNoteReview ??
                path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
            ) ??
            patientDashboardState.artifactContents.printedNoteReview ??
            null,
          oasisDomExtractedState: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
          ),
          oasisDomAcquisitionState: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-acquisition-state.json"),
          ),
          oasisDomComparison: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
          ),
          sourceClinicalFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "source-clinical-fact-pack.json"),
          ),
          documentFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "document-fact-pack.json"),
          ),
          oasisClinicalFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-clinical-fact-pack.json"),
          ),
          referralExtractedFacts: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "referral-document-processing", "extracted-facts.json"),
          ),
          planOfCareReviewDraft: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
          ),
          generatedPlanOfCare: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "generated-plan-of-care.json"),
          ),
          visitNotesDiscovery: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
          ),
          visitNoteProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
          ),
          visitNoteQaReview: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
          ),
          oasisDomSectionProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
          ),
          oasisDomSectionOutputs: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
          ),
          oasisAssessmentProcessingManifest:
            patientDashboardState.artifactContents.oasisAssessmentProcessingManifest ??
            await this.readJsonIfExistsWithContext(
              context,
              path.join(patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
            ),
          oasisAssessmentArtifacts:
            patientDashboardState.artifactContents.oasisAssessmentArtifacts ??
            null,
          patientRunCacheSummary: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "patient-run-cache-summary.json"),
          ),
        },
      };
    }

    const codingWorkflowRun = patient.summary.workflowRuns.find(
      (workflowRun) => workflowRun.workflowDomain === "coding",
    );
    const qaWorkflowRun = patient.summary.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa");
    const codingInputPathCandidates = Array.from(
      new Set(
        [
          codingWorkflowRun?.workflowResultPath ?? null,
          path.join(patientArtifactsDirectory, "coding-input.json"),
        ].filter((candidate): candidate is string => Boolean(candidate)),
      ),
    );
    let codingInputPath = codingInputPathCandidates[0] ?? path.join(patientArtifactsDirectory, "coding-input.json");
    for (const candidate of codingInputPathCandidates) {
      if (await this.repository.fileExists(candidate)) {
        codingInputPath = candidate;
        break;
      }
    }
    const qaPrefetchPathCandidates = Array.from(
      new Set(
        [
          qaWorkflowRun?.workflowResultPath ?? null,
          path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
        ].filter((candidate): candidate is string => Boolean(candidate)),
      ),
    );
    let qaPrefetchPath: string | null = null;
    for (const candidate of qaPrefetchPathCandidates) {
      if (await this.repository.fileExists(candidate)) {
        qaPrefetchPath = candidate;
        break;
      }
    }
    if (!qaPrefetchPath) {
      qaPrefetchPath = qaPrefetchPathCandidates[0] ?? null;
    }
    const artifactPaths = {
      codingInput: codingInputPath,
      documentText: path.join(patientArtifactsDirectory, "document-text.json"),
      qaPrefetch: qaPrefetchPath,
      patientQaReference: path.join(
        patientArtifactsDirectory,
        "referral-document-processing",
        "patient-qa-reference.json",
      ),
      qaDocumentSummary: path.join(
        patientArtifactsDirectory,
        "referral-document-processing",
        "qa-document-summary.json",
      ),
      fieldMapSnapshot: path.join(
        patientArtifactsDirectory,
        "referral-document-processing",
        "field-map-snapshot.json",
      ),
      referralIntakeState: getReferralIntakeStatePath(patientArtifactsDirectory),
      oasisCheckState: getOasisCheckStatePath(patientArtifactsDirectory),
      referralSourceDocumentsManifest: getReferralSourceDocumentsManifestPath(patientArtifactsDirectory),
      referralDocumentResultsManifest: getReferralDocumentResultsManifestPath(patientArtifactsDirectory),
      patientPortalStatusSnapshot: getPatientPortalStatusSnapshotPath(patientArtifactsDirectory),
      printedNoteChartValues: path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
      printedNoteReview: path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
      oasisDomExtractedState: path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
      oasisDomAcquisitionState: path.join(patientArtifactsDirectory, "oasis-dom-acquisition-state.json"),
      oasisDomComparison: path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
      sourceClinicalFactPack: path.join(patientArtifactsDirectory, "source-clinical-fact-pack.json"),
      documentFactPack: path.join(patientArtifactsDirectory, "document-fact-pack.json"),
      oasisClinicalFactPack: path.join(patientArtifactsDirectory, "oasis-clinical-fact-pack.json"),
      referralExtractedFacts: path.join(patientArtifactsDirectory, "referral-document-processing", "extracted-facts.json"),
      planOfCareReviewDraft: path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
      generatedPlanOfCare: path.join(patientArtifactsDirectory, "generated-plan-of-care.json"),
      visitNotesDiscovery: path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
      visitNoteProcessingManifest: path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
      visitNoteQaReview: path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
      oasisDomSectionProcessingManifest: path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
      oasisDomSectionOutputs: path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
      oasisAssessmentProcessingManifest: path.join(patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
      patientRunCacheSummary: path.join(patientArtifactsDirectory, "patient-run-cache-summary.json"),
    };

    return {
      batch: patient.batch,
      summary: patient.summary,
      detail: patient.detail,
      workItem,
      patientArtifactsDirectory,
      artifactPaths,
      artifactContents: {
        codingInput: await this.readJsonIfExistsWithContext(context, artifactPaths.codingInput),
        documentText: await this.readJsonIfExistsWithContext(context, artifactPaths.documentText),
        qaPrefetch: artifactPaths.qaPrefetch
          ? await this.readJsonIfExistsWithContext(context, artifactPaths.qaPrefetch)
          : null,
        patientQaReference: await this.readJsonIfExistsWithContext(context, artifactPaths.patientQaReference),
        qaDocumentSummary: await this.readJsonIfExistsWithContext(context, artifactPaths.qaDocumentSummary),
        fieldMapSnapshot: await this.readJsonIfExistsWithContext(context, artifactPaths.fieldMapSnapshot),
        referralIntakeState: await this.readJsonIfExistsWithContext(context, artifactPaths.referralIntakeState),
        oasisCheckState: await this.readJsonIfExistsWithContext(context, artifactPaths.oasisCheckState),
        referralSourceDocumentsManifest: await this.readJsonIfExistsWithContext(
          context,
          artifactPaths.referralSourceDocumentsManifest,
        ),
        referralDocumentResultsManifest: await this.readJsonIfExistsWithContext(
          context,
          artifactPaths.referralDocumentResultsManifest,
        ),
        referralDocumentArtifacts: null,
        patientPortalStatusSnapshot: await this.readJsonIfExistsWithContext(
          context,
          artifactPaths.patientPortalStatusSnapshot,
        ),
        printedNoteChartValues: await this.readJsonIfExistsWithContext(context, artifactPaths.printedNoteChartValues),
        printedNoteReview: await this.readJsonIfExistsWithContext(context, artifactPaths.printedNoteReview),
        oasisDomExtractedState: await this.readJsonIfExistsWithContext(context, artifactPaths.oasisDomExtractedState),
        oasisDomAcquisitionState: await this.readJsonIfExistsWithContext(context, artifactPaths.oasisDomAcquisitionState),
        oasisDomComparison: await this.readJsonIfExistsWithContext(context, artifactPaths.oasisDomComparison),
        sourceClinicalFactPack: await this.readJsonIfExistsWithContext(context, artifactPaths.sourceClinicalFactPack),
        documentFactPack: await this.readJsonIfExistsWithContext(context, artifactPaths.documentFactPack),
        oasisClinicalFactPack: await this.readJsonIfExistsWithContext(context, artifactPaths.oasisClinicalFactPack),
        referralExtractedFacts: await this.readJsonIfExistsWithContext(context, artifactPaths.referralExtractedFacts),
        planOfCareReviewDraft: await this.readJsonIfExistsWithContext(context, artifactPaths.planOfCareReviewDraft),
        generatedPlanOfCare: await this.readJsonIfExistsWithContext(context, artifactPaths.generatedPlanOfCare),
        visitNotesDiscovery: await this.readJsonIfExistsWithContext(context, artifactPaths.visitNotesDiscovery),
        visitNoteProcessingManifest: await this.readJsonIfExistsWithContext(context, artifactPaths.visitNoteProcessingManifest),
        visitNoteQaReview: await this.readJsonIfExistsWithContext(context, artifactPaths.visitNoteQaReview),
        oasisDomSectionProcessingManifest: await this.readJsonIfExistsWithContext(
          context,
          artifactPaths.oasisDomSectionProcessingManifest,
        ),
        oasisDomSectionOutputs: await this.readJsonIfExistsWithContext(context, artifactPaths.oasisDomSectionOutputs),
        oasisAssessmentProcessingManifest: await this.readJsonIfExistsWithContext(
          context,
          artifactPaths.oasisAssessmentProcessingManifest,
        ),
        oasisAssessmentArtifacts: null,
        patientRunCacheSummary: await this.readJsonIfExistsWithContext(context, artifactPaths.patientRunCacheSummary),
      },
    };
  }

  private async derivePatientDocumentationSignal(
    batch: BatchRecord,
    summary: BatchRecord["patientRuns"][number],
    context: DashboardReadContext | null = null,
  ): Promise<{
    missingReferralDocumentation: boolean;
    missingReferralFieldCount: number;
    daysLeftBeforeOasisDueDate: number | null;
    daysSinceSoc: number | null;
    pipelineStage: DashboardPatientRecord["pipelineStage"];
    oasisStage: DashboardPatientRecord["oasisStage"];
    primaryBlocker: string | null;
    blockerReasons: string[];
    oasisQaIssues: ConciseQaIssue[];
    topOasisIssue: ConciseQaIssue | null;
    oasisInternalMismatchCount: number;
    emptyOasisInputCount: number;
    visitNoteQaIssues: ConciseQaIssue[];
    topVisitNoteIssue: ConciseQaIssue | null;
    visitNoteMismatchCount: number;
    visitNoteActiveQaCount: number;
    visitNoteReviewStatus: DashboardPatientRecord["visitNoteReviewStatus"];
    visitNotesDomStatus: string | null;
    referralAvailable: boolean;
    referralMedicationCount: number;
  }> {
    const overlay = await this.findPreferredPatientArtifactOverlay(batch, summary.workItemId, context);
    const patientArtifactsDirectory =
      overlay?.patientArtifactsDirectory ??
      path.join(batch.storage.outputRoot, "patients", summary.workItemId);
    const patientDashboardStatePath =
      overlay?.patientDashboardStatePath ??
      path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
    const patientDashboardState = await this.readJsonIfExistsWithContext<PatientDashboardState>(
      context,
      patientDashboardStatePath,
    );

    const artifactContents = patientDashboardState
      ? {
          codingInput: patientDashboardState.artifactContents.codingInput ?? null,
          documentText: patientDashboardState.artifactContents.documentText ?? null,
          qaPrefetch: patientDashboardState.artifactContents.qaPrefetch ?? null,
          patientQaReference: patientDashboardState.artifactContents.patientQaReference ?? null,
          qaDocumentSummary: patientDashboardState.artifactContents.qaDocumentSummary ?? null,
          fieldMapSnapshot: patientDashboardState.artifactContents.fieldMapSnapshot ?? null,
          printedNoteChartValues:
            await this.readJsonIfExistsWithContext(
              context,
              patientDashboardState.artifactPaths.printedNoteChartValues ??
                path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
            ) ??
            patientDashboardState.artifactContents.printedNoteChartValues ??
            null,
          printedNoteReview:
            await this.readJsonIfExistsWithContext(
              context,
              patientDashboardState.artifactPaths.printedNoteReview ??
                path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
            ) ??
            patientDashboardState.artifactContents.printedNoteReview ??
            null,
          oasisDomExtractedState: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
          ),
          oasisDomAcquisitionState: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-acquisition-state.json"),
          ),
          oasisDomComparison: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
          ),
          visitNotesDiscovery: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
          ),
          visitNoteProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
          ),
          visitNoteQaReview: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
          ),
          oasisDomSectionProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
          ),
          oasisDomSectionOutputs: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
          ),
          oasisAssessmentProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
          ),
          sourceClinicalFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "source-clinical-fact-pack.json"),
          ),
          referralExtractedFacts: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "referral-document-processing", "extracted-facts.json"),
          ),
          documentFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "document-fact-pack.json"),
          ),
          planOfCareReviewDraft: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
          ),
          generatedPlanOfCare: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "generated-plan-of-care.json"),
          ),
        }
      : {
          codingInput: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "coding-input.json"),
          ),
          documentText: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "document-text.json"),
          ),
          qaPrefetch: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
          ),
          patientQaReference: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "referral-document-processing", "patient-qa-reference.json"),
          ),
          qaDocumentSummary: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "referral-document-processing", "qa-document-summary.json"),
          ),
          fieldMapSnapshot: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "referral-document-processing", "field-map-snapshot.json"),
          ),
          printedNoteChartValues: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
          ),
          printedNoteReview: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
          ),
          oasisDomExtractedState: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
          ),
          oasisDomAcquisitionState: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-acquisition-state.json"),
          ),
          oasisDomComparison: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
          ),
          visitNotesDiscovery: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
          ),
          visitNoteProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
          ),
          visitNoteQaReview: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
          ),
          oasisDomSectionProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
          ),
          oasisDomSectionOutputs: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
          ),
          oasisAssessmentProcessingManifest: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
          ),
          sourceClinicalFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "source-clinical-fact-pack.json"),
          ),
          referralExtractedFacts: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "referral-document-processing", "extracted-facts.json"),
          ),
          documentFactPack: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "document-fact-pack.json"),
          ),
          planOfCareReviewDraft: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
          ),
          generatedPlanOfCare: await this.readJsonIfExistsWithContext(
            context,
            path.join(patientArtifactsDirectory, "generated-plan-of-care.json"),
          ),
        };

    const dashboardSummary = toDashboardPatientSummary({
      batch,
      summary,
      workItem: patientDashboardState?.workItem ?? null,
      artifactContents,
    });
    const referralCoverageAvailable = dashboardSummary.referralQa.referralDataAvailable;
    const oasisTriage = deriveOasisDomIssues({
      oasisDomExtractedState: artifactContents.oasisDomExtractedState,
      oasisDomAcquisitionState: artifactContents.oasisDomAcquisitionState,
      oasisDomComparison: artifactContents.oasisDomComparison,
      oasisQaSummary: patientDashboardState?.oasisQaSummary ?? summary.oasisQaSummary,
    });
    const visitNoteTriage = deriveVisitNoteIssues({
      visitNoteQaReview: artifactContents.visitNoteQaReview,
      visitNotesDiscovery: artifactContents.visitNotesDiscovery,
      visitNoteProcessingManifest: artifactContents.visitNoteProcessingManifest,
    });
    const portalLookupContext = extractPortalPatientLookupContext(summary.matchResult);
    const daysLeftBeforeOasisDueDate =
      portalLookupContext?.daysLeftBeforeOasisDueDate ??
      dashboardSummary.daysLeftBeforeOasisDueDate ??
      patientDashboardState?.workItem?.timingMetadata?.daysLeftBeforeOasisDueDate ??
      patientDashboardState?.workItem?.timingMetadata?.daysLeft ??
      summary.oasisQaSummary.daysLeft ??
      null;
    const daysSinceSoc =
      portalLookupContext?.daysInEpisode ??
      deriveDaysSinceSoc(
        patientDashboardState?.workItem?.episodeContext.socDate ??
        portalLookupContext?.socDate ??
        dashboardSummary.referralQa.patientContext?.socDate ??
        null,
      );
    const oasisStage = deriveOasisStage({
      queueStatus: "eligible",
      daysLeft: daysLeftBeforeOasisDueDate,
      hasOasisDom: oasisTriage.hasOasisDom,
      oasisQaIssueCount: oasisTriage.issues.length,
      oasisValidatedForPlanOfCare: dashboardSummary.oasisValidatedForPlanOfCare,
    });
    const pipelineStage = deriveDashboardPipelineStage({
      queueStatus: "eligible",
      processingStatus: summary.processingStatus,
      missingReferralDocumentation: !referralCoverageAvailable,
      planOfCareAvailable: dashboardSummary.planOfCareReview.available,
      workItem: patientDashboardState?.workItem ?? null,
      oasisStage,
    });
    const allIssues = [...oasisTriage.issues, ...visitNoteTriage.issues].sort(issueSort);
    const blockerReasons = allIssues.slice(0, 4).map((issue) => issue.problemSummary);
    const primaryBlocker = blockerReasons[0] ?? null;

    return {
      missingReferralDocumentation: !referralCoverageAvailable,
      missingReferralFieldCount: referralCoverageAvailable
        ? 0
        : dashboardSummary.dashboardReview.missingInReferralCount,
      daysLeftBeforeOasisDueDate,
      daysSinceSoc,
      pipelineStage,
      oasisStage,
      primaryBlocker,
      blockerReasons,
      oasisQaIssues: oasisTriage.issues,
      topOasisIssue: topIssue(oasisTriage.issues),
      oasisInternalMismatchCount: oasisTriage.mismatchCount,
      emptyOasisInputCount: oasisTriage.emptyOasisInputCount,
      visitNoteQaIssues: visitNoteTriage.issues,
      topVisitNoteIssue: topIssue(visitNoteTriage.issues),
      visitNoteMismatchCount: visitNoteTriage.mismatchCount,
      visitNoteActiveQaCount: visitNoteTriage.activeQaCount,
      visitNoteReviewStatus: visitNoteTriage.reviewStatus,
      visitNotesDomStatus: visitNoteTriage.domStatus,
      referralAvailable: referralCoverageAvailable,
      referralMedicationCount: canCountReferralStructuredFacts(artifactContents)
        ? countReferralMedications(artifactContents.sourceClinicalFactPack) ||
          countReferralMedications(artifactContents.documentFactPack)
        : 0,
    };
  }

  async getAgencyDashboardSnapshot(agencyId: string): Promise<AgencyDashboardSnapshot> {
    const agencyRecord = await this.subsidiaryConfigService.getSubsidiaryConfig(agencyId);
    const agency: Agency = {
      id: agencyRecord.id,
      slug: agencyRecord.slug,
      name: agencyRecord.name,
      status: agencyRecord.status,
      timezone: agencyRecord.timezone,
    };
    const batches = (await this.repository.listBatches())
      .filter((batch) => batchBelongsToSubsidiary(batch, agencyRecord))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const batch = batches.find((candidate) => candidate.schedule.active) ?? batches[0] ?? null;

    if (!batch) {
      return {
        agency,
        refreshCycle: null,
        queueEntries: [],
        patientRecords: [],
        lastUpdatedAt: new Date().toISOString(),
      };
    }

    const outputRoot = batch.storage.outputRoot;
    const context = this.createDashboardReadContext(batch);
    const workbookSource = await this.repository.readJsonIfExists<WorkbookSource>(
      path.join(outputRoot, "workbook-source.json"),
    );
    const reviewWindow = await this.repository.readJsonIfExists<ReviewWindow>(
      path.join(outputRoot, "review-window.json"),
    );
    const patientQueue = await this.repository.readJsonIfExists<PatientQueueArtifact>(
      path.join(outputRoot, "patient-queue.json"),
    );
    const reviewerStatuses = parseDashboardReviewerStatusArtifact(
      await this.repository.readJsonIfExists(reviewerStatusPathForBatch(batch)),
    )?.statuses ?? {};
    const queueEntries = patientQueue?.entries ?? [];
    const resolvedPatientRuns = await Promise.all(
      batch.patientRuns.map((patientRun) =>
        this.resolvePreferredPatientRunSummary(batch, patientRun, context),
      ),
    );
    const patientRunsByWorkItemId = new Map(
      resolvedPatientRuns.map((patientRun) => [patientRun.workItemId, patientRun]),
    );
    const resolvedQueueEntries = queueEntries.map((queueEntry) => {
      const patientRun = patientRunsByWorkItemId.get(queueEntry.workItemId);
      const portalLookupContext = extractPortalPatientLookupContext(patientRun?.matchResult);
      const queueStatus = derivePortalExcludedQueueStatus({
        queueStatus: queueEntry.status,
        patientRun,
      });
      return {
        ...queueEntry,
        status: queueStatus,
        eligibility: deriveResolvedQueueEligibility(queueEntry, queueStatus),
        socDate: queueEntry.socDate ?? portalLookupContext?.socDate ?? null,
      };
    });
    const resolvedQueueSummary = summarizeQueueEntries(resolvedQueueEntries);
    const patientRecords: DashboardPatientRecord[] = await Promise.all(resolvedQueueEntries.map(async (queueEntry) => {
      const patientRun = patientRunsByWorkItemId.get(queueEntry.workItemId);
      const queueStatus = queueEntry.status;
      const documentationSignal = patientRun
        ? await this.derivePatientDocumentationSignal(batch, patientRun, context)
        : {
            missingReferralDocumentation: false,
            missingReferralFieldCount: 0,
            daysLeftBeforeOasisDueDate: null,
            daysSinceSoc: deriveDaysSinceSoc(queueEntry.socDate),
            pipelineStage: queueStatus === "skipped_pending" ? "pending" as const : "documentation" as const,
            oasisStage: queueStatus === "skipped_pending" ? "pending_patient" as const : "not_applicable" as const,
            primaryBlocker: queueStatus === "skipped_pending" ? "Pending workbook status" : null,
            blockerReasons: queueStatus === "skipped_pending" ? ["Pending workbook status"] : [],
            oasisQaIssues: [],
            topOasisIssue: null,
            oasisInternalMismatchCount: 0,
            emptyOasisInputCount: 0,
            visitNoteQaIssues: [],
            topVisitNoteIssue: null,
            visitNoteMismatchCount: 0,
            visitNoteActiveQaCount: 0,
            visitNoteReviewStatus: "not_applicable" as const,
            visitNotesDomStatus: null,
            referralAvailable: false,
            referralMedicationCount: 0,
          };
      const reviewerStatus = reviewerStatuses[queueEntry.workItemId] ?? null;
      const effectiveReviewerStatus = deriveEffectiveDashboardReviewerStatus({
        workItemId: queueEntry.workItemId,
        reviewerStatus,
        patientRun,
        documentationSignal,
      });
      return {
        queueEntry,
        runId: patientRun ? batch.id : null,
        patientId: patientRun?.workItemId ?? null,
        processingStatus: patientRun?.processingStatus ?? null,
        lastUpdatedAt: patientRun?.lastUpdatedAt ?? null,
        errorSummary: patientRun?.errorSummary ?? null,
        qaOutcome: patientRun?.qaOutcome ?? null,
        missingReferralDocumentation: documentationSignal.missingReferralDocumentation,
        missingReferralFieldCount: documentationSignal.missingReferralFieldCount,
        daysLeftBeforeOasisDueDate: documentationSignal.daysLeftBeforeOasisDueDate,
        daysSinceSoc: documentationSignal.daysSinceSoc,
        pipelineStage: queueStatus === "skipped_pending" ? "pending" : documentationSignal.pipelineStage,
        oasisStage: queueStatus === "skipped_pending" ? "pending_patient" : documentationSignal.oasisStage,
        primaryBlocker: documentationSignal.primaryBlocker,
        blockerReasons: documentationSignal.blockerReasons,
        oasisQaIssues: documentationSignal.oasisQaIssues,
        topOasisIssue: documentationSignal.topOasisIssue,
        oasisInternalMismatchCount: documentationSignal.oasisInternalMismatchCount,
        emptyOasisInputCount: documentationSignal.emptyOasisInputCount,
        visitNoteQaIssues: documentationSignal.visitNoteQaIssues,
        topVisitNoteIssue: documentationSignal.topVisitNoteIssue,
        visitNoteMismatchCount: documentationSignal.visitNoteMismatchCount,
        visitNoteActiveQaCount: documentationSignal.visitNoteActiveQaCount,
        visitNoteReviewStatus: documentationSignal.visitNoteReviewStatus,
        visitNotesDomStatus: documentationSignal.visitNotesDomStatus,
        referralAvailable: documentationSignal.referralAvailable,
        referralMedicationCount: documentationSignal.referralMedicationCount,
        reviewerStatus: effectiveReviewerStatus?.status ?? null,
        reviewerStatusUpdatedAt: effectiveReviewerStatus?.updatedAt ?? null,
        reviewerStatusUpdatedBy: effectiveReviewerStatus?.updatedBy ?? null,
      };
    }));
    const resolvedWorkbookSource: WorkbookSource = workbookSource
      ? {
          ...workbookSource,
          acquisition: workbookSource.acquisition ?? {
            providerId: batch.sourceWorkbook.acquisitionProvider,
            acquisitionReference: batch.sourceWorkbook.acquisitionReference,
            metadataPath: batch.sourceWorkbook.acquisitionReference,
            selectedAgencyName: batch.sourceWorkbook.acquisitionMetadata?.selectedAgencyName ?? null,
            selectedAgencyUrl: batch.sourceWorkbook.acquisitionMetadata?.selectedAgencyUrl ?? null,
            dashboardUrl: batch.sourceWorkbook.acquisitionMetadata?.dashboardUrl ?? null,
            notes: batch.sourceWorkbook.acquisitionNotes,
          },
          verification: workbookSource.verification ?? batch.sourceWorkbook.verification,
        }
      : createFallbackWorkbookSource(batch);
    const resolvedReviewWindow =
      reviewWindow ??
      createReviewWindow({
        agencyId: agency.id,
        startsAt: batch.sourceWorkbook.uploadedAt,
        timezone: batch.schedule.timezone,
      });

    return {
      agency,
      refreshCycle: {
        id: batch.schedule.scheduledRunId ?? `refresh-${batch.id}`,
        agencyId: agency.id,
        batchId: batch.id,
        status:
          batch.status === "FAILED"
            ? "failed"
            : batch.status === "RUNNING"
              ? "running"
              : batch.status === "CREATED" || batch.status === "PARSING"
                ? "pending"
                : "completed",
        workbookSource: resolvedWorkbookSource,
        reviewWindow: resolvedReviewWindow,
        scheduleTimezone: batch.schedule.timezone,
        scheduleLocalTimes: batch.schedule.localTimes,
        lastRefreshStartedAt: batch.run.requestedAt,
        lastRefreshCompletedAt: batch.run.completedAt,
        nextRefreshAt: batch.schedule.nextScheduledRunAt,
        queueSummary: resolvedQueueSummary,
      },
      queueEntries: resolvedQueueEntries,
      patientRecords,
      lastUpdatedAt: batch.updatedAt,
    };
  }

  async updateAgencyDashboardReviewerStatus(input: {
    agencyId: string;
    workItemId: string;
    status: DashboardReviewerStatus;
    updatedBy?: string | null;
  }): Promise<DashboardReviewerStatusEntry> {
    const agencyRecord = await this.subsidiaryConfigService.getSubsidiaryConfig(input.agencyId);
    const batches = (await this.repository.listBatches())
      .filter((batch) => batchBelongsToSubsidiary(batch, agencyRecord))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const batch = batches.find((candidate) => candidate.schedule.active) ?? batches[0] ?? null;
    if (!batch) {
      throw new Error(`No dashboard batch available for agency: ${input.agencyId}`);
    }

    const patientQueue = await this.repository.readJsonIfExists<PatientQueueArtifact>(
      path.join(batch.storage.outputRoot, "patient-queue.json"),
    );
    const queueEntry = patientQueue?.entries.find((entry) => entry.workItemId === input.workItemId);
    if (!queueEntry) {
      throw new Error(`Patient is not in the active agency dashboard queue: ${input.workItemId}`);
    }

    const artifactPath = reviewerStatusPathForBatch(batch);
    const now = new Date().toISOString();
    const existing = parseDashboardReviewerStatusArtifact(
      await this.repository.readJsonIfExists(artifactPath),
    );
    const entry: DashboardReviewerStatusEntry = {
      workItemId: input.workItemId,
      status: input.status,
      updatedAt: now,
      updatedBy: input.updatedBy?.trim() || null,
    };
    const artifact: DashboardReviewerStatusArtifact = {
      schemaVersion: "dashboard-reviewer-statuses.v1",
      generatedAt: now,
      agencyId: agencyRecord.id,
      batchId: batch.id,
      statuses: {
        ...(existing?.statuses ?? {}),
        [input.workItemId]: entry,
      },
    };
    await writeJsonFile(artifactPath, artifact);
    return entry;
  }

  async retryPatientRun(runId: string): Promise<{
    batchId: string;
    summary: BatchRecord["patientRuns"][number];
  }> {
    const locatedRun = await this.repository.findPatientRun(runId);
    if (!locatedRun) {
      throw new Error(`Patient run not found: ${runId}`);
    }

    if (this.activeBatchJobs.has(locatedRun.batch.id)) {
      const currentSummary = locatedRun.batch.patientRuns.find((patientRun) => patientRun.runId === runId);
      if (!currentSummary) {
        throw new Error(`Patient run not found: ${runId}`);
      }
      return {
        batchId: locatedRun.batch.id,
        summary: currentSummary,
      };
    }

    const workItems = await this.repository.readWorkItems(locatedRun.batch);
    const currentSummary = locatedRun.batch.patientRuns.find((patientRun) => patientRun.runId === runId);
    const workItem = workItems.find((candidate) => candidate.id === currentSummary?.workItemId);
    if (!workItem) {
      throw new Error(`Work item not found for patient run: ${runId}`);
    }

    const updatedBatch = await this.prepareRetryBatch(locatedRun.batch, [workItem]);
    const task = this.executeRetryWorkItems(updatedBatch.id, [workItem]).finally(() => {
      this.activeBatchJobs.delete(updatedBatch.id);
    });
    this.activeBatchJobs.set(updatedBatch.id, task);
    void task;

    const patientRunSummary = updatedBatch.patientRuns.find((patientRun) => patientRun.runId === runId);
    if (!patientRunSummary) {
      throw new Error(`Patient run not found after retry start: ${runId}`);
    }

    return {
      batchId: updatedBatch.id,
      summary: patientRunSummary,
    };
  }

  private async executeBatchRun(
    batchId: string,
    workItemsOverride?: PatientEpisodeWorkItem[],
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const manifest = await this.repository.readManifest(batch);
    const parserExceptions = await this.repository.readParserExceptions(batch);
    const workItems =
      workItemsOverride ??
      filterEligibleWorkItems(await this.repository.readWorkItems(batch), manifest);
    const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(
      batch.subsidiary.id,
    );

    try {
      this.logger.info(
        {
          batchId,
          subsidiaryId: batch.subsidiary.id,
          subsidiaryName: batch.subsidiary.name,
        },
        "read-only batch worker run started",
      );
      await executePatientWorkItems({
        batchId: batch.id,
        workItems,
        outputDir: batch.storage.outputRoot,
        subsidiaryRuntimeConfig,
        logger: this.logger,
        onPatientRunUpdate: async (patientRun) => {
          await this.persistPatientRunUpdate(batch.id, patientRun);
        },
      });

      await this.finalizeBatchExecution(batch.id, manifest, parserExceptions);
      await this.runPostBatchReferralIntakePhaseSafely(batch.id, "batch_run_completed");
      this.logger.info({ batchId }, "batch run completed");
    } catch (error) {
      await this.failBatch(batch.id, error, "run");
      throw error;
    }
  }

  private async seedPatientMemoryForWorkItems(
    batch: BatchRecord,
    workItems: PatientEpisodeWorkItem[],
    options: { overwrite: boolean },
  ): Promise<void> {
    for (const workItem of workItems) {
      try {
        const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
        const resolution = await this.patientMemoryService.resolvePatientMemory({
          agencySlug: batch.subsidiary.slug,
          workItem,
          matchResult: previous?.matchResult ?? null,
        });
        const currentFingerprint = buildWorkItemFingerprint(workItem);
        const targetPatientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", workItem.id);
        await mkdir(targetPatientArtifactsDirectory, { recursive: true });
        await writeJsonFile(
          path.join(targetPatientArtifactsDirectory, WORK_ITEM_FINGERPRINT_FILE_NAME),
          currentFingerprint,
        );
        if (!resolution.record.current) {
          continue;
        }

        const artifactRelativePaths = selectSeedArtifactPathsForFingerprint({
          previous: asWorkItemFingerprint(resolution.record.current.workItemFingerprint),
          current: currentFingerprint,
        });
        if (artifactRelativePaths && artifactRelativePaths.length === 0) {
          continue;
        }

        await this.patientMemoryService.seedPatientArtifacts({
          agencySlug: batch.subsidiary.slug,
          patientMemoryId: resolution.patientMemoryId,
          targetPatientArtifactsDirectory,
          artifactRelativePaths: artifactRelativePaths ?? undefined,
          overwrite: options.overwrite,
        });
      } catch (error) {
        this.logger.warn(
          {
            batchId: batch.id,
            workItemId: workItem.id,
            errorMessage: error instanceof Error ? error.message : "Unknown patient memory seed error.",
          },
          "patient memory seed skipped",
        );
      }
    }
  }

  private async createMemoryBackedCompletedPatientRun(
    batch: BatchRecord,
    workItem: PatientEpisodeWorkItem,
    previous?: BatchRecord["patientRuns"][number],
  ): Promise<BatchRecord["patientRuns"][number] | null> {
    const patientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", workItem.id);
    const expectedFingerprint = buildWorkItemFingerprint(workItem);
    const seededFingerprint = await this.repository.readJsonIfExists<WorkItemFingerprint>(
      path.join(patientArtifactsDirectory, WORK_ITEM_FINGERPRINT_FILE_NAME),
    );
    if (!isSameWorkItemFingerprint(seededFingerprint, expectedFingerprint)) {
      return null;
    }
    for (const relativePath of DEFAULT_REQUIRED_MEMORY_ARTIFACTS) {
      if (!(await this.repository.fileExists(path.join(patientArtifactsDirectory, relativePath)))) {
        return null;
      }
    }

    const patientDashboardStatePath = path.join(
      patientArtifactsDirectory,
      "patient-dashboard-state.json",
    );
    const patientDashboardState =
      await this.repository.readJsonIfExists<PatientDashboardState>(patientDashboardStatePath);

    if (!patientDashboardState || !isReusablePatientRunOutcome(patientDashboardState)) {
      return null;
    }

    const patientRunCacheSummary = await this.repository.readJsonIfExists<PatientRunCacheSummary>(
      path.join(batch.storage.outputRoot, "patients", workItem.id, "patient-run-cache-summary.json"),
    );
    const now = new Date().toISOString();
    const runId = createRunId(batch.id, workItem.id);
    const fallbackResultBundlePath = path.join(batch.storage.patientResultsDirectory, `${workItem.id}.json`);
    const resultBundlePath = patientDashboardState.resultBundlePath ?? fallbackResultBundlePath;
    const bundleAvailable =
      Boolean(patientDashboardState.resultBundlePath) &&
      (await this.repository.fileExists(patientDashboardState.resultBundlePath as string));
    const logAvailable =
      Boolean(patientDashboardState.logPath) &&
      (await this.repository.fileExists(patientDashboardState.logPath as string));

    this.logger.info(
      {
        batchId: batch.id,
        workItemId: workItem.id,
        patientName: patientDashboardState.patientName || workItem.patientIdentity.displayName,
        reusedFromPatientMemory: true,
        reusedOutcome: patientDashboardState.processingStatus,
        reusedExecutionStep: patientDashboardState.executionStep,
        priorRuntimeMs: patientRunCacheSummary?.totalRuntimeMs ?? null,
        estimatedSavedTimeMs: patientRunCacheSummary?.totalRuntimeMs ?? null,
        reuseSummary: patientRunCacheSummary?.reuseSummary ?? null,
      },
      "patient run skipped because reusable memory-backed artifacts were reused",
    );

    return {
      runId,
      subsidiaryId: workItem.subsidiaryId ?? batch.subsidiary.id,
      workItemId: workItem.id,
      patientName: patientDashboardState.patientName || workItem.patientIdentity.displayName,
      processingStatus: patientDashboardState.processingStatus,
      executionStep: patientDashboardState.executionStep ?? patientDashboardState.processingStatus,
      progressPercent: 100,
      startedAt: patientDashboardState.startedAt ?? patientDashboardState.generatedAt,
      completedAt: patientDashboardState.completedAt ?? patientDashboardState.generatedAt,
      lastUpdatedAt: now,
      matchResult: patientDashboardState.matchResult,
      qaOutcome: patientDashboardState.qaOutcome,
      oasisQaSummary: patientDashboardState.oasisQaSummary,
      artifactCount: patientDashboardState.artifactCount,
      hasFindings: patientDashboardState.hasFindings,
      bundleAvailable,
      logPath: patientDashboardState.logPath,
      logAvailable,
      retryEligible: false,
      errorSummary: patientDashboardState.errorSummary,
      resultBundlePath,
      evidenceDirectory: path.join(batch.storage.evidenceDirectory, workItem.id),
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
      workflowRuns: patientDashboardState.workflowRuns.length > 0
        ? patientDashboardState.workflowRuns
        : createDefaultWorkflowRuns(runId, now),
      lastAttemptAt: patientDashboardState.completedAt ?? patientDashboardState.lastUpdatedAt,
      attemptCount: Math.max(previous?.attemptCount ?? 0, 1),
    };
  }

  private async findPatientMemoryCurrentDirectory(
    batch: BatchRecord,
    workItem: PatientEpisodeWorkItem,
    matchResult: PatientMatchResult | null,
  ): Promise<string | null> {
    try {
      const resolution = await this.patientMemoryService.resolvePatientMemory({
        agencySlug: batch.subsidiary.slug,
        workItem,
        matchResult,
      });
      const dashboardArtifact =
        resolution.record.current?.artifacts["patient-dashboard-state.json"] ??
        resolution.index.records[resolution.patientMemoryId]?.current?.artifacts["patient-dashboard-state.json"] ??
        null;
      if (!dashboardArtifact || !(await this.repository.fileExists(dashboardArtifact.currentPath))) {
        return null;
      }

      return path.dirname(dashboardArtifact.currentPath);
    } catch (error) {
      this.logger.warn(
        {
          batchId: batch.id,
          workItemId: workItem.id,
          errorMessage: error instanceof Error ? error.message : "Unknown patient memory lookup error.",
        },
        "patient memory dashboard fallback skipped",
      );
      return null;
    }
  }

  private async reprojectBatchFromPatientMemory(
    batch: BatchRecord,
    workItems: PatientEpisodeWorkItem[],
  ): Promise<BatchRecord> {
    const now = new Date().toISOString();
    batch.patientRuns = workItems.map((workItem) => {
      const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
      return previous ?? createPendingPatientRunState(batch, workItem);
    });
    batch.status = "COMPLETED";
    batch.updatedAt = now;
    batch.run.requestedAt = batch.run.requestedAt ?? now;
    batch.run.completedAt = now;
    batch.run.patientRunCount = countProcessedPatientRuns(batch);
    batch.run.lastError = deriveBatchErrorSummary(batch);
    this.markDeltaRunCompleted(batch, now);
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
    this.logger.info(
      {
        batchId: batch.id,
        subsidiaryId: batch.subsidiary.id,
        workItems: workItems.length,
      },
      "batch dashboard reprojected from patient memory",
    );
    return batch;
  }

  private async loadReferralSourceDocumentsFromExistingArtifacts(
    patientArtifactsDirectory: string,
  ): Promise<ReferralSourceDocumentInput[]> {
    const sourceMeta = await this.repository.readJsonIfExists<SourceDocumentArtifact>(
      path.join(patientArtifactsDirectory, "referral-document-processing", "source-meta.json"),
    );
    return (sourceMeta?.sourceDocuments ?? [])
      .filter((document) => Boolean(document.localFilePath))
      .map((document) => ({
        sourceLabel: document.sourceLabel,
        sourcePath: document.localFilePath,
        extractedTextPath: null,
        portalLabel: document.portalLabel,
        acquisitionMethod: document.acquisitionMethod,
      }));
  }

  private buildReferralIntakeJobKey(batchId: string, patientId: string): string {
    return `referral-intake:${batchId}:${patientId}`;
  }

  private buildClinicalRefreshJobKey(batch: BatchRecord, patientId: string): string {
    return `clinical-refresh:${batch.subsidiary.id}:${patientId}`;
  }

  private async evaluateClinicalRefreshPreflight(
    batch: BatchRecord,
  ): Promise<NonNullable<PatientClinicalRefreshState["preflight"]>> {
    const checkedAt = new Date().toISOString();
    const reasons: string[] = [];
    let portalCredentialsConfigured = false;
    let portalDashboardUrlConfigured = false;
    try {
      const runtimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(batch.subsidiary.id);
      portalCredentialsConfigured = Boolean(runtimeConfig.credentials.username && runtimeConfig.credentials.password);
      portalDashboardUrlConfigured = Boolean(runtimeConfig.portalDashboardUrl || runtimeConfig.portalBaseUrl);
      if (!portalCredentialsConfigured) {
        reasons.push("portal credentials are not configured");
      }
      if (!portalDashboardUrlConfigured) {
        reasons.push("portal dashboard/base URL is not configured");
      }
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "subsidiary portal runtime configuration is unavailable");
    }
    return {
      ok: reasons.length === 0,
      checkedAt,
      reasons,
      portalCredentialsConfigured,
      portalDashboardUrlConfigured,
    };
  }

  private async writeClinicalRefreshState(
    patientArtifactsDirectory: string,
    state: PatientClinicalRefreshState,
  ): Promise<void> {
    await writeJsonFile(getClinicalRefreshStatePath(patientArtifactsDirectory), state);
  }

  private async findActivePatientChartWorkRunForSubsidiary(
    sourceBatch: BatchRecord,
    patientId: string,
  ): Promise<BatchRecord["patientRuns"][number] | null> {
    const batches = await this.repository.listBatches();
    for (const batch of batches) {
      if (batch.subsidiary.id !== sourceBatch.subsidiary.id && batch.subsidiary.slug !== sourceBatch.subsidiary.slug) {
        continue;
      }
      const activeRun = this.getActivePatientChartWorkRun(batch, patientId);
      if (activeRun) {
        return activeRun;
      }
    }
    return null;
  }

  private async seedClinicalRefreshAttempt(input: {
    batch: BatchRecord;
    workItem: PatientEpisodeWorkItem;
    attemptOutputRoot: string;
  }): Promise<void> {
    const sourcePatientArtifactsDirectory = getPatientArtifactsDirectory(input.batch, input.workItem.id);
    const attemptPatientArtifactsDirectory = path.join(
      input.attemptOutputRoot,
      "patients",
      input.workItem.id,
    );
    await copyDirectoryContents({
      sourceDirectory: sourcePatientArtifactsDirectory,
      targetDirectory: attemptPatientArtifactsDirectory,
    });

    try {
      const previous = input.batch.patientRuns.find((patientRun) => patientRun.workItemId === input.workItem.id);
      const resolution = await this.patientMemoryService.resolvePatientMemory({
        agencySlug: input.batch.subsidiary.slug,
        workItem: input.workItem,
        matchResult: previous?.matchResult ?? null,
      });
      if (resolution.record.current) {
        await this.patientMemoryService.seedPatientArtifacts({
          agencySlug: input.batch.subsidiary.slug,
          patientMemoryId: resolution.patientMemoryId,
          targetPatientArtifactsDirectory: attemptPatientArtifactsDirectory,
          overwrite: false,
        });
      }
    } catch (error) {
      this.logger.warn(
        {
          batchId: input.batch.id,
          workItemId: input.workItem.id,
          errorMessage: error instanceof Error ? error.message : "Unknown patient memory seed error.",
        },
        "patient clinical refresh memory seed skipped",
      );
    }
  }

  private async runClinicalRefreshPipeline(input: ClinicalRefreshJobRunnerInput): Promise<PatientRun> {
    if (this.options.clinicalRefreshJobRunner) {
      return this.options.clinicalRefreshJobRunner(input);
    }

    const [patientRun] = await executePatientWorkItems({
      batchId: input.batchId,
      workItems: [input.workItem],
      outputDir: input.attemptOutputRoot,
      workflowDomains: ["qa"],
      targetOasisAssessmentId: input.targetOasisAssessmentId,
      subsidiaryRuntimeConfig: input.subsidiaryRuntimeConfig,
      logger: this.logger,
      onPatientRunUpdate: input.onPatientRunUpdate,
    });
    if (!patientRun) {
      throw new Error(`No patient run was produced for patient: ${input.patientId}`);
    }
    return patientRun;
  }

  private normalizeClinicalRefreshPatientRunPaths(input: {
    patientRun: PatientRun;
    attemptOutputRoot: string;
    canonicalOutputRoot: string;
  }): PatientRun {
    const replace = (value: string | null | undefined) =>
      replacePathPrefix(value, input.attemptOutputRoot, input.canonicalOutputRoot);
    return {
      ...input.patientRun,
      resultBundlePath: replace(input.patientRun.resultBundlePath),
      logPath: replace(input.patientRun.logPath),
      artifacts: input.patientRun.artifacts.map((artifact) => ({
        ...artifact,
        downloadPath: replace(artifact.downloadPath),
      })),
      auditArtifacts: {
        tracePath: replace(input.patientRun.auditArtifacts.tracePath),
        screenshotPaths: input.patientRun.auditArtifacts.screenshotPaths.map((screenshotPath) =>
          replace(screenshotPath) ?? screenshotPath),
        downloadPaths: input.patientRun.auditArtifacts.downloadPaths.map((downloadPath) =>
          replace(downloadPath) ?? downloadPath),
      },
      workflowRuns: input.patientRun.workflowRuns.map((workflowRun) => ({
        ...workflowRun,
        workflowResultPath: replace(workflowRun.workflowResultPath),
        workflowLogPath: replace(workflowRun.workflowLogPath),
      })),
    };
  }

  private async promoteClinicalRefreshAttempt(input: {
    batch: BatchRecord;
    patientRun: PatientRun;
    attemptOutputRoot: string;
  }): Promise<{
    patientRun: PatientRun;
    reuseSummary: PatientRunCacheSummary["reuseSummary"] | null;
  }> {
    const patientId = input.patientRun.workItemId;
    const attemptPatientArtifactsDirectory = path.join(input.attemptOutputRoot, "patients", patientId);
    const canonicalPatientArtifactsDirectory = getPatientArtifactsDirectory(input.batch, patientId);
    await copyDirectoryContents({
      sourceDirectory: attemptPatientArtifactsDirectory,
      targetDirectory: canonicalPatientArtifactsDirectory,
      shouldCopy: shouldPromoteClinicalRefreshPath,
    });
    await copyDirectoryContents({
      sourceDirectory: path.join(input.attemptOutputRoot, "evidence", patientId),
      targetDirectory: path.join(input.batch.storage.evidenceDirectory, patientId),
    });

    const normalizedRun = this.normalizeClinicalRefreshPatientRunPaths({
      patientRun: input.patientRun,
      attemptOutputRoot: input.attemptOutputRoot,
      canonicalOutputRoot: input.batch.storage.outputRoot,
    });
    normalizedRun.resultBundlePath = path.join(input.batch.storage.patientResultsDirectory, `${patientId}.json`);
    normalizedRun.bundleAvailable = true;
    normalizedRun.logPath =
      normalizedRun.logPath ?? path.join(input.batch.storage.outputRoot, "logs", `${patientId}.json`);
    if (input.patientRun.logPath && normalizedRun.logPath) {
      await mkdir(path.dirname(normalizedRun.logPath), { recursive: true });
      await copyFile(input.patientRun.logPath, normalizedRun.logPath).catch(() => undefined);
    }
    await writePatientDashboardState({
      outputDirectory: input.batch.storage.outputRoot,
      run: normalizedRun,
    });
    await mkdir(path.dirname(normalizedRun.resultBundlePath), { recursive: true });
    await writeJsonFile(normalizedRun.resultBundlePath, normalizedRun);
    const cacheSummary = await this.repository.readJsonIfExists<PatientRunCacheSummary>(
      path.join(canonicalPatientArtifactsDirectory, "patient-run-cache-summary.json"),
    );
    await this.persistPatientRunUpdate(input.batch.id, normalizedRun);
    return {
      patientRun: normalizedRun,
      reuseSummary: cacheSummary?.reuseSummary ?? null,
    };
  }

  private async executePatientClinicalRefreshJob(input: {
    batchId: string;
    patientId: string;
    targetOasisAssessmentId: string | null;
    refreshId: string;
    attemptOutputRoot: string;
    workItem: PatientEpisodeWorkItem;
  }): Promise<void> {
    const batch = await this.mustGetBatch(input.batchId);
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, input.patientId);
    let state = await this.repository.readJsonIfExists<PatientClinicalRefreshState>(
      getClinicalRefreshStatePath(patientArtifactsDirectory),
    );
    const startedAt = new Date().toISOString();
    state = createClinicalRefreshState({
      batchId: input.batchId,
      patientId: input.patientId,
      targetOasisAssessmentId: input.targetOasisAssessmentId,
      refreshId: input.refreshId,
      status: "running",
      now: startedAt,
      existing: state,
      attemptOutputRoot: input.attemptOutputRoot,
      message: input.targetOasisAssessmentId
        ? "Patient refresh is reprocessing the selected OASIS assessment, Plan of Care, and Visit Notes state."
        : "Patient refresh is checking the current OASIS, Plan of Care, and Visit Notes state.",
    });
    await this.writeClinicalRefreshState(patientArtifactsDirectory, state);
    try {
      await this.seedClinicalRefreshAttempt({
        batch,
        workItem: input.workItem,
        attemptOutputRoot: input.attemptOutputRoot,
      });

      const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(batch.subsidiary.id);
      const patientRun = await this.runClinicalRefreshPipeline({
        batchId: input.batchId,
        patientId: input.patientId,
        targetOasisAssessmentId: input.targetOasisAssessmentId,
        workItem: input.workItem,
        attemptOutputRoot: input.attemptOutputRoot,
        subsidiaryRuntimeConfig,
        onPatientRunUpdate: async (updatedRun) => {
          const now = new Date().toISOString();
          state = createClinicalRefreshState({
            batchId: input.batchId,
            patientId: input.patientId,
            targetOasisAssessmentId: input.targetOasisAssessmentId,
            refreshId: input.refreshId,
            status: "running",
            now,
            existing: state,
            attemptOutputRoot: input.attemptOutputRoot,
            message: `${updatedRun.processingStatus}: ${updatedRun.executionStep}`,
          });
          await this.writeClinicalRefreshState(patientArtifactsDirectory, state);
        },
      });

      if (patientRun.processingStatus === "FAILED") {
        const now = new Date().toISOString();
        await this.writeClinicalRefreshState(patientArtifactsDirectory, createClinicalRefreshState({
          batchId: input.batchId,
          patientId: input.patientId,
          targetOasisAssessmentId: input.targetOasisAssessmentId,
          refreshId: input.refreshId,
          status: "failed",
          now,
          existing: state,
          attemptOutputRoot: input.attemptOutputRoot,
          message: "Patient refresh failed; existing dashboard artifacts were left unchanged.",
          lastError: patientRun.errorSummary ?? "Patient refresh failed.",
        }));
        return;
      }

      const promoted = await this.promoteClinicalRefreshAttempt({
        batch,
        patientRun,
        attemptOutputRoot: input.attemptOutputRoot,
      });
      const now = new Date().toISOString();
      await this.writeClinicalRefreshState(patientArtifactsDirectory, createClinicalRefreshState({
        batchId: input.batchId,
        patientId: input.patientId,
        targetOasisAssessmentId: input.targetOasisAssessmentId,
        refreshId: input.refreshId,
        status: "completed",
        now,
        existing: state,
        attemptOutputRoot: input.attemptOutputRoot,
        promotedAt: now,
        reuseSummary: promoted.reuseSummary,
        message: `Patient refresh completed with status ${promoted.patientRun.processingStatus}.`,
      }));
    } catch (error) {
      const now = new Date().toISOString();
      await this.writeClinicalRefreshState(patientArtifactsDirectory, createClinicalRefreshState({
        batchId: input.batchId,
        patientId: input.patientId,
        targetOasisAssessmentId: input.targetOasisAssessmentId,
        refreshId: input.refreshId,
        status: "failed",
        now,
        existing: state,
        attemptOutputRoot: input.attemptOutputRoot,
        message: "Patient refresh failed; existing dashboard artifacts were left unchanged.",
        lastError: error instanceof Error ? error.message : "Unknown patient refresh error.",
      }));
      throw error;
    }
  }

  private getPostBatchReferralIntakeSummaryPath(batch: BatchRecord): string {
    return path.join(batch.storage.outputRoot, POST_BATCH_REFERRAL_INTAKE_SUMMARY_FILE_NAME);
  }

  private async executePatientReferralIntakeJob(input: {
    batchId: string;
    patientId: string;
    patientArtifactsDirectory: string;
    workItem: PatientEpisodeWorkItem;
    trigger: ReferralIntakeExecutionTrigger;
  }): Promise<void> {
    const customRunner = this.options.referralIntakeJobRunner;
    if (customRunner) {
      const state = await customRunner(input);
      if (state) {
        await this.writeReferralIntakeState(input.patientArtifactsDirectory, state);
      }
      return;
    }

    await this.runPatientReferralIntakeJob(input.batchId, input.patientId);
  }

  private buildPostBatchReferralSkipResult(input: {
    workItem: PatientEpisodeWorkItem;
    reason: string;
    error?: string | null;
  }): PostBatchReferralIntakePatientResult {
    return {
      patientId: input.workItem.id,
      patientName: input.workItem.patientIdentity.displayName,
      status: "skipped",
      referralIntakeStatus: null,
      processedCount: 0,
      reusedCount: 0,
      newOrChangedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      documentCount: 0,
      sourceDocumentCount: 0,
      reason: input.reason,
      error: input.error ?? null,
    };
  }

  private buildPostBatchReferralStateResult(input: {
    workItem: PatientEpisodeWorkItem;
    state: ReferralIntakeState;
  }): PostBatchReferralIntakePatientResult {
    return {
      patientId: input.workItem.id,
      patientName: input.workItem.patientIdentity.displayName,
      status: input.state.status === "failed" ? "failed" : "processed",
      referralIntakeStatus: input.state.status,
      processedCount: input.state.processedCount,
      reusedCount: input.state.reusedCount,
      newOrChangedCount: input.state.newOrChangedCount,
      failedCount: input.state.failedCount,
      skippedCount: input.state.skippedCount,
      documentCount: input.state.documentCount,
      sourceDocumentCount: input.state.sourceDocumentCount,
      reason: input.state.message,
      error: input.state.lastError,
    };
  }

  private async runPostBatchReferralIntakeForPatient(input: {
    batch: BatchRecord;
    workItem: PatientEpisodeWorkItem;
  }): Promise<PostBatchReferralIntakePatientResult> {
    const batchId = input.batch.id;
    const patientId = input.workItem.id;
    const jobKey = this.buildReferralIntakeJobKey(batchId, patientId);
    if (this.activeReferralIntakeJobs.has(jobKey)) {
      return this.buildPostBatchReferralSkipResult({
        workItem: input.workItem,
        reason: "referral_intake_already_running",
      });
    }

    const patientArtifactsDirectory = getPatientArtifactsDirectory(input.batch, patientId);
    const existing = await this.repository.readJsonIfExists<ReferralIntakeState>(
      getReferralIntakeStatePath(patientArtifactsDirectory),
    );
    const queuedState = createReferralIntakeState({
      batchId,
      patientId,
      status: "pending",
      now: new Date().toISOString(),
      existing,
      message: "Referral intake queued after the OASIS batch completed.",
    });
    await this.writeReferralIntakeState(patientArtifactsDirectory, queuedState);

    const task = this.executePatientReferralIntakeJob({
      batchId,
      patientId,
      patientArtifactsDirectory,
      workItem: input.workItem,
      trigger: "post_batch",
    }).finally(() => {
      this.activeReferralIntakeJobs.delete(jobKey);
    });
    this.activeReferralIntakeJobs.set(jobKey, task);

    try {
      await task;
      const state = await this.getPatientReferralIntakeStatus(batchId, patientId);
      return this.buildPostBatchReferralStateResult({ workItem: input.workItem, state });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown referral intake error.";
      const state = await this.getPatientReferralIntakeStatus(batchId, patientId).catch(() => null);
      if (state?.status === "failed" || state?.status === "completed") {
        return this.buildPostBatchReferralStateResult({ workItem: input.workItem, state });
      }
      const failedState = createReferralIntakeState({
        batchId,
        patientId,
        status: "failed",
        now: new Date().toISOString(),
        existing: state,
        lastError: errorMessage,
        message: "Static referral intake failed for this patient.",
      });
      await this.writeReferralIntakeState(patientArtifactsDirectory, failedState);
      return this.buildPostBatchReferralStateResult({ workItem: input.workItem, state: failedState });
    }
  }

  private shouldRunPostBatchReferralIntakeForPatient(input: {
    workItem: PatientEpisodeWorkItem;
    patientRun: BatchRecord["patientRuns"][number] | undefined;
    queueStatus: PatientQueueArtifact["entries"][number]["status"] | undefined;
  }): string | null {
    if (input.queueStatus && input.queueStatus !== "eligible") {
      return `queue_status_${input.queueStatus}`;
    }
    if (!input.patientRun) {
      return "missing_patient_run";
    }
    if (input.patientRun.matchResult.status !== "EXACT") {
      return `match_status_${input.patientRun.matchResult.status}`;
    }
    if (isStatusOnlyExcludedPatientRun(input.patientRun)) {
      return "portal_status_excluded";
    }
    return null;
  }

  private async runPostBatchReferralIntakePhase(
    batchId: string,
    reason: string,
  ): Promise<PostBatchReferralIntakeSummary | null> {
    const startedAt = new Date().toISOString();
    const batch = await this.mustGetBatch(batchId);
    const manifest = await this.repository.readManifest(batch);
    const workItems = filterEligibleWorkItems(await this.repository.readWorkItems(batch), manifest);
    if (workItems.length === 0) {
      return null;
    }

    const patientQueue = await this.repository.readJsonIfExists<PatientQueueArtifact>(
      path.join(batch.storage.outputRoot, "patient-queue.json"),
    );
    const queueStatusByWorkItemId = new Map(
      (patientQueue?.entries ?? []).map((entry) => [entry.workItemId, entry.status]),
    );
    const patientRunByWorkItemId = new Map(batch.patientRuns.map((patientRun) => [patientRun.workItemId, patientRun]));
    const results: PostBatchReferralIntakePatientResult[] = [];

    for (const workItem of workItems) {
      const skipReason = this.shouldRunPostBatchReferralIntakeForPatient({
        workItem,
        patientRun: patientRunByWorkItemId.get(workItem.id),
        queueStatus: queueStatusByWorkItemId.get(workItem.id),
      });
      if (skipReason) {
        results.push(this.buildPostBatchReferralSkipResult({ workItem, reason: skipReason }));
        continue;
      }

      results.push(await this.runPostBatchReferralIntakeForPatient({ batch, workItem }));
    }

    const completedAt = new Date().toISOString();
    const summary: PostBatchReferralIntakeSummary = {
      schemaVersion: "post-batch-referral-intake-summary.v1",
      batchId,
      subsidiaryId: batch.subsidiary.id,
      trigger: "post_batch",
      reason,
      startedAt,
      completedAt,
      processedPatientCount: results.filter((result) => result.status === "processed").length,
      failedPatientCount: results.filter((result) => result.status === "failed").length,
      skippedPatientCount: results.filter((result) => result.status === "skipped").length,
      documentCount: results.reduce((total, result) => total + result.documentCount, 0),
      sourceDocumentCount: results.reduce((total, result) => total + result.sourceDocumentCount, 0),
      results,
    };
    await writeJsonFile(this.getPostBatchReferralIntakeSummaryPath(batch), summary);

    const logPayload = {
      batchId,
      subsidiaryId: batch.subsidiary.id,
      processedPatientCount: summary.processedPatientCount,
      failedPatientCount: summary.failedPatientCount,
      skippedPatientCount: summary.skippedPatientCount,
      documentCount: summary.documentCount,
      summaryPath: this.getPostBatchReferralIntakeSummaryPath(batch),
    };
    if (summary.failedPatientCount > 0) {
      this.logger.warn(logPayload, "post-batch referral intake completed with patient failures");
    } else {
      this.logger.info(logPayload, "post-batch referral intake completed");
    }

    return summary;
  }

  private async runPostBatchReferralIntakePhaseSafely(batchId: string, reason: string): Promise<void> {
    try {
      await this.runPostBatchReferralIntakePhase(batchId, reason);
    } catch (error) {
      this.logger.error(
        {
          batchId,
          reason,
          errorMessage: error instanceof Error ? error.message : "Unknown post-batch referral intake error.",
        },
        "post-batch referral intake phase failed after OASIS batch completion",
      );
    }
  }

  private buildOasisCheckJobKey(batchId: string, patientId: string, assessmentId: string): string {
    return `oasis-check:${batchId}:${patientId}:${assessmentId}`;
  }

  private getActivePatientChartWorkRun(
    batch: BatchRecord,
    patientId: string,
  ): BatchRecord["patientRuns"][number] | null {
    return batch.patientRuns.find((patientRun) =>
      patientRun.workItemId === patientId && isActivePatientChartWorkStatus(patientRun.processingStatus)
    ) ?? null;
  }

  private async waitForPatientChartWorkSlot(input: {
    batchId: string;
    patientId: string;
    patientArtifactsDirectory: string;
    existingState: ReferralIntakeState | null;
  }): Promise<boolean> {
    const startedAt = Date.now();
    let currentState = input.existingState;
    let waited = false;

    while (Date.now() - startedAt < REFERRAL_INTAKE_ACTIVE_PATIENT_WAIT_TIMEOUT_MS) {
      const batch = await this.mustGetBatch(input.batchId);
      const activeRun = this.getActivePatientChartWorkRun(batch, input.patientId);
      if (!activeRun) {
        return waited;
      }

      waited = true;
      const now = new Date().toISOString();
      currentState = createReferralIntakeState({
        batchId: input.batchId,
        patientId: input.patientId,
        status: "pending",
        now,
        existing: currentState,
        message: `Referral intake is queued while this patient is actively in ${activeRun.processingStatus}.`,
      });
      await this.writeReferralIntakeState(input.patientArtifactsDirectory, currentState);
      await new Promise((resolve) => setTimeout(resolve, REFERRAL_INTAKE_ACTIVE_PATIENT_WAIT_INTERVAL_MS));
    }

    throw new Error("Referral intake timed out waiting for the active patient automation step to finish.");
  }

  private async writeReferralIntakeState(
    patientArtifactsDirectory: string,
    state: ReferralIntakeState,
  ): Promise<void> {
    await writeJsonFile(getReferralIntakeStatePath(patientArtifactsDirectory), state);
  }

  private async writeOasisCheckState(
    patientArtifactsDirectory: string,
    state: PatientOasisCheckState,
  ): Promise<void> {
    await writeJsonFile(getOasisCheckStatePath(patientArtifactsDirectory), state);
  }

  private async waitForPatientChartWorkSlotForOasisCheck(input: {
    batchId: string;
    patientId: string;
    assessmentId: string;
    patientArtifactsDirectory: string;
    existingState: PatientOasisCheckState | null;
  }): Promise<boolean> {
    const startedAt = Date.now();
    let currentState = input.existingState;
    let currentAssessmentState = currentState?.checks?.[input.assessmentId] ?? null;
    let waited = false;

    while (Date.now() - startedAt < REFERRAL_INTAKE_ACTIVE_PATIENT_WAIT_TIMEOUT_MS) {
      const batch = await this.mustGetBatch(input.batchId);
      const activeRun = this.getActivePatientChartWorkRun(batch, input.patientId);
      if (!activeRun) {
        return waited;
      }

      waited = true;
      const now = new Date().toISOString();
      currentAssessmentState = createOasisCheckAssessmentState({
        batchId: input.batchId,
        patientId: input.patientId,
        assessmentId: input.assessmentId,
        status: "pending",
        now,
        existing: currentAssessmentState,
        message: `OASIS check is queued while this patient is actively in ${activeRun.processingStatus}.`,
      });
      currentState = createOasisCheckState({
        batchId: input.batchId,
        patientId: input.patientId,
        now,
        existing: currentState,
        assessmentState: currentAssessmentState,
      });
      await this.writeOasisCheckState(input.patientArtifactsDirectory, currentState);
      await new Promise((resolve) => setTimeout(resolve, REFERRAL_INTAKE_ACTIVE_PATIENT_WAIT_INTERVAL_MS));
    }

    throw new Error("OASIS check timed out waiting for the active patient automation step to finish.");
  }

  private async resolveOasisCheckAssessment(input: {
    patientArtifactsDirectory: string;
    assessmentId: string;
  }): Promise<ResolvedOasisCheckAssessment> {
    const snapshot = await this.repository.readJsonIfExists<PatientPortalStatusSnapshot>(
      getPatientPortalStatusSnapshotPath(input.patientArtifactsDirectory),
    );
    const manifest = asRecord(await this.repository.readJsonIfExists(
      path.join(input.patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
    ));
    const manifestEntries = asArray(manifest?.assessments)
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    const manifestEntry = manifestEntries.find((entry) => asString(entry.assessmentId) === input.assessmentId) ?? null;
    const snapshotAssessment = (snapshot?.oasisAssessments ?? []).find((entry) => entry.id === input.assessmentId) ?? null;
    const legacyCurrentAlias = input.assessmentId === "current-oasis";
    const rootDomState = legacyCurrentAlias
      ? asRecord(await this.repository.readJsonIfExists(path.join(input.patientArtifactsDirectory, "oasis-dom-extracted-state.json")))
      : null;
    const isCurrent =
      snapshot?.currentOasisAssessmentId === input.assessmentId ||
      manifestEntry?.isCurrent === true ||
      legacyCurrentAlias;

    if (!snapshotAssessment && !manifestEntry && !isCurrent) {
      throw new Error(`Selected OASIS assessment was not found: ${input.assessmentId}`);
    }

    const artifactDirectory =
      asString(manifestEntry?.artifactDirectory) ??
      (snapshotAssessment
        ? path.join(input.patientArtifactsDirectory, "oasis-assessments", safeOasisAssessmentKey({
            assessmentId: input.assessmentId,
            title: snapshotAssessment.title,
            date: snapshotAssessment.date,
          }))
        : (isCurrent ? input.patientArtifactsDirectory : null));
    if (!artifactDirectory) {
      throw new Error(`Selected OASIS assessment has no artifact directory: ${input.assessmentId}`);
    }

    return {
      assessmentId: input.assessmentId,
      assessmentType:
        asString(manifestEntry?.assessmentType) ??
        snapshotAssessment?.assessmentType ??
        asString(rootDomState?.assessmentType) ??
        null,
      title:
        asString(manifestEntry?.title) ??
        snapshotAssessment?.title ??
        asString(rootDomState?.assessmentTitle) ??
        asString(rootDomState?.assessmentType) ??
        null,
      date:
        asString(manifestEntry?.date) ??
        snapshotAssessment?.date ??
        asString(rootDomState?.assessmentDate) ??
        asString(rootDomState?.extractedAt) ??
        null,
      sourceRowText: snapshotAssessment?.sourceRowText ?? null,
      artifactDirectory,
      sectionOutputsPath:
        asString(manifestEntry?.sectionOutputsPath) ??
        (isCurrent ? path.join(input.patientArtifactsDirectory, "oasis-dom-section-outputs.json") : null),
      domStatePath:
        asString(manifestEntry?.domStatePath) ??
        (isCurrent ? path.join(input.patientArtifactsDirectory, "oasis-dom-extracted-state.json") : null),
      mggSnapshotPath:
        asString(manifestEntry?.mggSnapshotPath) ??
        (isCurrent ? path.join(input.patientArtifactsDirectory, "oasis-mgg-field-snapshot.json") : null),
    };
  }

  private async resolveOasisCheckBaselineAssessment(input: {
    patientArtifactsDirectory: string;
    selectedAssessment: ResolvedOasisCheckAssessment;
  }): Promise<(ResolvedOasisCheckAssessment & { selectionReason: string }) | null> {
    const snapshot = await this.repository.readJsonIfExists<PatientPortalStatusSnapshot>(
      getPatientPortalStatusSnapshotPath(input.patientArtifactsDirectory),
    );
    const manifest = asRecord(await this.repository.readJsonIfExists(
      path.join(input.patientArtifactsDirectory, "oasis-assessment-processing-manifest.json"),
    ));
    const candidateIds = new Set<string>();
    for (const assessment of snapshot?.oasisAssessments ?? []) {
      if (assessment.id !== input.selectedAssessment.assessmentId) {
        candidateIds.add(assessment.id);
      }
    }
    for (const assessment of asArray(manifest?.assessments).map(asRecord)) {
      const id = asString(assessment?.assessmentId);
      if (id && id !== input.selectedAssessment.assessmentId) {
        candidateIds.add(id);
      }
    }

    const candidates: ResolvedOasisCheckAssessment[] = [];
    for (const assessmentId of candidateIds) {
      try {
        const assessment = await this.resolveOasisCheckAssessment({
          patientArtifactsDirectory: input.patientArtifactsDirectory,
          assessmentId,
        });
        if (!isDischargedOasisAssessment(assessment)) {
          candidates.push(assessment);
        }
      } catch {
        continue;
      }
    }

    const sortEarliest = (left: ResolvedOasisCheckAssessment, right: ResolvedOasisCheckAssessment) =>
      oasisAssessmentDateSortValue(left.date) - oasisAssessmentDateSortValue(right.date) ||
      left.assessmentId.localeCompare(right.assessmentId);

    const earliestCandidate = candidates.sort(sortEarliest)[0] ?? null;
    return earliestCandidate
      ? {
          ...earliestCandidate,
          selectionReason: "earliest_non_discharge_oasis",
        }
      : null;
  }

  private async loadOasisCheckSectionOutputs(
    assessment: ResolvedOasisCheckAssessment,
  ): Promise<OasisDomSectionOutputsArtifact | null> {
    if (!assessment.sectionOutputsPath) {
      return null;
    }
    const artifact = await this.repository.readJsonIfExists<OasisDomSectionOutputsArtifact>(
      assessment.sectionOutputsPath,
    );
    return artifact?.schemaVersion === "oasis-dom-section-outputs.v1" ? artifact : null;
  }

  private async loadOasisCheckMggSnapshot(
    assessment: ResolvedOasisCheckAssessment,
  ): Promise<OasisMggFieldSnapshotArtifact | null> {
    if (!assessment.mggSnapshotPath) {
      return null;
    }
    const artifact = await this.repository.readJsonIfExists<OasisMggFieldSnapshotArtifact>(
      assessment.mggSnapshotPath,
    );
    return artifact?.schemaVersion === "oasis-mgg-field-snapshot.v1" ? artifact : null;
  }

  private async runPatientOasisCheckJob(input: {
    batchId: string;
    patientId: string;
    assessmentId: string;
  }): Promise<void> {
    const batch = await this.mustGetBatch(input.batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === input.patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${input.patientId}`);
    }

    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, input.patientId);
    const previousState = await this.repository.readJsonIfExists<PatientOasisCheckState>(
      getOasisCheckStatePath(patientArtifactsDirectory),
    );
    const previousAssessmentState = previousState?.checks?.[input.assessmentId] ?? null;
    let runningState: PatientOasisCheckState | null = previousState;
    let runningAssessmentState: PatientOasisCheckAssessmentState | null = previousAssessmentState;

    try {
      await this.waitForPatientChartWorkSlotForOasisCheck({
        batchId: input.batchId,
        patientId: input.patientId,
        assessmentId: input.assessmentId,
        patientArtifactsDirectory,
        existingState: previousState,
      });

      const startedAt = new Date().toISOString();
      runningAssessmentState = createOasisCheckAssessmentState({
        batchId: input.batchId,
        patientId: input.patientId,
        assessmentId: input.assessmentId,
        status: "running",
        now: startedAt,
        existing: previousAssessmentState,
        message: "Running internal OASIS mismatch review for the selected assessment.",
      });
      runningState = createOasisCheckState({
        batchId: input.batchId,
        patientId: input.patientId,
        now: startedAt,
        existing: previousState,
        assessmentState: runningAssessmentState,
      });
      await this.writeOasisCheckState(patientArtifactsDirectory, runningState);

      const assessment = await this.resolveOasisCheckAssessment({
        patientArtifactsDirectory,
        assessmentId: input.assessmentId,
      });
      const selectedIsDischarge = isDischargedOasisAssessment(assessment);
      const baselineAssessment = selectedIsDischarge
        ? await this.resolveOasisCheckBaselineAssessment({
            patientArtifactsDirectory,
            selectedAssessment: assessment,
          })
        : null;
      const env = loadEnv();
      const selectedSectionOutputs = await this.loadOasisCheckSectionOutputs(assessment);
      if (!selectedSectionOutputs) {
        throw new Error(`Selected OASIS assessment has no processed DOM section outputs: ${assessment.assessmentId}`);
      }
      const selectedMggSnapshot = await this.loadOasisCheckMggSnapshot(assessment);
      const baselineMggSnapshot = baselineAssessment
        ? await this.loadOasisCheckMggSnapshot(baselineAssessment)
        : null;
      const checkedAt = new Date().toISOString();
      const result = await buildOasisInternalMismatchReview({
        assessmentId: assessment.assessmentId,
        assessmentType: assessment.assessmentType,
        title: assessment.title,
        date: assessment.date,
        sectionOutputs: selectedSectionOutputs,
        mggSnapshot: selectedMggSnapshot,
        baselineAssessment: baselineAssessment
          ? {
              assessmentId: baselineAssessment.assessmentId,
              assessmentType: baselineAssessment.assessmentType,
              title: baselineAssessment.title,
              date: baselineAssessment.date,
              selectionReason: baselineAssessment.selectionReason,
              mggSnapshot: baselineMggSnapshot,
              unavailableReason: baselineMggSnapshot
                ? null
                : "Baseline OASIS was found, but its M/GG field snapshot was unavailable.",
            }
          : null,
        sourceArtifactPaths: [
          assessment.sectionOutputsPath,
          assessment.mggSnapshotPath,
          baselineAssessment?.mggSnapshotPath,
        ].filter((entry): entry is string => Boolean(entry)),
        env,
        checkedAt,
      });

      const resultPath = path.join(assessment.artifactDirectory, "oasis-check-result.json");
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeJsonFile(resultPath, result);
      const completedAt = new Date().toISOString();
      const completedAssessmentState = createOasisCheckAssessmentState({
        batchId: input.batchId,
        patientId: input.patientId,
        assessmentId: input.assessmentId,
        status: result.status === "failed" ? "failed" : "completed",
        now: completedAt,
        existing: runningAssessmentState,
        lastError: result.status === "failed" ? result.summary : null,
        resultPath,
        result,
        message: result.summary,
      });
      await this.writeOasisCheckState(patientArtifactsDirectory, createOasisCheckState({
        batchId: input.batchId,
        patientId: input.patientId,
        now: completedAt,
        existing: runningState,
        assessmentState: completedAssessmentState,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      const failedAssessmentState = createOasisCheckAssessmentState({
        batchId: input.batchId,
        patientId: input.patientId,
        assessmentId: input.assessmentId,
        status: "failed",
        now: failedAt,
        existing: runningAssessmentState,
        lastError: message,
        message,
      });
      await this.writeOasisCheckState(patientArtifactsDirectory, createOasisCheckState({
        batchId: input.batchId,
        patientId: input.patientId,
        now: failedAt,
        existing: runningState,
        assessmentState: failedAssessmentState,
      }));
      throw error;
    }
  }

  private async loadReferralSourceDocumentManifestEntries(
    batch: BatchRecord,
    patientId: string,
  ): Promise<ReferralSourceDocumentManifestEntry[]> {
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const manifest = await this.repository.readJsonIfExists<ReferralSourceDocumentsManifest>(
      getReferralSourceDocumentsManifestPath(patientArtifactsDirectory),
    );
    if (manifest?.documents?.length) {
      return manifest.documents
        .filter((document) => Boolean(document.sourcePath || document.extractedTextPath))
        .map((document, index) => ({
          documentId: document.documentId || `${patientId}-referral-${index + 1}`,
          title: normalizeDocumentTitle(document),
          sourceLabel: document.sourceLabel ?? null,
          sourcePath: document.sourcePath ?? null,
          extractedTextPath: document.extractedTextPath ?? null,
          portalLabel: document.portalLabel ?? null,
          acquisitionMethod: document.acquisitionMethod ?? null,
          sourceContentHash: document.sourceContentHash ?? null,
          documentDate: document.documentDate ?? null,
          contentType: document.contentType ?? null,
          captureStatus: document.captureStatus ?? null,
          processStatus: document.processStatus ?? null,
          error: document.error ?? null,
          notes: document.notes ?? [],
        }));
    }

    const sourceMeta = await this.repository.readJsonIfExists<SourceDocumentArtifact>(
      path.join(patientArtifactsDirectory, "referral-document-processing", "source-meta.json"),
    );
    return (sourceMeta?.sourceDocuments ?? [])
      .filter((document) => Boolean(document.localFilePath))
      .map((document, index) => ({
        documentId: document.documentId || `${patientId}-referral-${index + 1}`,
        title: document.sourceLabel ?? document.portalLabel ?? path.basename(document.localFilePath ?? ""),
        sourceLabel: document.sourceLabel ?? null,
        sourcePath: document.localFilePath ?? null,
        extractedTextPath: null,
        portalLabel: document.portalLabel ?? null,
        acquisitionMethod: document.acquisitionMethod ?? null,
        sourceContentHash: document.sourceContentSha256 ?? null,
        notes: [],
      }));
  }

  private async writeReferralSourceDocumentsManifest(
    batch: BatchRecord,
    patientId: string,
    documents: ReferralSourceDocumentManifestEntry[],
    source = "static_referral_intake",
  ): Promise<void> {
    const generatedAt = new Date().toISOString();
    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    await writeJsonFile(getReferralSourceDocumentsManifestPath(patientArtifactsDirectory), {
      schemaVersion: "referral-source-documents-manifest.v1",
      batchId: batch.id,
      patientId,
      generatedAt,
      source,
      documents,
    } satisfies ReferralSourceDocumentsManifest);
  }

  private async copyReferralDocumentArtifactsToLegacyRoot(input: {
    sourceDirectory: string;
    patientArtifactsDirectory: string;
  }): Promise<void> {
    const targetDirectory = path.join(input.patientArtifactsDirectory, "referral-document-processing");
    await mkdir(targetDirectory, { recursive: true });
    const artifactNames = [
      "source-meta.json",
      "extraction-result.json",
      "extracted-text.txt",
      "normalized-sections.json",
      "extracted-facts.json",
      "field-map-snapshot.json",
      "llm-proposal.json",
      "field-comparison.json",
      "patient-qa-reference.json",
      "qa-document-summary.json",
      "review-only-oasis-suggestions-metadata.json",
      "direct-document-result.json",
      "direct-document-failure-diagnostic.json",
      "referral-reuse-metadata.json",
    ];
    await Promise.all(artifactNames.map(async (artifactName) => {
      const sourcePath = path.join(input.sourceDirectory, artifactName);
      if (!(await fileExistsAtPath(sourcePath))) {
        return;
      }
      await copyFile(sourcePath, path.join(targetDirectory, artifactName));
    }));
  }

  private async copyLegacyReferralDocumentArtifactsToDocumentDirectory(input: {
    artifactDirectory: string;
    patientArtifactsDirectory: string;
  }): Promise<boolean> {
    const legacyDirectory = path.join(input.patientArtifactsDirectory, "referral-document-processing");
    if (await fileExistsAtPath(path.join(input.artifactDirectory, "source-meta.json"))) {
      return false;
    }
    if (!(await fileExistsAtPath(path.join(legacyDirectory, "source-meta.json")))) {
      return false;
    }
    await mkdir(input.artifactDirectory, { recursive: true });
    const artifactNames = [
      "source-meta.json",
      "extraction-result.json",
      "extracted-text.txt",
      "normalized-sections.json",
      "extracted-facts.json",
      "field-map-snapshot.json",
      "llm-proposal.json",
      "field-comparison.json",
      "patient-qa-reference.json",
      "qa-document-summary.json",
      "review-only-oasis-suggestions-metadata.json",
      "direct-document-result.json",
      "direct-document-failure-diagnostic.json",
      "referral-reuse-metadata.json",
    ];
    let copied = false;
    await Promise.all(artifactNames.map(async (artifactName) => {
      const sourcePath = path.join(legacyDirectory, artifactName);
      if (!(await fileExistsAtPath(sourcePath))) {
        return;
      }
      await copyFile(sourcePath, path.join(input.artifactDirectory, artifactName));
      copied = true;
    }));
    return copied;
  }

  private resolveReferralDirectDocumentModelId(env: ReturnType<typeof loadEnv>): string {
    return env.BEDROCK_MODEL_ID ?? env.BEDROCK_INFERENCE_PROFILE_ID ?? "default";
  }

  private getReferralDirectDocumentCacheMetadataPath(artifactDirectory: string): string {
    return path.join(artifactDirectory, "referral-direct-document-cache-metadata.json");
  }

  private async loadReusableReferralDirectDocumentResult(input: {
    artifactDirectory: string;
    patientId: string;
    documentId: string;
    sourceContentHash: string | null | undefined;
    modelId: string;
  }): Promise<ReferralDirectDocumentExtractionResult | null> {
    if (!input.sourceContentHash) {
      return null;
    }
    const metadata = await this.repository.readJsonIfExists<ReferralDirectDocumentCacheMetadata>(
      this.getReferralDirectDocumentCacheMetadataPath(input.artifactDirectory),
    );
    if (
      metadata?.patientId !== input.patientId ||
      metadata.documentId !== input.documentId ||
      metadata.sourceContentHash !== input.sourceContentHash ||
      metadata.promptVersion !== REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION ||
      metadata.modelId !== input.modelId ||
      metadata.extractionMode !== "direct_document_llm_only"
    ) {
      return null;
    }
    if (!(await fileExistsAtPath(metadata.directDocumentResultPath))) {
      return null;
    }
    const result = await this.repository.readJsonIfExists<ReferralDirectDocumentExtractionResult>(
      metadata.directDocumentResultPath,
    );
    const acceptedFactCount =
      (result?.accepted?.diagnoses?.length ?? 0) +
      (result?.accepted?.medications?.length ?? 0) +
      (result?.accepted?.fieldProposals?.length ?? 0);
    return acceptedFactCount > 0 ? result : null;
  }

  private async writeReferralDirectDocumentCacheMetadata(input: {
    artifactDirectory: string;
    patientId: string;
    documentId: string;
    sourceContentHash: string | null | undefined;
    modelId: string;
    directDocumentResultPath?: string | null;
  }): Promise<void> {
    if (!input.sourceContentHash) {
      return;
    }
    const directDocumentResultPath = input.directDocumentResultPath ?? path.join(input.artifactDirectory, "direct-document-result.json");
    if (!(await fileExistsAtPath(directDocumentResultPath))) {
      return;
    }
    await writeJsonFile(this.getReferralDirectDocumentCacheMetadataPath(input.artifactDirectory), {
      schemaVersion: "referral-direct-document-cache-metadata.v1",
      patientId: input.patientId,
      documentId: input.documentId,
      sourceContentHash: input.sourceContentHash,
      promptVersion: REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION,
      modelId: input.modelId,
      extractionMode: "direct_document_llm_only",
      directDocumentResultPath,
      generatedAt: new Date().toISOString(),
    } satisfies ReferralDirectDocumentCacheMetadata);
  }

  private async runPatientReferralIntakeJob(batchId: string, patientId: string): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((item) => item.id === patientId);
    if (!workItem) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const patientArtifactsDirectory = getPatientArtifactsDirectory(batch, patientId);
    const now = new Date().toISOString();
    const previousState = await this.repository.readJsonIfExists<ReferralIntakeState>(
      getReferralIntakeStatePath(patientArtifactsDirectory),
    );
    let runningState: ReferralIntakeState | null = null;

    try {
      const preflight = await this.ensurePatientPortalStatusSnapshot(batchId, patientId);
      const waitedForChartWork = await this.waitForPatientChartWorkSlot({
        batchId,
        patientId,
        patientArtifactsDirectory,
        existingState: previousState,
      });
      if (preflight.status === "pending_due_to_active_patient_run" || waitedForChartWork) {
        await this.ensurePatientPortalStatusSnapshot(batchId, patientId, { forceRefresh: true });
      }
      runningState = createReferralIntakeState({
        batchId,
        patientId,
        status: "running",
        now,
        existing: previousState,
        message: "Checking and processing static referral files for this patient.",
      });
      await this.writeReferralIntakeState(patientArtifactsDirectory, runningState);
      const env = loadEnv();
      const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(batch.subsidiary.id);
      const captureResult = await capturePatientReferralFiles({
        batchId,
        workItem,
        outputDir: batch.storage.outputRoot,
        patientArtifactsDirectory,
        env,
        logger: this.logger,
        subsidiaryRuntimeConfig,
      });
      const chartSnapshot = await this.loadReferralChartSnapshotFromExistingArtifacts(patientArtifactsDirectory);
      const previousManifestDocuments = await this.loadReferralSourceDocumentManifestEntries(batch, patientId);
      const previousResultsManifest = await this.repository.readJsonIfExists<ReferralDocumentResultsManifest>(
        getReferralDocumentResultsManifestPath(patientArtifactsDirectory),
      );
      const previousDocumentByHash = new Map(
        previousManifestDocuments
          .filter((document) => Boolean(document.sourceContentHash))
          .map((document) => [document.sourceContentHash!, document]),
      );
      const previousDocumentByTitle = new Map(
        previousManifestDocuments
          .map((document) => [normalizeReferralDocumentIdentityKey(normalizeDocumentTitle(document)), document] as const)
          .filter((entry): entry is [string, ReferralSourceDocumentManifestEntry] => Boolean(entry[0])),
      );
      const manifestDocuments = await Promise.all(
        captureResult.documents.map(async (document, index) => {
          const sourcePath = document.sourcePath ?? document.extractedTextPath;
          const sourceContentHash = document.sourceContentHash ?? await sha256FileIfExists(sourcePath);
          const title = normalizeDocumentTitle(document);
          const previousDocument =
            (sourceContentHash ? previousDocumentByHash.get(sourceContentHash) : undefined) ??
            previousDocumentByTitle.get(normalizeReferralDocumentIdentityKey(title) ?? "");
          const documentId = previousDocument?.documentId ?? document.documentId ?? `${patientId}-referral-${index + 1}`;
          return {
            documentId,
            title,
            documentDate: document.documentDate ?? null,
            sourceLabel: document.sourceLabel ?? null,
            sourcePath: document.sourcePath ?? null,
            extractedTextPath: document.extractedTextPath ?? null,
            portalLabel: document.portalLabel ?? null,
            acquisitionMethod: document.acquisitionMethod ?? null,
            contentType: document.contentType ?? null,
            captureStatus: document.captureStatus ?? null,
            processStatus: null,
            error: document.error ?? null,
            notes: document.notes ?? [],
            sourceContentHash,
          };
        }),
      );

      if (manifestDocuments.length === 0 && previousManifestDocuments.length > 0) {
        const generatedAt = new Date().toISOString();
        await this.writeReferralSourceDocumentsManifest(
          batch,
          patientId,
          previousManifestDocuments,
          "portal_referral_files_preserved_existing",
        );

        const previousResults = previousResultsManifest?.documents ?? [];
        const previousProcessedCount = previousResults.length > 0
          ? previousResults.filter((document) => document.status === "processed" || document.status === "reused").length
          : 0;
        const previousReusedCount = previousResults.length > 0
          ? previousResults.filter((document) => document.status === "reused").length
          : 0;
        const previousFailedCount = previousResults.length > 0
          ? previousResults.filter((document) => document.status === "failed").length
          : 0;
        const previousSkippedCount = previousResults.length > 0
          ? previousResults.filter((document) => document.status === "skipped").length
          : 0;

        const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === patientId);
        const dashboardRun = toArtifactReprocessPatientRun(batch, workItem, previous);
        dashboardRun.executionStep = "STATIC_REFERRAL_INTAKE_COMPLETED";
        dashboardRun.notes = [
          `Static referral intake checked the portal at ${generatedAt}; no current referral rows were found, so previously processed referral documents were preserved.`,
        ];
        await writePatientDashboardState({
          outputDirectory: batch.storage.outputRoot,
          run: dashboardRun,
          env,
        });

        await this.writeReferralIntakeState(patientArtifactsDirectory, {
          ...createReferralIntakeState({
            batchId,
            patientId,
            status: "completed",
            now: generatedAt,
            existing: runningState,
            lastError: null,
            message: "No new referral files were found; preserved previously processed referral documents.",
          }),
          processedCount: previousProcessedCount,
          reusedCount: previousReusedCount,
          newOrChangedCount: 0,
          failedCount: previousFailedCount,
          skippedCount: previousSkippedCount,
          documentCount: previousResults.length > 0 ? previousResults.length : previousManifestDocuments.length,
          sourceDocumentCount: previousManifestDocuments.length,
        });
        return;
      }

      await this.writeReferralSourceDocumentsManifest(batch, patientId, manifestDocuments, "portal_referral_files");

      const results: ReferralDocumentResultsManifestEntry[] = [];
      let defaultReferralDocumentId: string | null = null;
      let defaultArtifactDirectory: string | null = null;
      const directDocumentModelId = this.resolveReferralDirectDocumentModelId(env);

      for (const [index, document] of manifestDocuments.entries()) {
        const title = normalizeDocumentTitle(document);
        const sourcePath = document.sourcePath ?? document.extractedTextPath;
        const sourceIsDirectDocumentCompatible = Boolean(
          document.sourcePath && /\.(?:pdf|png|jpe?g)$/i.test(document.sourcePath),
        );
        if (!sourcePath || !sourceIsDirectDocumentCompatible) {
          results.push({
            documentId: document.documentId,
            title,
            sourceLabel: document.sourceLabel,
            sourcePath,
            sourceContentHash: document.sourceContentHash ?? null,
            status: "skipped",
            processedAt: new Date().toISOString(),
            artifactDirectory: null,
            selectedDocumentId: null,
            extractionUsabilityStatus: null,
            error: sourcePath
              ? "Referral source was captured as text-only or unsupported media; direct-document LLM requires PDF, PNG, JPG, or JPEG."
              : "Referral source document did not include a local source path.",
          });
          continue;
        }

        const documentKey = safeDocumentKey({
          patientId,
          documentId: document.documentId,
          title,
          index,
        });
        const artifactDirectory = path.join(
          patientArtifactsDirectory,
          "referral-document-processing",
          "documents",
          documentKey,
        );
        const previousDocument = previousManifestDocuments.find((candidate) => candidate.documentId === document.documentId);
        const previousDocumentTitleKey = previousDocument
          ? normalizeReferralDocumentIdentityKey(normalizeDocumentTitle(previousDocument))
          : null;
        const shouldSeedFromLegacyRoot = Boolean(previousDocument) && (
          Boolean(document.sourceContentHash && previousDocument?.sourceContentHash === document.sourceContentHash) ||
          previousDocumentTitleKey === normalizeReferralDocumentIdentityKey(title)
        );
        if (shouldSeedFromLegacyRoot) {
          const copiedLegacyArtifacts = await this.copyLegacyReferralDocumentArtifactsToDocumentDirectory({
            artifactDirectory,
            patientArtifactsDirectory,
          });
          if (copiedLegacyArtifacts) {
            await this.writeReferralDirectDocumentCacheMetadata({
              artifactDirectory,
              patientId,
              documentId: document.documentId,
              sourceContentHash: document.sourceContentHash,
              modelId: directDocumentModelId,
            });
          }
        }

        try {
          const cachedDirectDocumentResult = await this.loadReusableReferralDirectDocumentResult({
            artifactDirectory,
            patientId,
            documentId: document.documentId,
            sourceContentHash: document.sourceContentHash,
            modelId: directDocumentModelId,
          });
          const result = await runReferralDocumentProcessingPipeline({
            workItem,
            outputDir: batch.storage.outputRoot,
            env,
            logger: this.logger,
            sourceDocuments: [{
              sourceLabel: document.sourceLabel ?? title,
              sourcePath,
              extractedTextPath: document.extractedTextPath,
              portalLabel: document.portalLabel,
              acquisitionMethod: document.acquisitionMethod as ReferralSourceDocumentInput["acquisitionMethod"],
            }],
            currentChartValues: chartSnapshot.currentChartValues,
            currentChartValueSource: chartSnapshot.currentChartValueSource,
            artifactDirectory,
            includeManualSourceCandidates: false,
            directDocumentExtractor: cachedDirectDocumentResult
              ? async () => cachedDirectDocumentResult
              : undefined,
          });
          await this.writeReferralDirectDocumentCacheMetadata({
            artifactDirectory,
            patientId,
            documentId: document.documentId,
            sourceContentHash: document.sourceContentHash,
            modelId: directDocumentModelId,
            directDocumentResultPath: result.result?.artifacts.directDocumentResultPath ?? null,
          });
          const reused = result.stepLogs.some((stepLog) => stepLog.step === "referral_processing_reused");
          const reusedDirectDocument = Boolean(cachedDirectDocumentResult);
          const selectedDocumentId = result.result?.sourceMeta.selectedDocumentId ?? null;
          const extractionSuccess = result.result?.extractionResult.extractionSuccess === true;
          const extractionFailureReason = result.result?.extractionResult.failureReasons[0] ??
            result.result?.qaDocumentSummary.warnings[0] ??
            null;
          const status = (reused || reusedDirectDocument) && extractionSuccess
            ? "reused"
            : extractionSuccess
              ? "processed"
              : "failed";
          results.push({
            documentId: document.documentId,
            title,
            sourceLabel: document.sourceLabel,
            sourcePath,
            sourceContentHash: document.sourceContentHash ?? null,
            status,
            processedAt: new Date().toISOString(),
            artifactDirectory,
            selectedDocumentId,
            extractionUsabilityStatus: result.result?.qaDocumentSummary.extractionUsabilityStatus ?? null,
            error: status === "failed"
              ? extractionFailureReason ?? "Direct-document referral extraction did not produce usable source-backed facts."
              : selectedDocumentId
                ? null
                : "No direct-document-compatible referral source was selected.",
          });
          if (!defaultReferralDocumentId && selectedDocumentId && status !== "failed") {
            defaultReferralDocumentId = document.documentId;
            defaultArtifactDirectory = artifactDirectory;
          }
        } catch (error) {
          results.push({
            documentId: document.documentId,
            title,
            sourceLabel: document.sourceLabel,
            sourcePath,
            sourceContentHash: document.sourceContentHash ?? null,
            status: "failed",
            processedAt: new Date().toISOString(),
            artifactDirectory,
            selectedDocumentId: null,
            extractionUsabilityStatus: null,
            error: error instanceof Error ? error.message : "Unknown referral document processing error.",
          });
        }
      }

      const generatedAt = new Date().toISOString();
      const resultByDocumentId = new Map(results.map((document) => [document.documentId, document]));
      await this.writeReferralSourceDocumentsManifest(
        batch,
        patientId,
        manifestDocuments.map((document) => {
          const result = resultByDocumentId.get(document.documentId);
          return {
            ...document,
            processStatus: result?.status ?? "skipped",
            error: result?.error ?? document.error ?? null,
          };
        }),
        "portal_referral_files",
      );
      await writeJsonFile(getReferralDocumentResultsManifestPath(patientArtifactsDirectory), {
        schemaVersion: "referral-document-results-manifest.v1",
        batchId,
        patientId,
        generatedAt,
        defaultReferralDocumentId,
        documents: results,
      } satisfies ReferralDocumentResultsManifest);

      if (defaultArtifactDirectory) {
        await this.copyReferralDocumentArtifactsToLegacyRoot({
          sourceDirectory: defaultArtifactDirectory,
          patientArtifactsDirectory,
        });
      }

      const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === patientId);
      const dashboardRun = toArtifactReprocessPatientRun(batch, workItem, previous);
      dashboardRun.executionStep = "STATIC_REFERRAL_INTAKE_COMPLETED";
      dashboardRun.notes = [
        `Static referral intake completed independently at ${generatedAt}; OASIS, Plan of Care, and Visit Notes automation was not rerun.`,
      ];
      await writePatientDashboardState({
        outputDirectory: batch.storage.outputRoot,
        run: dashboardRun,
        env,
      });

      const processedCount = results.filter((document) => document.status === "processed" || document.status === "reused").length;
      const reusedCount = results.filter((document) => document.status === "reused").length;
      const failedCount = results.filter((document) => document.status === "failed").length;
      const skippedCount = results.filter((document) => document.status === "skipped").length;
      await this.writeReferralIntakeState(patientArtifactsDirectory, {
        ...createReferralIntakeState({
          batchId,
          patientId,
          status: failedCount > 0 && processedCount === 0 ? "failed" : "completed",
          now: generatedAt,
          existing: runningState,
          lastError: failedCount > 0 && processedCount === 0
            ? "Static referral intake failed for all referral documents."
            : null,
          message: failedCount > 0 && processedCount === 0
            ? "Static referral intake captured referral files, but direct-document processing failed for all documents."
            : manifestDocuments.length === 0
              ? "No referral source documents were found for this patient."
              : "Static referral intake completed for this patient.",
        }),
        processedCount,
        reusedCount,
        newOrChangedCount: results.filter((document) => document.status === "processed").length,
        failedCount,
        skippedCount,
        documentCount: manifestDocuments.length,
        sourceDocumentCount: manifestDocuments.length,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      await this.writeReferralIntakeState(patientArtifactsDirectory, {
        ...createReferralIntakeState({
          batchId,
          patientId,
          status: "failed",
          now: failedAt,
          existing: runningState,
          lastError: error instanceof Error ? error.message : "Unknown referral intake error.",
          message: "Static referral intake failed for this patient.",
        }),
      });
      throw error;
    }
  }

  private async loadReferralChartSnapshotFromExistingArtifacts(
    patientArtifactsDirectory: string,
  ): Promise<{
    currentChartValues: Record<string, unknown>;
    currentChartValueSource?: ChartSnapshotValueSource;
  }> {
    const fieldMapSnapshot = await this.repository.readJsonIfExists(
      path.join(patientArtifactsDirectory, "referral-document-processing", "field-map-snapshot.json"),
    );
    return extractReferralChartSnapshotValues(fieldMapSnapshot);
  }

  private async reprocessClinicalArtifactsFromExistingCaptures(
    batchId: string,
    workItems: PatientEpisodeWorkItem[],
    options: RunControlOptions,
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const env = loadEnv();
    const now = new Date().toISOString();
    const reprocessReferral = shouldReprocessReferral(options);
    const reprocessVisitNotes = shouldReprocessVisitNotes(options);
    const patientQueue = await this.repository.readJsonIfExists<PatientQueueArtifact>(
      path.join(batch.storage.outputRoot, "patient-queue.json"),
    );
    const queueStatusByWorkItemId = new Map(
      (patientQueue?.entries ?? []).map((entry) => [entry.workItemId, entry.status]),
    );
    let reprocessedReferralCount = 0;
    let reprocessedVisitNotesCount = 0;
    let skippedMissingArtifactCount = 0;
    let skippedStatusOnlyCount = 0;
    const updatedPatientRuns: BatchRecord["patientRuns"] = [];

    try {
      for (const workItem of workItems) {
        const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
        const queueStatus = queueStatusByWorkItemId.get(workItem.id);
        if (isStatusOnlyQueueStatus(queueStatus) || isStatusOnlyExcludedPatientRun(previous)) {
          updatedPatientRuns.push(previous ?? createPendingPatientRunState(batch, workItem));
          skippedStatusOnlyCount += 1;
          continue;
        }
        const patientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", workItem.id);
        const visitNotesDiscoveryPath = path.join(patientArtifactsDirectory, "visit-notes-discovery.json");
        let patientHadArtifactWork = false;

        const reprocessRun = toArtifactReprocessPatientRun(batch, workItem, previous);
        reprocessRun.executionStep = reprocessReferral && reprocessVisitNotes
          ? "REFERRAL_AND_VISIT_NOTES_REPROCESSED_FROM_ARTIFACTS"
          : reprocessReferral
            ? "REFERRAL_REPROCESSED_FROM_ARTIFACTS"
            : "VISIT_NOTES_REPROCESSED_FROM_ARTIFACTS";
        reprocessRun.notes = [
          `Clinical artifacts reprocessed from existing captured artifacts at ${now}; portal acquisition was not run.`,
        ];

        if (reprocessReferral) {
          const referralSourceDocuments = await this.loadReferralSourceDocumentsFromExistingArtifacts(
            patientArtifactsDirectory,
          );
          const chartSnapshot = await this.loadReferralChartSnapshotFromExistingArtifacts(patientArtifactsDirectory);
          const referralResult = await runReferralDocumentProcessingPipeline({
            workItem,
            outputDir: batch.storage.outputRoot,
            env,
            logger: this.logger,
            sourceDocuments: referralSourceDocuments,
            currentChartValues: chartSnapshot.currentChartValues,
            currentChartValueSource: chartSnapshot.currentChartValueSource,
          });
          reprocessRun.automationStepLogs.push(...referralResult.stepLogs);
          patientHadArtifactWork = true;
          reprocessedReferralCount += 1;

          const usabilityStatus = referralResult.result?.qaDocumentSummary.extractionUsabilityStatus ?? null;
          if (usabilityStatus && usabilityStatus !== "usable") {
            reprocessRun.processingStatus = "NEEDS_HUMAN_REVIEW";
            reprocessRun.executionStep = "REFERRAL_DIRECT_DOCUMENT_REVIEW";
            reprocessRun.qaOutcome = "INCOMPLETE";
            reprocessRun.errorSummary =
              `Referral direct-document extraction is ${usabilityStatus}; review source-backed evidence before relying on referral facts.`;
          } else {
            clearResolvedReferralReviewStatus(reprocessRun);
          }
        }

        if (reprocessVisitNotes) {
          if (!(await this.repository.fileExists(visitNotesDiscoveryPath))) {
            skippedMissingArtifactCount += 1;
            if (!patientHadArtifactWork) {
              updatedPatientRuns.push(previous ?? createPendingPatientRunState(batch, workItem));
              continue;
            }
          } else {
            patientHadArtifactWork = true;
            reprocessedVisitNotesCount += 1;
          }
        }

        await writePatientDashboardState({
          outputDirectory: batch.storage.outputRoot,
          run: reprocessRun,
          env,
        });
        const resultBundlePath =
          reprocessRun.resultBundlePath ?? path.join(batch.storage.patientResultsDirectory, `${workItem.id}.json`);
        reprocessRun.resultBundlePath = resultBundlePath;
        await writeJsonFile(resultBundlePath, reprocessRun);
        await this.promotePatientRunToMemory(batch, reprocessRun).catch((error: unknown) => {
          this.logger.warn(
            {
              batchId: batch.id,
              workItemId: workItem.id,
              errorMessage: error instanceof Error ? error.message : "Unknown patient memory promotion error.",
            },
            "patient memory promotion skipped after Visit Notes artifact reprocess",
          );
        });
        updatedPatientRuns.push(toPersistedPatientRun(batch, reprocessRun, previous));
      }

      batch.patientRuns = updatedPatientRuns;
      batch.status = "COMPLETED";
      batch.updatedAt = now;
      batch.run.requestedAt = now;
      batch.run.completedAt = now;
      batch.run.patientRunCount = countProcessedPatientRuns(batch);
      batch.run.lastError = deriveBatchErrorSummary(batch);
      this.markDeltaRunCompleted(batch, now);
      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          reprocessedReferralCount,
          reprocessedVisitNotesCount,
          skippedMissingArtifactCount,
          skippedStatusOnlyCount,
        },
        "clinical artifacts reprocessed from existing captures without portal acquisition",
      );
    } catch (error) {
      await this.failBatch(batch.id, error, "run");
      throw error;
    }
  }

  private async promotePatientRunToMemory(batch: BatchRecord, patientRun: PatientRun): Promise<void> {
    if (this.options.patientMemoryWriteEnabled === false) {
      return;
    }

    if (!patientRun.completedAt || !patientRun.bundleAvailable) {
      return;
    }

    const workItems = await this.repository.readWorkItems(batch);
    const workItem = workItems.find((candidate) => candidate.id === patientRun.workItemId);
    if (!workItem) {
      return;
    }

    const patientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", patientRun.workItemId);
    if (!(await this.repository.fileExists(patientArtifactsDirectory))) {
      return;
    }

    const resolution = await this.patientMemoryService.resolvePatientMemory({
      agencySlug: batch.subsidiary.slug,
      workItem,
      matchResult: patientRun.matchResult,
    });
    await this.patientMemoryService.promoteCurrentArtifacts({
      agencySlug: batch.subsidiary.slug,
      patientMemoryId: resolution.patientMemoryId,
      sourcePatientArtifactsDirectory: patientArtifactsDirectory,
      workItem,
      matchResult: patientRun.matchResult,
      batchId: batch.id,
      runId: patientRun.runId,
    });
  }

  private async promoteBatchPatientsToMemory(batch: BatchRecord): Promise<string[]> {
    if (this.options.patientMemoryWriteEnabled === false) {
      return ["patient-memory-write-disabled"];
    }

    const failures: string[] = [];
    const workItems = await this.repository.readWorkItems(batch).catch(() => []);
    for (const patientRun of batch.patientRuns) {
      try {
        const workItem = workItems.find((candidate) => candidate.id === patientRun.workItemId);
        if (!workItem) {
          continue;
        }
        const patientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", patientRun.workItemId);
        if (!(await this.repository.fileExists(patientArtifactsDirectory))) {
          continue;
        }
        const resolution = await this.patientMemoryService.resolvePatientMemory({
          agencySlug: batch.subsidiary.slug,
          workItem,
          matchResult: patientRun.matchResult,
        });
        await this.patientMemoryService.promoteCurrentArtifacts({
          agencySlug: batch.subsidiary.slug,
          patientMemoryId: resolution.patientMemoryId,
          sourcePatientArtifactsDirectory: patientArtifactsDirectory,
          workItem,
          matchResult: patientRun.matchResult,
          batchId: batch.id,
          runId: patientRun.runId,
        });
      } catch (error) {
        failures.push(patientRun.workItemId);
        this.logger.warn(
          {
            batchId: batch.id,
            workItemId: patientRun.workItemId,
            errorMessage: error instanceof Error ? error.message : "Unknown patient memory promotion error.",
          },
          "failed to promote patient artifacts before batch cleanup",
        );
      }
    }

    return failures;
  }

  private async executeRetryWorkItems(
    batchId: string,
    workItems: PatientEpisodeWorkItem[],
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const manifest = await this.repository.readManifest(batch);
    const parserExceptions = await this.repository.readParserExceptions(batch);
    const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(
      batch.subsidiary.id,
    );

    try {
      await executePatientWorkItems({
        batchId: batch.id,
        workItems,
        outputDir: batch.storage.outputRoot,
        subsidiaryRuntimeConfig,
        logger: this.logger,
        onPatientRunUpdate: async (patientRun) => {
          await this.persistPatientRunUpdate(batch.id, patientRun);
        },
      });

      await this.finalizeBatchExecution(batch.id, manifest, parserExceptions);
      this.logger.info(
        { batchId, retriedPatients: workItems.length },
        "patient retries completed",
      );
    } catch (error) {
      await this.failBatch(batch.id, error, "retry");
      throw error;
    }
  }

  private async prepareRetryBatch(
    batch: BatchRecord,
    workItems: PatientEpisodeWorkItem[],
  ): Promise<BatchRecord> {
    batch.status = "RUNNING";
    batch.updatedAt = new Date().toISOString();
    batch.run.requestedAt = batch.updatedAt;
    batch.run.completedAt = null;
    batch.run.lastError = null;

    batch.patientRuns = batch.patientRuns.map((patientRun) => {
      const matchingWorkItem = workItems.find((workItem) => workItem.id === patientRun.workItemId);
      if (!matchingWorkItem) {
        return patientRun;
      }

      return createPendingPatientRunState(batch, matchingWorkItem, patientRun);
    });

    await this.repository.saveBatch(batch);
    return batch;
  }

  private async persistPatientRunUpdate(batchId: string, patientRun: PatientRun): Promise<void> {
    const batch = await this.withBatchUpdateLock(batchId, async () => {
      const currentBatch = await this.mustGetBatch(batchId);
      const previous = currentBatch.patientRuns.find((candidate) => candidate.runId === patientRun.runId);
      const nextRun = toPersistedPatientRun(currentBatch, patientRun, previous);

      currentBatch.patientRuns = [
        ...currentBatch.patientRuns.filter((candidate) => candidate.runId !== nextRun.runId),
        nextRun,
      ].sort((left, right) => left.patientName.localeCompare(right.patientName));
      currentBatch.updatedAt = nextRun.lastUpdatedAt;
      currentBatch.run.patientRunCount = countProcessedPatientRuns(currentBatch);
      currentBatch.run.lastError = deriveBatchErrorSummary(currentBatch);
      await this.repository.saveBatch(currentBatch);
      return currentBatch;
    });

    await this.promotePatientRunToMemory(batch, patientRun).catch((error: unknown) => {
      this.logger.warn(
        {
          batchId,
          workItemId: patientRun.workItemId,
          errorMessage: error instanceof Error ? error.message : "Unknown patient memory promotion error.",
        },
        "patient memory promotion skipped",
      );
    });
  }

  private async withBatchUpdateLock<T>(
    batchId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.batchUpdateLocks.get(batchId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);
    this.batchUpdateLocks.set(batchId, next);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      releaseCurrent();
      if (this.batchUpdateLocks.get(batchId) === next) {
        this.batchUpdateLocks.delete(batchId);
      }
    }
  }

  private async finalizeBatchExecution(
    batchId: string,
    manifest: BatchManifest,
    parserExceptions: ParserException[],
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const patientRuns = await this.repository.listPatientRuns(batch);
    const completedAt = new Date().toISOString();
    const batchSummary = createBatchSummary({
      manifest,
      parserExceptions,
      patientRuns,
      startedAt: batch.run.requestedAt ?? batch.createdAt,
      completedAt,
    });

    batch.storage.batchSummaryPath = await persistBatchSummary(
      batch.storage.outputRoot,
      batchSummary,
    );
    batch.status = batchSummary.status;
    batch.updatedAt = completedAt;
    batch.run.completedAt = completedAt;
    batch.run.patientRunCount = countProcessedPatientRuns(batch);
    batch.run.lastError = deriveBatchErrorSummary(batch);
    this.markDeltaRunCompleted(batch, completedAt);
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
  }

  private async failBatch(
    batchId: string,
    error: unknown,
    phase: "run" | "retry",
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    batch.status = "FAILED";
    batch.updatedAt = new Date().toISOString();
    batch.run.completedAt = batch.updatedAt;
    batch.run.lastError =
      error instanceof Error ? error.message : `Unknown ${phase} error.`;
    this.markDeltaRunCompleted(batch, batch.updatedAt);
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
  }

  private async reconcileInterruptedBatches(): Promise<void> {
    const batches = await this.repository.listBatches();
    const reconciledAt = new Date().toISOString();

    for (const batch of batches) {
      if (!["PARSING", "RUNNING"].includes(batch.status)) {
        continue;
      }

      batch.status = "FAILED";
      batch.updatedAt = reconciledAt;

      if (batch.status === "FAILED" && batch.run.requestedAt) {
        batch.run.completedAt = reconciledAt;
        batch.run.lastError =
          batch.run.lastError ?? "Backend restarted while batch execution was in progress.";
      }

      if (batch.parse.requestedAt && !batch.parse.completedAt) {
        batch.parse.completedAt = reconciledAt;
        batch.parse.lastError =
          batch.parse.lastError ?? "Backend restarted while parsing was in progress.";
      }

      batch.patientRuns = batch.patientRuns.map((patientRun) =>
        isTransientPatientStatus(patientRun.processingStatus)
          ? {
              ...patientRun,
              processingStatus: "FAILED",
              executionStep: "FAILED",
              progressPercent: 100,
              completedAt: reconciledAt,
              lastUpdatedAt: reconciledAt,
              retryEligible: true,
              errorSummary:
                patientRun.errorSummary ??
                "Backend restarted while this patient run was in progress.",
            }
          : patientRun,
      );

      this.markDeltaRunCompleted(batch, reconciledAt);

      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
    }
  }

  private ensureScheduler(): void {
    if (this.rerunTimer) {
      return;
    }

    this.rerunTimer = setInterval(() => {
      void this.triggerDueScheduledRuns();
    }, SCHEDULE_POLL_INTERVAL_MS);
    this.rerunTimer.unref?.();
  }

  private async triggerDueScheduledRuns(): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    if (this.activeBatchJobs.size > 0) {
      this.logger.info(
        {
          activeBatchIds: [...this.activeBatchJobs.keys()],
        },
        "scheduled batch rerun deferred because another batch is active",
      );
      return;
    }

    const schedules = (await this.scheduledRunRepository.listScheduledRuns()).sort((left, right) => {
      const leftNext = earliestTimestamp(left.nextWorkbookIntakeAt, left.nextDeltaRunAt, left.nextScheduledRunAt);
      const rightNext = earliestTimestamp(right.nextWorkbookIntakeAt, right.nextDeltaRunAt, right.nextScheduledRunAt);
      const leftTime = leftNext ? Date.parse(leftNext) : Number.POSITIVE_INFINITY;
      const rightTime = rightNext ? Date.parse(rightNext) : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.subsidiaryId.localeCompare(right.subsidiaryId);
    });

    for (const schedule of schedules) {
      if (!schedule.active || !schedule.rerunEnabled) {
        continue;
      }

      const batch = await this.repository.getBatch(schedule.batchId);
      if (!batch) {
        schedule.active = false;
        schedule.rerunEnabled = false;
        schedule.nextScheduledRunAt = null;
        schedule.nextWorkbookIntakeAt = null;
        schedule.nextDeltaRunAt = null;
        schedule.updatedAt = new Date().toISOString();
        await this.scheduledRunRepository.saveScheduledRun(schedule);
        continue;
      }

      try {
        this.ensureSchedulePointers(batch, nowIso);
        await this.repository.saveBatch(batch);
        await this.syncScheduledRunForBatch(batch);

        const workbookIntakeDue =
          batch.schedule.nextWorkbookIntakeAt &&
          Date.parse(batch.schedule.nextWorkbookIntakeAt) <= now;
        const deltaRunDue =
          !workbookIntakeDue &&
          batch.schedule.nextDeltaRunAt &&
          Date.parse(batch.schedule.nextDeltaRunAt) <= now;

        if (!workbookIntakeDue && !deltaRunDue) {
          continue;
        }

        const workbookMissing = !(await this.repository.fileExists(batch.sourceWorkbook.storedPath));

        if (workbookMissing && batch.sourceWorkbook.acquisitionProvider !== "FINALE") {
          batch.updatedAt = nowIso;
          batch.schedule.active = false;
          batch.schedule.rerunEnabled = false;
          batch.schedule.nextScheduledRunAt = null;
          batch.schedule.nextWorkbookIntakeAt = null;
          batch.schedule.nextDeltaRunAt = null;
          batch.run.lastError =
            batch.run.lastError ?? "Workbook source file is no longer available for scheduled rerun.";
          await this.repository.saveBatch(batch);
          await this.syncScheduledRunForBatch(batch);
          this.logger.warn(
            { batchId: batch.id, subsidiaryId: batch.subsidiary.id },
            "scheduled rerun disabled because workbook file is missing",
          );
          continue;
        }

        if (batch.sourceWorkbook.acquisitionProvider === "FINALE" && (workbookIntakeDue || workbookMissing)) {
          this.logger.info(
            {
              batchId: batch.id,
              subsidiaryId: batch.subsidiary.id,
              scheduledRunId: schedule.id,
              scheduledFor: batch.schedule.nextWorkbookIntakeAt,
              workbookMissing,
            },
            "weekly Finale workbook intake started",
          );
          await this.startAgencyRefresh(batch.subsidiary.id);
          return;
        }

        this.logger.info(
          {
            batchId: batch.id,
            subsidiaryId: batch.subsidiary.id,
            scheduledRunId: schedule.id,
            scheduledFor: batch.schedule.nextDeltaRunAt,
            workbookMissing,
          },
          "weekday delta-all batch run started",
        );
        await this.startBatchRun(batch.id);
        if (this.activeBatchJobs.size > 0) {
          this.logger.info(
            {
              batchId: batch.id,
              subsidiaryId: batch.subsidiary.id,
              deferredDueScheduleCount: schedules.filter(
                (candidate) =>
                  candidate.id !== schedule.id &&
                  candidate.active &&
                  candidate.rerunEnabled &&
                  candidate.nextScheduledRunAt &&
                  Date.parse(candidate.nextScheduledRunAt) <= now,
              ).length,
            },
            "scheduled batch single-flight gate engaged",
          );
          return;
        }
      } catch (error) {
        await this.markScheduledRefreshFailure(batch, error, nowIso);
        this.logger.error(
          {
            batchId: batch.id,
            subsidiaryId: batch.subsidiary.id,
            scheduledRunId: schedule.id,
            errorMessage: error instanceof Error ? error.message : "Unknown scheduled refresh error.",
          },
          "scheduled batch refresh failed",
        );
      }
    }
  }

  private async markScheduledRefreshFailure(
    batch: BatchRecord,
    error: unknown,
    updatedAt: string,
  ): Promise<void> {
    batch.status = "FAILED";
    batch.updatedAt = updatedAt;
    batch.sourceWorkbook.acquisitionStatus =
      batch.sourceWorkbook.acquisitionProvider === "FINALE" ? "FAILED" : batch.sourceWorkbook.acquisitionStatus;
    batch.sourceWorkbook.acquisitionMetadata =
      batch.sourceWorkbook.acquisitionProvider === "FINALE" ? null : batch.sourceWorkbook.acquisitionMetadata;
    batch.sourceWorkbook.acquisitionNotes = [
      error instanceof Error ? error.message : "Unknown scheduled refresh error.",
    ];
    batch.sourceWorkbook.verification =
      batch.sourceWorkbook.acquisitionProvider === "FINALE" ? null : batch.sourceWorkbook.verification;
    batch.run.completedAt = updatedAt;
    batch.run.lastError =
      error instanceof Error ? error.message : "Unknown scheduled refresh error.";
    this.markDeltaRunCompleted(batch, updatedAt);
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
  }

  private async deactivateOtherActiveSchedules(
    currentBatchId: string,
    subsidiaryId: string,
    updatedAt: string,
  ): Promise<void> {
    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(subsidiaryId);
    const batches = await this.repository.listBatches();

    for (const batch of batches) {
      if (
        batch.id === currentBatchId ||
        !batchBelongsToSubsidiary(batch, subsidiary) ||
        !batch.schedule.active
      ) {
        continue;
      }

      batch.updatedAt = updatedAt;
      batch.schedule.active = false;
      batch.schedule.rerunEnabled = false;
      batch.schedule.nextScheduledRunAt = null;
      batch.schedule.nextWorkbookIntakeAt = null;
      batch.schedule.nextDeltaRunAt = null;
      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          replacedByBatchId: currentBatchId,
        },
        "deactivated older workbook rerun schedule",
      );
    }
  }

  private async removeSupersededAgencyBatches(currentBatch: BatchRecord): Promise<void> {
    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(currentBatch.subsidiary.id);
    const batches = await this.repository.listBatches();

    for (const batch of batches) {
      if (
        batch.id === currentBatch.id ||
        !batchBelongsToSubsidiary(batch, subsidiary) ||
        this.activeBatchJobs.has(batch.id)
      ) {
        continue;
      }

      const promotionFailures = await this.promoteBatchPatientsToMemory(batch);
      if (promotionFailures.length > 0) {
        this.logger.warn(
          {
            batchId: batch.id,
            subsidiaryId: batch.subsidiary.id,
            failingWorkItemIds: promotionFailures,
          },
          "skipped superseded batch deletion because patient memory promotion failed",
        );
        continue;
      }

      if (batch.schedule.scheduledRunId) {
        await this.scheduledRunRepository.deleteScheduledRun(batch.schedule.scheduledRunId);
      }

      await this.repository.deleteBatch(batch.id);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          preservedBatchId: currentBatch.id,
        },
        "removed superseded batch for agency cleanup",
      );
    }
  }

  private async createOrRefreshScheduledRun(
    batch: BatchRecord,
    subsidiary: SubsidiaryRecord,
    updatedAt: string,
  ): Promise<ScheduledRunRecord> {
    const schedule: ScheduledRunRecord = {
      id: batch.schedule.scheduledRunId ?? `schedule-${batch.id}`,
      subsidiaryId: subsidiary.id,
      batchId: batch.id,
      workbookPath: batch.sourceWorkbook.storedPath,
      originalFileName: batch.sourceWorkbook.originalFileName,
      active: batch.schedule.active,
      rerunEnabled: batch.schedule.rerunEnabled,
      intervalHours: batch.schedule.intervalHours,
      timezone: batch.schedule.timezone || subsidiary.timezone,
      localTimes: batch.schedule.localTimes,
      lastRunAt: batch.schedule.lastRunAt,
      nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
      lastWorkbookAcquiredAt: batch.schedule.lastWorkbookAcquiredAt ?? batch.sourceWorkbook.uploadedAt ?? null,
      nextWorkbookIntakeAt: batch.schedule.nextWorkbookIntakeAt ?? null,
      lastDeltaRunAt: batch.schedule.lastDeltaRunAt ?? batch.schedule.lastRunAt,
      nextDeltaRunAt: batch.schedule.nextDeltaRunAt ?? null,
      createdAt: batch.createdAt,
      updatedAt,
    };
    const existing = await this.scheduledRunRepository.getScheduledRun(schedule.id);
    if (existing) {
      schedule.createdAt = existing.createdAt;
    }
    await this.scheduledRunRepository.saveScheduledRun(schedule);
    return schedule;
  }

  private async syncScheduledRunForBatch(batch: BatchRecord): Promise<void> {
    if (!batch.schedule.scheduledRunId) {
      return;
    }

    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(batch.subsidiary.id);
    await this.createOrRefreshScheduledRun(
      batch,
      subsidiary,
      batch.updatedAt,
    );
  }

  private async mustGetBatch(batchId: string): Promise<BatchRecord> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    return batch;
  }
}
