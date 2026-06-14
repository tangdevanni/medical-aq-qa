import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PortalDomExtractedState } from "@medical-ai-qa/shared-types";
import { buildPortalCarePlanDraftFromOasisDomState, writePortalCarePlanDraftFromOasisDom } from "../services/portalCarePlanDraftService";

function stateWithCarePlan(): PortalDomExtractedState {
  return {
    artifactType: "portal_dom_extracted_state",
    sourceArea: "oasis",
    extractionVersion: "test",
    extractedAt: "2026-05-30T00:00:00.000Z",
    sections: [{
      title: "New Identified Problem(s) Care Plan",
      status: "success",
      fields: [],
      tables: [{
        section: "New Identified Problem(s) Care Plan",
        title: "Care Plan Problems, Goals, and Interventions",
        headers: ["#", "Problem", "Goal", "Intervention", "Target Completion", "Term", "Status", "Onset", "Source"],
        rows: [[
          "1",
          "PT Balance Training - The patient currently demonstrates a high risk for falls with all functional mobility, as demonstrated by TUG score of _16___secs __ - Others",
          "Improve TUG score to 12 seconds or better to improve fall safety.",
          "Standing balance exercises with narrow and wide BOS, walking sideways and front/back directions.",
          "3 Week(s)",
          "Short-term",
          "Unmet",
          "05/09/2026",
          "05/09/2026 - 07/07/2026",
        ]],
      }],
      visibleTextDigest: "PT Balance Training Goal Intervention",
    }],
    coverage: {
      sectionCount: 1,
      fieldCount: 0,
      nonEmptyFieldCount: 0,
      tableCount: 1,
      confidence: "high",
      fallbackRecommended: false,
      fallbackReasons: [],
    },
    diagnostics: {
      inputSource: "dom_state_primary",
      ocrUsed: false,
      pdfCaptureUsed: false,
    },
    contentHash: "abc",
    textDigest: "care plan",
  };
}

function stateWithPrintPreviewCarePlanSections(): PortalDomExtractedState {
  return {
    ...stateWithCarePlan(),
    contentHash: "print-preview-sections",
    sections: [
      {
        title: "CARE PLAN (PROBLEMS / GOALS / INTERVENTIONS)",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "CARE PLAN (PROBLEMS / GOALS / INTERVENTIONS)",
      },
      {
        title: "Functional Status",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "Problem: PT Balance Training - The patient currently demonstrates a high risk for falls with all functional mobility, as demonstrated by TUG score of 16 secs",
      },
      {
        title: "Goals:",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "Goals:\nTarget Completion: 3 Week(s)\nTerm: Short-term\nStatus: Unmet\nImprove TUG score to 12 seconds or better to improve fall safety.",
      },
      {
        title: "Interventions: Assigned Staff: PT",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "Interventions: Assigned Staff: PT\nStanding balance exercises with narrow and wide BOS, walking sideways and front/back directions.",
      },
      {
        title: "Progress Toward Goals:",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "Progress Toward Goals:\nNo Progress Yet\nProblem: PT Transfer Training - The patient currently requires caregiver/standby assist for bed mobility, toilet transfers and car transfers",
      },
      {
        title: "Goals:",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "Goals:\nTarget Completion: 5 Week(s)\nTerm: Long-term\nStatus: Unmet\nPatient will safely transfer with caregiver standby assistance.",
      },
      {
        title: "Interventions: Assigned Staff: PT",
        status: "success",
        fields: [],
        tables: [],
        visibleTextDigest: "Interventions: Assigned Staff: PT\nBed scooting, turning, and sliding safely with joint protection techniques.",
      },
    ],
  };
}

async function writeOasisManifest(input: {
  patientDir: string;
  assessments: Array<{
    assessmentId: string;
    assessmentType: string;
    title?: string;
    date: string;
    artifactDirectory: string;
    isCurrent?: boolean;
    processingStatus?: string;
  }>;
}): Promise<void> {
  await writeFile(
    path.join(input.patientDir, "oasis-assessment-processing-manifest.json"),
    JSON.stringify({
      schemaVersion: "oasis-assessment-processing-manifest.v1",
      generatedAt: "2026-06-12T00:00:00.000Z",
      assessments: input.assessments.map((assessment) => ({
        ...assessment,
        title: assessment.title ?? `${assessment.assessmentType} OASIS`,
        domStatePath: path.join(assessment.artifactDirectory, "oasis-dom-extracted-state.json"),
        sectionOutputsPath: path.join(assessment.artifactDirectory, "oasis-dom-section-outputs.json"),
        processingStatus: assessment.processingStatus ?? "processed_scoped",
      })),
    }, null, 2),
    "utf8",
  );
}

describe("portal care plan draft service", () => {
  it("turns existing OASIS care plan DOM rows into review draft problem groups", () => {
    const draft = buildPortalCarePlanDraftFromOasisDomState({ state: stateWithCarePlan() });

    expect(draft?.sourcePriorityUsed).toBe("oasis_snapshot");
    expect(draft?.pocSource?.sourceType).toBe("oasis_portal");
    expect(draft?.pocSource?.sourceLabel).toBe("From OASIS");
    expect(draft?.pocSource?.sourceHash).toBe("abc");
    expect(draft?.pocSource?.capturedAt).toBe("2026-05-30T00:00:00.000Z");
    expect(draft?.summary.carePlanProblemGroupCount).toBe(1);
    expect(draft?.summary.draftedDiagnosisCount).toBe(1);
    expect(draft?.carePlanProblemGroups?.[0]?.problemTitle).toBe("PT Balance Training");
    expect(draft?.carePlanProblemGroups?.[0]?.sourceLabel).toBe("From OASIS");
    expect(draft?.carePlanProblemGroups?.[0]?.problemStatement).toContain("TUG score of 16 secs");
    expect(draft?.carePlanProblemGroups?.[0]?.goals[0]?.text).toContain("12 seconds");
    expect(draft?.carePlanProblemGroups?.[0]?.interventions[0]?.text).toContain("Standing balance exercises");
    expect(draft?.warnings.join(" ")).toContain("generated POC was skipped");
  });

  it("returns null when no portal care plan table exists", () => {
    const draft = buildPortalCarePlanDraftFromOasisDomState({
      state: {
        ...stateWithCarePlan(),
        sections: [],
      },
    });

    expect(draft).toBeNull();
  });

  it("ignores portal metadata rows and deduplicates repeated clinical rows", () => {
    const base = stateWithCarePlan();
    const table = base.sections[0]!.tables[0]!;
    table.rows = [
      table.rows[0]!,
      table.rows[0]!,
      [
        "2",
        "Onset: 05/09/2026",
        "",
        "Standing balance exercises with narrow and wide BOS, walking sideways and front/back directions.",
        "",
        "",
        "",
        "",
        "",
      ],
      [
        "3",
        "Source: 05/09/2026 - 07/07/2026 Add Goal Delete Problem",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ];

    const draft = buildPortalCarePlanDraftFromOasisDomState({ state: base });

    expect(draft?.carePlanProblemGroups).toHaveLength(1);
    expect(draft?.carePlanProblemGroups?.[0]?.problemTitle).toBe("PT Balance Training");
    expect(draft?.carePlanProblemGroups?.[0]?.goals[0]?.text).toContain("12 seconds");
    expect(JSON.stringify(draft)).not.toContain("Delete Problem");
    expect(JSON.stringify(draft)).not.toContain("Onset: 05/09/2026");
  });

  it("does not treat Goal(s) labels as usable goal content", () => {
    const base = stateWithCarePlan();
    const table = base.sections[0]!.tables[0]!;
    table.rows = [[
      "1",
      "PT Balance Training - The patient is at risk for falls.",
      "(s)",
      "Standing balance exercises with narrow and wide BOS.",
      "",
      "",
      "",
      "",
      "",
    ]];

    const draft = buildPortalCarePlanDraftFromOasisDomState({ state: base });

    expect(draft?.carePlanProblemGroups?.[0]?.goals).toHaveLength(0);
    expect(draft?.carePlanProblemGroups?.[0]?.interventions[0]?.text).toContain("Standing balance");
    expect(draft?.carePlanProblemGroups?.[0]?.needsHumanReview).toBe(true);
  });

  it("extracts goals from alternate portal goal headers", () => {
    const base = stateWithCarePlan();
    const table = base.sections[0]!.tables[0]!;
    table.headers = [
      "#",
      "Problem Statement",
      "Patient Goal",
      "Plan Intervention",
      "Target Completion",
      "Term",
      "Status",
      "Onset",
      "Source",
    ];
    table.rows = [[
      "1",
      "PT Balance Training - Patient needs supervision for safe transfers.",
      "Patient Goal: transfer safely with FWW and caregiver supervision.",
      "Skilled PT transfer training and caregiver safety instruction.",
      "",
      "",
      "",
      "",
      "",
    ]];

    const draft = buildPortalCarePlanDraftFromOasisDomState({ state: base });

    expect(draft?.carePlanProblemGroups?.[0]?.goals[0]?.text).toContain("transfer safely with FWW");
    expect(draft?.carePlanProblemGroups?.[0]?.interventions[0]?.text).toContain("caregiver safety instruction");
    expect(draft?.carePlanProblemGroups?.[0]?.needsHumanReview).toBe(false);
  });

  it("uses source-backed care plan goal fields when the table goal cell is blank", () => {
    const base = stateWithCarePlan();
    const section = base.sections[0]!;
    const table = section.tables[0]!;
    table.rows[0]![2] = "";
    section.fields = [{
      section: "New Identified Problem(s) Care Plan",
      label: "Care Plan Goal",
      key: "care_plan_problem_1_goal",
      value: "Improve TUG score to 12 seconds or better to improve fall safety.",
      sourceKind: "visibleText",
      confidence: "high",
      evidenceText: "Goal Improve TUG score to 12 seconds or better to improve fall safety.",
    }];

    const draft = buildPortalCarePlanDraftFromOasisDomState({ state: base });

    expect(draft?.carePlanProblemGroups?.[0]?.goals[0]?.text).toBe(
      "Improve TUG score to 12 seconds or better to improve fall safety.",
    );
    expect(draft?.carePlanProblemGroups?.[0]?.needsHumanReview).toBe(false);
  });

  it("turns print-preview care plan problem/goal/intervention sections into review draft groups", () => {
    const draft = buildPortalCarePlanDraftFromOasisDomState({ state: stateWithPrintPreviewCarePlanSections() });

    expect(draft?.sourcePriorityUsed).toBe("oasis_snapshot");
    expect(draft?.pocSource?.sourceHash).toBe("print-preview-sections");
    expect(draft?.carePlanProblemGroups).toHaveLength(2);
    expect(draft?.carePlanProblemGroups?.[0]?.problemTitle).toBe("PT Balance Training");
    expect(draft?.carePlanProblemGroups?.[0]?.goals[0]?.text).toContain("12 seconds");
    expect(draft?.carePlanProblemGroups?.[0]?.interventions[0]?.text).toContain("Standing balance");
    expect(draft?.carePlanProblemGroups?.[1]?.problemTitle).toBe("PT Transfer Training");
    expect(draft?.carePlanProblemGroups?.[1]?.goals[0]?.text).toContain("safely transfer");
    expect(draft?.carePlanProblemGroups?.[1]?.interventions[0]?.text).toContain("Bed scooting");
  });

  it("can read a latest eligible scoped OASIS artifact whose path requires Windows namespace support", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "portal-poc-long-path-"));
    const workItem = {
      id: "PATIENT_WITH_A_VERY_LONG_IDENTIFIER_FOR_WINDOWS_PATH_REGRESSION__1234567890abcdef1234567890abcdef",
      patientName: "Long Path Patient",
    };
    const patientDir = path.join(outputDir, "patients", workItem.id);
    const assessmentDir = path.join(
      patientDir,
      "oasis-assessments",
      "soc-05092026-oasis-oasis-e2-pt-start-of-care-with-extra-long-readable-slug",
    );

    try {
      await mkdir(assessmentDir, { recursive: true });
      await writeFile(
        path.toNamespacedPath(path.join(assessmentDir, "oasis-dom-extracted-state.json")),
        JSON.stringify(stateWithPrintPreviewCarePlanSections(), null, 2),
        "utf8",
      );
      await writeOasisManifest({
        patientDir,
        assessments: [{
          assessmentId: "soc-20260509",
          assessmentType: "SOC",
          date: "05/09/2026",
          artifactDirectory: assessmentDir,
        }],
      });

      const draftPath = await writePortalCarePlanDraftFromOasisDom({ outputDir, workItem: workItem as never });
      const draftRaw = await readFile(path.toNamespacedPath(draftPath ?? ""), "utf8");

      expect(draftRaw).toContain("PT Balance Training");
      expect(draftRaw).toContain("PT Transfer Training");
      expect(draftRaw).toContain("print-preview-sections");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("uses the latest SOC/ROC/RECERT OASIS care plan instead of current DC for the dashboard POC draft", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "portal-poc-latest-non-dc-"));
    const workItem = {
      id: "patient-1",
      patientName: "Test Patient",
    };
    const patientDir = path.join(outputDir, "patients", workItem.id);
    const socAssessmentDir = path.join(patientDir, "oasis-assessments", "soc-20260509");
    const recertAssessmentDir = path.join(patientDir, "oasis-assessments", "recert-20260601");
    const deathAtHomeAssessmentDir = path.join(patientDir, "oasis-assessments", "recert-death-at-home-20260610");

    try {
      const currentState = stateWithCarePlan();
      currentState.contentHash = "current-dc";
      currentState.sections[0]!.tables[0]!.rows[0]![1] =
        "Current DC POC - Discharge-only care plan should not feed visit-note alignment.";
      const socState = stateWithCarePlan();
      socState.contentHash = "soc-oasis";
      socState.sections[0]!.tables[0]!.rows[0]![1] =
        "SOC OASIS POC - Historical start of care plan.";
      const recertState = stateWithCarePlan();
      recertState.contentHash = "latest-recert-oasis";
      recertState.sections[0]!.tables[0]!.rows[0]![1] =
        "Latest RECERT OASIS POC - Active care plan for visit-note alignment.";
      const deathAtHomeState = stateWithCarePlan();
      deathAtHomeState.contentHash = "death-at-home";
      deathAtHomeState.sections[0]!.tables[0]!.rows[0]![1] =
        "Death at Home POC - terminal/discharge assessment should not feed visit-note alignment.";

      await mkdir(patientDir, { recursive: true });
      await mkdir(socAssessmentDir, { recursive: true });
      await mkdir(recertAssessmentDir, { recursive: true });
      await mkdir(deathAtHomeAssessmentDir, { recursive: true });
      await writeFile(
        path.join(patientDir, "oasis-dom-extracted-state.json"),
        JSON.stringify(currentState, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(socAssessmentDir, "oasis-dom-extracted-state.json"),
        JSON.stringify(socState, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(recertAssessmentDir, "oasis-dom-extracted-state.json"),
        JSON.stringify(recertState, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(deathAtHomeAssessmentDir, "oasis-dom-extracted-state.json"),
        JSON.stringify(deathAtHomeState, null, 2),
        "utf8",
      );
      await writeOasisManifest({
        patientDir,
        assessments: [
          {
            assessmentId: "dc-20260610",
            assessmentType: "DC",
            date: "06/10/2026",
            artifactDirectory: patientDir,
            isCurrent: true,
            processingStatus: "processed_root_current",
          },
          {
            assessmentId: "soc-20260509",
            assessmentType: "SOC",
            date: "05/09/2026",
            artifactDirectory: socAssessmentDir,
          },
          {
            assessmentId: "recert-20260601",
            assessmentType: "RECERT",
            date: "06/01/2026",
            artifactDirectory: recertAssessmentDir,
          },
          {
            assessmentId: "death-at-home-20260610",
            assessmentType: "RECERT",
            title: "OASIS E1 - DEATH AT HOME (2026)",
            date: "06/10/2026",
            artifactDirectory: deathAtHomeAssessmentDir,
          },
        ],
      });

      const draftPath = await writePortalCarePlanDraftFromOasisDom({ outputDir, workItem: workItem as never });
      const draftRaw = await readFile(draftPath ?? "", "utf8");

      expect(draftRaw).toContain("Latest RECERT OASIS POC");
      expect(draftRaw).not.toContain("Current DC POC");
      expect(draftRaw).not.toContain("Death at Home POC");
      expect(draftRaw).not.toContain("SOC OASIS POC");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("keeps previous portal POC as Needs Review when latest DOM no longer has usable rows", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "portal-poc-disappeared-"));
    const workItem = {
      id: "patient-1",
      patientName: "Test Patient",
    };
    const patientDir = path.join(outputDir, "patients", workItem.id);
    await mkdir(patientDir, { recursive: true });
    await writeOasisManifest({
      patientDir,
      assessments: [{
        assessmentId: "soc-20260509",
        assessmentType: "SOC",
        date: "05/09/2026",
        artifactDirectory: patientDir,
        isCurrent: true,
        processingStatus: "processed_root_current",
      }],
    });
    await writeFile(
      path.join(patientDir, "oasis-dom-extracted-state.json"),
      JSON.stringify(stateWithCarePlan(), null, 2),
      "utf8",
    );
    const firstPath = await writePortalCarePlanDraftFromOasisDom({ outputDir, workItem: workItem as never });
    expect(firstPath).toBeTruthy();

    await writeFile(
      path.join(patientDir, "oasis-dom-extracted-state.json"),
      JSON.stringify({ ...stateWithCarePlan(), sections: [], contentHash: "missing" }, null, 2),
      "utf8",
    );
    const preservedPath = await writePortalCarePlanDraftFromOasisDom({ outputDir, workItem: workItem as never });
    const preserved = JSON.parse(await readFile(preservedPath ?? "", "utf8"));

    expect(preserved?.pocSource?.sourceType).toBe("oasis_portal");
    expect(preserved?.carePlanProblemGroups?.[0]?.needsHumanReview).toBe(true);
    expect(preserved?.warnings.join(" ")).toContain("Previously captured OASIS Plan of Care");
  });
});
