import { describe, expect, it } from "vitest";
import {
  buildVisitNotesDiscoveryArtifactForTest,
  VISIT_NOTES_CHILD_NAV_SELECTORS,
  VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS,
  VISIT_NOTES_DISCOVERY_CELL_SELECTOR,
  VISIT_NOTES_DISCOVERY_LINK_SELECTOR,
  VISIT_NOTES_DISCOVERY_ROW_SELECTOR,
  VISIT_NOTES_MENU_SELECTORS,
  VISIT_NOTES_PAGE_SELECTOR,
  VISIT_NOTES_TABLE_LOAD_SELECTOR,
  VISIT_NOTES_VISIT_LINK_SELECTOR,
} from "../portal/services/visitNotesDiscoveryService";

describe("visit notes discovery artifact", () => {
  it("counts visit notes by normalized visit type and status", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        {
          rawDocumentType: "Visit Note-PTA",
          visitDate: "05/01/2026",
          assignedStaffRaw: "A Therapist, PTA",
          statusRaw: "QA Completed",
          rowText: "Visit Note-PTA 05/01/2026 A Therapist QA Completed",
        },
        {
          rawDocumentType: "Visit Note-RN Regular Visit - Direct Care",
          visitDate: "05/02/2026",
          assignedStaffRaw: "B Nurse, RN",
          statusRaw: "ESigned",
          rowText: "Visit Note-RN Regular Visit - Direct Care 05/02/2026 B Nurse ESigned",
        },
        {
          rawDocumentType: "Visit Note-Admin Pay $20",
          visitDate: "05/03/2026",
          statusRaw: "Not Started",
          rowText: "Visit Note-Admin Pay $20 05/03/2026 Not Started",
        },
      ],
      generatedAt: "2026-05-07T00:00:00.000Z",
    });

    expect(artifact.counts.total).toBe(3);
    expect(artifact.counts.byVisitType.physical_therapy).toBe(1);
    expect(artifact.counts.byVisitType.skilled_nursing).toBe(1);
    expect(artifact.counts.byVisitType.others).toBe(1);
    expect(artifact.counts.byStatus.qa_completed).toBe(1);
    expect(artifact.counts.byStatus.e_signed).toBe(1);
    expect(artifact.counts.byStatus.not_started).toBe(1);
    expect(artifact.rows[0]?.hasSafeOpenAction).toBe(false);
    expect(artifact.rows[0]?.captureEligibility).toBe("finalized_no_active_monitoring");
    expect(artifact.rows[1]?.captureEligibility).toBe("active_monitoring");
    expect(artifact.rows[2]?.captureEligibility).toBe("ineligible");
  });

  it("deduplicates rows by portal document id and preserves stable row hashes", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { portalDocumentId: "note-1", rawDocumentType: "Visit Note-PT", rowText: "Visit Note-PT note-1" },
        { portalDocumentId: "note-1", rawDocumentType: "Visit Note-PT", rowText: "Visit Note-PT note-1 duplicate" },
        { portalDocumentId: "note-2", rawDocumentType: "Visit Note-PT", rowText: "Visit Note-PT note-2" },
      ],
    });

    expect(artifact.rows).toHaveLength(2);
    expect(artifact.rows[0]?.rowTextHash).toHaveLength(64);
    expect(artifact.rows.map((row) => row.rowIndex)).toEqual([0, 1]);
  });

  it("rejects provider-wide discovery with a warning and no rows", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [{ rawDocumentType: "Visit Note-RN Regular Visit", rowText: "Visit Note-RN Regular Visit" }],
      warnings: ["Rejected provider-wide Documents route; patient-level Visit Notes route was not confirmed."],
    });

    expect(artifact.rows).toEqual([]);
    expect(artifact.warnings[0]).toContain("provider-wide");
  });

  it("includes Finale table DOM selectors used by the current Visit Notes grid", () => {
    expect(VISIT_NOTES_PAGE_SELECTOR).toBe("section.visitview");
    expect(VISIT_NOTES_DISCOVERY_ROW_SELECTOR).toContain("tr.fin-data-table__tr");
    expect(VISIT_NOTES_DISCOVERY_ROW_SELECTOR).toContain("section.visitview tr.fin-data-table__tr");
    expect(VISIT_NOTES_DISCOVERY_CELL_SELECTOR).toContain("td.fin-data-table__td");
    expect(VISIT_NOTES_DISCOVERY_LINK_SELECTOR).toContain("a.tbl-link");
    expect(VISIT_NOTES_DISCOVERY_LINK_SELECTOR).toContain("a.tb-link");
    expect(VISIT_NOTES_VISIT_LINK_SELECTOR).toContain("section.visitview a.tbl-link:has-text('Visit Note')");
    expect(VISIT_NOTES_TABLE_LOAD_SELECTOR).toContain("section.visitview");
    expect(VISIT_NOTES_TABLE_LOAD_SELECTOR).toContain("a.tbl-link:has-text('Visit Note')");
  });

  it("includes the current Finale sidebar Visit Notes expandable group selectors", () => {
    expect(VISIT_NOTES_MENU_SELECTORS[0]).toBe("li.notes-sub-menu #documents span:has-text(\"Visit Notes\")");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("li.note-sub-menu #documents span:has-text(\"Visit Notes\")");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("li.notes-sub-menu.active #documents:has-text(\"Visit Notes\")");
    expect(VISIT_NOTES_MENU_SELECTORS[0]).toContain(":has-text(\"Visit Notes\")");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("fin-sidebar-menu.notes-sub-menu div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("fin-sidebar-menu.notes-sub-menu div.flex.gap-2#documents:has-text(\"Visit Notes\")");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("fin-sidebar-menu.notes-sub-menu li.note-sub-menu div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("fin-sidebar-menu.notes-sub-menu li.note-sub-menu:has(div.flex.gap-2#documents):has-text(\"Visit Notes\")");
    expect(VISIT_NOTES_MENU_SELECTORS).toContain("div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))");
    expect(VISIT_NOTES_MENU_SELECTORS.some((selector) => selector.includes("ft-plus-square"))).toBe(true);
    expect(VISIT_NOTES_MENU_SELECTORS.every((selector) => selector !== "#documents")).toBe(true);
    expect(VISIT_NOTES_CHILD_NAV_SELECTORS).toContain("a[href*='visit-notes']");
  });

  it("does not use provider-wide Documents as a Visit Notes parent-menu fallback", () => {
    expect(VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS.length).toBeGreaterThan(0);
    expect(VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS).toContain("fin-sidebar-menu span:text-is('Documentations')");
    expect(VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS.every((selector) => selector.includes("fin-sidebar"))).toBe(true);
    expect(VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS.some((selector) => /Documents['")]/.test(selector))).toBe(false);
    expect(VISIT_NOTES_DOCUMENTATION_MENU_SELECTORS).not.toContain("span:has-text('Documents')");
  });

  it("treats tb-link visit note labels as safe openable clinical notes", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        {
          rawDocumentType: "Visit Note-PTA",
          visitDate: "05/04/2026",
          statusRaw: "In Progress",
          rowText: "Visit Note-PTA 05/04/2026 In Progress",
          sourceUrl: "/provider/1/client/2/documents/visit-note-pta",
          hasSafeOpenAction: true,
          actionHints: ["link:Visit Note-PTA"],
        },
      ],
    });

    expect(artifact.rows).toHaveLength(1);
    expect(artifact.rows[0]?.rawDocumentType).toBe("Visit Note-PTA");
    expect(artifact.rows[0]?.hasSafeOpenAction).toBe(true);
    expect(artifact.rows[0]?.captureEligibility).toBe("active_monitoring");
  });

  it("treats tbl-link visit note labels as safe openable clinical notes", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        {
          rawDocumentType: "Visit Note-PTA",
          visitDate: "05/04/2026",
          statusRaw: "Submitted",
          rowText: "Visit Note-PTA 05/04/2026 Submitted",
          sourceUrl: "/provider/1/client/2/documentations/visit-note-pta",
          hasSafeOpenAction: true,
          actionHints: ["link:Visit Note-PTA"],
        },
      ],
    });

    expect(artifact.rows).toHaveLength(1);
    expect(artifact.rows[0]?.rawDocumentType).toBe("Visit Note-PTA");
    expect(artifact.rows[0]?.captureEligibility).toBe("active_monitoring");
  });

  it("keeps sidebar navigation failure distinct from an empty Visit Notes table", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [],
      warnings: ["sidebar_menu_not_found: Visit Notes sidebar/menu item was not found from the patient chart."],
    });

    expect(artifact.rows).toEqual([]);
    expect(artifact.warnings).toContain("sidebar_menu_not_found: Visit Notes sidebar/menu item was not found from the patient chart.");
    expect(artifact.warnings.some((warning) => warning.startsWith("no_eligible_notes"))).toBe(false);
  });

  it("marks an empty loaded Visit Notes table as no eligible notes", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [],
      warnings: [],
    });

    expect(artifact.rows).toEqual([]);
    expect(artifact.warnings.some((warning) => warning.startsWith("no_eligible_notes"))).toBe(true);
  });

  it("preserves compact navigation diagnostics in the discovery artifact", () => {
    const artifact = buildVisitNotesDiscoveryArtifactForTest({
      rows: [],
      warnings: ["table_not_detected_after_navigation: Visit Notes menu was clicked but no patient-level Visit Notes table was detected."],
      diagnostics: {
        beforeUrl: "https://app.finalehealth.com/provider/<provider-id>/client/<client-id>/calendar",
        afterUrl: "https://app.finalehealth.com/provider/<provider-id>/client/<client-id>/calendar",
        sidebarSelectorUsed: "fin-sidebar-menu.notes-sub-menu div.flex.gap-2#documents:has(span:text-is(\"Visit Notes\"))",
        sidebarMenuFound: true,
        sidebarMenuClicked: true,
        sectionVisitviewCount: 0,
        tableRowCount: 0,
        tblLinkCount: 0,
        tbLinkCount: 0,
        firstRowTexts: [],
      },
    });

    expect(artifact.diagnostics?.sidebarMenuFound).toBe(true);
    expect(artifact.diagnostics?.sectionVisitviewCount).toBe(0);
    expect(artifact.warnings.some((warning) => warning.startsWith("no_eligible_notes"))).toBe(false);
  });
});
