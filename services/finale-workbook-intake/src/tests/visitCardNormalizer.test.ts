import { describe, expect, it } from "vitest";
import { classifyCalendarEventType, normalizeCalendarCard } from "../oasis/calendar/visitCardNormalizer";

describe("visitCardNormalizer", () => {
  it("normalizes common visit and note card labels into controlled event types", () => {
    expect(classifyCalendarEventType("OASIS")).toBe("oasis");
    expect(classifyCalendarEventType("PT Visit")).toBe("pt_visit");
    expect(classifyCalendarEventType("SN Visit")).toBe("sn_visit");
    expect(classifyCalendarEventType("HHA Visit")).toBe("hha_visit");
    expect(classifyCalendarEventType("MSW Visit")).toBe("msw_visit");
    expect(classifyCalendarEventType("Phys. Order")).toBe("physician_order");
    expect(classifyCalendarEventType("CN")).toBe("communication_note");
    expect(classifyCalendarEventType("Transfer")).toBe("transfer");
    expect(classifyCalendarEventType("Missed Visit")).toBe("missed_visit");
  });

  it("falls back to other for ambiguous freeform labels", () => {
    expect(classifyCalendarEventType("Unmapped freeform event")).toBe("other");
  });

  it("extracts time, clinician, and status signals when present", () => {
    const card = normalizeCalendarCard({
      rawText: "SN Visit 9:00 AM Smith, J RN Completed",
      date: "2026-03-15",
      billingPeriod: "first30",
    });

    expect(card.eventType).toBe("sn_visit");
    expect(card.timeLabel).toBe("9:00 AM");
    expect(card.clinician).toBe("Smith, J RN");
    expect(card.statusLabel).toBe("Completed");
  });

  it("normalizes dashboard calendar cards with clinician, validated status, and time ranges", () => {
    const card = normalizeCalendarCard({
      rawText: "Lara, T. RN Validated RN Regular Visit - Direct Care 08:00 - 09:00",
      title: "Lara, T. RN",
      date: "2026-03-14",
      billingPeriod: "first30",
    });

    expect(card.eventType).toBe("sn_visit");
    expect(card.title).toBe("Lara, T. RN");
    expect(card.clinician).toBe("Lara, T. RN");
    expect(card.statusLabel).toBe("Validated");
    expect(card.timeLabel).toBe("08:00 - 09:00");
  });
});
