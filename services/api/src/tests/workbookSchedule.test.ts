import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateNextWeekdayDeltaRunAt,
  calculateNextWorkbookIntakeAt,
} from "../utils/workbookSchedule";

describe("workbook scheduler calculations", () => {
  it("schedules Sunday workbook intake at the configured Manila local time", () => {
    assert.equal(
      calculateNextWorkbookIntakeAt({
        fromIsoTimestamp: "2026-06-12T20:00:00.000Z",
        timezone: "Asia/Manila",
        weekday: "Sunday",
        localTime: "20:30",
      }),
      "2026-06-14T12:30:00.000Z",
    );
  });

  it("schedules weekday delta runs Monday through Friday only", () => {
    assert.equal(
      calculateNextWeekdayDeltaRunAt({
        fromIsoTimestamp: "2026-06-12T20:00:00.000Z",
        timezone: "Asia/Manila",
        weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        localTimes: ["20:30"],
        intervalHours: 24,
      }),
      "2026-06-15T12:30:00.000Z",
    );
  });

  it("does not create a separate Sunday delta run", () => {
    assert.notEqual(
      calculateNextWeekdayDeltaRunAt({
        fromIsoTimestamp: "2026-06-13T20:00:00.000Z",
        timezone: "Asia/Manila",
        weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        localTimes: ["20:30"],
        intervalHours: 24,
      }),
      "2026-06-14T12:30:00.000Z",
    );
  });
});
