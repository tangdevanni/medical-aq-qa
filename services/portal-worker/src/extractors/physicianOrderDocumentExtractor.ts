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
import { sanitizeDocumentText } from "./shared/sanitizeText";

const PHYSICIAN_ORDER_SECTION_DEFINITIONS: readonly DocumentSectionDefinition[] = [
  {
    id: "order-summary",
    label: "Order Summary",
    matchers: [/\bphysician order\b/i, /\border summary\b/i, /\border type\b/i],
    summaryField: "orderSummary",
  },
  {
    id: "order-text",
    label: "Order Text",
    matchers: [/\border text\b/i, /\binstructions?\b/i, /\bdetails\b/i],
    summaryField: "orderSummary",
  },
  {
    id: "order-date",
    label: "Order Date",
    matchers: [/\border date\b/i, /\beffective date\b/i],
  },
  {
    id: "physician-staff",
    label: "Physician or Staff",
    matchers: [/\bphysician\b/i, /\ballowed practitioner\b/i, /\bprovider\b/i],
  },
  {
    id: "diagnosis",
    label: "Diagnosis Reference",
    matchers: [/\bdiagnos(?:is|es)\b/i],
    summaryField: "diagnosisSummary",
  },
] as const;

export async function extractPhysicianOrderDocument(
  page: Page,
  detection: DetectDocumentKindResult,
  options: DocumentExtractorOptions = {},
) {
  await waitForDocumentReady(page);
  const warnings = [...detection.warnings];
  const sections = await extractStructuralSections(page, PHYSICIAN_ORDER_SECTION_DEFINITIONS, options, warnings);
  appendCoverageWarnings(detection, sections, warnings);
  const metadata = applySectionSummaries(await buildDocumentMetadata(page, warnings, options), sections);

  return buildNormalizedDocumentResult({
    page,
    detection,
    metadata: {
      ...metadata,
      orderSummary: metadata.orderSummary ?? sanitizeDocumentText(metadata.documentLabel, 80),
    },
    sections: finalizeSectionArtifacts(sections),
    warnings,
    options,
  });
}
