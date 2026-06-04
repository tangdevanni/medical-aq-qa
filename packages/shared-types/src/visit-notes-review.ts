export type VisitNoteType =
  | "physical_therapy"
  | "home_health_aide"
  | "skilled_nursing"
  | "others"
  | "medical_social_worker"
  | "occupational_therapy"
  | "registered_dietitian"
  | "respiratory_therapy"
  | "speech_therapy";

export type VisitNoteServiceType = VisitNoteType;

export type VisitNoteStatus =
  | "qa_completed"
  | "e_signed"
  | "signed"
  | "not_started"
  | "missed_visit"
  | "cancelled"
  | "in_progress"
  | "submitted"
  | "qa_pending"
  | "qa_review"
  | "unknown";

export type VisitNoteNormalizedStatus = VisitNoteStatus;

export type VisitNoteCaptureEligibility =
  | "active_monitoring"
  | "finalized_no_active_monitoring"
  | "count_only"
  | "ineligible"
  | "review_needed_unknown";

export type VisitNoteLifecycleStatus =
  | "active_monitoring"
  | "finalized_no_active_monitoring"
  | "count_only"
  | "ineligible"
  | "review_needed_unknown";

export type VisitNoteCaptureStatus =
  | "not_attempted"
  | "captured"
  | "skipped"
  | "failed"
  | "capture_pending_due_to_config_limit";

export type VisitNoteDiscoveryRow = {
  visitNoteKey: string;
  portalDocumentId?: string;
  rawDocumentType: string;
  normalizedVisitType: VisitNoteType;
  normalizedVisitTypeConfidence: number;
  normalizationReason: string;
  visitDate?: string;
  visitTime?: string;
  assignedStaffRaw?: string;
  assignedStaffName?: string;
  assignedStaffDiscipline?: string;
  statusRaw?: string;
  normalizedStatus?: VisitNoteStatus;
  createdBy?: string;
  rowTextHash: string;
  rowIndex?: number;
  sourceUrlHash?: string;
  hasSafeOpenAction: boolean;
  canOpenSafely?: boolean;
  actionHints: string[];
  lifecycleStatus?: VisitNoteLifecycleStatus;
  captureEligibility?: VisitNoteCaptureEligibility;
  captureStatus: VisitNoteCaptureStatus;
  skipReason?: string;
  inactive?: boolean;
};

export type VisitTypeStatusMatrixRow = {
  visitType: VisitNoteType;
  count: number;
  statuses: Record<string, number>;
};

export type VisitNotesDiscoveryArtifact = {
  schemaVersion: "visit-notes-discovery.v1";
  generatedAt: string;
  patientKeyHash: string;
  episode: {
    label?: string;
    startDate?: string;
    endDate?: string;
  };
  pageUrlSanitized?: string;
  rows: VisitNoteDiscoveryRow[];
  counts: {
    total: number;
    byVisitType: Record<VisitNoteType, number>;
    byStatus: Record<string, number>;
    byVisitTypeAndStatus: Record<VisitNoteType, Record<string, number>>;
  };
  warnings: string[];
  diagnostics?: {
    beforeUrl?: string;
    afterUrl?: string;
    sidebarSelectorUsed?: string | null;
    retrySelectorUsed?: string | null;
    documentationSelectorUsed?: string | null;
    childSelectorUsed?: string | null;
    sidebarMenuFound?: boolean;
    sidebarMenuClicked?: boolean;
    sectionVisitviewCount?: number;
    tableRowCount?: number;
    tblLinkCount?: number;
    tbLinkCount?: number;
    firstRowTexts?: string[];
  };
};

export type VisitNotesDiscovery = VisitNotesDiscoveryArtifact;

export type VisitNoteProcessingManifest = {
  schemaVersion: "visit-note-processing-manifest.v1";
  generatedAt: string;
  patientRunId: string;
  planOfCareHash: string;
  oasisFactPackHash: string;
  visitNotesDiscoveryHash: string;
  visitNoteInputs: Array<{
    visitNoteKey: string;
    rowTextHash?: string;
    contentHash?: string;
    textHash?: string;
    cacheKey: string;
    lifecycleStatus?: VisitNoteLifecycleStatus;
    captureEligibility?: VisitNoteCaptureEligibility;
    captureStatus?: VisitNoteCaptureStatus | "unavailable";
    extractionStatus?: "usable" | "partial" | "degraded" | "failed" | "skipped";
    analysisStatus?: "ready" | "skipped" | "cache" | "failed";
    reviewStatus?: "confirmed" | "unconfirmed" | "retryable";
    retryCount?: number;
    lastProcessedAt?: string;
    failureReason?: string;
    captureStrategy?: string;
    artifactPaths?: string[];
    extractionSource: "new_ocr" | "cache" | "text_export" | "skipped";
    llmAnalysisSource: "new_llm" | "cache" | "skipped";
    analysisInputHash: string;
    rerunReason?: string;
    inactive?: boolean;
  }>;
};

export type VisitNoteFact = {
  factId: string;
  visitNoteKey: string;
  category: string;
  normalizedValue: string;
  rawSnippet?: string;
  confidence: number;
  fieldKey?: string;
  fieldLabel?: string;
  sectionLabel?: string;
  inputType?: string;
  source: {
    visitDate?: string;
    visitType: VisitNoteType;
    documentType: string;
    staff?: string;
    artifactPath?: string;
  };
};

export type VisitNoteFactPack = {
  schemaVersion: "visit-note-fact-pack.v1";
  generatedAt: string;
  factCount: number;
  categories: string[];
  facts: VisitNoteFact[];
  warnings: string[];
};

export type VisitNoteQaReviewStatus = "ready" | "partial" | "pending" | "degraded";

export type VisitNoteCompletionStatus =
  | "complete"
  | "incomplete"
  | "capture_needed"
  | "unknown";

export type VisitNoteFindingCategory =
  | "contradiction"
  | "positive_progress"
  | "possible_update_needed"
  | "poc_alignment"
  | "missing_field"
  | "status_issue"
  | "documentation_quality";

export type VisitNoteQaFinding = {
  findingId: string;
  visitNoteKey: string;
  visitType: VisitNoteType;
  visitDate?: string;
  severity: "high" | "medium" | "low";
  category: VisitNoteFindingCategory;
  title: string;
  description: string;
  visitNoteEvidence: string[];
  pocEvidence: string[];
  oasisEvidence: string[];
  suggestedReviewerAction: string;
  needsHumanReview: boolean;
  confidence: number;
};

export type VisitNoteFinding = VisitNoteQaFinding;

export type VisitNoteSummary = {
  visitNoteKey: string;
  visitType: VisitNoteType;
  visitDate?: string;
  status: string;
  lifecycleStatus?: VisitNoteLifecycleStatus;
  captureStatus?: VisitNoteCaptureStatus | "unavailable";
  analyzed: boolean;
  analysisStatus: "ready" | "skipped" | "cache" | "failed" | "pending";
  completionStatus?: VisitNoteCompletionStatus;
  completionReasons?: string[];
  summary: string;
  missingFields: string[];
  textInputSuggestions: VisitNoteTextInputSuggestion[];
  alignedPocGoals: string[];
  pocMappingResult?: VisitNotePocMappingResult;
  pocProblemMatches: Array<{
    problemKey: string;
    problemTitle: string;
    problemStatement?: string;
    interventionTexts: string[];
    matchedFactIds: string[];
    confidence: number;
    rationale: string;
  }>;
  possibleContradictions: string[];
};

export type VisitNoteTextInputSuggestion = {
  suggestionId: string;
  visitNoteKey: string;
  fieldKey: string | null;
  fieldLabel: string;
  sectionLabel: string | null;
  currentValue: string | null;
  reason: "blank" | "too_short" | "not_descriptive";
  relatedPocProblemTitle: string | null;
  suggestedInput: string;
  sourceFactIds: string[];
  confidence: number;
};

export type VisitNotePocMappingAlignmentStatus =
  | "aligned"
  | "partially_aligned"
  | "not_aligned"
  | "insufficient_documentation"
  | "contradiction"
  | "needs_review";

export type VisitNotePocMappingResult = {
  visitNoteKey: string;
  mappingStatus?: "success" | "reused" | "deterministic_only" | "degraded" | "skipped";
  mappingSource?: "llm" | "cache" | "deterministic" | "deterministic_only" | "skipped";
  inputHash?: string;
  modelId?: string | null;
  errorReason?: string;
  alignmentStatus: VisitNotePocMappingAlignmentStatus;
  matchStrength: number;
  matchedPocItems: Array<{
    problemKey: string;
    problemTitle: string;
    goalTexts: string[];
    interventionTexts: string[];
    evidenceIds: string[];
  }>;
  visitNoteEvidence: string[];
  rationale: string;
  missingDocumentation: string[];
  contradictions: string[];
  pocUpdateSignals: string[];
};

export type VisitNoteQaReviewArtifact = {
  schemaVersion: "visit-note-qa-review.v1";
  generatedAt: string;
  status: VisitNoteQaReviewStatus;
  summary: {
    totalVisitNotes: number;
    eligibleVisitNotes: number;
    analyzedVisitNotes: number;
    skippedVisitNotes: number;
    missedVisitNotes: number;
    notStartedVisitNotes: number;
    activeMonitoringCount: number;
    qaCompleteFinalizedCount: number;
    inProgressCount: number;
    submittedCount: number;
    qaPendingCount: number;
    signedCount: number;
    capturedVisitNotes: number;
    reusedVisitNotes: number;
    failedVisitNotes: number;
    degradedVisitNotes: number;
    cappedVisitNotes: number;
    byVisitType: Record<VisitNoteType, number>;
    byStatus: Record<string, number>;
    actionableFindingCount: number;
    contradictionCount: number;
    positiveProgressCount: number;
    possibleUpdateNeededCount: number;
    pocAlignmentIssueCount: number;
    incompleteNoteCount: number;
  };
  visitTypeStatusMatrix: VisitTypeStatusMatrixRow[];
  visitTypeCounts: VisitTypeStatusMatrixRow[];
  findings: VisitNoteQaFinding[];
  noteSummaries: VisitNoteSummary[];
  warnings: string[];
};

export type VisitNoteQaReview = VisitNoteQaReviewArtifact;
