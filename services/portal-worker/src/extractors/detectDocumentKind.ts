import { type DocumentExtractionWarning } from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { DOCUMENT_EXTRACTION_SELECTORS } from "../portal/selectors/document-extraction.selectors";
import { type DetectDocumentKindResult, type DocumentDetectionSignals, type DocumentExtractorOptions } from "../types/documentExtraction";
import { collectDocumentDetectionSignals } from "./shared/extractionHelpers";

interface DetectionCandidate {
  kind: DetectDocumentKindResult["documentKind"];
  score: number;
}

const KIND_TO_PAGE_TYPE: Record<DetectDocumentKindResult["documentKind"], DetectDocumentKindResult["pageType"]> = {
  VISIT_NOTE: "visit_note",
  OASIS: "oasis",
  PLAN_OF_CARE: "plan_of_care",
  ADMISSION_ORDER: "admission_order",
  PHYSICIAN_ORDER: "physician_order",
  UNKNOWN: "unknown",
};

const KIND_PATTERNS: Record<Exclude<DetectDocumentKindResult["documentKind"], "UNKNOWN">, RegExp[]> = {
  VISIT_NOTE: [
    /\bvisit note\b/i,
    /\btherapy visit note\b/i,
    /\bsubjective info\b/i,
    /\bvisit summary\b/i,
  ],
  OASIS: [
    /\boasis\b/i,
    /\bclinical assessment\b/i,
    /\bfunctional status\b/i,
    /\bpatient history\b/i,
  ],
  PLAN_OF_CARE: [
    /\bplan of care\b/i,
    /\bcertification period\b/i,
    /\bgoals?\b/i,
    /\binterventions?\b/i,
    /\bhomebound\b/i,
  ],
  ADMISSION_ORDER: [
    /\badmission order\b/i,
    /\badmit(?:ted|ting)?\b/i,
    /\bstart of care order\b/i,
  ],
  PHYSICIAN_ORDER: [
    /\bphysician order\b/i,
    /\border type\b/i,
    /\bphysician or allowed practitioner\b/i,
  ],
};

export async function detectDocumentKind(
  page: Page,
  options: DocumentExtractorOptions = {},
): Promise<DetectDocumentKindResult> {
  return detectDocumentKindFromSignals(await collectDocumentDetectionSignals(page), options);
}

export function detectDocumentKindFromSignals(
  signals: DocumentDetectionSignals,
  options: Pick<DocumentExtractorOptions, "expectedDocumentKinds"> = {},
): DetectDocumentKindResult {
  const warnings: DocumentExtractionWarning[] = [];
  const expectedKinds = new Set(options.expectedDocumentKinds ?? []);
  const url = signals.url ?? "";
  const title = signals.title ?? "";
  const headings = uniqueSignals([...signals.headings, ...signals.sectionHeaders]);
  const fieldLabels = uniqueSignals(signals.fieldLabels);
  const statusTexts = uniqueSignals(signals.statusTexts);

  const candidates: DetectionCandidate[] = [
    scoreKind("VISIT_NOTE", {
      routeMatched: DOCUMENT_EXTRACTION_SELECTORS.visitNoteUrlPattern.test(url),
      routeWeight: 4,
      title,
      headings,
      fieldLabels,
      statusTexts,
      hintMatched: expectedKinds.has("VISIT_NOTE"),
    }),
    scoreKind("OASIS", {
      routeMatched: DOCUMENT_EXTRACTION_SELECTORS.oasisUrlPattern.test(url),
      routeWeight: 4,
      title,
      headings,
      fieldLabels,
      statusTexts,
      hintMatched: expectedKinds.has("OASIS"),
    }),
    scoreKind("PLAN_OF_CARE", {
      routeMatched: DOCUMENT_EXTRACTION_SELECTORS.planOfCareUrlPattern.test(url),
      routeWeight: 4,
      title,
      headings,
      fieldLabels,
      statusTexts,
      hintMatched: expectedKinds.has("PLAN_OF_CARE"),
    }),
    scoreKind("ADMISSION_ORDER", {
      routeMatched: DOCUMENT_EXTRACTION_SELECTORS.admissionOrderUrlPattern.test(url),
      routeWeight: 4,
      title,
      headings,
      fieldLabels,
      statusTexts,
      hintMatched: expectedKinds.has("ADMISSION_ORDER"),
    }),
    scoreKind("PHYSICIAN_ORDER", {
      routeMatched: DOCUMENT_EXTRACTION_SELECTORS.physicianOrderUrlPattern.test(url),
      routeWeight: 1,
      title,
      headings,
      fieldLabels,
      statusTexts,
      hintMatched: expectedKinds.has("PHYSICIAN_ORDER"),
    }),
  ];

  const ranked = [...candidates].sort((left, right) => right.score - left.score);
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (!top || top.score <= 0) {
    warnings.push({
      code: "document_kind_unknown",
      message: "Document kind could not be determined from the current route and visible structure.",
    });

    return {
      documentKind: "UNKNOWN",
      pageType: "unknown",
      warnings,
    };
  }

  if (runnerUp && runnerUp.score > 0 && top.score - runnerUp.score <= 1) {
    warnings.push({
      code: "document_kind_ambiguous",
      message: "Document kind signals were ambiguous across multiple supported document types.",
    });

    return {
      documentKind: "UNKNOWN",
      pageType: "unknown",
      warnings,
    };
  }

  if (expectedKinds.size > 0 && !expectedKinds.has(top.kind)) {
    const hintedCandidate = ranked.find((candidate) => expectedKinds.has(candidate.kind));
    if (hintedCandidate && top.score - hintedCandidate.score <= 1) {
      warnings.push({
        code: "document_kind_conflicts_with_expected_type",
        message: "Detected document kind conflicted with the expected queue-side document type.",
      });

      return {
        documentKind: "UNKNOWN",
        pageType: "unknown",
        warnings,
      };
    }

    warnings.push({
      code: "document_kind_differs_from_expected_type",
      message: `Detected ${top.kind} even though queue-side expectations favored ${[...expectedKinds].join(", ")}.`,
    });
  }

  return {
    documentKind: top.kind,
    pageType: KIND_TO_PAGE_TYPE[top.kind],
    warnings,
  };
}

function scoreKind(
  kind: Exclude<DetectDocumentKindResult["documentKind"], "UNKNOWN">,
  input: {
    routeMatched: boolean;
    routeWeight: number;
    title: string;
    headings: readonly string[];
    fieldLabels: readonly string[];
    statusTexts: readonly string[];
    hintMatched: boolean;
  },
): DetectionCandidate {
  let score = 0;

  if (input.routeMatched) {
    score += input.routeWeight;
  }

  if (input.hintMatched) {
    score += 1;
  }

  for (const pattern of KIND_PATTERNS[kind]) {
    if (pattern.test(input.title)) {
      score += 2;
    }

    if (input.headings.some((value) => pattern.test(value))) {
      score += 2;
    }

    if (input.fieldLabels.some((value) => pattern.test(value))) {
      score += 1;
    }

    if (input.statusTexts.some((value) => pattern.test(value))) {
      score += 1;
    }
  }

  return { kind, score };
}

function uniqueSignals(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
