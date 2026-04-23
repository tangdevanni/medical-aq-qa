import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runOasisDemoHarness } from "../testing/oasisDemoHarness";

describe("oasis demo harness", () => {
  it("produces a demo-ready read-only OASIS QA run with evidence-backed output", async () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "oasis-demo-"));

    try {
      const result = await runOasisDemoHarness({ outputDir });

      expect(result.liveMode).toBe(false);
      expect(result.demoSummary.safety.safetyMode).toBe("READ_ONLY");
      expect(result.demoSummary.safety.dangerousWriteAttemptBlocked).toBe(true);
      expect(result.demoSummary.safety.writeExecutorUsed).toBe(false);
      expect(result.demoSummary.safety.workflowExecutorUsed).toBe(false);
      expect(result.workbookPath.endsWith("finale-export.xlsx")).toBe(true);
      expect(result.availablePatientCount).toBeGreaterThan(0);
      expect(result.eligiblePatientCount).toBeGreaterThan(0);
      expect(result.selectedPatientCount).toBe(1);
      expect(result.selectionReason.length).toBeGreaterThan(0);
      expect(result.parserExceptionCount).toBe(0);
      expect(result.patientRun.automationStepLogs.length).toBeGreaterThan(0);
      expect(result.patientRun.oasisQaSummary.overallStatus).toBe("IN_PROGRESS");
      expect(result.patientRun.oasisQaSummary.blockers.length).toBeGreaterThan(0);
      expect(result.demoSummary.portal.loginStatus).toBe("SUCCESS");
      expect(result.demoSummary.portal.chartOpened).toBe(true);
      expect(result.patientRun.automationStepLogs.map((log) => log.step)).toEqual(
        expect.arrayContaining([
          "login",
          "patient_search",
          "chart_open",
          "shared_evidence_discovery_start",
          "shared_evidence_discovery_complete",
          "oasis_episode_resolution",
          "billing_calendar_summary_persisted",
          "oasis_menu_open",
          "oasis_assessment_note_opened",
          "oasis_print_capture",
          "oasis_printed_note_review",
        ]),
      );
      expect(Array.isArray(result.patientRun.oasisQaSummary.blockers)).toBe(true);
      for (const section of result.patientRun.oasisQaSummary.sections) {
        expect(section.key.length).toBeGreaterThan(0);
        expect(section.status.length).toBeGreaterThan(0);
      }
      expect(existsSync(result.demoSummaryJsonPath)).toBe(true);
      expect(existsSync(result.demoSummaryMarkdownPath)).toBe(true);
      expect(result.demoSummary.evidenceFiles.every((filePath) => existsSync(filePath))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 20_000);
});
