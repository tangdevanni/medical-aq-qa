import type { ClinicalFactCategory, ClinicalFactSourceType } from "./clinical-fact-pack";

export type ClinicalContradictionVerdict =
  | "match"
  | "contradiction"
  | "missing_in_oasis"
  | "missing_in_source"
  | "newer_source_conflict"
  | "newer_oasis_conflict"
  | "resolved_condition"
  | "uncertain";

export type ClinicalContradictionSeverity = "low" | "medium" | "high";

export type ClinicalContradictionPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

export type ClinicalContradictionEvidenceStrength = "strong" | "moderate" | "weak";

export type ClinicalContradictionComparisonStrictness = "strict" | "balanced" | "loose";

export type ClinicalContradictionSuppressionReason =
  | "low_confidence_source_fact"
  | "section_fallback_only"
  | "expected_oasis_omission"
  | "duplicate_concept"
  | "historical_or_resolved"
  | "administrative_or_non_clinical"
  | "missing_counterevidence"
  | "low_clinical_impact"
  | "fact_pack_gap"
  | "none";

export type ClinicalContradictionCategory =
  | "diagnosis"
  | "icd_code"
  | "cognitive_status"
  | "mental_status"
  | "orientation"
  | "medication"
  | "allergy"
  | "wound"
  | "hospitalization"
  | "homebound_status"
  | "skilled_need"
  | "functional_status"
  | "fall_risk"
  | "therapy_need"
  | "caregiver_support"
  | "plan_of_care"
  | "other";

export type ClinicalFactReference = {
  factId: string;
  category: ClinicalFactCategory;
  label: string;
  normalizedValue: string;
  polarity: "present" | "absent" | "unknown" | "resolved" | "historical";
  clinicalStatus?: "active" | "resolved" | "historical" | "ruled_out" | "unknown";
  confidence: number;
  date?: string;
  sourceType: ClinicalFactSourceType;
  sourceDocumentKey?: string;
};

export type ClinicalContradictionEvidence = {
  factId: string;
  artifactPath: string;
  documentKey?: string;
  section?: string;
  snippet?: string;
};

export type ClinicalContradictionFinding = {
  findingId: string;
  category: ClinicalContradictionCategory;
  title: string;
  verdict: ClinicalContradictionVerdict;
  severity: ClinicalContradictionSeverity;
  confidence: number;
  needsHumanReview: boolean;
  reviewerVisible: boolean;
  priority: ClinicalContradictionPriority;
  evidenceStrength: ClinicalContradictionEvidenceStrength;
  comparisonStrictness: ClinicalContradictionComparisonStrictness;
  suppressionReason?: ClinicalContradictionSuppressionReason;
  sourceFacts: ClinicalFactReference[];
  oasisFacts: ClinicalFactReference[];
  sourceSummary: string;
  oasisSummary: string;
  rationale: string;
  dateAssessment?: {
    sourceDate?: string;
    oasisDate?: string;
    newerSide?: "source" | "oasis" | "unknown";
    recencyImpact: "none" | "low" | "medium" | "high";
  };
  evidence: ClinicalContradictionEvidence[];
  llmUsed: boolean;
  deterministicRuleIds: string[];
};

export type ClinicalContradictionAnalysisLlmStatus =
  | "disabled"
  | "success"
  | "failed_deterministic_only";

export type ClinicalContradictionReviewerQueueInterpretation =
  | "no_actionable_discrepancies_detected"
  | "actionable_discrepancies_detected"
  | "insufficient_evidence"
  | "analysis_degraded";

export type ClinicalContradictionAnalysis = {
  schemaVersion: "clinical-contradiction-analysis.v1";
  generatedAt: string;
  sourceFactPackHash: string;
  oasisFactPackHash: string;
  llmStatus: ClinicalContradictionAnalysisLlmStatus;
  llmModelId?: string | null;
  llmErrorCategory?: string | null;
  promptInputFactCount?: number;
  promptTokenEstimate?: number;
  deterministicFindingCount: number;
  llmFindingCount: number;
  findingCount: number;
  highSeverityCount: number;
  needsReviewCount: number;
  reviewerVisibleCount: number;
  suppressedCount: number;
  priorityCounts: Record<ClinicalContradictionPriority, number>;
  categoryCounts: Record<string, number>;
  verdictCounts: Record<ClinicalContradictionVerdict, number>;
  reviewerQueueInterpretation: ClinicalContradictionReviewerQueueInterpretation;
  summary: {
    totalFindings: number;
    reviewerVisibleCount: number;
    suppressedCount: number;
    highPriorityCount: number;
    mediumPriorityCount: number;
    informationalCount: number;
    topCategories: string[];
    topVerdicts: string[];
    llmStatus: ClinicalContradictionAnalysisLlmStatus;
  };
  reviewerQueue: ClinicalContradictionFinding[];
  findings: ClinicalContradictionFinding[];
  warnings: string[];
};
