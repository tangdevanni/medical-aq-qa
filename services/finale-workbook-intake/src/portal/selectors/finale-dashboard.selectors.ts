import type { PortalSelectorCandidate } from "./types";

export const finaleDashboardSelectors: {
  pageMarkers: PortalSelectorCandidate[];
  oasisThirtyDaysTabs: PortalSelectorCandidate[];
  exportControls: PortalSelectorCandidate[];
  exportMenuItems: PortalSelectorCandidate[];
  panelReadinessSignals: PortalSelectorCandidate[];
} = {
  pageMarkers: [
    {
      strategy: "role",
      role: "heading",
      name: /dashboard|patients|schedule|oasis/i,
      description: "dashboard heading by accessible role",
    },
    {
      strategy: "text",
      value: /search patient|dashboard|oasis/i,
      description: "dashboard marker by visible text",
    },
    {
      strategy: "css",
      selector: 'button:has-text("Search Patient"), [role="tab"], main',
      description: "dashboard marker by search button, tabs, or main container",
    },
  ],
  oasisThirtyDaysTabs: [
    {
      strategy: "role",
      role: "tab",
      name: /oasis\s*30\s*day/i,
      description: "OASIS 30 Day tab by accessible role",
    },
    {
      strategy: "role",
      role: "button",
      name: /oasis\s*30\s*day/i,
      description: "OASIS 30 Day button by accessible role",
    },
    {
      strategy: "text",
      value: /oasis\s*30\s*day/i,
      description: "OASIS 30 Day tab by visible text",
    },
    {
      strategy: "css",
      selector: ':is([role="tab"], button, a, [role="button"], [tabindex="0"]):has-text("OASIS 30")',
      description: "OASIS 30 Day tab by visible text fallback",
    },
  ],
  exportControls: [
    {
      strategy: "css",
      selector: 'button#dropdownExcel.dropdown-toggle, .btn-group > button#dropdownExcel, .btn-group > button.dropdown-toggle:has-text("Export")',
      description: "dashboard export dropdown toggle button",
    },
    {
      strategy: "role",
      role: "button",
      name: /export/i,
      description: "export control by accessible role",
    },
    {
      strategy: "text",
      value: /export to excel|export/i,
      description: "export control by visible text",
    },
    {
      strategy: "css",
      selector: ':is(button, [role="button"], a, [tabindex="0"]):has-text("Export")',
      description: "export control by visible Export text",
    },
  ],
  exportMenuItems: [
    {
      strategy: "css",
      selector: '.dropdown-menu.show a.dropdown-item:has-text("Export All"), .dropdown-menu.show .dropdown-item.text-success:has-text("Export All")',
      description: "open export dropdown item for Export All",
    },
    {
      strategy: "css",
      selector: '.dropdown-menu.show a.dropdown-item, .dropdown-menu.show [role="menuitem"], .show .dropdown-item',
      description: "visible export dropdown items in the open menu",
    },
    {
      strategy: "role",
      role: "menuitem",
      name: /excel|export/i,
      description: "export menu item by accessible role",
    },
    {
      strategy: "role",
      role: "button",
      name: /excel|export/i,
      description: "export option by accessible button role",
    },
    {
      strategy: "text",
      value: /export all|export to excel|excel/i,
      description: "export menu item by visible text",
    },
    {
      strategy: "css",
      selector: ':is([role="menuitem"], button, a, [role="button"], [tabindex="0"]):has-text("Export All"), :is([role="menuitem"], button, a, [role="button"], [tabindex="0"]):has-text("Excel")',
      description: "export menu item by visible Export All or Excel text fallback",
    },
  ],
  panelReadinessSignals: [
    {
      strategy: "css",
      selector: 'table, [role="table"], [role="grid"]',
      description: "table or grid visible in the selected dashboard panel",
    },
    {
      strategy: "text",
      value: /export|excel|patient/i,
      description: "panel readiness by visible panel text",
    },
  ],
};
