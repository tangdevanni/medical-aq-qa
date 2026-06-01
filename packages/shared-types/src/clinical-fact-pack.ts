export type ClinicalFactCategory =
  | "diagnosis"
  | "icd_code"
  | "cognitive_status"
  | "mental_status"
  | "orientation"
  | "memory"
  | "behavior"
  | "medication"
  | "allergy"
  | "wound"
  | "pain"
  | "respiratory"
  | "cardiac"
  | "gi_gu"
  | "functional_status"
  | "mobility"
  | "fall_risk"
  | "homebound_status"
  | "skilled_need"
  | "caregiver_support"
  | "hospitalization"
  | "discharge_status"
  | "therapy_need"
  | "safety_risk"
  | "code_status"
  | "advance_directive"
  | "plan_of_care_problem"
  | "plan_of_care_goal"
  | "plan_of_care_intervention"
  | "other";

export type ClinicalFactSourceType =
  | "referral"
  | "file_upload"
  | "oasis"
  | "poc"
  | "visit_note"
  | "discharge"
  | "unknown";

export type ClinicalFactConfidence = number;

export type ClinicalFactNegationStatus =
  | "present"
  | "absent"
  | "unknown"
  | "resolved"
  | "historical";

export type ClinicalFactEvidence = {
  artifactPath: string;
  documentKey?: string;
  page?: number;
  section?: string;
  snippet?: string;
  extractedAt?: string;
};

export type ClinicalFact = {
  factId: string;
  category: ClinicalFactCategory;
  label: string;
  normalizedValue: string;
  rawValue?: string;
  polarity: ClinicalFactNegationStatus;
  clinicalStatus?: "active" | "resolved" | "historical" | "ruled_out" | "unknown";
  date?: string;
  dateSource?: string;
  dateConfidence?: number;
  sourceType: ClinicalFactSourceType;
  sourceDocumentKey?: string;
  sourceArtifactPath?: string;
  evidence: ClinicalFactEvidence[];
  confidence: ClinicalFactConfidence;
};

export type ClinicalFactPack = {
  schemaVersion: 1;
  qualityFilterVersion?: string;
  generatedAt: string;
  patientId: string;
  source: "source" | "oasis";
  factCount: number;
  categories: ClinicalFactCategory[];
  facts: ClinicalFact[];
  warnings: string[];
};
