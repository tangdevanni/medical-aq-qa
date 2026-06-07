import { describe, expect, it } from "vitest";
import {
  extractReferralUploadLabelsFromText,
  isFileUploadsAccessLabel,
  isReferralDocumentsFolderLabel,
  selectRootLevelReferralUploadLabels,
  scoreReferralOrAdmissionUploadLabel,
} from "../portal/services/chartDocumentCaptureService";

describe("chartDocumentCaptureService label matching", () => {
  it("treats Intake/Referral as a valid sidebar access label", () => {
    expect(isFileUploadsAccessLabel("File Uploads")).toBe(true);
    expect(isFileUploadsAccessLabel("Intake/Referral")).toBe(true);
    expect(isFileUploadsAccessLabel(" Intake / Referral ")).toBe(true);
    expect(isFileUploadsAccessLabel("Documents")).toBe(false);
  });

  it("treats intake/referral folder names as referral document folders", () => {
    expect(isReferralDocumentsFolderLabel("Referral")).toBe(true);
    expect(isReferralDocumentsFolderLabel("Referral Files")).toBe(true);
    expect(isReferralDocumentsFolderLabel("Intake/Referral")).toBe(true);
    expect(isReferralDocumentsFolderLabel("root/Intake/Referral")).toBe(true);
    expect(isReferralDocumentsFolderLabel("Admission Packets")).toBe(false);
  });

  it("scores intake/referral file labels as referral candidates", () => {
    expect(scoreReferralOrAdmissionUploadLabel("Intake/Referral")).toBeGreaterThan(0);
    expect(scoreReferralOrAdmissionUploadLabel("New Referral Packet.pdf")).toBeGreaterThan(
      scoreReferralOrAdmissionUploadLabel("Calendar"),
    );
  });

  it("extracts visible upload labels from button/link text", () => {
    expect(
      extractReferralUploadLabelsFromText("New Referral Steven Mace 03202026.pdf"),
    ).toEqual(["New Referral Steven Mace 03202026.pdf"]);
  });

  it("prefers explicit referral files over other root-level uploads", () => {
    const labels = [
      "New Referral Steven Mace 03202026.pdf",
      "New Referral Steven Mace Wound Care Order 03202026.pdf",
      "Mace, Steven - Admission Consent.pdf",
      "Admission Packet.pdf",
      "Mace, Steven - Progress Notes 04072026.pdf",
    ];

    expect(selectRootLevelReferralUploadLabels(labels)).toEqual([
      "New Referral Steven Mace 03202026.pdf",
      "New Referral Steven Mace Wound Care Order 03202026.pdf",
    ]);
  });
});
