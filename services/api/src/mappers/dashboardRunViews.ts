import type {
  ClinicalContradictionAnalysis,
  ClinicalContradictionFinding,
  ClinicalComparisonRow,
  PlanOfCareReviewDraftArtifact,
  PatientQaReference,
  PatientEpisodeWorkItem,
  PatientRunCacheSummary,
} from "@medical-ai-qa/shared-types";
import {
  extractPortalPatientLookupContext,
  patientRunCacheSummarySchema,
} from "@medical-ai-qa/shared-types";
import type { BatchRecord } from "../types/batchControlPlane";
import {
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
} from "./controlPlaneViews";

type KnownArtifactContents = {
  codingInput: unknown | null;
  documentText: unknown | null;
  documentFactPack?: unknown | null;
  documentCatalog?: unknown | null;
  qaPrefetch: unknown | null;
  patientQaReference: unknown | null;
  qaDocumentSummary: unknown | null;
  fieldMapSnapshot: unknown | null;
  referralIntakeState?: unknown | null;
  referralSourceDocumentsManifest?: unknown | null;
  referralDocumentResultsManifest?: unknown | null;
  referralDocumentArtifacts?: unknown | null;
  patientPortalStatusSnapshot?: unknown | null;
  printedNoteChartValues: unknown | null;
  printedNoteReview: unknown | null;
  oasisDomExtractedState?: unknown | null;
  oasisDomAcquisitionState?: unknown | null;
  oasisDomComparison?: unknown | null;
  clinicalComparisonRows?: unknown | null;
  artifactLineage?: unknown | null;
  clinicalContradictionAnalysis?: unknown | null;
  sourceClinicalFactPack?: unknown | null;
  oasisClinicalFactPack?: unknown | null;
  oasisDiagnosisExtraction?: unknown | null;
  referralDiagnosisExtraction?: unknown | null;
  referralExtractedFacts?: unknown | null;
  diagnosisReconciliation?: unknown | null;
  clinicalFactPackManifest?: unknown | null;
  oasisExtractionCoverageReport?: unknown | null;
  planOfCareDiagnosisSource?: unknown | null;
  planOfCareCandidates?: unknown | null;
  planOfCareReviewDraft?: unknown | null;
  planOfCareReviewSummary?: unknown | null;
  visitNotesDiscovery?: unknown | null;
  visitNoteProcessingManifest?: unknown | null;
  visitNoteFactPack?: unknown | null;
  visitNoteQaReview?: unknown | null;
  comparisonRowsStatus?: unknown | null;
  comparisonRowsReason?: unknown | null;
  comparisonRowsRowCount?: unknown | null;
  llmUsageAudit?: unknown | null;
  oasisValidation?: unknown | null;
  referralOasisConsistency?: unknown | null;
  oasisGate?: unknown | null;
  generatedPlanOfCare?: unknown | null;
  oasisDomSectionProcessingManifest?: unknown | null;
  oasisDomSectionOutputs?: unknown | null;
  oasisAssessmentProcessingManifest?: unknown | null;
  oasisAssessmentArtifacts?: unknown | null;
  patientRunCacheSummary?: unknown | null;
};

type DashboardDiscrepancyRating = "green" | "yellow" | "red";
type DashboardComparisonResult =
  | "match"
  | "equivalent_match"
  | "mismatch"
  | "missing_in_portal"
  | "missing_in_referral"
  | "uncertain"
  | "coding_review";
type DashboardVisibilityDecision =
  | "show"
  | "hidden_match"
  | "hidden_resolved"
  | "hidden_missing_chart_value"
  | "hidden_missing_document_value"
  | "hidden_filtered_by_default";

type PatientViewInput = {
  batch: BatchRecord;
  summary: BatchRecord["patientRuns"][number];
  workItem: PatientEpisodeWorkItem | null;
  changeSummary?: import("@medical-ai-qa/shared-types").PatientDashboardChangeSummary | null;
  artifactContents: KnownArtifactContents;
};

type DashboardDiagnosisSource =
  | "coding_input"
  | "document_fact_pack"
  | "source_clinical_fact_pack"
  | "oasis_clinical_fact_pack"
  | "portal_dom_state"
  | "no_usable_referral_diagnosis_fact"
  | "no_usable_oasis_diagnosis_fact"
  | "insufficient_structured_diagnosis_evidence"
  | "qa_visible_diagnoses";

type DashboardDiagnosisComparisonStatus =
  | "aligned"
  | "partial_overlap"
  | "conflict"
  | "missing_referral"
  | "missing_oasis"
  | "unavailable";

type DashboardDiagnosisEntry = {
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
};

type DashboardDiagnosisSummary = {
  primaryDiagnosis: DashboardDiagnosisEntry | null;
  otherDiagnoses: DashboardDiagnosisEntry[];
  diagnosisSource: DashboardDiagnosisSource | null;
};

type DashboardMedicationEntry = {
  name: string;
  dose: string | null;
  route: string | null;
  classification: string | null;
  startDate: string | null;
  status: string | null;
  source: string | null;
};

type DashboardAllergyEntry = {
  name: string;
  reaction: string | null;
  startDate: string | null;
  status: string | null;
  source: string | null;
};

type DashboardMedicationSummary = {
  medications: DashboardMedicationEntry[];
  allergies: DashboardAllergyEntry[];
  medicationSource: "direct_document_referral" | "document_fact_pack" | "portal_dom_state" | null;
};

type DashboardOasisEvidenceMode =
  | "chart_read"
  | "portal_dom_state"
  | "oasis_fact_pack"
  | "unavailable";

type DashboardReferralComparisonOrigin =
  | "llm_referral_proposal"
  | "deterministic_referral_fallback"
  | "referral_qa_fallback"
  | "unavailable";

type DashboardReviewerLlmStageSummary = {
  stageKey: string;
  label: string;
  status: "llm_succeeded" | "fallback_used" | "not_attempted" | "validation_downgraded";
  statusLabel: string;
  llmUsed: boolean;
  fallbackUsed: boolean;
  validationDowngraded: boolean;
  modelId: string | null;
  note: string | null;
};

type DashboardClinicalDiscrepancyFinding = {
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
  dateAssessment: ClinicalContradictionFinding["dateAssessment"] | null;
  evidenceCount: number;
  sourceFactIds: string[];
  oasisFactIds: string[];
};

type DashboardClinicalDiscrepancyReview = {
  available: boolean;
  reviewerQueueInterpretation:
    | "no_actionable_discrepancies_detected"
    | "actionable_discrepancies_detected"
    | "insufficient_evidence"
    | "analysis_degraded"
    | "not_available";
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
  reviewerQueue: DashboardClinicalDiscrepancyFinding[];
};

type DashboardDocumentationReview = {
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
};

type DashboardDiagnosisReconciliationReview = {
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
};

type DashboardPlanOfCareReviewItem = {
  diagnosisKey: string;
  diagnosisLabel: string;
  icdCode: string | null;
  sourceType: string | null;
  sourceLabel: string | null;
  sourceHash: string | null;
  capturedAt: string | null;
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
};

type DashboardPlanOfCareGlobalIntervention = {
  title: string;
  text: string;
  evidenceFactIds: string[];
  confidence: number;
  sourceDiagnosisKeys: string[];
};

type DashboardPlanOfCareProblemGroup = {
  groupKey: string;
  sourceType: string | null;
  sourceLabel: string | null;
  sourceHash: string | null;
  capturedAt: string | null;
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
};

type DashboardPlanOfCareReview = {
  available: boolean;
  status:
    | "unavailable"
    | "no_oasis_diagnoses"
    | "deterministic_candidate_draft"
    | "llm_tailored_draft"
    | "degraded_needs_review";
  generatedAt: string | null;
  diagnosisCount: number;
  draftedDiagnosisCount: number;
  needsReviewCount: number;
  lowConfidenceCount: number;
  missingCandidateCount: number;
  sourcePriorityUsed: string | null;
  sourceType: string | null;
  sourceLabel: string | null;
  sourceHash: string | null;
  capturedAt: string | null;
  llmStatus: string | null;
  llmErrorCategory?: string | null;
  promptDiagnosisCount?: number;
  promptTokenEstimate?: number;
  llmTailoredDiagnosisCount?: number;
  warnings: string[];
  globalInterventions: DashboardPlanOfCareGlobalIntervention[];
  carePlanProblemGroups: DashboardPlanOfCareProblemGroup[];
  draftItems: DashboardPlanOfCareReviewItem[];
};

function emptyPlanOfCareReview(warnings: string[] = []): DashboardPlanOfCareReview {
  return {
    available: false,
    status: "unavailable",
    generatedAt: null,
    diagnosisCount: 0,
    draftedDiagnosisCount: 0,
    needsReviewCount: 0,
    lowConfidenceCount: 0,
    missingCandidateCount: 0,
    sourcePriorityUsed: null,
    sourceType: null,
    sourceLabel: null,
    sourceHash: null,
    capturedAt: null,
    llmStatus: null,
    llmErrorCategory: null,
    promptDiagnosisCount: 0,
    promptTokenEstimate: 0,
    llmTailoredDiagnosisCount: 0,
    warnings,
    globalInterventions: [],
    carePlanProblemGroups: [],
    draftItems: [],
  };
}

type DashboardVisitNotesReview = {
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
};

function emptyVisitNotesReview(warnings: string[] = []): DashboardVisitNotesReview {
  return {
    available: false,
    status: "discovery_not_run",
    generatedAt: null,
    totalVisitNotes: 0,
    eligibleVisitNotes: 0,
    analyzedVisitNotes: 0,
    skippedVisitNotes: 0,
    missedVisitNotes: 0,
    notStartedVisitNotes: 0,
    activeMonitoringCount: 0,
    qaCompleteFinalizedCount: 0,
    inProgressCount: 0,
    submittedCount: 0,
    qaPendingCount: 0,
    signedCount: 0,
    capturedVisitNotes: 0,
    reusedVisitNotes: 0,
    failedVisitNotes: 0,
    degradedVisitNotes: 0,
    cappedVisitNotes: 0,
    actionableFindingCount: 0,
    contradictionCount: 0,
    positiveProgressCount: 0,
    possibleUpdateNeededCount: 0,
    pocAlignmentIssueCount: 0,
    incompleteNoteCount: 0,
    byVisitType: {},
    byStatus: {},
    visitTypeCounts: [],
    visitTypeStatusMatrix: [],
    findings: [],
    noteSummaries: [],
    warnings,
  };
}

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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactLowerText(...values: unknown[]): string {
  return values
    .map((value) => asString(value) ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const REFERRAL_DOCUMENT_TYPE_PATTERN = /\b(?:referral|intake|admission\s+order|physician\s+order|order\s+summary|admission\s+packet|discharge\s+summary|medication\s+profile|lab|diagnostic)\b/i;
const NON_REFERRAL_DOCUMENT_TYPE_PATTERN = /\b(?:visit\s+note|skilled\s+nursing\s+visit|therapy\s+visit|oasis|plan\s+of\s+care|\bpoc\b)\b/i;

function isReferralCatalogRecord(document: Record<string, unknown>): boolean {
  const type = compactLowerText(document.normalizedType);
  return [
    "referral",
    "admission_order",
    "discharge_summary",
    "medication_profile",
    "lab",
  ].includes(type);
}

function isReferralSourceDocumentRecord(document: Record<string, unknown>): boolean {
  const explicitType = compactLowerText(document.type);
  if (explicitType === "order") {
    return true;
  }
  if (["oasis", "poc", "visit_note"].includes(explicitType)) {
    return false;
  }

  const text = compactLowerText(document.portalLabel, document.sourcePath, document.documentCacheKey);
  if (!text || NON_REFERRAL_DOCUMENT_TYPE_PATTERN.test(text)) {
    return false;
  }
  return REFERRAL_DOCUMENT_TYPE_PATTERN.test(text);
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function isPatientQaReference(value: unknown): value is PatientQaReference {
  const record = asRecord(value);
  return Boolean(
    record &&
      Array.isArray(record.fieldRegistry) &&
      Array.isArray(record.referralDashboardSections) &&
      Array.isArray(record.qaReviewQueue) &&
      asRecord(record.comparisonResults),
  );
}

function countPatientsByStatus(batch: BatchRecord) {
  const totalWorkItems = batch.parse.workItemCount || batch.patientRuns.length;
  const totalCompleted = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "COMPLETE").length;
  const totalBlocked = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "BLOCKED").length;
  const totalFailed = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "FAILED").length;
  const totalNeedsHumanReview = batch.patientRuns.filter(
    (patientRun) => patientRun.processingStatus === "NEEDS_HUMAN_REVIEW",
  ).length;
  const currentlyRunningCount = batch.patientRuns.filter((patientRun) =>
    ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      patientRun.processingStatus,
    ),
  ).length;
  const processedCount = totalCompleted + totalBlocked + totalFailed + totalNeedsHumanReview;

  return {
    totalWorkItems,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalNeedsHumanReview,
    currentlyRunningCount,
    percentComplete:
      totalWorkItems === 0 ? 0 : Math.round((processedCount / totalWorkItems) * 100),
  };
}

function isClinicalContradictionAnalysis(value: unknown): value is ClinicalContradictionAnalysis {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.schemaVersion === "clinical-contradiction-analysis.v1" &&
      Array.isArray(record.findings) &&
      Array.isArray(record.reviewerQueue) &&
      asRecord(record.summary),
  );
}

function countRecordTopKeys(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return Object.entries(record)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([key]) => key);
}

function toClinicalDiscrepancyFinding(
  finding: ClinicalContradictionFinding,
): DashboardClinicalDiscrepancyFinding {
  return {
    findingId: finding.findingId,
    category: finding.category,
    title: finding.title,
    verdict: finding.verdict,
    priority: finding.priority,
    severity: finding.severity,
    confidence: finding.confidence,
    needsHumanReview: finding.needsHumanReview,
    sourceSummary: finding.sourceSummary,
    oasisSummary: finding.oasisSummary,
    rationale: finding.rationale,
    dateAssessment: finding.dateAssessment ?? null,
    evidenceCount: finding.evidence.length,
    sourceFactIds: finding.sourceFacts.map((fact) => fact.factId),
    oasisFactIds: finding.oasisFacts.map((fact) => fact.factId),
  };
}

function deriveClinicalDiscrepancyReview(
  artifactContents: KnownArtifactContents,
): DashboardClinicalDiscrepancyReview {
  const analysis = isClinicalContradictionAnalysis(artifactContents.clinicalContradictionAnalysis)
    ? artifactContents.clinicalContradictionAnalysis
    : null;
  const lineage = asRecord(artifactContents.artifactLineage);
  if (!analysis) {
    return {
      available: false,
      reviewerQueueInterpretation: "not_available",
      llmStatus: null,
      generatedAt: null,
      totalFindings: 0,
      reviewerVisibleCount: 0,
      suppressedCount: 0,
      reviewerQueueCount: 0,
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      highSeverityCount: 0,
      needsReviewCount: 0,
      sourceFactCount: asNumber(lineage?.sourceFactCount),
      oasisFactCount: asNumber(lineage?.oasisFactCount),
      clinicalContradictionAnalysisHash: asString(lineage?.clinicalContradictionAnalysisHash),
      sourceFactPackHash: asString(lineage?.sourceFactPackHash),
      oasisFactPackHash: asString(lineage?.oasisFactPackHash),
      topCategories: [],
      topVerdicts: [],
      topSuppressionReasons: countRecordTopKeys(lineage?.contradictionSuppressionReasonCounts),
      reviewerQueue: [],
    };
  }

  return {
    available: true,
    reviewerQueueInterpretation: analysis.reviewerQueueInterpretation,
    llmStatus: analysis.llmStatus,
    generatedAt: analysis.generatedAt,
    totalFindings: analysis.findingCount,
    reviewerVisibleCount: analysis.reviewerVisibleCount,
    suppressedCount: analysis.suppressedCount,
    reviewerQueueCount: analysis.reviewerQueue.length,
    highPriorityCount: analysis.summary.highPriorityCount,
    mediumPriorityCount: analysis.summary.mediumPriorityCount,
    highSeverityCount: analysis.highSeverityCount,
    needsReviewCount: analysis.needsReviewCount,
    sourceFactCount: asNumber(lineage?.sourceFactCount),
    oasisFactCount: asNumber(lineage?.oasisFactCount),
    clinicalContradictionAnalysisHash: asString(lineage?.clinicalContradictionAnalysisHash),
    sourceFactPackHash: analysis.sourceFactPackHash,
    oasisFactPackHash: analysis.oasisFactPackHash,
    topCategories: analysis.summary.topCategories,
    topVerdicts: analysis.summary.topVerdicts,
    topSuppressionReasons: countRecordTopKeys(lineage?.contradictionSuppressionReasonCounts),
    reviewerQueue: analysis.reviewerQueue.map(toClinicalDiscrepancyFinding),
  };
}

function isPlanOfCareReviewDraft(value: unknown): value is PlanOfCareReviewDraftArtifact {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.schemaVersion === "plan-of-care-review-draft.v1" &&
      Array.isArray(record.diagnosisDrafts) &&
      asRecord(record.summary),
  );
}

function deriveOasisDocumentationReview(artifactContents: KnownArtifactContents): DashboardDocumentationReview {
  const qaPrefetch = asRecord(artifactContents.qaPrefetch);
  const assessmentNote = asRecord(qaPrefetch?.assessmentNote);
  const diagnosisRoute = asRecord(qaPrefetch?.diagnosisRoute);
  const oasisDomState = asRecord(artifactContents.oasisDomExtractedState);
  const oasisDomCoverage = asRecord(oasisDomState?.coverage);
  const oasisDomDiagnostics = asRecord(oasisDomState?.diagnostics);
  const oasisDomSections = getOasisDomSections(artifactContents);
  const oasisDomFields = getMeaningfulOasisDomFields(artifactContents);
  const sectionOutputs = asRecord(artifactContents.oasisDomSectionOutputs);
  const sectionOutputSummary = asRecord(sectionOutputs?.summary);
  const oasisFactPack = asRecord(artifactContents.oasisClinicalFactPack);
  const oasisDiagnosisExtraction = asRecord(artifactContents.oasisDiagnosisExtraction);
  const extractedDiagnoses = asArray(oasisDiagnosisExtraction?.diagnoses);
  const facts = asArray(oasisFactPack?.facts)
    .map(asRecord)
    .filter((fact): fact is Record<string, unknown> => Boolean(fact));
  const categories = Array.from(new Set(facts.map((fact) => asString(fact?.category)).filter((value): value is string => Boolean(value)))).sort();
  const diagnosisCount = asNumber(oasisDiagnosisExtraction?.diagnosisCount) ??
    facts.filter((fact) => asString(fact?.category) === "diagnosis").length;
  const icdCodeCount = extractedDiagnoses.length > 0
    ? extractedDiagnoses.filter((entry) => Boolean(asString(asRecord(entry)?.icdCode))).length
    : facts.filter((fact) => asString(fact?.category) === "icd_code").length;
  const warnings = [
    ...asArray(qaPrefetch?.warnings).map(asString).filter((value): value is string => Boolean(value)).slice(0, 4),
  ];
  const episodeSelection = asRecord(qaPrefetch?.episodeSelection);
  const selectedEpisodeRange = asRecord(episodeSelection?.selectedRange);
  const selectedEpisode = asString(selectedEpisodeRange?.rawLabel) ??
    asString(asRecord(qaPrefetch?.billingCalendarSummary)?.selectedEpisodeRange);
  return {
    available: Boolean(qaPrefetch || facts.length > 0 || oasisDomState),
    status: oasisDomState
      ? (asString(oasisDomCoverage?.confidence) ?? "dom_state_primary")
      : asString(qaPrefetch?.status),
    artifactPaths: [
      ...(qaPrefetch ? ["qa-prefetch-result.json"] : []),
      ...(oasisDomState ? ["oasis-dom-extracted-state.json"] : []),
      ...(artifactContents.oasisDomAcquisitionState ? ["oasis-dom-acquisition-state.json"] : []),
      ...(artifactContents.oasisDomComparison ? ["oasis-dom-vs-existing-extraction-comparison.json"] : []),
      ...(artifactContents.oasisDomSectionProcessingManifest ? ["oasis-dom-section-processing-manifest.json"] : []),
      ...(artifactContents.oasisDomSectionOutputs ? ["oasis-dom-section-outputs.json"] : []),
      ...(oasisDiagnosisExtraction ? ["oasis-diagnosis-extraction.json"] : []),
      ...(oasisFactPack ? ["oasis-clinical-fact-pack.json"] : []),
      ...(artifactContents.oasisExtractionCoverageReport ? ["oasis-extraction-coverage-report.json"] : []),
    ],
    summaryItems: [
      { label: "Assessment", value: asString(assessmentNote?.matchedAssessmentLabel) ?? asString(assessmentNote?.assessmentType) ?? "Not available" },
      { label: "Selected Episode", value: selectedEpisode ?? "Not available" },
      { label: "DOM Sections", value: String(asNumber(oasisDomCoverage?.sectionCount) ?? oasisDomSections.length) },
      { label: "Completed Sections", value: String(oasisDomState
        ? oasisDomSections.filter((section) => !/^failed|degraded$/i.test(section.status)).length
        : 0) },
      { label: "Field Values Captured", value: String(oasisDomFields.length) },
      ...(sectionOutputs
        ? [
            { label: "Section Outputs", value: String(asNumber(sectionOutputSummary?.totalSections) ?? asArray(sectionOutputs.sections).length) },
            { label: "Section LLM Processed", value: String(asNumber(sectionOutputSummary?.processedSections) ?? 0) },
            { label: "Section Outputs Reused", value: String(asNumber(sectionOutputSummary?.reusedSections) ?? 0) },
          ]
        : []),
      { label: "Visible OASIS Diagnoses", value: String(diagnosisCount || asArray(diagnosisRoute?.visibleDiagnoses).length || asArray(assessmentNote?.visibleDiagnoses).length) },
      ...(oasisDomState
        ? [
            { label: "DOM OCR Used", value: String(Boolean(oasisDomDiagnostics?.ocrUsed)) },
            { label: "DOM PDF Capture Used", value: String(Boolean(oasisDomDiagnostics?.pdfCaptureUsed)) },
          ]
        : []),
    ],
    factCount: facts.length,
    factCategories: categories,
    diagnosisCount,
    icdCodeCount,
    warningCount: warnings.length,
    warnings,
    note: diagnosisCount === 1
      ? "Only one OASIS-derived diagnosis was available in this artifact set."
      : null,
  };
}

function deriveReferralDocumentationReview(artifactContents: KnownArtifactContents): DashboardDocumentationReview {
  const patientQaReference = asRecord(artifactContents.patientQaReference);
  const qaDocumentSummary = asRecord(artifactContents.qaDocumentSummary);
  const documentText = asRecord(artifactContents.documentText);
  const documentFactPack = asRecord(artifactContents.documentFactPack);
  const documentCatalog = asRecord(artifactContents.documentCatalog);
  const sourceFactPack = asRecord(artifactContents.sourceClinicalFactPack);
  const referralDiagnosisExtraction = asRecord(artifactContents.referralDiagnosisExtraction);
  const extractedDiagnoses = asArray(referralDiagnosisExtraction?.diagnoses);
  const referralDocumentTextEntries = asArray(documentText?.documents)
    .map(asRecord)
    .filter((document): document is Record<string, unknown> => Boolean(document && isReferralSourceDocumentRecord(document)));
  const referralCatalogEntries = asArray(documentCatalog?.documents)
    .map(asRecord)
    .filter((document): document is Record<string, unknown> => Boolean(document && isReferralCatalogRecord(document)));
  const facts = asArray(sourceFactPack?.facts)
    .map(asRecord)
    .filter((fact): fact is Record<string, unknown> =>
      Boolean(fact && !/^visit_note$|^oasis$|^poc$/i.test(asString(fact?.sourceType) ?? "")));
  const categories = Array.from(new Set(facts.map((fact) => asString(fact?.category)).filter((value): value is string => Boolean(value)))).sort();
  const warnings = [
    ...asArray(qaDocumentSummary?.warnings).map(asString).filter((value): value is string => Boolean(value)).slice(0, 4),
    ...asArray(patientQaReference?.displayWarnings).map(asString).filter((value): value is string => Boolean(value)).slice(0, 4),
  ];
  return {
    available: Boolean(patientQaReference || referralDocumentTextEntries.length > 0 || documentFactPack || facts.length > 0),
    status: asString(qaDocumentSummary?.extractionUsabilityStatus) ?? asString(patientQaReference?.extractionUsabilityStatus),
    artifactPaths: [
      ...(documentCatalog ? ["document-catalog.json"] : []),
      ...(documentText ? ["document-text.json"] : []),
      ...(documentFactPack ? ["document-fact-pack.json"] : []),
      ...(patientQaReference ? ["referral-document-processing/patient-qa-reference.json"] : []),
      ...(qaDocumentSummary ? ["referral-document-processing/qa-document-summary.json"] : []),
      ...(referralDiagnosisExtraction ? ["referral-diagnosis-extraction.json"] : []),
      ...(sourceFactPack ? ["source-clinical-fact-pack.json"] : []),
    ],
    summaryItems: [
      { label: "Extraction Quality", value: asString(qaDocumentSummary?.extractionUsabilityStatus) ?? "Not available" },
      { label: "Catalog Documents", value: String(referralCatalogEntries.length) },
      { label: "Document Text Entries", value: String(referralDocumentTextEntries.length) },
      { label: "Referral Fields", value: String(asArray(patientQaReference?.fieldRegistry).length) },
      { label: "Comparison Fields", value: String(Object.keys(asRecord(patientQaReference?.comparisonResults) ?? {}).length) },
    ],
    factCount: facts.length,
    factCategories: categories,
    diagnosisCount: asNumber(referralDiagnosisExtraction?.diagnosisCount) ??
      facts.filter((fact) => asString(fact?.category) === "diagnosis").length,
    icdCodeCount: extractedDiagnoses.length > 0
      ? extractedDiagnoses.filter((entry) => Boolean(asString(asRecord(entry)?.icdCode))).length
      : facts.filter((fact) => asString(fact?.category) === "icd_code").length,
    warningCount: warnings.length,
    warnings,
    note: /^rejected$/i.test(asString(qaDocumentSummary?.extractionUsabilityStatus) ?? "")
      ? "Referral extraction was rejected for automated field promotion, but source artifacts and fact-pack evidence remain inspectable."
      : null,
  };
}

function deriveDiagnosisReconciliationReview(
  artifactContents: KnownArtifactContents,
): DashboardDiagnosisReconciliationReview {
  const reconciliation = asRecord(artifactContents.diagnosisReconciliation);
  return {
    available: reconciliation?.schemaVersion === "diagnosis-reconciliation.v1",
    referralDiagnosisCount: asNumber(reconciliation?.referralDiagnosisCount) ?? 0,
    oasisDiagnosisCount: asNumber(reconciliation?.oasisDiagnosisCount) ?? 0,
    matchedCount: asNumber(reconciliation?.matchedCount) ?? 0,
    missingInOasisCount: asNumber(reconciliation?.missingInOasisCount) ?? 0,
    missingInReferralCount: asNumber(reconciliation?.missingInReferralCount) ?? 0,
    codeMismatchCount: asNumber(reconciliation?.codeMismatchCount) ?? 0,
    labelMismatchCount: asNumber(reconciliation?.labelMismatchCount) ?? 0,
    rankMismatchCount: asNumber(reconciliation?.rankMismatchCount) ?? 0,
    warningCount: asArray(reconciliation?.warnings).length,
    warnings: asArray(reconciliation?.warnings).map(asString).filter((value): value is string => Boolean(value)).slice(0, 6),
  };
}

function deriveOasisValidatedForPlanOfCare(input: {
  artifactContents: KnownArtifactContents;
  oasisValidation: ReturnType<typeof deriveOasisValidationSummary>;
  oasisGate: ReturnType<typeof deriveOasisGateSummary>;
}): boolean {
  const validationStatus = input.oasisValidation?.status ?? null;
  const explicitValidationPassed = Boolean(
    validationStatus &&
      /(?:pass|passed|valid|validated|complete|completed)/i.test(validationStatus) &&
      !/(?:fail|failed|blocked|invalid)/i.test(validationStatus) &&
      (input.oasisValidation?.missingFieldCount ?? 0) === 0,
  );
  if (explicitValidationPassed) {
    return true;
  }

  const acquisition = asRecord(input.artifactContents.oasisDomAcquisitionState);
  const acquisitionStatus = asString(acquisition?.acquisitionStatus) ?? asString(acquisition?.status);
  const requiredSectionsMissing = asArray(acquisition?.missingRequiredSections).length > 0;
  const requiredFieldsMissing = asArray(acquisition?.missingRequiredFields).length > 0;
  const readinessReasons = asArray(acquisition?.readinessReasons)
    .map((value) => asString(value))
    .filter((value): value is string => value !== null);
  const domQaCompleted = Boolean(
    acquisition &&
      acquisitionStatus === "qa_completed" &&
      !requiredSectionsMissing &&
      !requiredFieldsMissing &&
      (readinessReasons.length === 0 || readinessReasons.includes("ready_for_qa")),
  );

  const gateBlocksPlanOfCare =
    Boolean(input.oasisGate?.blockedFromPlanOfCare) ||
    /(?:blocked|fail|failed)/i.test(input.oasisGate?.status ?? "");
  return domQaCompleted && !gateBlocksPlanOfCare;
}

function derivePlanOfCareReview(
  artifactContents: KnownArtifactContents,
  oasisValidatedForPlanOfCare: boolean,
): DashboardPlanOfCareReview {
  const draft = isPlanOfCareReviewDraft(artifactContents.planOfCareReviewDraft)
    ? artifactContents.planOfCareReviewDraft
    : null;
  const portalCarePlanAvailable =
    draft?.sourcePriorityUsed === "oasis_snapshot" &&
    (draft.carePlanProblemGroups?.length ?? 0) > 0;
  if (!oasisValidatedForPlanOfCare && !portalCarePlanAvailable) {
    return emptyPlanOfCareReview([
      "Plan of Care review is pending until OASIS is validated for Plan of Care generation.",
    ]);
  }

  if (!draft) {
    return emptyPlanOfCareReview();
  }
  const sourceType = draft.pocSource?.sourceType ??
    (draft.sourcePriorityUsed === "oasis_snapshot" ? "oasis_portal" : "generated_suggestion");
  const sourceLabel = draft.pocSource?.sourceLabel ??
    (sourceType === "oasis_portal" ? "From OASIS" : "Suggested");
  const sourceHash = draft.pocSource?.sourceHash ?? null;
  const capturedAt = draft.pocSource?.capturedAt ?? draft.generatedAt;
  const rawCarePlanProblemGroups = draft.carePlanProblemGroups ?? [];
  const hasPortalCarePlanGroups = rawCarePlanProblemGroups.length > 0;
  const status: DashboardPlanOfCareReview["status"] =
    draft.summary.diagnosisCount === 0 && !hasPortalCarePlanGroups
      ? "no_oasis_diagnoses"
      : draft.llmStatus === "success"
        ? "llm_tailored_draft"
        : draft.summary.needsReviewCount > 0 || draft.warnings.length > 0
          ? "degraded_needs_review"
          : "deterministic_candidate_draft";
  const mappedDraftItems: DashboardPlanOfCareReviewItem[] = draft.diagnosisDrafts.map((item) => ({
    diagnosisKey: item.diagnosisKey,
    diagnosisLabel: item.diagnosisLabel,
    icdCode: item.icdCode ?? null,
    sourceType: item.sourceType ?? sourceType,
    sourceLabel: item.sourceLabel ?? sourceLabel,
    sourceHash: item.sourceHash ?? sourceHash,
    capturedAt: item.capturedAt ?? capturedAt,
    clinicalDomain: item.clinicalDomain ?? null,
    selectedCandidateDomain: item.selectedCandidateDomain ?? null,
    domainMatchStatus: item.domainMatchStatus ?? null,
    domainWarnings: item.domainWarnings ?? [],
    exclusionReason: item.exclusionReason ?? null,
    unsupportedClaimDetected: Boolean(item.unsupportedClaimDetected),
    unsupportedClaimType: item.unsupportedClaimType ?? null,
    unsupportedClaimText: item.unsupportedClaimText ?? null,
    evidenceRequired: item.evidenceRequired ?? [],
    candidateRejectedReason: item.candidateRejectedReason ?? null,
    problemText: item.problem.selectedText,
    goalText: item.goal.selectedText,
    interventions: item.interventions.map((intervention) => ({
      text: intervention.selectedText,
      tailoredInstruction: intervention.tailoredInstruction ?? null,
      confidence: intervention.confidence,
      evidenceFactIds: intervention.evidenceFactIds,
    })),
    confidence: Math.min(item.problem.confidence, item.goal.confidence, ...item.interventions.map((entry) => entry.confidence)),
    needsHumanReview: item.needsHumanReview,
    warningCount: item.warnings.length,
    evidenceFactCount: Array.from(new Set([
      ...item.problem.evidenceFactIds,
      ...item.goal.evidenceFactIds,
      ...item.interventions.flatMap((entry) => entry.evidenceFactIds),
    ])).length,
  }));
  const visibleDraftItems = mappedDraftItems.filter((item) =>
    isPlausibleDashboardDiagnosisDescription(item.diagnosisLabel) ||
    Boolean(item.icdCode && isValidDashboardIcdCode(item.icdCode)));
  const suppressedDraftItemCount = mappedDraftItems.length - visibleDraftItems.length;
  const visibleStatus: DashboardPlanOfCareReview["status"] =
    visibleDraftItems.length === 0 && !hasPortalCarePlanGroups ? "no_oasis_diagnoses" : status;
  const visibleDraftWarnings = draft.warnings.filter((warning) =>
    !isDiagnosisNoise(warning) && !isLowValuePlanOfCareWarning(warning));
  const mappedCarePlanProblemGroups = rawCarePlanProblemGroups.map((group) => ({
    groupKey: group.groupKey,
    sourceType: group.sourceType ?? sourceType,
    sourceLabel: group.sourceLabel ?? sourceLabel,
    sourceHash: group.sourceHash ?? sourceHash,
    capturedAt: group.capturedAt ?? capturedAt,
    clinicalDomain: group.clinicalDomain ?? null,
    domainMatchStatus: group.domainMatchStatus ?? null,
    domainWarnings: group.domainWarnings ?? [],
    problemTitle: group.problemTitle,
    relatedDiagnoses: group.relatedDiagnoses.map((diagnosis) => ({
      diagnosisKey: diagnosis.diagnosisKey ?? null,
      label: diagnosis.label,
      icdCode: diagnosis.icdCode ?? null,
    })),
    problemStatement: group.problemStatement,
    goals: group.goals.map((goal) => ({
      text: goal.text,
      measurableTarget: goal.measurableTarget ?? null,
      evidenceFactIds: goal.evidenceFactIds,
      confidence: goal.confidence,
      needsHumanReview: goal.needsHumanReview,
    })),
    interventions: group.interventions.map((intervention) => ({
      text: intervention.text,
      rationale: intervention.rationale,
      evidenceFactIds: intervention.evidenceFactIds,
      confidence: intervention.confidence,
      needsHumanReview: intervention.needsHumanReview,
      bankEntryId: intervention.bankEntryId ?? null,
      bankText: intervention.bankText ?? null,
      llmGenerated: intervention.llmGenerated,
    })),
    evidenceFactIds: group.evidenceFactIds,
    confidence: group.confidence,
    needsHumanReview: group.needsHumanReview,
    warnings: group.warnings,
  }));
  return {
    available: true,
    status: visibleStatus,
    generatedAt: draft.generatedAt,
    diagnosisCount: visibleDraftItems.length,
    draftedDiagnosisCount: visibleDraftItems.length + mappedCarePlanProblemGroups.length,
    needsReviewCount:
      visibleDraftItems.filter((item) => item.needsHumanReview).length +
      mappedCarePlanProblemGroups.filter((group) => group.needsHumanReview).length,
    lowConfidenceCount: draft.summary.lowConfidenceCount,
    missingCandidateCount: visibleDraftItems.filter((item) => item.domainMatchStatus === "no_candidate" || item.exclusionReason).length,
    sourcePriorityUsed: draft.summary.sourcePriorityUsed,
    sourceType,
    sourceLabel,
    sourceHash,
    capturedAt,
    llmStatus: draft.llmStatus,
    llmErrorCategory: draft.llmErrorCategory ?? draft.summary.llmErrorCategory ?? null,
    promptDiagnosisCount: draft.promptDiagnosisCount ?? draft.summary.promptDiagnosisCount ?? 0,
    promptTokenEstimate: draft.promptTokenEstimate ?? draft.summary.promptTokenEstimate ?? 0,
    llmTailoredDiagnosisCount: draft.llmTailoredDiagnosisCount ?? draft.summary.llmTailoredDiagnosisCount ?? 0,
    warnings: [
      ...(suppressedDraftItemCount > 0
        ? [`Suppressed ${suppressedDraftItemCount} non-clinical diagnosis source item(s) from Plan of Care review.`]
        : []),
      ...visibleDraftWarnings,
    ].slice(0, 8),
    globalInterventions: (draft.globalInterventions ?? []).map((entry) => ({
      title: entry.title,
      text: entry.text,
      evidenceFactIds: entry.evidenceFactIds,
      confidence: entry.confidence,
      sourceDiagnosisKeys: entry.sourceDiagnosisKeys,
    })),
    carePlanProblemGroups: visibleDraftItems.length === 0 && suppressedDraftItemCount > 0 && !hasPortalCarePlanGroups
      ? []
      : mappedCarePlanProblemGroups,
    draftItems: visibleDraftItems,
  };
}

function deriveVisitNotesReview(
  artifactContents: KnownArtifactContents,
  planOfCareReview: DashboardPlanOfCareReview,
): DashboardVisitNotesReview {
  if (!planOfCareReview.available) {
    return emptyVisitNotesReview([
      "Visit Notes review is pending until Plan of Care review is available.",
      ...planOfCareReview.warnings.slice(0, 2),
    ]);
  }

  const review = asRecord(artifactContents.visitNoteQaReview);
  const summary = asRecord(review?.summary);
  const discovery = asRecord(artifactContents.visitNotesDiscovery);
  const discoveryRows = asArray(discovery?.rows).map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
  const discoveryCounts = asRecord(discovery?.counts);
  if (review?.schemaVersion !== "visit-note-qa-review.v1" || !summary) {
    const planOfCareDraft = isPlanOfCareReviewDraft(artifactContents.planOfCareReviewDraft)
      ? artifactContents.planOfCareReviewDraft
      : null;
    const waitingForPlanOfCare = !planOfCareDraft || planOfCareDraft.summary.diagnosisCount === 0;
    const totalDiscovered = asNumber(discoveryCounts?.total) ?? discoveryRows.length;
    const status: DashboardVisitNotesReview["status"] = discovery
      ? totalDiscovered === 0 ? "no_eligible_notes" : "pending"
      : waitingForPlanOfCare ? "discovery_not_run" : "discovery_missing";
    return {
      available: Boolean(discovery),
      status,
      generatedAt: null,
      totalVisitNotes: totalDiscovered,
      eligibleVisitNotes: 0,
      analyzedVisitNotes: 0,
      skippedVisitNotes: 0,
      missedVisitNotes: asNumber(asRecord(discoveryCounts?.byStatus)?.missed_visit) ?? 0,
      notStartedVisitNotes: asNumber(asRecord(discoveryCounts?.byStatus)?.not_started) ?? 0,
      activeMonitoringCount: discoveryRows.filter((row) => asString(row.lifecycleStatus) === "active_monitoring" || asString(row.captureEligibility) === "active_monitoring").length,
      qaCompleteFinalizedCount: discoveryRows.filter((row) => asString(row.lifecycleStatus) === "finalized_no_active_monitoring" || asString(row.captureEligibility) === "finalized_no_active_monitoring").length,
      inProgressCount: asNumber(asRecord(discoveryCounts?.byStatus)?.in_progress) ?? 0,
      submittedCount: asNumber(asRecord(discoveryCounts?.byStatus)?.submitted) ?? 0,
      qaPendingCount: (asNumber(asRecord(discoveryCounts?.byStatus)?.qa_pending) ?? 0) + (asNumber(asRecord(discoveryCounts?.byStatus)?.qa_review) ?? 0),
      signedCount: (asNumber(asRecord(discoveryCounts?.byStatus)?.signed) ?? 0) + (asNumber(asRecord(discoveryCounts?.byStatus)?.e_signed) ?? 0),
      capturedVisitNotes: discoveryRows.filter((row) => asString(row.captureStatus) === "captured").length,
      reusedVisitNotes: discoveryRows.filter((row) => asString(row.skipReason) === "manifest_indicates_capture_extraction_analysis_current").length,
      failedVisitNotes: discoveryRows.filter((row) => asString(row.captureStatus) === "failed").length,
      degradedVisitNotes: 0,
      cappedVisitNotes: discoveryRows.filter((row) => asString(row.captureStatus) === "capture_pending_due_to_config_limit").length,
      actionableFindingCount: 0,
      contradictionCount: 0,
      positiveProgressCount: 0,
      possibleUpdateNeededCount: 0,
      pocAlignmentIssueCount: 0,
      incompleteNoteCount: 0,
      byVisitType: asRecord(discoveryCounts?.byVisitType) as Record<string, number> ?? {},
      byStatus: asRecord(discoveryCounts?.byStatus) as Record<string, number> ?? {},
      visitTypeCounts: [],
      visitTypeStatusMatrix: [],
      findings: [],
      noteSummaries: [],
      warnings: discovery
        ? ["Visit Notes were discovered, but QA analysis is pending."]
        : [waitingForPlanOfCare
          ? "Visit Notes QA is pending until Plan of Care review completes and visit notes are discovered."
          : "Visit Notes discovery has not run yet."],
    };
  }

  const findings = asArray(review.findings).map(asRecord).filter((finding): finding is Record<string, unknown> => Boolean(finding));
  const noteSummaries = asArray(review.noteSummaries).map(asRecord).filter((note): note is Record<string, unknown> => Boolean(note));
  const rawStatus = asString(review.status) as DashboardVisitNotesReview["status"] | null;
  const syntheticPendingWithoutDiscovery =
    !discovery &&
    rawStatus === "pending" &&
    (asNumber(summary.totalVisitNotes) ?? 0) === 0 &&
    findings.length === 0 &&
    noteSummaries.length === 0;
  const failedCaptureCount = discoveryRows.filter((row) =>
    asString(row.captureStatus) === "failed" || /failed/i.test(asString(row.captureDecisionReason) ?? "")).length;
  const cappedCount = discoveryRows.filter((row) =>
    asString(row.captureStatus) === "capture_pending_due_to_config_limit" ||
    asString(row.captureDecisionReason) === "capture_pending_due_to_config_limit").length;
  const derivedStatus: DashboardVisitNotesReview["status"] = syntheticPendingWithoutDiscovery
    ? "discovery_missing"
    : cappedCount > 0
      ? "capture_pending_due_to_config_limit"
      : failedCaptureCount > 0 && (asNumber(summary.analyzedVisitNotes) ?? 0) === 0
        ? "capture_failed"
        : discovery && (asNumber(summary.totalVisitNotes) ?? discoveryRows.length) === 0
          ? "no_eligible_notes"
          : rawStatus ?? "partial";
  return {
    available: true,
    status: derivedStatus,
    generatedAt: asString(review.generatedAt),
    totalVisitNotes: asNumber(summary.totalVisitNotes) ?? 0,
    eligibleVisitNotes: asNumber(summary.eligibleVisitNotes) ?? 0,
    analyzedVisitNotes: asNumber(summary.analyzedVisitNotes) ?? 0,
    skippedVisitNotes: asNumber(summary.skippedVisitNotes) ?? 0,
    missedVisitNotes: asNumber(summary.missedVisitNotes) ?? 0,
    notStartedVisitNotes: asNumber(summary.notStartedVisitNotes) ?? 0,
    activeMonitoringCount: asNumber(summary.activeMonitoringCount) ?? discoveryRows.filter((row) => asString(row.lifecycleStatus) === "active_monitoring" || asString(row.captureEligibility) === "active_monitoring").length,
    qaCompleteFinalizedCount: asNumber(summary.qaCompleteFinalizedCount) ?? discoveryRows.filter((row) => asString(row.lifecycleStatus) === "finalized_no_active_monitoring" || asString(row.captureEligibility) === "finalized_no_active_monitoring").length,
    inProgressCount: asNumber(summary.inProgressCount) ?? asNumber(asRecord(summary.byStatus)?.in_progress) ?? 0,
    submittedCount: asNumber(summary.submittedCount) ?? asNumber(asRecord(summary.byStatus)?.submitted) ?? 0,
    qaPendingCount: asNumber(summary.qaPendingCount) ?? ((asNumber(asRecord(summary.byStatus)?.qa_pending) ?? 0) + (asNumber(asRecord(summary.byStatus)?.qa_review) ?? 0)),
    signedCount: asNumber(summary.signedCount) ?? ((asNumber(asRecord(summary.byStatus)?.signed) ?? 0) + (asNumber(asRecord(summary.byStatus)?.e_signed) ?? 0)),
    capturedVisitNotes: asNumber(summary.capturedVisitNotes) ?? discoveryRows.filter((row) => asString(row.captureStatus) === "captured").length,
    reusedVisitNotes: asNumber(summary.reusedVisitNotes) ?? discoveryRows.filter((row) => asString(row.skipReason) === "manifest_indicates_capture_extraction_analysis_current").length,
    failedVisitNotes: asNumber(summary.failedVisitNotes) ?? failedCaptureCount,
    degradedVisitNotes: asNumber(summary.degradedVisitNotes) ?? 0,
    cappedVisitNotes: asNumber(summary.cappedVisitNotes) ?? cappedCount,
    actionableFindingCount: asNumber(summary.actionableFindingCount) ?? 0,
    contradictionCount: asNumber(summary.contradictionCount) ?? 0,
    positiveProgressCount: asNumber(summary.positiveProgressCount) ?? 0,
    possibleUpdateNeededCount: asNumber(summary.possibleUpdateNeededCount) ?? 0,
    pocAlignmentIssueCount: asNumber(summary.pocAlignmentIssueCount) ?? 0,
    incompleteNoteCount: asNumber(summary.incompleteNoteCount) ?? 0,
    byVisitType: asRecord(summary.byVisitType) as Record<string, number> ?? {},
    byStatus: asRecord(summary.byStatus) as Record<string, number> ?? {},
    visitTypeCounts: asArray(review.visitTypeCounts).map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)).map((entry) => ({
      visitType: asString(entry.visitType) ?? "others",
      count: asNumber(entry.count) ?? 0,
      statuses: asRecord(entry.statuses) as Record<string, number> ?? {},
    })),
    visitTypeStatusMatrix: asArray(review.visitTypeStatusMatrix ?? review.visitTypeCounts).map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)).map((entry) => ({
      visitType: asString(entry.visitType) ?? "others",
      count: asNumber(entry.count) ?? 0,
      statuses: asRecord(entry.statuses) as Record<string, number> ?? {},
    })),
    findings: findings.map((finding) => ({
      findingId: asString(finding.findingId) ?? "visit-note-finding",
      visitNoteKey: asString(finding.visitNoteKey) ?? "",
      visitType: asString(finding.visitType) ?? "others",
      visitDate: asString(finding.visitDate),
      severity: asString(finding.severity) ?? "low",
      category: asString(finding.category) ?? "documentation_quality",
      title: asString(finding.title) ?? "Visit note finding",
      description: asString(finding.description) ?? "",
      suggestedReviewerAction: asString(finding.suggestedReviewerAction) ?? "",
      needsHumanReview: Boolean(finding.needsHumanReview),
      confidence: asNumber(finding.confidence) ?? 0,
      evidenceCount:
        asArray(finding.visitNoteEvidence).length +
        asArray(finding.pocEvidence).length +
        asArray(finding.oasisEvidence).length,
    })),
    noteSummaries: noteSummaries.map((note) => ({
      visitNoteKey: asString(note.visitNoteKey) ?? "",
      visitType: asString(note.visitType) ?? "others",
      visitDate: asString(note.visitDate),
      status: asString(note.status) ?? "unknown",
      lifecycleStatus: asString(note.lifecycleStatus),
      captureStatus: asString(note.captureStatus),
      analyzed: Boolean(note.analyzed),
      analysisStatus: asString(note.analysisStatus) ?? "skipped",
      completionStatus: asString(note.completionStatus) ??
        (asString(note.captureStatus) === "failed" || asString(note.analysisStatus) === "failed"
          ? "capture_needed"
          : (
            asArray(note.missingFields).length > 0 ||
            asArray(note.textInputSuggestions).length > 0 ||
            asArray(asRecord(note.pocMappingResult)?.missingDocumentation)
              .map(asString)
              .some((value) => /\b(?:blank|needs more detail|too short|not descriptive)\b/i.test(value ?? ""))
          )
            ? "incomplete"
            : Boolean(note.analyzed)
              ? "complete"
              : "unknown"),
      completionReasons: asArray(note.completionReasons).map(asString).filter((value): value is string => Boolean(value)),
      mappingStatus:
        asString(asRecord(note.pocMappingResult)?.mappingStatus) ??
        asString(asRecord(note.pocMappingResult)?.alignmentStatus),
      matchStrength: asNumber(asRecord(note.pocMappingResult)?.matchStrength),
      summary: asString(note.summary) ?? "",
      missingFields: Array.from(new Set([
        ...asArray(note.missingFields).map(asString).filter((value): value is string => Boolean(value)),
        ...asArray(asRecord(note.pocMappingResult)?.missingDocumentation)
          .map(asString)
          .filter((value): value is string => Boolean(value && /\b(?:blank|needs more detail|too short|not descriptive)\b/i.test(value)))
          .map((value) => value.replace(/\s+(?:is blank|needs more detail)\.?$/i, "").trim())
          .filter(Boolean),
      ])),
      textInputSuggestions: asArray(note.textInputSuggestions).map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)).map((suggestion) => ({
        suggestionId: asString(suggestion.suggestionId) ?? "visit-note-suggestion",
        visitNoteKey: asString(suggestion.visitNoteKey) ?? asString(note.visitNoteKey) ?? "",
        fieldKey: asString(suggestion.fieldKey),
        fieldLabel: asString(suggestion.fieldLabel) ?? "Visit Note text field",
        sectionLabel: asString(suggestion.sectionLabel),
        currentValue: asString(suggestion.currentValue),
        reason: asString(suggestion.reason) ?? "not_descriptive",
        relatedPocProblemTitle: asString(suggestion.relatedPocProblemTitle),
        suggestedInput: asString(suggestion.suggestedInput) ?? "",
        sourceFactIds: asArray(suggestion.sourceFactIds).map(asString).filter((value): value is string => Boolean(value)),
        confidence: asNumber(suggestion.confidence) ?? 0,
      })).filter((suggestion) => suggestion.suggestedInput.length > 0),
      alignedPocGoals: asArray(note.alignedPocGoals).map(asString).filter((value): value is string => Boolean(value)),
      pocMappingResult: asRecord(note.pocMappingResult) ? {
        mappingStatus: asString(asRecord(note.pocMappingResult)?.mappingStatus),
        mappingSource: asString(asRecord(note.pocMappingResult)?.mappingSource),
        alignmentStatus: asString(asRecord(note.pocMappingResult)?.alignmentStatus) ?? "needs_review",
        matchStrength: asNumber(asRecord(note.pocMappingResult)?.matchStrength) ?? 0,
        matchedPocItems: asArray(asRecord(note.pocMappingResult)?.matchedPocItems).map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)).map((item) => ({
          problemKey: asString(item.problemKey) ?? "",
          problemTitle: asString(item.problemTitle) ?? "Plan of Care problem",
          goalTexts: asArray(item.goalTexts).map(asString).filter((value): value is string => Boolean(value)),
          interventionTexts: asArray(item.interventionTexts).map(asString).filter((value): value is string => Boolean(value)),
          evidenceIds: asArray(item.evidenceIds).map(asString).filter((value): value is string => Boolean(value)),
        })),
        visitNoteEvidence: asArray(asRecord(note.pocMappingResult)?.visitNoteEvidence).map(asString).filter((value): value is string => Boolean(value)),
        rationale: asString(asRecord(note.pocMappingResult)?.rationale) ?? "",
        missingDocumentation: asArray(asRecord(note.pocMappingResult)?.missingDocumentation).map(asString).filter((value): value is string => Boolean(value)),
        contradictions: asArray(asRecord(note.pocMappingResult)?.contradictions).map(asString).filter((value): value is string => Boolean(value)),
        pocUpdateSignals: asArray(asRecord(note.pocMappingResult)?.pocUpdateSignals).map(asString).filter((value): value is string => Boolean(value)),
      } : undefined,
      pocProblemMatches: asArray(note.pocProblemMatches).map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)).map((match) => ({
        problemKey: asString(match.problemKey) ?? "",
        problemTitle: asString(match.problemTitle) ?? "Plan of Care problem",
        problemStatement: asString(match.problemStatement),
        interventionTexts: asArray(match.interventionTexts).map(asString).filter((value): value is string => Boolean(value)),
        matchedFactIds: asArray(match.matchedFactIds).map(asString).filter((value): value is string => Boolean(value)),
        confidence: asNumber(match.confidence) ?? 0,
        rationale: asString(match.rationale) ?? "",
      })),
      possibleContradictions: asArray(note.possibleContradictions).map(asString).filter((value): value is string => Boolean(value)),
    })),
    warnings: [
      ...(syntheticPendingWithoutDiscovery ? ["Visit Notes discovery artifact is missing; QA did not confirm whether eligible notes exist."] : []),
      ...(cappedCount > 0 ? ["Visit Notes capture stopped at the configured capture limit; remaining notes are pending."] : []),
      ...(failedCaptureCount > 0 ? ["One or more Visit Notes failed capture or extraction."] : []),
      ...asArray(review.warnings).map(asString).filter((value): value is string => Boolean(value)),
    ].slice(0, 8),
  };
}

function countPatientSummariesByStatus(
  batch: BatchRecord,
  patients: Array<{ status: string }>,
) {
  const totalWorkItems = batch.parse.workItemCount || patients.length;
  const totalCompleted = patients.filter((patient) => patient.status === "COMPLETE").length;
  const totalBlocked = patients.filter((patient) => patient.status === "BLOCKED").length;
  const totalFailed = patients.filter((patient) => patient.status === "FAILED").length;
  const totalNeedsHumanReview = patients.filter(
    (patient) => patient.status === "NEEDS_HUMAN_REVIEW",
  ).length;
  const currentlyRunningCount = patients.filter((patient) =>
    ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      patient.status,
    ),
  ).length;
  const processedCount = totalCompleted + totalBlocked + totalFailed + totalNeedsHumanReview;

  return {
    totalWorkItems,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalNeedsHumanReview,
    currentlyRunningCount,
    percentComplete:
      totalWorkItems === 0 ? 0 : Math.round((processedCount / totalWorkItems) * 100),
  };
}

function toSubsidiarySummary(batch: BatchRecord) {
  return {
    subsidiaryId: batch.subsidiary.id,
    subsidiarySlug: batch.subsidiary.slug,
    subsidiaryName: batch.subsidiary.name,
  };
}

function deriveCurrentExecutionStep(batch: BatchRecord): string {
  if (batch.status === "PARSING") {
    return "PARSING_WORKBOOK";
  }

  if (batch.status === "RUNNING") {
    const activeRun = [...batch.patientRuns]
      .filter((patientRun) =>
        ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
          patientRun.processingStatus,
        ),
      )
      .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))[0];
    return activeRun?.executionStep ?? "RUNNING_BATCH";
  }

  if (batch.status === "READY") {
    return "READY_TO_RUN";
  }

  if (batch.status === "FAILED") {
    return "FAILED";
  }

  if (batch.status === "COMPLETED" || batch.status === "COMPLETED_WITH_EXCEPTIONS") {
    return "COMPLETE";
  }

  return "CREATED";
}

function deriveBatchErrorSummary(
  batch: BatchRecord,
  patientSummaries?: Array<{ errorSummary: string | null }>,
): string | null {
  const summary = (
    batch.run.lastError ??
    batch.parse.lastError ??
    patientSummaries?.find((patient) => patient.errorSummary)?.errorSummary ??
    batch.patientRuns.find((patientRun) => patientRun.errorSummary)?.errorSummary ??
    null
  );
  return sanitizeDashboardDisplayText(
    summary,
    summary ? "Read-only extraction produced low-quality evidence; source confirmation required." : null,
  );
}

function deriveDaysLeftBeforeOasisDueDate(input: PatientViewInput): number | null {
  const portalLookupContext = extractPortalPatientLookupContext(input.summary.matchResult);
  return (
    portalLookupContext?.daysLeftBeforeOasisDueDate ??
    input.workItem?.timingMetadata?.daysLeftBeforeOasisDueDate ??
    input.workItem?.timingMetadata?.daysLeft ??
    null
  );
}

function isDiagnosisNoise(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const vowels = value.match(/[AEIOUaeiou]/g)?.length ?? 0;
  const symbols = value.match(/[^A-Za-z0-9\s.,;:()/-]/g)?.length ?? 0;
  return [
    "active_diagnoses",
    "active diagnoses",
    "diagnosis_candidates",
    "diagnosis candidates",
    "diagnosis_supporting_evidence",
    "diagnosis supporting evidence",
    "coding_escalation_flags",
    "coding escalation flags",
    "needs_coding_review",
    "missing_in_chart",
    "review_in_chart",
    "diagnosis_row",
    "diagnosis_and_coding",
    "diagnoses-and-coding-support",
    "diagnoses and possible coding support references",
    "primary_diagnosis",
    "secondary_diagnoses",
    "high",
    "medium",
    "low",
    "critical",
    "diagnosis information",
    "patient lives in congregate situation",
    "patient lives in situation",
    "most recent hospital stay",
    "date of discharge",
    "assessment",
    "no chart data captured",
    "chart value is blank",
    "no reliable chart value extracted",
    "no reliable referral value extracted",
    "no explicit primary diagnosis identified in the text",
    "no explicit other diagnoses identified in the text",
  ].includes(normalized) ||
    /%?pdf-\d\.\d/i.test(value) ||
    /\b\d+\s+\d+\s+obj\b|\bendobj\b|\bxref\b|\bstream\b/i.test(value) ||
    /\[(?:matched|not_found|timeout|error)\]/i.test(value) ||
    /diagnosis code candidates?:/i.test(value) ||
    /\bno explicit (?:primary|other|secondary)?\s*diagnos(?:is|es) identified in the text\b/i.test(value) ||
    /\bno reliable (?:referral|chart) value extracted\b/i.test(value) ||
    /\bno chart data captured\b/i.test(value) ||
    /^(?:true|false)$/i.test(value) ||
    /\b(?:selectors?|formcontrolname|formgroupname|elapsedMs|Insert Diagnosis action button|Snapshot is read-only)\b/i.test(value) ||
    /\b(?:diagnosis_candidates|diagnosis_supporting_evidence|coding_escalation_flags|needs_coding_review|missing_in_chart|review_in_chart|diagnosis_row|primary_diagnosis|secondary_diagnoses)\b/i.test(value) ||
    /(?:^|[;|])\s*(?:active_diagnoses|diagnosis_candidates|diagnosis_supporting_evidence|coding_escalation_flags|needs_coding_review|missing_in_chart|high|medium|low|critical)\s*(?:[;|]|$)/i.test(value) ||
    /fallback to row text heuristics/i.test(value) ||
    /rows are classified as existing diagnoses/i.test(value) ||
    /empty editable slots|empty readonly slots/i.test(value) ||
    /\b(?:true|false)\s+(?:true|false)\s+(?:true|false)\b.*\b(?:https?:\/\/|\/data\/control-plane)\b/i.test(value) ||
    /\b(?:high|medium|low):\d+\s+(?:high|medium|low):\d+\s+(?:high|medium|low):\d+\b/i.test(value) ||
    /\b(?:OASIS|Visit Notes?|File Uploads?|Documents?)\s+(?:documents\s+)?page\b.*\b(?:true|false)\b/i.test(value) ||
    /\bapp\.finalehealth\.com\b.*\b(?:true|false|\/data\/control-plane)\b/i.test(value) ||
    /diagnosis code candidate from extracted document metadata/i.test(value) ||
    normalized.includes("plan of care diagnosis list includes") ||
    normalized.includes("goals and interventions reviewed") ||
    normalized.includes("visit frequency") ||
    normalized.includes("condition exacerbation monitoring") ||
    /\bsn\s*\d+w\d+\b/i.test(value) ||
    symbols / Math.max(1, value.length) > 0.18 ||
    (letters >= 12 && vowels / Math.max(1, letters) < 0.18);
}

function sanitizeDashboardDisplayText(
  value: string | null | undefined,
  fallback: string | null = null,
): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || isDiagnosisNoise(text)) {
    return fallback;
  }
  return text.replace(/\bdownstream\b/gi, (match) => match[0] === "D" ? "Subsequent" : "subsequent");
}

function sanitizeDashboardClinicalValue(value: string | null | undefined): string | null {
  return sanitizeDashboardDisplayText(value, null);
}

function isLowValuePlanOfCareWarning(value: string): boolean {
  return /^filtered diagnosis-like noise:/i.test(value) ||
    /diagnosis label exists without icd code/i.test(value) ||
    /^diagnosis\s+[a-f0-9]{8,}\s+has no selected intervention/i.test(value) ||
    /^no candidate bank entries found for diagnosis\s+[a-f0-9]{8,}/i.test(value);
}

function isValidDashboardIcdCode(value: string | null | undefined): boolean {
  return /^[A-TV-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/i.test((value ?? "").replace(/\.(?=\s*$)/, ""));
}

function isPlausibleDashboardDiagnosisDescription(value: string | null | undefined): boolean {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length < 3 || text.length > 180 || isDiagnosisNoise(text)) {
    return false;
  }
  return /[A-Za-z][A-Za-z-]{2,}/.test(text);
}

function isDiagnosisFieldKey(fieldKey: string): boolean {
  return [
    "diagnosis_candidates",
    "primary_diagnosis",
    "secondary_diagnoses",
  ].includes(fieldKey);
}

function sanitizeDiagnosisFieldValue(fieldKey: string, value: unknown): unknown {
  if (!isDiagnosisFieldKey(fieldKey)) {
    return value;
  }

  if (typeof value === "string") {
    return isDiagnosisNoise(value) ? null : value;
  }

  if (Array.isArray(value)) {
    const filtered = value
      .map((entry) => sanitizeDiagnosisFieldValue(fieldKey, entry))
      .filter((entry) => entry !== null);
    return filtered.length > 0 ? filtered : null;
  }

  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const normalizedEntry = normalizeDiagnosisEntry(record);
  return normalizedEntry ?? null;
}

function normalizeDiagnosisEntry(value: unknown): DashboardDiagnosisEntry | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (isValidDashboardIcdCode(trimmed)) {
      return {
        code: trimmed.toUpperCase().replace(/\.(?=\s*$)/, ""),
        normalizedIcd10Code: trimmed.toUpperCase().replace(/\.(?=\s*$)/, ""),
        description: null,
        confidence: null,
      };
    }

    const diagnosisMatch = trimmed.match(/^([A-TV-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?)(?:\.(?=\s))?\s*(?:-|:)?\s*(.+)$/i);
    const code = diagnosisMatch?.[1]?.trim().replace(/\.(?=\s*$)/, "") ?? null;
    const description = diagnosisMatch?.[2]?.trim() ?? trimmed;
    if (code && !isValidDashboardIcdCode(code)) {
      return null;
    }
    if (!isPlausibleDashboardDiagnosisDescription(description)) {
      return null;
    }

    return {
      code,
      normalizedIcd10Code: code,
      description:
        code && description.localeCompare(code, undefined, { sensitivity: "accent" }) === 0
          ? null
          : description,
      confidence: null,
    };
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const rawCode =
    asString(record.code) ??
    asString(record.icdCode) ??
    asString(record.icd_code) ??
    asString(record.icd10_code) ??
    asString(record.icd10Code);
  const code = rawCode?.replace(/\.(?=\s*$)/, "") ?? null;
  const explicitNormalizedIcd10Code = asString(record.normalizedIcd10Code) ?? asString(record.normalized_icd10_code);
  const normalizedIcd10Code = explicitNormalizedIcd10Code?.replace(/\.(?=\s*$)/, "") ?? null;
  const description =
    asString(record.description) ??
    asString(record.label) ??
    asString(record.name) ??
    asString(record.current_value) ??
    asString(record.text);
  const confidence = asString(record.confidence);
  if (!code && !description) {
    return null;
  }
  if (!code && description) {
    const parsedFromDescription: DashboardDiagnosisEntry | null = normalizeDiagnosisEntry(description);
    if (
      parsedFromDescription &&
      (parsedFromDescription.code || parsedFromDescription.description !== description)
    ) {
      return {
        code: parsedFromDescription.code ?? null,
        description: parsedFromDescription.description ?? null,
        confidence: parsedFromDescription.confidence ?? confidence ?? null,
      };
    }
  }
  if (code && !isValidDashboardIcdCode(code)) {
    return null;
  }
  if (!description && code) {
    return {
      code: code.toUpperCase(),
      description: null,
      confidence,
    };
  }
  if (!isPlausibleDashboardDiagnosisDescription(description)) {
    return null;
  }

  const entry: DashboardDiagnosisEntry = {
    code,
    description:
      code && description && description.localeCompare(code, undefined, { sensitivity: "accent" }) === 0
        ? null
        : description,
    confidence,
  };
  if (normalizedIcd10Code) entry.normalizedIcd10Code = normalizedIcd10Code;
  const rank = asNumber(record.rank);
  if (rank !== null) entry.rank = rank;
  const role = asString(record.role) ?? (record.isPrimary === true ? "primary" : record.isPrimary === false ? "secondary" : null);
  const effectiveRole = role ?? (record.is_primary_candidate === true ? "primary" : record.is_primary_candidate === false ? "secondary" : null);
  if (effectiveRole) entry.role = effectiveRole;
  const slotLabel = asString(record.slotLabel) ?? asString(record.slot_label);
  if (slotLabel) entry.slotLabel = slotLabel;
  const onsetDate = asString(record.onsetDate) ?? asString(record.onset_date);
  if (onsetDate) entry.onsetDate = onsetDate;
  const group = asString(record.group) ?? asString(record.clinicalGroup) ?? asString(record.comorbidityGroup);
  if (group) entry.group = group;
  const source = asString(record.source) ?? asString(record.sourceSection);
  if (source) entry.source = source;
  const status = asString(record.status);
  if (status) entry.status = status;
  return entry;
}

function dedupeDiagnoses(entries: Array<ReturnType<typeof normalizeDiagnosisEntry>>) {
  const seen = new Set<string>();
  return entries.filter((entry): entry is NonNullable<typeof entry> => {
    if (!entry) {
      return false;
    }

    const key = `${entry.code ?? ""}::${entry.description ?? ""}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeDiagnosisList(values: unknown[]): Array<NonNullable<ReturnType<typeof normalizeDiagnosisEntry>>> {
  return dedupeDiagnoses(values.map((value) => normalizeDiagnosisEntry(value)));
}

function createDiagnosisSummary(
  diagnoses: Array<NonNullable<ReturnType<typeof normalizeDiagnosisEntry>>>,
  diagnosisSource: DashboardDiagnosisSource | null,
): DashboardDiagnosisSummary | null {
  if (diagnoses.length === 0) {
    return null;
  }

  return {
    primaryDiagnosis: diagnoses[0] ?? null,
    otherDiagnoses: diagnoses.slice(1),
    diagnosisSource,
  };
}

function diagnosisSummaryEntries(summary: DashboardDiagnosisSummary | null): DashboardDiagnosisEntry[] {
  if (!summary) {
    return [];
  }

  return [
    ...(summary.primaryDiagnosis ? [summary.primaryDiagnosis] : []),
    ...summary.otherDiagnoses,
  ];
}

function deriveFactPackDiagnosisSummary(input: PatientViewInput) {
  const documentFactPack = asRecord(input.artifactContents.documentFactPack);
  const factPack = asRecord(documentFactPack?.factPack) ?? documentFactPack;
  return createDiagnosisSummary(
    normalizeDiagnosisList(asArray(factPack?.diagnoses)),
    "document_fact_pack",
  );
}

function getReferralExtractionUsabilityStatus(
  artifactContents: KnownArtifactContents,
): string | null {
  const qaDocumentSummary = asRecord(artifactContents.qaDocumentSummary);
  const patientQaReference = asRecord(artifactContents.patientQaReference);
  return asString(qaDocumentSummary?.extractionUsabilityStatus) ??
    asString(patientQaReference?.extractionUsabilityStatus);
}

function canUseReferralStructuredFacts(artifactContents: KnownArtifactContents): boolean {
  const status = getReferralExtractionUsabilityStatus(artifactContents);
  return status === null || /^usable$/i.test(status);
}

function normalizeFactPackDiagnoses(
  factPackValue: unknown,
): Array<NonNullable<ReturnType<typeof normalizeDiagnosisEntry>>> {
  const factPack = asRecord(factPackValue);
  const facts = asArray(factPack?.facts).map(asRecord).filter((fact): fact is Record<string, unknown> => Boolean(fact));
  const diagnosisFacts = facts.filter((fact) => {
    const category = asString(fact.category)?.toLowerCase();
    return category === "diagnosis" || category === "icd_code";
  });
  const entries: DashboardDiagnosisEntry[] = [];
  let pendingDescription: string | null = null;
  let pendingConfidence: string | null = null;

  const flushPendingDescription = () => {
    if (!pendingDescription) {
      return;
    }
    const entry = normalizeDiagnosisEntry({
      description: pendingDescription,
      confidence: pendingConfidence,
    });
    if (entry) {
      entries.push(entry);
    }
    pendingDescription = null;
    pendingConfidence = null;
  };

  for (const fact of diagnosisFacts) {
    const category = asString(fact.category)?.toLowerCase();
    const raw = asString(fact.normalizedValue) ?? asString(fact.rawValue) ?? asString(fact.label);
    if (!raw) {
      continue;
    }
    const confidence = typeof fact.confidence === "number"
      ? `${Math.round(fact.confidence * 100)}%`
      : asString(fact.confidence);
    if (category === "icd_code") {
      const code = raw.match(/[A-TV-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?/i)?.[0] ?? raw;
      const entry = normalizeDiagnosisEntry({
        code,
        description: pendingDescription,
        confidence: pendingConfidence ?? confidence,
      });
      if (entry) {
        entries.push(entry);
        pendingDescription = null;
        pendingConfidence = null;
        continue;
      }
    }
    if (category === "diagnosis") {
      flushPendingDescription();
      pendingDescription = raw;
      pendingConfidence = confidence;
    }
  }

  flushPendingDescription();
  return dedupeDiagnoses(entries);
}

function deriveClinicalFactPackDiagnosisSummary(
  factPackValue: unknown,
  diagnosisSource: DashboardDiagnosisSource,
): DashboardDiagnosisSummary | null {
  return createDiagnosisSummary(normalizeFactPackDiagnoses(factPackValue), diagnosisSource);
}

function deriveQaVisibleDiagnosisSummary(input: PatientViewInput) {
  const qaPrefetch = asRecord(input.artifactContents.qaPrefetch);
  const diagnosisRoute = asRecord(qaPrefetch?.diagnosisRoute);
  return createDiagnosisSummary(
    normalizeDiagnosisList(asArray(diagnosisRoute?.visibleDiagnoses)),
    "qa_visible_diagnoses",
  );
}

function deriveOasisExtractedDiagnosisSummary(input: PatientViewInput) {
  const extraction = asRecord(input.artifactContents.oasisDiagnosisExtraction);
  return createDiagnosisSummary(
    normalizeDiagnosisList(asArray(extraction?.diagnoses)),
    "qa_visible_diagnoses",
  );
}

function deriveOasisDomDiagnosisSummary(input: PatientViewInput) {
  const entries: DashboardDiagnosisEntry[] = [];
  let current: DashboardDiagnosisEntry | null = null;

  const flushCurrent = () => {
    const normalized = normalizeDiagnosisEntry(current);
    if (normalized) {
      entries.push(normalized);
    }
    current = null;
  };

  for (const entry of getMeaningfulOasisDomFields(input.artifactContents)) {
    if (!entry.sectionKey.startsWith("active_diagnoses")) {
      continue;
    }
    const label = entry.label.toLowerCase();
    const value = entry.value.trim();
    if (!value || isDiagnosisNoise(value)) {
      continue;
    }

    if (label.includes("onset date")) {
      if (current && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        current.onsetDate = value;
      }
      continue;
    }

    if (isValidDashboardIcdCode(value)) {
      flushCurrent();
      current = {
        code: value.toUpperCase(),
        normalizedIcd10Code: value.toUpperCase(),
        description: null,
        confidence: "dom",
      };
      continue;
    }

    if (!isPlausibleDashboardDiagnosisDescription(value)) {
      continue;
    }

    if (!current) {
      current = {
        code: null,
        description: value,
        confidence: "dom",
      };
      continue;
    }

    if (!current.description) {
      current.description = value;
    } else {
      flushCurrent();
      current = {
        code: null,
        description: value,
        confidence: "dom",
      };
    }
  }

  flushCurrent();
  return createDiagnosisSummary(dedupeDiagnoses(entries), "portal_dom_state");
}

function deriveReferralExtractedDiagnosisSummary(input: PatientViewInput) {
  const extraction =
    asRecord(input.artifactContents.referralDiagnosisExtraction) ??
    asRecord(input.artifactContents.referralExtractedFacts);
  const diagnosisCandidates = asArray(extraction?.diagnosis_candidates)
    .map((candidate, index) => {
      const record = asRecord(candidate);
      if (!record) {
        return candidate;
      }
      const isPrimary = record.is_primary_candidate === true;
      return {
        ...record,
        code: asString(record.code) ?? asString(record.icdCode) ?? asString(record.icd10_code),
        description: asString(record.description) ?? asString(record.label),
        confidence: typeof record.confidence === "number"
          ? `${Math.round(record.confidence * 100)}%`
          : asString(record.confidence),
        rank: asNumber(record.rank) ?? (isPrimary ? 1 : index + 1),
        isPrimary,
      };
    })
    .sort((left, right) => {
      const leftRecord = asRecord(left);
      const rightRecord = asRecord(right);
      const leftPrimary = leftRecord?.isPrimary === true ? 0 : 1;
      const rightPrimary = rightRecord?.isPrimary === true ? 0 : 1;
      if (leftPrimary !== rightPrimary) {
        return leftPrimary - rightPrimary;
      }
      return (asNumber(leftRecord?.rank) ?? 999) - (asNumber(rightRecord?.rank) ?? 999);
    });

  return createDiagnosisSummary(
    normalizeDiagnosisList([
      ...asArray(extraction?.diagnoses),
      ...diagnosisCandidates,
    ]),
    "document_fact_pack",
  );
}

function deriveReferralDiagnosisSummary(input: PatientViewInput): DashboardDiagnosisSummary | null {
  if (!canUseReferralStructuredFacts(input.artifactContents)) {
    return null;
  }

  const extractedDiagnosisSummary = deriveReferralExtractedDiagnosisSummary(input);
  if (extractedDiagnosisSummary) {
    return extractedDiagnosisSummary;
  }

  const codingInput = asRecord(input.artifactContents.codingInput);
  const codingDiagnosisSummary = createDiagnosisSummary(
    normalizeDiagnosisList([
      codingInput?.primaryDiagnosis,
      ...asArray(codingInput?.otherDiagnoses),
      ...asArray(codingInput?.diagnoses),
    ]),
    "coding_input",
  );
  if (codingDiagnosisSummary) {
    return codingDiagnosisSummary;
  }

  return deriveFactPackDiagnosisSummary(input) ??
    deriveClinicalFactPackDiagnosisSummary(input.artifactContents.sourceClinicalFactPack, "source_clinical_fact_pack");
}

function deriveOasisDiagnosisSummary(input: PatientViewInput): DashboardDiagnosisSummary | null {
  const extractedDiagnosisSummary = deriveOasisExtractedDiagnosisSummary(input);
  if (extractedDiagnosisSummary) {
    return extractedDiagnosisSummary;
  }

  const domDiagnosisSummary = deriveOasisDomDiagnosisSummary(input);
  if (domDiagnosisSummary) {
    return domDiagnosisSummary;
  }

  const qaVisibleDiagnosisSummary = deriveQaVisibleDiagnosisSummary(input);
  if (qaVisibleDiagnosisSummary) {
    return qaVisibleDiagnosisSummary;
  }

  return deriveClinicalFactPackDiagnosisSummary(input.artifactContents.oasisClinicalFactPack, "oasis_clinical_fact_pack");
}

function diagnosisEntryKey(entry: DashboardDiagnosisEntry): string {
  return `${entry.code ?? ""}::${entry.description ?? ""}`.toLowerCase();
}

function cleanMedicationText(value: unknown): string | null {
  const text = asString(value)
    ?.replace(/\s+/g, " ")
    .replace(/\bPhone\b/gi, "")
    .replace(/\s+\/\s*$/, " /")
    .trim();
  if (!text || text === "-" || /^not available$/i.test(text)) {
    return null;
  }
  return text;
}

function toMedicationDisplayWord(value: string): string {
  if (!/[A-Za-z]/.test(value)) {
    return value;
  }

  return value
    .split(/([/-])/)
    .map((part) => {
      if (part === "/" || part === "-") {
        return part;
      }
      return part
        .split(/(\s+)/)
        .map((word) => {
          return word.replace(/[A-Za-z][A-Za-z]*/g, (token) => {
            if (/^(?:hci|xr|er|sr|dr|cr)$/i.test(token)) {
              return token.toUpperCase();
            }
            return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
          });
        })
        .join("");
    })
    .join("");
}

function formatMedicationName(value: string): string {
  return value
    .replace(/\b(orall?)\b/gi, "Oral")
    .replace(/\btab\b/gi, "Tab")
    .replace(/\bcap\b/gi, "Cap")
    .replace(/\btablet\b/gi, "Tablet")
    .replace(/\bcapsule\b/gi, "Capsule")
    .replace(/\bsuppository\b/gi, "Suppository")
    .replace(/\benema\b/gi, "Enema")
    .split(/(\([^)]*\))/)
    .map((part) => {
      if (part.startsWith("(") && part.endsWith(")")) {
        return `(${toMedicationDisplayWord(part.slice(1, -1))})`;
      }
      return toMedicationDisplayWord(part);
    })
    .join("")
    .replace(/\bMeq\b/g, "mEq")
    .replace(/\bMl\b/g, "mL")
    .replace(/\bMg\b/g, "mg")
    .replace(/\bGm\b/g, "GM")
    .replace(/\bHcl\b/g, "HCl")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMedicationDose(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/(\d)\s*MG\b/gi, "$1 mg")
    .replace(/(\d)\s*MEQ\b/gi, "$1 mEq")
    .replace(/(\d)\s*ML\b/gi, "$1 mL")
    .replace(/\bMG\b/gi, "mg")
    .replace(/\bMEQ\b/gi, "mEq")
    .replace(/\bML\b/gi, "mL")
    .replace(/\bTAB\b/gi, "Tab")
    .replace(/\bCAP\b/gi, "Cap")
    .replace(/\bTID\b/gi, "TID")
    .replace(/\bBID\b/gi, "BID")
    .replace(/\bQID\b/gi, "QID")
    .replace(/\bonce a day\b/gi, "once a day")
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_MEDICATION_NAME_PATTERN =
  /\b(?:insulin|warfarin|metformin|lasix|furosemide|lisinopril|aspirin|acetaminophen|eliquis|apixaban|toprol|metoprolol|omeprazole|losartan|atorvastatin|januvia|solifenacin|gabapentin|amlodipine|levothyroxine|fluoxetine|oxycodone|torsemide|potassium|klor-con|kenalog|triamcinolone|tramadol|ondansetron|bupropion)\b/i;

function isLikelyMedicationFragmentName(value: string): boolean {
  const normalized = value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return true;
  }
  if (/^(?:left|right|bilateral|upper|lower|anterior|posterior|medial|lateral)$/.test(normalized)) {
    return true;
  }
  if (/^(?:tablet|tab|capsule|cap|pill|mg capsule|mcg capsule|capsule by|tablet by|by mouth|oral)$/.test(normalized)) {
    return true;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  const genericWords = new Set(["mg", "mcg", "g", "ml", "tablet", "tab", "capsule", "cap", "pill", "by", "mouth", "oral"]);
  return words.length > 0 && words.every((word) => genericWords.has(word));
}

function normalizeMedicationNameForDisplay(value: string): string | null {
  const dateStripped = value
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\bHCI\b/g, "HCl")
    .replace(/\s+/g, " ")
    .trim();
  const knownMedicationMatch = dateStripped.match(KNOWN_MEDICATION_NAME_PATTERN)?.[0] ?? null;
  const trimmed = dateStripped.replace(/\s*[-–—]\s*$/g, "").trim();
  const shouldUseKnownMedicationName = Boolean(
    knownMedicationMatch &&
    /\b(?:injection|joint|tendon|bursa|trochanteric|cmc|hand)\b/i.test(trimmed),
  );
  const normalized = shouldUseKnownMedicationName
    ? knownMedicationMatch!
    : trimmed;
  if (isLikelyMedicationFragmentName(normalized)) {
    return null;
  }
  return normalized;
}

function createMedicationEntry(input: {
  name: unknown;
  dose?: unknown;
  route?: unknown;
  classification?: unknown;
  startDate?: unknown;
  status?: unknown;
  source?: unknown;
}): DashboardMedicationEntry | null {
  const name = cleanMedicationText(input.name);
  const normalizedName = name ? normalizeMedicationNameForDisplay(name) : null;
  if (
    !normalizedName ||
    /^order summary\b/i.test(normalizedName) ||
    /^treat as indicated\b/i.test(normalizedName) ||
    /^by mouth\b/i.test(normalizedName) ||
    /\bby mouth one time\b/i.test(normalizedName) ||
    /^\([^)]*(?:potassium|potass)/i.test(normalizedName)
  ) {
    return null;
  }

  return {
    name: formatMedicationName(normalizedName),
    dose: formatMedicationDose(cleanMedicationText(input.dose)),
    route: cleanMedicationText(input.route),
    classification: cleanMedicationText(input.classification),
    startDate: cleanMedicationText(input.startDate),
    status: cleanMedicationText(input.status),
    source: cleanMedicationText(input.source),
  };
}

function dedupeMedicationEntries(entries: Array<DashboardMedicationEntry | null>): DashboardMedicationEntry[] {
  const seen = new Set<string>();
  const deduped: DashboardMedicationEntry[] = [];
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const key = [
      entry.name,
      entry.dose ?? "",
      entry.route ?? "",
      entry.classification ?? "",
    ].join("|").toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function createAllergyEntry(input: {
  name: unknown;
  reaction?: unknown;
  startDate?: unknown;
  status?: unknown;
  source?: unknown;
}): DashboardAllergyEntry | null {
  const name = cleanMedicationText(input.name);
  if (!name || name === "/" || /^and intolerances\b/i.test(name)) {
    return null;
  }
  return {
    name: /^no known$/i.test(name) ? "None known" : name,
    reaction: cleanMedicationText(input.reaction),
    startDate: cleanMedicationText(input.startDate),
    status: cleanMedicationText(input.status),
    source: cleanMedicationText(input.source),
  };
}

function dedupeAllergyEntries(entries: Array<DashboardAllergyEntry | null>): DashboardAllergyEntry[] {
  const seen = new Set<string>();
  const deduped: DashboardAllergyEntry[] = [];
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const key = [
      entry.name,
      entry.reaction ?? "",
      entry.startDate ?? "",
      entry.status ?? "",
    ].join("|").toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function createMedicationSummary(input: {
  medications: Array<DashboardMedicationEntry | null>;
  allergies: Array<DashboardAllergyEntry | null>;
  medicationSource: DashboardMedicationSummary["medicationSource"];
}): DashboardMedicationSummary | null {
  const medications = dedupeMedicationEntries(input.medications);
  const allergies = dedupeAllergyEntries(input.allergies);
  if (medications.length === 0 && allergies.length === 0) {
    return null;
  }
  return {
    medications,
    allergies,
    medicationSource: input.medicationSource,
  };
}

function arrayOrSingle(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined || value === "") {
    return [];
  }
  return [value];
}

function createReferralMedicationEntry(value: unknown, fallbackSource: string): DashboardMedicationEntry | null {
  const record = asRecord(value);
  if (!record) {
    return createMedicationEntry({ name: value, source: fallbackSource });
  }
  return createMedicationEntry({
    name: record.name ?? record.medication ?? record.label,
    dose: record.dose ?? record.strength,
    route: record.route,
    classification: record.classification ?? record.indication,
    startDate: record.startDate ?? record.start_date,
    status: record.status,
    source: record.source ?? fallbackSource,
  });
}

function createReferralAllergyEntry(value: unknown, fallbackSource: string): DashboardAllergyEntry | null {
  const record = asRecord(value);
  if (!record) {
    return createAllergyEntry({ name: value, source: fallbackSource });
  }
  return createAllergyEntry({
    name: record.name ?? record.allergen ?? record.allergy ?? record.label,
    reaction: record.reaction,
    startDate: record.startDate ?? record.start_date ?? record.onsetDate ?? record.onset_date,
    status: record.status,
    source: record.source ?? fallbackSource,
  });
}

function deriveReferralDirectMedicationSummary(input: PatientViewInput): DashboardMedicationSummary | null {
  const extractedFacts = asRecord(input.artifactContents.referralExtractedFacts);
  const facts = asArray(extractedFacts?.facts)
    .map(asRecord)
    .filter((fact): fact is Record<string, unknown> => Boolean(fact));
  const medicationValues = facts
    .filter((fact) => asString(fact.fact_key) === "medication_list")
    .flatMap((fact) => arrayOrSingle(fact.value));
  const allergyValues = facts
    .filter((fact) => asString(fact.fact_key) === "allergy_list")
    .flatMap((fact) => arrayOrSingle(fact.value));

  return createMedicationSummary({
    medications: medicationValues.map((value) => createReferralMedicationEntry(value, "Direct-document referral")),
    allergies: allergyValues.map((value) => createReferralAllergyEntry(value, "Direct-document referral")),
    medicationSource: "direct_document_referral",
  });
}

function deriveReferralMedicationSummary(input: PatientViewInput): DashboardMedicationSummary | null {
  if (!canUseReferralStructuredFacts(input.artifactContents)) {
    return null;
  }

  const directMedicationSummary = deriveReferralDirectMedicationSummary(input);
  if (directMedicationSummary) {
    return directMedicationSummary;
  }

  const documentFactPack = asRecord(input.artifactContents.documentFactPack);
  const factPack = asRecord(documentFactPack?.factPack) ?? documentFactPack;
  const medications = asArray(factPack?.medications)
    .map((value) => createReferralMedicationEntry(value, "Referral document"));
  const allergies = asArray(factPack?.allergies)
    .map((value) => createReferralAllergyEntry(value, "Referral document"));
  return createMedicationSummary({
    medications,
    allergies,
    medicationSource: "document_fact_pack",
  });
}

function normalizeMedicationHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMedicationColumnIndex(headers: string[], predicate: (header: string) => boolean): number {
  return headers.findIndex((header) => predicate(normalizeMedicationHeader(header)));
}

function isMedicationHeaderEcho(value: string, header: string | undefined): boolean {
  const normalizedValue = normalizeMedicationHeader(value);
  const normalizedHeader = normalizeMedicationHeader(header ?? "");
  return normalizedValue === "medication" ||
    (normalizedHeader.length > 0 && normalizedValue === normalizedHeader);
}

function deriveOasisMedicationSummary(input: PatientViewInput): DashboardMedicationSummary | null {
  const extractedState = asRecord(input.artifactContents.oasisDomExtractedState);
  const sections = asArray(extractedState?.sections)
    .map(asRecord)
    .filter((section): section is Record<string, unknown> => Boolean(section));
  const medicationSections = sections.filter((section) =>
    compactLowerText(section.title).includes("medication") ||
    compactLowerText(section.title).includes("allerg") ||
    asArray(section.fields).some((field) => {
      const record = asRecord(field);
      return compactLowerText(record?.section, record?.label).includes("medication") ||
        compactLowerText(record?.section, record?.label).includes("allerg");
    }),
  );

  const medications: Array<DashboardMedicationEntry | null> = [];
  const allergies: Array<DashboardAllergyEntry | null> = [];

  for (const section of medicationSections) {
    for (const tableValue of asArray(section.tables)) {
      const table = asRecord(tableValue);
      const headers = asArray(table?.headers).map((header) => cleanMedicationText(header) ?? "");
      const rows = asArray(table?.rows).map((row) => asArray(row).map((cell) => cleanMedicationText(cell) ?? ""));
      const medicationIndex = findMedicationColumnIndex(headers, (header) =>
        header === "medication" ||
        header === "medication name" ||
        header === "drug" ||
        header === "drug name");
      const allergyNameIndex = findMedicationColumnIndex(headers, (header) => header === "name" || header === "allergen");
      const reactionIndex = findMedicationColumnIndex(headers, (header) => header === "reaction");

      if (medicationIndex >= 0) {
        const startDateIndex = findMedicationColumnIndex(headers, (header) => header.includes("start date"));
        const doseIndex = findMedicationColumnIndex(headers, (header) =>
          header.includes("strength") ||
          header.includes("dosage") ||
          header.includes("dose"));
        const routeIndex = findMedicationColumnIndex(headers, (header) => header === "route");
        const classificationIndex = findMedicationColumnIndex(headers, (header) =>
          header.includes("classification") ||
          header.includes("indication"));
        const statusIndex = findMedicationColumnIndex(headers, (header) => header === "status");
        for (const row of rows) {
          const medicationName = row[medicationIndex];
          if (!medicationName || isMedicationHeaderEcho(medicationName, headers[medicationIndex])) {
            continue;
          }
          medications.push(createMedicationEntry({
            name: medicationName,
            dose: doseIndex >= 0 ? row[doseIndex] : null,
            route: routeIndex >= 0 ? row[routeIndex] : null,
            classification: classificationIndex >= 0 ? row[classificationIndex] : null,
            startDate: startDateIndex >= 0 ? row[startDateIndex] : null,
            status: statusIndex >= 0 ? row[statusIndex] : null,
            source: "OASIS DOM medication table",
          }));
        }
      }

      if (allergyNameIndex >= 0) {
        const allergyStartDateIndex = findMedicationColumnIndex(headers, (header) =>
          header.includes("start date") ||
          header.includes("onset date") ||
          header === "date");
        const allergyStatusIndex = findMedicationColumnIndex(headers, (header) => header === "status");
        for (const row of rows) {
          const name = row[allergyNameIndex];
          if (!name || name.toLowerCase() === "name") {
            continue;
          }
          const reaction = reactionIndex >= 0 ? row[reactionIndex] : null;
          allergies.push(createAllergyEntry({
            name,
            reaction,
            startDate: allergyStartDateIndex >= 0 ? row[allergyStartDateIndex] : null,
            status: allergyStatusIndex >= 0 ? row[allergyStatusIndex] : null,
            source: "OASIS DOM allergy table",
          }));
        }
      }
    }
  }

  return createMedicationSummary({
    medications,
    allergies,
    medicationSource: "portal_dom_state",
  });
}

function deriveDiagnosisComparisonStatus(
  referralDiagnosisSummary: DashboardDiagnosisSummary | null,
  oasisDiagnosisSummary: DashboardDiagnosisSummary | null,
): DashboardDiagnosisComparisonStatus {
  const referralEntries = diagnosisSummaryEntries(referralDiagnosisSummary);
  const oasisEntries = diagnosisSummaryEntries(oasisDiagnosisSummary);

  if (referralEntries.length === 0 && oasisEntries.length === 0) {
    return "unavailable";
  }
  if (referralEntries.length === 0) {
    return "missing_referral";
  }
  if (oasisEntries.length === 0) {
    return "missing_oasis";
  }

  const referralKeys = new Set(referralEntries.map((entry) => diagnosisEntryKey(entry)));
  const oasisKeys = new Set(oasisEntries.map((entry) => diagnosisEntryKey(entry)));
  const overlapCount = [...referralKeys].filter((entry) => oasisKeys.has(entry)).length;

  if (overlapCount === referralKeys.size && overlapCount === oasisKeys.size) {
    return "aligned";
  }
  if (overlapCount > 0) {
    return "partial_overlap";
  }

  return "conflict";
}

function getDashboardOasisEvidenceLabel(mode: DashboardOasisEvidenceMode): string {
  switch (mode) {
    case "chart_read":
      return "Field value";
    case "portal_dom_state":
      return "DOM field value";
    case "oasis_fact_pack":
      return "OASIS fact-pack evidence";
    default:
      return "Not captured";
  }
}

function getDashboardQaResultLabel(result: DashboardComparisonResult): string {
  switch (result) {
    case "mismatch":
      return "Needs review";
    case "missing_in_portal":
      return "OASIS not captured";
    case "missing_in_referral":
      return "Referral support missing";
    case "coding_review":
      return "Coding follow-up";
    case "equivalent_match":
    case "match":
      return "Resolved";
    default:
      return "Check source documents";
  }
}

function getDashboardQaActionLabel(result: DashboardComparisonResult): string {
  switch (result) {
    case "mismatch":
      return "Resolve mismatch";
    case "missing_in_portal":
      return "Check OASIS source";
    case "missing_in_referral":
      return "Request referral support";
    case "coding_review":
      return "Send to coding review";
    case "equivalent_match":
    case "match":
      return "No action needed";
    default:
      return "Check source documents";
  }
}

function getCanonicalRows(value: unknown): ClinicalComparisonRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((row): row is ClinicalComparisonRow => {
    const record = asRecord(row);
    const sources = asRecord(record?.sources);
    return Boolean(
      record &&
        asString(record.fieldKey) &&
        asString(record.category) &&
        ["match", "mismatch", "missing_in_referral", "missing_in_oasis", "uncertain"].includes(
          asString(record.verdict) ?? "",
        ) &&
        typeof record.confidence === "number" &&
        Array.isArray(record.referralEvidence) &&
        Array.isArray(record.oasisEvidence) &&
        sources &&
        Array.isArray(sources.referralArtifacts) &&
        Array.isArray(sources.oasisArtifacts),
    );
  });
}

function clinicalVerdictToDashboardResult(verdict: ClinicalComparisonRow["verdict"]): DashboardComparisonResult {
  return verdict === "missing_in_oasis" ? "missing_in_portal" : verdict;
}

function confidenceNumberToLabel(confidence: number): "high" | "medium" | "low" | "uncertain" {
  if (confidence >= 0.9) {
    return "high";
  }
  if (confidence >= 0.7) {
    return "medium";
  }
  if (confidence > 0) {
    return "low";
  }
  return "uncertain";
}

function rowCategoryKey(category: string): string {
  return category.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "clinical";
}

function safeDashboardSourceKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "source";
}

function getDefaultReferralDocumentId(artifactContents: KnownArtifactContents): string | null {
  const resultsManifest = asRecord(artifactContents.referralDocumentResultsManifest);
  const sourceManifest = asRecord(artifactContents.referralSourceDocumentsManifest);
  return asString(resultsManifest?.defaultReferralDocumentId) ??
    asArray(resultsManifest?.documents)
      .map((entry) => asString(asRecord(entry)?.documentId))
      .find((documentId): documentId is string => Boolean(documentId)) ??
    asArray(sourceManifest?.documents)
      .map((entry) => asString(asRecord(entry)?.documentId))
      .find((documentId): documentId is string => Boolean(documentId)) ??
    null;
}

function getCurrentOasisAssessmentId(artifactContents: KnownArtifactContents): string | null {
  const snapshot = asRecord(artifactContents.patientPortalStatusSnapshot);
  const oasisDomState = asRecord(artifactContents.oasisDomExtractedState);
  return asString(snapshot?.currentOasisAssessmentId) ??
    asString(oasisDomState?.assessmentId) ??
    asString(oasisDomState?.documentId) ??
    null;
}

function getOasisAssessmentArtifactSources(
  artifactContents: KnownArtifactContents,
): Array<{
  assessmentId: string;
  assessmentType: string | null;
  title: string | null;
  date: string | null;
  isCurrent: boolean;
  sourceArtifact: string;
  artifactContents: KnownArtifactContents;
}> {
  return asArray(artifactContents.oasisAssessmentArtifacts)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .flatMap((entry) => {
      const assessmentId = asString(entry.assessmentId);
      if (!assessmentId || entry.isCurrent === true) {
        return [];
      }
      const sourceArtifact =
        asString(entry.sectionOutputsPath) ??
        asString(entry.domStatePath) ??
        "oasis-assessment-scoped-dom";
      return [{
        assessmentId,
        assessmentType: asString(entry.assessmentType),
        title: asString(entry.title),
        date: asString(entry.date),
        isCurrent: false,
        sourceArtifact,
        artifactContents: {
          ...artifactContents,
          oasisDomExtractedState: entry.oasisDomExtractedState ?? null,
          oasisDomSectionProcessingManifest: entry.oasisDomSectionProcessingManifest ?? null,
          oasisDomSectionOutputs: entry.oasisDomSectionOutputs ?? null,
        },
      }];
    });
}

function deriveReferralQaDashboardSources(
  input: {
    artifactContents: KnownArtifactContents;
  },
  defaultReferralQa: ReturnType<typeof deriveReferralQaSummary>,
): Array<{
  documentId: string | null;
  referralQa: ReturnType<typeof deriveReferralQaSummary>;
}> {
  const documentArtifacts = asArray(input.artifactContents.referralDocumentArtifacts)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const documentSources = documentArtifacts.flatMap((entry) => {
    const documentId = asString(entry.documentId);
    const patientQaReference = entry.patientQaReference ?? null;
    const qaDocumentSummary = entry.qaDocumentSummary ?? null;
    const fieldMapSnapshot = entry.fieldMapSnapshot ?? null;
    if (!documentId || (!patientQaReference && !qaDocumentSummary && !fieldMapSnapshot)) {
      return [];
    }

    const sourceInput = {
      ...input,
      artifactContents: {
        ...input.artifactContents,
        patientQaReference,
        qaDocumentSummary,
        fieldMapSnapshot,
      },
    } as PatientViewInput;
    const referralQa = deriveReferralQaSummary(sourceInput);
    return [{
      documentId,
      referralQa,
    }];
  });

  if (documentSources.length > 0) {
    return documentSources;
  }

  return [{
    documentId: getDefaultReferralDocumentId(input.artifactContents),
    referralQa: defaultReferralQa,
  }];
}

function buildDashboardStateFromClinicalRows(input: {
  referralQa: ReturnType<typeof deriveReferralQaSummary>;
  artifactContents: KnownArtifactContents;
}) {
  const explicitComparisonRowsStatus = asString(input.artifactContents.comparisonRowsStatus);
  const comparisonRowsStatus =
    explicitComparisonRowsStatus === "ready" ||
    (!explicitComparisonRowsStatus && getCanonicalRows(input.artifactContents.clinicalComparisonRows).length > 0)
      ? "ready"
      : "pending";
  const comparisonRowsReason = asString(input.artifactContents.comparisonRowsReason);
  const comparisonRowsRowCount = asNumber(input.artifactContents.comparisonRowsRowCount) ?? 0;
  const clinicalRows =
    comparisonRowsStatus === "ready"
      ? getCanonicalRows(input.artifactContents.clinicalComparisonRows)
      : [];
  const defaultReferralDocumentId = getDefaultReferralDocumentId(input.artifactContents);
  const currentOasisAssessmentId = getCurrentOasisAssessmentId(input.artifactContents);
  const fieldMetadata = new Map(
    input.referralQa.sections.flatMap((section) =>
      section.fields.map((field) => [field.fieldKey, { section, field }] as const),
    ),
  );

  const rows = clinicalRows.map((row) => {
    const metadata = fieldMetadata.get(row.fieldKey);
    const displayStatus = clinicalVerdictToDashboardResult(row.verdict);
    const explicitReferralValue = sanitizeDashboardClinicalValue(row.referralValue);
    const activeOasisArtifacts = row.sources.oasisArtifacts.filter(
      (artifact) => !isLegacyPrintedNoteArtifactName(artifact),
    );
    const oasisSourceIsLegacyOnly = row.sources.oasisArtifacts.length > 0 && activeOasisArtifacts.length === 0;
    const explicitOasisValue = oasisSourceIsLegacyOnly
      ? null
      : sanitizeDashboardClinicalValue(row.oasisValue);
    const referralEvidence = row.referralEvidence
      .map((entry, index) => ({
        entry,
        index,
        snippet: sanitizeDashboardClinicalValue(entry.snippet),
      }))
      .filter((entry): entry is typeof entry & { snippet: string } => entry.snippet !== null);
    const oasisEvidence = row.oasisEvidence
      .filter((entry) => !isLegacyPrintedNoteArtifactName(entry.artifact))
      .map((entry, index) => ({
        entry,
        index,
        snippet: sanitizeDashboardClinicalValue(entry.snippet),
      }))
      .filter((entry): entry is typeof entry & { snippet: string } => entry.snippet !== null);
    const referralValue = explicitReferralValue ?? referralEvidence[0]?.snippet ?? null;
    const oasisValue = explicitOasisValue ?? oasisEvidence[0]?.snippet ?? null;
    const hasDocumentValue = hasMeaningfulValue(referralValue);
    const hasChartValue = hasMeaningfulValue(oasisValue);
    const sourceArtifacts = Array.from(
      new Set([...row.sources.referralArtifacts, ...activeOasisArtifacts]),
    );
    const currentChartValueSource = hasChartValue
      ? activeOasisArtifacts.includes("field-map-snapshot.json")
          ? "chart_read"
          : activeOasisArtifacts.includes("oasis-dom-extracted-state.json")
            ? "portal_dom_state"
            : activeOasisArtifacts.includes("oasis-clinical-fact-pack.json") || oasisEvidence.length > 0
              ? "oasis_fact_pack"
              : "unavailable"
      : "unavailable";
    const oasisEvidenceMode: DashboardOasisEvidenceMode =
      currentChartValueSource === "chart_read"
          ? "chart_read"
          : currentChartValueSource === "portal_dom_state"
            ? "portal_dom_state"
            : currentChartValueSource === "oasis_fact_pack"
              ? "oasis_fact_pack"
              : "unavailable";
    const visibilityDecision: DashboardVisibilityDecision = row.needsReview
      ? "show"
      : "hidden_match";

    return {
      fieldKey: row.fieldKey,
      fieldLabel: metadata?.field.label ?? toTitleCaseFromKey(row.fieldKey),
      sectionKey: metadata?.section.sectionKey ?? rowCategoryKey(row.category),
      sectionLabel: metadata?.section.label ?? row.category,
      sourceSectionLabel: metadata?.section.label ?? row.category,
      reviewMode: metadata?.field.reviewMode ?? "qa_review",
      qaPriority: metadata?.field.qaPriority ?? (row.severity === "high" ? "high" : row.severity),
      oasisItemId: metadata?.field.oasisItemId ?? null,
      backendComparisonStatus: row.verdict,
      backendWorkflowState: row.needsReview ? "needs_qa_readback" : "already_satisfactory",
      displayStatus,
      documentSupportedValue: referralValue,
      currentChartValue: oasisValue,
      normalizedDocumentValue: referralValue ? normalizeDashboardComparisonText(referralValue) : null,
      normalizedChartValue: oasisValue ? normalizeDashboardComparisonText(oasisValue) : null,
      currentChartValueSource,
      currentChartValueSourceLabel: getDashboardPortalValueSourceLabel(currentChartValueSource),
      oasisEvidenceMode,
      oasisEvidenceLabel: getDashboardOasisEvidenceLabel(oasisEvidenceMode),
      displayReferralValue: referralValue ?? "No reliable referral value extracted",
      displayPortalValue: oasisValue ?? "No chart data captured",
      comparisonResult: displayStatus,
      shortReason: sanitizeDashboardDisplayText(row.rationale, "Comparison row requires reviewer confirmation."),
      reviewStatus:
        displayStatus === "match"
          ? "Resolved"
          : displayStatus === "missing_in_portal"
            ? "Missing in Chart Snapshot"
            : displayStatus === "missing_in_referral"
              ? "Missing Referral Documentation"
              : displayStatus === "mismatch"
                ? "Needs Review"
                : "Needs Source Review",
      qaResultLabel: getDashboardQaResultLabel(displayStatus),
      qaActionLabel: getDashboardQaActionLabel(displayStatus),
      referralComparisonOrigin: "llm_referral_proposal" as const,
      referralComparisonOriginLabel: getDashboardReferralOriginLabel("llm_referral_proposal"),
      confidence: confidenceNumberToLabel(row.confidence),
      sourceSupportStrength: hasDocumentValue ? "strong" as const : "none" as const,
      mappingStrength: "strong" as const,
      referralSnippet: referralEvidence[0]?.snippet ?? referralValue,
      portalSnippet: oasisEvidence[0]?.snippet ?? oasisValue,
      evidence: [
        ...referralEvidence.map(({ entry, index, snippet }) => ({
          id: `${row.fieldKey}:referral:${index}`,
          sourceType: entry.sourceType,
          sourceLabel: entry.sourceLabel,
          snippet,
          confidence: confidenceNumberToLabel(entry.confidence ?? row.confidence),
          confidenceLabel:
            typeof entry.confidence === "number"
              ? `${Math.round(entry.confidence * 100)}% confidence`
              : "Confidence not scored",
          pageHint: null,
        })),
        ...oasisEvidence.map(({ entry, index, snippet }) => ({
          id: `${row.fieldKey}:oasis:${index}`,
          sourceType: entry.sourceType,
          sourceLabel: entry.sourceLabel,
          snippet,
          confidence: confidenceNumberToLabel(entry.confidence ?? row.confidence),
          confidenceLabel:
            typeof entry.confidence === "number"
              ? `${Math.round(entry.confidence * 100)}% confidence`
              : "Confidence not scored",
          pageHint: null,
        })),
      ],
      shownByDefault: visibilityDecision === "show",
      visibilityDecision,
      visibilityReason: row.needsReview
        ? "Canonical backend comparison row requires review."
        : "Canonical backend comparison row is resolved and hidden by default.",
      strictnessFlags: [] as string[],
      sourceArtifacts,
      referralDocumentIds: defaultReferralDocumentId ? [defaultReferralDocumentId] : [],
      oasisAssessmentId: currentOasisAssessmentId,
      valuePresence: {
        hasDocumentValue,
        hasChartValue,
        hasPrintedNoteChartValue: false,
        printedNoteSectionKey: null,
        printedNoteSectionStatus: null,
        printedNoteReviewSource: null,
      },
    };
  });

  const hiddenByReason = rows.reduce<Record<string, number>>((accumulator, row) => {
    if (row.visibilityDecision !== "show") {
      accumulator[row.visibilityDecision] = (accumulator[row.visibilityDecision] ?? 0) + 1;
    }
    return accumulator;
  }, {});

  return {
    rows,
    comparisonRowsStatus,
    comparisonRowsReason,
    comparisonRowsRowCount: comparisonRowsStatus === "ready" ? rows.length : comparisonRowsRowCount,
    visibilitySummary: {
      totalRows: rows.length,
      shownRows: rows.filter((row) => row.shownByDefault).length,
      hiddenRows: rows.filter((row) => !row.shownByDefault).length,
      hiddenByReason,
      potentiallyTooStrictRows: [],
    },
    sourceCoverage: {
      printedNoteReviewSource: null,
      printedNoteCompletedSectionCount: 0,
      printedNoteChartValueCount: 0,
      fieldLevelValueCount: rows.filter(
        (row) =>
          row.oasisEvidenceMode === "chart_read" ||
          row.oasisEvidenceMode === "portal_dom_state" ||
          row.oasisEvidenceMode === "oasis_fact_pack",
      ).length,
      sectionEvidenceFallbackRowCount: 0,
    },
  };
}

function getDashboardReferralOriginLabel(origin: DashboardReferralComparisonOrigin): string {
  switch (origin) {
    case "llm_referral_proposal":
      return "LLM referral proposal";
    case "deterministic_referral_fallback":
      return "Deterministic referral fallback";
    case "referral_qa_fallback":
      return "Referral QA fallback";
    default:
      return "Referral provenance unavailable";
  }
}

function getDashboardReviewerLlmStatusLabel(
  status: DashboardReviewerLlmStageSummary["status"],
): string {
  switch (status) {
    case "llm_succeeded":
      return "LLM succeeded";
    case "fallback_used":
      return "Fallback used";
    case "validation_downgraded":
      return "Validation downgraded output";
    default:
      return "Not attempted";
  }
}

function getLlmAuditStage(
  audit: Record<string, unknown> | null,
  stageKey: string,
): Record<string, unknown> | null {
  return (
    asArray(audit?.stages)
      .map((entry) => asRecord(entry))
      .find((entry) => asString(entry?.stage) === stageKey) ?? null
  );
}

function buildReviewerLlmStageSummary(input: {
  stageKey: string;
  label: string;
  stageRecord: Record<string, unknown> | null;
  defaultModelId: string | null;
  overrideStatus?: DashboardReviewerLlmStageSummary["status"];
  overrideNote?: string | null;
}): DashboardReviewerLlmStageSummary {
  const llmAttempted = Boolean(input.stageRecord?.llmAttempted);
  const llmSucceeded = Boolean(input.stageRecord?.llmSucceeded);
  const stageStatus = asString(input.stageRecord?.status);
  const warnings = asArray(input.stageRecord?.warnings)
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null);
  const summary = asString(input.stageRecord?.summary);
  const modelId =
    asString(input.stageRecord?.invocationModelId) ??
    input.defaultModelId;
  const fallbackUsed =
    stageStatus === "fallback" ||
    warnings.some((warning) => warning.toLowerCase().includes("fallback"));
  const status =
    input.overrideStatus ??
    (llmSucceeded
      ? "llm_succeeded"
      : fallbackUsed || llmAttempted
        ? "fallback_used"
        : "not_attempted");
  const note = input.overrideNote ?? summary ?? warnings[0] ?? null;

  return {
    stageKey: input.stageKey,
    label: input.label,
    status,
    statusLabel: getDashboardReviewerLlmStatusLabel(status),
    llmUsed: llmAttempted && llmSucceeded,
    fallbackUsed,
    validationDowngraded: status === "validation_downgraded",
    modelId,
    note,
  };
}

function deriveReviewerLlmDiagnosticsSummary(artifactContents: KnownArtifactContents) {
  const llmAudit = asRecord(artifactContents.llmUsageAudit);
  const generatedPlan = asRecord(artifactContents.generatedPlanOfCare);
  const generatedPlanDiagnostics = asRecord(generatedPlan?.diagnostics);
  const configuredModelId =
    asString(llmAudit?.configuredModelId) ??
    asString(generatedPlanDiagnostics?.modelId) ??
    null;

  const diagnosisExtraction = buildReviewerLlmStageSummary({
    stageKey: "diagnosis_coding_extraction",
    label: "Diagnosis extraction",
    stageRecord: getLlmAuditStage(llmAudit, "diagnosis_coding_extraction"),
    defaultModelId: configuredModelId,
  });
  const printedNoteExtraction = buildReviewerLlmStageSummary({
    stageKey: "printed_note_chart_value_extraction",
    label: "Printed-note extraction",
    stageRecord: getLlmAuditStage(llmAudit, "printed_note_chart_value_extraction"),
    defaultModelId: configuredModelId,
  });
  const referralProposal = buildReviewerLlmStageSummary({
    stageKey: "referral_field_proposals",
    label: "Referral proposal",
    stageRecord: getLlmAuditStage(llmAudit, "referral_field_proposals"),
    defaultModelId: configuredModelId,
  });
  const referralQaInsights = buildReviewerLlmStageSummary({
    stageKey: "referral_qa_insights",
    label: "Referral QA insights",
    stageRecord: getLlmAuditStage(llmAudit, "referral_qa_insights"),
    defaultModelId: configuredModelId,
  });

  const planStageRecord = getLlmAuditStage(llmAudit, "plan_of_care_generation");
  const planStatus = asString(generatedPlan?.status) ?? asString(planStageRecord?.status) ?? "not_attempted";
  const llmUsedForPlan =
    Boolean(planStageRecord?.llmSucceeded) || Boolean(generatedPlanDiagnostics?.llmUsed);
  const validationDowngraded =
    llmUsedForPlan &&
    ["limited_preview", "blocked_missing_evidence"].includes(planStatus);
  const planOfCareGeneration = buildReviewerLlmStageSummary({
    stageKey: "plan_of_care_generation",
    label: "Plan of Care draft",
    stageRecord: planStageRecord,
    defaultModelId: configuredModelId,
    overrideStatus: validationDowngraded
      ? "validation_downgraded"
      : llmUsedForPlan
        ? "llm_succeeded"
        : asString(planStageRecord?.status) === "fallback"
          ? "fallback_used"
          : "not_attempted",
    overrideNote:
      validationDowngraded
        ? `Draft status: ${planStatus}. Validation limited or blocked the draft after LLM generation.`
        : null,
  });

  return {
    diagnosisExtraction,
    printedNoteExtraction,
    referralProposal,
    referralQaInsights,
    planOfCareGeneration,
  };
}

function deriveReferralComparisonOrigin(input: {
  qaDocumentSummary: Record<string, unknown> | null;
  reviewerDiagnostics: ReturnType<typeof deriveReviewerLlmDiagnosticsSummary>;
}): DashboardReferralComparisonOrigin {
  if (input.reviewerDiagnostics.referralProposal.status === "llm_succeeded") {
    return "llm_referral_proposal";
  }
  if (input.reviewerDiagnostics.referralQaInsights.status === "fallback_used") {
    return "referral_qa_fallback";
  }
  const warnings = asArray(input.qaDocumentSummary?.warnings)
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null);
  if (warnings.some((warning) => warning.toLowerCase().includes("deterministic"))) {
    return "deterministic_referral_fallback";
  }
  return "unavailable";
}

function deriveDiagnosisSummary(input: PatientViewInput) {
  const referralDiagnosisSummary = deriveReferralDiagnosisSummary(input);
  const oasisDiagnosisSummary = deriveOasisDiagnosisSummary(input);
  const preferredDiagnosisSummary = referralDiagnosisSummary ?? oasisDiagnosisSummary;
  const sourceFactCount = canUseReferralStructuredFacts(input.artifactContents)
    ? asArray(asRecord(input.artifactContents.sourceClinicalFactPack)?.facts).length
    : 0;
  const oasisFactCount = asArray(asRecord(input.artifactContents.oasisClinicalFactPack)?.facts).length;
  const emptyReferralDiagnosisSummary: DashboardDiagnosisSummary = {
    primaryDiagnosis: null,
    otherDiagnoses: [],
    diagnosisSource: sourceFactCount > 0 ? "no_usable_referral_diagnosis_fact" : null,
  };
  const emptyOasisDiagnosisSummary: DashboardDiagnosisSummary = {
    primaryDiagnosis: null,
    otherDiagnoses: [],
    diagnosisSource: oasisFactCount > 0 ? "no_usable_oasis_diagnosis_fact" : null,
  };

  return {
    primaryDiagnosis: preferredDiagnosisSummary?.primaryDiagnosis ?? null,
    otherDiagnoses: preferredDiagnosisSummary?.otherDiagnoses ?? [],
    diagnosisSource: preferredDiagnosisSummary?.diagnosisSource ??
      (sourceFactCount > 0 || oasisFactCount > 0 ? "insufficient_structured_diagnosis_evidence" : null),
    referralDiagnosisSummary: referralDiagnosisSummary ?? emptyReferralDiagnosisSummary,
    oasisDiagnosisSummary: oasisDiagnosisSummary ?? emptyOasisDiagnosisSummary,
    diagnosisComparisonStatus: deriveDiagnosisComparisonStatus(
      referralDiagnosisSummary,
      oasisDiagnosisSummary,
    ),
  };
}

function buildDiagnosisFieldDocumentValue(input: {
  fieldKey: string;
  diagnosisSummary: ReturnType<typeof deriveDiagnosisSummary>;
  fallbackValue: unknown;
  referralFactsUsable: boolean;
}): unknown {
  if (!isDiagnosisFieldKey(input.fieldKey) && hasMeaningfulValue(input.fallbackValue)) {
    return input.fallbackValue;
  }

  if (isDiagnosisFieldKey(input.fieldKey) && !input.referralFactsUsable) {
    return null;
  }

  if (input.fieldKey === "primary_diagnosis") {
    return input.diagnosisSummary.referralDiagnosisSummary.primaryDiagnosis ?? input.fallbackValue;
  }

  if (input.fieldKey === "secondary_diagnoses") {
    return input.diagnosisSummary.referralDiagnosisSummary.otherDiagnoses.length > 0
      ? input.diagnosisSummary.referralDiagnosisSummary.otherDiagnoses
      : input.fallbackValue;
  }

  if (input.fieldKey === "diagnosis_candidates") {
    const referralEntries = diagnosisSummaryEntries(input.diagnosisSummary.referralDiagnosisSummary);
    return referralEntries.length > 0 ? referralEntries : input.fallbackValue;
  }

  return input.fallbackValue;
}

function deriveQaPrefetchSummary(input: PatientViewInput) {
  const qaPrefetch = asRecord(input.artifactContents.qaPrefetch);
  if (!qaPrefetch) {
    return null;
  }

  const routeDiscovery = asRecord(qaPrefetch.routeDiscovery);
  const oasisRoute = asRecord(qaPrefetch.oasisRoute);
  const diagnosisRoute = asRecord(qaPrefetch.diagnosisRoute);
  const lockStatus = asRecord(qaPrefetch.lockStatus);
  const oasisAssessmentStatus = asRecord(qaPrefetch.oasisAssessmentStatus);
  const billingCalendarSummary = asRecord(qaPrefetch.billingCalendarSummary);
  const selectedEpisode = asRecord(billingCalendarSummary?.selectedEpisode);
  const periods = asRecord(billingCalendarSummary?.periods);
  const first30Days = asRecord(periods?.first30Days);
  const second30Days = asRecord(periods?.second30Days);
  const outsideRange = asRecord(periods?.outsideRange);
  const first30WorkbookColumns = asRecord(first30Days?.workbookColumns);
  const second30WorkbookColumns = asRecord(second30Days?.workbookColumns);
  return {
    status: asString(qaPrefetch.status) ?? "UNKNOWN",
    selectedRouteSummary: asString(qaPrefetch.selectedRouteSummary),
    lockStatus: asString(lockStatus?.status),
    oasisAssessmentPrimaryStatus: asString(oasisAssessmentStatus?.primaryStatus),
    oasisAssessmentStatuses: asArray(oasisAssessmentStatus?.detectedStatuses)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
    oasisAssessmentDecision: asString(oasisAssessmentStatus?.decision),
    oasisAssessmentProcessingEligible:
      typeof oasisAssessmentStatus?.processingEligible === "boolean"
        ? oasisAssessmentStatus.processingEligible
        : null,
    oasisAssessmentReason: sanitizeDashboardDisplayText(asString(oasisAssessmentStatus?.reason)),
    oasisFound: Boolean(oasisRoute?.found),
    diagnosisFound: Boolean(diagnosisRoute?.found),
    visibleDiagnosisCount: asArray(diagnosisRoute?.visibleDiagnoses).length,
    warningCount:
      typeof qaPrefetch.warningCount === "number"
        ? qaPrefetch.warningCount
        : asArray(qaPrefetch.warnings).length,
    topWarning:
      asString(qaPrefetch.topWarning) ??
      asString(routeDiscovery?.topWarning) ??
      null,
    selectedEpisodeRange: asString(selectedEpisode?.rawLabel),
    first30TotalCards: typeof first30Days?.totalCards === "number" ? first30Days.totalCards : 0,
    second30TotalCards: typeof second30Days?.totalCards === "number" ? second30Days.totalCards : 0,
    outsideRangeTotalCards: typeof outsideRange?.totalCards === "number" ? outsideRange.totalCards : 0,
    first30CountsByType: asRecord(first30Days?.countsByType) ?? {},
    second30CountsByType: asRecord(second30Days?.countsByType) ?? {},
    first30WorkbookColumns: {
      sn: asString(first30WorkbookColumns?.sn) ?? "NA",
      ptOtSt: asString(first30WorkbookColumns?.ptOtSt) ?? "NA",
      hhaMsw: asString(first30WorkbookColumns?.hhaMsw) ?? "NA",
    },
    second30WorkbookColumns: {
      sn: asString(second30WorkbookColumns?.sn) ?? "NA",
      ptOtSt: asString(second30WorkbookColumns?.ptOtSt) ?? "NA",
      hhaMsw: asString(second30WorkbookColumns?.hhaMsw) ?? "NA",
    },
    printedNoteStatus: null,
    printedNoteAssessmentType: null,
    printedNoteReviewSource: null,
    printedNoteWarningCount: 0,
    printedNoteTopWarning: null,
    printedNoteCompletedSectionCount: 0,
    printedNoteIncompleteSectionCount: 0,
    printedNotePrintButtonDetected: false,
    printedNotePrintClickSucceeded: false,
    printedNoteExtractionMethod: null,
    printedNoteTextLength: 0,
    printedNoteSections: [],
  };
}

function deriveWorkflowTrack(
  input: PatientViewInput,
  workflowDomain: "coding" | "qa",
) {
  const workflowRun = input.summary.workflowRuns.find((candidate) => candidate.workflowDomain === workflowDomain);
  if (!workflowRun) {
    return null;
  }

  return {
    workflowRunId: workflowRun.workflowRunId,
    workflowDomain: workflowRun.workflowDomain,
    status: workflowRun.status,
    stepName: workflowRun.stepName,
    message: sanitizeDashboardDisplayText(
      workflowRun.message ?? null,
      workflowRun.status === "FAILED" || workflowRun.status === "BLOCKED"
        ? "Read-only extraction produced low-quality evidence; source confirmation required."
        : null,
    ),
    chartUrl: workflowRun.chartUrl ?? null,
    workflowResultPath: workflowRun.workflowResultPath ?? null,
    workflowLogPath: workflowRun.workflowLogPath ?? null,
    lastUpdatedAt: workflowRun.lastUpdatedAt,
  };
}

function deriveFieldDiscrepancyRating(comparisonStatus: string, workflowState: string): DashboardDiscrepancyRating {
  if (
    workflowState === "needs_coding_review" ||
    workflowState === "possible_conflict" ||
    workflowState === "missing_in_chart" ||
    comparisonStatus === "possible_conflict" ||
    comparisonStatus === "missing_in_chart"
  ) {
    return "red";
  }

  if (
    workflowState === "needs_qa_readback" ||
    workflowState === "supported_by_referral" ||
    comparisonStatus === "needs_qa_readback" ||
    comparisonStatus === "supported_by_referral"
  ) {
    return "yellow";
  }

  return "green";
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return false;
}

function humanizeCodeLikeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(trimmed)) {
    return trimmed.replace(/[_-]+/g, " ").toLowerCase();
  }

  return trimmed;
}

function parseStructuredString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("{") && (trimmed.includes("},{") || trimmed.includes("}, {"))) {
    try {
      return JSON.parse(`[${trimmed}]`);
    } catch {
      return null;
    }
  }

  return null;
}

function formatSerializedDiagnosisString(value: string): string | null {
  const matches = Array.from(
    value.matchAll(/"description"\s*:\s*"([^"]+)"[\s\S]*?"icd10_code"\s*:\s*"([^"]+)"/g),
  );
  if (matches.length === 0) {
    return null;
  }

  return matches
    .map((match) => `${humanizeCodeLikeToken(match[1] ?? "")} (${match[2] ?? ""})`)
    .join("; ");
}

function formatReadableString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsedStructuredValue = parseStructuredString(trimmed);
  if (parsedStructuredValue !== null) {
    return formatDashboardValue(parsedStructuredValue);
  }

  const serializedDiagnosisSummary = formatSerializedDiagnosisString(trimmed);
  if (serializedDiagnosisSummary) {
    return serializedDiagnosisSummary;
  }

  if (trimmed.includes("\n")) {
    return trimmed
      .split("\n")
      .map((line) => formatReadableString(line))
      .filter((line) => line.length > 0)
      .join("\n");
  }

  if (!trimmed.includes(",")) {
    return humanizeCodeLikeToken(trimmed);
  }

  return trimmed
    .split(",")
    .map((segment) => humanizeCodeLikeToken(segment))
    .filter((segment) => segment.length > 0)
    .join(", ");
}

function formatDiagnosisLikeRecord(record: Record<string, unknown>): string | null {
  const description = asString(record.description) ?? asString(record.label) ?? asString(record.name);
  const code = asString(record.icd10_code) ?? asString(record.code);
  if (!description && !code) {
    return null;
  }

  if (description && code) {
    return `${formatReadableString(description)} (${code})`;
  }

  return formatReadableString(description ?? code ?? "");
}

function formatDashboardValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return formatReadableString(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => formatDashboardValue(entry))
      .filter((entry) => entry.length > 0)
      .join("; ");
  }

  const record = asRecord(value);
  if (!record) {
    return String(value);
  }

  const diagnosisSummary = formatDiagnosisLikeRecord(record);
  if (diagnosisSummary) {
    return diagnosisSummary;
  }

  const genericEntries = Object.entries(record)
    .map(([key, entryValue]) => {
      const formattedEntryValue = formatDashboardValue(entryValue);
      if (!formattedEntryValue) {
        return null;
      }

      return `${toTitleCaseFromKey(key)}: ${formattedEntryValue}`;
    })
    .filter((entry): entry is string => entry !== null);

  return genericEntries.join("; ");
}

function stringifyDashboardValue(value: unknown): string {
  return formatDashboardValue(value);
}

function toTitleCaseFromKey(value: string): string {
  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

const SECTION_GUIDANCE_BY_KEY: Record<string, {
  mustCheck: string[];
  requiredLogic: string[];
  saveReminder: string;
  escalationGuidance: string[];
}> = {
  administrative_information: {
    mustCheck: [
      "Confirm referral date, hospitalization details, caregiver support, language, and contact information.",
      "Verify low-value demographics only when they affect routing or required OASIS items.",
    ],
    requiredLogic: [
      "Do not let administrative fields block clinical QA unless they affect workflow timing, hospitalization context, or caregiver contact.",
    ],
    saveReminder: "Save after confirming referral demographics and caregiver details before moving into clinical sections.",
    escalationGuidance: [
      "Escalate missing hospitalization or referral timing only if the chart cannot be reconciled from uploaded records.",
    ],
  },
  active_diagnoses: {
    mustCheck: [
      "Review primary and secondary diagnosis support, coding-sensitive evidence, and escalation flags.",
      "Confirm diagnosis support aligns with hospital and referral documentation before completing diagnosis review.",
    ],
    requiredLogic: [
      "Diagnosis additions, removals, or sequencing changes belong with coding, not QA direct editing.",
    ],
    saveReminder: "Do not finalize diagnosis changes here. Save notes and route coding-sensitive items before proceeding.",
    escalationGuidance: [
      "Route diagnosis conflicts or unsupported diagnosis recommendations to coding.",
    ],
  },
  vital_signs_and_pain_assessment: {
    mustCheck: [
      "Verify vitals, pain presence, pain tool use, and pain narrative are documented before QA sign-off.",
      "Check bowel movement date and other required visit-support details when this section is sparse.",
    ],
    requiredLogic: [
      "Pain documentation should support the subsequent J0510/J0520/J0530 logic and not contradict the clinical narrative.",
    ],
    saveReminder: "Save once required vitals and pain documentation are confirmed or escalated.",
    escalationGuidance: [
      "Escalate missing vitals or pain scoring that require clinician verification.",
    ],
  },
  medication_allergies_and_injectables: {
    mustCheck: [
      "Confirm medication list, allergies, injectables, special treatments, and high-risk medication notes.",
      "Review whether referral medications should be suggested into the chart but not finalized without review.",
    ],
    requiredLogic: [
      "Medication additions can be suggested from referral records, but they still require clinical review before finalization.",
    ],
    saveReminder: "Save after documenting medication discrepancies and forwarding unresolved medication issues for review.",
    escalationGuidance: [
      "Escalate medication additions or unsafe discrepancies for clinician review rather than direct QA finalization.",
    ],
  },
  neurological_head_mood_eyes_ears: {
    mustCheck: [
      "Review mental, neurological, mood, vision, hearing, and emotional documentation for completeness.",
      "Confirm depression or mood-related documentation is reflected when diagnoses or history suggest it should be present.",
    ],
    requiredLogic: [
      "Mental-status, mood, and related OASIS items should not contradict each other across sections.",
    ],
    saveReminder: "Save after cross-checking mental, vision, hearing, and mood findings.",
    escalationGuidance: [
      "Escalate uncertain clinical interpretation of mental-status findings for human review.",
    ],
  },
  cardiopulmonary_chest_thorax: {
    mustCheck: [
      "Check cardiopulmonary findings, shortness of breath logic, oxygen references, and respiratory detail completeness.",
    ],
    requiredLogic: [
      "Respiratory findings should support M1400-related shortness-of-breath selections and not conflict with the narrative.",
    ],
    saveReminder: "Save after cardiopulmonary and respiratory consistency is reviewed.",
    escalationGuidance: [
      "Escalate missing or clinically uncertain respiratory findings for clinician verification.",
    ],
  },
  gastrointestinal_and_genitourinary_assessment: {
    mustCheck: [
      "Review GI/GU findings, bowel documentation, bladder status, and diet or fluid instructions when available.",
    ],
    requiredLogic: [
      "GI/GU documentation should align with current symptoms, bowel details, and nutritional instructions from source records.",
    ],
    saveReminder: "Save after GI/GU completeness is checked and missing bowel documentation is noted.",
    escalationGuidance: [
      "Escalate missing bowel or GU documentation when it requires clinician confirmation.",
    ],
  },
  integumentary_skin_and_wound: {
    mustCheck: [
      "Verify wound status, skin findings, wound worksheet support, and Norton Scale documentation.",
      "Confirm wound details align with the wound worksheet and supporting clinical documents.",
    ],
    requiredLogic: [
      "Wound answers should be consistent across integumentary details, wound worksheet content, and risk tools.",
    ],
    saveReminder: "Save after wound details and skin-risk tools are checked together.",
    escalationGuidance: [
      "Escalate unclear wound staging or missing wound worksheet documentation for clinician review.",
    ],
  },
  safety_and_risk_assessment: {
    mustCheck: [
      "Review MAHC-10, fall risk narrative, hospitalization risk, code status, and other safety tools.",
    ],
    requiredLogic: [
      "Risk scores and safety narratives should align with fall history, hospitalization risk, and code-status documentation.",
    ],
    saveReminder: "Save after fall-risk tools and safety narratives are reconciled.",
    escalationGuidance: [
      "Escalate missing risk scores that require clinician verification.",
    ],
  },
  functional_assessment_self_care: {
    mustCheck: [
      "Confirm self-care scoring and ADL support evidence before leaving the section.",
    ],
    requiredLogic: [
      "Functional scoring should align with therapy notes and other functional limitations documented elsewhere.",
    ],
    saveReminder: "Save after self-care scoring is reconciled with source therapy documentation.",
    escalationGuidance: [
      "Escalate unclear functional scoring when the referral evidence is ambiguous.",
    ],
  },
  functional_assessment_mobility_and_musculoskeletal: {
    mustCheck: [
      "Review mobility scoring, functional limitations, prior level of function, and homebound support.",
    ],
    requiredLogic: [
      "Functional M-items should align with GG0130/GG0170 scoring, prior functioning, and homebound rationale.",
    ],
    saveReminder: "Save after mobility scoring and homebound-related content are aligned.",
    escalationGuidance: [
      "Escalate clinician-dependent functional interpretation when referral support is incomplete.",
    ],
  },
  endocrine_diabetic_management: {
    mustCheck: [
      "Check diabetic management, PMH references, immunizations, and disease-management support when present.",
    ],
    requiredLogic: [
      "Diabetic status should align with PMH, medication profile, and plan-of-care instructions when documented.",
    ],
    saveReminder: "Save after endocrine and diabetic management details are either confirmed or clearly marked missing.",
    escalationGuidance: [
      "Escalate uncertain diabetic management interpretation for human review.",
    ],
  },
  plan_of_care_and_physical_therapy_evaluation: {
    mustCheck: [
      "Verify plan-of-care components, discipline frequencies, therapy need, skilled interventions, and care coordination orders.",
    ],
    requiredLogic: [
      "Plan-of-care recommendations should be supported by referral orders and therapy evaluation content.",
    ],
    saveReminder: "Save after frequencies, interventions, and therapy guidance are reviewed together.",
    escalationGuidance: [
      "Escalate missing physician-order or discipline-frequency detail that cannot be supported from uploaded records.",
    ],
  },
  patient_summary_and_clinical_narrative: {
    mustCheck: [
      "Review medical necessity, admit reason, patient summary narrative, PMH, and supporting hospitalization context.",
    ],
    requiredLogic: [
      "The patient summary and medical necessity draft should be consistent with diagnoses, respiratory findings, and hospitalization history.",
    ],
    saveReminder: "Save after the narrative draft is reviewed and obvious unsupported language is removed.",
    escalationGuidance: [
      "Escalate diagnosis-driven narrative conflicts to coding instead of editing diagnosis content in QA.",
    ],
  },
  care_plan_problems_goals_interventions: {
    mustCheck: [
      "Confirm care plan problems, goals, interventions, plan for next visit, and patient/caregiver goals.",
    ],
    requiredLogic: [
      "Care-plan goals and next-visit plans should logically follow the documented needs and skilled interventions.",
    ],
    saveReminder: "Save after goals, interventions, and next-visit planning are reviewed as a set.",
    escalationGuidance: [
      "Escalate care-plan content only when the recommendation depends on unsupported clinical interpretation.",
    ],
  },
  footer_non_print_preview: {
    mustCheck: [
      "Ignore fax-server chrome, signatures, and non-print elements unless they contain required source details.",
    ],
    requiredLogic: [
      "Do not let footer or fax-server metadata drive clinical recommendations.",
    ],
    saveReminder: "No save action is usually needed for footer-only content.",
    escalationGuidance: [
      "No escalation is usually needed unless footer text is the only source for a required identifier or date.",
    ],
  },
};

function deriveRecommendationOwner(field: {
  reviewMode: string;
  workflowState: string;
  fieldKey: string;
  sectionKey: string;
}): string {
  if (field.reviewMode === "coding_review_required" || field.workflowState === "needs_coding_review") {
    return "Coding";
  }

  if (
    field.workflowState === "missing_in_chart" &&
    [
      "vital_signs_and_pain_assessment",
      "cardiopulmonary_chest_thorax",
      "integumentary_skin_and_wound",
      "safety_and_risk_assessment",
      "gastrointestinal_and_genitourinary_assessment",
    ].includes(field.sectionKey)
  ) {
    return "Clinician Verification";
  }

  if (
    ["medication_list", "allergy_list", "injectable_medications", "special_treatments_o0110"].includes(field.fieldKey)
  ) {
    return "Clinical Review";
  }

  if (field.workflowState === "possible_conflict") {
    return "Human Review";
  }

  return "QA";
}

function deriveRecommendationLabel(field: {
  label: string;
  sectionLabel: string;
  reviewMode: string;
  workflowState: string;
  recommendedAction: string;
}): string {
  if (field.reviewMode === "coding_review_required" || field.workflowState === "needs_coding_review") {
    return `Referral documents contain coding-relevant support for ${field.label}.`;
  }

  if (field.workflowState === "possible_conflict") {
    return `Referral and chart data do not currently agree for ${field.label}.`;
  }

  if (field.workflowState === "missing_in_chart" && field.reviewMode === "chart_completeness_check") {
    return `The chart is currently missing required ${field.label} documentation for ${field.sectionLabel}.`;
  }

  if (field.workflowState === "missing_in_chart") {
    return `The referral documents support ${field.label}, but the chart does not currently show a completed value.`;
  }

  if (field.workflowState === "needs_qa_readback") {
    return `The referral documents provide a chart-ready answer for ${field.label}.`;
  }

  if (field.workflowState === "supported_by_referral") {
    return `The referral documents clearly support ${field.label}.`;
  }

  if (field.recommendedAction === "reference_only") {
    return `${field.label} is being shown as referral reference data only.`;
  }

  return `Referral evidence was organized for ${field.label} in ${field.sectionLabel}.`;
}

function deriveRecommendationValue(field: {
  label: string;
  documentSupportedValue: unknown;
  currentChartValue: unknown;
  workflowState: string;
}): string {
  if (hasMeaningfulValue(field.documentSupportedValue)) {
    return stringifyDashboardValue(field.documentSupportedValue);
  }

  if (hasMeaningfulValue(field.currentChartValue) && field.workflowState !== "missing_in_chart") {
    return `No stronger referral recommendation found. Current chart value: ${stringifyDashboardValue(field.currentChartValue)}`;
  }

  return `No clear referral-supported recommendation for ${field.label}. Human review is still required.`;
}

function deriveRecommendationRationale(field: {
  reviewMode: string;
  workflowState: string;
  sourceEvidence: Array<{ textSpan?: string | null; sourceLabel: string }>;
  sectionLabel: string;
}): string {
  const firstEvidence = field.sourceEvidence.find((entry) => asString(entry.textSpan) !== null);
  if (firstEvidence?.textSpan) {
    return firstEvidence.textSpan;
  }

  if (field.sourceEvidence[0]?.sourceLabel) {
    return `Supported by ${field.sourceEvidence[0].sourceLabel}.`;
  }

  if (field.workflowState === "missing_in_chart") {
    return `No chart value is currently visible for this field in ${field.sectionLabel}.`;
  }

  if (field.reviewMode === "chart_completeness_check") {
    return `This item is part of the required completeness logic for ${field.sectionLabel}.`;
  }

  return `Statement derived from uploaded referral evidence organized under ${field.sectionLabel}.`;
}

function deriveRecommendationConfidenceLabel(sourceEvidence: Array<{ confidence?: number | null }>): string {
  const confidences = sourceEvidence
    .map((entry) => (typeof entry.confidence === "number" ? entry.confidence : null))
    .filter((confidence): confidence is number => confidence !== null);
  if (confidences.length === 0) {
    return "Needs review";
  }

  const maxConfidence = Math.max(...confidences);
  if (maxConfidence >= 0.9) {
    return "High confidence";
  }

  if (maxConfidence >= 0.75) {
    return "Moderate confidence";
  }

  return "Low confidence";
}

function deriveFieldSnapshotLookup(input: PatientViewInput) {
  const fieldMapSnapshot = asRecord(input.artifactContents.fieldMapSnapshot);
  const snapshotFields = asArray(fieldMapSnapshot?.fields);
  const snapshotByFieldKey = new Map<
    string,
    {
      currentChartValue: unknown;
      currentChartValueSource: string;
      populatedInChart: boolean;
    }
  >();

  for (const snapshotFieldValue of snapshotFields) {
    const snapshotField = asRecord(snapshotFieldValue);
    const fieldKey = asString(snapshotField?.key);
    if (!fieldKey) {
      continue;
    }

    const rawChartValueSource = asString(snapshotField?.currentChartValueSource);
    const legacyPrintedNoteSource = isLegacyPrintedNoteValueSource(rawChartValueSource);
    const currentChartValue = legacyPrintedNoteSource ? null : sanitizeDiagnosisFieldValue(
      fieldKey,
      snapshotField?.currentChartValue ?? null,
    );
    snapshotByFieldKey.set(fieldKey, {
      currentChartValue,
      currentChartValueSource: legacyPrintedNoteSource
        ? "unavailable"
        : rawChartValueSource ?? "unavailable",
      populatedInChart:
        legacyPrintedNoteSource
          ? false
          : typeof snapshotField?.populatedInChart === "boolean"
          ? snapshotField.populatedInChart && hasMeaningfulValue(currentChartValue)
          : hasMeaningfulValue(currentChartValue),
    });
  }

  return snapshotByFieldKey;
}

function deriveOasisValidationSummary(input: PatientViewInput) {
  const validation = asRecord(input.artifactContents.oasisValidation);
  if (!validation) {
    return null;
  }

  const missingFields = asArray(validation.missingFields)
    .map((fieldValue) => {
      const field = asRecord(fieldValue);
      const label = asString(field?.label);
      if (!field || !label) {
        return null;
      }

      return {
        fieldId: asString(field.fieldId),
        label,
        section: asString(field.section),
        mItem: asString(field.mItem),
        message: asString(field.message),
        selectorUsed: asString(field.selectorUsed),
      };
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);

  return {
    status: asString(validation.status) ?? "validation_unavailable",
    validatedAt: asString(validation.validatedAt) ?? input.summary.lastUpdatedAt,
    validateSelectorUsed: asString(validation.validateSelectorUsed),
    currentUrl: asString(validation.currentUrl),
    missingFieldCount: asNumber(validation.missingFieldCount) ?? missingFields.length,
    missingFields,
    rawMessages: asArray(validation.rawMessages)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
    warnings: asArray(validation.warnings)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
  };
}

function deriveReferralOasisConsistencySummary(input: PatientViewInput) {
  const consistency = asRecord(input.artifactContents.referralOasisConsistency);
  if (!consistency) {
    return null;
  }

  const findings = asArray(consistency.findings)
    .map((findingValue) => {
      const finding = asRecord(findingValue);
      const id = asString(finding?.id);
      const category = asString(finding?.category);
      const label = asString(finding?.label);
      const confidence = asString(finding?.confidence);
      const referralEvidence = asString(finding?.referralEvidence);
      const oasisEvidence = asString(finding?.oasisEvidence);
      const reviewerExplanation = asString(finding?.reviewerExplanation);
      if (
        !finding ||
        !id ||
        !category ||
        !label ||
        !confidence ||
        !referralEvidence ||
        !oasisEvidence ||
        !reviewerExplanation
      ) {
        return null;
      }

      return {
        id,
        category,
        label,
        confidence,
        referralEvidence,
        oasisEvidence,
        reviewerExplanation,
        blocksPlanOfCare: Boolean(finding.blocksPlanOfCare),
      };
    })
    .filter((finding): finding is NonNullable<typeof finding> => finding !== null);

  return {
    status: asString(consistency.status) ?? "consistency_unavailable",
    generatedAt: asString(consistency.generatedAt) ?? input.summary.lastUpdatedAt,
    findingCount: asNumber(consistency.findingCount) ?? findings.length,
    blockingFindingCount:
      asNumber(consistency.blockingFindingCount) ??
      findings.filter((finding) => finding.blocksPlanOfCare).length,
    findings,
    warnings: asArray(consistency.warnings)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
  };
}

function deriveOasisGateSummary(input: PatientViewInput) {
  const gate = asRecord(input.artifactContents.oasisGate);
  if (!gate) {
    return null;
  }

  return {
    evaluatedAt: asString(gate.evaluatedAt) ?? input.summary.lastUpdatedAt,
    status: asString(gate.status) ?? "unavailable",
    blockedFromPlanOfCare: Boolean(gate.blockedFromPlanOfCare),
    missingFieldCount: asNumber(gate.missingFieldCount) ?? 0,
    contradictionCount: asNumber(gate.contradictionCount) ?? 0,
    topReasons: asArray(gate.topReasons)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
    planOfCareAttempted: Boolean(gate.planOfCareAttempted),
    planOfCareAttemptSkippedReason: asString(gate.planOfCareAttemptSkippedReason),
  };
}

function deriveGeneratedPlanOfCareSummary(input: PatientViewInput) {
  const draft = asRecord(input.artifactContents.generatedPlanOfCare);
  if (!draft) {
    return null;
  }

  const sourceSummary = asRecord(draft.sourceSummary);
  const diagnostics = asRecord(draft.diagnostics);
  const readablePlan = asRecord(draft.readablePlan);
  const pocPreview = asRecord(draft.pocPreview);
  const evidenceMap = asRecord(draft.evidenceMap);
  const stageStatus = asRecord(draft.stageStatus);
  const problems = asArray(draft.problems)
    .map((problemValue) => {
      const problem = asRecord(problemValue);
      const label = asString(problem?.problem);
      const clinicalRationale = asString(problem?.clinicalRationale);
      if (!problem || !label || !clinicalRationale) {
        return null;
      }

        return {
          problem: label,
          domain: asString(problem?.domain),
          planSummary:
            asString(problem?.planSummary) ??
            clinicalRationale,
          clinicalRationale,
          evidence: asArray(problem.evidence)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
          evidenceIds: asArray(problem.evidenceIds)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
          goals: asArray(problem.goals)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
          interventions: asArray(problem.interventions)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
          interventionEvidence: asArray(problem.interventionEvidence)
            .map((entryValue) => {
              const entry = asRecord(entryValue);
              const intervention = asString(entry?.intervention);
              if (!entry || !intervention) {
                return null;
              }

              return {
                intervention,
                evidenceIds: asArray(entry.evidenceIds)
                  .map((value) => asString(value))
                  .filter((value): value is string => value !== null),
              };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
          questionBankMatches: asArray(problem.questionBankMatches)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
          candidateProblemLabels: asArray(problem.candidateProblemLabels)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
        };
      })
      .filter((problem): problem is NonNullable<typeof problem> => problem !== null);

  const mapEvidenceBucket = (bucketName: string) =>
    asArray(evidenceMap?.[bucketName])
      .map((entryValue) => {
        const entry = asRecord(entryValue);
        const id = asString(entry?.id);
        const category = asString(entry?.category);
        const label = asString(entry?.label);
        const text = asString(entry?.text);
        if (!entry || !id || !category || !label || !text) {
          return null;
        }

        return {
          id,
          category,
          label,
          text,
          sourceLabel: asString(entry.sourceLabel),
          sourceType: asString(entry.sourceType),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    status: asString(draft.status) ?? "not_attempted",
    finalPreviewStatus: asString(draft.finalPreviewStatus) ?? asString(draft.status) ?? "not_attempted",
    generatedAt: asString(draft.generatedAt) ?? input.summary.lastUpdatedAt,
    questionBankVersion: asString(draft.questionBankVersion),
    reviewRequired: draft.reviewRequired !== false,
    generationMode: asString(draft.generationMode) ?? "generate_once_then_freeze",
    sourceSummary: {
      oasisValidationTimestamp: asString(sourceSummary?.oasisValidationTimestamp),
      oasisGateTimestamp: asString(sourceSummary?.oasisGateTimestamp),
      keyClinicalSignals: asArray(sourceSummary?.keyClinicalSignals)
        .map((value) => asString(value))
        .filter((value): value is string => value !== null),
    },
    stageStatus: Object.fromEntries(
      Object.entries(stageStatus ?? {}).flatMap(([key, value]) => {
        const entry = asRecord(value);
        const state = asString(entry?.state);
        if (!entry || !state) {
          return [];
        }

        return [[key, { state, note: asString(entry.note) }]];
      }),
    ),
    validationFindings: asArray(draft.validationFindings)
      .map((findingValue) => {
        const finding = asRecord(findingValue);
        const severity = asString(finding?.severity);
        const category = asString(finding?.category);
        const message = asString(finding?.message);
        const action = asString(finding?.action);
        if (!finding || !severity || !category || !message || !action) {
          return null;
        }

        return {
          severity: severity === "error" ? "error" : "warning",
          category,
          message,
          affectedProblem: asString(finding.affectedProblem),
          affectedIntervention: asString(finding.affectedIntervention),
          action:
            action === "pruned" || action === "retained" || action === "added" || action === "blocked"
              ? action
              : "retained",
        };
      })
      .filter((finding): finding is NonNullable<typeof finding> => finding !== null),
    evidenceMap: {
      diagnoses: mapEvidenceBucket("diagnoses"),
      medications: mapEvidenceBucket("medications"),
      woundFacts: mapEvidenceBucket("woundFacts"),
      respiratoryFacts: mapEvidenceBucket("respiratoryFacts"),
      mobilityFacts: mapEvidenceBucket("mobilityFacts"),
      cognitionFacts: mapEvidenceBucket("cognitionFacts"),
      dysphagiaNutritionFacts: mapEvidenceBucket("dysphagiaNutritionFacts"),
      cardiacFacts: mapEvidenceBucket("cardiacFacts"),
      oasisChartFacts: mapEvidenceBucket("oasisChartFacts"),
      referralSkilledNeedFacts: mapEvidenceBucket("referralSkilledNeedFacts"),
    },
    consolidatedProblems: asArray(draft.consolidatedProblems)
      .map((problemValue) => {
        const problem = asRecord(problemValue);
        const label = asString(problem?.problem);
        const domain = asString(problem?.domain);
        const rationale = asString(problem?.rationale);
        if (!problem || !label || !domain || !rationale) {
          return null;
        }

        return {
          problem: label,
          domain,
          rationale,
          candidateProblemLabels: asArray(problem.candidateProblemLabels)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
          supportingEvidenceIds: asArray(problem.supportingEvidenceIds)
            .map((value) => asString(value))
            .filter((value): value is string => value !== null),
        };
      })
      .filter((problem): problem is NonNullable<typeof problem> => problem !== null),
    pocPreview: {
      title: asString(pocPreview?.title) ?? "Plan of Care Preview",
      patientSummary: asString(pocPreview?.patientSummary) ?? "No patient summary available.",
      sections: asArray(pocPreview?.sections)
        .map((sectionValue) => {
          const section = asRecord(sectionValue);
          const heading = asString(section?.heading);
          const body = asString(section?.body);
          if (!section || !heading || !body) {
            return null;
          }

          return {
            heading,
            body,
            items: asArray(section.items)
              .map((itemValue) => {
                const item = asRecord(itemValue);
                const label = asString(item?.label);
                const text = asString(item?.text);
                if (!item || !label || !text) {
                  return null;
                }

                return { label, text };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null),
          };
        })
        .filter((section): section is NonNullable<typeof section> => section !== null),
      clinicalCautions: asArray(pocPreview?.clinicalCautions)
        .map((value) => asString(value))
        .filter((value): value is string => value !== null),
    },
    readablePlan: readablePlan
      ? {
          title: asString(readablePlan.title) ?? "AI Plan of Care",
          summary: asString(readablePlan.summary) ?? "No readable summary available.",
          sections: asArray(readablePlan.sections)
            .map((sectionValue) => {
              const section = asRecord(sectionValue);
              const heading = asString(section?.heading);
              const body = asString(section?.body);
              if (!section || !heading || !body) {
                return null;
              }

              return {
                heading,
                body,
                bullets: asArray(section.bullets)
                  .map((value) => asString(value))
                  .filter((value): value is string => value !== null),
              };
            })
            .filter((section): section is NonNullable<typeof section> => section !== null),
        }
      : null,
    problems,
    warnings: asArray(draft.warnings)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
    diagnostics: {
      llmUsed: Boolean(diagnostics?.llmUsed),
      modelId: asString(diagnostics?.modelId),
      retrievedProblemCount: asNumber(diagnostics?.retrievedProblemCount) ?? problems.length,
      promptCharacterEstimate: asNumber(diagnostics?.promptCharacterEstimate) ?? 0,
    },
  };
}

function deriveReferralQaSummary(input: PatientViewInput) {
  const patientQaReference = isPatientQaReference(input.artifactContents.patientQaReference)
    ? input.artifactContents.patientQaReference
    : null;
  const qaDocumentSummary = asRecord(input.artifactContents.qaDocumentSummary);
  const fieldSnapshotLookup = deriveFieldSnapshotLookup(input);
  const diagnosisSummary = deriveDiagnosisSummary(input);
  const extractionUsabilityStatus =
    asString(qaDocumentSummary?.extractionUsabilityStatus) ??
    (patientQaReference ? "usable" : "missing");
  const warnings = asArray(qaDocumentSummary?.warnings)
    .map((warning) => asString(warning))
    .filter((warning): warning is string => warning !== null);
  const reviewQueue = patientQaReference?.qaReviewQueue ?? [];
  const availableSectionCount = patientQaReference
    ? patientQaReference.referralDashboardSections.filter((section) => section.textSpans.length > 0).length
    : 0;
  const totalSectionCount =
    patientQaReference?.referralDashboardSections.length ??
    asNumber(qaDocumentSummary?.normalizedSectionCount) ??
    0;
  const llmProposalCount = asNumber(qaDocumentSummary?.llmProposalCount);
  const referralDataAvailable =
    extractionUsabilityStatus === "usable" ||
    patientQaReference !== null ||
    asString(qaDocumentSummary?.selectedDocumentId) !== null;
  const possibleConflictCount = reviewQueue.filter((entry) => entry.workflowState === "possible_conflict").length;
  const codingReviewCount = reviewQueue.filter((entry) => entry.workflowState === "needs_coding_review").length;
  const missingInChartCount = reviewQueue.filter((entry) => entry.workflowState === "missing_in_chart").length;
  const qaReadbackCount = reviewQueue.filter((entry) => entry.workflowState === "needs_qa_readback").length;
  const supportedByReferralCount = reviewQueue.filter((entry) => entry.workflowState === "supported_by_referral").length;
  const criticalCount = reviewQueue.filter((entry) => {
    if (entry.qaPriority !== "critical") {
      return false;
    }

    return ["missing_in_chart", "possible_conflict", "needs_coding_review"].includes(entry.workflowState);
  }).length;
  const warningCount = reviewQueue.length - criticalCount;

  let discrepancyRating: DashboardDiscrepancyRating = "green";
  if (
    !referralDataAvailable ||
    extractionUsabilityStatus !== "usable" ||
    codingReviewCount > 0 ||
    possibleConflictCount > 0 ||
    criticalCount > 0
  ) {
    discrepancyRating = "red";
  } else if (reviewQueue.length > 0 || warnings.length > 0) {
    discrepancyRating = "yellow";
  }

  const qaStatus = !referralDataAvailable
    ? "Referral data missing"
    : extractionUsabilityStatus !== "usable"
      ? "Referral extraction blocked"
      : discrepancyRating === "red"
        ? "Needs QA attention"
        : discrepancyRating === "yellow"
          ? "QA review in progress"
          : "Ready for QA sign-off";
  const summaryHeadline = !referralDataAvailable
    ? "Referral documentation missing"
    : extractionUsabilityStatus !== "usable"
      ? "Referral extraction incomplete"
      : discrepancyRating === "red"
        ? "Referral evidence requires follow-up"
        : discrepancyRating === "yellow"
          ? "Referral review still needs follow-up"
          : "Referral evidence usable";
  const summaryDetail = !referralDataAvailable
    ? "No usable referral document is available for this patient yet."
    : extractionUsabilityStatus !== "usable"
      ? "The referral document was captured, but the structured extraction is incomplete or unreliable."
      : codingReviewCount > 0
        ? "Referral evidence is available, but diagnosis and coding items still require review before sign-off."
        : possibleConflictCount > 0 || criticalCount > 0
          ? "Referral evidence is available, but important discrepancies still need reconciliation before QA sign-off."
          : reviewQueue.length > 0 || warnings.length > 0
            ? "Referral evidence is available and partially structured, but follow-up items remain open."
            : "Referral evidence is available and structured for QA review.";
  const displayWarnings = !referralDataAvailable
    ? ["Referral follow-up is required before the comparison can be fully trusted."]
    : extractionUsabilityStatus !== "usable"
      ? ["Review referral follow-up items before treating the comparison as complete."]
      : codingReviewCount > 0
        ? ["Coding-sensitive referral items still need review before sign-off."]
        : possibleConflictCount > 0 || criticalCount > 0
          ? ["Important referral discrepancies still require reconciliation."]
          : reviewQueue.length > 0 || warnings.length > 0
            ? ["Referral review is still in progress for at least one section."]
            : [];
  const sections = patientQaReference?.referralDashboardSections.map((section) => {
    const fields = section.fieldKeys
      .map((fieldKey) => {
        const registryEntry =
          patientQaReference.fieldRegistry.find((candidate) => candidate.fieldKey === fieldKey) ?? null;
        const comparisonResult = patientQaReference.comparisonResults[fieldKey] ?? null;
        if (!registryEntry || !comparisonResult) {
          return null;
        }

        const fieldSnapshot = fieldSnapshotLookup.get(fieldKey);
        const currentChartValue = sanitizeDiagnosisFieldValue(
          fieldKey,
          fieldSnapshot?.currentChartValue ?? comparisonResult.currentChartValue,
        );
        const currentChartValueSource = fieldSnapshot?.currentChartValueSource ?? "unavailable";
        const populatedInChart = fieldSnapshot?.populatedInChart ?? hasMeaningfulValue(currentChartValue);
        const documentSupportedValue = buildDiagnosisFieldDocumentValue({
          fieldKey,
          diagnosisSummary,
          fallbackValue: comparisonResult.documentSupportedValue,
          referralFactsUsable: extractionUsabilityStatus === "usable",
        });

        const recommendation = {
          label: deriveRecommendationLabel({
            label: registryEntry.label,
            sectionLabel: section.label,
            reviewMode: registryEntry.reviewMode,
            workflowState: comparisonResult.workflowState,
            recommendedAction: comparisonResult.recommendedAction,
          }),
          recommendedValue: deriveRecommendationValue({
            label: registryEntry.label,
            documentSupportedValue,
            currentChartValue,
            workflowState: comparisonResult.workflowState,
          }),
          rationale: deriveRecommendationRationale({
            reviewMode: registryEntry.reviewMode,
            workflowState: comparisonResult.workflowState,
            sourceEvidence: comparisonResult.sourceEvidence,
            sectionLabel: section.label,
          }),
          owner: deriveRecommendationOwner({
            reviewMode: registryEntry.reviewMode,
            workflowState: comparisonResult.workflowState,
            fieldKey,
            sectionKey: section.sectionKey,
          }),
          confidenceLabel: deriveRecommendationConfidenceLabel(comparisonResult.sourceEvidence),
        };

        return {
          fieldKey,
          label: registryEntry.label,
          sectionKey: section.sectionKey,
          sectionLabel: section.label,
          groupKey: registryEntry.groupKey,
          qaPriority: registryEntry.qaPriority,
          oasisItemId: registryEntry.oasisItemId ?? null,
          fieldType: registryEntry.fieldType,
          controlType: registryEntry.controlType,
          reviewMode: registryEntry.reviewMode,
          notes: registryEntry.notes ?? null,
          currentChartValue,
          currentChartValueSource,
          populatedInChart,
          documentSupportedValue,
          comparisonStatus: comparisonResult.comparisonStatus,
          workflowState: comparisonResult.workflowState,
          recommendedAction: comparisonResult.recommendedAction,
          requiresHumanReview: comparisonResult.requiresHumanReview,
          sourceEvidence: comparisonResult.sourceEvidence,
          discrepancyRating: deriveFieldDiscrepancyRating(
            comparisonResult.comparisonStatus,
            comparisonResult.workflowState,
          ),
          recommendation,
        };
      })
      .filter((field): field is NonNullable<typeof field> => field !== null)
      .sort((left, right) => {
        const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
        const leftRank = priorityRank[left.qaPriority];
        const rightRank = priorityRank[right.qaPriority];
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.label.localeCompare(right.label);
      });

    const populatedFieldCount = fields.filter((field) =>
      hasMeaningfulValue(field.documentSupportedValue) || hasMeaningfulValue(field.currentChartValue),
    ).length;

    const sectionDiscrepancyRating = fields.some((field) => field.discrepancyRating === "red")
      ? "red"
      : fields.some((field) => field.discrepancyRating === "yellow")
        ? "yellow"
        : "green";
    const likelyMissing = fields
      .filter((field) => !hasMeaningfulValue(field.currentChartValue))
      .slice(0, 6)
      .map((field) => field.label);
    const sectionGuidance = SECTION_GUIDANCE_BY_KEY[section.sectionKey] ?? {
      mustCheck: ["Review all required answers in this section before proceeding."],
      requiredLogic: ["Confirm values are supported by the chart and referral evidence."],
      saveReminder: "Save after reviewing this section.",
      escalationGuidance: ["Escalate unsupported clinical interpretation for human review."],
    };

    return {
      sectionKey: section.sectionKey,
      label: section.label,
      dashboardOrder: section.dashboardOrder,
      printVisibility: section.printVisibility,
      fieldCount: fields.length,
      populatedFieldCount,
      discrepancyRating: sectionDiscrepancyRating,
      textSpans: section.textSpans
        .map((span) => {
          const text = sanitizeDashboardClinicalValue(span.text);
          return text ? { ...span, text } : null;
        })
        .filter((span): span is NonNullable<typeof span> => span !== null),
      fields,
      guidance: {
        mustCheck: sectionGuidance.mustCheck,
        requiredLogic: sectionGuidance.requiredLogic,
        likelyMissing,
        saveReminder: sectionGuidance.saveReminder,
        escalationGuidance: sectionGuidance.escalationGuidance,
      },
    };
  }) ?? [];

  const allFields = sections.flatMap((section) => section.fields);
  const getField = (fieldKey: string) => allFields.find((field) => field.fieldKey === fieldKey) ?? null;
  const getSection = (sectionKey: string) => sections.find((section) => section.sectionKey === sectionKey) ?? null;
  const artifactInsights = patientQaReference?.referralQaInsights ?? null;

  const preAuditFindings = [
    ...allFields
      .filter((field) =>
        ["critical", "high"].includes(field.qaPriority) &&
        !hasMeaningfulValue(field.currentChartValue) &&
        field.workflowState !== "not_relevant_for_dashboard",
      )
      .slice(0, 12)
      .map((field) => ({
        id: `field-missing:${field.fieldKey}`,
        severity: field.qaPriority === "critical" ? "critical" as const : "warning" as const,
        category: field.sectionLabel,
        title: `Unanswered ${field.oasisItemId ?? "QA"} item: ${field.label}`,
        detail: field.recommendation.label,
      })),
    ...sections
      .filter((section) => section.fieldCount > 0 && section.populatedFieldCount < section.fieldCount)
      .slice(0, 8)
      .map((section) => ({
        id: `section-incomplete:${section.sectionKey}`,
        severity: section.discrepancyRating === "red" ? "critical" as const : "warning" as const,
        category: section.label,
        title: `Section has incomplete required fields`,
        detail: `${section.label} has ${section.fieldCount - section.populatedFieldCount} field(s) still needing QA attention.`,
      })),
  ];

  const documentationDefinitions = [
    {
      id: "docs-vitals-pain",
      title: "Vitals, bowel, and pain support",
      detail:
        "Verify vitals, bowel movement date, pain tool, and related visit-support documentation before human QA completes the assessment.",
      category: "Vital Signs & Pain Assessment",
      sectionKeys: ["vital_signs_and_pain_assessment"],
      fieldKeys: ["pain_assessment_narrative"],
    },
    {
      id: "docs-wound",
      title: "Wound worksheet and Norton Scale",
      detail:
        "Wound details, wound worksheet support, and Norton Scale documentation should be available together.",
      category: "Integumentary (Skin & Wound)",
      sectionKeys: ["integumentary_skin_and_wound"],
      fieldKeys: ["integumentary_wound_status", "norton_scale", "wound_risk_review"],
    },
    {
      id: "docs-mahc10",
      title: "MAHC-10 fall-risk documentation",
      detail:
        "MAHC-10 and related fall-risk narrative should be documented before QA sign-off.",
      category: "Safety & Risk Assessment",
      sectionKeys: ["safety_and_risk_assessment"],
      fieldKeys: ["mahc10_fall_risk", "fall_risk_narrative"],
    },
    {
      id: "docs-poc",
      title: "Plan of care, discipline frequencies, and goals",
      detail:
        "Plan of Care components, discipline frequencies, and patient/caregiver goals should be reviewed together.",
      category: "Plan of Care and Physical Therapy Evaluation",
      sectionKeys: ["plan_of_care_and_physical_therapy_evaluation", "care_plan_problems_goals_interventions"],
      fieldKeys: ["discipline_frequencies", "patient_caregiver_goals", "care_plan_problems_goals_interventions", "plan_for_next_visit"],
    },
  ];

  for (const definition of documentationDefinitions) {
    const relevantFields = definition.fieldKeys.map((fieldKey) => getField(fieldKey)).filter((field): field is NonNullable<typeof field> => field !== null);
    const sectionHasText = definition.sectionKeys.some((sectionKey) => (getSection(sectionKey)?.textSpans.length ?? 0) > 0);
    const sectionHasChartValues = relevantFields.some((field) => hasMeaningfulValue(field.currentChartValue));
    if (sectionHasText && !sectionHasChartValues) {
      preAuditFindings.push({
        id: definition.id,
        severity: "warning",
        category: definition.category,
        title: definition.title,
        detail: definition.detail,
      });
    }
  }

  function formatList(items: string[]): string {
    if (items.length === 0) {
      return "";
    }

    if (items.length === 1) {
      return items[0]!;
    }

    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }

    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  function diagnosisDescriptions(): string[] {
    const candidates = getField("diagnosis_candidates")?.documentSupportedValue;
    if (Array.isArray(candidates)) {
      return candidates
        .map((candidate) => asRecord(candidate))
        .map((candidate) => asString(candidate?.description))
        .filter((candidate): candidate is string => candidate !== null);
    }

    const formatted = stringifyDashboardValue(candidates);
    if (!formatted) {
      return [];
    }

    return formatted
      .split("; ")
      .map((entry) => entry.replace(/\s*\([^)]+\)$/, "").trim())
      .filter((entry) => entry.length > 0);
  }

  function matchingDiagnoses(pattern: RegExp): string[] {
    return diagnosisDescriptions().filter((diagnosis) => pattern.test(diagnosis)).slice(0, 4);
  }

  function chartValueSummary(fieldKey: string): string {
    const value = getField(fieldKey)?.currentChartValue;
    return hasMeaningfulValue(value) ? stringifyDashboardValue(value) : "blank";
  }

  function referralValueSummary(fieldKey: string): string {
    const field = getField(fieldKey);
    if (!field) {
      return "";
    }

    const value = hasMeaningfulValue(field.documentSupportedValue)
      ? stringifyDashboardValue(field.documentSupportedValue)
      : hasMeaningfulValue(field.currentChartValue)
        ? stringifyDashboardValue(field.currentChartValue)
        : "";

    if (!value) {
      return "";
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= 120) {
      return normalized;
    }

    const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
    return sentence.length <= 120 ? sentence : `${sentence.slice(0, 117).trimEnd()}...`;
  }

  function conciseConsistencyDetail(id: string, fallback: string): string {
    switch (id) {
      case "mental-status-vs-m1700-m1710": {
        const mentalDiagnoses = matchingDiagnoses(/encephalopathy|cognitive|depression|dementia|delirium|confusion|anxiety|behavior/i);
        const diagnosisSummary = mentalDiagnoses.length > 0
          ? `Referral records document ${formatList(mentalDiagnoses)}, indicating mental or cognitive concerns.`
          : "Referral records indicate mental or cognitive concerns."
        return `${diagnosisSummary} Mental-status chart selections are ${chartValueSummary("neurological_status") === "blank" ? "blank or incomplete" : "present but need reconciliation"}.`;
      }
      case "vision-vs-b1000-glasses": {
        return `Vision-related chart entries are ${chartValueSummary("eyes_ears_status")}, so B1000 vision impairment and glasses selections still need reconciliation.`;
      }
      case "respiratory-vs-m1400": {
        const respiratoryDiagnoses = matchingDiagnoses(/pneumonia|respiratory|hypoxia|copd|oxygen|sob|shortness of breath/i);
        const diagnosisSummary = respiratoryDiagnoses.length > 0
          ? `Referral records document ${formatList(respiratoryDiagnoses)}, supporting respiratory impairment.`
          : "Referral records support respiratory impairment."
        return `${diagnosisSummary} Chart respiratory status is ${chartValueSummary("respiratory_status")}.`;
      }
      case "functional-vs-gg0130-gg0170":
      case "functional-vs-gg": {
        const functionalSupport = referralValueSummary("functional_limitations");
        const supportText = functionalSupport
          ? `Referral records document ${functionalSupport}.`
          : "Referral records support functional limitations."
        return `${supportText} GG0130 self-care is ${chartValueSummary("gg_self_care")} and GG0170 mobility is ${chartValueSummary("gg_mobility")}.`;
      }
      case "wound-vs-worksheet": {
        const woundDiagnoses = matchingDiagnoses(/ulcer|wound|pressure|venous|skin/i);
        const woundSupport = woundDiagnoses.length > 0
          ? `Referral records document ${formatList(woundDiagnoses)}.`
          : referralValueSummary("integumentary_wound_status")
            ? `Referral records document ${referralValueSummary("integumentary_wound_status")}.`
            : "Referral records indicate wound or skin concerns."
        return `${woundSupport} Integumentary status is ${chartValueSummary("integumentary_wound_status")} and Norton Scale is ${chartValueSummary("norton_scale")}.`;
      }
      case "pain-vs-j0510-j0520-j0530":
      case "pain-logic": {
        const painSupport = referralValueSummary("pain_assessment_narrative") || referralValueSummary("patient_summary_narrative");
        const supportText = painSupport
          ? `Referral records mention pain-related support: ${painSupport}.`
          : "Referral records mention pain-related support."
        return `${supportText} Chart pain narrative is ${chartValueSummary("pain_assessment_narrative")}.`;
      }
      case "depression-vs-d0150": {
        const moodDiagnoses = matchingDiagnoses(/depression|anxiety|mood|behavior/i);
        const diagnosisSummary = moodDiagnoses.length > 0
          ? `Referral records document ${formatList(moodDiagnoses)}.`
          : "Referral records document mood or behavioral history."
        return `${diagnosisSummary} Emotional or behavioral status is ${chartValueSummary("emotional_behavioral_status")}.`;
      }
      default:
        return fallback.replace(/\s+/g, " ").trim();
    }
  }

  function compactSummary(value: string, maxLength = 180): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
    if (sentence.length <= maxLength) {
      return sentence;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  function conciseSourceHighlightSummary(id: string, fallback: string): string {
    switch (id) {
      case "medical-necessity":
        return referralValueSummary("primary_reason_for_home_health_medical_necessity") || compactSummary(fallback, 150);
      case "homebound":
        return (
          referralValueSummary("homebound_narrative") ||
          referralValueSummary("homebound_supporting_factors") ||
          compactSummary(fallback, 140)
        );
      case "prior-level-of-function":
        return (
          referralValueSummary("prior_functioning") ||
          referralValueSummary("functional_limitations") ||
          compactSummary(fallback, 140)
        );
      case "wound-history": {
        const woundDiagnoses = matchingDiagnoses(/ulcer|wound|pressure|venous|skin/i);
        if (woundDiagnoses.length > 0) {
          return `Wound support includes ${formatList(woundDiagnoses)}.`;
        }

        return (
          referralValueSummary("integumentary_wound_status") ||
          referralValueSummary("wound_risk_review") ||
          compactSummary(fallback, 140)
        );
      }
      case "diet-fluid":
        return compactSummary(fallback, 140);
      case "pmh-immunizations-dm": {
        const relevantHistory = matchingDiagnoses(/depression|hypothyroidism|heart failure|atrial fibrillation|kidney failure|diabetes|hypertension/i);
        if (relevantHistory.length > 0) {
          return `Relevant history includes ${formatList(relevantHistory.slice(0, 4))}.`;
        }

        return (
          referralValueSummary("past_medical_history") ||
          referralValueSummary("immunization_status") ||
          compactSummary(fallback, 150)
        );
      }
      case "diagnosis-support": {
        const diagnoses = diagnosisDescriptions().slice(0, 4);
        if (diagnoses.length > 0) {
          return `Coding-relevant diagnoses include ${formatList(diagnoses)}.`;
        }

        return compactSummary(fallback, 150);
      }
      default:
        return compactSummary(fallback, 150);
    }
  }

  const consistencyChecks = artifactInsights?.consistencyChecks?.length
    ? artifactInsights.consistencyChecks.map((entry) => ({
        id: entry.id,
        status: entry.status,
        title: entry.title,
        detail: conciseConsistencyDetail(entry.id, entry.detail),
        relatedSections: entry.relatedSections,
      }))
    : [
    (() => {
      const functional = getField("functional_limitations");
      const selfCare = getField("gg_self_care");
      const mobility = getField("gg_mobility");
      if (
        (hasMeaningfulValue(functional?.documentSupportedValue) || hasMeaningfulValue(functional?.currentChartValue)) &&
        (!hasMeaningfulValue(selfCare?.currentChartValue) || !hasMeaningfulValue(mobility?.currentChartValue))
      ) {
        return {
          id: "functional-vs-gg",
          status: "flagged" as const,
          title: "Functional items vs GG0130 / GG0170",
          detail:
            "Functional limitations are supported by referral evidence, but GG self-care or mobility scoring is still incomplete in the chart.",
          relatedSections: [
            "Functional Assessment (Self Care)",
            "Functional Assessment (Mobility & Musculoskeletal)",
          ],
        };
      }
      return null;
    })(),
    (() => {
      const respiratory = getField("respiratory_status");
      const admitReason = getField("admit_reason_to_home_health");
      if (
        hasMeaningfulValue(respiratory?.documentSupportedValue) &&
        !hasMeaningfulValue(admitReason?.currentChartValue)
      ) {
        return {
          id: "respiratory-vs-m1400",
          status: "watch" as const,
          title: "Respiratory findings vs M1400 shortness-of-breath logic",
          detail:
            "Respiratory support exists in the referral evidence. Confirm the M1400-related answer and narrative stay aligned.",
          relatedSections: [
            "Cardiopulmonary (Chest & Thorax)",
            "Patient Summary & Clinical Narrative",
          ],
        };
      }
      return null;
    })(),
    (() => {
      const wound = getField("integumentary_wound_status");
      const norton = getField("norton_scale");
      if (
        hasMeaningfulValue(wound?.documentSupportedValue) &&
        !hasMeaningfulValue(norton?.currentChartValue)
      ) {
        return {
          id: "wound-vs-worksheet",
          status: "flagged" as const,
          title: "Wound answers vs integumentary details and wound worksheet",
          detail:
            "Wound-related referral evidence exists, but the chart is still missing Norton Scale or equivalent wound-risk support.",
          relatedSections: ["Integumentary (Skin & Wound)"],
        };
      }
      return null;
    })(),
    (() => {
      const pain = getField("pain_assessment_narrative");
      const summary = getField("patient_summary_narrative");
      if (
        (hasMeaningfulValue(summary?.documentSupportedValue) || hasMeaningfulValue(summary?.currentChartValue)) &&
        !hasMeaningfulValue(pain?.currentChartValue)
      ) {
        return {
          id: "pain-logic",
          status: "watch" as const,
          title: "Pain presence vs pain-tool logic",
          detail:
            "Confirm J0510/J0520/J0530-related pain logic is supported because the pain section still lacks charted detail.",
          relatedSections: ["Vital Signs & Pain Assessment", "Patient Summary & Clinical Narrative"],
        };
      }
      return null;
    })(),
    (() => {
      const pmh = getField("past_medical_history");
      const mood = getField("emotional_behavioral_status");
      if (
        hasMeaningfulValue(pmh?.documentSupportedValue) &&
        !hasMeaningfulValue(mood?.currentChartValue)
      ) {
        return {
          id: "depression-vs-d0150",
          status: "watch" as const,
          title: "Depression / mood history vs D0150 completion",
          detail:
            "History or diagnoses may support mood documentation. Confirm depression-related screening and emotional/behavioral completion.",
          relatedSections: ["Neurological (Head, Mood, Eyes, Ears)"],
        };
      }
      return null;
    })(),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const sourceHighlights = artifactInsights?.sourceHighlights?.length
    ? artifactInsights.sourceHighlights.map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: conciseSourceHighlightSummary(entry.id, entry.summary),
        supportingSections: entry.supportingSections,
      }))
    : [
    {
      id: "medical-necessity",
      title: "Medical necessity",
      summary: conciseSourceHighlightSummary(
        "medical-necessity",
        getField("primary_reason_for_home_health_medical_necessity")?.recommendation.recommendedValue ||
        "No clear medical-necessity recommendation found in the referral records.",
      ),
      supportingSections: ["Patient Summary & Clinical Narrative"],
    },
    {
      id: "homebound",
      title: "Homebound reason",
      summary: conciseSourceHighlightSummary(
        "homebound",
        getField("homebound_narrative")?.recommendation.recommendedValue ||
        getField("homebound_supporting_factors")?.recommendation.recommendedValue ||
        "No clear homebound recommendation found. Human review is still required.",
      ),
      supportingSections: ["Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "prior-level-of-function",
      title: "Prior level of function",
      summary: conciseSourceHighlightSummary(
        "prior-level-of-function",
        getField("prior_functioning")?.recommendation.recommendedValue ||
        getField("functional_limitations")?.recommendation.recommendedValue ||
        "No clear prior-level-of-function support found in the uploaded referral records.",
      ),
      supportingSections: ["Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "wound-history",
      title: "Wound history",
      summary: conciseSourceHighlightSummary(
        "wound-history",
        getField("integumentary_wound_status")?.recommendation.recommendedValue ||
        getField("wound_risk_review")?.recommendation.recommendedValue ||
        "No wound-history recommendation found from the available referral evidence.",
      ),
      supportingSections: ["Integumentary (Skin & Wound)"],
    },
    {
      id: "diet-fluid",
      title: "Diet and fluid instructions",
      summary: conciseSourceHighlightSummary(
        "diet-fluid",
        sections.find((section) => section.sectionKey === "patient_summary_and_clinical_narrative")
          ?.textSpans.find((span) => /diet|fluid|pur[eé]ed|thickened/i.test(span.text))
          ?.text || "No explicit diet or fluid recommendation found in the organized referral sections.",
      ),
      supportingSections: [
        "Patient Summary & Clinical Narrative",
        "Gastrointestinal & Genitourinary Assessment",
      ],
    },
    {
      id: "pmh-immunizations-dm",
      title: "PMH, immunizations, and diabetic status",
      summary: conciseSourceHighlightSummary(
        "pmh-immunizations-dm",
        getField("past_medical_history")?.recommendation.recommendedValue ||
        getField("immunization_status")?.recommendation.recommendedValue ||
        "No complete PMH / immunization / diabetic-management recommendation was found from the referral documents.",
      ),
      supportingSections: [
        "Patient Summary & Clinical Narrative",
        "Administrative Information",
        "Endocrine (Diabetic Management)",
      ],
    },
    {
      id: "diagnosis-support",
      title: "Diagnoses and coding support",
      summary: conciseSourceHighlightSummary(
        "diagnosis-support",
        getField("diagnosis_candidates")?.recommendation.recommendedValue ||
        getField("primary_diagnosis")?.recommendation.recommendedValue ||
        "Diagnosis support is incomplete and should be reviewed with coding.",
      ),
      supportingSections: ["Active Diagnoses"],
    },
  ];

  const draftNarratives = artifactInsights?.draftNarratives?.length
    ? artifactInsights.draftNarratives.map((entry) => ({
        fieldKey: entry.fieldKey,
        label: entry.label,
        draft: entry.draft,
        status: entry.status,
      }))
    : [
    "homebound_narrative",
    "primary_reason_for_home_health_medical_necessity",
    "patient_summary_narrative",
    "skilled_interventions",
    "plan_for_next_visit",
    "care_plan_problems_goals_interventions",
    "patient_caregiver_goals",
  ]
    .map((fieldKey) => getField(fieldKey))
    .filter((field): field is NonNullable<typeof field> => field !== null)
    .map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      draft: field.recommendation.recommendedValue,
      status: hasMeaningfulValue(field.documentSupportedValue) ? "ready_for_qa" as const : "needs_human_review" as const,
    }));

  const exceptionRoutes = allFields
    .filter((field) => field.discrepancyRating !== "green" || field.recommendation.owner !== "QA")
    .slice(0, 14)
    .map((field) => ({
      id: `route:${field.fieldKey}`,
      owner: field.recommendation.owner,
      title: field.recommendation.label,
      detail: field.recommendation.rationale,
    }));

  return {
    patientContext: patientQaReference?.patientContext ?? null,
    referralDataAvailable,
    extractionUsabilityStatus,
    qaStatus,
    summaryHeadline,
    summaryDetail,
    displayWarnings,
    discrepancyRating,
    discrepancyCounts: {
      total: reviewQueue.length,
      critical: criticalCount,
      warning: warningCount,
      possibleConflict: possibleConflictCount,
      codingReview: codingReviewCount,
      missingInChart: missingInChartCount,
      needsQaReadback: qaReadbackCount,
      supportedByReferral: supportedByReferralCount,
    },
    availableSectionCount,
    totalSectionCount,
    llmProposalCount,
    warningCount: warnings.length,
    topWarning: warnings[0] ?? null,
    warnings,
    preAuditFindings,
    consistencyChecks,
    sourceHighlights,
    draftNarratives,
    exceptionRoutes,
    sections,
  };
}

function normalizeDashboardComparisonText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

function normalizeDashboardSnippetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLegacyPrintedNoteArtifactName(value: string | null | undefined): boolean {
  return value === "printed-note-chart-values.json" || value === "oasis-printed-note-review.json";
}

function isLegacyPrintedNoteValueSource(value: string | null | undefined): boolean {
  return value === "printed_note_ocr" || value === "printed_note_review";
}

function getDashboardPortalValueSourceLabel(source: string): string {
  if (source === "chart_read") {
    return "Field value";
  }
  if (source === "portal_dom_state" || source === "dom_state_primary") {
    return "DOM field value";
  }
  if (source === "oasis_fact_pack") {
    return "OASIS fact-pack evidence";
  }
  if (source === "oasis_capture_skipped") {
    return "OASIS not captured";
  }
  if (source === "workbook_context") {
    return "Workbook context";
  }
  if (source === "unavailable") {
    return "Not captured";
  }

  return source
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getDashboardConfidence(input: {
  sourceEvidence: Array<{ confidence?: number | null }>;
  requiresHumanReview: boolean;
  hasDocumentValue: boolean;
}): "high" | "medium" | "low" | "uncertain" {
  const scoredConfidence = input.sourceEvidence
    .map((entry) => (typeof entry.confidence === "number" ? entry.confidence : null))
    .filter((entry): entry is number => entry !== null)
    .sort((left, right) => right - left)[0];

  if (typeof scoredConfidence === "number") {
    if (scoredConfidence >= 0.9) {
      return "high";
    }
    if (scoredConfidence >= 0.75) {
      return "medium";
    }
    return "low";
  }

  if (input.hasDocumentValue) {
    return input.requiresHumanReview ? "medium" : "high";
  }

  return "uncertain";
}

function getDashboardStrengthLabel(value: number): "strong" | "moderate" | "weak" | "none" {
  if (value >= 3) {
    return "strong";
  }
  if (value >= 1) {
    return "moderate";
  }
  if (value === 0) {
    return "weak";
  }
  return "none";
}

function getDashboardSourceSupportStrength(input: {
  hasDocumentValue: boolean;
  evidenceCount: number;
  confidence: "high" | "medium" | "low" | "uncertain";
}): "strong" | "moderate" | "weak" | "none" {
  if (!input.hasDocumentValue && input.evidenceCount === 0) {
    return "none";
  }

  let score = 0;
  if (input.hasDocumentValue) {
    score += 1;
  }
  if (input.evidenceCount >= 2) {
    score += 1;
  }
  if (input.confidence === "high") {
    score += 2;
  } else if (input.confidence === "medium") {
    score += 1;
  }

  return getDashboardStrengthLabel(score);
}

function getDashboardMappingStrength(input: {
  reviewMode: string;
  fieldType: string;
  groupKey: string;
  requiresHumanReview: boolean;
}): "strong" | "moderate" | "weak" {
  if (input.reviewMode === "reference_only") {
    return "weak";
  }
  if (
    input.fieldType.includes("diagnosis") ||
    input.fieldType === "date" ||
    input.fieldType === "phone" ||
    input.groupKey.includes("diagnosis")
  ) {
    return "strong";
  }
  if (input.requiresHumanReview) {
    return "moderate";
  }
  return "weak";
}

function normalizeDashboardKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatDomFieldValue(field: Record<string, unknown>): string | null {
  const selectedText = asString(field.selectedText);
  if (selectedText) {
    return selectedText;
  }
  const value = field.value;
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof field.checked === "boolean") {
    return field.checked ? (asString(field.label) ?? "Checked") : null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    const normalized = normalizeDashboardSnippetText(value);
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => normalizeDashboardSnippetText(String(entry ?? "")))
      .filter(Boolean);
    return normalized.length > 0 ? normalized.join("; ") : null;
  }
  return null;
}

function getDomFieldDisplayLabel(field: Record<string, unknown>, fallback: string): string {
  const itemCode = asString(field.itemCode);
  const label = asString(field.label);
  if (itemCode && label && !label.includes(itemCode)) {
    return `(${itemCode}) ${label}`;
  }
  return label ?? (itemCode ? `(${itemCode})` : fallback);
}

function getOasisDomSections(artifactContents: KnownArtifactContents): Array<{
  title: string;
  status: string;
  fields: Record<string, unknown>[];
}> {
  const domState = asRecord(artifactContents.oasisDomExtractedState);
  return asArray(domState?.sections)
    .map((sectionValue) => {
      const section = asRecord(sectionValue);
      const title = asString(section?.title);
      if (!section || !title) {
        return null;
      }
      return {
        title,
        status: asString(section.status) ?? "success",
        fields: asArray(section.fields)
          .map(asRecord)
          .filter((field): field is Record<string, unknown> => Boolean(field)),
      };
    })
    .filter((section): section is { title: string; status: string; fields: Record<string, unknown>[] } =>
      section !== null);
}

function isPlanOfCareDomSection(sectionKey: string, sectionTitle: string): boolean {
  return sectionKey === "plan_of_care" || /\b(plan of care|careplan|goal|intervention|physical therapy evaluation)\b/i.test(sectionTitle);
}

function confidenceNumberToDomLabel(value: number | null): "high" | "medium" | "low" {
  if (value !== null && value >= 0.9) {
    return "high";
  }
  if (value !== null && value >= 0.7) {
    return "medium";
  }
  return "low";
}

function getProcessedOasisDomSectionRows(artifactContents: KnownArtifactContents): Array<{
  sectionTitle: string;
  sectionKey: string;
  field: Record<string, unknown>;
  value: string;
  label: string;
}> {
  const outputs = asRecord(artifactContents.oasisDomSectionOutputs);
  const sections = asArray(outputs?.sections).map(asRecord).filter((section): section is Record<string, unknown> => Boolean(section));
  const rows: Array<{
    sectionTitle: string;
    sectionKey: string;
    field: Record<string, unknown>;
    value: string;
    label: string;
  }> = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const sectionKey = asString(section.sectionKey) ?? "oasis_dom";
    const sectionTitle = asString(section.label) ?? asString(section.sectionTitle) ?? toTitleCaseFromKey(sectionKey);
    if (isPlanOfCareDomSection(sectionKey, sectionTitle)) {
      continue;
    }
    for (const rowValue of asArray(section.rows)) {
      const row = asRecord(rowValue);
      const label = asString(row?.label);
      const value = asString(row?.value);
      if (!row || !label || !value) {
        continue;
      }
      const key = `${sectionKey}|${label}|${value}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const confidence = asNumber(row.confidence);
      rows.push({
        sectionTitle,
        sectionKey,
        label,
        value,
        field: {
          label,
          value,
          itemCode: asString(row.sourceItemCode) ?? undefined,
          sourceKind: asString(row.sourceKind) ?? "llm_summary",
          confidence: confidenceNumberToDomLabel(confidence),
          evidenceText: asString(row.meta) ?? asString(row.sourceSectionTitle) ?? value,
        },
      });
    }
  }

  return rows;
}

function getMeaningfulOasisDomFields(artifactContents: KnownArtifactContents): Array<{
  sectionTitle: string;
  sectionKey: string;
  field: Record<string, unknown>;
  value: string;
  label: string;
}> {
  const rows: Array<{
    sectionTitle: string;
    sectionKey: string;
    field: Record<string, unknown>;
    value: string;
    label: string;
  }> = [];
  const processedRows = getProcessedOasisDomSectionRows(artifactContents);
  if (processedRows.length > 0) {
    return processedRows;
  }
  const seen = new Set<string>();
  for (const section of getOasisDomSections(artifactContents)) {
    const sectionKey = normalizeDashboardKey(section.title) || "oasis_dom";
    if (isPlanOfCareDomSection(sectionKey, section.title)) {
      continue;
    }
    for (const field of section.fields) {
      const value = formatDomFieldValue(field);
      if (!value || /^(?:0|false|unchecked|not selected)$/i.test(value)) {
        continue;
      }
      const label = getDomFieldDisplayLabel(field, "OASIS field");
      if (/\b(?:m-item search|fax|zoom|search patient|notifications|messages)\b/i.test(label)) {
        continue;
      }
      const sourceKind = asString(field.sourceKind);
      if (sourceKind === "visibleText" && value.length < 12) {
        continue;
      }
      const itemCode = asString(field.itemCode);
      const key = [
        sectionKey,
        itemCode ?? "",
        asString(field.key) ?? "",
        label,
        value,
      ].join("|").toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        sectionTitle: section.title,
        sectionKey,
        field,
        value,
        label,
      });
    }
  }
  return rows;
}

function deriveReferralIntakeStatusState(artifactContents: KnownArtifactContents) {
  const state = asRecord(artifactContents.referralIntakeState);
  return {
    status: asString(state?.status) ?? "idle",
    acceptedAt: asString(state?.acceptedAt),
    startedAt: asString(state?.startedAt),
    completedAt: asString(state?.completedAt),
    lastCheckedAt: asString(state?.lastCheckedAt),
    lastError: asString(state?.lastError),
    processedCount: asNumber(state?.processedCount) ?? 0,
    reusedCount: asNumber(state?.reusedCount) ?? 0,
    newOrChangedCount: asNumber(state?.newOrChangedCount) ?? 0,
    failedCount: asNumber(state?.failedCount) ?? 0,
    skippedCount: asNumber(state?.skippedCount) ?? 0,
    documentCount: asNumber(state?.documentCount) ?? 0,
    sourceDocumentCount: asNumber(state?.sourceDocumentCount) ?? 0,
    statusUrl: asString(state?.statusUrl),
    message: asString(state?.message),
  };
}

function parseDashboardSourceDate(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOasisAssessmentTitle(input: {
  assessmentType: string | null;
  title: string | null;
}): string {
  const title = input.title?.trim();
  if (title) {
    return title;
  }
  const type = input.assessmentType?.trim();
  return type ? `${type} OASIS` : "OASIS assessment";
}

function sourceDateSortDescending<T extends { date: string | null; id: string }>(items: T[]): T[] {
  return items.slice().sort((left, right) =>
    parseDashboardSourceDate(right.date) - parseDashboardSourceDate(left.date) ||
    left.id.localeCompare(right.id)
  );
}

function deriveOasisAssessmentSources(input: {
  artifactContents: KnownArtifactContents;
  oasisDomState: Record<string, unknown> | null;
}) {
  const snapshot = asRecord(input.artifactContents.patientPortalStatusSnapshot);
  const currentId = asString(snapshot?.currentOasisAssessmentId);
  const processingManifest = asRecord(input.artifactContents.oasisAssessmentProcessingManifest);
  const processingById = new Map(
    asArray(processingManifest?.assessments)
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => [asString(entry.assessmentId), entry] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0])),
  );
  const snapshotAssessments = asArray(snapshot?.oasisAssessments)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry, index) => {
      const id = asString(entry.id) ?? `oasis-assessment-${index + 1}`;
      const assessmentType = asString(entry.assessmentType) ?? null;
      const processing = processingById.get(id) ?? null;
      const processingStatus = asString(processing?.processingStatus);
      const scopedDomStatePath = asString(processing?.domStatePath);
      const title = normalizeOasisAssessmentTitle({
        assessmentType,
        title: asString(entry.title),
      });
      const date = asString(entry.date);
      return {
        id,
        title,
        date,
        source: scopedDomStatePath
          ? scopedDomStatePath
          : id === currentId && input.oasisDomState
            ? "oasis-dom-extracted-state.json"
            : "patient-portal-status-snapshot.json",
        status: processingStatus ?? asString(entry.primaryStatus) ?? asString(entry.decision) ?? "visible",
        assessmentType,
        processingEligible: typeof entry.processingEligible === "boolean" ? entry.processingEligible : null,
        isCurrent: currentId ? id === currentId : false,
        isMonitored: currentId ? id === currentId : index === 0,
      };
    });

  if (snapshotAssessments.length > 0) {
    const sorted = sourceDateSortDescending(snapshotAssessments);
    const currentAssessment = currentId
      ? sorted.find((assessment) => assessment.id === currentId)
      : null;
    const currentFirst = currentAssessment
      ? [currentAssessment, ...sorted.filter((assessment) => assessment.id !== currentAssessment.id)]
      : sorted;
    return currentFirst.map((assessment, index) => ({
      ...assessment,
      isCurrent: currentId ? assessment.id === currentId : index === 0,
      isMonitored: currentId ? assessment.id === currentId : index === 0,
    }));
  }

  return input.oasisDomState
    ? [{
        id: asString(input.oasisDomState.assessmentId) ?? asString(input.oasisDomState.documentId) ?? "current-oasis",
        title: asString(input.oasisDomState.assessmentType) ?? "Current OASIS",
        date: asString(input.oasisDomState.assessmentDate) ?? asString(input.oasisDomState.extractedAt),
        source: "oasis-dom-extracted-state.json",
        status: asString(input.oasisDomState.status) ?? "captured",
        assessmentType: asString(input.oasisDomState.assessmentType),
        processingEligible: null,
        isCurrent: true,
        isMonitored: true,
      }]
    : [];
}

function normalizeOasisChangeLabel(value: string): string {
  const lastSegment = value.split(/[./:|]/).filter(Boolean).pop() ?? value;
  return toTitleCaseFromKey(
    lastSegment
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase(),
  );
}

function deriveOasisChangeFlags(input: {
  artifactContents: KnownArtifactContents;
  currentOasisAssessmentId: string | null;
  baselineOasisAssessmentId: string | null;
}) {
  const acquisition = asRecord(input.artifactContents.oasisDomAcquisitionState);
  const changedFields = asArray(acquisition?.changedFields)
    .map(asString)
    .filter((value): value is string => Boolean(value));
  const regressedFields = asArray(acquisition?.regressedFields)
    .map(asString)
    .filter((value): value is string => Boolean(value));
  const flags: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const [kind, values] of [
    ["changed", changedFields],
    ["regressed", regressedFields],
  ] as const) {
    for (const value of values) {
      const key = `${kind}:${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      flags.push({
        id: key,
        kind,
        fieldKey: value,
        label: normalizeOasisChangeLabel(value),
        assessmentId: input.currentOasisAssessmentId,
        baselineAssessmentId: input.baselineOasisAssessmentId,
        source: "oasis-dom-acquisition-state.json",
      });
    }
  }

  return flags;
}

function deriveReferralOasisSourcesState(artifactContents: KnownArtifactContents) {
  const resultsManifest = asRecord(artifactContents.referralDocumentResultsManifest);
  const sourceManifest = asRecord(artifactContents.referralSourceDocumentsManifest);
  const sourceManifestDocuments = asArray(sourceManifest?.documents)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const sourceDocumentById = new Map(
    sourceManifestDocuments
      .map((entry) => [asString(entry.documentId), entry] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0])),
  );
  const resultDocuments = asArray(resultsManifest?.documents)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const id = asString(entry.documentId) ?? asString(entry.selectedDocumentId) ?? "referral-document";
      const sourceEntry = sourceDocumentById.get(id) ?? null;
      return {
        id,
        title:
          asString(entry.title) ??
          asString(entry.sourceLabel) ??
          asString(sourceEntry?.title) ??
          asString(sourceEntry?.sourceLabel) ??
          "Referral document",
        date: asString(entry.documentDate) ?? asString(sourceEntry?.documentDate) ?? null,
        sourcePath: asString(entry.sourcePath) ?? asString(sourceEntry?.sourcePath),
        sourceLabel: asString(entry.sourceLabel) ?? asString(sourceEntry?.sourceLabel),
        status: asString(entry.status) ?? asString(sourceEntry?.processStatus) ?? "processed",
        extractionUsabilityStatus: asString(entry.extractionUsabilityStatus),
        artifactDirectory: asString(entry.artifactDirectory),
        error: asString(entry.error) ?? asString(sourceEntry?.error),
      };
    });
  const sourceDocuments = resultDocuments.length > 0
    ? resultDocuments
    : sourceManifestDocuments
      .map((entry) => ({
        id: asString(entry.documentId) ?? "referral-document",
        title: asString(entry.title) ?? asString(entry.sourceLabel) ?? "Referral document",
        date: asString(entry.documentDate) ?? null,
        sourcePath: asString(entry.sourcePath),
        sourceLabel: asString(entry.sourceLabel),
        status: "discovered",
        extractionUsabilityStatus: null,
        artifactDirectory: null,
        error: null,
      }));
  const oasisDomState = asRecord(artifactContents.oasisDomExtractedState);
  const oasisAssessments = deriveOasisAssessmentSources({
    artifactContents,
    oasisDomState,
  });
  const defaultOasisAssessmentId =
    oasisAssessments.find((assessment) => assessment.isCurrent)?.id ?? oasisAssessments[0]?.id ?? null;
  const baselineOasisAssessmentId =
    oasisAssessments.find((assessment) => assessment.id !== defaultOasisAssessmentId)?.id ?? null;

  return {
    referralDocuments: sourceDocuments,
    oasisAssessments,
    defaultReferralDocumentId:
      asString(resultsManifest?.defaultReferralDocumentId) ?? sourceDocuments[0]?.id ?? null,
    defaultOasisAssessmentId,
    baselineOasisAssessmentId,
    oasisChangeFlags: deriveOasisChangeFlags({
      artifactContents,
      currentOasisAssessmentId: defaultOasisAssessmentId,
      baselineOasisAssessmentId,
    }),
  };
}

function withReferralIntakeDashboardState<T extends { rows: unknown[] }>(
  state: T,
  artifactContents: KnownArtifactContents,
) {
  return {
    ...state,
    referralIntakeStatus: deriveReferralIntakeStatusState(artifactContents),
    referralOasisSources: deriveReferralOasisSourcesState(artifactContents),
  };
}

function derivePatientDashboardState(input: {
  referralQa: ReturnType<typeof deriveReferralQaSummary>;
  qaPrefetch: ReturnType<typeof deriveQaPrefetchSummary>;
  artifactContents: KnownArtifactContents;
}) {
  const explicitComparisonRowsStatus = asString(input.artifactContents.comparisonRowsStatus);
  const hasCanonicalComparisonRows = getCanonicalRows(input.artifactContents.clinicalComparisonRows).length > 0;
  if (
    explicitComparisonRowsStatus === "ready" ||
    explicitComparisonRowsStatus === "pending" ||
    hasCanonicalComparisonRows
  ) {
    return withReferralIntakeDashboardState(buildDashboardStateFromClinicalRows({
      referralQa: input.referralQa,
      artifactContents: input.artifactContents,
    }), input.artifactContents);
  }

  const oasisDomState = asRecord(input.artifactContents.oasisDomExtractedState);
  const printedNoteReviewSource = oasisDomState ? "dom_state_primary" : null;
  const qaDocumentSummary = asRecord(input.artifactContents.qaDocumentSummary);
  const reviewerDiagnostics = deriveReviewerLlmDiagnosticsSummary(input.artifactContents);
  const referralComparisonOrigin = deriveReferralComparisonOrigin({
    qaDocumentSummary,
    reviewerDiagnostics,
  });
  const oasisCaptureSkippedReason =
    input.qaPrefetch?.oasisAssessmentDecision === "SKIP"
      ? input.qaPrefetch?.oasisAssessmentReason ?? "Subsequent OASIS capture was skipped because of the assessment page status."
      : null;

  const referralQaSources = deriveReferralQaDashboardSources(input, input.referralQa);
  const currentOasisAssessmentId = getCurrentOasisAssessmentId(input.artifactContents);
  const referralRows = referralQaSources.flatMap((source) =>
    source.referralQa.sections.flatMap((section) =>
      section.fields.map((field) => {
      const legacyFieldChartSource = isLegacyPrintedNoteValueSource(field.currentChartValueSource);
      const fieldChartValue = legacyFieldChartSource
        ? null
        : sanitizeDiagnosisFieldValue(field.fieldKey, field.currentChartValue);
      const fieldPopulatedInChart = legacyFieldChartSource ? false : field.populatedInChart;
      const currentChartValue =
        hasMeaningfulValue(fieldChartValue) ? fieldChartValue : null;
      const currentChartValueSource =
        hasMeaningfulValue(currentChartValue)
          ? field.currentChartValueSource || "chart_read"
          : "unavailable";
      const documentValue = field.documentSupportedValue;
      const documentValueText = stringifyDashboardValue(documentValue).trim() || null;
      const chartValueText = stringifyDashboardValue(currentChartValue).trim() || null;
      const normalizedDocumentValue = documentValueText
        ? normalizeDashboardComparisonText(documentValueText)
        : null;
      const normalizedChartValue = chartValueText
        ? normalizeDashboardComparisonText(chartValueText)
        : null;
      const hasDocumentValue = documentValueText !== null;
      const hasChartValue = chartValueText !== null;
      const hasPortalEvidence = hasChartValue;
      const assessmentCaptureSkipped = Boolean(oasisCaptureSkippedReason) && !hasPortalEvidence;
      const oasisEvidenceMode: DashboardOasisEvidenceMode = chartValueText
        ? currentChartValueSource === "portal_dom_state"
          ? "portal_dom_state"
          : "chart_read"
        : "unavailable";
      const effectiveChartValueSource =
        hasChartValue
          ? currentChartValueSource
          : assessmentCaptureSkipped
              ? "oasis_capture_skipped"
            : currentChartValueSource;
      const sourceArtifacts = [
        "patient-qa-reference.json",
        ...(source.documentId ? [`referral-document:${source.documentId}`] : []),
        ...(hasChartValue ? ["field-map-snapshot.json"] : []),
        ...(input.artifactContents.llmUsageAudit ? ["llm-usage-audit.json"] : []),
        ...(assessmentCaptureSkipped ? ["qa-prefetch-result.json"] : []),
      ];
      const confidence = getDashboardConfidence({
        sourceEvidence: field.sourceEvidence,
        requiresHumanReview: field.requiresHumanReview,
        hasDocumentValue,
      });
      const sourceSupportStrength = getDashboardSourceSupportStrength({
        hasDocumentValue,
        evidenceCount: field.sourceEvidence.length,
        confidence,
      });
      const mappingStrength = getDashboardMappingStrength({
        reviewMode: field.reviewMode,
        fieldType: field.fieldType,
        groupKey: field.groupKey,
        requiresHumanReview: field.requiresHumanReview,
      });
      const comparisonSignals = new Set(
        [field.comparisonStatus, field.workflowState, field.recommendedAction]
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      );

      let displayStatus: DashboardComparisonResult;
      if (
        comparisonSignals.has("needs_coding_review") ||
        comparisonSignals.has("send_to_coding") ||
        field.recommendation.owner.toLowerCase().includes("coding")
      ) {
        displayStatus = "coding_review";
      } else if (assessmentCaptureSkipped) {
        displayStatus = "uncertain";
      } else if (comparisonSignals.has("possible_conflict")) {
        displayStatus = "mismatch";
      } else if (!hasDocumentValue && hasPortalEvidence) {
        displayStatus = "missing_in_referral";
      } else if (
        comparisonSignals.has("missing_in_chart") ||
        (comparisonSignals.has("supported_by_referral") && !hasPortalEvidence)
      ) {
        displayStatus = "missing_in_portal";
      } else if (hasDocumentValue && !hasPortalEvidence) {
        displayStatus = "missing_in_portal";
      } else if (comparisonSignals.has("needs_qa_readback") || comparisonSignals.has("supported_by_referral")) {
        displayStatus = "uncertain";
      } else if (
        comparisonSignals.has("match") ||
        comparisonSignals.has("already_satisfactory") ||
        comparisonSignals.has("not_relevant_for_dashboard")
      ) {
        displayStatus = "match";
      } else if (hasDocumentValue && hasChartValue && normalizedDocumentValue === normalizedChartValue) {
        displayStatus = "match";
      } else {
        displayStatus = "uncertain";
      }

      let visibilityDecision: DashboardVisibilityDecision = "show";
      let visibilityReason = "Backend marked this field as requiring review.";
      if (comparisonSignals.has("not_relevant_for_dashboard") || field.reviewMode === "reference_only") {
        visibilityDecision = "hidden_resolved";
        visibilityReason = "Backend marked this field as non-actionable for the QA dashboard.";
      } else if (displayStatus === "match") {
        visibilityDecision = "hidden_match";
        visibilityReason = "Backend comparison is resolved and hidden by default.";
      } else if (!hasPortalEvidence && !hasDocumentValue) {
        visibilityDecision = "hidden_filtered_by_default";
        visibilityReason = "Neither the chart snapshot nor the referral produced a comparable value.";
      }

      const strictnessFlags = [
        ...(visibilityDecision !== "show" && (hasDocumentValue || hasChartValue)
          ? ["hidden_with_meaningful_value"]
          : []),
        ...(visibilityDecision === "hidden_match" ? ["hidden_match_by_default"] : []),
        ...(comparisonSignals.has("supported_by_referral") && !hasChartValue
          ? ["referral_support_without_chart_snapshot"]
          : []),
        ...(assessmentCaptureSkipped ? ["oasis_capture_skipped_by_assessment_status"] : []),
      ];

      return {
        fieldKey: field.fieldKey,
        fieldLabel: field.label,
        sectionKey: field.sectionKey,
        sectionLabel: field.sectionLabel,
        sourceSectionLabel: section.label,
        reviewMode: field.reviewMode,
        qaPriority: field.qaPriority,
        oasisItemId: field.oasisItemId,
        backendComparisonStatus: field.comparisonStatus,
        backendWorkflowState: field.workflowState,
        displayStatus,
        documentSupportedValue: documentValue,
        currentChartValue,
        normalizedDocumentValue,
        normalizedChartValue,
        currentChartValueSource: assessmentCaptureSkipped
          ? "oasis_capture_skipped"
          : currentChartValueSource,
        currentChartValueSourceLabel: getDashboardPortalValueSourceLabel(effectiveChartValueSource),
        oasisEvidenceMode,
        oasisEvidenceLabel: getDashboardOasisEvidenceLabel(oasisEvidenceMode),
        displayReferralValue: documentValueText ?? "No reliable referral value extracted",
        displayPortalValue:
          chartValueText ??
          (assessmentCaptureSkipped
            ? oasisCaptureSkippedReason
            : null) ??
          (fieldPopulatedInChart
              ? "Chart value is blank"
              : "No chart data captured"),
        comparisonResult: displayStatus,
        shortReason:
          visibilityDecision === "show"
            ? assessmentCaptureSkipped
              ? oasisCaptureSkippedReason ?? "OASIS capture was skipped because of the assessment page status."
              : comparisonSignals.has("possible_conflict")
              ? "Backend marked this field as a possible conflict."
              : comparisonSignals.has("missing_in_chart")
                ? "Backend marked this field as missing in the chart snapshot."
                : comparisonSignals.has("needs_qa_readback")
                  ? "Backend requires QA readback before treating this field as resolved."
                  : comparisonSignals.has("supported_by_referral")
                    ? "Referral evidence supports this field, but backend did not treat it as fully resolved."
                    : "Backend surfaced this field for QA review."
            : visibilityReason,
        reviewStatus:
          displayStatus === "match"
            ? "Resolved"
            : displayStatus === "coding_review"
              ? "Review with Coding"
              : displayStatus === "missing_in_portal"
                ? "Missing in Chart Snapshot"
                : displayStatus === "missing_in_referral"
                  ? "Missing Referral Documentation"
                  : displayStatus === "mismatch"
                    ? "Needs Review"
                    : "Needs Source Review",
        qaResultLabel: getDashboardQaResultLabel(displayStatus),
        qaActionLabel: getDashboardQaActionLabel(displayStatus),
        referralComparisonOrigin,
        referralComparisonOriginLabel: getDashboardReferralOriginLabel(referralComparisonOrigin),
        confidence,
        sourceSupportStrength,
        mappingStrength,
        referralSnippet: asString(field.sourceEvidence[0]?.textSpan) ?? documentValueText,
        portalSnippet: chartValueText ?? oasisCaptureSkippedReason,
        evidence: field.sourceEvidence.map((entry, index) => ({
          id: `${field.fieldKey}:${index}`,
          sourceType: entry.sourceType,
          sourceLabel: entry.sourceLabel,
          snippet: entry.textSpan ?? null,
          confidence:
            typeof entry.confidence === "number"
              ? entry.confidence >= 0.9
                ? "high"
                : entry.confidence >= 0.75
                  ? "medium"
                  : "low"
              : "uncertain",
          confidenceLabel:
            typeof entry.confidence === "number"
              ? `${Math.round(entry.confidence * 100)}% confidence`
              : "Confidence not scored",
          pageHint: null,
        })),
        shownByDefault: visibilityDecision === "show",
        visibilityDecision,
        visibilityReason,
        strictnessFlags,
        sourceArtifacts: Array.from(new Set(sourceArtifacts)),
        referralDocumentIds: source.documentId ? [source.documentId] : [],
        oasisAssessmentId: currentOasisAssessmentId,
        valuePresence: {
          hasDocumentValue,
          hasChartValue,
          hasPrintedNoteChartValue: false,
          printedNoteSectionKey: null,
          printedNoteSectionStatus: null,
          printedNoteReviewSource,
        },
      };
    }),
    ),
  );
  const existingPortalValueKeys = new Set(
    referralRows
      .filter((row) => row.valuePresence.hasChartValue || row.valuePresence.hasPrintedNoteChartValue)
      .map((row) => `${row.sectionKey}|${row.fieldLabel}`.toLowerCase()),
  );
  const domRows = getMeaningfulOasisDomFields(input.artifactContents).map((entry, index) => {
    const domSourceArtifact = input.artifactContents.oasisDomSectionOutputs
      ? "oasis-dom-section-outputs.json"
      : "oasis-dom-extracted-state.json";
    const fieldKeyBase =
      normalizeDashboardKey(asString(entry.field.itemCode) ?? asString(entry.field.key) ?? entry.label) ||
      `dom_field_${index + 1}`;
    const fieldKey = `dom_${entry.sectionKey}_${fieldKeyBase}_${index + 1}`;
    const sourceKey = `${entry.sectionKey}|${entry.label}`.toLowerCase();
    const hiddenBecauseDuplicate = existingPortalValueKeys.has(sourceKey);

    return {
      fieldKey,
      fieldLabel: entry.label,
      sectionKey: entry.sectionKey,
      sectionLabel: entry.sectionTitle,
      sourceSectionLabel: entry.sectionTitle,
      reviewMode: "qa_readback_and_confirm",
      qaPriority: "medium",
      oasisItemId: asString(entry.field.itemCode),
      backendComparisonStatus: "missing_in_referral",
      backendWorkflowState: "missing_in_referral",
      displayStatus: "missing_in_referral" as DashboardComparisonResult,
      documentSupportedValue: null,
      currentChartValue: entry.value,
      normalizedDocumentValue: null,
      normalizedChartValue: normalizeDashboardComparisonText(entry.value),
      currentChartValueSource: "portal_dom_state",
      currentChartValueSourceLabel: getDashboardPortalValueSourceLabel("portal_dom_state"),
      oasisEvidenceMode: "portal_dom_state" as DashboardOasisEvidenceMode,
      oasisEvidenceLabel: getDashboardOasisEvidenceLabel("portal_dom_state"),
      displayReferralValue: "No reliable referral value extracted",
      displayPortalValue: entry.value,
      comparisonResult: "missing_in_referral" as DashboardComparisonResult,
      shortReason: input.artifactContents.oasisDomSectionOutputs
        ? "Section-scoped DOM processing captured this OASIS value; referral support was not matched."
        : "DOM extraction captured this OASIS chart value; referral support was not matched.",
      reviewStatus: "Missing Referral Documentation",
      qaResultLabel: getDashboardQaResultLabel("missing_in_referral"),
      qaActionLabel: getDashboardQaActionLabel("missing_in_referral"),
      referralComparisonOrigin,
      referralComparisonOriginLabel: getDashboardReferralOriginLabel(referralComparisonOrigin),
      confidence: entry.field.confidence === "high"
        ? "high" as const
        : entry.field.confidence === "medium"
          ? "medium" as const
          : "uncertain" as const,
      sourceSupportStrength: "missing" as const,
      mappingStrength: "direct" as const,
      referralSnippet: null,
      portalSnippet: asString(entry.field.evidenceText) ?? entry.value,
      evidence: [],
      shownByDefault: !hiddenBecauseDuplicate,
      visibilityDecision: hiddenBecauseDuplicate
        ? "hidden_resolved" as DashboardVisibilityDecision
        : "show" as DashboardVisibilityDecision,
      visibilityReason: hiddenBecauseDuplicate
        ? "A dashboard field already surfaced this DOM OASIS value."
        : "DOM extraction surfaced this OASIS value for QA review.",
      strictnessFlags: ["dom_oasis_value"],
      sourceArtifacts: [domSourceArtifact],
      referralDocumentIds: [],
      oasisAssessmentId: currentOasisAssessmentId,
      valuePresence: {
        hasDocumentValue: false,
        hasChartValue: true,
        hasPrintedNoteChartValue: false,
        printedNoteSectionKey: null,
        printedNoteSectionStatus: null,
        printedNoteReviewSource: "dom_state_primary",
      },
    };
  });
  const historicalDomRows = getOasisAssessmentArtifactSources(input.artifactContents).flatMap((source) =>
    getMeaningfulOasisDomFields(source.artifactContents).map((entry, index) => {
      const fieldKeyBase =
        normalizeDashboardKey(asString(entry.field.itemCode) ?? asString(entry.field.key) ?? entry.label) ||
        `dom_field_${index + 1}`;
      const fieldKey = `dom_${safeDashboardSourceKey(source.assessmentId)}_${entry.sectionKey}_${fieldKeyBase}_${index + 1}`;
      return {
        fieldKey,
        fieldLabel: entry.label,
        sectionKey: entry.sectionKey,
        sectionLabel: entry.sectionTitle,
        sourceSectionLabel: entry.sectionTitle,
        reviewMode: "qa_readback_and_confirm",
        qaPriority: "medium",
        oasisItemId: asString(entry.field.itemCode),
        backendComparisonStatus: "missing_in_referral",
        backendWorkflowState: "missing_in_referral",
        displayStatus: "missing_in_referral" as DashboardComparisonResult,
        documentSupportedValue: null,
        currentChartValue: entry.value,
        normalizedDocumentValue: null,
        normalizedChartValue: normalizeDashboardComparisonText(entry.value),
        currentChartValueSource: "portal_dom_state",
        currentChartValueSourceLabel: getDashboardPortalValueSourceLabel("portal_dom_state"),
        oasisEvidenceMode: "portal_dom_state" as DashboardOasisEvidenceMode,
        oasisEvidenceLabel: getDashboardOasisEvidenceLabel("portal_dom_state"),
        displayReferralValue: "No reliable referral value extracted",
        displayPortalValue: entry.value,
        comparisonResult: "missing_in_referral" as DashboardComparisonResult,
        shortReason: `Historical ${source.assessmentType ?? "OASIS"} DOM extraction captured this OASIS value; referral support was not matched.`,
        reviewStatus: "Missing Referral Documentation",
        qaResultLabel: getDashboardQaResultLabel("missing_in_referral"),
        qaActionLabel: getDashboardQaActionLabel("missing_in_referral"),
        referralComparisonOrigin,
        referralComparisonOriginLabel: getDashboardReferralOriginLabel(referralComparisonOrigin),
        confidence: entry.field.confidence === "high"
          ? "high" as const
          : entry.field.confidence === "medium"
            ? "medium" as const
            : "uncertain" as const,
        sourceSupportStrength: "missing" as const,
        mappingStrength: "direct" as const,
        referralSnippet: null,
        portalSnippet: asString(entry.field.evidenceText) ?? entry.value,
        evidence: [],
        shownByDefault: true,
        visibilityDecision: "show" as DashboardVisibilityDecision,
        visibilityReason: "Historical OASIS DOM extraction surfaced this OASIS value for view-only comparison.",
        strictnessFlags: ["dom_oasis_value", "historical_oasis_value"],
        sourceArtifacts: [source.sourceArtifact],
        referralDocumentIds: [],
        oasisAssessmentId: source.assessmentId,
        valuePresence: {
          hasDocumentValue: false,
          hasChartValue: true,
          hasPrintedNoteChartValue: false,
          printedNoteSectionKey: null,
          printedNoteSectionStatus: null,
          printedNoteReviewSource: "dom_state_primary",
        },
      };
    })
  );
  const rows = [...referralRows, ...domRows, ...historicalDomRows];

  const hiddenByReason = rows.reduce<Record<string, number>>((accumulator, row) => {
    if (row.visibilityDecision === "show") {
      return accumulator;
    }

    accumulator[row.visibilityDecision] = (accumulator[row.visibilityDecision] ?? 0) + 1;
    return accumulator;
  }, {});

  return withReferralIntakeDashboardState({
    rows,
    comparisonRowsStatus: "ready" as const,
    comparisonRowsReason: null,
    comparisonRowsRowCount: rows.length,
    visibilitySummary: {
      totalRows: rows.length,
      shownRows: rows.filter((row) => row.shownByDefault).length,
      hiddenRows: rows.filter((row) => !row.shownByDefault).length,
      hiddenByReason,
      potentiallyTooStrictRows: rows
        .filter((row) => row.strictnessFlags.length > 0)
        .map((row) => row.fieldKey),
    },
    sourceCoverage: {
      printedNoteReviewSource,
      printedNoteCompletedSectionCount: getOasisDomSections(input.artifactContents).filter(
        (section) => !/^failed|degraded$/i.test(section.status),
      ).length,
      printedNoteChartValueCount: getMeaningfulOasisDomFields(input.artifactContents).length,
      fieldLevelValueCount: rows.filter(
        (row) => row.oasisEvidenceMode === "chart_read" || row.oasisEvidenceMode === "portal_dom_state",
      ).length,
      sectionEvidenceFallbackRowCount: 0,
    },
  }, input.artifactContents);
}

function derivePatientDashboardReviewSummary(
  dashboardState: ReturnType<typeof derivePatientDashboardState>,
) {
  const shownRows = dashboardState.rows.filter((row) => row.shownByDefault);
  const mismatchCount = shownRows.filter((row) => row.comparisonResult === "mismatch").length;
  const missingInPortalCount = shownRows.filter((row) => row.comparisonResult === "missing_in_portal").length;
  const missingInReferralCount = shownRows.filter((row) => row.comparisonResult === "missing_in_referral").length;
  const uncertainCount = shownRows.filter((row) => row.comparisonResult === "uncertain").length;
  const codingReviewCount = shownRows.filter((row) => row.comparisonResult === "coding_review").length;
  const resolvedCount = dashboardState.rows.filter(
    (row) => row.comparisonResult === "match",
  ).length;
  const openRowCount =
    mismatchCount +
    missingInPortalCount +
    missingInReferralCount +
    uncertainCount +
    codingReviewCount;
  const highPriorityOpenCount = shownRows.filter(
    (row) => row.qaPriority === "critical" || row.qaPriority === "high",
  ).length;

  return {
    severity:
      mismatchCount > 0 || missingInPortalCount > 0 || codingReviewCount > 0
        ? ("red" as const)
        : openRowCount > 0
          ? ("yellow" as const)
          : ("green" as const),
    openRowCount,
    shownRowCount: dashboardState.visibilitySummary.shownRows,
    hiddenRowCount: dashboardState.visibilitySummary.hiddenRows,
    mismatchCount,
    missingInPortalCount,
    missingInReferralCount,
    uncertainCount,
    codingReviewCount,
    resolvedCount,
    highPriorityOpenCount,
    potentiallyTooStrictCount: dashboardState.visibilitySummary.potentiallyTooStrictRows.length,
  };
}

function derivePatientStatusSummary(
  input: PatientViewInput,
  referralQaSummary: ReturnType<typeof deriveReferralQaSummary>,
): string {
  const sanitizedErrorSummary = sanitizeDashboardDisplayText(
    input.summary.errorSummary,
    "Read-only extraction produced low-quality evidence; source confirmation required.",
  );
  switch (input.summary.processingStatus) {
    case "COMPLETE":
      return referralQaSummary.qaStatus;
    case "BLOCKED":
      return sanitizedErrorSummary ?? sanitizeDashboardDisplayText(input.summary.matchResult.note) ?? "Blocked during read-only extraction";
    case "FAILED":
      return sanitizedErrorSummary ?? "Read-only extraction failed";
    case "NEEDS_HUMAN_REVIEW":
      return sanitizedErrorSummary ?? referralQaSummary.qaStatus;
    default:
      return "Referral QA extraction in progress";
  }
}

function sortPatientSummaries(patients: ReturnType<typeof toDashboardPatientSummary>[]) {
  return [...patients].sort((left, right) => {
    const leftDays = left.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
    const rightDays = right.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
    if (leftDays !== rightDays) {
      return leftDays - rightDays;
    }

    return left.patientName.localeCompare(right.patientName);
  });
}

function parsePatientRunCacheSummary(value: unknown): PatientRunCacheSummary | null {
  const result = patientRunCacheSummarySchema.safeParse(value);
  return result.success ? result.data : null;
}

function toPatientRunReuseSummary(value: PatientRunCacheSummary | null) {
  if (!value) {
    return null;
  }

  return {
    totalRuntimeMs: value.totalRuntimeMs,
    previousTotalRuntimeMs: value.previousTotalRuntimeMs ?? null,
    estimatedSavedTimeMs: value.estimatedSavedTimeMs ?? null,
    reuseSummary: value.reuseSummary,
    visitNotes: {
      total: value.visitNotes.total,
      reused: value.visitNotes.reused,
      processed: value.visitNotes.processed,
      skipped: value.visitNotes.skipped,
      failed: value.visitNotes.failed,
    },
    stageTimings: value.stageTimings,
    warnings: value.warnings,
  };
}

function aggregateRunReuseSummary(patients: ReturnType<typeof toDashboardPatientSummary>[]) {
  const cacheSummaries = patients
    .map((patient) => patient.patientRunCacheSummary)
    .filter((summary): summary is NonNullable<typeof summary> => summary !== null);
  const stageTotals = new Map<string, { stage: string; count: number; totalDurationMs: number }>();
  const totals = {
    patientsReused: 0,
    patientsProcessed: 0,
    patientsSkippedStatusOnly: patients.filter((patient) =>
      ["SKIPPED_PENDING", "SKIPPED_NON_ADMIT"].includes(patient.status),
    ).length,
    patientsIdentityReviewRequired: patients.filter((patient) =>
      patient.status === "NEEDS_HUMAN_REVIEW",
    ).length,
    referralProcessedCount: 0,
    referralReusedCount: 0,
    oasisRerunCount: 0,
    oasisReusedCount: 0,
    pocRerunCount: 0,
    pocReusedCount: 0,
    visitNotesProcessedCount: 0,
    visitNotesReusedCount: 0,
    estimatedSavedTimeMs: 0,
  };

  for (const summary of cacheSummaries) {
    const stageWasProcessed =
      summary.reuseSummary.referral === "processed" ||
      summary.reuseSummary.oasis === "rerun" ||
      summary.reuseSummary.planOfCare === "rerun" ||
      summary.reuseSummary.visitNotes === "processed" ||
      summary.reuseSummary.visitNotes === "mixed";
    if (stageWasProcessed) {
      totals.patientsProcessed += 1;
    } else {
      totals.patientsReused += 1;
    }

    if (summary.reuseSummary.referral === "processed") totals.referralProcessedCount += 1;
    if (summary.reuseSummary.referral === "reused") totals.referralReusedCount += 1;
    if (summary.reuseSummary.oasis === "rerun") totals.oasisRerunCount += 1;
    if (summary.reuseSummary.oasis === "reused") totals.oasisReusedCount += 1;
    if (summary.reuseSummary.planOfCare === "rerun") totals.pocRerunCount += 1;
    if (summary.reuseSummary.planOfCare === "reused") totals.pocReusedCount += 1;
    totals.visitNotesProcessedCount += summary.visitNotes.processed;
    totals.visitNotesReusedCount += summary.visitNotes.reused;
    totals.estimatedSavedTimeMs += summary.estimatedSavedTimeMs ?? 0;

    for (const stageTiming of summary.stageTimings) {
      const current = stageTotals.get(stageTiming.stage) ?? {
        stage: stageTiming.stage,
        count: 0,
        totalDurationMs: 0,
      };
      current.count += 1;
      current.totalDurationMs += stageTiming.durationMs;
      stageTotals.set(stageTiming.stage, current);
    }
  }

  return {
    ...totals,
    stageTimings: Array.from(stageTotals.values()).map((stage) => ({
      ...stage,
      averageDurationMs: stage.count > 0 ? Math.round(stage.totalDurationMs / stage.count) : 0,
    })),
  };
}

export function toDashboardRunListItem(
  batch: BatchRecord,
  resolvedPatients?: Array<{ status: string; errorSummary: string | null }>,
) {
  const counts = resolvedPatients
    ? countPatientSummariesByStatus(batch, resolvedPatients)
    : countPatientsByStatus(batch);

  return {
    ...toSubsidiarySummary(batch),
    id: batch.id,
    billingPeriod: batch.billingPeriod,
    status: batch.status,
    currentExecutionStep: deriveCurrentExecutionStep(batch),
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    createdAt: batch.createdAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch, resolvedPatients),
    runMode: batch.runMode,
    rerunEnabled: batch.schedule.rerunEnabled && batch.schedule.active,
    lastRunAt: batch.schedule.lastRunAt,
    nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
  };
}

export function toDashboardPatientSummary(input: PatientViewInput) {
  const patientRunCacheSummary = parsePatientRunCacheSummary(input.artifactContents.patientRunCacheSummary);
  const diagnosisSummary = deriveDiagnosisSummary(input);
  const referralMedicationSummary = deriveReferralMedicationSummary(input);
  const oasisMedicationSummary = deriveOasisMedicationSummary(input);
  const codingWorkflow = deriveWorkflowTrack(input, "coding");
  const qaWorkflow = deriveWorkflowTrack(input, "qa");
  const qaPrefetch = deriveQaPrefetchSummary(input);
  const oasisValidation = deriveOasisValidationSummary(input);
  const referralOasisConsistency = deriveReferralOasisConsistencySummary(input);
  const oasisGate = deriveOasisGateSummary(input);
  const generatedPlanOfCare = deriveGeneratedPlanOfCareSummary(input);
  const oasisValidatedForPlanOfCare = deriveOasisValidatedForPlanOfCare({
    artifactContents: input.artifactContents,
    oasisValidation,
    oasisGate,
  });
  const planOfCareReview = derivePlanOfCareReview(input.artifactContents, oasisValidatedForPlanOfCare);
  const reviewerDiagnostics = deriveReviewerLlmDiagnosticsSummary(input.artifactContents);
  const clinicalDiscrepancyReview = deriveClinicalDiscrepancyReview(input.artifactContents);
  const visitNotesReview = deriveVisitNotesReview(input.artifactContents, planOfCareReview);
  const oasisDocumentationReview = deriveOasisDocumentationReview(input.artifactContents);
  const referralDocumentationReview = deriveReferralDocumentationReview(input.artifactContents);
  const diagnosisReconciliationReview = deriveDiagnosisReconciliationReview(input.artifactContents);
  const referralQa = deriveReferralQaSummary(input);
  const dashboardState = derivePatientDashboardState({
    referralQa,
    qaPrefetch,
    artifactContents: input.artifactContents,
  });
  const dashboardReview = derivePatientDashboardReviewSummary(dashboardState);

  return {
    ...toSubsidiarySummary(input.batch),
    runId: input.summary.runId,
    batchId: input.batch.id,
    subsidiaryId: input.summary.subsidiaryId ?? input.batch.subsidiary.id,
    workItemId: input.summary.workItemId,
    patientName: input.summary.patientName,
    status: input.summary.processingStatus,
    executionStep: input.summary.executionStep,
    percentComplete: input.summary.progressPercent,
    startedAt: input.summary.startedAt,
    completedAt: input.summary.completedAt,
    lastUpdatedAt: input.summary.lastUpdatedAt,
    errorSummary: sanitizeDashboardDisplayText(
      input.summary.errorSummary,
      input.summary.errorSummary
        ? "Read-only extraction produced low-quality evidence; source confirmation required."
        : null,
    ),
    retryEligible: input.summary.retryEligible,
    attemptCount: input.summary.attemptCount,
    resultBundlePath: input.summary.resultBundlePath,
    logPath: input.summary.logPath,
      batchStatusSummary: derivePatientStatusSummary(input, referralQa),
      daysLeftBeforeOasisDueDate: deriveDaysLeftBeforeOasisDueDate(input),
      primaryDiagnosis: diagnosisSummary.primaryDiagnosis,
      otherDiagnoses: diagnosisSummary.otherDiagnoses,
      diagnosisSource: diagnosisSummary.diagnosisSource,
      referralDiagnosisSummary: diagnosisSummary.referralDiagnosisSummary,
      oasisDiagnosisSummary: diagnosisSummary.oasisDiagnosisSummary,
      diagnosisComparisonStatus: diagnosisSummary.diagnosisComparisonStatus,
      referralMedicationSummary,
      oasisMedicationSummary,
      runMode: input.batch.runMode,
    rerunEnabled: input.batch.schedule.rerunEnabled && input.batch.schedule.active,
    lastRunAt: input.batch.schedule.lastRunAt,
    nextScheduledRunAt: input.batch.schedule.nextScheduledRunAt,
    codingWorkflow,
    qaWorkflow,
    qaPrefetch,
    oasisValidation,
    referralOasisConsistency,
    oasisGate,
    oasisValidatedForPlanOfCare,
    generatedPlanOfCare,
    generatedPlanOfCareStatus: generatedPlanOfCare?.status ?? "not_attempted",
    planOfCareReview,
    oasisDocumentationReview,
    referralDocumentationReview,
    diagnosisReconciliationReview,
    reviewerDiagnostics,
    clinicalDiscrepancyReview,
    visitNotesReview,
    referralQa,
    dashboardReview,
    patientRunCacheSummary: toPatientRunReuseSummary(patientRunCacheSummary),
    changeSummary: input.changeSummary ?? null,
  };
}

export function toDashboardRunDetail(input: {
  batch: BatchRecord;
  patients: ReturnType<typeof toDashboardPatientSummary>[];
}) {
  const patients = sortPatientSummaries(input.patients);
  const counts = countPatientSummariesByStatus(input.batch, patients);

  return {
    ...toDashboardRunListItem(input.batch, patients),
    sourceWorkbookName: input.batch.sourceWorkbook.originalFileName,
    uploadedAt: input.batch.sourceWorkbook.uploadedAt,
    canRetryBlockedPatients: patients.some((patient) => patient.retryEligible),
    canDeactivate: input.batch.schedule.active,
    patientStatusSummary: {
      ready: counts.totalCompleted,
      blocked: counts.totalBlocked,
      failed: counts.totalFailed,
      needsManualReview: counts.totalNeedsHumanReview,
      inProgress: counts.currentlyRunningCount,
    },
    runReuseSummary: aggregateRunReuseSummary(patients),
    patients,
  };
}

export function toDashboardPatientDetail(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);
  const dashboardState = derivePatientDashboardState({
    referralQa: summary.referralQa,
    qaPrefetch: summary.qaPrefetch,
    artifactContents: input.artifactContents,
  });

  return {
    ...summary,
    workbookContext: {
      billingPeriod: input.workItem?.episodeContext.billingPeriod ?? null,
      workflowTypes: input.workItem?.workflowTypes ?? [],
      rawDaysLeftValues: input.workItem?.timingMetadata?.rawDaysLeftValues ?? [],
    },
    dashboardState,
    referralPatientContext: summary.referralQa.patientContext,
    referralSections: summary.referralQa.sections,
  };
}

export function toDashboardPatientStatus(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);
  return {
    runId: summary.runId,
    batchId: summary.batchId,
    subsidiaryId: summary.subsidiaryId,
    subsidiarySlug: summary.subsidiarySlug,
    subsidiaryName: summary.subsidiaryName,
    patientId: summary.workItemId,
      patientName: summary.patientName,
      status: summary.status,
      executionStep: summary.executionStep,
      batchStatusSummary: summary.batchStatusSummary,
      primaryDiagnosis: summary.primaryDiagnosis,
      otherDiagnoses: summary.otherDiagnoses,
      diagnosisSource: summary.diagnosisSource,
      referralDiagnosisSummary: summary.referralDiagnosisSummary,
      oasisDiagnosisSummary: summary.oasisDiagnosisSummary,
      diagnosisComparisonStatus: summary.diagnosisComparisonStatus,
      runMode: summary.runMode,
    rerunEnabled: summary.rerunEnabled,
    lastRunAt: summary.lastRunAt,
    nextScheduledRunAt: summary.nextScheduledRunAt,
    lastUpdatedAt: summary.lastUpdatedAt,
    codingWorkflow: summary.codingWorkflow,
    qaWorkflow: summary.qaWorkflow,
    qaPrefetch: summary.qaPrefetch,
    oasisValidation: summary.oasisValidation,
    referralOasisConsistency: summary.referralOasisConsistency,
    oasisGate: summary.oasisGate,
    generatedPlanOfCare: summary.generatedPlanOfCare,
    generatedPlanOfCareStatus: summary.generatedPlanOfCareStatus,
    reviewerDiagnostics: summary.reviewerDiagnostics,
    referralQa: summary.referralQa,
  };
}

export function toBatchSummaryResponse(batch: BatchRecord) {
  const counts = countPatientsByStatus(batch);

  return {
    ...toSubsidiarySummary(batch),
    batchId: batch.id,
    currentBatchStatus: batch.status,
    currentExecutionStep: deriveCurrentExecutionStep(batch),
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    createdAt: batch.createdAt,
    startedAt: batch.run.requestedAt ?? batch.parse.requestedAt ?? batch.createdAt,
    completedAt: batch.run.completedAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch),
    runMode: batch.runMode,
    rerunEnabled: batch.schedule.rerunEnabled && batch.schedule.active,
    lastRunAt: batch.schedule.lastRunAt,
    nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
  };
}

export {
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
};
