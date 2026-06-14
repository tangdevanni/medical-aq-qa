import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import {
  buildOasisDomSectionWorkItems,
  processOasisDomSections,
} from "../services/oasisDomSectionProcessingService";

function field(input: {
  itemCode?: string;
  label: string;
  value: string;
}): PortalDomExtractedField {
  return {
    ...(input.itemCode ? { itemCode: input.itemCode } : {}),
    label: input.label,
    key: input.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    value: input.value,
    sourceKind: "input",
    confidence: "high",
  };
}

function section(title: string, fields: PortalDomExtractedField[], visibleTextDigest?: string): PortalDomExtractedSection {
  return {
    title,
    status: "success",
    fields,
    tables: [],
    visibleTextDigest: visibleTextDigest ?? fields.map((entry) => `${entry.label}: ${entry.value}`).join("\n"),
    fallbackReasons: [],
  };
}

function state(sections: PortalDomExtractedSection[], contentHash = "state-hash"): PortalDomExtractedState {
  return {
    artifactType: "portal_dom_extracted_state",
    sourceArea: "oasis",
    extractionVersion: "test",
    extractedAt: "2026-06-04T08:00:00.000Z",
    sections,
    coverage: {
      sectionCount: sections.length,
      fieldCount: sections.reduce((total, entry) => total + entry.fields.length, 0),
      nonEmptyFieldCount: sections.reduce((total, entry) => total + entry.fields.length, 0),
      tableCount: 0,
      confidence: "high",
      fallbackRecommended: false,
      fallbackReasons: [],
    },
    diagnostics: {
      inputSource: "dom_state_primary",
      ocrUsed: false,
      pdfCaptureUsed: false,
    },
    contentHash,
    textDigest: sections.map((entry) => entry.visibleTextDigest ?? "").join("\n"),
  };
}

describe("oasisDomSectionProcessingService", () => {
  it("builds one work item per dashboard section from DOM state", () => {
    const workItems = buildOasisDomSectionWorkItems({
      state: state([
        section("Administrative Information", [field({ itemCode: "M0030", label: "Start Of Care Date", value: "2026-05-09" })]),
        section("Safety Risk Assessment", [field({ label: "Living Situation", value: "Lives alone" })]),
        section("Plan of Care", [], `Plan begins. ${"x".repeat(5_000)} Late plan detail: skilled teaching continues.`),
      ]),
      patientId: "patient-1",
      modelId: "test-model",
    });

    expect(workItems.map((entry) => entry.sectionKey)).toEqual([
      "diagnoses",
      "medications_allergies",
      "safety_social_support",
      "functional_therapy",
      "body_systems",
      "dates_admin",
      "plan_of_care",
    ]);
    expect(workItems.find((entry) => entry.sectionKey === "dates_admin")?.sourceSectionTitles).toEqual([
      "Administrative Information",
    ]);
    expect(workItems.find((entry) => entry.sectionKey === "safety_social_support")?.fieldCount).toBe(1);
    expect(workItems.find((entry) => entry.sectionKey === "plan_of_care")?.normalizedContent).toContain(
      "Late plan detail: skilled teaching continues.",
    );
  });

  it("runs LLM for new section content and reuses unchanged section hashes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oasis-dom-section-processing-"));
    try {
      const env = loadEnv({
        OASIS_SECTION_LLM_MODEL_ID: "test-model",
        OASIS_SECTION_LLM_MAX_CONCURRENCY: "3",
      });
      const firstCalls: string[] = [];
      const first = await processOasisDomSections({
        state: state([
          section("Administrative Information", [field({ itemCode: "M0030", label: "Start Of Care Date", value: "2026-05-09" })]),
          section("Safety Risk Assessment", [field({ label: "Living Situation", value: "Lives alone" })]),
        ], "state-a"),
        patientArtifactsDirectory: directory,
        patientId: "patient-1",
        patientRunId: "run-1",
        env,
        generatedAt: "2026-06-04T08:00:00.000Z",
        invokeText: async ({ sectionKey }) => {
          firstCalls.push(sectionKey);
          return JSON.stringify({
            rows: [{
              label: `${sectionKey} row`,
              value: "Captured value",
              meta: null,
              sourceKind: "structured_value",
              confidence: 0.92,
              sourceItemCode: null,
            }],
            warnings: [],
          });
        },
      });

      expect(firstCalls.sort()).toEqual(["dates_admin", "safety_social_support"]);
      expect(first.outputs.summary.processedSections).toBe(2);
      expect(first.outputs.summary.skippedSections).toBe(5);

      const secondCalls: string[] = [];
      const second = await processOasisDomSections({
        state: state([
          section("Administrative Information", [field({ itemCode: "M0030", label: "Start Of Care Date", value: "2026-05-09" })]),
          section("Safety Risk Assessment", [field({ label: "Living Situation", value: "Lives alone" })]),
          section("Medication & Allergies", [field({ label: "Medication", value: "Tamsulosin 0.4 mg by mouth" })]),
        ], "state-b"),
        patientArtifactsDirectory: directory,
        patientId: "patient-1",
        patientRunId: "run-1",
        env,
        generatedAt: "2026-06-04T08:05:00.000Z",
        invokeText: async ({ sectionKey }) => {
          secondCalls.push(sectionKey);
          return JSON.stringify({
            rows: [{
              label: `${sectionKey} row`,
              value: "Updated captured value",
              meta: null,
              sourceKind: "structured_value",
              confidence: 0.93,
              sourceItemCode: null,
            }],
            warnings: [],
          });
        },
      });

      expect(secondCalls).toEqual(["medications_allergies"]);
      expect(second.outputs.summary.processedSections).toBe(1);
      expect(second.outputs.summary.reusedSections).toBe(6);
      expect(
        second.manifest.sectionInputs.find((entry) => entry.sectionKey === "medications_allergies")?.rerunReason,
      ).toBe("section_content_changed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists deterministic DOM rows without invoking LLM when section LLM is disabled", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oasis-dom-section-processing-"));
    try {
      const result = await processOasisDomSections({
        state: state([
          section("Administrative Information", [field({ itemCode: "M0030", label: "Start Of Care Date", value: "2026-05-09" })]),
        ]),
        patientArtifactsDirectory: directory,
        patientId: "patient-1",
        patientRunId: "run-1",
        env: loadEnv({}),
        generatedAt: "2026-06-04T08:00:00.000Z",
      });

      const datesAdmin = result.outputs.sections.find((entry) => entry.sectionKey === "dates_admin");
      expect(datesAdmin?.processingSource).toBe("deterministic");
      expect(datesAdmin?.analysisStatus).toBe("disabled");
      expect(datesAdmin?.rows[0]).toMatchObject({
        label: "M0030 - Start Of Care Date",
        value: "2026-05-09",
        sourceKind: "structured_value",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
