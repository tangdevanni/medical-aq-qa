import { describe, expect, it } from "vitest";
import {
  evaluateDocumentInventoryCandidate,
} from "../services/documentInventoryService";

describe("evaluateDocumentInventoryCandidate", () => {
  it("rejects navigation-only chart links such as Visit Map", () => {
    const evaluation = evaluateDocumentInventoryCandidate({
      label: "Visit Map",
      href: "/provider/1/client/2/intake/3/calendar",
      contextText: "Goto Patient page Visit Map",
    });

    expect(evaluation.accepted).toBe(false);
    expect(evaluation.rejectionReason).toContain("Navigation-only");
  });

  it("accepts chart documents and guesses their type/open behavior", () => {
    const evaluation = evaluateDocumentInventoryCandidate({
      label: "OASIS Assessment SN",
      href: "/documents/oasis-assessment.pdf",
      contextText: "Clinical Documents",
      target: "_blank",
    });

    expect(evaluation.accepted).toBe(true);
    expect(evaluation.item.normalizedType).toBe("OASIS");
    expect(evaluation.openBehaviorGuess).toBe("DOWNLOAD");
  });
});
