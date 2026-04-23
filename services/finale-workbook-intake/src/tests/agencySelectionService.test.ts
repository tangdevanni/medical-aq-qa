import { describe, expect, it } from "vitest";
import {
  buildUserAgenciesUrl,
  findBestAgencyOption,
  findBestAgencyOptionForTargets,
  normalizeAgencyLabel,
  scoreAgencyOption,
} from "../portal/agencySelectionService";

describe("agencySelectionService", () => {
  it("normalizes agency labels for robust matching", () => {
    expect(normalizeAgencyLabel("Star Home Health Care Inc")).toBe("star home health care inc");
    expect(normalizeAgencyLabel("Star Home Health Care, Inc.")).toBe("star home health care inc");
    expect(normalizeAgencyLabel("  Star   Home Health Care Inc  ")).toBe("star home health care inc");
  });

  it("builds the Finale user-agencies URL from the portal origin", () => {
    expect(buildUserAgenciesUrl("https://app.finalehealth.com/provider/demo/dashboard")).toBe(
      "https://app.finalehealth.com/users/user-agencies",
    );
  });

  it("scores and selects the best agency option", () => {
    const options = [
      { label: "Alpha Hospice", href: "https://app.finalehealth.com/provider/alpha-hospice/dashboard" },
      {
        label: "Star Home Health Care Inc",
        href: "https://app.finalehealth.com/provider/star-home-health-care-inc/dashboard",
      },
      { label: "Beta Home Health", href: "https://app.finalehealth.com/provider/beta-home-health/dashboard" },
    ];

    expect(scoreAgencyOption("Star Home Health Care Inc", options[1]!)).toBeGreaterThan(
      scoreAgencyOption("Star Home Health Care Inc", options[0]!),
    );

    expect(findBestAgencyOption(options, "Star Home Health Care Inc")).toMatchObject({
      label: "Star Home Health Care Inc",
    });
  });

  it("can match the shorter Finale label from a longer business-name alias set", () => {
    const options = [
      { label: "Star Home Health", href: "https://app.finalehealth.com/provider/star-home-health/dashboard" },
      { label: "Meadows Home Health", href: "https://app.finalehealth.com/provider/meadows-home-health/dashboard" },
    ];

    expect(
      findBestAgencyOptionForTargets(options, ["Star Home Health Care Inc", "Star Home Health"]),
    ).toMatchObject({
      label: "Star Home Health",
      matchedTarget: "Star Home Health",
    });
  });

  it("matches configured aliases for agencies whose Finale labels include LLC suffixes", () => {
    const options = [
      { label: "A Plus Home Health Systems LLC", href: "https://app.finalehealth.com/provider/aplus/dashboard" },
      { label: "Active Home Healthcare LLC", href: "https://app.finalehealth.com/provider/active/dashboard" },
      { label: "Avery Home Health LLC", href: "https://app.finalehealth.com/provider/avery/dashboard" },
    ];

    expect(
      findBestAgencyOptionForTargets(options, ["APlus Home Health", "A Plus Home Health Systems LLC"]),
    ).toMatchObject({
      label: "A Plus Home Health Systems LLC",
    });
    expect(
      findBestAgencyOptionForTargets(options, ["Active Home Health", "Active Home Healthcare LLC"]),
    ).toMatchObject({
      label: "Active Home Healthcare LLC",
    });
    expect(
      findBestAgencyOptionForTargets(options, ["Avery Home Health", "Avery Home Health LLC"]),
    ).toMatchObject({
      label: "Avery Home Health LLC",
    });
  });
});
