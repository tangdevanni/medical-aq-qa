import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { processOasisDomSections } from "../services/oasisDomSectionProcessingService";
import {
  buildOasisMggFieldSnapshot,
  OASIS_MGG_FIELD_SNAPSHOT_FILE_NAME,
} from "../services/oasisMggFieldSnapshotService";

function radioField(input: {
  itemCode: string;
  label: string;
  selectedValue: string;
  selectedText: string;
  optionTexts: string[];
}): PortalDomExtractedField {
  return {
    section: "Functional Assessment (Self Care)",
    itemCode: input.itemCode,
    label: input.label,
    key: input.itemCode,
    inputType: "radio",
    value: input.selectedValue,
    selectedValue: input.selectedValue,
    selectedText: input.selectedText,
    optionTexts: input.optionTexts,
    checked: true,
    sourceKind: "radio",
    confidence: "high",
    evidenceText: `${input.label} Options: ${input.optionTexts.join(" | ")}`,
  };
}

function section(fields: PortalDomExtractedField[]): PortalDomExtractedSection {
  return {
    title: "Functional Assessment (Self Care)",
    status: "success",
    fields,
    tables: [],
    visibleTextDigest: fields.map((field) => `${field.label}: ${field.selectedText}`).join("\n"),
    fallbackReasons: [],
  };
}

function state(fields: PortalDomExtractedField[]): PortalDomExtractedState {
  return {
    artifactType: "portal_dom_extracted_state",
    sourceArea: "oasis",
    extractionVersion: "test",
    extractedAt: "2026-06-09T08:00:00.000Z",
    sections: [section(fields)],
    coverage: {
      sectionCount: 1,
      fieldCount: fields.length,
      nonEmptyFieldCount: fields.length,
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
    contentHash: "state-hash",
    textDigest: fields.map((field) => field.selectedText).join("\n"),
  };
}

describe("oasisMggFieldSnapshotService", () => {
  it("captures selected M/GG fields with zero values and full GG suffixes", () => {
    const snapshot = buildOasisMggFieldSnapshot({
      state: state([
        radioField({
          itemCode: "M1810",
          label: "(M1810) Ability to Dress Upper Body",
          selectedValue: "0",
          selectedText: "0. Able to get clothes out of closets and drawers.",
          optionTexts: [
            "0. Able to get clothes out of closets and drawers.",
            "1. Able to dress upper body if clothing is laid out.",
            "2. Someone must help the patient put on clothing.",
          ],
        }),
        radioField({
          itemCode: "GG0170C",
          label: "(GG0170C) Lying to sitting on side of bed",
          selectedValue: "04",
          selectedText: "04. Supervision or touching assistance",
          optionTexts: [
            "01. Dependent",
            "04. Supervision or touching assistance",
            "06. Independent",
          ],
        }),
      ]),
      assessmentId: "recert-1",
      assessmentType: "RECERT",
      title: "OASIS REC",
      date: "2026-05-30",
      generatedAt: "2026-06-09T08:00:00.000Z",
    });

    expect(snapshot.fieldCount).toBe(2);
    expect(snapshot.fields.find((field) => field.itemCode === "M1810")).toMatchObject({
      fieldGroup: "M fields",
      selectedValue: "0",
      selectedOptionText: "0. Able to get clothes out of closets and drawers.",
    });
    expect(snapshot.fields.find((field) => field.itemCode === "GG0170C")).toMatchObject({
      fieldGroup: "GG fields",
      selectedValue: "04",
      selectedOptionText: "04. Supervision or touching assistance",
    });
  });

  it("excludes administrative M items from discharge-comparison snapshots", () => {
    const snapshot = buildOasisMggFieldSnapshot({
      state: state([
        radioField({
          itemCode: "M0063",
          label: "(M0063) Medicare Number",
          selectedValue: "4CW9DN1YW43",
          selectedText: "4CW9DN1YW43",
          optionTexts: [],
        }),
        radioField({
          itemCode: "M0066",
          label: "(M0066) Birth Date",
          selectedValue: "08/07/1943",
          selectedText: "08/07/1943",
          optionTexts: [],
        }),
        radioField({
          itemCode: "M1850",
          label: "(M1850) Transferring",
          selectedValue: "2",
          selectedText: "2. Able to bear weight and pivot during the transfer process but unable to transfer self.",
          optionTexts: [
            "0. Able to independently transfer.",
            "1. Able to transfer with minimal human assistance or with use of an assistive device.",
            "2. Able to bear weight and pivot during the transfer process but unable to transfer self.",
          ],
        }),
      ]),
      assessmentId: "dc-1",
      assessmentType: "DC",
      title: "OASIS DC",
      date: "2026-06-08",
      generatedAt: "2026-06-09T08:00:00.000Z",
    });

    expect(snapshot.fields.map((field) => field.itemCode)).toEqual(["M1850"]);
    expect(snapshot.fieldCount).toBe(1);
  });

  it("prioritizes explicit field item codes over broad evidence text", () => {
    const field = radioField({
      itemCode: "M2020",
      label: "(M2020) Management of Oral Medications",
      selectedValue: "1",
      selectedText: "1. Able to take medication at the correct times if prepared in advance.",
      optionTexts: [
        "0. Able to independently take the correct oral medication(s) and proper dosage(s) at the correct times.",
        "1. Able to take medication at the correct times if prepared in advance.",
      ],
    });
    field.key = "m2020_management_of_oral_medications";
    field.evidenceText = [
      "(M0063) Medicare Number: 4CW9DN1YW43",
      "(M0066) Birth Date: 08/07/1943",
      "(M2020) Management of Oral Medications",
      "Options: 0. Able to independently take medications | 1. Able if prepared in advance",
    ].join("\n");

    const snapshot = buildOasisMggFieldSnapshot({
      state: state([field]),
      assessmentId: "dc-1",
      assessmentType: "DC",
      title: "OASIS DC",
      date: "2026-06-08",
      generatedAt: "2026-06-09T08:00:00.000Z",
    });

    expect(snapshot.fields).toHaveLength(1);
    expect(snapshot.fields[0]).toMatchObject({
      itemCode: "M2020",
      fieldGroup: "M fields",
      selectedValue: "1",
    });
  });

  it("writes the snapshot while keeping dashboard section outputs stable for zero rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oasis-mgg-snapshot-"));
    try {
      const result = await processOasisDomSections({
        state: state([
          radioField({
            itemCode: "M1810",
            label: "(M1810) Ability to Dress Upper Body",
            selectedValue: "0",
            selectedText: "0. Able to get clothes out of closets and drawers.",
            optionTexts: [
              "0. Able to get clothes out of closets and drawers.",
              "1. Able to dress upper body if clothing is laid out.",
            ],
          }),
        ]),
        patientArtifactsDirectory: directory,
        patientId: "patient-1",
        patientRunId: "run-1",
        env: loadEnv({}),
        generatedAt: "2026-06-09T08:00:00.000Z",
      });

      expect(result.mggSnapshotPath).toBe(path.join(directory, OASIS_MGG_FIELD_SNAPSHOT_FILE_NAME));
      expect(result.mggSnapshot.fields[0]?.selectedValue).toBe("0");
      const persisted = JSON.parse(await readFile(result.mggSnapshotPath, "utf8")) as { fieldCount: number };
      expect(persisted.fieldCount).toBe(1);
      const functionalRows = result.outputs.sections.find((sectionOutput) =>
        sectionOutput.sectionKey === "functional_therapy",
      )?.rows ?? [];
      expect(functionalRows.some((row) =>
        row.sourceKind === "structured_value" &&
        (row.sourceItemCode === "M1810" || row.label.includes("M1810")),
      )).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
