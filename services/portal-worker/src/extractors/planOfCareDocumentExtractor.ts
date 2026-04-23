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

const PLAN_OF_CARE_SECTION_DEFINITIONS: readonly DocumentSectionDefinition[] = [
  {
    id: "certification-period",
    label: "Certification Period",
    matchers: [/\bcertification period\b/i, /\bepisode period\b/i],
  },
  {
    id: "diagnosis",
    label: "Diagnosis",
    matchers: [/\bdiagnos(?:is|es)\b/i],
    summaryField: "diagnosisSummary",
  },
  {
    id: "goals-interventions",
    label: "Goals and Interventions",
    matchers: [/\bgoals?\b/i, /\binterventions?\b/i],
  },
  {
    id: "orders-frequency",
    label: "Orders and Frequency",
    matchers: [/\borders?\b/i, /\bfrequency\b/i],
    summaryField: "frequencySummary",
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

export async function extractPlanOfCareDocument(
  page: Page,
  detection: DetectDocumentKindResult,
  options: DocumentExtractorOptions = {},
) {
  await waitForDocumentReady(page);
  const warnings = [...detection.warnings];
  const sections = await extractStructuralSections(page, PLAN_OF_CARE_SECTION_DEFINITIONS, options, warnings);
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
