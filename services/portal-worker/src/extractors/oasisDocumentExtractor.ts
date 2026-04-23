import { type Page } from "@playwright/test";
import { type DetectDocumentKindResult, type DocumentExtractorOptions, type DocumentSectionDefinition } from "../types/documentExtraction";
import {
  appendCoverageWarnings,
  applySectionSummaries,
  buildDocumentMetadata,
  buildNormalizedDocumentResult,
  extractStructuralSections,
  finalizeSectionArtifacts,
  waitForDocumentReady,
} from "./shared/extractionHelpers";

const OASIS_SECTION_DEFINITIONS: readonly DocumentSectionDefinition[] = [
  {
    id: "patient-history",
    label: "Patient History",
    matchers: [/\bpatient history\b/i, /\bhistory\b/i],
  },
  {
    id: "diagnosis",
    label: "Diagnosis",
    matchers: [/\bdiagnos(?:is|es)\b/i, /\bprimary diagnosis\b/i],
    summaryField: "diagnosisSummary",
  },
  {
    id: "clinical-assessment",
    label: "Clinical Assessment",
    matchers: [/\bclinical assessment\b/i, /\bassessment\b/i],
  },
  {
    id: "functional-status",
    label: "Functional Status",
    matchers: [/\bfunctional status\b/i, /\bfunctional\b/i],
  },
  {
    id: "homebound-status",
    label: "Homebound Status",
    matchers: [/\bhomebound\b/i],
    summaryField: "homeboundSummary",
  },
  {
    id: "narrative-summary",
    label: "Narrative Summary",
    matchers: [/\bnarrative\b/i, /\bsummary\b/i],
  },
] as const;

export async function extractOasisDocument(
  page: Page,
  detection: DetectDocumentKindResult,
  options: DocumentExtractorOptions = {},
) {
  await waitForDocumentReady(page);
  const warnings = [...detection.warnings];
  const sections = await extractStructuralSections(page, OASIS_SECTION_DEFINITIONS, options, warnings);
  appendCoverageWarnings(detection, sections, warnings);
  const metadata = applySectionSummaries(await buildDocumentMetadata(page, warnings, options), sections);

  return buildNormalizedDocumentResult({
    page,
    detection,
    metadata,
    sections: finalizeSectionArtifacts(sections),
    warnings,
    options,
  });
}
