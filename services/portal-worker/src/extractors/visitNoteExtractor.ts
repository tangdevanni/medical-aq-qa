import { type Page } from "@playwright/test";
import { type VisitNoteQaMetadata, type VisitNoteQaSection, visitNoteQaSectionSchema } from "@medical-ai-qa/shared-types";
import { VISIT_NOTE_DETAIL_SELECTORS } from "../portal/selectors/visit-note-detail.selectors";
import {
  collectVisibleTextsFromSelectors,
  normalizeText,
  readFirstVisibleText,
  waitForPageSettled,
} from "../portal/utils/page-helpers";
import {
  type VisitNoteExtractionSnapshot,
  type VisitNoteExtractorOptions,
  type VisitNoteSectionDefinition,
  type VisitNoteQaSectionId,
  type VisitNoteQaWarning,
} from "../types/visitNoteQa";

const DEFAULT_SAMPLE_MAX_LENGTH = 96;
const MAX_SELECTOR_ATTEMPTS = 3;
const SELECTOR_RETRY_DELAY_MS = 200;
const STRICT_MEANINGFUL_CHAR_THRESHOLD = 30;
const STRICT_NON_MEANINGFUL_CHAR_THRESHOLD = 10;

const VISIT_NOTE_SECTION_DEFINITIONS: VisitNoteSectionDefinition[] = [
  {
    id: "subjective-info",
    selector: "#subjective-info",
    fallbackLabel: "Subjective Info",
    minimumMeaningfulLength: 31,
  },
  {
    id: "diagnosis-history",
    selector: "#diagnosis-history",
    fallbackLabel: "Diagnosis History",
    minimumMeaningfulLength: 31,
  },
  {
    id: "visit-summary",
    selector: "#visit-summary",
    fallbackLabel: "Visit Summary",
    minimumMeaningfulLength: 31,
  },
  {
    id: "safety-issues",
    selector: "#safety-issues",
    fallbackLabel: "Safety Issues",
    minimumMeaningfulLength: 31,
  },
  {
    id: "functional-mobility",
    selector: "#functional-mobility",
    fallbackLabel: "Functional Mobility",
    minimumMeaningfulLength: 31,
  },
];

const PLACEHOLDER_PATTERNS = [
  /^(n\/?a|na|null|none|unknown)$/i,
  /^(not documented|not entered|not available|not provided)$/i,
  /^(see above|same as above)$/i,
  /^(select|choose|click to add)$/i,
] as const;

const NEGATION_CONTENT_PATTERN = /^(no|denies|without)\b.+/i;
const DATE_PATTERN = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
const LONG_NUMBER_PATTERN = /\b\d{5,}\b/g;

export async function extractVisitNoteSnapshot(
  page: Page,
  options: VisitNoteExtractorOptions = {},
): Promise<VisitNoteExtractionSnapshot> {
  const warnings: VisitNoteQaWarning[] = [];

  try {
    await waitForPageSettled(page, 300);

    const url = page.url();
    const validation = await validateVisitNotePage(page, warnings);

    if (!validation.valid) {
      return buildEmptyVisitNoteSnapshot(page, options, warnings);
    }

    const [sections, metadata] = await Promise.all([
      extractSections(page, options, warnings),
      extractMetadata(page, warnings),
    ]);

    return {
      pageType: "visit_note",
      url,
      extractedAt: (options.now?.() ?? new Date()).toISOString(),
      sections,
      metadata,
      warnings,
    };
  } catch (error: unknown) {
    warnings.push({
      code: "visit_note_extraction_failed",
      message: error instanceof Error ? error.message : "Visit note extraction failed unexpectedly.",
    });

    return buildEmptyVisitNoteSnapshot(page, options, warnings);
  }
}

export function hasMeaningfulVisitNoteContent(
  text: string | null | undefined,
  options: {
    label?: string | null;
    minimumLength?: number;
  } = {},
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const bodyText = stripLabelOnlyLines(text, options.label);
  if (!bodyText) {
    return false;
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(bodyText))) {
    return false;
  }

  if (isRepeatedLabelText(bodyText, options.label)) {
    return false;
  }

  if (bodyText.length < STRICT_NON_MEANINGFUL_CHAR_THRESHOLD) {
    return false;
  }

  const alphaCharacters = (bodyText.match(/[A-Za-z]/g) ?? []).length;
  const uniqueWords = getUniqueWordCount(bodyText);
  const minimumLength = Math.max(
    options.minimumLength ?? STRICT_MEANINGFUL_CHAR_THRESHOLD + 1,
    STRICT_MEANINGFUL_CHAR_THRESHOLD + 1,
  );

  if (alphaCharacters < 6 || uniqueWords < 2) {
    return false;
  }

  if (bodyText.length > STRICT_MEANINGFUL_CHAR_THRESHOLD) {
    return true;
  }

  if (bodyText.length >= minimumLength && NEGATION_CONTENT_PATTERN.test(bodyText)) {
    return true;
  }

  return false;
}

export function sanitizeVisitNoteSample(
  text: string | null | undefined,
  options: VisitNoteExtractorOptions = {},
): string | null {
  if (!options.includeSamples) {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const maxLength = options.sampleMaxLength ?? DEFAULT_SAMPLE_MAX_LENGTH;
  const redacted = normalized
    .replace(DATE_PATTERN, "[date]")
    .replace(LONG_NUMBER_PATTERN, "[id]");

  return redacted.length > maxLength
    ? `${redacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : redacted;
}

async function extractSections(
  page: Page,
  options: VisitNoteExtractorOptions,
  warnings: VisitNoteQaWarning[],
): Promise<VisitNoteQaSection[]> {
  const sections: VisitNoteQaSection[] = [];

  for (const definition of VISIT_NOTE_SECTION_DEFINITIONS) {
    sections.push(await extractSection(page, definition, options, warnings));
  }

  return sections;
}

async function extractSection(
  page: Page,
  definition: VisitNoteSectionDefinition,
  options: VisitNoteExtractorOptions,
  warnings: VisitNoteQaWarning[],
): Promise<VisitNoteQaSection> {
  try {
    const sectionLocator = page.locator(definition.selector);
    const present = (await withSelectorRetries(
      page,
      async () => (await sectionLocator.count()) > 0,
      {
        code: "visit_note_section_presence_retry_exhausted",
        message: `Section presence check failed for ${definition.id}.`,
        sectionId: definition.id,
        selector: definition.selector,
      },
      warnings,
      false,
    ));
    const root = sectionLocator.first();

    if (!present) {
      return visitNoteQaSectionSchema.parse({
        id: definition.id,
        label: definition.fallbackLabel,
        present: false,
        visible: false,
        textLength: 0,
        hasMeaningfulContent: false,
        sample: null,
      });
    }

    const [visible, labelTexts, sectionText] = await Promise.all([
      withSelectorRetries(
        page,
        async () => root.isVisible(),
        {
          code: "visit_note_section_visibility_retry_exhausted",
          message: `Section visibility check failed for ${definition.id}.`,
          sectionId: definition.id,
          selector: definition.selector,
        },
        warnings,
        false,
      ),
      withSelectorRetries(
        page,
        async () => collectVisibleTextsFromSelectors(root, VISIT_NOTE_DETAIL_SELECTORS.sectionHeadingSelectors, 4),
        {
          code: "visit_note_section_heading_retry_exhausted",
          message: `Section heading extraction failed for ${definition.id}.`,
          sectionId: definition.id,
          selector: definition.selector,
        },
        warnings,
        [],
      ),
      withSelectorRetries(
        page,
        async () => {
          const innerText = await root.innerText().catch(() => null);
          return innerText ?? (await root.textContent().catch(() => null));
        },
        {
          code: "visit_note_section_text_retry_exhausted",
          message: `Section text extraction failed for ${definition.id}.`,
          sectionId: definition.id,
          selector: definition.selector,
        },
        warnings,
        null,
      ),
    ]);

    const label = normalizeText(labelTexts[0] ?? null) ?? definition.fallbackLabel;
    const normalizedText = normalizeText(sectionText) ?? "";
    const meaningfulBody = stripLabelOnlyLines(sectionText, label);
    const hasMeaningfulContent = hasMeaningfulVisitNoteContent(meaningfulBody, {
      label,
      minimumLength: definition.minimumMeaningfulLength,
    });

    return visitNoteQaSectionSchema.parse({
      id: definition.id,
      label,
      present,
      visible,
      textLength: normalizedText.length,
      hasMeaningfulContent,
      sample: hasMeaningfulContent ? sanitizeVisitNoteSample(meaningfulBody, options) : null,
    });
  } catch (error: unknown) {
    warnings.push({
      code: "visit_note_section_extract_failed",
      message:
        error instanceof Error
          ? error.message
          : `Section extraction failed for ${definition.id}.`,
      sectionId: definition.id,
      selector: definition.selector,
    });

    return visitNoteQaSectionSchema.parse({
      id: definition.id,
      label: definition.fallbackLabel,
      present: false,
      visible: false,
      textLength: 0,
      hasMeaningfulContent: false,
      sample: null,
    });
  }
}

async function extractMetadata(
  page: Page,
  warnings: VisitNoteQaWarning[],
): Promise<VisitNoteQaMetadata> {
  const [headingText, headingTexts, titleText, signatureState, visitDate] = await Promise.all([
    withSelectorRetries(
      page,
      async () => readFirstVisibleText(page, VISIT_NOTE_DETAIL_SELECTORS.pageTitleSelectors, 1_000),
      {
        code: "visit_note_title_retry_exhausted",
        message: "Visible visit-note title extraction failed.",
      },
      warnings,
      null,
    ),
    withSelectorRetries(
      page,
      async () => collectVisibleTextsFromSelectors(page, VISIT_NOTE_DETAIL_SELECTORS.pageTitleSelectors, 8),
      {
        code: "visit_note_title_list_retry_exhausted",
        message: "Visit-note title list extraction failed.",
      },
      warnings,
      [],
    ),
    withSelectorRetries(
      page,
      async () => page.title(),
      {
        code: "visit_note_page_title_retry_exhausted",
        message: "Browser page title extraction failed.",
      },
      warnings,
      null,
    ),
    extractSignatureState(page, warnings),
    extractVisitDate(page, warnings),
  ]);

  const pageTitle = normalizeText(headingText) ?? normalizeText(titleText);
  const noteType = detectNoteType([pageTitle, ...headingTexts]);

  return {
    noteType,
    pageTitle,
    documentRoute: extractDocumentRoute(page.url()),
    signatureState,
    visitDate,
  };
}

async function extractSignatureState(
  page: Page,
  warnings: VisitNoteQaWarning[],
): Promise<VisitNoteQaMetadata["signatureState"]> {
  const visibleTexts = await withSelectorRetries(
    page,
    async () =>
      collectVisibleTextsFromSelectors(
        page,
        VISIT_NOTE_DETAIL_SELECTORS.signatureStateSelectors,
        10,
      ),
    {
      code: "signature_state_extract_failed",
      message: "Signature state extraction failed.",
    },
    warnings,
    [],
  );

  const combinedText = visibleTexts.join(" ");
  const hasSigned = VISIT_NOTE_DETAIL_SELECTORS.signatureSignedPattern.test(combinedText);
  const hasUnsigned = VISIT_NOTE_DETAIL_SELECTORS.signatureUnsignedPattern.test(combinedText);

  if (hasSigned && hasUnsigned) {
    warnings.push({
      code: "ambiguous_signature_state",
      message: "Conflicting signed and unsigned indicators were detected on the visit note page.",
    });
    return null;
  }

  if (hasUnsigned) {
    return "unsigned";
  }

  if (hasSigned) {
    return "signed";
  }

  return null;
}

async function extractVisitDate(
  page: Page,
  warnings: VisitNoteQaWarning[],
): Promise<string | null> {
  const labelSelectors = [
    "label",
    "dt",
    "th",
    '[class*="label"]',
    '[class*="Label"]',
    '[class*="field-name"]',
    '[class*="FieldName"]',
  ] as const;
  const valueSelectors = [
    "dd",
    '[class*="value"]',
    '[class*="Value"]',
  ] as const;

  return withSelectorRetries(
    page,
    async () =>
      page.evaluate(
        ({ labelPatternSource, datePatternSource, labelSelectors, valueSelectors }) => {
          const labelPattern = new RegExp(labelPatternSource, "i");
          const datePattern = new RegExp(datePatternSource, "i");
          const runtime = globalThis as unknown as {
            document: {
              querySelectorAll: (selector: string) => ArrayLike<any>;
            };
            getComputedStyle: (node: any) => { visibility?: string; display?: string };
          };

          const isVisible = (element: any): boolean => {
            const style = runtime.getComputedStyle(element);
            const text = typeof element?.innerText === "string" ? element.innerText.trim() : "";
            return style.visibility !== "hidden" && style.display !== "none" && text.length > 0;
          };

          const readDate = (value: string | null | undefined): string | null => {
            const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
            const match = normalized.match(datePattern);
            return match ? match[0] : null;
          };

          for (const selector of labelSelectors) {
            const labels = runtime.document.querySelectorAll(selector);

            for (const label of Array.from(labels)) {
              if (!isVisible(label)) {
                continue;
              }

              const labelText = typeof label?.textContent === "string" ? label.textContent.replace(/\s+/g, " ").trim() : "";
              if (!labelPattern.test(labelText)) {
                continue;
              }

              const directCandidates = [
                label.nextElementSibling,
                label.parentElement?.nextElementSibling,
              ];

              for (const directCandidate of directCandidates) {
                const directMatch = readDate(directCandidate?.textContent);
                if (directCandidate && isVisible(directCandidate) && directMatch) {
                  return directMatch;
                }
              }

              for (const valueSelector of valueSelectors) {
                const nestedCandidate = label.parentElement?.querySelector(valueSelector);
                const nestedMatch = readDate(nestedCandidate?.textContent);
                if (nestedCandidate && isVisible(nestedCandidate) && nestedMatch) {
                  return nestedMatch;
                }
              }
            }
          }

          return null;
        },
        {
          labelPatternSource: VISIT_NOTE_DETAIL_SELECTORS.visitDateLabelPattern.source,
          datePatternSource: String.raw`\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b`,
          labelSelectors: [...labelSelectors],
          valueSelectors: [...valueSelectors],
        },
      ),
    {
      code: "visit_date_extract_failed",
      message: "Visit date extraction failed.",
    },
    warnings,
    null,
  );
}

async function validateVisitNotePage(
  page: Page,
  warnings: VisitNoteQaWarning[],
): Promise<{ valid: boolean }> {
  const routeMatched = VISIT_NOTE_DETAIL_SELECTORS.detailUrlPattern.test(page.url());
  let matchedSectionCount = 0;

  for (const definition of VISIT_NOTE_SECTION_DEFINITIONS) {
    const present = await withSelectorRetries(
      page,
      async () => (await page.locator(definition.selector).count()) > 0,
      {
        code: "visit_note_validation_retry_exhausted",
        message: `Validation failed while checking ${definition.id}.`,
        sectionId: definition.id,
        selector: definition.selector,
      },
      warnings,
      false,
    );

    if (present) {
      matchedSectionCount += 1;
    }
  }

  if (!routeMatched && matchedSectionCount === 0) {
    warnings.push({
      code: "invalid_visit_note_page",
      message: "Visit note validation failed before extraction because neither the expected route nor known section selectors were detected.",
      selector: VISIT_NOTE_DETAIL_SELECTORS.detailUrlPattern.source,
    });
  } else if (routeMatched && matchedSectionCount === 0) {
    warnings.push({
      code: "visit_note_sections_not_detected",
      message: "Visit note route matched, but none of the known section selectors were detected during validation.",
      selector: VISIT_NOTE_SECTION_DEFINITIONS.map((definition) => definition.selector).join(", "),
    });
  } else if (!routeMatched && matchedSectionCount > 0) {
    warnings.push({
      code: "unexpected_visit_note_route",
      message: "Known visit-note sections were detected even though the route did not match the expected visit-note pattern.",
      selector: VISIT_NOTE_DETAIL_SELECTORS.detailUrlPattern.source,
    });
  }

  return {
    valid: routeMatched || matchedSectionCount > 0,
  };
}

async function withSelectorRetries<T>(
  page: Page,
  operation: () => Promise<T>,
  warning: VisitNoteQaWarning,
  warnings: VisitNoteQaWarning[],
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

  if (lastError instanceof Error) {
    warnings.push({
      ...warning,
      message: `${warning.message} Retried ${MAX_SELECTOR_ATTEMPTS} times before falling back. ${lastError.message}`,
    });
  } else {
    warnings.push({
      ...warning,
      message: `${warning.message} Retried ${MAX_SELECTOR_ATTEMPTS} times before falling back.`,
    });
  }

  return fallback;
}

function buildEmptyVisitNoteSnapshot(
  page: Page,
  options: VisitNoteExtractorOptions,
  warnings: VisitNoteQaWarning[],
): VisitNoteExtractionSnapshot {
  return {
    pageType: "visit_note",
    url: page.url(),
    extractedAt: (options.now?.() ?? new Date()).toISOString(),
    sections: VISIT_NOTE_SECTION_DEFINITIONS.map((definition) =>
      visitNoteQaSectionSchema.parse({
        id: definition.id,
        label: definition.fallbackLabel,
        present: false,
        visible: false,
        textLength: 0,
        hasMeaningfulContent: false,
        sample: null,
      }),
    ),
    metadata: {
      noteType: null,
      pageTitle: null,
      documentRoute: extractDocumentRoute(page.url()),
      signatureState: null,
      visitDate: null,
    },
    warnings,
  };
}

function stripLabelOnlyLines(
  text: string | null | undefined,
  label?: string | null,
): string | null {
  const raw = typeof text === "string" ? text : "";
  const normalized = normalizeText(raw);
  if (!normalized) {
    return null;
  }

  const labelCandidates = new Set<string>();
  const normalizedLabel = normalizeLabel(label);
  if (normalizedLabel) {
    labelCandidates.add(normalizedLabel);
  }

  const lines = raw
    .split(/\r?\n/)
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const normalizedLine = normalizeLabel(value);
      return !normalizedLine || !labelCandidates.has(normalizedLine);
    });

  return normalizeText(lines.join(" ")) ?? normalized;
}

function isRepeatedLabelText(
  text: string,
  label?: string | null,
): boolean {
  const normalizedText = normalizeLabel(text);
  const normalizedLabel = normalizeLabel(label);

  if (!normalizedText || !normalizedLabel) {
    return false;
  }

  if (normalizedText === normalizedLabel) {
    return true;
  }

  return normalizedText === `${normalizedLabel} ${normalizedLabel}`;
}

function normalizeLabel(value: string | null | undefined): string | null {
  return normalizeText(value)?.toLowerCase().replace(/[:\-]/g, "").trim() ?? null;
}

function getUniqueWordCount(text: string): number {
  return new Set(
    text
      .toLowerCase()
      .match(/[a-z]{2,}/g)
      ?.filter(Boolean) ?? [],
  ).size;
}

function extractDocumentRoute(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function detectNoteType(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const match = value.match(
      /\b(therapy visit note|visit note(?:-[a-z]{2,3})?|pt visit note|ot visit note|st visit note)\b/i,
    );

    if (match) {
      return normalizeText(match[1]);
    }
  }

  return null;
}

export function getTrackedVisitNoteSectionIds(): VisitNoteQaSectionId[] {
  return [...VISIT_NOTE_DETAIL_SELECTORS.trackedSectionIds];
}
