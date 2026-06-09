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

  it("uses the root current OASIS care plan for the dashboard POC draft when older scoped OASIS artifacts exist", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "portal-poc-current-"));
    const workItem = {
      id: "patient-1",
      patientName: "Test Patient",
    };
    const patientDir = path.join(outputDir, "patients", workItem.id);
    const olderAssessmentDir = path.join(patientDir, "oasis-assessments", "older-recert");

    try {
      const currentState = stateWithCarePlan();
      currentState.contentHash = "current-oasis";
      currentState.sections[0]!.tables[0]!.rows[0]![1] =
        "Latest OASIS POC - Skilled nursing wound care is active for the current OASIS.";
      const olderState = stateWithCarePlan();
      olderState.contentHash = "older-oasis";
      olderState.sections[0]!.tables[0]!.rows[0]![1] =
        "Older OASIS POC - Historical care plan from a previous OASIS.";

      await mkdir(patientDir, { recursive: true });
      await mkdir(olderAssessmentDir, { recursive: true });
      await writeFile(
        path.join(patientDir, "oasis-dom-extracted-state.json"),
        JSON.stringify(currentState, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(olderAssessmentDir, "oasis-dom-extracted-state.json"),
        JSON.stringify(olderState, null, 2),
        "utf8",
      );

      const draftPath = await writePortalCarePlanDraftFromOasisDom({ outputDir, workItem: workItem as never });
      const draftRaw = await readFile(draftPath ?? "", "utf8");

      expect(draftRaw).toContain("Latest OASIS POC");
      expect(draftRaw).not.toContain("Older OASIS POC");
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
