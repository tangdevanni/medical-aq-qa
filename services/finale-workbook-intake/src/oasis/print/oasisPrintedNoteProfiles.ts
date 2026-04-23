export type OasisPrintSectionProfileKey =
  | "soc_full_document_v1"
  | "soc_administrative_information_v1"
  | "soc_foundation_sections_v1";

export interface OasisPrintSectionProfile {
  key: OasisPrintSectionProfileKey;
  label: string;
  modalSelectionPatterns: RegExp[];
  reviewSectionKeys: string[];
}

export const DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY: OasisPrintSectionProfileKey =
  "soc_full_document_v1";

const OASIS_PRINT_SECTION_PROFILES: Record<OasisPrintSectionProfileKey, OasisPrintSectionProfile> = {
  soc_full_document_v1: {
    key: "soc_full_document_v1",
    label: "Full OASIS document",
    modalSelectionPatterns: [
      /.+/,
    ],
    reviewSectionKeys: [
      "administrative_information",
      "primary_reason_medical_necessity",
      "vital_signs",
      "neurological",
      "eyes_ears",
      "cardiovascular",
      "respiratory",
      "gastrointestinal",
      "genitourinary",
      "musculoskeletal_functional_status",
      "integumentary",
      "pain_assessment",
      "emotional",
      "diagnosis",
      "medications_allergies",
      "patient_coordination_care_plan",
      "other_supplementals",
      "care_plan",
    ],
  },
  soc_administrative_information_v1: {
    key: "soc_administrative_information_v1",
    label: "Administrative Information only",
    modalSelectionPatterns: [
      /administrative\s+information/i,
    ],
    reviewSectionKeys: [
      "administrative_information",
    ],
  },
  soc_foundation_sections_v1: {
    key: "soc_foundation_sections_v1",
    label: "Administrative + Vital Signs/Pain + Medications/Allergies",
    modalSelectionPatterns: [
      /administrative\s+information/i,
      /vital\s*signs?(?:\s*&\s*pain\s*assessment)?/i,
      /pain\s*assessment/i,
      /medications?\s*&\s*allerg(?:y|ies)(?:\s*\(.*injectables?\s*medications?.*\))?/i,
      /injectables?\s+medications?/i,
    ],
    reviewSectionKeys: [
      "administrative_information",
      "vital_signs",
      "pain_assessment",
      "medications_allergies",
    ],
  },
};

export function getOasisPrintSectionProfile(
  key: OasisPrintSectionProfileKey | null | undefined = DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY,
): OasisPrintSectionProfile {
  return OASIS_PRINT_SECTION_PROFILES[key ?? DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY];
}

export function findMatchingOasisPrintSectionLabels(input: {
  profile: OasisPrintSectionProfile;
  labels: string[];
}): string[] {
  return input.labels.filter((label) =>
    input.profile.modalSelectionPatterns.some((pattern) => pattern.test(label)),
  );
}
