import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWorkbookRotationDue } from "../utils/workbookRotation";

describe("isWorkbookRotationDue", () => {
  it("returns false when the workbook is still inside the 15-day review window", () => {
    assert.equal(
      isWorkbookRotationDue("2026-04-01T00:00:00.000Z", "2026-04-14T23:59:59.000Z"),
      false,
    );
  });

  it("returns true when the workbook has crossed the 15-day rotation threshold", () => {
    assert.equal(
      isWorkbookRotationDue("2026-04-01T00:00:00.000Z", "2026-04-16T00:00:00.000Z"),
      true,
    );
  });
});
