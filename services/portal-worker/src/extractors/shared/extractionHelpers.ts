import {
  type DocumentExtraction,
  type DocumentExtractionMetadata,
  type DocumentExtractionSection,
  type DocumentExtractionWarning,
  documentExtractionSchema,
} from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { DOCUMENT_EXTRACTION_SELECTORS } from "../../portal/selectors/document-extraction.selectors";
import {
  collectVisibleTextsFromSelectors,
  readFirstVisibleText,
  waitForPageSettled,
} from "../../portal/utils/page-helpers";
import {
  type DetectDocumentKindResult,
  type DocumentExtractorOptions,
  type DocumentSectionDefinition,
  type DocumentDetectionSignals,
} from "../../types/documentExtraction";
import { hasMeaningfulDocumentContent } from "./meaningfulContent";
import {
  collapseWhitespace,
  maskClinicianName,
  maskIdentifier,
  sanitizeDocumentText,
  sanitizeDocumentTitle,
} from "./sanitizeText";

const MAX_SELECTOR_ATTEMPTS = 3;
const SELECTOR_RETRY_DELAY_MS = 200;

export interface StructuralSectionArtifact {
  section: DocumentExtractionSection;
  summaryField: DocumentSectionDefinition["summaryField"];
  summaryCandidate: string | null;
}

export async function collectDocumentDetectionSignals(page: Page): Promise<DocumentDetectionSignals> {
  const [title, headings, fieldLabels, statusTexts] = await Promise.all([
    readFirstVisibleText(page, DOCUMENT_EXTRACTION_SELECTORS.pageTitleSelectors, 1_000),
    collectVisibleTextsFromSelectors(page, DOCUMENT_EXTRACTION_SELECTORS.headingSelectors, 20),
    collectVisibleTextsFromSelectors(page, DOCUMENT_EXTRACTION_SELECTORS.fieldLabelSelectors, 40),
    collectVisibleTextsFromSelectors(page, DOCUMENT_EXTRACTION_SELECTORS.statusSelectors, 20),
  ]);

  return {
    url: page.url(),
    title,
    headings,
    fieldLabels,
    sectionHeaders: headings,
    statusTexts,
  };
}

export async function buildDocumentMetadata(
  page: Page,
  warnings: DocumentExtractionWarning[],
  options: DocumentExtractorOptions = {},
): Promise<DocumentExtractionMetadata> {
  const [rawPageTitle, patientMaskedId, visitDate, physician, signedState] = await Promise.all([
    withSelectorRetries(
      page,
      async () => {
        const title =
          await readFirstVisibleText(page, DOCUMENT_EXTRACTION_SELECTORS.pageTitleSelectors, 1_000);
        return collapseWhitespace(title) ?? collapseWhitespace(await page.title().catch(() => null));
      },
      {
        code: "document_title_extract_failed",
        message: "Document title extraction failed.",
      },
      warnings,
      null,
    ),
    extractLabeledValue(page, DOCUMENT_EXTRACTION_SELECTORS.patientIdLabelPattern, warnings, maskIdentifier),
    extractLabeledValue(page, DOCUMENT_EXTRACTION_SELECTORS.visitDateLabelPattern, warnings, collapseWhitespace),
    extractLabeledValue(page, DOCUMENT_EXTRACTION_SELECTORS.physicianLabelPattern, warnings, maskClinicianName),
    extractSignedState(page, warnings),
  ]);
  const pageTitle = sanitizeDocumentTitle(rawPageTitle, options.expectedDocumentKinds ?? []);

  return {
    pageTitle,
    documentLabel: pageTitle,
    patientMaskedId,
    visitDate,
    physician,
    signedState,
    diagnosisSummary: null,
    frequencySummary: null,
    homeboundSummary: null,
    orderSummary: null,
  };
}

export async function extractStructuralSections(
  page: Page,
  definitions: readonly DocumentSectionDefinition[],
  options: DocumentExtractorOptions,
  warnings: DocumentExtractionWarning[],
): Promise<StructuralSectionArtifact[]> {
  const sections: StructuralSectionArtifact[] = [];

  for (const definition of definitions) {
    sections.push(await extractStructuralSection(page, definition, options, warnings));
  }

  return sections;
}

export function applySectionSummaries(
  metadata: DocumentExtractionMetadata,
  sections: readonly StructuralSectionArtifact[],
): DocumentExtractionMetadata {
  const updated = { ...metadata };

  for (const section of sections) {
    if (!section.summaryField || !section.summaryCandidate) {
      continue;
    }

    switch (section.summaryField) {
      case "diagnosisSummary":
        updated.diagnosisSummary ??= section.summaryCandidate;
        break;
      case "frequencySummary":
        updated.frequencySummary ??= section.summaryCandidate;
        break;
      case "homeboundSummary":
        updated.homeboundSummary ??= section.summaryCandidate;
        break;
      case "orderSummary":
        updated.orderSummary ??= section.summaryCandidate;
        break;
    }
  }

  return updated;
}

export async function buildNormalizedDocumentResult(input: {
  page: Page;
  detection: DetectDocumentKindResult;
  metadata: DocumentExtractionMetadata;
  sections: DocumentExtractionSection[];
  warnings: DocumentExtractionWarning[];
  options: DocumentExtractorOptions;
}): Promise<DocumentExtraction> {
  return documentExtractionSchema.parse({
    documentKind: input.detection.documentKind,
    pageType: input.detection.pageType,
    url: input.page.url(),
    extractedAt: (input.options.now?.() ?? new Date()).toISOString(),
    metadata: input.metadata,
    sections: input.sections,
    warnings: dedupeWarnings(input.warnings),
  });
}

export function finalizeSectionArtifacts(
  artifacts: readonly StructuralSectionArtifact[],
): DocumentExtractionSection[] {
  return artifacts.map((artifact) => artifact.section);
}

export function appendCoverageWarnings(
  detection: DetectDocumentKindResult,
  artifacts: readonly StructuralSectionArtifact[],
  warnings: DocumentExtractionWarning[],
): void {
  if (detection.documentKind === "UNKNOWN" || artifacts.length === 0) {
    return;
  }

  const presentCount = artifacts.filter((artifact) => artifact.section.present).length;
  const meaningfulCount = artifacts.filter((artifact) => artifact.section.hasMeaningfulContent).length;

  if (presentCount === 0) {
    warnings.push({
      code: "document_sections_not_detected",
      message: `No expected ${detection.pageType} sections were detected on the page.`,
    });
    return;
  }

  if (meaningfulCount === 0) {
    warnings.push({
      code: "document_sections_sparse",
      message: `Expected ${detection.pageType} sections were detected, but none contained meaningful structural content.`,
    });
  }
}

export async function waitForDocumentReady(page: Page): Promise<void> {
  await waitForPageSettled(page, 300);
}

export function buildEmptySections(
  definitions: readonly DocumentSectionDefinition[],
): DocumentExtractionSection[] {
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    present: false,
    visible: false,
    textLength: 0,
    hasMeaningfulContent: false,
    sample: null,
  }));
}

async function extractStructuralSection(
  page: Page,
  definition: DocumentSectionDefinition,
  options: DocumentExtractorOptions,
  warnings: DocumentExtractionWarning[],
): Promise<StructuralSectionArtifact> {
  const fallback = {
    section: {
      id: definition.id,
      label: definition.label,
      present: false,
      visible: false,
      textLength: 0,
      hasMeaningfulContent: false,
      sample: null,
    } satisfies DocumentExtractionSection,
    summaryField: definition.summaryField,
    summaryCandidate: null,
  } satisfies StructuralSectionArtifact;

  try {
    const result = await withSelectorRetries(
      page,
      async () =>
        page.evaluate(
          ({ matchers, sectionRoots, headingSelectors }) => {
            const runtime = globalThis as unknown as {
              document: {
                querySelectorAll: (selector: string) => ArrayLike<any>;
              };
              getComputedStyle: (node: any) => { visibility?: string; display?: string };
            };
            const patterns = matchers.map((source) => new RegExp(source, "i"));
            const normalize = (value: string | null | undefined): string | null => {
              const normalized = value?.replace(/\s+/g, " ").trim();
              return normalized ? normalized : null;
            };
            const isVisible = (element: any): boolean => {
              if (!element) {
                return false;
              }

              const style = runtime.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              const text = normalize(element.innerText ?? element.textContent);
              return style.visibility !== "hidden" &&
                style.display !== "none" &&
                rect.width > 0 &&
                rect.height > 0 &&
                Boolean(text);
            };
            const matchesAny = (value: string | null | undefined): boolean => {
              const normalized = normalize(value);
              return Boolean(normalized && patterns.some((pattern) => pattern.test(normalized)));
            };
            const matchesAnyInLeadingText = (value: string | null | undefined): boolean => {
              const normalized = normalize(value);
              if (!normalized) {
                return false;
              }

              return patterns.some((pattern) => pattern.test(normalized.slice(0, 180)));
            };
            const resolveRoot = (element: any): any => {
              let current: any = element;
              while (current) {
                if (sectionRoots.some((selector) => current?.matches(selector))) {
                  return current;
                }
                current = current.parentElement;
              }
              return element.parentElement ?? element;
            };
            const selector = headingSelectors.join(", ");
            const headings = runtime.document.querySelectorAll(selector);

            for (const heading of Array.from(headings)) {
              if (!isVisible(heading)) {
                continue;
              }

              const label = normalize(heading.innerText ?? heading.textContent);
              if (!matchesAny(label)) {
                continue;
              }

              const root = resolveRoot(heading);
              const rawText = normalize(root.innerText ?? root.textContent);

              return {
                present: true,
                visible: isVisible(root),
                label,
                rawText,
              };
            }

            const roots = runtime.document.querySelectorAll(sectionRoots.join(", "));
            for (const root of Array.from(roots)) {
              if (!isVisible(root)) {
                continue;
              }

              const rawText = normalize(root.innerText ?? root.textContent);
              if (!matchesAnyInLeadingText(rawText)) {
                continue;
              }

              const heading = Array.from(root.querySelectorAll(selector) as ArrayLike<any>)
                .find((node: any) => isVisible(node) && matchesAny(node.innerText ?? node.textContent));
              const label = normalize(heading?.innerText ?? heading?.textContent) ?? null;

              return {
                present: true,
                visible: true,
                label,
                rawText,
              };
            }

            return null;
          },
          {
            matchers: definition.matchers.map((matcher) => matcher.source),
            sectionRoots: [...DOCUMENT_EXTRACTION_SELECTORS.sectionRootSelectors],
            headingSelectors: [...DOCUMENT_EXTRACTION_SELECTORS.headingLikeSelectors],
          },
        ),
      {
        code: "document_section_extract_failed",
        message: `Document section extraction failed for ${definition.id}.`,
      },
      warnings,
      null,
    );

    if (!result?.present) {
      return fallback;
    }

    const rawText = collapseWhitespace(result.rawText) ?? "";
    const label = collapseWhitespace(result.label) ?? definition.label;
    const meaningful = hasMeaningfulDocumentContent(rawText, {
      label,
      minimumLength: definition.minimumMeaningfulLength ?? 24,
    });
    const summaryCandidate = meaningful ? sanitizeDocumentText(rawText, 80) : null;

    return {
      section: {
        id: definition.id,
        label,
        present: true,
        visible: Boolean(result.visible),
        textLength: rawText.length,
        hasMeaningfulContent: meaningful,
        sample: options.includeSamples && meaningful ? sanitizeDocumentText(rawText, options.sampleMaxLength ?? 96) : null,
      },
      summaryField: definition.summaryField,
      summaryCandidate,
    };
  } catch (error: unknown) {
    warnings.push({
      code: "document_section_extract_failed",
      message: error instanceof Error ? error.message : `Document section extraction failed for ${definition.id}.`,
    });
    return fallback;
  }
}

async function extractSignedState(
  page: Page,
  warnings: DocumentExtractionWarning[],
): Promise<DocumentExtractionMetadata["signedState"]> {
  const texts = await withSelectorRetries(
    page,
    async () => collectVisibleTextsFromSelectors(page, DOCUMENT_EXTRACTION_SELECTORS.statusSelectors, 20),
    {
      code: "document_status_extract_failed",
      message: "Document status extraction failed.",
    },
    warnings,
    [],
  );
  const combined = texts.join(" ");

  if (DOCUMENT_EXTRACTION_SELECTORS.signatureUnsignedPattern.test(combined)) {
    return "unsigned";
  }

  if (DOCUMENT_EXTRACTION_SELECTORS.signatureValidatedPattern.test(combined)) {
    return "validated";
  }

  if (DOCUMENT_EXTRACTION_SELECTORS.signatureSignedPattern.test(combined)) {
    return "signed";
  }

  return null;
}

async function extractLabeledValue(
  page: Page,
  labelPattern: RegExp,
  warnings: DocumentExtractionWarning[],
  sanitizer: (value: string | null | undefined) => string | null,
): Promise<string | null> {
  return withSelectorRetries(
    page,
    async () =>
      page.evaluate(
        ({ labelPatternSource, labelSelectors, valueSelectors }) => {
          const runtime = globalThis as unknown as {
            document: {
              querySelectorAll: (selector: string) => ArrayLike<any>;
            };
            getComputedStyle: (node: any) => { visibility?: string; display?: string };
          };
          const labelPattern = new RegExp(labelPatternSource, "i");
          const normalize = (value: string | null | undefined): string | null => {
            const normalized = value?.replace(/\s+/g, " ").trim();
            return normalized ? normalized : null;
          };
          const isVisible = (element: any): boolean => {
            if (!element) {
              return false;
            }

            const style = runtime.getComputedStyle(element);
            const text = normalize(element.innerText ?? element.textContent);
            return style.visibility !== "hidden" && style.display !== "none" && Boolean(text);
          };

          for (const selector of labelSelectors) {
            const labels = runtime.document.querySelectorAll(selector);
            for (const label of Array.from(labels)) {
              if (!isVisible(label)) {
                continue;
              }

              const labelText = normalize(label.innerText ?? label.textContent);
              if (!labelText || !labelPattern.test(labelText)) {
                continue;
              }

              const directCandidates = [
                label.nextElementSibling,
                label.parentElement?.nextElementSibling,
              ];
              for (const candidate of directCandidates) {
                if (!isVisible(candidate)) {
                  continue;
                }
                const candidateText = normalize(candidate.innerText ?? candidate.textContent);
                if (candidateText && candidateText !== labelText) {
                  return candidateText;
                }
              }

              for (const valueSelector of valueSelectors) {
                const nested = label.parentElement?.querySelector(valueSelector);
                if (!isVisible(nested)) {
                  continue;
                }
                const nestedText = normalize(nested.innerText ?? nested.textContent);
                if (nestedText && nestedText !== labelText) {
                  return nestedText;
                }
              }
            }
          }

          return null;
        },
        {
          labelPatternSource: labelPattern.source,
          labelSelectors: [...DOCUMENT_EXTRACTION_SELECTORS.fieldLabelSelectors],
          valueSelectors: [...DOCUMENT_EXTRACTION_SELECTORS.valueSelectors],
        },
      ),
    {
      code: "document_labeled_value_extract_failed",
      message: `Labeled value extraction failed for ${labelPattern.source}.`,
    },
    warnings,
    null,
  ).then((value) => sanitizer(value));
}

async function withSelectorRetries<T>(
  page: Page,
  operation: () => Promise<T>,
  warning: DocumentExtractionWarning,
  warnings: DocumentExtractionWarning[],
  fallback: T,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_SELECTOR_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < MAX_SELECTOR_ATTEMPTS) {
        await page.waitForTimeout(SELECTOR_RETRY_DELAY_MS);
      }
    }
  }

  warnings.push({
    ...warning,
    message: lastError instanceof Error
      ? `${warning.message} ${lastError.message}`
      : warning.message,
  });

  return fallback;
}

function dedupeWarnings(
  warnings: readonly DocumentExtractionWarning[],
): DocumentExtractionWarning[] {
  const seen = new Set<string>();
  const unique: DocumentExtractionWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}:${warning.selector ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(warning);
  }

  return unique;
}
