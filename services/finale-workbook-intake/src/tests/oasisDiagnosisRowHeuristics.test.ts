import { describe, expect, it } from "vitest";
import {
  getOasisDiagnosisRowRejectionReason,
  isOasisDiagnosisRowActionable,
  isOasisDiagnosisRowInteractable,
  type OasisDiagnosisRowCandidate,
} from "../portal/utils/oasisDiagnosisRowHeuristics";

function buildCandidate(
  overrides: Partial<OasisDiagnosisRowCandidate>,
): OasisDiagnosisRowCandidate {
  return {
    sectionLabel: "PRIMARY DIAGNOSIS",
    icd10Code: "R13.10",
    onsetDate: "2026-02-27",
    description: null,
    severity: null,
    timingFlags: [],
    rawText: "PRIMARY DIAGNOSIS ICD-10 CodeOnset Date",
    selectorEvidence: [
      { field: "icd10Code", found: true, disabled: true, readOnly: false },
      { field: "onsetDate", found: true, disabled: true, readOnly: false },
      { field: "description", found: false, disabled: null, readOnly: null },
      { field: "severity", found: false, disabled: null, readOnly: null },
      { field: "timingFlags", found: false, disabled: null, readOnly: null },
    ],
    ...overrides,
  };
}

describe("oasisDiagnosisRowHeuristics", () => {
  it("rejects section/header noise rows that only expose code and onset fields", () => {
    const candidate = buildCandidate({});

    expect(getOasisDiagnosisRowRejectionReason(candidate)).toBe("header_ui_noise");
    expect(isOasisDiagnosisRowActionable(candidate)).toBe(false);
    expect(isOasisDiagnosisRowInteractable(candidate)).toBe(false);
  });

  it("keeps editable blank slots that expose real diagnosis controls", () => {
    const candidate = buildCandidate({
      description: "",
      selectorEvidence: [
        { field: "icd10Code", found: true, disabled: false, readOnly: false },
        { field: "onsetDate", found: true, disabled: false, readOnly: false },
        { field: "description", found: true, disabled: false, readOnly: false },
        { field: "severity", found: true, disabled: false, readOnly: null },
        { field: "timingFlags", found: true, disabled: false, readOnly: null },
      ],
    });

    expect(getOasisDiagnosisRowRejectionReason(candidate)).toBeNull();
    expect(isOasisDiagnosisRowActionable(candidate)).toBe(true);
    expect(isOasisDiagnosisRowInteractable(candidate)).toBe(true);
  });
});
