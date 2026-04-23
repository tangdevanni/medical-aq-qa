import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { verifyWorkbookFile } from "../services/workbookVerificationService";

function createWorkbookFile(input: {
  sheetName: string;
  rows: Array<Array<string>>;
}): { filePath: string; cleanup: () => void } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "workbook-verification-"));
  const filePath = path.join(directory, "finale-export.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(input.rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, input.sheetName);
  XLSX.writeFile(workbook, filePath);

  return {
    filePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

describe("verifyWorkbookFile", () => {
  it("accepts a Finale workbook export with recognized QA sheets", async () => {
    const fixture = createWorkbookFile({
      sheetName: "OASIS Tracking Report",
      rows: [
        [
          "PATIENT NAME (MR#)",
          "SOC DATE",
          "ASSIGNED STAFF",
          "PAYER",
          "RFA",
          "30 DAYS TRACKING",
          "STATUS",
          "COMPLETED DATE",
        ],
        [
          "Christine Young (MR123)",
          "02/23/2026",
          "QA Nurse",
          "Medicare",
          "SOC",
          "5",
          "Ready",
          "02/24/2026",
        ],
      ],
    });

    try {
      const result = await verifyWorkbookFile({
        workbookPath: fixture.filePath,
      });

      expect(result.usable).toBe(true);
      expect(result.sheetNames).toContain("OASIS Tracking Report");
      expect(result.detectedSourceTypes).toContain("trackingReport");
      expect(result.fileSizeBytes).toBeGreaterThan(1_024);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects workbook exports that do not contain recognized QA sheets", async () => {
    const fixture = createWorkbookFile({
      sheetName: "Sheet1",
      rows: [
        ["Hello", "World"],
        ["foo", "bar"],
      ],
    });

    try {
      await expect(
        verifyWorkbookFile({
          workbookPath: fixture.filePath,
        }),
      ).rejects.toThrow(/recognized QA worksheets/i);
    } finally {
      fixture.cleanup();
    }
  });
});
