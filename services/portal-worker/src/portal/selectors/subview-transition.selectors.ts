export const SUBVIEW_TRANSITION_SELECTORS = {
  visibleRowSelectors: [
    "tbody tr",
    '[role="row"]',
    '[class*="row"]',
    '[class*="Row"]',
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
