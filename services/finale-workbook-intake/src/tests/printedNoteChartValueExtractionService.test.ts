import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import {
  extractCurrentChartValuesFromPrintedNote,
  extractDeterministicCurrentChartValues,
  isSuspiciousPrintedNoteChartValue,
} from "../oasis/print/printedNoteChartValueExtractionService";

function buildWorkItem(): PatientEpisodeWorkItem {
  return {
    id: "CHRISTINE_YOUNG__printed_note",
    subsidiaryId: "default",
    patientIdentity: {
      displayName: "Christine Young",
      normalizedName: "CHRISTINE YOUNG",
      medicareNumber: "",
    },
    episodeContext: {
      socDate: "02/27/2026",
      episodeDate: "02/27/2026",
      billingPeriod: "",
      episodePeriod: "",
      payer: null,
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    workflowTypes: [],
    sourceSheets: [],
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
  };
}

describe("printedNoteChartValueExtractionService", () => {
  it("extracts deterministic chart values from printed-note diagnosis and selected-option text", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "printed-note-chart-values-"));

    try {
      const extractedTextPath = path.join(tempDir, "extracted-text.txt");
      const sourceText = [
        "Primary Reason for Home Health / Medical Necessity",
        "Christine E. Young is being admitted to home health care.",
        "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated. Confirmed By: Barbara Barbagallo (RN)",
        "Admitted From Admission Location Birth Place Citizenship Maiden Name Acute care hospital SCOTTSDALE SHEA MEDICAL CENTER Medicare Beneficiary ID",
        "CONTACTS Name Contact Type Relationship Address Phone/Email YOUNG, EMILY Daughter Cell:4807035881 DIAGNOSIS INFORMATION",
        "ACTIVE DIAGNOSES",
        "PRIMARY DIAGNOSIS",
        "02/27/2026",
        "R13.10 - Dysphagia, unspecified",
        "OTHER DIAGNOSIS - 1",
        "02/27/2026",
        "I11.0 - Hypertensive heart disease with heart failure",
        "Add Allergies None known",
        "SELECTED CHECKBOX / RADIO OPTIONS:",
        "[SELECTED][page 3] Full Code",
        "[SELECTED][page 3] 7 Ambulation",
        "[SELECTED][page 16] Dyspnea *",
      ].join("\n");
      await writeFile(extractedTextPath, sourceText, "utf8");

      const result = await extractCurrentChartValuesFromPrintedNote({
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          LLM_PROVIDER: "bedrock",
        }),
        logger: {
          warn: () => undefined,
        } as any,
        outputDir: tempDir,
        workItem: buildWorkItem(),
        extractedTextPath,
      });

      expect(result.currentChartValues).toMatchObject({
        primary_reason_for_home_health_medical_necessity:
          "Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated.",
        admit_reason_to_home_health:
          "Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated.",
        recent_hospitalization_discharge_date: "02/20/2026",
        recent_hospitalization_facility: "SCOTTSDALE SHEA MEDICAL CENTER",
        caregiver_name: "YOUNG, EMILY",
        caregiver_phone: "4807035881",
        caregiver_relationship: "Daughter",
        primary_diagnosis: "R13.10 - Dysphagia, unspecified",
        code_status: "full_code",
        allergy_list: ["No Known Allergies"],
      });
      expect(result.currentChartValues.secondary_diagnoses).toEqual(
        expect.arrayContaining(["I11.0 - Hypertensive heart disease with heart failure"]),
      );
      expect(result.currentChartValues.functional_limitations).toEqual(
        expect.arrayContaining(["Ambulation", "Dyspnea with minimal exertion"]),
      );
      expect(result.extractedFieldCount).toBeGreaterThanOrEqual(4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("flags known bad chart values before they can be persisted", () => {
    const deterministic = extractDeterministicCurrentChartValues([
      "PRIMARY DIAGNOSIS",
      "R13.10 - Dysphagia, unspecified",
      "SELECTED CHECKBOX / RADIO OPTIONS:",
      "[SELECTED] Full Code",
    ].join("\n"));

    expect(deterministic.extractedFieldValues.map((value) => value.field_key)).toEqual(
      expect.arrayContaining(["primary_diagnosis", "code_status"]),
    );
    expect(isSuspiciousPrintedNoteChartValue("primary_diagnosis", "Patient lives in congregate situation")).toBe(true);
    expect(isSuspiciousPrintedNoteChartValue("hospitalization_risk_summary", "Unable to determine (M0102) Date of Physician-ordered Start of Care")).toBe(true);
    expect(isSuspiciousPrintedNoteChartValue("allergy_list", ["None of the Above"])).toBe(true);
    expect(isSuspiciousPrintedNoteChartValue("primary_diagnosis", "R13.10 - Dysphagia, unspecified")).toBe(false);
  });
});
