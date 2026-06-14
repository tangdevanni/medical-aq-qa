import { describe, expect, it } from "vitest";
import {
  buildCanonicalOasisFromText,
  normalizeOasisClinicalText,
} from "../oasis/canonical/printPreviewCanonicalOasis";

function sampleText(extra = ""): string {
  return [
    "Star Home Health Care Inc",
    "OASIS",
    "STAFF INFO",
    "Patient INFO",
    "Name: YOUNG, CHRISTINE",
    "ADMINISTRATIVE INFORMATION",
    "(M0010) Agency Medicare Provider Number",
    "037834",
    "(M0030) Start of Care Date",
    "02/27/2026",
    "ACTIVE DIAGNOSES",
    "PRIMARY DIAGNOSIS",
    "R13.10 - Dysphagia, unspecified",
    "Onset Date",
    "OTHER DIAGNOSIS - 1",
    "I11.0 - Hypertensive heart disease with heart failure",
    "OTHER DIAGNOSIS - 2",
    "I50.9 - Heart failure, unspecified",
    "(M1028) Active Diagnoses",
    "VITAL SIGNS & PAIN ASSESSMENT",
    "(M1060) Height and Weight",
    "A. Height (in inches).",
    "64",
    "Temperature: 98.3 Temporal",
    "Pulse (per minute): Apical = Radial = 82",
    "Respiratory (per minute): 17",
    "Blood Pressure mm/Hg (L): 134 / 72 sitting",
    "O2 Sat: 95",
    "MEDICATION & ALLERGIES (INJECTABLES MEDICATIONS)",
    "(N0415) High-Risk Drug Classes: Use and Indication",
    "Allergies: No Known Allergies",
    "NEUROLOGICAL (Head, Mood, Eyes, Ears)",
    "(M1700) Cognitive Functioning",
    "CARDIOPULMONARY (Chest & Thorax)",
    "(M1400) Dyspnea",
    "FUNCTIONAL ASSESSMENT",
    "(GG0130A) Eating",
    "(GG0170C) Lying to Sitting",
    "PLAN OF CARE",
    "Individualized Patient Emergency Care Plan",
    "Goal(s)",
    "Patient will remain safe at home.",
    "Intervention / Treatment",
    "PT taught patient fall prevention program.",
    extra,
    ...Array.from({ length: 60 }, (_, index) => `(M${String(1800 + index).padStart(4, "0")}) Sample OASIS Item ${index}\nValue ${index}`),
    "x".repeat(21_000),
  ].join("\n");
}

function dischargeTextWithoutActiveDiagnoses(extra = ""): string {
  return [
    "Star Home Health Care Inc",
    "OASIS",
    "STAFF INFO",
    "Patient INFO",
    "Name: COLEMAN, ALLEN",
    "OASIS Assessment: OASIS E2 - PT DISCHARGE",
    "ADMINISTRATIVE INFORMATION",
    "(M0010) Agency Medicare Provider Number",
    "037834",
    "(M0090) Date Assessment Completed",
    "05/30/2026",
    "VITAL SIGNS & PAIN ASSESSMENT",
    "(M1060) Height and Weight",
    "Temperature: 97.8 Temporal",
    "Pulse (per minute): 74",
    "Respiratory (per minute): 16",
    "Blood Pressure mm/Hg (L): 128 / 72 sitting",
    "O2 Sat: 96",
    "MEDICATION & ALLERGIES (INJECTABLES MEDICATIONS)",
    "(N0415) High-Risk Drug Classes: Use and Indication",
    "Allergies: No Known Allergies",
    "NEUROLOGICAL (Head, Mood, Eyes, Ears)",
    "(M1700) Cognitive Functioning",
    "CARDIOPULMONARY (Chest & Thorax)",
    "(M1400) Dyspnea",
    "FUNCTIONAL ASSESSMENT",
    "(GG0130A) Eating",
    "(GG0170C) Lying to Sitting",
    "PLAN OF CARE",
    "Individualized Patient Emergency Care Plan",
    "Goal(s)",
    "Patient will remain safe at home.",
    "Intervention / Treatment",
    "PT taught patient fall prevention program.",
    extra,
    ...Array.from({ length: 70 }, (_, index) => `(M${String(1800 + index).padStart(4, "0")}) Discharge OASIS Item ${index}\nValue ${index}`),
    "x".repeat(21_000),
  ].join("\n");
}

describe("print-preview canonical OASIS", () => {
  it("normalizes print noise without removing clinical facts", () => {
    const normalized = normalizeOasisClinicalText([
      "Printed on: 2026-06-11 12:00",
      "Page 1 of 8",
      "R13.10 - Dysphagia, unspecified",
      "Blood Pressure mm/Hg (L): 134 / 72 sitting",
    ].join("\n"));

    expect(normalized).not.toContain("Printed on");
    expect(normalized).not.toContain("Page 1 of 8");
    expect(normalized).toContain("R13.10 - Dysphagia, unspecified");
    expect(normalized).toContain("134 / 72 sitting");
  });

  it("builds canonical artifacts, structured diagnoses, and preview DOM state", () => {
    const longSectionTail = `Late-section clinical context ${"z".repeat(5_000)} medication teaching remains active.`;
    const result = buildCanonicalOasisFromText({
      rawText: sampleText(longSectionTail),
      source: "print_preview_dom",
      sourcePath: "oasis-print-preview-dom/extracted-text.txt",
    });

    expect(result.document.qualityGate.passed).toBe(true);
    expect(result.structured.diagnoses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "R13.10", description: "Dysphagia, unspecified", source: "print_preview_dom" }),
        expect.objectContaining({ code: "I11.0", description: "Hypertensive heart disease with heart failure" }),
      ]),
    );
    expect(result.structured.vitals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "O2 Sat", value: "95" }),
      ]),
    );
    expect(result.sectionHashes.hashes.length).toBeGreaterThan(4);
    expect(result.portalDomState.diagnostics.routePattern).toBe("print_preview_dom");
    expect(result.portalDomState.sections.some((section) =>
      section.visibleTextDigest?.includes("medication teaching remains active"),
    )).toBe(true);
  });

  it("keeps section hashes stable across print-noise-only changes", () => {
    const left = buildCanonicalOasisFromText({ rawText: sampleText("Printed on: yesterday\nPage 2 of 8") });
    const right = buildCanonicalOasisFromText({ rawText: sampleText("Printed on: today\nPage 7 of 8") });

    expect(left.document.normalizedTextHash).toBe(right.document.normalizedTextHash);
    expect(left.sectionHashes.hashes.map((entry) => entry.hash)).toEqual(
      right.sectionHashes.hashes.map((entry) => entry.hash),
    );
  });

  it("accepts discharge/death-at-home print previews without active-diagnosis coverage", () => {
    const result = buildCanonicalOasisFromText({
      rawText: dischargeTextWithoutActiveDiagnoses(),
      source: "print_preview_dom",
      assessmentType: "OASIS E2 - PT DISCHARGE",
    });

    expect(result.document.assessmentType).toBe("DC");
    expect(result.document.qualityGate.passed).toBe(true);
    expect(result.document.qualityGate.requiredCoverage.active_diagnoses).toBe(true);
    expect(result.document.qualityGate.warnings).not.toContain("required_coverage_missing:active_diagnoses");
  });

  it("still rejects SOC print previews that are missing active-diagnosis coverage", () => {
    const result = buildCanonicalOasisFromText({
      rawText: dischargeTextWithoutActiveDiagnoses("OASIS Assessment: OASIS E1 - PT START OF CARE"),
      source: "print_preview_dom",
      assessmentType: "SOC",
    });

    expect(result.document.assessmentType).toBe("SOC");
    expect(result.document.qualityGate.passed).toBe(false);
    expect(result.document.qualityGate.requiredCoverage.active_diagnoses).toBe(false);
    expect(result.document.qualityGate.warnings).toContain("required_coverage_missing:active_diagnoses");
  });

  it.each([
    ["ROC", "OASIS E1 - PT RESUMPTION OF CARE"],
    ["RECERT", "OASIS E1 - RECERTIFICATION"],
  ])("requires active-diagnosis coverage for %s print previews", (assessmentType, header) => {
    const result = buildCanonicalOasisFromText({
      rawText: dischargeTextWithoutActiveDiagnoses(`OASIS Assessment: ${header}`),
      source: "print_preview_dom",
      assessmentType,
    });

    expect(result.document.assessmentType).toBe(assessmentType);
    expect(result.document.qualityGate.passed).toBe(false);
    expect(result.document.qualityGate.requiredCoverage.active_diagnoses).toBe(false);
    expect(result.document.qualityGate.warnings).toContain("required_coverage_missing:active_diagnoses");
  });
});
