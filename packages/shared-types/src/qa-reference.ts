export type QaFieldGroupKey =
  | "medical_necessity_and_homebound"
  | "diagnosis_and_coding"
  | "medications_allergies_and_special_treatments"
  | "functional_and_therapy_status"
  | "symptom_and_body_system_review"
  | "risk_and_safety_assessments"
  | "care_plan_and_coordination"
  | "supplementals_and_history"
  | "low_priority_admin_reference";

export type QaWorkflowSectionKey =
  | "administrative_information"
  | "active_diagnoses"
  | "vital_signs_and_pain_assessment"
  | "medication_allergies_and_injectables"
  | "neurological_head_mood_eyes_ears"
  | "cardiopulmonary_chest_thorax"
  | "gastrointestinal_and_genitourinary_assessment"
  | "integumentary_skin_and_wound"
  | "safety_and_risk_assessment"
  | "functional_assessment_self_care"
  | "functional_assessment_mobility_and_musculoskeletal"
  | "endocrine_diabetic_management"
  | "plan_of_care_and_physical_therapy_evaluation"
  | "patient_summary_and_clinical_narrative"
  | "care_plan_problems_goals_interventions"
  | "footer_non_print_preview";

export type QaFieldType =
  | "text"
  | "textarea"
  | "date"
  | "phone"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "object"
  | "array"
  | "score"
  | "diagnosis_row"
  | "medication_row"
  | "narrative";

export type QaControlType =
  | "input"
  | "textarea"
  | "radio"
  | "checkbox"
  | "dropdown"
  | "matrix"
  | "table"
  | "ai_narrative"
  | "reference_only";

export type QaFieldPriority = "critical" | "high" | "medium" | "low";

export type QaDashboardVisibility = "default" | "expanded" | "hidden";
export type QaDashboardPrintVisibility = "visible" | "hidden_in_print";

export type QaFieldReviewMode =
  | "compare_referral_to_chart"
  | "chart_completeness_check"
  | "qa_readback_and_confirm"
  | "coding_review_required"
  | "reference_only";

export interface QaFieldRegistryEntry {
  fieldKey: string;
  label: string;
  groupKey: QaFieldGroupKey;
  sectionKey: QaWorkflowSectionKey;
  oasisItemId?: string | null;
  fieldType: QaFieldType;
  controlType: QaControlType;
  qaPriority: QaFieldPriority;
  dashboardVisibility: QaDashboardVisibility;
  reviewMode: QaFieldReviewMode;
  canInferFromReferral: boolean;
  compareAgainstChart: boolean;
  requiresHumanReview: boolean;
  requiresCodingTeamReview: boolean;
  narrativeField: boolean;
  medicationField: boolean;
  diagnosisField: boolean;
  lowValueAdminField: boolean;
  supportedEvidenceSources: string[];
  notes?: string | null;
}

export interface QaFieldGroupDefinition {
  groupKey: QaFieldGroupKey;
  label: string;
  description: string;
  dashboardOrder: number;
}

export type QaSectionReviewStyle =
  | "completeness_driven"
  | "compare_driven"
  | "narrative_driven"
  | "coding_sensitive"
  | "medication_safety";

export interface QaSectionMetadata {
  sectionKey: QaWorkflowSectionKey;
  label: string;
  groupKey: QaFieldGroupKey;
  reviewStyle: QaSectionReviewStyle;
  aiSupportExpected: boolean;
  codingReviewPossible: boolean;
  notes?: string | null;
}

export type QaFieldComparisonStatus =
  | "match"
  | "missing_in_chart"
  | "supported_by_referral"
  | "possible_conflict"
  | "needs_coding_review"
  | "needs_qa_readback"
  | "not_relevant_for_dashboard";

export type QaReviewWorkflowState =
  | "already_satisfactory"
  | "missing_in_chart"
  | "supported_by_referral"
  | "possible_conflict"
  | "needs_coding_review"
  | "needs_qa_readback"
  | "not_relevant_for_dashboard";

export type QaFieldRecommendedAction =
  | "none"
  | "review_in_chart"
  | "qa_readback_and_confirm"
  | "escalate_to_coding"
  | "add_if_supported"
  | "reference_only";

export interface QaFieldSourceEvidence {
  sourceType: string;
  sourceLabel: string;
  textSpan?: string | null;
  confidence?: number | null;
}

export interface QaDashboardFieldReference {
  fieldKey: string;
  label: string;
  groupKey: QaFieldGroupKey;
  qaPriority: QaFieldPriority;
  currentChartValue: unknown;
  documentSupportedValue: unknown;
  comparisonStatus: QaFieldComparisonStatus;
  workflowState: QaReviewWorkflowState;
  recommendedAction: QaFieldRecommendedAction;
  sourceEvidence: QaFieldSourceEvidence[];
  requiresHumanReview: boolean;
}

export interface QaProposedReferenceValue {
  value: unknown;
  confidence: number | null;
  rationale: string | null;
  requiresHumanReview: boolean;
}

export interface QaReviewQueueEntry {
  fieldKey: string;
  groupKey: QaFieldGroupKey;
  sectionKey: QaWorkflowSectionKey;
  qaPriority: QaFieldPriority;
  comparisonStatus: QaFieldComparisonStatus;
  workflowState: QaReviewWorkflowState;
  recommendedAction: QaFieldRecommendedAction;
}

export interface PatientQaReferenceContext {
  patientId: string;
  patientName: string | null;
  dob: string | null;
  socDate: string | null;
  referralDate: string | null;
}

export interface QaReferralDashboardLineReference {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

export interface QaReferralDashboardTextSpan {
  text: string;
  sourceSectionNames: string[];
  relatedFieldKeys: string[];
  lineReferences: QaReferralDashboardLineReference[];
}

export interface QaReferralDashboardSection {
  sectionKey: QaWorkflowSectionKey;
  label: string;
  dashboardOrder: number;
  printVisibility: QaDashboardPrintVisibility;
  fieldKeys: string[];
  textSpans: QaReferralDashboardTextSpan[];
}

export interface QaReferralConsistencyCheck {
  id: string;
  status: "flagged" | "watch";
  title: string;
  detail: string;
  relatedSections: string[];
}

export interface QaReferralSourceHighlight {
  id: string;
  title: string;
  summary: string;
  supportingSections: string[];
}

export interface QaReferralDraftNarrative {
  fieldKey: string;
  label: string;
  draft: string;
  status: "ready_for_qa" | "needs_human_review";
}

export interface QaReferralInsights {
  generatedAt: string;
  warnings: string[];
  consistencyChecks: QaReferralConsistencyCheck[];
  sourceHighlights: QaReferralSourceHighlight[];
  draftNarratives: QaReferralDraftNarrative[];
}

export interface PatientQaReference {
  patientContext: PatientQaReferenceContext;
  fieldRegistry: QaFieldRegistryEntry[];
  fieldGroups: QaFieldGroupDefinition[];
  sectionMetadata: QaSectionMetadata[];
  referralDashboardSections: QaReferralDashboardSection[];
  referralQaInsights?: QaReferralInsights | null;
  chartSnapshot: Record<string, unknown>;
  documentEvidence: Record<string, QaFieldSourceEvidence[]>;
  proposedReferenceValues: Record<string, QaProposedReferenceValue>;
  comparisonResults: Record<string, QaDashboardFieldReference>;
  qaReviewQueue: QaReviewQueueEntry[];
}
