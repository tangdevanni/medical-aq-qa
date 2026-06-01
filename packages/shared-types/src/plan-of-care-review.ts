export type PlanOfCareDiagnosisSourcePriority =
  | "oasis_fact_pack"
  | "oasis_snapshot"
  | "printed_note"
  | "field_map"
  | "coding_input_fallback";

export type PlanOfCareSourceType =
  | "oasis_portal"
  | "generated_suggestion";

export type PlanOfCareSourceLabel =
  | "From OASIS"
  | "Suggested";

export type PlanOfCareSourceMetadata = {
  sourceType: PlanOfCareSourceType;
  sourceLabel: PlanOfCareSourceLabel;
  sourceHash: string;
  capturedAt: string;
};

export type PlanOfCareLlmStatus =
  | "disabled"
  | "success"
  | "failed_deterministic_only";

export type PlanOfCareClinicalDomain =
  | "respiratory_infection"
  | "swallowing_nutrition"
  | "cardiac_chf"
  | "cardiac_rhythm"
  | "endocrine_medication"
  | "psychosocial_mental_health"
  | "mobility_fall_risk"
  | "historical_respiratory"
  | "wound_skin"
  | "medication_management"
  | "general_skilled_need"
  | "unknown";

export type PlanOfCareDomainMatchStatus =
  | "matched"
  | "weak_match"
  | "mismatch"
  | "no_candidate";

export type PlanOfCareInterventionScope =
  | "diagnosis_specific"
  | "general_home_health_education";

export type PlanOfCareDiagnosisSourceEntry = {
  diagnosisKey: string;
  icdCode?: string;
  label: string;
  rank?: number;
  isPrimary?: boolean;
  sourceFactIds: string[];
  sourceArtifactPaths: string[];
  confidence: number;
};

export type PlanOfCareDiagnosisSourceArtifact = {
  schemaVersion: "plan-of-care-diagnosis-source.v1";
  generatedAt: string;
  sourcePriorityUsed: PlanOfCareDiagnosisSourcePriority;
  diagnoses: PlanOfCareDiagnosisSourceEntry[];
  warnings: string[];
};

export type PlanOfCareCandidateEntry = {
  bankEntryId: string;
  text: string;
  score: number;
  clinicalDomain?: PlanOfCareClinicalDomain;
  matchedSignals: string[];
  matchedEvidenceIds: string[];
};

export type PlanOfCareCandidateDiagnosisGroup = {
  diagnosisKey: string;
  diagnosisLabel: string;
  icdCode?: string;
  clinicalDomain?: PlanOfCareClinicalDomain;
  candidateProblems: PlanOfCareCandidateEntry[];
  candidateGoals: PlanOfCareCandidateEntry[];
  candidateInterventions: PlanOfCareCandidateEntry[];
  retrievalConfidence: number;
  retrievalWarnings: string[];
  domainMatchStatus?: PlanOfCareDomainMatchStatus;
  domainWarnings?: string[];
  exclusionReason?: string;
};

export type PlanOfCareCandidatesArtifact = {
  schemaVersion: "plan-of-care-candidates.v1";
  generatedAt: string;
  diagnosisCandidateGroups: PlanOfCareCandidateDiagnosisGroup[];
};

export type PlanOfCareReviewSelection = {
  selectedText: string;
  bankEntryId?: string;
  measurableTarget?: string;
  tailoredInstruction?: string;
  rationale: string;
  confidence: number;
  evidenceFactIds: string[];
  interventionScope?: PlanOfCareInterventionScope;
};

export type PlanOfCareReviewDiagnosisDraft = {
  diagnosisKey: string;
  diagnosisLabel: string;
  icdCode?: string;
  sourceType?: PlanOfCareSourceType;
  sourceLabel?: PlanOfCareSourceLabel;
  sourceHash?: string;
  capturedAt?: string;
  clinicalDomain?: PlanOfCareClinicalDomain;
  selectedCandidateDomain?: PlanOfCareClinicalDomain;
  domainMatchStatus?: PlanOfCareDomainMatchStatus;
  domainWarnings?: string[];
  exclusionReason?: string;
  unsupportedClaimDetected?: boolean;
  unsupportedClaimType?: string;
  unsupportedClaimText?: string;
  evidenceRequired?: string[];
  candidateRejectedReason?: string;
  problem: PlanOfCareReviewSelection;
  goal: PlanOfCareReviewSelection;
  interventions: PlanOfCareReviewSelection[];
  needsHumanReview: boolean;
  warnings: string[];
};

export type PlanOfCareReviewRelatedDiagnosis = {
  diagnosisKey?: string;
  label: string;
  icdCode?: string;
};

export type PlanOfCareReviewProblemGroupGoal = {
  text: string;
  measurableTarget?: string;
  evidenceFactIds: string[];
  confidence: number;
  needsHumanReview: boolean;
};

export type PlanOfCareReviewProblemGroupIntervention = {
  text: string;
  rationale: string;
  evidenceFactIds: string[];
  confidence: number;
  needsHumanReview: boolean;
  bankEntryId?: string;
  bankText?: string;
  llmGenerated: boolean;
};

export type PlanOfCareReviewProblemGroup = {
  groupKey: string;
  sourceType?: PlanOfCareSourceType;
  sourceLabel?: PlanOfCareSourceLabel;
  sourceHash?: string;
  capturedAt?: string;
  clinicalDomain?: PlanOfCareClinicalDomain;
  domainMatchStatus?: PlanOfCareDomainMatchStatus;
  domainWarnings?: string[];
  problemTitle: string;
  relatedDiagnoses: PlanOfCareReviewRelatedDiagnosis[];
  problemStatement: string;
  goals: PlanOfCareReviewProblemGroupGoal[];
  interventions: PlanOfCareReviewProblemGroupIntervention[];
  evidenceFactIds: string[];
  confidence: number;
  needsHumanReview: boolean;
  warnings: string[];
};

export type PlanOfCareGlobalIntervention = {
  scope: PlanOfCareInterventionScope;
  sourceType?: PlanOfCareSourceType;
  sourceLabel?: PlanOfCareSourceLabel;
  sourceHash?: string;
  capturedAt?: string;
  title: string;
  text: string;
  evidenceFactIds: string[];
  confidence: number;
  sourceDiagnosisKeys: string[];
  sourceBankEntryIds: string[];
};

export type PlanOfCareReviewSummary = {
  diagnosisCount: number;
  draftedDiagnosisCount: number;
  carePlanProblemGroupCount?: number;
  needsReviewCount: number;
  lowConfidenceCount: number;
  missingCandidateCount: number;
  sourcePriorityUsed: PlanOfCareDiagnosisSourcePriority | null;
  llmStatus: PlanOfCareLlmStatus;
  llmErrorCategory?: string | null;
  promptDiagnosisCount?: number;
  promptTokenEstimate?: number;
  llmTailoredDiagnosisCount?: number;
  llmRetryAttempted?: boolean;
  llmRetrySucceeded?: boolean;
  llmRawOutputHash?: string | null;
  llmParsedDiagnosisCount?: number;
  warnings: string[];
};

export type PlanOfCareReviewDraftArtifact = {
  schemaVersion: "plan-of-care-review-draft.v1";
  generatedAt: string;
  pocSource?: PlanOfCareSourceMetadata;
  sourcePriorityUsed: PlanOfCareDiagnosisSourcePriority | null;
  llmStatus: PlanOfCareLlmStatus;
  llmModelId?: string | null;
  llmErrorCategory?: string | null;
  promptDiagnosisCount?: number;
  promptTokenEstimate?: number;
  llmTailoredDiagnosisCount?: number;
  llmRetryAttempted?: boolean;
  llmRetrySucceeded?: boolean;
  llmRawOutputHash?: string | null;
  llmParsedDiagnosisCount?: number;
  diagnosisDrafts: PlanOfCareReviewDiagnosisDraft[];
  carePlanProblemGroups?: PlanOfCareReviewProblemGroup[];
  globalInterventions?: PlanOfCareGlobalIntervention[];
  summary: PlanOfCareReviewSummary;
  warnings: string[];
};
