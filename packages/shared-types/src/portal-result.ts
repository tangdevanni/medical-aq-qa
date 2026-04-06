import {
  type DestinationPageObservation,
  type DocumentTrackingDestinationSurface,
  type DocumentTrackingHub,
  type DocumentTrackingSelectedSubview,
  type DocumentTrackingSubviewDestinationSurface,
  type DocumentTrackingSubviewHub,
  type DocumentTrackingSubviewSelection,
  type DocumentTrackingSubviewTransition,
  type DocumentTrackingTransition,
  type DestinationSurfaceObservation,
  type InteractionAttemptSummary,
  type InteractiveForensicsCandidate,
  type LandingPageObservation,
  type OrdersQaContainerSummary,
  type OrdersQaForensicsTarget,
  type OrdersQaTargetCandidate,
  type OrdersQaTransition,
  type Phase7TileInteraction,
  type PortalObservationFailure,
  type QaQueueItemDetailSurface,
  type QaQueueItemSelectedRow,
  type QaQueueItemSelectedTarget,
  type QaQueueItemTransition,
  type QaQueueSummary,
  type QaBoardObservation,
  type QaItemDetailSummary,
  type SafeNavigationCandidate,
  type SuccessfulInteractionAttempt,
} from "./portal-observation";
import { type QueueQaRunReport } from "./queue-qa-pipeline";
import { type VisitNoteQaReport } from "./visit-note-qa";
import { type WorkflowStatus } from "./workflow";

export interface PortalJobError extends PortalObservationFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PortalJobResult {
  jobId: string;
  portal: string;
  status: WorkflowStatus;
  completedAt: string;
  summary: string;
  landingPage?: LandingPageObservation;
  safeNavigationCandidate?: SafeNavigationCandidate;
  targetCandidate?: OrdersQaTargetCandidate;
  transition?: OrdersQaTransition;
  forensicsTarget?: OrdersQaForensicsTarget;
  containerSummary?: OrdersQaContainerSummary;
  interactiveCandidates?: InteractiveForensicsCandidate[];
  interactionAttempts?: InteractionAttemptSummary[];
  successfulAttempt?: SuccessfulInteractionAttempt | null;
  tileCount?: number;
  targetTileIndex?: number | null;
  targetLabel?: string | null;
  tileInteraction?: Phase7TileInteraction;
  hub?: DocumentTrackingHub;
  selectedSubview?: DocumentTrackingSelectedSubview;
  hubTransition?: DocumentTrackingTransition;
  trustedHub?: DocumentTrackingSubviewHub;
  subviewSelection?: DocumentTrackingSubviewSelection;
  subviewTransition?: DocumentTrackingSubviewTransition;
  queue?: QaQueueSummary;
  selectedRow?: QaQueueItemSelectedRow;
  selectedTarget?: QaQueueItemSelectedTarget;
  detailSurface?: QaQueueItemDetailSurface;
  qaQueueItemTransition?: QaQueueItemTransition;
  visitNoteQa?: VisitNoteQaReport;
  queueQaRunReport?: QueueQaRunReport;
  destinationPage?: DestinationPageObservation;
  destinationSurface?: DestinationSurfaceObservation;
  documentTrackingDestinationSurface?: DocumentTrackingDestinationSurface;
  documentTrackingSubviewSurface?: DocumentTrackingSubviewDestinationSurface;
  qaBoard?: QaBoardObservation;
  qaItemDetail?: QaItemDetailSummary;
  failures: PortalObservationFailure[];
  data?: Record<string, unknown>;
  error?: PortalJobError;
}
