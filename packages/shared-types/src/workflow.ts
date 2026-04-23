export const WORKFLOW_CHECKPOINTS = {
  loginPageDetected: "LOGIN_PAGE_DETECTED",
  credentialsSubmitted: "CREDENTIALS_SUBMITTED",
  authenticated: "AUTHENTICATED",
  dashboardDetected: "DASHBOARD_DETECTED",
  dashboardDeepScanStarted: "DASHBOARD_DEEP_SCAN_STARTED",
  dashboardDeepScanCompleted: "DASHBOARD_DEEP_SCAN_COMPLETED",
  safeNavCandidateIdentified: "SAFE_NAV_CANDIDATE_IDENTIFIED",
  safeNavigationAttempted: "SAFE_NAVIGATION_ATTEMPTED",
  destinationPageDetected: "DESTINATION_PAGE_DETECTED",
  phase4DiscoveryComplete: "PHASE_4_DISCOVERY_COMPLETE",
  ordersQaTargetSearchStarted: "ORDERS_QA_TARGET_SEARCH_STARTED",
  ordersQaTargetFound: "ORDERS_QA_TARGET_FOUND",
  ordersQaClickAttempted: "ORDERS_QA_CLICK_ATTEMPTED",
  transitionAnalyzed: "TRANSITION_ANALYZED",
  destinationSurfaceDetected: "DESTINATION_SURFACE_DETECTED",
  ordersQaEntryDiscoveryComplete: "ORDERS_QA_ENTRY_DISCOVERY_COMPLETE",
  ordersQaForensicsStarted: "ORDERS_QA_FORENSICS_STARTED",
  ordersQaContainerFound: "ORDERS_QA_CONTAINER_FOUND",
  interactiveCandidatesEnumerated: "INTERACTIVE_CANDIDATES_ENUMERATED",
  interactionAttempted: "INTERACTION_ATTEMPTED",
  meaningfulTransitionDetected: "MEANINGFUL_TRANSITION_DETECTED",
  ordersQaInteractionForensicsComplete: "ORDERS_QA_INTERACTION_FORENSICS_COMPLETE",
  shortcutTilesEnumerated: "SHORTCUT_TILES_ENUMERATED",
  targetTileIdentified: "TARGET_TILE_IDENTIFIED",
  targetTileClicked: "TARGET_TILE_CLICKED",
  phase7TileInteractionComplete: "PHASE_7_TILE_INTERACTION_COMPLETE",
  documentTrackingHubEntered: "DOCUMENT_TRACKING_HUB_ENTERED",
  hubCardsEnumerated: "HUB_CARDS_ENUMERATED",
  hubTargetSelected: "HUB_TARGET_SELECTED",
  hubSubviewClickAttempted: "HUB_SUBVIEW_CLICK_ATTEMPTED",
  hubSubviewDetected: "HUB_SUBVIEW_DETECTED",
  documentTrackingHubDiscoveryComplete: "DOCUMENT_TRACKING_HUB_DISCOVERY_COMPLETE",
  phase8SidebarNavComplete: "PHASE_8_SIDEBAR_NAV_COMPLETE",
  trustedHubLinksEnumerated: "TRUSTED_HUB_LINKS_ENUMERATED",
  subviewTargetSelected: "SUBVIEW_TARGET_SELECTED",
  subviewClickAttempted: "SUBVIEW_CLICK_ATTEMPTED",
  subviewDetected: "SUBVIEW_DETECTED",
  documentTrackingSubviewDiscoveryComplete: "DOCUMENT_TRACKING_SUBVIEW_DISCOVERY_COMPLETE",
  qaQueueDetected: "QA_QUEUE_DETECTED",
  qaRowSelected: "QA_ROW_SELECTED",
  qaRowTargetSelected: "QA_ROW_TARGET_SELECTED",
  visitNoteDetailDetected: "VISIT_NOTE_DETAIL_DETECTED",
  qaQueueItemDiscoveryComplete: "QA_QUEUE_ITEM_DISCOVERY_COMPLETE",
  qaQueuePipelineComplete: "QA_QUEUE_PIPELINE_COMPLETE",
  globalPatientSearchAvailable: "GLOBAL_PATIENT_SEARCH_AVAILABLE",
  qaManagementEntryAvailable: "QA_MANAGEMENT_ENTRY_AVAILABLE",
  qaBoardOpened: "QA_BOARD_OPENED",
  qaItemsEnumerated: "QA_ITEMS_ENUMERATED",
  qaItemOpenAttempted: "QA_ITEM_OPEN_ATTEMPTED",
  qaItemOpened: "QA_ITEM_OPENED",
  qaItemDetailDetected: "QA_ITEM_DETAIL_DETECTED",
  qaItemMetadataCaptured: "QA_ITEM_METADATA_CAPTURED",
  portalDiscoveryComplete: "PORTAL_DISCOVERY_COMPLETE",
} as const;

export type WorkflowCheckpointStatus =
  (typeof WORKFLOW_CHECKPOINTS)[keyof typeof WORKFLOW_CHECKPOINTS];

export type WorkflowStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | WorkflowCheckpointStatus;

export interface WorkflowTransition {
  status: WorkflowStatus;
  at: string;
  note?: string;
}

export interface WorkflowState {
  jobId: string;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  history: WorkflowTransition[];
}
