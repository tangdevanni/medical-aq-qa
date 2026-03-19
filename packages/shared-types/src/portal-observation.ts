import { z } from "zod";

export const qaBoardCardSummarySchema = z.object({
  cardIndex: z.number().int().nonnegative(),
  serviceDateText: z.string().min(1).nullable(),
  patientDisplayText: z.string().min(1).nullable(),
  mrText: z.string().min(1).nullable(),
  workItemTypeText: z.string().min(1).nullable(),
  statusText: z.string().min(1).nullable(),
});

export type QaBoardCardSummary = z.infer<typeof qaBoardCardSummarySchema>;

export const openBehaviorSchema = z.enum([
  "same_page",
  "modal",
  "new_tab",
  "split_view",
  "unknown",
]);

export type OpenBehavior = z.infer<typeof openBehaviorSchema>;

export const portalControlClassificationSchema = z.enum([
  "SAFE_NAV",
  "SEARCH_TRIGGER",
  "UNKNOWN",
  "RISKY_ACTION",
]);

export type PortalControlClassification = z.infer<typeof portalControlClassificationSchema>;

export const portalTableSummarySchema = z.object({
  label: z.string().min(1).nullable(),
  columnHeaders: z.array(z.string().min(1)),
  approxRowCount: z.number().int().nonnegative(),
});

export type PortalTableSummary = z.infer<typeof portalTableSummarySchema>;

export const portalFormSummarySchema = z.object({
  label: z.string().min(1).nullable(),
  inputCount: z.number().int().nonnegative(),
  selectCount: z.number().int().nonnegative(),
  textareaCount: z.number().int().nonnegative(),
});

export type PortalFormSummary = z.infer<typeof portalFormSummarySchema>;

export const portalButtonSummarySchema = z.object({
  label: z.string().min(1),
  classification: portalControlClassificationSchema,
});

export type PortalButtonSummary = z.infer<typeof portalButtonSummarySchema>;

export const portalSectionGroupSchema = z.object({
  sectionLabel: z.string().min(1).nullable(),
  tiles: z.array(z.string().min(1)),
  buttons: z.array(portalButtonSummarySchema),
  tables: z.array(portalTableSummarySchema),
  searchBars: z.array(z.string().min(1)),
});

export type PortalSectionGroup = z.infer<typeof portalSectionGroupSchema>;

export const safeNavigationCandidateSchema = z.object({
  label: z.string().min(1).nullable(),
  classification: portalControlClassificationSchema,
  reason: z.string().min(1).nullable(),
});

export type SafeNavigationCandidate = z.infer<typeof safeNavigationCandidateSchema>;

export const ordersQaTargetCandidateSchema = z.object({
  label: z.string().min(1).nullable(),
  classification: portalControlClassificationSchema,
  reason: z.string().min(1).nullable(),
  found: z.boolean(),
});

export type OrdersQaTargetCandidate = z.infer<typeof ordersQaTargetCandidateSchema>;

export const landingPageObservationSchema = z.object({
  type: z.enum(["dashboard", "portal_discovery"]),
  url: z.string().min(1).optional(),
  title: z.string().min(1).nullable().optional(),
  navItems: z.array(z.string().min(1)),
  sideNavItems: z.array(z.string().min(1)).optional(),
  searchBars: z.array(z.string().min(1)).optional(),
  widgets: z.array(z.string().min(1)).optional(),
  tiles: z.array(z.string().min(1)).optional(),
  sectionHeaders: z.array(z.string().min(1)).optional(),
  tables: z.array(portalTableSummarySchema).optional(),
  forms: z.array(portalFormSummarySchema).optional(),
  buttons: z.array(portalButtonSummarySchema).optional(),
  modalsPresent: z.boolean().optional(),
  layoutPatterns: z.array(z.string().min(1)).optional(),
  sectionGroups: z.array(portalSectionGroupSchema).optional(),
  tabs: z.array(z.string().min(1)).optional(),
  hasPatientSearch: z.boolean().optional(),
  hasOrdersQaManagementTile: z.boolean().optional(),
});

export type LandingPageObservation = z.infer<typeof landingPageObservationSchema>;

export const destinationPageObservationSchema = z.object({
  opened: z.boolean(),
  openBehavior: openBehaviorSchema,
  url: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  pageType: z.string().min(1).nullable(),
  tabs: z.array(z.string().min(1)),
  sectionHeaders: z.array(z.string().min(1)),
  tables: z.array(portalTableSummarySchema),
  buttons: z.array(portalButtonSummarySchema),
  searchBars: z.array(z.string().min(1)),
  cards: z.array(z.string().min(1)),
  layoutPatterns: z.array(z.string().min(1)),
});

export type DestinationPageObservation = z.infer<typeof destinationPageObservationSchema>;

export const ordersQaTransitionResultTypeSchema = z.enum([
  "same_page_dashboard_no_change",
  "same_page_new_view",
  "modal",
  "new_tab",
  "split_view",
  "route_change",
  "unknown",
]);

export type OrdersQaTransitionResultType = z.infer<typeof ordersQaTransitionResultTypeSchema>;

export const ordersQaTransitionSchema = z.object({
  clicked: z.boolean(),
  resultType: ordersQaTransitionResultTypeSchema,
  urlBefore: z.string().min(1).nullable(),
  urlAfter: z.string().min(1).nullable(),
  routeChanged: z.boolean(),
  modalDetected: z.boolean(),
  newTabDetected: z.boolean(),
  splitViewDetected: z.boolean(),
  meaningfulStructureChanged: z.boolean(),
});

export type OrdersQaTransition = z.infer<typeof ordersQaTransitionSchema>;

export const destinationSurfaceObservationSchema = z.object({
  detected: z.boolean(),
  pageType: z.string().min(1).nullable(),
  url: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  tabs: z.array(z.string().min(1)),
  sectionHeaders: z.array(z.string().min(1)),
  tables: z.array(portalTableSummarySchema),
  buttons: z.array(portalButtonSummarySchema),
  searchBars: z.array(z.string().min(1)),
  cards: z.array(z.string().min(1)),
  layoutPatterns: z.array(z.string().min(1)),
});

export type DestinationSurfaceObservation = z.infer<typeof destinationSurfaceObservationSchema>;

export const interactionForensicsMethodSchema = z.enum([
  "click",
  "hover_click",
  "enter_key",
  "space_key",
]);

export type InteractionForensicsMethod = z.infer<typeof interactionForensicsMethodSchema>;

export const interactionForensicsResultTypeSchema = z.enum([
  "no_change",
  "route_change",
  "modal",
  "new_tab",
  "split_view",
  "new_view",
  "unknown",
]);

export type InteractionForensicsResultType = z.infer<typeof interactionForensicsResultTypeSchema>;

export const forensicsBoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export type ForensicsBoundingBox = z.infer<typeof forensicsBoundingBoxSchema>;

export const ordersQaForensicsTargetSchema = z.object({
  label: z.string().min(1).nullable(),
  found: z.boolean(),
});

export type OrdersQaForensicsTarget = z.infer<typeof ordersQaForensicsTargetSchema>;

export const ordersQaContainerSummarySchema = z.object({
  visible: z.boolean(),
  textSummary: z.string().min(1).nullable(),
});

export type OrdersQaContainerSummary = z.infer<typeof ordersQaContainerSummarySchema>;

export const interactiveForensicsCandidateSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  tagName: z.string().min(1).nullable(),
  role: z.string().min(1).nullable(),
  textLabel: z.string().min(1).nullable(),
  ariaLabel: z.string().min(1).nullable(),
  titleAttr: z.string().min(1).nullable(),
  visible: z.boolean(),
  enabled: z.boolean(),
  hasHref: z.boolean(),
  boundingBox: forensicsBoundingBoxSchema.nullable(),
  isPrimaryActionLike: z.boolean(),
});

export type InteractiveForensicsCandidate = z.infer<typeof interactiveForensicsCandidateSchema>;

export const interactionAttemptSummarySchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  method: interactionForensicsMethodSchema,
  resultType: interactionForensicsResultTypeSchema,
  routeChanged: z.boolean(),
  modalDetected: z.boolean(),
  newTabDetected: z.boolean(),
  splitViewDetected: z.boolean(),
  meaningfulStructureChanged: z.boolean(),
  success: z.boolean(),
});

export type InteractionAttemptSummary = z.infer<typeof interactionAttemptSummarySchema>;

export const successfulInteractionAttemptSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  method: interactionForensicsMethodSchema,
  resultType: interactionForensicsResultTypeSchema,
});

export type SuccessfulInteractionAttempt = z.infer<typeof successfulInteractionAttemptSchema>;

export const phase7TileInteractionSchema = z.object({
  clicked: z.boolean(),
  resultType: interactionForensicsResultTypeSchema,
  meaningful: z.boolean(),
});

export type Phase7TileInteraction = z.infer<typeof phase7TileInteractionSchema>;

export const hubCardRoleSchema = z.enum([
  "queue_entry",
  "statistics_tile",
  "tab_like_control",
  "action_button",
  "unknown",
]);

export type HubCardRole = z.infer<typeof hubCardRoleSchema>;

export const documentTrackingHubCardSchema = z.object({
  label: z.string().min(1).nullable(),
  classification: z.enum(["SAFE_NAV", "UNKNOWN", "RISKY_ACTION"]),
  role: hubCardRoleSchema,
  clickable: z.boolean(),
  hasClickableDescendant: z.boolean(),
});

export type DocumentTrackingHubCard = z.infer<typeof documentTrackingHubCardSchema>;

export const documentTrackingHubSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1).nullable(),
  cards: z.array(documentTrackingHubCardSchema),
});

export type DocumentTrackingHub = z.infer<typeof documentTrackingHubSchema>;

export const documentTrackingSelectedSubviewSchema = z.object({
  label: z.string().min(1).nullable(),
  classification: z.enum(["SAFE_NAV", "UNKNOWN", "RISKY_ACTION"]),
  opened: z.boolean(),
});

export type DocumentTrackingSelectedSubview = z.infer<typeof documentTrackingSelectedSubviewSchema>;

export const documentTrackingTransitionSchema = z.object({
  resultType: z.enum([
    "route_change",
    "modal",
    "new_tab",
    "split_view",
    "same_page_new_view",
    "no_change",
    "unknown",
  ]),
  routeChanged: z.boolean(),
  modalDetected: z.boolean(),
  newTabDetected: z.boolean(),
  splitViewDetected: z.boolean(),
  meaningfulStructureChanged: z.boolean(),
});

export type DocumentTrackingTransition = z.infer<typeof documentTrackingTransitionSchema>;

export const documentTrackingDestinationSurfaceSchema = z.object({
  detected: z.boolean(),
  pageType: z.enum(["queue", "worklist", "statistics_view", "form_hub", "unknown"]),
  url: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  tabs: z.array(z.string().min(1)),
  sectionHeaders: z.array(z.string().min(1)),
  tables: z.array(portalTableSummarySchema),
  buttons: z.array(portalButtonSummarySchema),
  searchBars: z.array(z.string().min(1)),
  cards: z.array(z.string().min(1)),
  layoutPatterns: z.array(z.string().min(1)),
  hasVisibleRows: z.boolean(),
});

export type DocumentTrackingDestinationSurface = z.infer<typeof documentTrackingDestinationSurfaceSchema>;

export const qaBoardObservationSchema = z.object({
  cardCount: z.number().int().nonnegative(),
  statusesSeen: z.array(z.string().min(1)),
  workItemTypesSeen: z.array(z.string().min(1)),
  cardSummaries: z.array(qaBoardCardSummarySchema),
  selectedCardIndex: z.number().int().nonnegative().optional(),
});

export type QaBoardObservation = z.infer<typeof qaBoardObservationSchema>;

export const qaItemDetailSummarySchema = z.object({
  openBehavior: openBehaviorSchema,
  titleText: z.string().min(1).nullable(),
  statusText: z.string().min(1).nullable(),
  sectionNames: z.array(z.string().min(1)),
  actionLabels: z.array(z.string().min(1)),
  hasRelatedDocumentsPanel: z.boolean(),
  hasAttachmentArea: z.boolean(),
  hasTextAreas: z.boolean(),
  detailViewDetected: z.boolean(),
  routeChanged: z.boolean(),
  modalDetected: z.boolean(),
  newTabDetected: z.boolean(),
});

export type QaItemDetailSummary = z.infer<typeof qaItemDetailSummarySchema>;

export const portalObservationFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export type PortalObservationFailure = z.infer<typeof portalObservationFailureSchema>;

export const portalObservationPayloadSchema = z.object({
  landingPage: landingPageObservationSchema,
  qaBoard: qaBoardObservationSchema,
  qaItemDetail: qaItemDetailSummarySchema.optional(),
  failures: z.array(portalObservationFailureSchema),
});

export type PortalObservationPayload = z.infer<typeof portalObservationPayloadSchema>;

export const phase4PortalDiscoveryPayloadSchema = z.object({
  landingPage: landingPageObservationSchema,
  safeNavigationCandidate: safeNavigationCandidateSchema,
  destinationPage: destinationPageObservationSchema,
  failures: z.array(portalObservationFailureSchema),
});

export type Phase4PortalDiscoveryPayload = z.infer<typeof phase4PortalDiscoveryPayloadSchema>;

export const ordersQaEntryDiscoveryPayloadSchema = z.object({
  landingPage: z.object({
    url: z.string().min(1),
    title: z.string().min(1).nullable(),
  }),
  targetCandidate: ordersQaTargetCandidateSchema,
  transition: ordersQaTransitionSchema,
  destinationPage: destinationSurfaceObservationSchema,
  failures: z.array(portalObservationFailureSchema),
});

export type OrdersQaEntryDiscoveryPayload = z.infer<typeof ordersQaEntryDiscoveryPayloadSchema>;

export const ordersQaInteractionForensicsPayloadSchema = z.object({
  target: ordersQaForensicsTargetSchema,
  container: ordersQaContainerSummarySchema,
  interactiveCandidates: z.array(interactiveForensicsCandidateSchema),
  attempts: z.array(interactionAttemptSummarySchema),
  successfulAttempt: successfulInteractionAttemptSchema.nullable(),
  destinationSurface: destinationSurfaceObservationSchema,
  failures: z.array(portalObservationFailureSchema),
});

export type OrdersQaInteractionForensicsPayload = z.infer<typeof ordersQaInteractionForensicsPayloadSchema>;

export const phase7TileInteractionPayloadSchema = z.object({
  tileCount: z.number().int().nonnegative(),
  targetTileIndex: z.number().int().nonnegative().nullable(),
  targetLabel: z.string().min(1).nullable(),
  interaction: phase7TileInteractionSchema,
  destinationSurface: destinationSurfaceObservationSchema,
  failures: z.array(portalObservationFailureSchema),
});

export type Phase7TileInteractionPayload = z.infer<typeof phase7TileInteractionPayloadSchema>;

export const documentTrackingHubDiscoveryPayloadSchema = z.object({
  hub: documentTrackingHubSchema,
  selectedSubview: documentTrackingSelectedSubviewSchema,
  transition: documentTrackingTransitionSchema,
  destinationSurface: documentTrackingDestinationSurfaceSchema,
  failures: z.array(portalObservationFailureSchema),
});

export type DocumentTrackingHubDiscoveryPayload = z.infer<typeof documentTrackingHubDiscoveryPayloadSchema>;
