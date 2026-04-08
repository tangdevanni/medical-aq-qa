export interface DiagnosisEntry {
  code: string | null;
  description: string | null;
  confidence: string | null;
}

export interface PatientSummary {
  subsidiaryId: string;
  subsidiarySlug: string;
  subsidiaryName: string;
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
  errorSummary: string | null;
  retryEligible: boolean;
  attemptCount: number;
  resultBundlePath: string;
  logPath: string | null;
  batchStatusSummary: string;
  daysLeftBeforeOasisDueDate: number | null;
  primaryDiagnosis: DiagnosisEntry | null;
  otherDiagnoses: DiagnosisEntry[];
  runMode: "read_only";
  rerunEnabled: boolean;
  lastRunAt: string | null;
  nextScheduledRunAt: string | null;
}

export interface RunListItem {
  subsidiaryId: string;
  subsidiarySlug: string;
  subsidiaryName: string;
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
  createdAt: string;
  lastUpdatedAt: string;
  errorSummary: string | null;
  runMode: "read_only";
  rerunEnabled: boolean;
  lastRunAt: string | null;
  nextScheduledRunAt: string | null;
}

export interface RunDetail extends RunListItem {
  sourceWorkbookName: string;
  uploadedAt: string;
  canRetryBlockedPatients: boolean;
  canDeactivate: boolean;
  patientStatusSummary: {
    ready: number;
    blocked: number;
    failed: number;
    needsManualReview: number;
    inProgress: number;
  };
  patients: PatientSummary[];
}

export interface PatientDetail extends PatientSummary {
  workbookContext: {
    billingPeriod: string | null;
    workflowTypes: string[];
    rawDaysLeftValues: string[];
  };
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
  subsidiaryId: string;
  subsidiarySlug: string;
  subsidiaryName: string;
  batchId: string;
  currentBatchStatus: string;
  currentExecutionStep: string;
  totalWorkItems: number;
  totalCompleted: number;
  totalBlocked: number;
  totalFailed: number;
  totalNeedsHumanReview: number;
  percentComplete: number;
  currentlyRunningCount: number;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  lastUpdatedAt: string;
  errorSummary: string | null;
  runMode: "read_only";
  rerunEnabled: boolean;
  lastRunAt: string | null;
  nextScheduledRunAt: string | null;
}

export interface PatientStatusResponse {
  subsidiaryId: string;
  subsidiarySlug: string;
  subsidiaryName: string;
  runId: string;
  batchId: string;
  patientId: string;
  patientName: string;
  status: string;
  executionStep: string;
  batchStatusSummary: string;
  primaryDiagnosis: DiagnosisEntry | null;
  otherDiagnoses: DiagnosisEntry[];
  runMode: "read_only";
  rerunEnabled: boolean;
  lastRunAt: string | null;
  nextScheduledRunAt: string | null;
  lastUpdatedAt: string;
}
