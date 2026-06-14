import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env";
import type { OasisDomSectionOutputsArtifact } from "../services/oasisDomSectionProcessingService";
import type { OasisMggFieldSnapshotArtifact } from "../services/oasisMggFieldSnapshotService";
import { buildOasisInternalMismatchReview } from "../services/oasisInternalMismatchReviewService";

function sectionOutputs(): OasisDomSectionOutputsArtifact {
  return {
    schemaVersion: "oasis-dom-section-outputs.v1",
    generatedAt: "2026-06-08T08:00:00.000Z",
    patientId: "patient-1",
    patientRunId: "run-1",
    processingMode: "dom_section_llm",
    promptVersion: "oasis-dom-section-llm.v1",
    modelId: "section-model",
    domContentHash: "dom-hash",
    sections: [
      {
        sectionKey: "diagnoses",
        label: "Diagnoses",
        sourceSectionTitles: ["Active Diagnoses"],
        sectionContentHash: "diagnoses-hash",
        analysisInputHash: "diagnoses-input",
        cacheKey: "diagnoses-cache",
        promptVersion: "oasis-dom-section-llm.v1",
        modelId: "section-model",
        processingMode: "dom_section_llm",
        processingSource: "new_llm",
        analysisStatus: "success",
        rerunReason: "new_section",
        fieldCount: 1,
        tableCount: 0,
        evidenceRowCount: 1,
        rows: [{
          label: "Primary diagnosis",
          value: "Patient unable to ambulate due to paraplegia",
          meta: null,
          sourceKind: "structured_value",
          confidence: 0.92,
          sourceSectionTitle: "Active Diagnoses",
          sourceItemCode: "M1021",
        }],
        warnings: [],
        processedAt: "2026-06-08T08:00:00.000Z",
      },
      {
        sectionKey: "functional_therapy",
        label: "Functional / Therapy",
        sourceSectionTitles: ["Functional Status"],
        sectionContentHash: "functional-hash",
        analysisInputHash: "functional-input",
        cacheKey: "functional-cache",
        promptVersion: "oasis-dom-section-llm.v1",
        modelId: "section-model",
        processingMode: "dom_section_llm",
        processingSource: "new_llm",
        analysisStatus: "success",
        rerunReason: "new_section",
        fieldCount: 1,
        tableCount: 0,
        evidenceRowCount: 1,
        rows: [{
          label: "Ambulation",
          value: "Ambulates 150 feet with rolling walker",
          meta: null,
          sourceKind: "structured_value",
          confidence: 0.9,
          sourceSectionTitle: "Functional Status",
          sourceItemCode: "GG0170",
        }],
        warnings: [],
        processedAt: "2026-06-08T08:00:00.000Z",
      },
    ],
    summary: {
      totalSections: 2,
      processedSections: 2,
      reusedSections: 0,
      deterministicSections: 0,
      skippedSections: 0,
      failedSections: 0,
    },
    warnings: [],
  };
}

function dischargeSectionOutputs(input: {
  assessmentId?: string;
  m1850Value: string;
  gg0170Value?: string;
}): OasisDomSectionOutputsArtifact {
  const base = sectionOutputs();
  return {
    ...base,
    sections: [
      {
        ...base.sections[1]!,
        rows: [
          {
            label: "(M1850) Transferring",
            value: input.m1850Value,
            meta: "0. Able to independently transfer. 1. Able to transfer with minimal human assistance or assistive device. 2. Able to bear weight and pivot but unable to transfer self. 3. Unable to transfer self. 4. Bedfast.",
            sourceKind: "structured_value",
            confidence: 0.92,
            sourceSectionTitle: "Functional Status",
            sourceItemCode: "M1850",
          },
          {
            label: "(GG0170C) Mobility - Lying to sitting on side of bed",
            value: input.gg0170Value ?? "03 - Partial/moderate assistance",
            meta: "06. Independent. 05. Setup or clean-up assistance. 04. Supervision or touching assistance. 03. Partial/moderate assistance. 02. Substantial/maximal assistance. 01. Dependent.",
            sourceKind: "structured_value",
            confidence: 0.9,
            sourceSectionTitle: "Functional Status",
            sourceItemCode: "GG0170C",
          },
        ],
      },
    ],
  };
}

function mggSnapshot(input: {
  assessmentId: string;
  assessmentType?: string;
  m1850Value: string;
  m1850Text: string;
  gg0170Value?: string;
  gg0170Text?: string;
  ggOptions?: string[];
}): OasisMggFieldSnapshotArtifact {
  return {
    schemaVersion: "oasis-mgg-field-snapshot.v1",
    generatedAt: "2026-06-08T08:00:00.000Z",
    assessmentId: input.assessmentId,
    assessmentType: input.assessmentType ?? "DC",
    title: input.assessmentType === "SOC" ? "OASIS SOC" : "OASIS DC",
    date: input.assessmentType === "SOC" ? "2026-04-01" : "2026-06-08",
    sourceDomStatePath: null,
    fieldCount: 2,
    fields: [
      {
        fieldKey: "M1850",
        fieldGroup: "M fields",
        itemCode: "M1850",
        itemLabel: "Transferring",
        sectionTitle: "Functional Status",
        selectedValue: input.m1850Value,
        selectedOptionText: input.m1850Text,
        optionTexts: [
          "0. Able to independently transfer.",
          "1. Able to transfer with minimal human assistance or with use of an assistive device.",
          "2. Able to bear weight and pivot during the transfer process but unable to transfer self.",
          "3. Unable to transfer self and is unable to bear weight or pivot.",
          "4. Bedfast, unable to transfer.",
        ],
        confidence: "high",
        sourceEvidenceText: "M1850 transferring options",
      },
      {
        fieldKey: "GG0170C",
        fieldGroup: "GG fields",
        itemCode: "GG0170C",
        itemLabel: "Lying to sitting on side of bed",
        sectionTitle: "Functional Status",
        selectedValue: input.gg0170Value ?? "03",
        selectedOptionText: input.gg0170Text ?? "03. Partial/moderate assistance",
        optionTexts: input.ggOptions ?? [
          "01. Dependent",
          "02. Substantial/maximal assistance",
          "03. Partial/moderate assistance",
          "04. Supervision or touching assistance",
          "05. Setup or clean-up assistance",
          "06. Independent",
        ],
        confidence: "high",
        sourceEvidenceText: "GG0170C mobility options",
      },
    ],
    warnings: [],
  };
}

function mggSnapshotWithAdminFields(input: Parameters<typeof mggSnapshot>[0]): OasisMggFieldSnapshotArtifact {
  const base = mggSnapshot(input);
  const adminFields = [
    {
      fieldKey: "GG0170Q",
      fieldGroup: "GG fields" as const,
      itemCode: "GG0170Q",
      itemLabel: "Does patient use a wheelchair and/or scooter?",
      sectionTitle: "Functional Status",
      selectedValue: "0. No",
      selectedOptionText: "0. No",
      optionTexts: ["0. No", "1. Yes"],
      confidence: "high" as const,
      sourceEvidenceText: "GG0170Q wheelchair follow-up row",
    },
    {
      fieldKey: "stale-special-treatments",
      fieldGroup: "M fields" as const,
      itemCode: "M1400",
      itemLabel: "Special Treatments, Procedures, and Programs",
      sectionTitle: "Special Treatments, Procedures, and Programs",
      selectedValue: "Check all of the following treatments, procedures, and programs that apply at discharge.",
      selectedOptionText: "Check all of the following treatments, procedures, and programs that apply at discharge.",
      optionTexts: [],
      confidence: "low" as const,
      sourceEvidenceText: "Stale broad evidence text contaminated with M1400",
    },
    {
      fieldKey: "M0063",
      fieldGroup: "M fields" as const,
      itemCode: "M0063",
      itemLabel: "Medicare Number",
      sectionTitle: "Administrative Information",
      selectedValue: "4TU5VR3YN83",
      selectedOptionText: "4TU5VR3YN83",
      optionTexts: [],
      confidence: "high" as const,
      sourceEvidenceText: "M0063 Medicare Number",
    },
    {
      fieldKey: "M0066",
      fieldGroup: "M fields" as const,
      itemCode: "M0066",
      itemLabel: "Birth Date",
      sectionTitle: "Administrative Information",
      selectedValue: "02/19/1961",
      selectedOptionText: "02/19/1961",
      optionTexts: [],
      confidence: "high" as const,
      sourceEvidenceText: "M0066 Birth Date",
    },
  ];
  return {
    ...base,
    fieldCount: base.fields.length + adminFields.length,
    fields: [...adminFields, ...base.fields],
  };
}

describe("oasisInternalMismatchReviewService", () => {
  it("produces concise section-grouped cross-section discrepancies", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "recert-20260608",
      assessmentType: "RECERT",
      title: "OASIS RECERT",
      date: "2026-06-08",
      sectionOutputs: sectionOutputs(),
      env: loadEnv({}),
      checkedAt: "2026-06-08T09:00:00.000Z",
      invokeText: async () => ({
        modelId: "test-model",
        content: JSON.stringify({
          summary: "One diagnosis-to-function contradiction needs review.",
          sections: [{
            sectionKey: "diagnoses",
            sectionLabel: "Diagnoses",
            discrepancies: [{
              itemCode: "M1021",
              itemLabel: "Primary diagnosis",
              primarySection: "Diagnoses",
              contradictingSections: ["Functional / Therapy"],
              valuesInConflict: [
                "Diagnoses: patient unable to ambulate due to paraplegia",
                "Functional / Therapy: ambulates 150 feet with rolling walker",
              ],
              reasoning: "The diagnosis narrative describes non-ambulation, but the functional section documents active ambulation.",
              confidence: "high",
              reviewerAction: "Verify whether the diagnosis description or ambulation response is outdated.",
            }],
          }],
        }),
      }),
    });

    expect(result.status).toBe("discrepancies_found");
    const diagnoses = result.sections.find((section) => section.sectionKey === "diagnoses");
    expect(diagnoses?.discrepancies).toHaveLength(1);
    expect(diagnoses?.discrepancies[0]?.contradictingSections).toEqual(["Functional / Therapy"]);
    expect(diagnoses?.discrepancies[0]?.reasoning).toContain("functional section");
    expect(result.diagnostics.modelId).toBe("test-model");
  });

  it("returns clean when the LLM reports no discrepancies", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "soc-20260608",
      sectionOutputs: sectionOutputs(),
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "No internal OASIS discrepancies found.",
        sections: [],
      }),
    });

    expect(result.status).toBe("clean");
    expect(result.sections.reduce((total, section) => total + section.discrepancies.length, 0)).toBe(0);
  });

  it("drops speculative independence versus no-problems-identified LLM false positives", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: sectionOutputs(),
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "Discrepancies found in functional status and mobility assessments.",
        sections: [{
          sectionKey: "functional_therapy",
          sectionLabel: "Functional / Therapy",
          discrepancies: [{
            itemCode: "GG0130A",
            itemLabel: "A. Eating:",
            primarySection: "Functional / Therapy",
            contradictingSections: ["Body Systems"],
            valuesInConflict: [
              "Functional / Therapy says Independent",
              "Body Systems says No Problems Identified",
            ],
            reasoning: "Functional / Therapy indicates independence in eating, while Body Systems reports no problems identified, which could imply potential issues.",
            confidence: "medium",
            reviewerAction: "Verify the patient's actual ability to eat independently and resolve the discrepancy.",
          }],
        }],
      }),
    });

    expect(result.status).toBe("clean");
    expect(result.sections.find((section) => section.sectionKey === "functional_therapy")?.discrepancies).toHaveLength(0);
  });

  it("drops unrelated functional independence versus vaccination text LLM false positives", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: sectionOutputs(),
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "Discrepancies found between functional independence and mobility assessments.",
        sections: [{
          sectionKey: "functional_therapy",
          sectionLabel: "Functional / Therapy",
          discrepancies: [{
            itemCode: "GG0130A",
            itemLabel: "Eating",
            primarySection: "Functional / Therapy",
            contradictingSections: ["Plan of Care"],
            valuesInConflict: [
              "Functional / Therapy says 'Independent'",
              "Plan of Care says 'No, patient is not up to date'",
            ],
            reasoning: "The plan of care vaccination statement conflicts with the functional independence score.",
            confidence: "medium",
            reviewerAction: "Verify the patient's functional status.",
          }],
        }],
      }),
    });

    expect(result.status).toBe("clean");
    expect(result.summary).toBe("No internal OASIS discrepancies found.");
    expect(result.sections.find((section) => section.sectionKey === "functional_therapy")?.discrepancies).toHaveLength(0);
  });

  it("marks invalid non-JSON LLM output failed without displaying raw prose", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "soc-20260608",
      sectionOutputs: sectionOutputs(),
      env: loadEnv({}),
      invokeText: async () => "The OASIS looks mostly fine.",
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics.rawLlmParseStatus).toBe("invalid_json");
    expect(result.summary).not.toContain("mostly fine");
    expect(result.sections.every((section) => section.discrepancies.length === 0)).toBe(true);
  });

  it("deterministically flags discharged M-field worsening from snapshots", async () => {
    let capturedPrompt = "";
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      date: "2026-06-08",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "3 - Unable to transfer self and unable to bear weight",
      }),
      mggSnapshot: mggSnapshot({
        assessmentId: "dc-20260608",
        assessmentType: "DC",
        m1850Value: "3",
        m1850Text: "3. Unable to transfer self and is unable to bear weight or pivot.",
        gg0170Value: "04",
        gg0170Text: "04. Supervision or touching assistance",
      }),
      baselineAssessment: {
        assessmentId: "soc-20260401",
        assessmentType: "SOC",
        title: "OASIS SOC",
        date: "2026-04-01",
        selectionReason: "soc_assessment_type",
        mggSnapshot: mggSnapshot({
          assessmentId: "soc-20260401",
          assessmentType: "SOC",
          m1850Value: "1",
          m1850Text: "1. Able to transfer with minimal human assistance or with use of an assistive device.",
          gg0170Value: "03",
          gg0170Text: "03. Partial/moderate assistance",
        }),
      },
      env: loadEnv({}),
      invokeText: async ({ prompt }) => {
        capturedPrompt = prompt;
        return JSON.stringify({
          summary: "No internal OASIS discrepancies found.",
          sections: [],
        });
      },
    });

    expect(capturedPrompt).toContain("Do not perform discharge improvement comparison");
    expect(capturedPrompt).toContain("M1850");
    expect(capturedPrompt).toContain("GG0170C");
    expect(capturedPrompt).not.toMatch(/textract/i);
    expect(result.status).toBe("discrepancies_found");
    expect(result.dischargeComparison?.status).toBe("available");
    expect(result.dischargeComparison?.outcome).toBe("worsened");
    expect(result.dischargeComparison?.baselineAssessment?.assessmentId).toBe("soc-20260401");
    expect(result.dischargeComparison?.findings[0]?.fieldGroup).toBe("M fields");
  });

  it("filters stale non-clinical and unscored M-fields out of discharge comparisons", async () => {
    let capturedPrompt = "";
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      date: "2026-06-08",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "1 - Able to transfer with minimal assistance",
      }),
      mggSnapshot: mggSnapshotWithAdminFields({
        assessmentId: "dc-20260608",
        assessmentType: "DC",
        m1850Value: "1",
        m1850Text: "1. Able to transfer with minimal human assistance or with use of an assistive device.",
      }),
      baselineAssessment: {
        assessmentId: "soc-20260401",
        assessmentType: "SOC",
        title: "OASIS SOC",
        date: "2026-04-01",
        selectionReason: "soc_assessment_type",
        mggSnapshot: mggSnapshotWithAdminFields({
          assessmentId: "soc-20260401",
          assessmentType: "SOC",
          m1850Value: "3",
          m1850Text: "3. Unable to transfer self and is unable to bear weight or pivot.",
        }),
      },
      env: loadEnv({}),
      invokeText: async ({ prompt }) => {
        capturedPrompt = prompt;
        return JSON.stringify({
          summary: "No internal OASIS discrepancies found.",
          sections: [],
        });
      },
    });

    expect(capturedPrompt).not.toContain("M0063");
    expect(capturedPrompt).not.toContain("M0066");
    expect(capturedPrompt).not.toContain("GG0170Q");
    expect(capturedPrompt).not.toContain("Special Treatments, Procedures, and Programs");
    expect(result.dischargeComparison?.findings.some((finding) => finding.itemCode === "M0063")).toBe(false);
    expect(result.dischargeComparison?.findings.some((finding) => finding.itemCode === "M0066")).toBe(false);
    expect(result.dischargeComparison?.findings.some((finding) => finding.itemCode === "GG0170Q")).toBe(false);
    expect(result.dischargeComparison?.findings.some((finding) => finding.itemLabel === "Special Treatments, Procedures, and Programs")).toBe(false);
    expect(result.dischargeComparison?.reviewedItemCount).toBe(2);
  });

  it("keeps a discharged OASIS clean when snapshots show clear improvement", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "1 - Able to transfer with minimal assistance",
      }),
      mggSnapshot: mggSnapshot({
        assessmentId: "dc-20260608",
        assessmentType: "DC",
        m1850Value: "1",
        m1850Text: "1. Able to transfer with minimal human assistance or with use of an assistive device.",
        gg0170Value: "04",
        gg0170Text: "04. Supervision or touching assistance",
      }),
      baselineAssessment: {
        assessmentId: "soc-20260401",
        assessmentType: "SOC",
        title: "OASIS SOC",
        date: "2026-04-01",
        selectionReason: "soc_assessment_type",
        mggSnapshot: mggSnapshot({
          assessmentId: "soc-20260401",
          assessmentType: "SOC",
          m1850Value: "3",
          m1850Text: "3. Unable to transfer self and is unable to bear weight or pivot.",
          gg0170Value: "03",
          gg0170Text: "03. Partial/moderate assistance",
        }),
      },
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "Discharge M/GG fields show improvement where comparable.",
        sections: [],
      }),
    });

    expect(result.status).toBe("clean");
    expect(result.dischargeComparison?.outcome).toBe("improved");
    expect(result.dischargeComparison?.findings).toHaveLength(0);
  });

  it("flags GG worsening when snapshot options show higher scores are better", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "1 - Able to transfer with minimal assistance",
        gg0170Value: "02 - Substantial/maximal assistance",
      }),
      mggSnapshot: mggSnapshot({
        assessmentId: "dc-20260608",
        assessmentType: "DC",
        m1850Value: "1",
        m1850Text: "1. Able to transfer with minimal human assistance or with use of an assistive device.",
        gg0170Value: "02",
        gg0170Text: "02. Substantial/maximal assistance",
      }),
      baselineAssessment: {
        assessmentId: "soc-20260401",
        assessmentType: "SOC",
        title: "OASIS SOC",
        date: "2026-04-01",
        selectionReason: "soc_assessment_type",
        mggSnapshot: mggSnapshot({
          assessmentId: "soc-20260401",
          assessmentType: "SOC",
          m1850Value: "3",
          m1850Text: "3. Unable to transfer self and is unable to bear weight or pivot.",
          gg0170Value: "03",
          gg0170Text: "03. Partial/moderate assistance",
        }),
      },
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "One GG mobility item worsened from baseline.",
        sections: [],
      }),
    });

    expect(result.dischargeComparison?.findings[0]?.fieldGroup).toBe("GG fields");
    expect(result.dischargeComparison?.findings[0]?.scoringInterpretation).toContain("Higher score");
  });

  it("uses standardized higher-is-better scoring for GG snapshots even when options are incomplete", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "1 - Able to transfer with minimal assistance",
      }),
      mggSnapshot: mggSnapshot({
        assessmentId: "dc-20260608",
        assessmentType: "DC",
        m1850Value: "1",
        m1850Text: "1. Able to transfer with minimal human assistance or with use of an assistive device.",
        gg0170Value: "02",
        gg0170Text: "02. Captured GG option without scale context",
        ggOptions: ["02. Captured option", "04. Captured option"],
      }),
      baselineAssessment: {
        assessmentId: "soc-20260401",
        assessmentType: "SOC",
        title: "OASIS SOC",
        date: "2026-04-01",
        selectionReason: "soc_assessment_type",
        mggSnapshot: mggSnapshot({
          assessmentId: "soc-20260401",
          assessmentType: "SOC",
          m1850Value: "3",
          m1850Text: "3. Unable to transfer self and is unable to bear weight or pivot.",
          gg0170Value: "03",
          gg0170Text: "03. Captured GG option without scale context",
          ggOptions: ["02. Captured option", "03. Captured option", "04. Captured option"],
        }),
      },
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "No internal OASIS discrepancies found.",
        sections: [],
      }),
    });

    const ggFinding = result.dischargeComparison?.findings.find((finding) => finding.itemCode === "GG0170C");
    expect(ggFinding?.result).toBe("worsened");
    expect(ggFinding?.confidence).toBe("high");
  });

  it("marks discharge comparison unavailable when no baseline is available", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "3 - Unable to transfer self",
      }),
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "No internal OASIS discrepancies found.",
        sections: [],
      }),
    });

    expect(result.status).toBe("clean");
    expect(result.dischargeComparison?.status).toBe("unavailable");
    expect(result.dischargeComparison?.summary).toMatch(/No SOC or earlier/i);
  });

  it("does not trust LLM discharge comparison when baseline M/GG snapshot is missing", async () => {
    const result = await buildOasisInternalMismatchReview({
      assessmentId: "dc-20260608",
      assessmentType: "DC",
      title: "OASIS DC",
      sectionOutputs: dischargeSectionOutputs({
        m1850Value: "3 - Unable to transfer self",
      }),
      mggSnapshot: mggSnapshot({
        assessmentId: "dc-20260608",
        assessmentType: "DC",
        m1850Value: "3",
        m1850Text: "3. Unable to transfer self and is unable to bear weight or pivot.",
      }),
      baselineAssessment: {
        assessmentId: "soc-20260401",
        assessmentType: "SOC",
        title: "OASIS SOC",
        date: "2026-04-01",
        selectionReason: "soc_assessment_type",
        mggSnapshot: null,
        unavailableReason: "Baseline M/GG snapshot was not preprocessed.",
      },
      env: loadEnv({}),
      invokeText: async () => JSON.stringify({
        summary: "LLM should not be allowed to fill missing baseline artifacts.",
        sections: [],
        dischargeComparison: {
          status: "available",
          outcome: "worsened",
          summary: "Unsupported comparison.",
          reviewedItemCount: 1,
          findings: [{
            fieldGroup: "M fields",
            itemCode: "M1850",
            itemLabel: "Transferring",
            baselineValue: "SOC: 1",
            dischargeValue: "DC: 3",
            scoringInterpretation: "Higher is worse.",
            result: "worsened",
            reasoning: "Unsupported without baseline rows.",
            confidence: "high",
            reviewerAction: "Review.",
          }],
          warnings: [],
        },
      }),
    });

    expect(result.status).toBe("clean");
    expect(result.dischargeComparison?.status).toBe("unavailable");
    expect(result.dischargeComparison?.baselineAssessment?.assessmentId).toBe("soc-20260401");
    expect(result.dischargeComparison?.summary).toBe("Baseline M/GG snapshot was not preprocessed.");
    expect(result.dischargeComparison?.findings).toHaveLength(0);
  });
});
