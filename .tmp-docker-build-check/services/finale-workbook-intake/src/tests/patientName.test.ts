import { describe, expect, it } from "vitest";
import {
  createPatientIdentityKey,
  formatPatientName,
  normalizePatientName,
} from "../utils/patientName";

describe("patient name normalization", () => {
  it("normalizes mixed-case comma-delimited names", () => {
    expect(normalizePatientName("doe, jAnE a.")).toBe("JANE A DOE");
    expect(formatPatientName("doe, jAnE a.")).toBe("Jane A Doe");
    expect(createPatientIdentityKey("doe, jAnE a.")).toBe("JANEADOE");
  });

  it("falls back cleanly for missing names", () => {
    expect(normalizePatientName(null)).toBe("UNKNOWN PATIENT");
    expect(formatPatientName(undefined)).toBe("Unknown Patient");
  });
});
