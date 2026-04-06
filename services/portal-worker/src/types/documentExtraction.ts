import {
  type DocumentKind,
  type DocumentExtraction,
  type DocumentExtractionMetadata,
  type DocumentExtractionSection,
  type DocumentExtractionWarning,
  documentExtractionSchema,
} from "@medical-ai-qa/shared-types";

export type {
  DocumentExtraction,
  DocumentExtractionMetadata,
  DocumentExtractionSection,
  DocumentExtractionWarning,
};

export { documentExtractionSchema };

export interface DocumentExtractorOptions {
  includeSamples?: boolean;
  sampleMaxLength?: number;
  now?: () => Date;
  expectedDocumentKinds?: readonly DocumentKind[];
}

export interface DocumentSectionDefinition {
  id: string;
  label: string;
  matchers: RegExp[];
  minimumMeaningfulLength?: number;
  summaryField?: keyof Pick<
    DocumentExtractionMetadata,
    "diagnosisSummary" | "frequencySummary" | "homeboundSummary" | "orderSummary"
  >;
}

export interface DocumentDetectionSignals {
  url: string | null;
  title: string | null;
  headings: string[];
  fieldLabels: string[];
  sectionHeaders: string[];
  statusTexts: string[];
}

export interface DetectDocumentKindResult {
  documentKind: DocumentExtraction["documentKind"];
  pageType: DocumentExtraction["pageType"];
  warnings: DocumentExtractionWarning[];
}
