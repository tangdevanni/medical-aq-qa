import { describe, expect, it } from "vitest";
import {
  determineVisitNoteCaptureEligibility,
  isClinicallyRelevantVisitType,
  normalizeVisitNoteStatus,
  normalizeVisitNoteType,
} from "../services/visitNoteNormalizationService";

describe("visit note type normalization", () => {
  it.each([
    ["Visit Note-PTA", "", "physical_therapy"],
    ["Visit Note-PT", "", "physical_therapy"],
    ["Visit Note-RN Regular Visit - Direct Care", "", "skilled_nursing"],
    ["Visit Note-RN Mgt & Eval", "", "skilled_nursing"],
    ["Visit Note-HHA", "", "home_health_aide"],
    ["Visit Note-MSW", "", "medical_social_worker"],
    ["Visit Note-OT", "", "occupational_therapy"],
    ["Visit Note-ST", "", "speech_therapy"],
    ["Visit Note-RD", "", "registered_dietitian"],
    ["Visit Note-RT", "", "respiratory_therapy"],
    ["Visit Note-Admin Pay $20", "", "others"],
    ["Visit Note-Admin Pay $20", "Lara, Toni RN - Skilled Nursing", "others"],
    ["Visit Note", "Jane Doe, SLP", "speech_therapy"],
  ])("maps %s / %s to %s", (rawDocumentType, assignedStaffRaw, expected) => {
    expect(normalizeVisitNoteType({ rawDocumentType, assignedStaffRaw }).normalizedVisitType).toBe(expected);
  });

  it("normalizes visit note statuses used by the portal table", () => {
    expect(normalizeVisitNoteStatus("QA Completed")).toBe("qa_completed");
    expect(normalizeVisitNoteStatus("ESigned")).toBe("e_signed");
    expect(normalizeVisitNoteStatus("E-Signed")).toBe("e_signed");
    expect(normalizeVisitNoteStatus("Signed")).toBe("signed");
    expect(normalizeVisitNoteStatus("Pending QA")).toBe("qa_pending");
    expect(normalizeVisitNoteStatus("QA Review")).toBe("qa_review");
    expect(normalizeVisitNoteStatus("Not Started")).toBe("not_started");
    expect(normalizeVisitNoteStatus("Missed Visit")).toBe("missed_visit");
    expect(normalizeVisitNoteStatus("Cancelled")).toBe("cancelled");
    expect(normalizeVisitNoteStatus("In Progress")).toBe("in_progress");
    expect(normalizeVisitNoteStatus("Submitted")).toBe("submitted");
    expect(normalizeVisitNoteStatus("")).toBe("unknown");
  });

  it("treats admin notes as countable but not clinically relevant for content analysis", () => {
    expect(isClinicallyRelevantVisitType("others")).toBe(false);
    expect(isClinicallyRelevantVisitType("skilled_nursing")).toBe(true);
  });

  it("classifies capture eligibility from normalized type and table status", () => {
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "physical_therapy",
      normalizedStatus: "qa_completed",
      rawDocumentType: "Visit Note-PTA",
    }).captureEligibility).toBe("finalized_no_active_monitoring");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "physical_therapy",
      normalizedStatus: "in_progress",
      rawDocumentType: "Visit Note-PTA",
    }).captureEligibility).toBe("active_monitoring");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "occupational_therapy",
      normalizedStatus: "qa_pending",
      rawDocumentType: "Visit Note-OT",
    }).captureEligibility).toBe("active_monitoring");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "skilled_nursing",
      normalizedStatus: "e_signed",
      rawDocumentType: "Visit Note-RN",
    }).captureEligibility).toBe("active_monitoring");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "skilled_nursing",
      normalizedStatus: "not_started",
      rawDocumentType: "Visit Note-RN",
    }).captureEligibility).toBe("count_only");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "physical_therapy",
      normalizedStatus: "missed_visit",
      rawDocumentType: "Visit Note-PTA",
    }).captureEligibility).toBe("count_only");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "others",
      normalizedStatus: "qa_completed",
      rawDocumentType: "Visit Note-Admin Pay $20",
    }).captureEligibility).toBe("ineligible");
    expect(determineVisitNoteCaptureEligibility({
      normalizedVisitType: "speech_therapy",
      normalizedStatus: "unknown",
      rawDocumentType: "Visit Note-ST",
    }).captureEligibility).toBe("review_needed_unknown");
  });
});
