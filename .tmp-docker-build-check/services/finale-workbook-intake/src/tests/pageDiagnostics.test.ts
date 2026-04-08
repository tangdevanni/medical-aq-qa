import { describe, expect, it } from "vitest";
import {
  buildDebugArtifactBaseName,
  sanitizeArtifactLabel,
} from "../portal/utils/pageDiagnostics";

describe("pageDiagnostics", () => {
  it("sanitizes debug artifact labels for filesystem-safe names", () => {
    expect(sanitizeArtifactLabel("Patient Search: Search Input Missing")).toBe("patient-search-search-input-missing");
  });

  it("builds stable debug artifact base names", () => {
    expect(buildDebugArtifactBaseName("patient-search", "no results")).toBe("patient-search-no-results");
  });
});
