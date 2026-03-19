export const DOCUMENT_TRACKING_SELECTORS = {
  rootSelectors: ["main", '[role="main"]', "body"],
  hubMarkers: [
    'text="Document Statistics"',
    'text="Physician\'s Order"',
    'text="Plan of Care"',
    'text="OASIS"',
    'text="QA Monitoring"',
    'text="Need to Send"',
    'text="Need to Receive"',
  ],
  hubUrlPattern: /\/document-tracking/i,
  hubQueryPattern: /page=documentStat/i,
} as const;
