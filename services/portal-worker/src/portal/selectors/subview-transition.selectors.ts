export const SUBVIEW_TRANSITION_SELECTORS = {
  visibleRowSelectors: [
    "tbody tr",
    '[role="row"]',
    '[class*="row"]',
    '[class*="Row"]',
  ],
  filterSelectors: [
    "select",
    '[class*="filter"]',
    '[class*="Filter"]',
    '[class*="chip"]',
    '[class*="Chip"]',
  ],
  statusLabelSelectors: [
    '[class*="status"]',
    '[class*="Status"]',
    '[class*="badge"]',
    '[class*="Badge"]',
    '[class*="pill"]',
    '[class*="Pill"]',
  ],
  queueMarkers: [
    "table",
    '[role="grid"]',
    '[role="table"]',
  ],
  statisticsMarkers: [
    'text="Document Statistics"',
    'text="Need to Send"',
    'text="Need to Receive"',
  ],
} as const;
