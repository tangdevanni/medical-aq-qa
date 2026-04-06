import type {
  ArtifactRecord,
  AutomationStepLog,
  OasisQaSummary,
  PatientEpisodeWorkItem,
  QaFinding,
} from "@medical-ai-qa/shared-types";

export interface WorkflowStatus {
  key: string;
  label: string;
  status: "complete" | "pending" | "blocked";
}

export interface StepEvidenceSummary {
  timestamp: string;
  step: string;
  message: string;
  evidence: string[];
  found: string[];
  missing: string[];
}

export interface ComparisonSummary {
  source: "verification" | "comparison";
  primaryDiagnosisMatch: boolean | null;
  matchedCount: number;
  missingCount: number;
  extraCount: number;
  mismatchedDescriptionCount: number;
  mismatchedCodeCount: number;
  passed: boolean;
}

export interface DiagnosisEntry {
  code: string | null;
  description: string | null;
  confidence: string | null;
}

export interface ExecutionSummary {
  status: "executed" | "skipped" | "locked" | "not_attempted";
  reasons: string[];
}

export interface PatientSummary {
  runId: string;
  batchId: string;
  workItemId: string;
  patientName: string;
  status: string;
  executionStep: string;
  percentComplete: number;
  startedAt: string | null;
  completedAt: string | null;
  lastUpdatedAt: string;
  matchResult: {
    status: string;
    searchQuery: string;
    portalPatientId: string | null;
    portalDisplayName: string | null;
    candidateNames: string[];
    note: string | null;
  };
  qaOutcome: string;
  oasisQaSummary: OasisQaSummary;
  overallStatus: OasisQaSummary["overallStatus"];
  urgency: OasisQaSummary["urgency"];
  daysInPeriod: number | null;
  daysLeft: number | null;
  blockerCount: number;
  blockers: string[];
  currentQaStage: string;
  sections: Array<{
    key: string;
    label: string;
    status: string;
  }>;
  artifactCount: number;
  findingsAvailable: boolean;
  bundleAvailable: boolean;
  logAvailable: boolean;
  retryEligible: boolean;
  errorSummary: string | null;
  attemptCount: number;
  logPath: string | null;
  resultBundlePath: string;
  workflowCurrentStep: string;
  workflowStatuses: WorkflowStatus[];
  stepEvidenceSummary: StepEvidenceSummary[];
  stepLogCount: number;
  lockState: "locked" | "unlocked" | "unknown";
  mode: "verification_only" | "input_capable";
  inputEligible: boolean;
  verificationOnly: boolean;
  diagnosisDetectionPassed: boolean;
  primaryDiagnosis: DiagnosisEntry | null;
  otherDiagnoses: DiagnosisEntry[];
  primaryDiagnosisCode: string | null;
  primaryDiagnosisDescription: string | null;
  otherDiagnosisCount: number;
  comparisonSummary: ComparisonSummary | null;
  executionSummary: ExecutionSummary;
  blockReason: string | null;
}

export interface RunListItem {
  id: string;
  billingPeriod: string | null;
  status: string;
  currentExecutionStep: string;
  percentComplete: number;
  currentlyRunningCount: number;
  totalWorkItems: number;
  totalCompleted: number;
  totalBlocked: number;
  totalFailed: number;
  totalNeedsHumanReview: number;
  totalReadyForBillingPrep: number;
  totalDueSoon: number;
  totalOverdue: number;
  totalParserExceptions: number;
  createdAt: string;
  lastUpdatedAt: string;
  errorSummary: string | null;
  patients: PatientSummary[];
  eligibleWorkItemCount: number;
}

export interface RunDetail extends RunListItem {
  sourceWorkbook: {
    acquisitionProvider: string;
    acquisitionStatus: string;
    acquisitionReference: string | null;
    acquisitionNotes: string[];
    originalFileName: string;
    storedPath: string;
    uploadedAt: string;
  };
  timestamps: {
    createdAt: string;
    lastUpdatedAt: string;
    parseRequestedAt: string | null;
    parseCompletedAt: string | null;
    runRequestedAt: string | null;
    runCompletedAt: string | null;
  };
  artifactPaths: {
    batchRoot: string;
    outputRoot: string;
    manifestPath: string | null;
    workItemsPath: string | null;
    parserExceptionsPath: string | null;
    batchSummaryPath: string | null;
    patientResultsDirectory: string;
    evidenceDirectory: string;
  };
  actions: {
    canParse: boolean;
    canRun: boolean;
    canRetryBlockedPatients: boolean;
  };
  diagnosisDetectionPassedCount: number;
  runLifecycle: WorkflowStatus[];
  parsePreview: {
    detectedSources: Array<{
      sourceType: string;
      detectedSheetName: string | null;
      detectionStatus: "detected" | "missing";
      headerRowNumber: number | null;
      headerMatchCount: number;
      minimumHeaderMatches: number;
      extractedRowCount: number;
    }>;
    sheetSummaries: Array<{
      sheetName: string;
      detectedSourceType: string | null;
      rowCount: number;
      headerRowNumber: number | null;
      headerMatchCount: number;
      detectedHeaders: Record<string, string>;
      extractedRowCount: number;
      excludedRows: Array<{
        sourceRowNumber: number;
        reason: string;
        sample: string | null;
      }>;
    }>;
    previewRows: Array<{
      workItemId: string;
      patientName: string;
      billingPeriod: string | null;
      workflowTypes: string[];
      sourceSheets: string[];
      automationEligible: boolean;
    }>;
  };
}

export interface PatientDetail extends PatientSummary {
  artifacts: ArtifactRecord[];
  findings: QaFinding[];
  notes: string[];
  auditArtifacts: {
    tracePath: string | null;
    screenshotPaths: string[];
    downloadPaths: string[];
  };
  workItemSnapshot: PatientEpisodeWorkItem | null;
  automationStepLogs: AutomationStepLog[];
  artifactPaths: Record<string, string>;
  artifactContents: Record<string, unknown | null>;
}

export interface PatientArtifactsResponse {
  runId: string;
  batchId: string;
  patientId: string;
  patientName: string;
  artifacts: Array<{
    kind: string;
    name: string;
    path: string;
    exists: boolean;
    modifiedAt: string | null;
    sizeBytes: number | null;
  }>;
}

export interface RunStatusResponse {
  batchId: string;
  currentBatchStatus: string;
  currentExecutionStep: string;
  totalWorkItems: number;
  totalCompleted: number;
  totalBlocked: number;
  totalFailed: number;
  totalNeedsHumanReview: number;
  totalReadyForBillingPrep: number;
  totalDueSoon: number;
  totalOverdue: number;
  totalParserExceptions: number;
  percentComplete: number;
  currentlyRunningCount: number;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  lastUpdatedAt: string;
  errorSummary: string | null;
  eligibleWorkItemCount: number;
}

export interface PatientStatusResponse {
  runId: string;
  batchId: string;
  patientId: string;
  patientName: string;
  status: string;
  executionStep: string;
  workflowCurrentStep: string;
  workflowStatuses: WorkflowStatus[];
  lockState: "locked" | "unlocked" | "unknown";
  mode: "verification_only" | "input_capable";
  inputEligible: boolean;
  verificationOnly: boolean;
  diagnosisDetectionPassed: boolean;
  primaryDiagnosis: DiagnosisEntry | null;
  otherDiagnoses: DiagnosisEntry[];
  comparisonSummary: ComparisonSummary | null;
  executionSummary: ExecutionSummary;
  blockReason: string | null;
  lastUpdatedAt: string;
}
