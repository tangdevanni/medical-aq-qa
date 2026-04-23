import type {
  QaControlType,
  QaFieldGroupDefinition,
  QaFieldGroupKey,
  QaFieldPriority,
  QaFieldRegistryEntry,
  QaFieldReviewMode,
  QaFieldType,
  QaSectionMetadata,
  QaWorkflowSectionKey,
} from "@medical-ai-qa/shared-types";

type FieldOverrides = Partial<Pick<QaFieldRegistryEntry,
  | "oasisItemId"
  | "dashboardVisibility"
  | "canInferFromReferral"
  | "compareAgainstChart"
  | "requiresHumanReview"
  | "requiresCodingTeamReview"
  | "narrativeField"
  | "medicationField"
  | "diagnosisField"
  | "lowValueAdminField"
  | "supportedEvidenceSources"
  | "notes"
>>;

function field(
  fieldKey: string,
  label: string,
  groupKey: QaFieldGroupKey,
  sectionKey: QaWorkflowSectionKey,
  qaPriority: QaFieldPriority,
  fieldType: QaFieldType,
  controlType: QaControlType,
  reviewMode: QaFieldReviewMode,
  overrides: FieldOverrides = {},
): QaFieldRegistryEntry {
  const lowValueAdminField = overrides.lowValueAdminField ?? groupKey === "low_priority_admin_reference";
  const requiresCodingTeamReview = overrides.requiresCodingTeamReview ?? reviewMode === "coding_review_required";
  const narrativeField = overrides.narrativeField ?? fieldType === "narrative";
  const medicationField = overrides.medicationField ?? groupKey === "medications_allergies_and_special_treatments";
  const diagnosisField = overrides.diagnosisField ?? groupKey === "diagnosis_and_coding";

  return {
    fieldKey,
    label,
    groupKey,
    sectionKey,
    oasisItemId: overrides.oasisItemId ?? null,
    fieldType,
    controlType,
    qaPriority,
    dashboardVisibility: overrides.dashboardVisibility ?? (qaPriority === "critical" || qaPriority === "high" ? "default" : "expanded"),
    reviewMode,
    canInferFromReferral: overrides.canInferFromReferral ?? reviewMode !== "reference_only",
    compareAgainstChart: overrides.compareAgainstChart ?? reviewMode !== "reference_only",
    requiresHumanReview: overrides.requiresHumanReview ?? (qaPriority === "critical" || reviewMode !== "reference_only"),
    requiresCodingTeamReview,
    narrativeField,
    medicationField,
    diagnosisField,
    lowValueAdminField,
    supportedEvidenceSources: overrides.supportedEvidenceSources ?? ["referral_document", "hospital_discharge", "chart"],
    notes: overrides.notes ?? null,
  };
}

export const QA_FIELD_GROUPS: QaFieldGroupDefinition[] = [
  { groupKey: "medical_necessity_and_homebound", label: "Medical Necessity And Homebound", description: "Narratives and evidence for home health need and homebound status.", dashboardOrder: 1 },
  { groupKey: "diagnosis_and_coding", label: "Diagnosis And Coding", description: "Diagnosis evidence, coding-sensitive rows, and escalation flags.", dashboardOrder: 2 },
  { groupKey: "medications_allergies_and_special_treatments", label: "Medications, Allergies, And Special Treatments", description: "Medication safety, allergies, injectables, and O0110 special treatments.", dashboardOrder: 3 },
  { groupKey: "functional_and_therapy_status", label: "Functional And Therapy Status", description: "GG/M functional scoring, therapy need, discipline frequency, and goals.", dashboardOrder: 4 },
  { groupKey: "symptom_and_body_system_review", label: "Symptom And Body System Review", description: "Body-system review sections that QA checks for consistency and completeness.", dashboardOrder: 5 },
  { groupKey: "risk_and_safety_assessments", label: "Risk And Safety Assessments", description: "Fall, wound, hospitalization, and safety-related risk tools.", dashboardOrder: 6 },
  { groupKey: "care_plan_and_coordination", label: "Care Plan And Coordination", description: "Plan-of-care orders, patient summary, skilled interventions, and care plan content.", dashboardOrder: 7 },
  { groupKey: "supplementals_and_history", label: "Supplementals And History", description: "Past medical history, caregiver support, living situation, immunizations, and supplementals.", dashboardOrder: 8 },
  { groupKey: "low_priority_admin_reference", label: "Low Priority Admin Reference", description: "Identity, agency, physician, and demographic reference values that should not dominate QA.", dashboardOrder: 9 },
];

export const QA_SECTION_METADATA: QaSectionMetadata[] = [
  { sectionKey: "administrative_information", label: "Administrative Information", groupKey: "low_priority_admin_reference", reviewStyle: "completeness_driven", aiSupportExpected: false, codingReviewPossible: false, notes: "Mostly low-value admin/reference data." },
  { sectionKey: "active_diagnoses", label: "Active Diagnoses", groupKey: "diagnosis_and_coding", reviewStyle: "coding_sensitive", aiSupportExpected: true, codingReviewPossible: true },
  { sectionKey: "vital_signs_and_pain_assessment", label: "Vital Signs & Pain Assessment", groupKey: "symptom_and_body_system_review", reviewStyle: "compare_driven", aiSupportExpected: false, codingReviewPossible: false },
  { sectionKey: "medication_allergies_and_injectables", label: "Medication & Allergies (Injectables Medications)", groupKey: "medications_allergies_and_special_treatments", reviewStyle: "medication_safety", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "neurological_head_mood_eyes_ears", label: "Neurological (Head, Mood, Eyes, Ears)", groupKey: "symptom_and_body_system_review", reviewStyle: "compare_driven", aiSupportExpected: false, codingReviewPossible: false },
  { sectionKey: "cardiopulmonary_chest_thorax", label: "Cardiopulmonary (Chest & Thorax)", groupKey: "symptom_and_body_system_review", reviewStyle: "compare_driven", aiSupportExpected: false, codingReviewPossible: false },
  { sectionKey: "gastrointestinal_and_genitourinary_assessment", label: "Gastrointestinal & Genitourinary Assessment", groupKey: "symptom_and_body_system_review", reviewStyle: "compare_driven", aiSupportExpected: false, codingReviewPossible: false },
  { sectionKey: "integumentary_skin_and_wound", label: "Integumentary (Skin & Wound)", groupKey: "symptom_and_body_system_review", reviewStyle: "compare_driven", aiSupportExpected: false, codingReviewPossible: false },
  { sectionKey: "safety_and_risk_assessment", label: "Safety & Risk Assessment", groupKey: "risk_and_safety_assessments", reviewStyle: "compare_driven", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "functional_assessment_self_care", label: "Functional Assessment (Self Care)", groupKey: "functional_and_therapy_status", reviewStyle: "compare_driven", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "functional_assessment_mobility_and_musculoskeletal", label: "Functional Assessment (Mobility & Musculoskeletal)", groupKey: "functional_and_therapy_status", reviewStyle: "compare_driven", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "endocrine_diabetic_management", label: "Endocrine (Diabetic Management)", groupKey: "symptom_and_body_system_review", reviewStyle: "compare_driven", aiSupportExpected: false, codingReviewPossible: false },
  { sectionKey: "plan_of_care_and_physical_therapy_evaluation", label: "Plan of Care and Physical Therapy Evaluation", groupKey: "care_plan_and_coordination", reviewStyle: "narrative_driven", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "patient_summary_and_clinical_narrative", label: "Patient Summary & Clinical Narrative", groupKey: "care_plan_and_coordination", reviewStyle: "narrative_driven", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "care_plan_problems_goals_interventions", label: "Care Plan (Problems / Goals / Interventions)", groupKey: "care_plan_and_coordination", reviewStyle: "narrative_driven", aiSupportExpected: true, codingReviewPossible: false },
  { sectionKey: "footer_non_print_preview", label: "Footer (Not Visible in Print Preview)", groupKey: "low_priority_admin_reference", reviewStyle: "completeness_driven", aiSupportExpected: false, codingReviewPossible: false, notes: "Fax server headers, signatures, and page chrome should stay out of the printable review surface." },
];

export const QA_REFERENCE_FIELD_REGISTRY: QaFieldRegistryEntry[] = [
  field("primary_reason_for_home_health_medical_necessity", "Primary Reason For Home Health / Medical Necessity", "medical_necessity_and_homebound", "patient_summary_and_clinical_narrative", "critical", "narrative", "ai_narrative", "qa_readback_and_confirm"),
  field("admit_reason_to_home_health", "Admit Reason To Home Health", "medical_necessity_and_homebound", "patient_summary_and_clinical_narrative", "critical", "narrative", "ai_narrative", "qa_readback_and_confirm"),
  field("homebound_narrative", "Homebound Narrative", "medical_necessity_and_homebound", "functional_assessment_mobility_and_musculoskeletal", "critical", "narrative", "ai_narrative", "qa_readback_and_confirm"),
  field("homebound_supporting_factors", "Homebound Supporting Factors", "medical_necessity_and_homebound", "functional_assessment_mobility_and_musculoskeletal", "high", "multi_select", "checkbox", "compare_referral_to_chart"),
  field("recent_hospitalization_discharge_date", "Recent Hospitalization Discharge Date", "medical_necessity_and_homebound", "administrative_information", "high", "date", "input", "compare_referral_to_chart"),
  field("recent_hospitalization_facility", "Recent Hospitalization Facility", "medical_necessity_and_homebound", "administrative_information", "high", "text", "input", "compare_referral_to_chart"),

  field("diagnosis_candidates", "Diagnosis Candidates", "diagnosis_and_coding", "active_diagnoses", "critical", "diagnosis_row", "table", "coding_review_required"),
  field("primary_diagnosis", "Primary Diagnosis", "diagnosis_and_coding", "active_diagnoses", "critical", "diagnosis_row", "table", "coding_review_required", { oasisItemId: "M1021" }),
  field("secondary_diagnoses", "Secondary Diagnoses", "diagnosis_and_coding", "active_diagnoses", "high", "diagnosis_row", "table", "coding_review_required", { oasisItemId: "M1023" }),
  field("diagnosis_supporting_evidence", "Diagnosis Supporting Evidence", "diagnosis_and_coding", "active_diagnoses", "high", "narrative", "reference_only", "coding_review_required", { canInferFromReferral: false, compareAgainstChart: false }),
  field("coding_escalation_flags", "Coding Escalation Flags", "diagnosis_and_coding", "active_diagnoses", "high", "array", "reference_only", "coding_review_required", { canInferFromReferral: false, compareAgainstChart: false }),

  field("medication_list", "Medication List", "medications_allergies_and_special_treatments", "medication_allergies_and_injectables", "critical", "medication_row", "table", "compare_referral_to_chart"),
  field("allergy_list", "Allergies", "medications_allergies_and_special_treatments", "medication_allergies_and_injectables", "critical", "array", "table", "compare_referral_to_chart"),
  field("special_treatments_o0110", "Special Treatments / Procedures / Programs", "medications_allergies_and_special_treatments", "medication_allergies_and_injectables", "critical", "multi_select", "checkbox", "compare_referral_to_chart", { oasisItemId: "O0110" }),
  field("injectable_medications", "Injectable Medications", "medications_allergies_and_special_treatments", "medication_allergies_and_injectables", "high", "medication_row", "table", "compare_referral_to_chart"),
  field("high_risk_medication_notes", "High-Risk Medication Notes", "medications_allergies_and_special_treatments", "medication_allergies_and_injectables", "high", "narrative", "textarea", "qa_readback_and_confirm"),

  field("prior_functioning", "Prior Functioning", "functional_and_therapy_status", "functional_assessment_mobility_and_musculoskeletal", "high", "score", "matrix", "compare_referral_to_chart", { oasisItemId: "GG0100" }),
  field("gg_self_care", "GG Self Care", "functional_and_therapy_status", "functional_assessment_self_care", "high", "score", "matrix", "compare_referral_to_chart", { oasisItemId: "GG0130" }),
  field("gg_mobility", "GG Mobility", "functional_and_therapy_status", "functional_assessment_mobility_and_musculoskeletal", "high", "score", "matrix", "compare_referral_to_chart", { oasisItemId: "GG0170" }),
  field("functional_limitations", "Functional Limitations", "functional_and_therapy_status", "functional_assessment_mobility_and_musculoskeletal", "high", "multi_select", "checkbox", "compare_referral_to_chart"),
  field("therapy_need", "Therapy Need", "functional_and_therapy_status", "plan_of_care_and_physical_therapy_evaluation", "high", "narrative", "ai_narrative", "qa_readback_and_confirm"),
  field("discipline_frequencies", "Discipline Frequencies", "functional_and_therapy_status", "plan_of_care_and_physical_therapy_evaluation", "high", "array", "table", "qa_readback_and_confirm"),
  field("patient_caregiver_goals", "Patient / Caregiver Goals", "functional_and_therapy_status", "care_plan_problems_goals_interventions", "medium", "narrative", "textarea", "qa_readback_and_confirm"),
  field("plan_for_next_visit", "Plan For Next Visit", "functional_and_therapy_status", "care_plan_problems_goals_interventions", "medium", "narrative", "textarea", "qa_readback_and_confirm"),

  field("neurological_status", "Neurological Status", "symptom_and_body_system_review", "neurological_head_mood_eyes_ears", "high", "multi_select", "checkbox", "chart_completeness_check"),
  field("eyes_ears_status", "Eyes & Ears Status", "symptom_and_body_system_review", "neurological_head_mood_eyes_ears", "medium", "multi_select", "checkbox", "chart_completeness_check"),
  field("cardiovascular_status", "Cardiovascular Status", "symptom_and_body_system_review", "cardiopulmonary_chest_thorax", "medium", "multi_select", "checkbox", "chart_completeness_check"),
  field("respiratory_status", "Respiratory Status", "symptom_and_body_system_review", "cardiopulmonary_chest_thorax", "critical", "multi_select", "checkbox", "chart_completeness_check", { oasisItemId: "M1400" }),
  field("gastrointestinal_status", "Gastrointestinal Status", "symptom_and_body_system_review", "gastrointestinal_and_genitourinary_assessment", "high", "multi_select", "checkbox", "chart_completeness_check"),
  field("genitourinary_status", "Genitourinary Status", "symptom_and_body_system_review", "gastrointestinal_and_genitourinary_assessment", "high", "multi_select", "checkbox", "chart_completeness_check"),
  field("integumentary_wound_status", "Integumentary / Wound Status", "symptom_and_body_system_review", "integumentary_skin_and_wound", "critical", "narrative", "textarea", "qa_readback_and_confirm"),
  field("pain_assessment_narrative", "Pain Assessment Narrative", "symptom_and_body_system_review", "vital_signs_and_pain_assessment", "high", "narrative", "textarea", "qa_readback_and_confirm"),
  field("emotional_behavioral_status", "Emotional / Behavioral Status", "symptom_and_body_system_review", "neurological_head_mood_eyes_ears", "high", "multi_select", "checkbox", "chart_completeness_check"),

  field("mahc10_fall_risk", "MAHC 10 Fall Risk", "risk_and_safety_assessments", "safety_and_risk_assessment", "high", "score", "matrix", "chart_completeness_check"),
  field("norton_scale", "Norton Scale", "risk_and_safety_assessments", "integumentary_skin_and_wound", "high", "score", "matrix", "chart_completeness_check"),
  field("wound_risk_review", "Wound / Pressure Risk Review", "risk_and_safety_assessments", "integumentary_skin_and_wound", "high", "narrative", "textarea", "qa_readback_and_confirm"),
  field("fall_risk_narrative", "Fall Risk Narrative", "risk_and_safety_assessments", "safety_and_risk_assessment", "high", "narrative", "textarea", "qa_readback_and_confirm"),
  field("hospitalization_risk_summary", "Hospitalization Risk Summary", "risk_and_safety_assessments", "safety_and_risk_assessment", "medium", "narrative", "textarea", "qa_readback_and_confirm"),

  field("patient_summary_narrative", "Patient Summary / Clinical Narrative", "care_plan_and_coordination", "patient_summary_and_clinical_narrative", "high", "narrative", "ai_narrative", "qa_readback_and_confirm"),
  field("skilled_interventions", "Skilled Interventions", "care_plan_and_coordination", "plan_of_care_and_physical_therapy_evaluation", "high", "narrative", "ai_narrative", "qa_readback_and_confirm"),
  field("care_plan_problems_goals_interventions", "Care Plan Problems / Goals / Interventions", "care_plan_and_coordination", "care_plan_problems_goals_interventions", "high", "array", "table", "qa_readback_and_confirm"),
  field("patient_coordination_orders", "Patient Coordination Orders", "care_plan_and_coordination", "plan_of_care_and_physical_therapy_evaluation", "medium", "array", "table", "qa_readback_and_confirm"),

  field("past_medical_history", "Past Medical History", "supplementals_and_history", "patient_summary_and_clinical_narrative", "high", "array", "table", "compare_referral_to_chart"),
  field("living_situation", "Living Situation", "supplementals_and_history", "administrative_information", "high", "text", "input", "compare_referral_to_chart", { requiresHumanReview: false }),
  field("caregiver_name", "Caregiver Name", "supplementals_and_history", "administrative_information", "medium", "text", "input", "compare_referral_to_chart", { requiresHumanReview: false }),
  field("caregiver_relationship", "Caregiver Relationship", "supplementals_and_history", "administrative_information", "medium", "single_select", "dropdown", "compare_referral_to_chart", { requiresHumanReview: false }),
  field("caregiver_phone", "Caregiver Phone", "supplementals_and_history", "administrative_information", "medium", "phone", "input", "compare_referral_to_chart"),
  field("preferred_language", "Preferred Language", "supplementals_and_history", "administrative_information", "medium", "single_select", "dropdown", "compare_referral_to_chart", { requiresHumanReview: false }),
  field("interpreter_needed", "Interpreter Needed", "supplementals_and_history", "administrative_information", "medium", "boolean", "checkbox", "compare_referral_to_chart"),
  field("immunization_status", "Immunization / Vaccination Status", "supplementals_and_history", "administrative_information", "medium", "multi_select", "checkbox", "chart_completeness_check"),

  field("soc_date", "Start Of Care Date", "low_priority_admin_reference", "administrative_information", "medium", "date", "input", "compare_referral_to_chart", { oasisItemId: "M0030", requiresHumanReview: false }),
  field("referral_date", "Referral Date", "low_priority_admin_reference", "administrative_information", "medium", "date", "input", "compare_referral_to_chart", { requiresHumanReview: false }),
  field("code_status", "Code Status", "risk_and_safety_assessments", "safety_and_risk_assessment", "high", "single_select", "dropdown", "qa_readback_and_confirm"),

  field("patient_name", "Patient Name", "low_priority_admin_reference", "administrative_information", "low", "text", "reference_only", "reference_only", { oasisItemId: "M0040", dashboardVisibility: "hidden", canInferFromReferral: true, requiresHumanReview: false }),
  field("dob", "Date Of Birth", "low_priority_admin_reference", "administrative_information", "low", "date", "reference_only", "reference_only", { oasisItemId: "M0066", dashboardVisibility: "hidden", canInferFromReferral: true, requiresHumanReview: false }),
  field("patient_address", "Patient Address", "low_priority_admin_reference", "administrative_information", "low", "text", "reference_only", "reference_only", { dashboardVisibility: "hidden", requiresHumanReview: false }),
  field("patient_phone", "Patient Phone", "low_priority_admin_reference", "administrative_information", "low", "phone", "reference_only", "reference_only", { dashboardVisibility: "hidden", requiresHumanReview: false }),
  field("attending_physician", "Attending Physician", "low_priority_admin_reference", "administrative_information", "low", "text", "reference_only", "reference_only", { oasisItemId: "M0018", dashboardVisibility: "hidden", requiresHumanReview: false }),
  field("agency_provider_number", "Agency Provider Number", "low_priority_admin_reference", "administrative_information", "low", "text", "reference_only", "reference_only", { oasisItemId: "M0010", dashboardVisibility: "hidden", canInferFromReferral: false, requiresHumanReview: false }),
];

export const QA_FIELD_REGISTRY_BY_KEY = new Map(
  QA_REFERENCE_FIELD_REGISTRY.map((entry) => [entry.fieldKey, entry]),
);

export const QA_SECTION_METADATA_BY_KEY = new Map(
  QA_SECTION_METADATA.map((entry) => [entry.sectionKey, entry]),
);
