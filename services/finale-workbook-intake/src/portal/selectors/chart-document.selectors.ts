import type { PortalSelectorCandidate } from "./types";

export const chartDocumentSelectors: {
  documentsTabSelectors: PortalSelectorCandidate[];
  candidateSelectors: PortalSelectorCandidate[];
  modalSelectors: PortalSelectorCandidate[];
  modalCloseSelectors: PortalSelectorCandidate[];
} = {
  documentsTabSelectors: [
    {
      strategy: "role",
      role: "tab",
      name: /documents|clinical|chart/i,
      description: "documents tab by accessible role",
    },
    {
      strategy: "role",
      role: "button",
      name: /documents|clinical|attachments/i,
      description: "documents section toggle by accessible role",
    },
    {
      strategy: "text",
      value: /documents|clinical documents|attachments/i,
      description: "documents section by visible text",
    },
    {
      strategy: "css",
      selector: '[data-testid*="documents"]',
      description: "documents section by data-testid",
    },
    {
      strategy: "css",
      selector: '[class*="document"][class*="tab"]',
      description: "documents section by class fragment",
    },
  ],
  candidateSelectors: [
    {
      strategy: "role",
      role: "link",
      name: /oasis|plan of care|visit|order|communication|summary|supervisory|missed|fall|infection|document/i,
      description: "document candidate links by accessible role",
    },
    {
      strategy: "role",
      role: "button",
      name: /oasis|plan of care|visit|order|communication|summary|supervisory|missed|fall|infection|document|open|view|download/i,
      description: "document candidate buttons by accessible role",
    },
    {
      strategy: "css",
      selector: 'a[href*="/documents/"]',
      description: "document candidate links by documents href",
    },
    {
      strategy: "css",
      selector: 'button[aria-label*="document"]',
      description: "document candidate buttons by aria-label",
    },
    {
      strategy: "css",
      selector: 'button[title*="document"]',
      description: "document candidate buttons by title",
    },
    {
      strategy: "css",
      selector: '[data-testid*="document"] a',
      description: "document candidate anchors by data-testid",
    },
    {
      strategy: "css",
      selector: '[data-testid*="document"] button',
      description: "document candidate buttons by data-testid",
    },
    {
      strategy: "css",
      selector: "table tbody tr a",
      description: "document candidate anchors in table rows",
    },
    {
      strategy: "css",
      selector: "table tbody tr button",
      description: "document candidate buttons in table rows",
    },
    {
      strategy: "css",
      selector: '[class*="document"] a',
      description: "document candidate anchors by class fragment",
    },
    {
      strategy: "css",
      selector: '[class*="document"] button',
      description: "document candidate buttons by class fragment",
    },
    {
      strategy: "css",
      selector: '[class*="note"] a',
      description: "document note links by class fragment",
    },
    {
      strategy: "css",
      selector: '[class*="note"] button',
      description: "document note buttons by class fragment",
    },
    {
      strategy: "css",
      selector: '[class*="order"] a',
      description: "document order links by class fragment",
    },
    {
      strategy: "css",
      selector: '[class*="order"] button',
      description: "document order buttons by class fragment",
    },
  ],
  modalSelectors: [
    {
      strategy: "role",
      role: "dialog",
      description: "document modal by role=dialog",
    },
    {
      strategy: "css",
      selector: '[aria-modal="true"]',
      description: "document modal by aria-modal",
    },
    {
      strategy: "css",
      selector: '[class*="modal"]',
      description: "document modal by class fragment",
    },
    {
      strategy: "css",
      selector: '[class*="drawer"]',
      description: "document drawer by class fragment",
    },
  ],
  modalCloseSelectors: [
    {
      strategy: "role",
      role: "button",
      name: /close|done|dismiss/i,
      description: "document modal close button by accessible role",
    },
    {
      strategy: "css",
      selector: '[role="dialog"] button[aria-label*="Close"]',
      description: "document modal close button by aria-label",
    },
    {
      strategy: "css",
      selector: '[class*="modal"] button:has-text("Close")',
      description: "document modal close button by text=Close",
    },
    {
      strategy: "css",
      selector: '[class*="drawer"] button:has-text("Close")',
      description: "document drawer close button by text=Close",
    },
  ],
} as const;
