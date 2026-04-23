import {
  type VisitNoteQaMetadata,
  type VisitNoteQaReport,
  type VisitNoteQaRule,
  type VisitNoteQaSection,
  type VisitNoteQaSectionId,
  type VisitNoteQaSummary,
  type VisitNoteQaWarning,
} from "@medical-ai-qa/shared-types";

export type {
  VisitNoteQaMetadata,
  VisitNoteQaReport,
  VisitNoteQaRule,
  VisitNoteQaSection,
  VisitNoteQaSectionId,
  VisitNoteQaSummary,
  VisitNoteQaWarning,
};

export interface VisitNoteSectionDefinition {
  id: VisitNoteQaSectionId;
  selector: `#${string}`;
  fallbackLabel: string;
  minimumMeaningfulLength: number;
}

export interface VisitNoteExtractorOptions {
  includeSamples?: boolean;
  sampleMaxLength?: number;
  now?: () => Date;
}

export interface VisitNoteExtractionSnapshot {
  pageType: "visit_note";
  url: string;
  extractedAt: string;
  sections: VisitNoteQaSection[];
  metadata: VisitNoteQaMetadata;
  warnings: VisitNoteQaWarning[];
}
