export interface DiagnosisEntry {
  code: string | null;
  description: string | null;
  confidence: string | null;
}

export type ReferralDiscrepancyRating = "green" | "yellow" | "red";

export interface ReferralPatientContext {
  patientId: string;
  patientName: string | null;
  dob: string | null;
  socDate: string | null;
  referralDate: string | null;
}

export interface ReferralSourceEvidence {
  sourceType: string;
  sourceLabel: string;
  textSpan?: string | null;
  confidence?: number | null;
}

export interface ReferralTextLineReference {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

export interface ReferralTextSpan {
  text: string;
  sourceSectionNames: string[];
  relatedFieldKeys: string[];
  lineReferences: ReferralTextLineReference[];
}

export interface ReferralFieldView {
  fieldKey: string;
  label: string;
  sectionKey: string;
  sectionLabel: string;
  groupKey: string;
  qaPriority: "critical" | "high" | "medium" | "low";
  oasisItemId: string | null;
  fieldType: string;
  controlType: string;
  reviewMode: string;
  notes: string | null;
  currentChartValue: unknown;
  documentSupportedValue: unknown;
  comparisonStatus: string;
  workflowState: string;
  recommendedAction: string;
  requiresHumanReview: boolean;
  sourceEvidence: ReferralSourceEvidence[];
  discrepancyRating: ReferralDiscrepancyRating;
  recommendation: {
    label: string;
    recommendedValue: string;
    rationale: string;
    owner: string;
    confidenceLabel: string;
  };
}

export interface ReferralSectionView {
  sectionKey: string;
  label: string;
  dashboardOrder: number;
  printVisibility: "visible" | "hidden_in_print";
  fieldCount: number;
  populatedFieldCount: number;
  discrepancyRating: ReferralDiscrepancyRating;
  textSpans: ReferralTextSpan[];
  fields: ReferralFieldView[];
  guidance: {
    mustCheck: string[];
    requiredLogic: string[];
    likelyMissing: string[];
    saveReminder: string;
    escalationGuidance: string[];
  };
}

export interface ReferralPreAuditFinding {
  id: string;
  severity: "critical" | "warning";
  category: string;
  title: string;
  detail: string;
}

export interface ReferralConsistencyCheck {
  id: string;
  status: "flagged" | "watch";
  title: string;
  detail: string;
  relatedSections: string[];
}

export interface ReferralSourceHighlight {
  id: string;
  title: string;
  summary: string;
  supportingSections: string[];
}

export interface ReferralDraftNarrative {
  fieldKey: string;
  label: string;
  draft: string;
  status: "ready_for_qa" | "needs_human_review";
}

export interface ReferralExceptionRoute {
  id: string;
  owner: string;
  title: string;
  detail: string;
}

export interface ReferralQaSummary {
  patientContext: ReferralPatientContext | null;
  referralDataAvailable: boolean;
  extractionUsabilityStatus: string;
  qaStatus: string;
  discrepancyRating: ReferralDiscrepancyRating;
  discrepancyCounts: {
    total: number;
    critical: number;
    warning: number;
    possibleConflict: number;
    codingReview: number;
    missingInChart: number;
    needsQaReadback: number;
    supportedByReferral: number;
  };
  availableSectionCount: number;
  totalSectionCount: number;
  llmProposalCount: number | null;
  warningCount: number;
  topWarning: string | null;
  warnings: string[];
  preAuditFindings: ReferralPreAuditFinding[];
  consistencyChecks: ReferralConsistencyCheck[];
  sourceHighlights: ReferralSourceHighlight[];
  draftNarratives: ReferralDraftNarrative[];
  exceptionRoutes: ReferralExceptionRoute[];
  sections: ReferralSectionView[];
}

export interface WorkflowTrackSummary {
  workflowRunId: string;
  workflowDomain: "coding" | "qa";
  status: string;
  stepName: string;
  message: string | null;
  chartUrl: string | null;
  workflowResultPath: string | null;
  workflowLogPath: string | null;
  lastUpdatedAt: string;
}

export interface QaPrefetchSummary {
  status: string;
  selectedRouteSummary: string | null;
  lockStatus: string | null;
  oasisFound: boolean;
  diagnosisFound: boolean;
  visibleDiagnosisCount: number;
  warningCount: number;
  topWarning: string | null;
  selectedEpisodeRange: string | null;
  first30TotalCards: number;
  second30TotalCards: number;
  outsideRangeTotalCards: number;
  first30CountsByType: Record<string, unknown>;
  second30CountsByType: Record<string, unknown>;
  printedNoteStatus: string | null;
  printedNoteAssessmentType: string | null;
  printedNoteReviewSource: string | null;
  printedNoteWarningCount: number;
  printedNoteTopWarning: string | null;
  printedNoteCompletedSectionCount: number;
  printedNoteIncompleteSectionCount: number;
  printedNotePrintButtonDetected: boolean;
  printedNotePrintClickSucceeded: boolean;
  printedNoteExtractionMethod: string | null;
  printedNoteTextLength: number;
  printedNoteSections: Array<{
    key: string;
    label: string;
    status: string;
    filledFieldCount: number;
    missingFieldCount: number;
  }>;
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
  codingWorkflow: WorkflowTrackSummary | null;
  qaWorkflow: WorkflowTrackSummary | null;
  qaPrefetch: QaPrefetchSummary | null;
  referralQa: ReferralQaSummary;
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
  qaPrefetch: QaPrefetchSummary | null;
  referralPatientContext: ReferralPatientContext | null;
  referralSections: ReferralSectionView[];
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
  codingWorkflow: WorkflowTrackSummary | null;
  qaWorkflow: WorkflowTrackSummary | null;
  qaPrefetch: QaPrefetchSummary | null;
  referralQa: ReferralQaSummary;
}
