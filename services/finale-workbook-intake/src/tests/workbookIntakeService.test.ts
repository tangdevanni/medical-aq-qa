import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { intakeWorkbook } from "../services/workbookIntakeService";

function writeWorkbookFixture(rows: {
  socRows?: Array<Array<string | null>>;
  visitRows?: Array<Array<string | null>>;
}): { workbookPath: string; outputDir: string; cleanup: () => void } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-intake-"));
  const workbookPath = path.join(tempDir, "fixture.xlsx");
  const outputDir = path.join(tempDir, "output");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 Days Tracking", "CODING", "OASIS QA REMARKS", "POC QA REMARKS"],
      ...(rows.socRows ?? []),
    ]),
    "OASIS SOC-ROC-REC & POC",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["PATIENT NAME", "Medicare No.", "PAYER", "SOC Date", "episode period", "billing period", "status", "OASIS QA", "OASIS STATUS", "QA", "SN", "PT/OT/ST", "HHA/MSW", "BILLING STATUS"],
      ...(rows.visitRows ?? []),
    ]),
    "VISIT NOTES",
  );

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DIZ"]]), "DIZ");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DC"]]), "OASIS DC-TXR-DEATH");
  XLSX.writeFile(workbook, workbookPath);

  return {
    workbookPath,
    outputDir,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe("intakeWorkbook", () => {
  it("creates parser exceptions for rows with missing patient identity instead of junk work items", async () => {
    const fixture = writeWorkbookFixture({
      socRows: [
        [null, "03/01/2026", "Alice", "Medicare", "SOC", "5", "QA done", "Locked", "Exported"],
      ],
    });

    try {
      const result = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      expect(result.workItems).toHaveLength(0);
      expect(result.parserExceptions.some((exception) => exception.code === "MISSING_PATIENT_NAME")).toBe(true);
      expect(result.manifest.totalWorkItems).toBe(0);
      expect(result.manifest.parserExceptionCount).toBeGreaterThanOrEqual(1);
      expect(existsSync(result.normalizedPatientsPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("creates parser exceptions when the same normalized patient episode conflicts on identity", async () => {
    const fixture = writeWorkbookFixture({
      socRows: [
        ["DOE, JANE", "03/01/2026", "Alice", "Medicare", "SOC", "5", "QA done", "Locked", "Exported"],
      ],
      visitRows: [
        ["Jane Doe", "9988", "Aetna", "03/01/2026", "03/01/2026 - 04/29/2026", "03/01/2026 - 03/31/2026", "Done and Reviewed", "Locked", "Locked", "Done and Reviewed", "Done and Reviewed", "", "", "Exported"],
      ],
    });

    try {
      const result = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      expect(result.workItems).toHaveLength(1);
      expect(result.parserExceptions.some((exception) => exception.code === "AMBIGUOUS_PATIENT_IDENTITY")).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("normalizes patients from the single-sheet Oasis tracking report format", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-intake-tracking-"));
    const workbookPath = path.join(tempDir, "tracking-report.xlsx");
    const outputDir = path.join(tempDir, "output");
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [null, null, null, null, null],
        ["Star Home Health Care Inc", null, null, null, "OASIS TRACKING REPORT"],
        ["Patient Name (MR#)", "SOC Date", "Episode Date", "Status", "RFA", "Assigned Staff", "Payer", "Completed Date", "30 Days Tracking"],
        ["Document: 30 Days Tracking", null, null, null, null, null, null, null, null],
        ["YELSH, WILLIAM", "03/31/2026", "03/31/2026 - 05/29/2026", "In Progress", "01-SOC", "Lara, Toni RN", "Medicare", "03/31/2026", "30"],
      ]),
      "OASIS Tracking Report",
    );
    XLSX.writeFile(workbook, workbookPath);

    try {
      const result = await intakeWorkbook({
        workbookPath,
        outputDir,
      });

      expect(result.workItems).toHaveLength(1);
      expect(result.workItems[0]?.patientIdentity.displayName).toBe("William Yelsh");
      expect(result.workItems[0]?.subsidiaryId).toBe("default");
      expect(result.manifest.subsidiaryId).toBe("default");
      expect(result.workItems[0]?.episodeContext.episodeDate).toBe("2026-03-31");
      expect(result.workItems[0]?.timingMetadata?.daysLeftBeforeOasisDueDate).toBe(30);
      expect(result.workItems[0]?.timingMetadata?.rawTrackingValues).toEqual(["30"]);
      expect(result.workItems[0]?.codingReviewStatus).toBe("IN_PROGRESS");
      expect(result.parserExceptions).toHaveLength(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
