export const DOCUMENT_TRACKING_SELECTORS = {
  rootSelectors: ["main", '[role="main"]', "body"],
  sidebarNavLinkSelectors: ["nav a"],
  trustedSidebarAnchorSelectors: [
    'a:has(.fin-sidebar__label)',
    'fin-sidebar-menu-root a',
    'nav a:has(.fin-sidebar__label)',
  ],
  sidebarLabelSelectors: [
    "span.fin-sidebar__label",
    '[class*="fin-sidebar__label"]',
    "span",
  ],
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
  safeSidebarLabels: [
    "QA Monitoring",
    "Physician's Order",
    "Plan of Care",
    "OASIS",
  ],
  preferredSidebarLabels: [
    "QA Monitoring",
    "Physician's Order",
  ],
  optionalSidebarLabels: [
    "Need to Send",
    "Need to Receive",
    "Document Statistics",
  ],
} as const;
