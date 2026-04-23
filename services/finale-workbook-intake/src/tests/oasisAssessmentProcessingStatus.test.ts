import { describe, expect, it } from "vitest";
import { deriveOasisAssessmentProcessingSummary } from "../oasis/status/oasisAssessmentProcessingStatus";

describe("deriveOasisAssessmentProcessingSummary", () => {
  it("keeps validated notes processable when no skip status is present", () => {
    const result = deriveOasisAssessmentProcessingSummary([
      "button role=button name=SIGNED",
      "button role=button name=VALIDATED",
    ]);

    expect(result.detectedStatuses).toEqual(["SIGNED", "VALIDATED"]);
    expect(result.primaryStatus).toBe("VALIDATED");
    expect(result.decision).toBe("PROCESS");
    expect(result.processingEligible).toBe(true);
  });

  it("treats for export as a skip signal", () => {
    const result = deriveOasisAssessmentProcessingSummary([
      "button role=button name=FOR EXPORT",
      "button role=button name=SIGNED",
    ]);

    expect(result.detectedStatuses).toContain("FOR_EXPORT");
    expect(result.primaryStatus).toBe("FOR_EXPORT");
    expect(result.decision).toBe("SKIP");
    expect(result.processingEligible).toBe(false);
  });

  it("does not double-count e-signed as signed", () => {
    const result = deriveOasisAssessmentProcessingSummary([
      "button role=button name=E-SIGNED",
    ]);

    expect(result.detectedStatuses).toEqual(["ESIGNED"]);
  });

  it("defaults to unknown when no supported status is found", () => {
    const result = deriveOasisAssessmentProcessingSummary([
      "button role=button name=Save",
      "button role=button name=Doc Uploads",
    ]);

    expect(result.detectedStatuses).toEqual([]);
    expect(result.primaryStatus).toBe("UNKNOWN");
    expect(result.decision).toBe("PROCESS");
  });
});
