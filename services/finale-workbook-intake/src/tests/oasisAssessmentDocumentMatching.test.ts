import { describe, expect, it } from "vitest";
import {
  deriveOasisAssessmentTypeFromWorkItem,
  isOasisAssessmentLabelMatch,
  normalizeOasisAssessmentType,
  scoreOasisAssessmentDocumentLabel,
} from "../oasis/navigation/oasisAssessmentDocumentMatching";

describe("oasisAssessmentDocumentMatching", () => {
  it("matches REC document labels for RECERT patients", () => {
    expect(normalizeOasisAssessmentType("REC")).toBe("RECERT");
    expect(isOasisAssessmentLabelMatch("OASIS-OASIS E2 - REC", "RECERT")).toBe(true);
    expect(scoreOasisAssessmentDocumentLabel({
      label: "OASIS-OASIS E2 - REC",
      assessmentType: "RECERT",
    })).toBeGreaterThan(0);
  });

  it("does not treat SOC labels as RECERT matches", () => {
    expect(isOasisAssessmentLabelMatch("OASIS-OASIS E1 - SOC", "RECERT")).toBe(false);
    expect(scoreOasisAssessmentDocumentLabel({
      label: "OASIS-OASIS E1 - SOC",
      assessmentType: "RECERT",
    })).toBe(0);
  });

  it("derives RECERT from work item workflow or RFA", () => {
    expect(deriveOasisAssessmentTypeFromWorkItem({
      workflowTypes: ["RECERT"],
      episodeContext: { rfa: null },
    })).toBe("RECERT");
    expect(deriveOasisAssessmentTypeFromWorkItem({
      workflowTypes: [],
      episodeContext: { rfa: "REC" },
    })).toBe("RECERT");
  });
});
