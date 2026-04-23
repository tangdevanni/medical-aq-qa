import { type DocumentExtraction } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { extractVisitNoteSnapshot } from "./visitNoteExtractor";
import { type DetectDocumentKindResult, type DocumentExtractorOptions } from "../types/documentExtraction";
import { normalizeText } from "../portal/utils/page-helpers";
import { sanitizeDocumentText, sanitizeDocumentTitle } from "./shared/sanitizeText";

export async function extractVisitNoteDocument(
  page: Page,
  detection: DetectDocumentKindResult,
  options: DocumentExtractorOptions = {},
): Promise<DocumentExtraction> {
  const snapshot = await extractVisitNoteSnapshot(page, options);
  const metadataSummaries = await extractVisitNoteSummaries(page);

  return {
    documentKind: "VISIT_NOTE",
    pageType: detection.pageType,
    url: snapshot.url,
    extractedAt: snapshot.extractedAt,
    metadata: {
      pageTitle: snapshot.metadata.pageTitle,
      documentLabel: sanitizeDocumentTitle(snapshot.metadata.noteType ?? snapshot.metadata.pageTitle, ["VISIT_NOTE"]),
      patientMaskedId: null,
      visitDate: snapshot.metadata.visitDate,
      physician: null,
      signedState: snapshot.metadata.signatureState,
      diagnosisSummary: metadataSummaries.diagnosisSummary,
      frequencySummary: metadataSummaries.frequencySummary,
      homeboundSummary: metadataSummaries.homeboundSummary,
      orderSummary: metadataSummaries.orderSummary,
    },
    sections: snapshot.sections.map((section) => ({
      id: section.id,
      label: section.label,
      present: section.present,
      visible: section.visible,
      textLength: section.textLength,
      hasMeaningfulContent: section.hasMeaningfulContent,
      sample: section.sample,
    })),
    warnings: [
      ...detection.warnings,
      ...snapshot.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        selector: warning.selector ?? null,
      })),
    ],
  };
}

async function extractVisitNoteSummaries(
  page: Page,
): Promise<Pick<DocumentExtraction["metadata"], "diagnosisSummary" | "frequencySummary" | "homeboundSummary" | "orderSummary">> {
  const [diagnosisText, visitSummaryText, functionalMobilityText] = await Promise.all([
    readSectionText(page, "#diagnosis-history"),
    readSectionText(page, "#visit-summary"),
    readSectionText(page, "#functional-mobility"),
  ]);

  return {
    diagnosisSummary: sanitizeDocumentText(diagnosisText, 80),
    frequencySummary: extractPatternSummary(
      [visitSummaryText, functionalMobilityText],
      /\b(?:frequency|daily|weekly|biweekly|monthly|every\s+\w+|\d+\s*x\s*(?:day|week|month))/i,
    ),
    homeboundSummary: extractPatternSummary(
      [visitSummaryText, functionalMobilityText],
      /\bhomebound\b/i,
    ),
    orderSummary: extractPatternSummary(
      [visitSummaryText],
      /\border(?:s|ed)?\b/i,
    ),
  };
}

async function readSectionText(
  page: Page,
  selector: string,
): Promise<string | null> {
  const locator = page.locator(selector).first();
  const present = (await locator.count().catch(() => 0)) > 0;
  if (!present) {
    return null;
  }

  return normalizeText(
    await locator.innerText().catch(async () => locator.textContent().catch(() => null)),
  );
}

function extractPatternSummary(
  values: Array<string | null>,
  pattern: RegExp,
): string | null {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || !pattern.test(normalized)) {
      continue;
    }

    return sanitizeDocumentText(normalized, 80);
  }

  return null;
}
