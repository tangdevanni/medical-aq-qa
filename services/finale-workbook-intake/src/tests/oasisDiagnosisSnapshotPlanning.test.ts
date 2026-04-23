import { describe, expect, it } from "vitest";
import type { OasisDiagnosisPageSnapshot, OasisDiagnosisRowSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import { buildOasisInputActionPlan } from "../services/oasisInputActionPlanService";
import { buildOasisDiagnosisVerificationReport } from "../services/oasisDiagnosisVerificationService";

function buildRow(overrides: Partial<OasisDiagnosisRowSnapshot>): OasisDiagnosisRowSnapshot {
  return {
    rowIndex: 0,
    rowRole: "primary",
    rowKind: "existing_diagnosis",
    hasVisibleDiagnosisControls: true,
    isInteractable: true,
    diagnosisType: "PRIMARY DIAGNOSIS",
    sectionLabel: "PRIMARY DIAGNOSIS",
    icd10Code: "R13.10",
    onsetDate: null,
    description: "Dysphagia, unspecified",
    severity: "2",
    timingFlags: ["Onset"],
    rawText: "PRIMARY DIAGNOSIS Dysphagia, unspecified",
    rawHtmlHints: [],
    extractionWarnings: [],
    selectorEvidence: [
      {
        field: "icd10Code",
        selectorUsed: "[formcontrolname='icdcode']",
        found: true,
        valueSource: "value",
        disabled: false,
        readOnly: false,
      },
    ],
    ...overrides,
  };
}

function buildSnapshot(rows: OasisDiagnosisRowSnapshot[]): OasisDiagnosisPageSnapshot {
  const existingDiagnosisRowCount = rows.filter((row) => row.rowKind === "existing_diagnosis").length;
  const emptyEditableSlotCount = rows.filter((row) => row.rowKind === "empty_editable_slot").length;
  const emptyReadonlySlotCount = rows.filter((row) => row.rowKind === "empty_readonly_slot").length;
  const visibleEditableSlotCount = rows.filter((row) => row.isInteractable).length;

  return {
    schemaVersion: "1",
    capturedAt: "2026-04-06T00:00:00.000Z",
    page: {
      url: "https://example.test/provider/acme/client/123/intake/456/calendar",
      diagnosisContainerFound: true,
      diagnosisContainerSelector: "#diagnosis",
      diagnosisFormSelector: "[formarrayname='diagnosis'] [formgroupname]",
      sectionMarkers: ["Active Diagnoses", "PRIMARY DIAGNOSIS"],
      insertDiagnosisVisible: true,
      rowCount: rows.length,
      existingDiagnosisRowCount,
      emptyEditableSlotCount,
      emptyReadonlySlotCount,
      visibleEditableSlotCount,
      visibleDiagnosisControlCount: rows.filter((row) => row.hasVisibleDiagnosisControls).length,
      primaryDiagnosisRowCount: rows.filter((row) => row.rowRole === "primary").length,
      otherDiagnosisRowCount: rows.filter((row) => row.rowRole === "other").length,
      noVisibleDiagnosisControls: rows.every((row) => !row.hasVisibleDiagnosisControls),
    },
    rows,
    selectorEvidence: [],
    mappingNotes: [],
    extractionWarnings: [],
  };
}

describe("oasis diagnosis snapshot planning", () => {
  it("builds the action plan from visible editable slots when empty slots are present", () => {
    const snapshot = buildSnapshot([
      buildRow({
        rowIndex: 0,
        rowRole: "primary",
        rowKind: "empty_editable_slot",
        diagnosisType: "PRIMARY DIAGNOSIS",
        sectionLabel: "PRIMARY DIAGNOSIS",
        icd10Code: null,
        description: null,
        severity: null,
        timingFlags: [],
        rawText: "",
      }),
      buildRow({
        rowIndex: 1,
        rowRole: "other",
        rowKind: "empty_editable_slot",
        diagnosisType: "OTHER DIAGNOSIS",
        sectionLabel: "OTHER DIAGNOSIS",
        icd10Code: null,
        description: null,
        severity: null,
        timingFlags: [],
        rawText: "",
      }),
      buildRow({
        rowIndex: 2,
        rowRole: "other",
        rowKind: "empty_editable_slot",
        diagnosisType: "OTHER DIAGNOSIS",
        sectionLabel: "OTHER DIAGNOSIS",
        icd10Code: null,
        description: null,
        severity: null,
        timingFlags: [],
        rawText: "",
      }),
    ]);

    const plan = buildOasisInputActionPlan({
      readyDiagnosis: {
        primaryDiagnosis: {
          code: "R13.10",
          description: "Dysphagia, unspecified",
          confidence: "high",
        },
        otherDiagnoses: [
          { code: "I10", description: "Hypertension", confidence: "high" },
          { code: "E11.9", description: "Type 2 diabetes mellitus without complications", confidence: "high" },
        ],
        suggestedSeverity: 2,
        suggestedOnsetType: "onset",
        comorbidityFlags: {
          pvd_pad: false,
          diabetes: true,
          none: false,
        },
        notes: [],
      },
      snapshot,
      lockState: {
        schemaVersion: "1",
        capturedAt: "2026-04-06T00:00:00.000Z",
        pageUrl: snapshot.page.url,
        oasisLockState: "unlocked",
        unlockControlVisible: false,
        unlockControlText: null,
        fieldsEditable: true,
        verificationOnly: false,
        inputEligible: true,
        notes: [],
        selectorEvidence: [],
      },
    });

    expect(plan.availableSlotCount).toBe(3);
    expect(plan.insertDiagnosisClicksNeeded).toBe(0);
    expect(plan.actions.filter((action) => action.type === "fill_diagnosis")).toHaveLength(3);
    expect(plan.warnings).not.toContain("No currently visible diagnosis slots were detected on the Active Diagnoses page.");
  });

  it("ignores empty editable slots during verification-only diagnosis comparison", () => {
    const snapshot = buildSnapshot([
      buildRow({}),
      buildRow({
        rowIndex: 1,
        rowRole: "other",
        rowKind: "empty_editable_slot",
        diagnosisType: "OTHER DIAGNOSIS",
        sectionLabel: "OTHER DIAGNOSIS",
        icd10Code: null,
        description: null,
        severity: null,
        timingFlags: [],
        rawText: "",
      }),
    ]);

    const report = buildOasisDiagnosisVerificationReport({
      readyDiagnosis: {
        primaryDiagnosis: {
          code: "R13.10",
          description: "Dysphagia, unspecified",
          confidence: "high",
        },
        otherDiagnoses: [],
        suggestedSeverity: 2,
        suggestedOnsetType: "onset",
        comorbidityFlags: {
          pvd_pad: false,
          diabetes: false,
          none: true,
        },
        notes: [],
      },
      snapshot,
      lockState: null,
    });

    expect(report.matchedDiagnoses).toHaveLength(1);
    expect(report.extraInPortal).toHaveLength(0);
    expect(report.warnings).toContain("Verification ignored 1 empty diagnosis slot(s) from the portal snapshot.");
  });
});
