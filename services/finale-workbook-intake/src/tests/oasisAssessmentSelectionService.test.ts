import { describe, expect, it } from "vitest";
import { selectOasisAssessmentType } from "../oasis/navigation/oasisAssessmentSelectionService";

describe("oasisAssessmentSelectionService", () => {
  const context = {
    batchId: "batch-1",
    patientRunId: "patient-run-1",
    workflowDomain: "qa" as const,
    patientName: "Jane Doe",
    chartUrl: "https://example.test/chart",
    resolvedAt: new Date().toISOString(),
  };

  const workItemBase = {
    workflowTypes: ["RECERT"],
    episodeContext: {
      rfa: "RECERT",
    },
  };

  it("prefers SOC when SOC is available even if another type was requested", () => {
    const result = selectOasisAssessmentType({
      context,
      workItem: workItemBase as never,
      menuResult: {
        opened: true,
        currentUrl: "https://example.test/chart/oasis",
        selectorUsed: "sidebar:OASIS",
        availableAssessmentTypes: ["SOC", "RECERT"],
        warnings: [],
      },
    });

    expect(result.result.requestedAssessmentType).toBe("RECERT");
    expect(result.result.selectedAssessmentType).toBe("SOC");
    expect(result.result.selectionReason).toBe("preferred_soc");
    expect(result.result.warnings[0]).toMatch(/overridden to SOC/i);
  });

  it("uses the requested type when SOC is not available and the requested type is listed", () => {
    const result = selectOasisAssessmentType({
      context,
      workItem: workItemBase as never,
      menuResult: {
        opened: true,
        currentUrl: "https://example.test/chart/oasis",
        selectorUsed: "sidebar:OASIS",
        availableAssessmentTypes: ["RECERT"],
        warnings: [],
      },
    });

    expect(result.result.selectedAssessmentType).toBe("RECERT");
    expect(result.result.selectionReason).toBe("requested_exact");
    expect(result.result.warnings).toEqual([]);
  });
});
