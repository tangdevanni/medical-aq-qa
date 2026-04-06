import type { PortalSelectorCandidate } from "./types";

export const patientSearchSelectors: {
  globalSearchControl: PortalSelectorCandidate[];
  globalSearchSurface: PortalSelectorCandidate[];
  globalSearchInput: PortalSelectorCandidate[];
  resultRows: PortalSelectorCandidate[];
  resultOpenTargets: PortalSelectorCandidate[];
  chartIndicators: PortalSelectorCandidate[];
} = {
  globalSearchControl: [
    {
      strategy: "role",
      role: "button",
      name: /search patient/i,
      description: "Global patient search button by accessible name",
    },
    {
      strategy: "css",
      selector: 'button:has-text("Search Patient"):has-text("Ctrl K")',
      description: "Global patient search button containing Search Patient and Ctrl K text",
    },
    {
      strategy: "css",
      selector: '[role="button"]:has-text("Search Patient"):has-text("Ctrl K"), fin-button:has-text("Search Patient"):has-text("Ctrl K"), [tabindex="0"]:has-text("Search Patient"):has-text("Ctrl K")',
      description: "Global patient search control containing Search Patient and Ctrl K text",
    },
    {
      strategy: "css",
      selector: 'button:has-text("Search Patient")',
      description: "Global patient search button containing Search Patient text",
    },
    {
      strategy: "css",
      selector: '[role="button"]:has-text("Search Patient"), fin-button:has-text("Search Patient"), [tabindex="0"]:has-text("Search Patient")',
      description: "Global patient search visible control containing Search Patient text",
    },
    {
      strategy: "css",
      selector: 'fin-button:has-text("Search Patient"):has-text("Ctrl K"), fin-button:has-text("Search Patient..."):has-text("Ctrl K")',
      description: "Global patient search fin-button wrapper containing Search Patient and Ctrl K text",
    },
    {
      strategy: "css",
      selector: 'fin-button button:has-text("Search Patient"), fin-button [role="button"]:has-text("Search Patient")',
      description: "Global patient search control inside fin-button wrapper",
    },
    {
      strategy: "role",
      role: "button",
      name: /ctrl\s*k/i,
      description: "Global patient search button by shortcut hint",
    },
    {
      strategy: "css",
      selector: 'button:has-text("Search Patient"):has(svg, i, [class*="search"], [data-icon*="search"])',
      description: "Global patient search button containing search icon and patient-search text",
    },
  ],
  globalSearchSurface: [
    {
      strategy: "role",
      role: "dialog",
      name: /search patient/i,
      description: "Global patient search dialog by accessible name",
    },
    {
      strategy: "css",
      selector: '[role="dialog"]:has(input), [aria-modal="true"]:has(input)',
      description: "Global patient search overlay/dialog containing an input",
    },
    {
      strategy: "css",
      selector: '[class*="search"][class*="panel"]:has(input), [class*="search"][class*="overlay"]:has(input), [class*="search"][class*="dialog"]:has(input)',
      description: "Global patient search overlay by search-related class fragments",
    },
  ],
  globalSearchInput: [
    {
      strategy: "css",
      selector: 'input[type="text"][placeholder*="Search patients"]',
      description: "Global patient search input by confirmed Search patients placeholder",
    },
    {
      strategy: "css",
      selector: "input.search_input",
      description: "Global patient search input by confirmed search_input class",
    },
    {
      strategy: "css",
      selector: 'div.search-header.open input[type="text"]',
      description: "Global patient search input inside open search header",
    },
    {
      strategy: "role",
      role: "combobox",
      name: /patient|search/i,
      description: "Global patient search combobox by accessible role",
    },
    {
      strategy: "role",
      role: "textbox",
      name: /patient|search/i,
      description: "Global patient search textbox by accessible role",
    },
    {
      strategy: "placeholder",
      value: /search patient|patient search|patient/i,
      description: "Global patient search input by placeholder text",
    },
    {
      strategy: "css",
      selector: 'input[placeholder*="Search patients"], input[placeholder*="Search Patient"], input[placeholder*="patient"], input[placeholder*="LAST"], input[type="search"]',
      description: "Global patient search input by placeholder and type fallback",
    },
    {
      strategy: "css",
      selector: 'input[type="text"]',
      description: "Global patient search generic text input fallback",
    },
  ],
  resultRows: [
    {
      strategy: "css",
      selector: 'section.search-body__content[tabindex="0"]:has(div.search-body__item)',
      description: "Global patient search focusable result tile section",
    },
    {
      strategy: "css",
      selector: "section.search-body__content div.search-body__item",
      description: "Global patient search result tiles by confirmed content/item containers",
    },
    {
      strategy: "css",
      selector: 'div.search-body__item:has(ngb-highlight)',
      description: "Global patient search result tiles containing ngb-highlight",
    },
    {
      strategy: "css",
      selector: 'section.search-body__content [class*="search-body__item"]',
      description: "Global patient search result tiles by search-body item class fallback",
    },
    {
      strategy: "css",
      selector: 'section.search-body__content :is(a[href], button, [role="button"], [role="link"]):has(ngb-highlight)',
      description: "Global patient search clickable results containing highlighted patient text",
    },
    {
      strategy: "css",
      selector: 'section.search-body__content :is(a[href], button, [role="button"], [role="link"]):has-text(",")',
      description: "Global patient search clickable results with patient-name text punctuation",
    },
  ],
  resultOpenTargets: [
    {
      strategy: "css",
      selector: 'section.search-body__content[tabindex="0"]',
      description: "Patient result focusable tile section",
    },
    {
      strategy: "css",
      selector: "section.search-body__content div.search-body__item",
      description: "Patient result tile container by confirmed search-body item",
    },
    {
      strategy: "css",
      selector: 'div.search-body__item:has(ngb-highlight)',
      description: "Patient result tile container containing highlighted patient text",
    },
    {
      strategy: "css",
      selector: 'section.search-body__content div.search-body__item :is(a[href], button, [role="button"], [role="link"])',
      description: "Patient result clickable control inside confirmed tile container",
    },
    {
      strategy: "css",
      selector: 'a[href*="/client/"][href*="/intake/"], a[href*="/client/"][href*="/calendar"], a[href*="/patient/"]',
      description: "Patient result anchor by portal href",
    },
  ],
  chartIndicators: [
    {
      strategy: "role",
      role: "tab",
      name: /documents|chart|clinical/i,
      description: "Chart documents tab by accessible role",
    },
    {
      strategy: "role",
      role: "heading",
      name: /chart|patient|documents|episodes/i,
      description: "Chart heading by accessible role",
    },
    {
      strategy: "text",
      value: /documents|chart details|clinical|episodes/i,
      description: "Chart marker by visible text",
    },
    {
      strategy: "css",
      selector: '[data-testid*="chart"], [data-testid*="documents"], [class*="chart"][class*="page"]',
      description: "Chart indicator by test id or class fragments",
    },
    {
      strategy: "css",
      selector: "main",
      description: "Chart main container fallback",
    },
  ],
};
