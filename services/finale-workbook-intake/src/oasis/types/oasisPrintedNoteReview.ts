export interface OasisPrintedNoteCaptureResult {
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

export type OasisPrintedNoteSectionStatus = "COMPLETED" | "PARTIAL" | "MISSING";

export interface OasisPrintedNoteSectionReview {
  key: string;
  label: string;
  status: OasisPrintedNoteSectionStatus;
  filledFieldCount: number;
  missingFieldCount: number;
  evidence: string[];
  missingFields: string[];
  suggestions: string[];
  sourceReferences: string[];
}

export interface OasisPrintedNoteReviewResult {
  assessmentType: string;
  matchedAssessmentLabel: string | null;
  reviewSource: "printed_note_ocr";
  overallStatus: "COMPLETED" | "PARTIAL";
  capture: OasisPrintedNoteCaptureResult;
  sections: OasisPrintedNoteSectionReview[];
  warningCount: number;
  topWarning: string | null;
  warnings: string[];
}
