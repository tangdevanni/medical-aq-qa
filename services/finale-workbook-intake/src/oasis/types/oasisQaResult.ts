import type { QaPrefetchResult, QaVisibleDiagnosis } from "../../qa/types/qaPrefetchResult";
import type { BillingPeriodCalendarSummary } from "./billingPeriodCalendarSummary";
import type { EpisodeRangeOption } from "../navigation/episodeRangeDropdownService";
import type { OasisPrintedNoteReviewResult } from "./oasisPrintedNoteReview";
import type {
  OasisAssessmentProcessingDecision,
  OasisAssessmentProcessingStatus,
} from "../status/oasisAssessmentProcessingStatus";

export type OasisEpisodeSelectionStatus =
  | "SELECTED"
  | "ASSUMED_CURRENT_EPISODE"
  | "UNRESOLVED";

export interface OasisEpisodeSelectionResult {
  status: OasisEpisodeSelectionStatus;
  targetEpisodeLabel: string | null;
  billingPeriod: string | null;
  episodePeriod: string | null;
  rfa: string | null;
  selectedRange: EpisodeRangeOption | null;
  availableRanges: EpisodeRangeOption[];
  changedSelection: boolean;
  selectionMethod: "parsed_date_match" | "label_match" | "current_selection_fallback" | "unresolved";
  warnings: string[];
}

export interface OasisMenuOpenResult {
  opened: boolean;
  currentUrl: string;
  selectorUsed: string | null;
  availableAssessmentTypes: string[];
  warnings: string[];
}

export interface OasisAssessmentSelectionResult {
  requestedAssessmentType: string;
  selectedAssessmentType: string;
  selectionReason: "preferred_soc" | "requested_exact" | "requested_alias" | "fallback_requested";
  availableAssessmentTypes: string[];
  warnings: string[];
}

export interface OasisAssessmentNoteOpenResult {
  assessmentOpened: boolean;
  matchedAssessmentLabel: string | null;
  matchedRequestedAssessment: boolean;
  currentUrl: string;
  diagnosisSectionOpened: boolean;
  diagnosisListFound: boolean;
  diagnosisListSamples: string[];
  visibleDiagnoses: QaVisibleDiagnosis[];
  lockStatus: "locked" | "unlocked" | "unknown";
  oasisAssessmentStatus?: {
    detectedStatuses: OasisAssessmentProcessingStatus[];
    primaryStatus: OasisAssessmentProcessingStatus;
    decision: OasisAssessmentProcessingDecision;
    processingEligible: boolean;
    reason: string;
    matchedSignals: string[];
  };
  warnings: string[];
}

export interface OasisPrintedNoteCaptureOpenResult {
  assessmentType: string;
  printProfileKey: string | null;
  printProfileLabel: string | null;
  printButtonDetected: boolean;
  printButtonVisible: boolean;
  printButtonSelectorUsed: string | null;
  printClickSucceeded: boolean;
  printModalDetected: boolean;
  printModalSelectorUsed: string | null;
  printModalConfirmSelectorUsed: string | null;
  printModalConfirmSucceeded: boolean;
  selectedSectionLabels: string[];
  currentUrl: string;
  printedPdfPath: string | null;
  sourcePdfPath: string | null;
  extractedTextPath: string | null;
  extractionResultPath: string | null;
  ocrResultPath: string | null;
  textLength: number;
  extractionMethod: "printed_pdf_ocr" | "printed_pdf_no_ocr" | "visible_text_fallback";
  warnings: string[];
}

export interface OasisQaEntryResult extends QaPrefetchResult {
  entryStage: "OASIS_ENTRY";
  sharedEvidenceSummary: {
    discoveredDocumentCount: number;
    extractedArtifactPaths: string[];
    diagnosisCodeCount: number;
    warnings: string[];
  };
  episodeSelection: OasisEpisodeSelectionResult;
  billingCalendarSummary: BillingPeriodCalendarSummary | null;
  billingCalendarSummaryPath: string | null;
  oasisMenu: OasisMenuOpenResult;
  assessmentSelection: OasisAssessmentSelectionResult;
  assessmentNote: OasisAssessmentNoteOpenResult;
  printedNoteReview: OasisPrintedNoteReviewResult | null;
  printedNoteReviewPath: string | null;
}
