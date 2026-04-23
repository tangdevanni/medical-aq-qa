import { describe, expect, it } from "vitest";
import {
  isFileUploadsAccessLabel,
  isReferralDocumentsFolderLabel,
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
});
