import { describe, expect, it } from "vitest";
import type {
  PatientPortalStatusOasisAssessment,
  PatientPortalStatusSnapshot,
} from "../portal/types/patientPortalStatus";
import {
  buildOasisAssessmentSelectionForTarget,
  getSupplementalOasisAssessmentTargets,
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
