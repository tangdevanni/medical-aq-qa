import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "../parsers/workbookParser";

function writeWorkbookFixture(): { workbookPath: string; cleanup: () => void } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-parser-"));
  const workbookPath = path.join(tempDir, "fixture.xlsx");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Finale Export"],
      ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 Days Tracking", "CODING", "OASIS QA REMARKS", "POC QA REMARKS"],
      ["DOE, JANE", "03/01/2026", "Alice", "Medicare", "SOC", "5", "QA done", "Locked", "Exported"],
      [null, null, null, null, null, null, null, null, null],
      ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 Days Tracking", "CODING", "OASIS QA REMARKS", "POC QA REMARKS"],
      ["SMITH, JOHN", "03/10/2026", "Bob", "Aetna", "ROC", "-1", "Pending", "Issues", ""],
    ]),
    "OASIS SOC-ROC-REC & POC",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Operations"],
      ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 DAYS TRACKING", "OASIS QA REMARKS", "DC SUMMARY"],
      ["DOE, JANE", "03/01/2026", "Alice", "Medicare", "DC", "4", "Locked", "Done and Reviewed"],
    ]),
    "OASIS DC-TXR-DEATH",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["VISIT NOTES"],
      ["PATIENT NAME", "Medicare No.", "PAYER", "SOC Date", "episode period", "billing period", "status", "OASIS QA", "OASIS STATUS", "QA", "SN", "PT/OT/ST", "HHA/MSW", "BILLING STATUS"],
      ["Jane Doe", "12345", "Medicare", "03/01/2026", "03/01/2026 - 04/29/2026", "03/01/2026 - 03/31/2026", "In progress", "Locked", "QA done", "Working", "Done and Reviewed", "", "", "Exported"],
    ]),
    "VISIT NOTES",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["DIZ"],
      ["PATIENT NAME", "episode date / billing period", "clinician", "QA specialist", "SN", "REHAB", "HHA and MSW", "PO and Order", "STATUS"],
      ["Jane Doe", "03/01/2026 - 03/31/2026", "Clinician A", "QA Lead", "Done and Reviewed", "Locked", "", "Exported", "Done and Reviewed"],
    ]),
    "DIZ",
  );

  XLSX.writeFile(workbook, workbookPath);

  return {
    workbookPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe("parseWorkbook", () => {
  it("skips title rows and repeated headers while parsing each sheet", () => {
    const fixture = writeWorkbookFixture();

    try {
      const result = parseWorkbook(fixture.workbookPath);

      expect(result.socPocRows).toHaveLength(2);
      expect(result.socPocRows[0]?.patientName).toBe("DOE, JANE");
      expect(result.socPocRows[1]?.trackingDays).toBe("-1");

      expect(result.dcRows).toHaveLength(1);
      expect(result.dcRows[0]?.dcSummary).toBe("Done and Reviewed");

      expect(result.visitNotesRows).toHaveLength(1);
      expect(result.visitNotesRows[0]?.billingStatus).toBe("Exported");

      expect(result.dizRows).toHaveLength(1);
      expect(result.dizRows[0]?.qaSpecialist).toBe("QA Lead");
    } finally {
      fixture.cleanup();
    }
  });

  it("parses the single-sheet Oasis tracking report format", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-parser-tracking-"));
    const workbookPath = path.join(tempDir, "tracking-report.xlsx");
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
      const result = parseWorkbook(workbookPath);

      expect(result.sheetNames).toEqual(["OASIS Tracking Report"]);
      expect(result.warnings).toHaveLength(0);
      expect(result.diagnostics.sourceDetections.find((sheet) => sheet.sourceType === "trackingReport")?.detectedSheetName).toBe("OASIS Tracking Report");
      expect(result.socPocRows).toHaveLength(1);
      expect(result.socPocRows[0]?.patientName).toBe("YELSH, WILLIAM");
      expect(result.socPocRows[0]?.episodeDate).toBe("03/31/2026");
      expect(result.socPocRows[0]?.coding).toBe("In Progress");
      expect(result.diagnostics.sheetSummaries.find((sheet) => sheet.sheetName === "OASIS Tracking Report")?.excludedRows).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects workbook sheets by header signature even when the tab names change", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-parser-renamed-"));
    const workbookPath = path.join(tempDir, "renamed-tabs.xlsx");
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Upload"],
        ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 Days Tracking", "CODING", "OASIS QA REMARKS", "POC QA REMARKS"],
        ["DOE, JANE", "03/01/2026", "Alice", "Medicare", "SOC", "5", "QA done", "Locked", "Exported"],
      ]),
      "Upload 1",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Ops"],
        ["PATIENT NAME", "Medicare No.", "PAYER", "SOC Date", "episode period", "billing period", "status", "OASIS QA", "OASIS STATUS", "QA", "SN", "PT/OT/ST", "HHA/MSW", "BILLING STATUS"],
        ["Jane Doe", "12345", "Medicare", "03/01/2026", "03/01/2026 - 04/29/2026", "03/01/2026 - 03/31/2026", "In progress", "Locked", "QA done", "Working", "Done and Reviewed", "", "", "Exported"],
      ]),
      "Ops Export",
    );

    XLSX.writeFile(workbook, workbookPath);

    try {
      const result = parseWorkbook(workbookPath);

      expect(result.socPocRows).toHaveLength(1);
      expect(result.visitNotesRows).toHaveLength(1);
      expect(result.diagnostics.sourceDetections.find((sheet) => sheet.sourceType === "socPoc")?.detectedSheetName).toBe("Upload 1");
      expect(result.diagnostics.sourceDetections.find((sheet) => sheet.sourceType === "visitNotes")?.detectedSheetName).toBe("Ops Export");
      expect(result.warnings).toContain("Missing expected worksheet content for dc.");
      expect(result.warnings).toContain("Missing expected worksheet content for diz.");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
