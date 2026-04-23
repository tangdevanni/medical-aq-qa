import { describe, expect, it, vi } from "vitest";
import { openAssessmentNote } from "../oasis/navigation/oasisAssessmentNoteService";

describe("oasisAssessmentNoteService", () => {
  const context = {
    batchId: "batch-1",
    patientRunId: "patient-run-1",
    workflowDomain: "qa" as const,
    patientName: "Jane Doe",
    chartUrl: "https://example.test/chart",
    resolvedAt: new Date().toISOString(),
  };

  const workItem = {
    patientIdentity: {
      displayName: "Jane Doe",
    },
  };

  it("confirms the opened assessment matches the requested SOC type", async () => {
    const result = await openAssessmentNote({
      context,
      workItem: workItem as never,
      evidenceDir: "C:\\tmp",
      selection: {
        requestedAssessmentType: "SOC",
        selectedAssessmentType: "SOC",
        selectionReason: "requested_exact",
        availableAssessmentTypes: ["SOC", "RECERT"],
        warnings: [],
      },
      logger: {
        info: vi.fn(),
      } as never,
      portalClient: {
        openOasisAssessmentNoteForReview: vi.fn().mockResolvedValue({
          result: {
            assessmentOpened: true,
            matchedAssessmentLabel: "SOC OASIS",
            matchedRequestedAssessment: true,
            currentUrl: "https://example.test/chart/oasis/soc",
            diagnosisSectionOpened: true,
            diagnosisListFound: true,
            diagnosisListSamples: [],
            visibleDiagnoses: [],
            lockStatus: "locked",
            oasisAssessmentStatus: {
              detectedStatuses: ["SIGNED", "VALIDATED"],
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
              reason: "Continue downstream OASIS capture because no skip-only status was detected.",
              matchedSignals: ["button role=button name=VALIDATED"],
            },
            warnings: [],
          },
          stepLogs: [],
        }),
      } as never,
    });

    expect(result.result.assessmentOpened).toBe(true);
    expect(result.result.matchedRequestedAssessment).toBe(true);
    expect(result.result.oasisAssessmentStatus?.primaryStatus).toBe("VALIDATED");
    expect(result.result.warnings).toEqual([]);
  });

  it("adds a warning when the opened assessment label does not match the requested type", async () => {
    const result = await openAssessmentNote({
      context,
      workItem: workItem as never,
      evidenceDir: "C:\\tmp",
      selection: {
        requestedAssessmentType: "SOC",
        selectedAssessmentType: "SOC",
        selectionReason: "requested_exact",
        availableAssessmentTypes: ["SOC", "RECERT"],
        warnings: [],
      },
      logger: {
        info: vi.fn(),
      } as never,
      portalClient: {
        openOasisAssessmentNoteForReview: vi.fn().mockResolvedValue({
          result: {
            assessmentOpened: true,
            matchedAssessmentLabel: "RECERT OASIS",
            matchedRequestedAssessment: false,
            currentUrl: "https://example.test/chart/oasis/recert",
            diagnosisSectionOpened: true,
            diagnosisListFound: true,
            diagnosisListSamples: [],
            visibleDiagnoses: [],
            lockStatus: "locked",
            oasisAssessmentStatus: {
              detectedStatuses: ["FOR_EXPORT"],
              primaryStatus: "FOR_EXPORT",
              decision: "SKIP",
              processingEligible: false,
              reason: "Skip downstream OASIS capture because the assessment page shows for export.",
              matchedSignals: ["button role=button name=FOR EXPORT"],
            },
            warnings: [],
          },
          stepLogs: [],
        }),
      } as never,
    });

    expect(result.result.matchedRequestedAssessment).toBe(false);
    expect(result.result.warnings[0]).toMatch(/did not match requested assessment type SOC/i);
  });
});
