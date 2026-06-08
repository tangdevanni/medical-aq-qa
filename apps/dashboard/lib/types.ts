export interface DiagnosisEntry {
  code: string | null;
  normalizedIcd10Code?: string | null;
  description: string | null;
  confidence: string | null;
  rank?: number | null;
  role?: string | null;
  slotLabel?: string | null;
  onsetDate?: string | null;
  group?: string | null;
  source?: string | null;
  status?: string | null;
}

export type DiagnosisComparisonStatus =
  | "aligned"
  | "partial_overlap"
  | "conflict"
  | "missing_referral"
  | "missing_oasis"
  | "unavailable";

export interface DiagnosisSummaryBlock {
  primaryDiagnosis: DiagnosisEntry | null;
  otherDiagnoses: DiagnosisEntry[];
  diagnosisSource: string | null;
}

export interface MedicationEntry {
  name: string;
  dose: string | null;
  route: string | null;
  classification: string | null;
  startDate: string | null;
  status: string | null;
  source: string | null;
}

export interface AllergyEntry {
  name: string;
  reaction: string | null;
  startDate: string | null;
  status: string | null;
  source: string | null;
}

export interface MedicationSummaryBlock {
  medications: MedicationEntry[];
  allergies: Array<string | AllergyEntry>;
  medicationSource: string | null;
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
  currentChartValueSource: string;
  populatedInChart: boolean;
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
  summaryHeadline: string;
  summaryDetail: string;
  displayWarnings: string[];
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
  oasisAssessmentPrimaryStatus: string | null;
  oasisAssessmentStatuses: string[];
  oasisAssessmentDecision: string | null;
  oasisAssessmentProcessingEligible: boolean | null;
  oasisAssessmentReason: string | null;
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
  first30WorkbookColumns: {
    sn: string;
    ptOtSt: string;
    hhaMsw: string;
  };
  second30WorkbookColumns: {
    sn: string;
    ptOtSt: string;
    hhaMsw: string;
  };
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
    evidence?: string[];
  }>;
}

export interface OasisValidationMissingField {
  fieldId: string | null;
  label: string;
  section: string | null;
  mItem: string | null;
  message: string | null;
  selectorUsed: string | null;
}

export interface OasisValidationSummary {
  status: string;
  validatedAt: string;
  validateSelectorUsed: string | null;
  currentUrl: string | null;
  missingFieldCount: number;
  missingFields: OasisValidationMissingField[];
  rawMessages: string[];
  warnings: string[];
}

export interface ReferralOasisConsistencyFinding {
  id: string;
  category: string;
  label: string;
  confidence: string;
  referralEvidence: string;
  oasisEvidence: string;
  reviewerExplanation: string;
  blocksPlanOfCare: boolean;
}

export interface ReferralOasisConsistencySummary {
  status: string;
  generatedAt: string;
  findingCount: number;
  blockingFindingCount: number;
  findings: ReferralOasisConsistencyFinding[];
  warnings: string[];
}

export interface OasisGateSummary {
  evaluatedAt: string;
  status: string;
  blockedFromPlanOfCare: boolean;
  missingFieldCount: number;
  contradictionCount: number;
  topReasons: string[];
  planOfCareAttempted: boolean;
  planOfCareAttemptSkippedReason: string | null;
}

export interface GeneratedPlanOfCareProblem {
  problem: string;
  domain: string | null;
  planSummary: string;
  clinicalRationale: string;
  evidence: string[];
  evidenceIds: string[];
  goals: string[];
  interventions: string[];
  interventionEvidence: Array<{
    intervention: string;
    evidenceIds: string[];
  }>;
  questionBankMatches: string[];
  candidateProblemLabels: string[];
}

export interface GeneratedPlanOfCareReadableSection {
  heading: string;
  body: string;
  bullets: string[];
}

export interface GeneratedPlanOfCarePreviewItem {
  label: string;
  text: string;
}

export interface GeneratedPlanOfCarePreviewSection {
  heading: string;
  body: string;
  items: GeneratedPlanOfCarePreviewItem[];
}

export interface GeneratedPlanOfCareEvidenceSnippet {
  id: string;
  category: string;
  label: string;
  text: string;
  sourceLabel: string | null;
  sourceType: string | null;
}

export interface GeneratedPlanOfCareValidationFinding {
  severity: "warning" | "error";
  category: string;
  message: string;
  affectedProblem: string | null;
  affectedIntervention: string | null;
  action: "pruned" | "retained" | "added" | "blocked";
}

export interface GeneratedPlanOfCareDraft {
  status: string;
  finalPreviewStatus: string;
  generatedAt: string;
  questionBankVersion: string | null;
  reviewRequired: boolean;
  generationMode: string;
  sourceSummary: {
    oasisValidationTimestamp: string | null;
    oasisGateTimestamp: string | null;
    keyClinicalSignals: string[];
  };
  stageStatus: Record<string, { state: string; note: string | null }>;
  validationFindings: GeneratedPlanOfCareValidationFinding[];
  evidenceMap: {
    diagnoses: GeneratedPlanOfCareEvidenceSnippet[];
    medications: GeneratedPlanOfCareEvidenceSnippet[];
    woundFacts: GeneratedPlanOfCareEvidenceSnippet[];
    respiratoryFacts: GeneratedPlanOfCareEvidenceSnippet[];
    mobilityFacts: GeneratedPlanOfCareEvidenceSnippet[];
    cognitionFacts: GeneratedPlanOfCareEvidenceSnippet[];
    dysphagiaNutritionFacts: GeneratedPlanOfCareEvidenceSnippet[];
    cardiacFacts: GeneratedPlanOfCareEvidenceSnippet[];
    oasisChartFacts: GeneratedPlanOfCareEvidenceSnippet[];
    referralSkilledNeedFacts: GeneratedPlanOfCareEvidenceSnippet[];
  };
  consolidatedProblems: Array<{
    problem: string;
    domain: string;
    rationale: string;
    candidateProblemLabels: string[];
    supportingEvidenceIds: string[];
  }>;
  pocPreview: {
    title: string;
    patientSummary: string;
    sections: GeneratedPlanOfCarePreviewSection[];
    clinicalCautions: string[];
  };
  readablePlan: {
    title: string;
    summary: string;
    sections: GeneratedPlanOfCareReadableSection[];
  } | null;
  problems: GeneratedPlanOfCareProblem[];
  warnings: string[];
  diagnostics: {
    llmUsed: boolean;
    modelId: string | null;
    retrievedProblemCount: number;
    promptCharacterEstimate: number;
  };
}

export type OasisEvidenceMode =
  | "chart_read"
  | "printed_note_ocr"
  | "oasis_fact_pack"
  | "printed_note_review_section_fallback"
  | "unavailable";

export type ReferralComparisonOrigin =
  | "llm_referral_proposal"
  | "deterministic_referral_fallback"
  | "referral_qa_fallback"
  | "unavailable";

export interface ReviewerLlmStageSummary {
  stageKey: string;
  label: string;
  status: "llm_succeeded" | "fallback_used" | "not_attempted" | "validation_downgraded";
  statusLabel: string;
  llmUsed: boolean;
  fallbackUsed: boolean;
  validationDowngraded: boolean;
  modelId: string | null;
  note: string | null;
}

export interface ReviewerLlmDiagnosticsSummary {
  diagnosisExtraction: ReviewerLlmStageSummary;
  printedNoteExtraction: ReviewerLlmStageSummary;
  referralProposal: ReviewerLlmStageSummary;
  referralQaInsights: ReviewerLlmStageSummary;
  planOfCareGeneration: ReviewerLlmStageSummary;
}

export type ClinicalDiscrepancyInterpretation =
  | "not_available"
  | "no_actionable_discrepancies_detected"
  | "actionable_discrepancies_detected"
  | "insufficient_evidence"
  | "analysis_degraded";

export interface ClinicalDiscrepancyFinding {
  findingId: string;
  category: string;
  title: string;
  verdict: string;
  priority: string;
  severity: string;
  confidence: number;
  needsHumanReview: boolean;
  sourceSummary: string;
  oasisSummary: string;
  rationale: string;
  dateAssessment: {
    sourceDate?: string;
    oasisDate?: string;
    newerSide?: "source" | "oasis" | "unknown";
    recencyImpact: "none" | "low" | "medium" | "high";
  } | null;
  evidenceCount: number;
  sourceFactIds: string[];
  oasisFactIds: string[];
}

export interface ClinicalDiscrepancyReview {
  available: boolean;
  reviewerQueueInterpretation: ClinicalDiscrepancyInterpretation;
  llmStatus: string | null;
  generatedAt: string | null;
  totalFindings: number;
  reviewerVisibleCount: number;
  suppressedCount: number;
  reviewerQueueCount: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  highSeverityCount: number;
  needsReviewCount: number;
  sourceFactCount: number | null;
  oasisFactCount: number | null;
  clinicalContradictionAnalysisHash: string | null;
  sourceFactPackHash: string | null;
  oasisFactPackHash: string | null;
  topCategories: string[];
  topVerdicts: string[];
  topSuppressionReasons: string[];
  reviewerQueue: ClinicalDiscrepancyFinding[];
}

export interface DocumentationReview {
  available: boolean;
  status: string | null;
  artifactPaths: string[];
  summaryItems: Array<{ label: string; value: string }>;
  factCount: number;
  factCategories: string[];
  diagnosisCount: number;
  icdCodeCount: number;
  warningCount: number;
  warnings: string[];
  note: string | null;
}

export interface DiagnosisReconciliationReview {
  available: boolean;
  referralDiagnosisCount: number;
  oasisDiagnosisCount: number;
  matchedCount: number;
  missingInOasisCount: number;
  missingInReferralCount: number;
  codeMismatchCount: number;
  labelMismatchCount: number;
  rankMismatchCount: number;
  warningCount: number;
  warnings: string[];
}

export type PlanOfCareReviewStatus =
  | "unavailable"
  | "no_oasis_diagnoses"
  | "deterministic_candidate_draft"
  | "llm_tailored_draft"
  | "degraded_needs_review";

export interface PlanOfCareReviewItem {
  diagnosisKey: string;
  diagnosisLabel: string;
  icdCode: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  sourceHash?: string | null;
  capturedAt?: string | null;
  clinicalDomain: string | null;
  selectedCandidateDomain: string | null;
  domainMatchStatus: string | null;
  domainWarnings: string[];
  exclusionReason: string | null;
  unsupportedClaimDetected: boolean;
  unsupportedClaimType: string | null;
  unsupportedClaimText: string | null;
  evidenceRequired: string[];
  candidateRejectedReason: string | null;
  problemText: string;
  goalText: string;
  interventions: Array<{
    text: string;
    tailoredInstruction: string | null;
    confidence: number;
    evidenceFactIds: string[];
  }>;
  confidence: number;
  needsHumanReview: boolean;
  warningCount: number;
  evidenceFactCount: number;
}

export interface PlanOfCareGlobalIntervention {
  title: string;
  text: string;
  evidenceFactIds: string[];
  confidence: number;
  sourceDiagnosisKeys: string[];
}

export interface PlanOfCareProblemGroup {
  groupKey: string;
  sourceType?: string | null;
  sourceLabel?: string | null;
  sourceHash?: string | null;
  capturedAt?: string | null;
  clinicalDomain: string | null;
  domainMatchStatus: string | null;
  domainWarnings: string[];
  problemTitle: string;
  relatedDiagnoses: Array<{
    diagnosisKey: string | null;
    label: string;
    icdCode: string | null;
  }>;
  problemStatement: string;
  goals: Array<{
    text: string;
    measurableTarget: string | null;
    evidenceFactIds: string[];
    confidence: number;
    needsHumanReview: boolean;
  }>;
  interventions: Array<{
    text: string;
    rationale: string;
    evidenceFactIds: string[];
    confidence: number;
    needsHumanReview: boolean;
    bankEntryId: string | null;
    bankText: string | null;
    llmGenerated: boolean;
  }>;
  evidenceFactIds: string[];
  confidence: number;
  needsHumanReview: boolean;
  warnings: string[];
}

export interface PlanOfCareReview {
  available: boolean;
  status: PlanOfCareReviewStatus;
  generatedAt: string | null;
  diagnosisCount: number;
  draftedDiagnosisCount: number;
  needsReviewCount: number;
  lowConfidenceCount: number;
  missingCandidateCount: number;
  sourcePriorityUsed: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  sourceHash?: string | null;
  capturedAt?: string | null;
  llmStatus: string | null;
  llmErrorCategory?: string | null;
  promptDiagnosisCount?: number;
  promptTokenEstimate?: number;
  llmTailoredDiagnosisCount?: number;
  warnings: string[];
  globalInterventions?: PlanOfCareGlobalIntervention[];
  carePlanProblemGroups?: PlanOfCareProblemGroup[];
  draftItems: PlanOfCareReviewItem[];
}

export interface VisitNotesReview {
  available: boolean;
  status:
    | "ready"
    | "partial"
    | "pending"
    | "degraded"
    | "discovery_missing"
    | "discovery_not_run"
    | "no_eligible_notes"
    | "capture_pending_due_to_config_limit"
    | "capture_failed";
  generatedAt: string | null;
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
  actionableFindingCount: number;
  contradictionCount: number;
  positiveProgressCount: number;
  possibleUpdateNeededCount: number;
  pocAlignmentIssueCount: number;
  incompleteNoteCount: number;
  byVisitType: Record<string, number>;
  byStatus: Record<string, number>;
  visitTypeCounts: Array<{
    visitType: string;
    count: number;
    statuses: Record<string, number>;
  }>;
  visitTypeStatusMatrix: Array<{
    visitType: string;
    count: number;
    statuses: Record<string, number>;
  }>;
  findings: Array<{
    findingId: string;
    visitNoteKey: string;
    visitType: string;
    visitDate: string | null;
    severity: string;
    category: string;
    title: string;
    description: string;
    suggestedReviewerAction: string;
    needsHumanReview: boolean;
    confidence: number;
    evidenceCount: number;
  }>;
  noteSummaries: Array<{
    visitNoteKey: string;
    visitType: string;
    visitDate: string | null;
    status: string;
    lifecycleStatus: string | null;
    captureStatus: string | null;
    analyzed: boolean;
    analysisStatus: string;
    completionStatus: string;
    completionReasons: string[];
    mappingStatus: string | null;
    matchStrength: number | null;
    summary: string;
    missingFields: string[];
    textInputSuggestions: Array<{
      suggestionId: string;
      visitNoteKey: string;
      fieldKey: string | null;
      fieldLabel: string;
      sectionLabel: string | null;
      currentValue: string | null;
      reason: string;
      relatedPocProblemTitle: string | null;
      suggestedInput: string;
      sourceFactIds: string[];
      confidence: number;
    }>;
    alignedPocGoals: string[];
    pocMappingResult?: {
      mappingStatus: string | null;
      mappingSource: string | null;
      alignmentStatus: string;
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
    pocProblemMatches: Array<{
      problemKey: string;
      problemTitle: string;
      problemStatement: string | null;
      interventionTexts: string[];
      matchedFactIds: string[];
      confidence: number;
      rationale: string;
    }>;
    possibleContradictions: string[];
  }>;
  warnings: string[];
}

export type PatientDashboardDisplayStatus =
  | "match"
  | "equivalent_match"
  | "mismatch"
  | "missing_in_portal"
  | "missing_in_referral"
  | "uncertain"
  | "coding_review";

export type PatientDashboardVisibilityDecision =
  | "show"
  | "hidden_match"
  | "hidden_resolved"
  | "hidden_missing_chart_value"
  | "hidden_missing_document_value"
  | "hidden_filtered_by_default";

export interface PatientDashboardFieldRow {
  fieldKey: string;
  fieldLabel: string;
  sectionKey: string;
  sectionLabel: string;
  sourceSectionLabel: string;
  reviewMode: string;
  qaPriority: "critical" | "high" | "medium" | "low";
  oasisItemId: string | null;
  backendComparisonStatus: string;
  backendWorkflowState: string;
  displayStatus: PatientDashboardDisplayStatus;
  comparisonResult: PatientDashboardDisplayStatus;
  documentSupportedValue: unknown;
  currentChartValue: unknown;
  normalizedDocumentValue: string | null;
  normalizedChartValue: string | null;
  currentChartValueSource: string;
  currentChartValueSourceLabel: string;
  oasisEvidenceMode: OasisEvidenceMode;
  oasisEvidenceLabel: string;
  displayReferralValue: string;
  displayPortalValue: string;
  shortReason: string;
  reviewStatus: string;
  qaResultLabel: string;
  qaActionLabel: string;
  referralComparisonOrigin: ReferralComparisonOrigin;
  referralComparisonOriginLabel: string;
  confidence: "high" | "medium" | "low" | "uncertain";
  sourceSupportStrength: "strong" | "moderate" | "weak" | "none";
  mappingStrength: "strong" | "moderate" | "weak";
  referralSnippet: string | null;
  portalSnippet: string | null;
  evidence: Array<{
    id: string;
    sourceType: string;
    sourceLabel: string;
    snippet: string | null;
    confidence: "high" | "medium" | "low" | "uncertain";
    confidenceLabel: string;
    pageHint: number | null;
  }>;
  shownByDefault: boolean;
  visibilityDecision: PatientDashboardVisibilityDecision;
  visibilityReason: string;
  strictnessFlags: string[];
  sourceArtifacts: string[];
  referralDocumentIds?: string[];
  oasisAssessmentId?: string | null;
  valuePresence: {
    hasDocumentValue: boolean;
    hasChartValue: boolean;
    hasPrintedNoteChartValue: boolean;
    printedNoteSectionKey: string | null;
    printedNoteSectionStatus: string | null;
    printedNoteReviewSource: string | null;
  };
}

export interface PatientDashboardVisibilitySummary {
  totalRows: number;
  shownRows: number;
  hiddenRows: number;
  hiddenByReason: Record<string, number>;
  potentiallyTooStrictRows: string[];
}

export interface PatientReferralIntakeStatus {
  status: string;
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
  statusUrl: string | null;
  message: string | null;
}

export interface ReferralIntakeStartResponse {
  batchId: string;
  patientId: string;
  status: string;
  acceptedAt: string | null;
  statusUrl: string | null;
  message: string | null;
}

export interface ReferralOasisSourceDocument {
  id: string;
  title: string;
  date: string | null;
  sourcePath: string | null;
  sourceLabel: string | null;
  status: string;
  extractionUsabilityStatus: string | null;
  artifactDirectory: string | null;
  error: string | null;
  diagnosisSummary?: DiagnosisSummaryBlock | null;
  medicationSummary?: MedicationSummaryBlock | null;
}

export interface ReferralOasisAssessmentSource {
  id: string;
  title: string;
  date: string | null;
  source: string;
  status: string;
  assessmentType?: string | null;
  processingEligible?: boolean | null;
  isCurrent?: boolean;
  isMonitored?: boolean;
  diagnosisSummary?: DiagnosisSummaryBlock | null;
  medicationSummary?: MedicationSummaryBlock | null;
}

export interface ReferralOasisChangeFlag {
  id: string;
  kind: string;
  fieldKey: string;
  label: string;
  assessmentId: string | null;
  baselineAssessmentId: string | null;
  source: string;
}

export interface PatientReferralOasisSources {
  referralDocuments: ReferralOasisSourceDocument[];
  oasisAssessments: ReferralOasisAssessmentSource[];
  defaultReferralDocumentId: string | null;
  defaultOasisAssessmentId: string | null;
  baselineOasisAssessmentId: string | null;
  oasisChangeFlags: ReferralOasisChangeFlag[];
}

export interface PatientDashboardDetailState {
  rows: PatientDashboardFieldRow[];
  comparisonRowsStatus?: "pending" | "ready";
  comparisonRowsReason?: string | null;
  comparisonRowsRowCount?: number;
  visibilitySummary: PatientDashboardVisibilitySummary;
  sourceCoverage: {
    printedNoteReviewSource: string | null;
    printedNoteCompletedSectionCount: number;
    printedNoteChartValueCount: number;
    fieldLevelValueCount: number;
    sectionEvidenceFallbackRowCount: number;
  };
  referralIntakeStatus?: PatientReferralIntakeStatus;
  referralOasisSources?: PatientReferralOasisSources;
}

export interface PatientDashboardReviewSummary {
  severity: "green" | "yellow" | "red";
  openRowCount: number;
  shownRowCount: number;
  hiddenRowCount: number;
  mismatchCount: number;
  missingInPortalCount: number;
  missingInReferralCount: number;
  uncertainCount: number;
  codingReviewCount: number;
  resolvedCount: number;
  highPriorityOpenCount: number;
  potentiallyTooStrictCount: number;
}

export interface PatientChangeSummary {
  hasNewInformation: boolean;
  comparedToGeneratedAt: string | null;
  detectedAt: string;
  reasons: string[];
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
  diagnosisSource: string | null;
  referralDiagnosisSummary: DiagnosisSummaryBlock;
  oasisDiagnosisSummary: DiagnosisSummaryBlock;
  diagnosisComparisonStatus: DiagnosisComparisonStatus;
  referralMedicationSummary: MedicationSummaryBlock | null;
  oasisMedicationSummary: MedicationSummaryBlock | null;
  runMode: "read_only";
  rerunEnabled: boolean;
  lastRunAt: string | null;
  nextScheduledRunAt: string | null;
  codingWorkflow: WorkflowTrackSummary | null;
  qaWorkflow: WorkflowTrackSummary | null;
  qaPrefetch: QaPrefetchSummary | null;
  oasisValidation: OasisValidationSummary | null;
  referralOasisConsistency: ReferralOasisConsistencySummary | null;
  oasisGate: OasisGateSummary | null;
  oasisValidatedForPlanOfCare: boolean;
  generatedPlanOfCare: GeneratedPlanOfCareDraft | null;
  generatedPlanOfCareStatus: string;
  planOfCareReview: PlanOfCareReview;
  visitNotesReview: VisitNotesReview;
  oasisDocumentationReview: DocumentationReview;
  referralDocumentationReview: DocumentationReview;
  diagnosisReconciliationReview: DiagnosisReconciliationReview;
  reviewerDiagnostics: ReviewerLlmDiagnosticsSummary | null;
  clinicalDiscrepancyReview: ClinicalDiscrepancyReview;
  referralQa: ReferralQaSummary;
  dashboardReview: PatientDashboardReviewSummary;
  changeSummary: PatientChangeSummary | null;
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
  dashboardState: PatientDashboardDetailState;
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
  diagnosisSource: string | null;
  referralDiagnosisSummary: DiagnosisSummaryBlock;
  oasisDiagnosisSummary: DiagnosisSummaryBlock;
  diagnosisComparisonStatus: DiagnosisComparisonStatus;
  referralMedicationSummary: MedicationSummaryBlock | null;
  oasisMedicationSummary: MedicationSummaryBlock | null;
  runMode: "read_only";
  rerunEnabled: boolean;
  lastRunAt: string | null;
  nextScheduledRunAt: string | null;
  lastUpdatedAt: string;
  codingWorkflow: WorkflowTrackSummary | null;
  qaWorkflow: WorkflowTrackSummary | null;
  qaPrefetch: QaPrefetchSummary | null;
  oasisValidation: OasisValidationSummary | null;
  referralOasisConsistency: ReferralOasisConsistencySummary | null;
  oasisGate: OasisGateSummary | null;
  generatedPlanOfCare: GeneratedPlanOfCareDraft | null;
  generatedPlanOfCareStatus: string;
  reviewerDiagnostics: ReviewerLlmDiagnosticsSummary | null;
  referralQa: ReferralQaSummary;
}
