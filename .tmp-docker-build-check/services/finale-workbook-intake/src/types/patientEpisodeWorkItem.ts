import type {
  PatientEpisodeWorkItem,
  ParserException,
  SourceValueSnapshot,
  SourceRowReference,
  StageRemark,
  StageStatus,
  WorkflowType,
} from "@medical-ai-qa/shared-types";

export type {
  EpisodeContext,
  ParserException,
  PatientEpisodeWorkItem,
  PatientIdentity,
  SourceValueSnapshot,
  SourceRowReference,
  StageRemark,
  StageStatus,
  WorkflowType,
} from "@medical-ai-qa/shared-types";

export interface BaseRawWorkbookRow {
  sourceSheet: string;
  sourceRowNumber: number;
}

export interface RawSocPocRow extends BaseRawWorkbookRow {
  patientName: string | null;
  episodeDate: string | null;
  assignedStaff: string | null;
  payer: string | null;
  rfa: string | null;
  trackingDays: string | null;
  daysInPeriod: string | null;
  daysLeft: string | null;
  coding: string | null;
  oasisQaRemarks: string | null;
  pocQaRemarks: string | null;
}

export interface RawDcRow extends BaseRawWorkbookRow {
  patientName: string | null;
  episodeDate: string | null;
  assignedStaff: string | null;
  payer: string | null;
  rfa: string | null;
  trackingDays: string | null;
  daysInPeriod: string | null;
  daysLeft: string | null;
  oasisQaRemarks: string | null;
  dcSummary: string | null;
}

export interface RawVisitNotesRow extends BaseRawWorkbookRow {
  patientName: string | null;
  medicareNumber: string | null;
  payer: string | null;
  socDate: string | null;
  episodePeriod: string | null;
  billingPeriod: string | null;
  status: string | null;
  oasisQa: string | null;
  oasisStatus: string | null;
  qa: string | null;
  sn: string | null;
  ptOtSt: string | null;
  hhaMsw: string | null;
  billingStatus: string | null;
}

export interface RawDizRow extends BaseRawWorkbookRow {
  patientName: string | null;
  episodeDateOrBillingPeriod: string | null;
  clinician: string | null;
  qaSpecialist: string | null;
  sn: string | null;
  rehab: string | null;
  hhaAndMsw: string | null;
  poAndOrder: string | null;
  status: string | null;
}

export type WorkbookSourceType =
  | "socPoc"
  | "dc"
  | "visitNotes"
  | "diz"
  | "trackingReport";

export interface ParsedWorkbookData {
  workbookPath: string;
  sheetNames: string[];
  socPocRows: RawSocPocRow[];
  dcRows: RawDcRow[];
  visitNotesRows: RawVisitNotesRow[];
  dizRows: RawDizRow[];
  warnings: string[];
  diagnostics: {
    sourceDetections: Array<{
      sourceType: WorkbookSourceType;
      detectedSheetName: string | null;
      detectionStatus: "detected" | "missing";
      headerRowNumber: number | null;
      headerMatchCount: number;
      minimumHeaderMatches: number;
      extractedRowCount: number;
    }>;
    sheetSummaries: Array<{
      sheetName: string;
      detectedSourceType: WorkbookSourceType | null;
      rowCount: number;
      headerRowNumber: number | null;
      headerMatchCount: number;
      detectedHeaders: Record<string, string>;
      extractedRowCount: number;
      excludedRows: Array<{
        sourceRowNumber: number;
        reason: string;
        sample: string | null;
      }>;
    }>;
  };
}

export interface MappedEpisodeFragment {
  workflowTypes: WorkflowType[];
  patientDisplayName: string;
  patientNormalizedName: string;
  medicareNumber: string | null;
  episodeKey: string;
  episodeContext: {
    episodeDate?: string | null;
    socDate?: string | null;
    episodePeriod?: string | null;
    billingPeriod?: string | null;
    payer?: string | null;
    assignedStaff?: string | null;
    clinician?: string | null;
    qaSpecialist?: string | null;
    rfa?: string | null;
    trackingDays?: number | null;
    daysInPeriod?: number | null;
    daysLeft?: number | null;
  };
  timingMetadata?: {
    trackingDays: number | null;
    daysInPeriod: number | null;
    daysLeft: number | null;
    daysLeftBeforeOasisDueDate: number | null;
    rawTrackingValues: string[];
    rawDaysInPeriodValues: string[];
    rawDaysLeftValues: string[];
  };
  stageStatuses: Partial<
    Pick<
      PatientEpisodeWorkItem,
      | "codingReviewStatus"
      | "oasisQaStatus"
      | "pocQaStatus"
      | "visitNotesQaStatus"
      | "billingPrepStatus"
    >
  >;
  sourceRemarks: StageRemark[];
  sourceRowReferences: SourceRowReference[];
  sourceValues: SourceValueSnapshot[];
  importWarnings: string[];
}

export interface AggregationResult {
  workItems: PatientEpisodeWorkItem[];
  parserExceptions: ParserException[];
}
