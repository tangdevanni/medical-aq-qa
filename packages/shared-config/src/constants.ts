export const PORTAL_NAMES = {
  finaleHealth: "finale-health",
} as const;

export const PORTAL_WORKFLOW_NAMES = {
  openQaItem: "open_qa_item",
  portalDiscovery: "portal_discovery",
  phase4PortalDiscovery: "phase4_portal_discovery",
  ordersQaEntryDiscovery: "orders_qa_entry_discovery",
  ordersQaInteractionForensics: "orders_qa_interaction_forensics",
  phase7TileInteraction: "phase7_tile_interaction",
  documentTrackingHubDiscovery: "document_tracking_hub_discovery",
} as const;

export const DEFAULT_SERVICE_SETTINGS = {
  orchestratorPollIntervalMs: 5_000,
  portalNavigationTimeoutMs: 15_000,
} as const;
