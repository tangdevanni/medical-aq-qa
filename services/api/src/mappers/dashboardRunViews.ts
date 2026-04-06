import type {
  AutomationStepLog,
  PatientEpisodeWorkItem,
  PatientRun,
  PatientRunLog,
} from "@medical-ai-qa/shared-types";
import type { BatchRecord } from "../types/batchControlPlane";
import {
  toBatchSummaryResponse,
  toBatchDetail,
  toBatchListItem,
  toPatientArtifactsResponse,
  toPatientRunDetail,
  toPatientRunLogResponse,
  toPatientRunSummary,
} from "./controlPlaneViews";

type KnownArtifactContents = {
  codingInput: unknown | null;
  documentText: unknown | null;
  oasisDiagnosisCompare: unknown | null;
  oasisDiagnosisSnapshot: unknown | null;
  oasisDiagnosisVerification: unknown | null;
  oasisExecutionResult: unknown | null;
  oasisInputActions: unknown | null;
  oasisLockState: unknown | null;
  oasisReadyDiagnosis: unknown | null;
};

type KnownArtifactPaths = {
  codingInput: string;
  documentText: string;
  oasisDiagnosisCompare: string;
  oasisDiagnosisSnapshot: string;
  oasisDiagnosisVerification: string;
  oasisExecutionResult: string;
  oasisInputActions: string;
  oasisLockState: string;
  oasisReadyDiagnosis: string;
};

type PatientViewInput = {
  batchId: string;
  summary: BatchRecord["patientRuns"][number];
  detail: PatientRun | null;
  log: PatientRunLog | null;
  workItem: PatientEpisodeWorkItem | null;
  artifactContents: KnownArtifactContents;
  artifactPaths: KnownArtifactPaths;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getLogs(input: PatientViewInput): AutomationStepLog[] {
  return input.detail?.automationStepLogs ?? input.log?.automationStepLogs ?? [];
}

function hasAnyStep(logs: AutomationStepLog[], steps: string[]): boolean {
  return logs.some((log) => steps.includes(log.step));
}

function findLastStepLog(logs: AutomationStepLog[], steps: string[]): AutomationStepLog | null {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const log = logs[index];
    if (log && steps.includes(log.step)) {
      return log;
    }
  }
  return null;
}

function didStepSucceed(
  logs: AutomationStepLog[],
  steps: string[],
  fallback: boolean,
): boolean {
  const log = findLastStepLog(logs, steps);
  if (!log) {
    return fallback;
  }

  if (log.missing.length > 0) {
    return false;
  }

  return !/(skipped|failed|could not|not confirmed|not available|stopped because)/i.test(log.message);
}

function deriveLockState(input: PatientViewInput): "locked" | "unlocked" | "unknown" {
  const lockStateArtifact = asRecord(input.artifactContents.oasisLockState);
  const executionArtifact = asRecord(input.artifactContents.oasisExecutionResult);
  const lockState = asString(lockStateArtifact?.oasisLockState) ?? asString(executionArtifact?.lockState);
  if (lockState === "locked" || lockState === "unlocked") {
    return lockState;
  }
  return "unknown";
}

function deriveMode(input: PatientViewInput): "verification_only" | "input_capable" {
  const inputActions = asRecord(input.artifactContents.oasisInputActions);
  const verification = asRecord(input.artifactContents.oasisDiagnosisVerification);
  const execution = asRecord(input.artifactContents.oasisExecutionResult);
  const lockStateArtifact = asRecord(input.artifactContents.oasisLockState);
  const mode =
    asString(inputActions?.mode) ??
    asString(verification?.mode) ??
    asString(execution?.mode);

  if (mode === "input_capable") {
    return "input_capable";
  }
  if (mode === "verification_only") {
    return "verification_only";
  }
  if (asBoolean(lockStateArtifact?.inputEligible)) {
    return "input_capable";
  }
  return "verification_only";
}

function deriveDiagnosisSummary(input: PatientViewInput) {
  const readyDiagnosisArtifact = asRecord(input.artifactContents.oasisReadyDiagnosis);
  const readyDiagnosis = readyDiagnosisArtifact ?? asRecord(input.artifactContents.codingInput);
  const primaryDiagnosis = asRecord(readyDiagnosis?.primaryDiagnosis);
  const otherDiagnoses = asArray(readyDiagnosis?.otherDiagnoses)
    .map((diagnosis) => asRecord(diagnosis))
    .filter((diagnosis): diagnosis is Record<string, unknown> => Boolean(diagnosis));
  const primary = primaryDiagnosis
    ? {
        code: asString(primaryDiagnosis.code),
        description: asString(primaryDiagnosis.description),
        confidence: asString(primaryDiagnosis.confidence),
      }
    : null;
  const other = otherDiagnoses.map((diagnosis) => ({
    code: asString(diagnosis.code),
    description: asString(diagnosis.description),
    confidence: asString(diagnosis.confidence),
  }));

  return {
    primaryDiagnosis: primary,
    otherDiagnoses: other,
    primaryDiagnosisCode: primary?.code ?? null,
    primaryDiagnosisDescription: primary?.description ?? null,
    otherDiagnosisCount: other.length,
    hasReadyDiagnosisArtifact: Boolean(readyDiagnosisArtifact),
    primaryDiagnosisPresent: Boolean(primary?.code || primary?.description),
    otherDiagnosesAvailable: Array.isArray(readyDiagnosis?.otherDiagnoses),
  };
}

function deriveEligibility(input: PatientViewInput): {
  inputEligible: boolean;
  verificationOnly: boolean;
} {
  const lockStateArtifact = asRecord(input.artifactContents.oasisLockState);
  const mode = deriveMode(input);
  return {
    inputEligible:
      asBoolean(lockStateArtifact?.inputEligible) ??
      mode === "input_capable",
    verificationOnly:
      asBoolean(lockStateArtifact?.verificationOnly) ??
      mode === "verification_only",
  };
}

function deriveDiagnosisDetectionPassed(input: PatientViewInput): boolean {
  const diagnosisSummary = deriveDiagnosisSummary(input);
  const lockState = deriveLockState(input);
  const logs = getLogs(input);
  const oasisSocOpened = didStepSucceed(logs, ["oasis_soc_document"], false);
  const lockStateDetected = lockState === "locked" || lockState === "unlocked";

  return (
    oasisSocOpened &&
    lockStateDetected &&
    diagnosisSummary.hasReadyDiagnosisArtifact &&
    diagnosisSummary.primaryDiagnosisPresent &&
    diagnosisSummary.otherDiagnosesAvailable
  );
}

function deriveExecutionSummary(input: PatientViewInput): {
  status: "executed" | "skipped" | "locked" | "not_attempted";
  reasons: string[];
} {
  const execution = asRecord(input.artifactContents.oasisExecutionResult);
  const warnings = asArray(execution?.warnings)
    .map((value) => asString(value))
    .filter((value): value is string => Boolean(value));
  const lockState = deriveLockState(input);

  if (asBoolean(execution?.executed)) {
    return {
      status: "executed",
      reasons: warnings.filter((warning) => warning.startsWith("executionSkipReason:") === false),
    };
  }

  if (warnings.includes("executionSkipped")) {
    const reasons = warnings
      .filter((warning) => warning.startsWith("executionSkipReason:"))
      .map((warning) => warning.replace("executionSkipReason:", ""));
    return {
      status: reasons.includes("lock_state_locked") || lockState === "locked" ? "locked" : "skipped",
      reasons,
    };
  }

  if (lockState === "locked") {
    return {
      status: "locked",
      reasons: ["lock_state_locked"],
    };
  }

  return {
    status: "not_attempted",
    reasons: [],
  };
}

function deriveComparisonSummary(input: PatientViewInput) {
  const verification = asRecord(input.artifactContents.oasisDiagnosisVerification);
  if (verification) {
    const matchedCount = asArray(verification.matchedDiagnoses).length;
    const missingCount = asArray(verification.missingInPortal).length;
    const extraCount = asArray(verification.extraInPortal).length;
    const mismatchedDescriptionCount = asArray(verification.mismatchedDescriptions).length;
    const mismatchedCodeCount = asArray(verification.mismatchedCodes).length;
    const primaryDiagnosisMatch = asBoolean(verification.primaryDiagnosisMatch) ?? false;
    return {
      source: "verification" as const,
      primaryDiagnosisMatch,
      matchedCount,
      missingCount,
      extraCount,
      mismatchedDescriptionCount,
      mismatchedCodeCount,
      passed:
        primaryDiagnosisMatch &&
        missingCount === 0 &&
        extraCount === 0 &&
        mismatchedDescriptionCount === 0 &&
        mismatchedCodeCount === 0,
    };
  }

  const compare = asRecord(input.artifactContents.oasisDiagnosisCompare);
  const summary = asRecord(compare?.summary);
  if (!summary) {
    return null;
  }

  return {
    source: "comparison" as const,
    primaryDiagnosisMatch: null,
    matchedCount: (asNumber(summary.exactMatchCount) ?? 0) + (asNumber(summary.normalizedMatchCount) ?? 0),
    missingCount: asNumber(summary.missingOnPortalCount) ?? 0,
    extraCount: asNumber(summary.missingInExtractionCount) ?? 0,
    mismatchedDescriptionCount: asNumber(summary.mismatchCount) ?? 0,
    mismatchedCodeCount: 0,
    passed:
      (asNumber(summary.missingOnPortalCount) ?? 0) === 0 &&
      (asNumber(summary.missingInExtractionCount) ?? 0) === 0 &&
      (asNumber(summary.mismatchCount) ?? 0) === 0,
  };
}

function deriveBlockReason(input: PatientViewInput): string | null {
  const candidates = [
    input.summary.errorSummary,
    input.detail?.errorSummary ?? null,
    input.log?.errorSummary ?? null,
    input.summary.matchResult.note ?? null,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (candidate.includes("dashboard_context_not_established")) {
      return candidate;
    }
  }

  return candidates[0] ?? null;
}

function deriveWorkflowStatuses(input: PatientViewInput) {
  const logs = getLogs(input);
  const lockState = deriveLockState(input);
  const mode = deriveMode(input);

  const statuses = [
    {
      key: "uploaded",
      label: "Uploaded",
      status: "complete",
    },
    {
      key: "workbook_parsed",
      label: "Workbook parsed",
      status: "complete",
    },
    {
      key: "run_started",
      label: "Run started",
      status: hasAnyStep(logs, ["run_started", "playwright_session", "login"]) ? "complete" : "pending",
    },
    {
      key: "dashboard_ready",
      label: "Dashboard ready",
      status: didStepSucceed(logs, ["dashboard_ready"], false) ? "complete" : "pending",
    },
    {
      key: "patient_search_started",
      label: "Patient search started",
      status: hasAnyStep(logs, ["patient_search_start"]) ? "complete" : "pending",
    },
    {
      key: "chart_opened",
      label: "Chart opened",
      status: didStepSucceed(logs, ["chart_open"], false) ? "complete" : "pending",
    },
    {
      key: "file_uploads_opened",
      label: "File uploads opened",
      status: didStepSucceed(logs, ["file_uploads_open"], false) ? "complete" : "pending",
    },
    {
      key: "source_pdf_captured",
      label: "Source PDF captured",
      status:
        input.summary.artifactCount > 0 ||
        (input.detail?.artifacts.length ?? 0) > 0
          ? "complete"
          : "pending",
    },
    {
      key: "ocr_complete",
      label: "OCR complete",
      status:
        input.artifactContents.documentText ||
        hasAnyStep(logs, ["document_extraction", "document_text_export"])
          ? "complete"
          : "pending",
    },
    {
      key: "diagnosis_coding_complete",
      label: "Diagnosis/coding complete",
      status:
        input.artifactContents.codingInput ||
        hasAnyStep(logs, ["diagnosis_code_extract", "coding_input_export"])
          ? "complete"
          : "pending",
    },
    {
      key: "oasis_soc_opened",
      label: "OASIS SOC opened",
      status: didStepSucceed(logs, ["oasis_soc_document"], false) ? "complete" : "pending",
    },
    {
      key: "lock_state_detected",
      label: "Lock state detected",
      status:
        input.artifactContents.oasisLockState ||
        hasAnyStep(logs, ["oasis_lock_state_detected", "oasis_lock_state_export"])
          ? "complete"
          : "pending",
    },
    {
      key: "diagnosis_snapshot_captured",
      label: "Diagnosis snapshot captured",
      status:
        input.artifactContents.oasisDiagnosisSnapshot ||
        hasAnyStep(logs, ["oasis_diagnosis_snapshot", "oasis_diagnosis_snapshot_export"])
          ? "complete"
          : "pending",
    },
    {
      key: "diagnosis_compare_complete",
      label: "Diagnosis compare complete",
      status:
        input.artifactContents.oasisDiagnosisCompare ||
        hasAnyStep(logs, ["oasis_diagnosis_compare"])
          ? "complete"
          : "pending",
    },
    {
      key: "verification_complete",
      label: "Verification complete",
      status:
        input.artifactContents.oasisDiagnosisVerification ||
        hasAnyStep(logs, ["oasis_diagnosis_verification"])
          ? "complete"
          : "pending",
    },
    {
      key: "input_capable",
      label: "Input-capable",
      status: mode === "input_capable" && lockState === "unlocked" ? "complete" : "pending",
    },
    {
      key: "blocked",
      label: "Blocked",
      status: ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(input.summary.processingStatus)
        ? "blocked"
        : "pending",
    },
  ].map((item) => ({
    ...item,
    status:
      ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(input.summary.processingStatus) &&
      item.status === "pending"
        ? "blocked"
        : item.status,
  }));

  const current =
    input.summary.processingStatus === "FAILED"
      ? "Failed"
      : input.summary.processingStatus === "BLOCKED"
        ? "Blocked"
        : input.summary.processingStatus === "NEEDS_HUMAN_REVIEW"
          ? "Needs human review"
          : statuses.find((status) => status.status === "pending")?.label ??
            statuses.at(-1)?.label ??
            "Complete";

  const lastEvidence = logs.slice(-5).map((log) => ({
    timestamp: log.timestamp,
    step: log.step,
    message: log.message,
    evidence: log.evidence,
    found: log.found,
    missing: log.missing,
  }));

  return {
    workflowCurrentStep: current,
    workflowStatuses: statuses,
    stepEvidenceSummary: lastEvidence,
    stepLogCount: logs.length,
  };
}

export function toDashboardRunListItem(batch: BatchRecord) {
  return {
    ...toBatchListItem(batch),
    eligibleWorkItemCount: batch.parse.eligibleWorkItemCount,
  };
}

export function toDashboardPatientSummary(input: PatientViewInput) {
  const summary = toPatientRunSummary(input.batchId, input.summary);
  const diagnosisSummary = deriveDiagnosisSummary(input);
  const comparisonSummary = deriveComparisonSummary(input);
  const workflow = deriveWorkflowStatuses(input);
  const lockState = deriveLockState(input);
  const mode = deriveMode(input);
  const eligibility = deriveEligibility(input);
  const diagnosisDetectionPassed = deriveDiagnosisDetectionPassed(input);
  const executionSummary = deriveExecutionSummary(input);
  const blockReason = deriveBlockReason(input);

  return {
    ...summary,
    workflowCurrentStep: workflow.workflowCurrentStep,
    workflowStatuses: workflow.workflowStatuses,
    stepEvidenceSummary: workflow.stepEvidenceSummary,
    stepLogCount: workflow.stepLogCount,
    lockState,
    mode,
    inputEligible: eligibility.inputEligible,
    verificationOnly: eligibility.verificationOnly,
    diagnosisDetectionPassed,
    primaryDiagnosis: diagnosisSummary.primaryDiagnosis,
    otherDiagnoses: diagnosisSummary.otherDiagnoses,
    primaryDiagnosisCode: diagnosisSummary.primaryDiagnosisCode,
    primaryDiagnosisDescription: diagnosisSummary.primaryDiagnosisDescription,
    otherDiagnosisCount: diagnosisSummary.otherDiagnosisCount,
    comparisonSummary,
    executionSummary,
    blockReason,
  };
}

export function toDashboardRunDetail(input: {
  batch: BatchRecord;
  workItems: PatientEpisodeWorkItem[];
  patients: ReturnType<typeof toDashboardPatientSummary>[];
}) {
  const detail = toBatchDetail(input.batch);

  return {
    ...detail,
    eligibleWorkItemCount: input.batch.parse.eligibleWorkItemCount,
    diagnosisDetectionPassedCount: input.patients.filter((patient) => patient.diagnosisDetectionPassed).length,
    runLifecycle: [
      {
        key: "uploaded",
        label: "Uploaded",
        status: "complete" as const,
      },
      {
        key: "parsed",
        label: "Parsed",
        status: input.batch.parse.completedAt ? "complete" as const : "pending" as const,
      },
      {
        key: "run_started",
        label: "Run started",
        status: input.batch.run.requestedAt ? "complete" as const : "pending" as const,
      },
      {
        key: "blocked",
        label: "Blocked",
        status: input.batch.patientRuns.some((patientRun) =>
          ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(patientRun.processingStatus),
        )
          ? "blocked" as const
          : "pending" as const,
      },
    ],
    parsePreview: {
      detectedSources: input.batch.parse.sourceDetections,
      sheetSummaries: input.batch.parse.sheetSummaries,
      previewRows: input.workItems.map((workItem) => ({
        workItemId: workItem.id,
        patientName: workItem.patientIdentity.displayName,
        billingPeriod: workItem.episodeContext.billingPeriod,
        workflowTypes: workItem.workflowTypes,
        sourceSheets: workItem.sourceSheets,
        automationEligible: true,
      })),
    },
    patients: input.patients,
  };
}

export function toDashboardPatientDetail(input: PatientViewInput) {
  const detail = toPatientRunDetail(input.batchId, input.summary, input.detail);
  const summary = toDashboardPatientSummary(input);
  const logs = getLogs(input);

  return {
    ...detail,
    ...summary,
    workItemSnapshot: input.workItem ?? detail.workItemSnapshot,
    automationStepLogs: logs,
    artifactPaths: input.artifactPaths,
    artifactContents: input.artifactContents,
  };
}

export function toDashboardPatientStatus(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);
  return {
    runId: summary.runId,
    batchId: summary.batchId,
    patientId: summary.workItemId,
    patientName: summary.patientName,
    status: summary.status,
    executionStep: summary.executionStep,
    workflowCurrentStep: summary.workflowCurrentStep,
    workflowStatuses: summary.workflowStatuses,
    lockState: summary.lockState,
    mode: summary.mode,
    inputEligible: summary.inputEligible,
    verificationOnly: summary.verificationOnly,
    diagnosisDetectionPassed: summary.diagnosisDetectionPassed,
    primaryDiagnosis: summary.primaryDiagnosis,
    otherDiagnoses: summary.otherDiagnoses,
    comparisonSummary: summary.comparisonSummary,
    executionSummary: summary.executionSummary,
    blockReason: summary.blockReason,
    lastUpdatedAt: summary.lastUpdatedAt,
  };
}

export {
  toBatchDetail,
  toBatchSummaryResponse,
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
};
