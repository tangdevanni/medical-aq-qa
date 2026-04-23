import { describe, expect, it } from "vitest";
import {
  assertReadOnlyActionAllowed,
  resolvePortalSafetyConfig,
} from "../portal/safety/readOnlySafety";

describe("readOnlySafety", () => {
  it("defaults omitted safety config to explicit READ_ONLY settings", () => {
    const safety = resolvePortalSafetyConfig(undefined);

    expect(safety).toEqual({
      safetyMode: "READ_ONLY",
      allowAuthSubmit: true,
      allowSearchAndFilterInput: true,
      allowArtifactDownloads: true,
      enforceDangerousControlDetection: true,
    });
  });

  it("allows active-path read operations when safety config is omitted", () => {
    expect(() =>
      assertReadOnlyActionAllowed({
        safety: undefined,
        actionClass: "READ_FILTER",
        description: "patient search input fill",
      }),
    ).not.toThrow();
  });
});
