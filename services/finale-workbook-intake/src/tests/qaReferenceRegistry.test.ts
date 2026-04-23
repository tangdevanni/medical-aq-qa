import { describe, expect, it } from "vitest";
import {
  QA_FIELD_GROUPS,
  QA_REFERENCE_FIELD_REGISTRY,
  QA_SECTION_METADATA,
} from "../qaReference/registry";
import type { QaFieldGroupKey } from "@medical-ai-qa/shared-types";

const EXPECTED_GROUPS: QaFieldGroupKey[] = [
  "medical_necessity_and_homebound",
  "diagnosis_and_coding",
  "medications_allergies_and_special_treatments",
  "functional_and_therapy_status",
  "symptom_and_body_system_review",
  "risk_and_safety_assessments",
  "care_plan_and_coordination",
  "supplementals_and_history",
  "low_priority_admin_reference",
];

describe("QA reference field registry", () => {
  it("contains the permanent QA-centered groups and maps every field into one", () => {
    expect(QA_FIELD_GROUPS.map((group) => group.groupKey)).toEqual(EXPECTED_GROUPS);

    const groupKeys = new Set(QA_FIELD_GROUPS.map((group) => group.groupKey));
    for (const field of QA_REFERENCE_FIELD_REGISTRY) {
      expect(groupKeys.has(field.groupKey)).toBe(true);
    }
  });

  it("prioritizes clinically meaningful fields over low-value admin reference fields", () => {
    const medicalNecessity = QA_REFERENCE_FIELD_REGISTRY.find((field) =>
      field.fieldKey === "primary_reason_for_home_health_medical_necessity");
    const diagnosisCandidates = QA_REFERENCE_FIELD_REGISTRY.find((field) =>
      field.fieldKey === "diagnosis_candidates");
    const medicationList = QA_REFERENCE_FIELD_REGISTRY.find((field) =>
      field.fieldKey === "medication_list");
    const patientName = QA_REFERENCE_FIELD_REGISTRY.find((field) =>
      field.fieldKey === "patient_name");

    expect(medicalNecessity?.qaPriority).toBe("critical");
    expect(medicalNecessity?.dashboardVisibility).toBe("default");
    expect(medicalNecessity?.narrativeField).toBe(true);

    expect(diagnosisCandidates?.qaPriority).toBe("critical");
    expect(diagnosisCandidates?.requiresCodingTeamReview).toBe(true);
    expect(diagnosisCandidates?.diagnosisField).toBe(true);

    expect(medicationList?.qaPriority).toBe("critical");
    expect(medicationList?.medicationField).toBe(true);

    expect(patientName?.qaPriority).toBe("low");
    expect(patientName?.dashboardVisibility).toBe("hidden");
    expect(patientName?.lowValueAdminField).toBe(true);
    expect(patientName?.reviewMode).toBe("reference_only");
  });

  it("maps real QA workflow sections to the correct backend groups", () => {
    const bySection = new Map(QA_SECTION_METADATA.map((section) => [section.sectionKey, section]));

    expect(bySection.get("active_diagnoses")?.groupKey).toBe("diagnosis_and_coding");
    expect(bySection.get("active_diagnoses")?.codingReviewPossible).toBe(true);
    expect(bySection.get("medication_allergies_and_injectables")?.reviewStyle).toBe("medication_safety");
    expect(bySection.get("plan_of_care_and_physical_therapy_evaluation")?.reviewStyle).toBe("narrative_driven");
    expect(bySection.get("administrative_information")?.groupKey).toBe("low_priority_admin_reference");
  });
});
