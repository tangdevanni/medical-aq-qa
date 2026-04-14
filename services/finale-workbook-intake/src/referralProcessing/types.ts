import type { PatientQaReference } from "@medical-ai-qa/shared-types";

export type ReferralSourceDocumentType =
  | "REFERRAL_ORDER"
  | "ADMISSION_ORDER"
  | "HOSPITAL_DISCHARGE"
  | "OTHER";

export type SourceDocumentAcquisitionMethod =
  | "network_pdf_response"
  | "download"
  | "printed_pdf"
  | "local_file"
  | "in_memory_fallback";

export type SourceDocumentFileType = "pdf" | "jpg" | "jpeg" | "png" | "unknown";

export type SourceDocumentSelectionStatus = "selected" | "candidate" | "rejected";

export interface SourceDocumentReference {
  documentId: string;
  sourceIndex: number;
  sourceLabel: string;
  normalizedSourceLabel: string;
  sourceType: ReferralSourceDocumentType;
  acquisitionMethod: SourceDocumentAcquisitionMethod;
  selectionStatus: SourceDocumentSelectionStatus;
  portalLabel: string | null;
  localFilePath: string | null;
  effectiveTextSource: string | null;
  fileType: SourceDocumentFileType;
  fileSizeBytes: number | null;
  extractedTextLength: number;
  selectedReason: string | null;
  rejectedReasons: string[];
}

export interface SourceDocumentArtifact {
  patientId: string;
  selectedDocumentId: string | null;
  sourceDocuments: SourceDocumentReference[];
  warnings: string[];
  generatedAt: string;
}

export type ExtractionQualityRejectedReason =
  | "viewer_chrome_only"
  | "too_short"
  | "no_clinical_vocabulary"
  | "no_date_patterns"
  | "corrupted_encoding"
  | "ocr_retry_recommended"
  | "unsupported_file_type"
  | "empty_text";

export type ExtractionUsabilityStatus = "usable" | "needs_ocr_retry" | "rejected";

export interface DocumentExtractionQuality {
  characterCount: number;
  lineCount: number;
  normalizedTokenCount: number;
  containsClinicalVocabulary: boolean;
  containsDiagnosisLikePatterns: boolean;
  containsDatePatterns: boolean;
  containsSectionLikeHeadings: boolean;
  likelyUsableForLlm: boolean;
  likelyRequiresOcrRetry: boolean;
  likelyCorruptedEncoding: boolean;
  rejectedReasons: ExtractionQualityRejectedReason[];
  usabilityStatus: ExtractionUsabilityStatus;
}

export interface SourceDocumentExtractionResult {
  documentId: string;
  localFilePath: string | null;
  fileType: SourceDocumentFileType;
  extractionMethod: "digital_pdf_text" | "ocr_text" | "image_ocr" | "in_memory_fallback" | "failed";
  extractionSuccess: boolean;
  effectiveTextSource: string | null;
  rawExtractedTextSource: string | null;
  textSelectionReason: string | null;
  domExtractionRejectedReasons: string[];
  pdfType: "digital_text_pdf" | "scanned_image_pdf" | null;
  ocrUsed: boolean;
  ocrProvider: "textract" | null;
  ocrResultPath: string | null;
  extractedTextPath: string | null;
  extractionQuality: DocumentExtractionQuality;
  failureReasons: string[];
  warnings: string[];
  generatedAt: string;
}

export interface SectionSpanReference {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

export interface NormalizedReferralSection {
  sectionName: string;
  extractedTextSpans: string[];
  normalizedSummary: string | null;
  confidence: number;
  lineReferences: SectionSpanReference[];
}

export type ReferralFieldCategory =
  | "administrative_information"
  | "patient_identity_demographics"
  | "assessment_context"
  | "payer_and_utilization"
  | "medical_necessity_homebound"
  | "emergency_directives_cultural"
  | "past_medical_history"
  | "living_situation_caregiver"
  | "active_diagnoses"
  | "pain_medications_allergies"
  | "immunization_neuro_psych_cardiopulmonary"
  | "nutrition_gi_gu_integument_safety"
  | "risk_scores_and_function"
  | "therapy_plan_and_narrative";

export type ReferralFieldType =
  | "text"
  | "textarea"
  | "date"
  | "phone"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "object"
  | "array"
  | "matrix"
  | "diagnosis_row";

export type ReferralFieldControl =
  | "text_input"
  | "textarea"
  | "date_picker"
  | "checkbox"
  | "radio_group"
  | "select"
  | "multi_select"
  | "object_group"
  | "repeating_rows";

export type ReferralCompareStrategy =
  | "exact_string"
  | "normalized_string"
  | "date_equivalence"
  | "unordered_set_overlap"
  | "ranked_diagnosis_compare"
  | "narrative_support_compare"
  | "presence_only";

export type ReferralEvidenceStrategy =
  | "direct_span"
  | "section_summary"
  | "cross_section"
  | "diagnosis_table"
  | "manual_review";

export interface ReferralFieldOption {
  label: string;
  value: string;
}

export interface ReferralFieldDefinition {
  key: string;
  label: string;
  category: ReferralFieldCategory;
  type: ReferralFieldType;
  control: ReferralFieldControl;
  options: ReferralFieldOption[];
  llm_fill_candidate: boolean;
  human_review_required: boolean;
  reference_only: boolean;
  compare_strategy: ReferralCompareStrategy;
  evidence_strategy: ReferralEvidenceStrategy;
}

export type ChartSnapshotValueSource = "chart_read" | "workbook_context" | "unavailable";

export interface ChartSnapshotValue {
  fieldKey: string;
  currentValue: unknown;
  source: ChartSnapshotValueSource;
  populated: boolean;
}

export interface FieldMapSnapshot {
  generatedAt: string;
  fields: Array<ReferralFieldDefinition & {
    currentChartValue: unknown;
    currentChartValueSource: ChartSnapshotValueSource;
    populatedInChart: boolean;
  }>;
  already_populated_from_chart: string[];
  candidate_fields_for_llm_inference_from_referral: string[];
  required_human_review_fields: string[];
  non_fillable_reference_only_fields: string[];
}

export interface ReferralFieldProposal {
  field_key: string;
  proposed_value: unknown;
  confidence: number;
  source_spans: string[];
  rationale: string;
  requires_human_review: boolean;
}

export interface ReferralDiagnosisCandidate {
  description: string;
  icd10_code: string | null;
  confidence: number;
  source_spans: string[];
  is_primary_candidate: boolean;
  requires_human_review: boolean;
}

export interface ReferralPatientContext {
  patient_name: string | null;
  dob: string | null;
  soc_date: string | null;
  referral_date: string | null;
}

export interface ReferralLlmProposal {
  patient_context: ReferralPatientContext;
  proposed_field_values: ReferralFieldProposal[];
  diagnosis_candidates: ReferralDiagnosisCandidate[];
  caregiver_candidates: Array<Record<string, unknown>>;
  unsupported_or_missing_fields: string[];
  warnings: string[];
}

export type ReferralFactCategory =
  | "patient_context"
  | "hospitalization"
  | "caregiver"
  | "medical_necessity"
  | "homebound"
  | "living_situation"
  | "functional"
  | "therapy"
  | "risk"
  | "directive";

export interface ReferralExtractedFact {
  fact_key: string;
  category: ReferralFactCategory;
  value: unknown;
  confidence: number;
  evidence_spans: string[];
  rationale: string;
  source_sections: string[];
  requires_human_review: boolean;
}

export interface ReferralExtractedFacts {
  patient_context: ReferralPatientContext;
  facts: ReferralExtractedFact[];
  diagnosis_candidates: ReferralDiagnosisCandidate[];
  caregiver_candidates: Array<Record<string, unknown>>;
  unsupported_or_missing_fields: string[];
  warnings: string[];
}

export interface ReferralQaConsistencyCheck {
  id: string;
  status: "flagged" | "watch";
  title: string;
  detail: string;
  related_sections: string[];
}

export interface ReferralQaSourceHighlight {
  id: string;
  title: string;
  summary: string;
  supporting_sections: string[];
}

export interface ReferralQaDraftNarrative {
  field_key: string;
  label: string;
  draft: string;
  status: "ready_for_qa" | "needs_human_review";
}

export interface ReferralQaInsights {
  generated_at: string;
  warnings: string[];
  consistency_checks: ReferralQaConsistencyCheck[];
  source_highlights: ReferralQaSourceHighlight[];
  draft_narratives: ReferralQaDraftNarrative[];
}

export type ReferralComparisonStatus =
  | "match"
  | "missing_in_chart"
  | "missing_in_referral"
  | "possible_conflict"
  | "unsupported"
  | "requires_human_review";

export type ReviewerPriority = "low" | "medium" | "high";

export interface FieldComparisonResult {
  field_key: string;
  current_chart_value: unknown;
  proposed_value: unknown;
  comparison_status: ReferralComparisonStatus;
  confidence: number;
  rationale: string;
  source_spans: string[];
  reviewer_priority: ReviewerPriority;
}

export interface QaDocumentSummary {
  generatedAt: string;
  selectedDocumentId: string | null;
  extractionUsabilityStatus: ExtractionUsabilityStatus;
  normalizedSectionCount: number;
  llmProposalCount: number;
  comparisonStatusCounts: Record<ReferralComparisonStatus, number>;
  highPriorityFieldKeys: string[];
  warnings: string[];
}

export interface ReferralDocumentProcessingArtifacts {
  artifactDirectory: string;
  sourceMetaPath: string;
  extractionResultPath: string;
  extractedTextPath: string;
  normalizedSectionsPath: string;
  extractedFactsPath: string;
  fieldMapSnapshotPath: string;
  llmProposalPath: string;
  fieldComparisonPath: string;
  patientQaReferencePath: string;
  qaDocumentSummaryPath: string;
}

export interface ReferralDocumentProcessingResult {
  sourceMeta: SourceDocumentArtifact;
  extractionResult: SourceDocumentExtractionResult;
  normalizedSections: NormalizedReferralSection[];
  extractedFacts: ReferralExtractedFacts;
  fieldMapSnapshot: FieldMapSnapshot;
  llmProposal: ReferralLlmProposal;
  fieldComparisons: FieldComparisonResult[];
  patientQaReference: PatientQaReference;
  qaDocumentSummary: QaDocumentSummary;
  artifacts: ReferralDocumentProcessingArtifacts;
}
