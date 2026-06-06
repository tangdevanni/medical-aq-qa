import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env";

describe("Finale batch env OCR/DOM defaults", () => {
  it("defaults to DOM-first OASIS acquisition with OCR disabled", () => {
    const env = loadEnv({});

    expect(env.PORTAL_DOM_EXTRACTION_ENABLED).toBe(true);
    expect(env.OASIS_DOM_EXTRACTION_ENABLED).toBe(true);
    expect(env.FINALE_PATIENT_CONCURRENCY).toBe(1);
    expect(env.OASIS_SECTION_LLM_ENABLED).toBeUndefined();
    expect(env.OASIS_SECTION_LLM_MAX_CONCURRENCY).toBe(2);
    expect(env.OCR_ENABLED).toBe(false);
    expect(env.OCR_FALLBACK_ENABLED).toBe(false);
  });

  it("does not let the legacy OCR fallback flag enable OCR", () => {
    const env = loadEnv({
      OCR_FALLBACK_ENABLED: "true",
      OCR_ENABLED: "false",
    });

    expect(env.OCR_ENABLED).toBe(false);
    expect(env.OCR_FALLBACK_ENABLED).toBe(false);
  });

  it("allows OCR only when the explicit OCR kill switch is enabled", () => {
    const env = loadEnv({
      OCR_ENABLED: "true",
      OCR_FALLBACK_ENABLED: "true",
    });

    expect(env.OCR_ENABLED).toBe(true);
    expect(env.OCR_FALLBACK_ENABLED).toBe(true);
  });

  it("allows a bounded portal patient worker count", () => {
    const env = loadEnv({
      FINALE_PATIENT_CONCURRENCY: "2",
    });

    expect(env.FINALE_PATIENT_CONCURRENCY).toBe(2);
  });
});
