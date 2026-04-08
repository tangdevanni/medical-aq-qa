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
      expect(result.patientRun.oasisQaSummary.overallStatus).toBe("BLOCKED");
      expect(result.patientRun.oasisQaSummary.blockers.length).toBeGreaterThan(0);
      expect(result.demoSummary.portal.loginStatus).toBe("SUCCESS");
      expect(result.demoSummary.portal.chartOpened).toBe(true);
      const stepNames = result.patientRun.automationStepLogs.map((log) => log.step);
      const finalQaSummaryLog = result.patientRun.automationStepLogs.filter((log) => log.step === "qa_summary").at(-1);
      const expectedQaSummarySignals = new Set(
        result.patientRun.oasisQaSummary.sections.map((section) => `${section.key}:${section.status}`),
      );
      expect(result.patientRun.automationStepLogs.map((log) => log.step)).toEqual(
        expect.arrayContaining([
          "login",
          "patient_search",
          "chart_open",
          "document_discovery",
          "document_extraction",
          "admission_document_extract",
          "oasis_extract",
          "poc_extract",
          "visit_note_extract",
          "technical_review_extract",
          "diagnosis_code_extract",
          "coding_input_export",
          "qa_summary",
        ]),
      );
      expect(stepNames).not.toContain("oasis_menu");
      expect(finalQaSummaryLog).toBeDefined();
      expect(new Set(finalQaSummaryLog?.found ?? [])).toEqual(expectedQaSummarySignals);
      expect(new Set(finalQaSummaryLog?.missing ?? [])).toEqual(new Set(result.patientRun.oasisQaSummary.blockers));
      expect(existsSync(result.demoSummaryJsonPath)).toBe(true);
      expect(existsSync(result.demoSummaryMarkdownPath)).toBe(true);
      expect(result.demoSummary.evidenceFiles.every((filePath) => existsSync(filePath))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 20_000);
});
