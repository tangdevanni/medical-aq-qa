import { describe, expect, it } from "vitest";
import {
  DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY,
  findMatchingOasisPrintSectionLabels,
  getOasisPrintSectionProfile,
} from "../oasis/print/oasisPrintedNoteProfiles";

describe("oasisPrintedNoteProfiles", () => {
  it("defaults to the full-document profile for full OASIS print capture", () => {
    expect(DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY).toBe("soc_full_document_v1");
    const profile = getOasisPrintSectionProfile();
    expect(profile.key).toBe("soc_full_document_v1");
  });

  it("matches every visible section label for the full-document print pass", () => {
    const profile = getOasisPrintSectionProfile("soc_full_document_v1");

    const matched = findMatchingOasisPrintSectionLabels({
      profile,
      labels: [
        "Value Information",
        "Administrative Information",
        "Vital Signs & Pain Assessment",
        "Medication & Allergies (Injectables Medications)",
        "Other Supplementals",
      ],
    });

    expect(matched).toEqual([
      "Value Information",
      "Administrative Information",
      "Vital Signs & Pain Assessment",
      "Medication & Allergies (Injectables Medications)",
      "Other Supplementals",
    ]);
  });

  it("matches only the administrative-information label for the targeted print pass", () => {
    const profile = getOasisPrintSectionProfile("soc_administrative_information_v1");

    const matched = findMatchingOasisPrintSectionLabels({
      profile,
      labels: [
        "Value Information",
        "Administrative Information",
        "Vital Signs & Pain Assessment",
        "Medication & Allergies (Injectables Medications)",
        "Other Supplementals",
      ],
    });

    expect(matched).toEqual([
      "Administrative Information",
    ]);
  });

  it("matches the first SOC print bundle labels from the print modal", () => {
    const profile = getOasisPrintSectionProfile("soc_foundation_sections_v1");

    const matched = findMatchingOasisPrintSectionLabels({
      profile,
      labels: [
        "Value Information",
        "Administrative Information",
        "Vital Signs & Pain Assessment",
        "Medication & Allergies (Injectables Medications)",
        "Other Supplementals",
      ],
    });

    expect(matched).toEqual([
      "Administrative Information",
      "Vital Signs & Pain Assessment",
      "Medication & Allergies (Injectables Medications)",
    ]);
  });
});
