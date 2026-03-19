import {
  type DestinationPageObservation,
  type DocumentTrackingDestinationSurface,
  type DocumentTrackingHub,
  type DocumentTrackingSelectedSubview,
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
  type QaBoardObservation,
  type QaItemDetailSummary,
  type SafeNavigationCandidate,
  type SuccessfulInteractionAttempt,
} from "./portal-observation";
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
  destinationPage?: DestinationPageObservation;
  destinationSurface?: DestinationSurfaceObservation;
  documentTrackingDestinationSurface?: DocumentTrackingDestinationSurface;
  qaBoard?: QaBoardObservation;
  qaItemDetail?: QaItemDetailSummary;
  failures: PortalObservationFailure[];
  data?: Record<string, unknown>;
  error?: PortalJobError;
}
