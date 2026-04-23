import { describe, expect, it } from "vitest";
import {
  looksLikeOasisThirtyDaysLabel,
  scoreOasisThirtyDaysControl,
} from "../portal/pages/FinaleDashboardPage";
import {
  looksLikeExcelExportLabel,
  scoreExcelExportControl,
} from "../portal/pages/OasisThirtyDaysPage";

describe("workbook export control detection", () => {
  it("detects the OASIS 30 Day's tab label with portal punctuation variants", () => {
    expect(looksLikeOasisThirtyDaysLabel("OASIS 30 Day's")).toBe(true);
    expect(looksLikeOasisThirtyDaysLabel("OASIS 30 Days")).toBe(true);
    expect(scoreOasisThirtyDaysControl("OASIS 30 Day's")).toBeGreaterThan(
      scoreOasisThirtyDaysControl("Search Patient"),
    );
  });

  it("detects the Excel export action even when presented in a menu", () => {
    expect(looksLikeExcelExportLabel("Export to Excel")).toBe(true);
    expect(looksLikeExcelExportLabel("Excel")).toBe(true);
    expect(looksLikeExcelExportLabel("Export All")).toBe(true);
    expect(scoreExcelExportControl("Export All")).toBeGreaterThan(
      scoreExcelExportControl("Export to Excel"),
    );
    expect(scoreExcelExportControl("Export to Excel")).toBeGreaterThan(
      scoreExcelExportControl("Refresh"),
    );
  });
});
