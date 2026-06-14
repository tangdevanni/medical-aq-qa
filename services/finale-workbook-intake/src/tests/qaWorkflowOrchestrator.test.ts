import { describe, expect, it } from "vitest";
import type {
  PatientPortalStatusOasisAssessment,
  PatientPortalStatusSnapshot,
} from "../portal/types/patientPortalStatus";
import {
  buildQaWorkflowPatientPortalStatusSnapshot,
  buildOasisAssessmentSelectionForTarget,
  getSupplementalOasisAssessmentTargets,
  getTargetedSupplementalOasisAssessmentTargets,
  mergeTargetedOasisAssessmentManifestEntries,
  resolveSelectedOasisAssessmentTarget,
} from "../workflows/qaWorkflowOrchestrator";

function makeAssessment(
  input: Partial<PatientPortalStatusOasisAssessment> & Pick<PatientPortalStatusOasisAssessment, "id" | "assessmentType">,
): PatientPortalStatusOasisAssessment {
  return {
    title: `OASIS ${input.assessmentType}`,
    date: null,
    sourceRowText: null,
    detectedStatuses: [],
    primaryStatus: null,
    decision: null,
    processingEligible: true,
    ...input,
  };
}

function makeSnapshot(oasisAssessments: PatientPortalStatusOasisAssessment[]): PatientPortalStatusSnapshot {
  return {
    schemaVersion: "patient-portal-status-snapshot.v1",
    batchId: "batch-1",
    patientId: "patient-1",
    patientName: "Steven Mace",
    status: "fresh",
    capturedAt: "2026-06-08T00:00:00.000Z",
    generatedAt: "2026-06-08T00:00:00.000Z",
    staleAfter: null,
    matchResult: null,
    chartUrl: "https://example.test/chart",
    dashboardUrl: null,
    portalAdmissionStatus: null,
    oasisAssessments,
    currentOasisAssessmentId: "current-recert",
    referralFileArea: {
      available: false,
      labels: [],
    },
    documentTableSignals: [],
    activePatientRunStatus: null,
    error: null,
  };
}

describe("qaWorkflowOrchestrator OASIS assessment selection", () => {
  it("materializes live OASIS menu rows into a patient portal snapshot for supplemental capture", () => {
    const snapshot = buildQaWorkflowPatientPortalStatusSnapshot({
      existing: null,
      batchId: "batch-1",
      workItem: {
        id: "patient-1",
        patientIdentity: {
          displayName: "Norma Galvan",
          normalizedName: "NORMA GALVAN",
          medicareNumber: null,
        },
      } as any,
      chartUrl: "https://app.finalehealth.com/client/norma",
      dashboardUrl: null,
      now: "2026-06-09T23:00:00.000Z",
      currentOasisAssessmentId: "dc-20260617-oasis-oasis-e2-pt-dc",
      oasisAssessments: [
        makeAssessment({
          id: "dc-20260617-oasis-oasis-e2-pt-dc",
          assessmentType: "DC",
          title: "OASIS-OASIS E2 - PT DC",
          date: "06/17/2026",
          sourceRowText: "OASIS-OASIS E2 - PT DC 06/17/2026 Not Due",
        }),
        makeAssessment({
          id: "recert-20260530-oasis-oasis-e2-pt-rec",
          assessmentType: "RECERT",
          title: "OASIS-OASIS E2 - PT REC",
          date: "05/30/2026",
          sourceRowText: "OASIS-OASIS E2 - PT REC 05/30/2026 In Progress",
        }),
      ],
    });

    expect(snapshot?.status).toBe("fresh");
    expect(snapshot?.currentOasisAssessmentId).toBe("dc-20260617-oasis-oasis-e2-pt-dc");
    expect(snapshot?.oasisAssessments.map((assessment) => assessment.id)).toEqual([
      "dc-20260617-oasis-oasis-e2-pt-dc",
      "recert-20260530-oasis-oasis-e2-pt-rec",
    ]);
    expect(snapshot?.documentTableSignals).toEqual([
      "DC:06/17/2026:UNKNOWN:OASIS-OASIS E2 - PT DC",
      "RECERT:05/30/2026:UNKNOWN:OASIS-OASIS E2 - PT REC",
    ]);
  });

  it("keeps every non-current processable OASIS row eligible for scoped acquisition", () => {
    const supplementalTargets = getSupplementalOasisAssessmentTargets({
      snapshot: makeSnapshot([
        makeAssessment({
          id: "current-recert",
          assessmentType: "RECERT",
          date: "05/19/2026",
          sourceRowText: "OASIS-OASIS E2 - REC 05/19/2026 IN_PROGRESS",
        }),
        makeAssessment({
          id: "older-recert",
          assessmentType: "RECERT",
          date: "04/19/2026",
          sourceRowText: "OASIS-OASIS E2 - REC 04/19/2026 VALIDATED",
        }),
        makeAssessment({
          id: "older-soc",
          assessmentType: "SOC",
          date: "01/01/2026",
          sourceRowText: "OASIS-OASIS E1 - SOC 01/01/2026 VALIDATED",
        }),
        makeAssessment({
          id: "skip-recert",
          assessmentType: "RECERT",
          date: "03/19/2026",
          processingEligible: false,
        }),
        makeAssessment({
          id: "discharge",
          assessmentType: "DC",
          date: "02/01/2026",
        }),
      ]),
      currentAssessmentId: "current-recert",
    });

    expect(supplementalTargets.map((assessment) => assessment.id)).toEqual([
      "older-recert",
      "discharge",
      "older-soc",
    ]);
  });

  it("does not add supplemental OASIS work when manual refresh targets the current assessment", () => {
    const selectedTarget = resolveSelectedOasisAssessmentTarget({
      snapshot: makeSnapshot([
        makeAssessment({ id: "current-recert", assessmentType: "RECERT", date: "05/19/2026" }),
        makeAssessment({ id: "selected-soc", assessmentType: "SOC", date: "04/01/2026" }),
        makeAssessment({ id: "older-dc", assessmentType: "DC", date: "03/01/2026" }),
      ]),
      targetOasisAssessmentId: "selected-soc",
    });
    const supplementalTargets = getTargetedSupplementalOasisAssessmentTargets({
      selectedTarget,
      currentAssessmentId: "selected-soc",
    });

    expect(supplementalTargets?.map((assessment) => assessment.id)).toEqual([]);
  });

  it("keeps the current OASIS as root and returns the selected older OASIS as the only supplemental target", () => {
    const snapshot = makeSnapshot([
      makeAssessment({ id: "current-recert", assessmentType: "RECERT", date: "05/19/2026" }),
      makeAssessment({ id: "selected-soc", assessmentType: "SOC", date: "04/01/2026" }),
      makeAssessment({ id: "older-dc", assessmentType: "DC", date: "03/01/2026" }),
    ]);

    const resolved = resolveSelectedOasisAssessmentTarget({
      snapshot,
      targetOasisAssessmentId: "selected-soc",
    });

    expect(resolved.targeted).toBe(true);
    expect(resolved.targetAssessment?.id).toBe("selected-soc");
    expect(resolved.targetAssessment?.assessmentType).toBe("SOC");
    expect(getTargetedSupplementalOasisAssessmentTargets({
      selectedTarget: resolved,
      currentAssessmentId: snapshot.currentOasisAssessmentId,
    })?.map((assessment) => assessment.id)).toEqual(["selected-soc"]);
  });

  it("preserves non-target OASIS manifest entries when replacing the selected assessment entry", () => {
    const merged = mergeTargetedOasisAssessmentManifestEntries({
      existing: [
        { assessmentId: "current-recert", processingStatus: "processed_root_current" },
        { assessmentId: "selected-soc", processingStatus: "processed_scoped" },
        { assessmentId: "older-dc", processingStatus: "processed_scoped" },
      ],
      replacements: [
        { assessmentId: "selected-soc", processingStatus: "processed_root_targeted" },
      ],
    });

    expect(merged).toEqual([
      { assessmentId: "selected-soc", processingStatus: "processed_root_targeted" },
      { assessmentId: "current-recert", processingStatus: "processed_root_current" },
      { assessmentId: "older-dc", processingStatus: "processed_scoped" },
    ]);
  });

  it("fails clearly when a selected OASIS assessment is not present in the portal list", () => {
    expect(() =>
      resolveSelectedOasisAssessmentTarget({
        snapshot: makeSnapshot([
          makeAssessment({ id: "current-recert", assessmentType: "RECERT", date: "05/19/2026" }),
        ]),
        targetOasisAssessmentId: "missing-soc",
      }),
    ).toThrow("Selected OASIS assessment was not found");
  });

  it("selects the portal current OASIS type for the monitored pass", () => {
    const selection = buildOasisAssessmentSelectionForTarget({
      baseSelection: {
        requestedAssessmentType: "SOC",
        selectedAssessmentType: "SOC",
        selectionReason: "requested_exact",
        availableAssessmentTypes: ["SOC"],
        warnings: [],
      },
      targetAssessment: makeAssessment({
        id: "latest-recert",
        assessmentType: "RECERT",
        date: "05/19/2026",
      }),
      purpose: "current_monitored",
    });

    expect(selection.selectedAssessmentType).toBe("RECERT");
    expect(selection.requestedAssessmentType).toBe("RECERT");
    expect(selection.availableAssessmentTypes).toEqual(["SOC", "RECERT"]);
    expect(selection.warnings).toEqual([]);
  });
});
