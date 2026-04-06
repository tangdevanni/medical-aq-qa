import { type DocumentKind } from "@medical-ai-qa/shared-types";
import { WRITE_FIELD_SELECTORS } from "../portal/selectors/write-field.selectors";
import {
  type ResolvedFieldTarget,
  type TargetFieldMapping,
  type WritePageLike,
} from "../types/writeTargets";

const FIELD_SELECTOR_REGISTRY: TargetFieldMapping[] = [
  {
    targetDocumentKind: "VISIT_NOTE",
    targetField: "frequencySummary",
    interactionType: "textarea",
    candidates: [
      ...WRITE_FIELD_SELECTORS.visitNoteFrequencySummary.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WRITE_FIELD_SELECTORS.visitNoteFrequencySummary.labelPatterns.map((label) => ({
        kind: "label" as const,
        label,
        description: label.source,
      })),
    ],
  },
  {
    targetDocumentKind: "OASIS",
    targetField: "frequencySummary",
    interactionType: "textarea",
    candidates: [
      ...WRITE_FIELD_SELECTORS.oasisFrequencySummary.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WRITE_FIELD_SELECTORS.oasisFrequencySummary.labelPatterns.map((label) => ({
        kind: "label" as const,
        label,
        description: label.source,
      })),
    ],
  },
  {
    targetDocumentKind: "PLAN_OF_CARE",
    targetField: "frequencySummary",
    interactionType: "textarea",
    candidates: [
      ...WRITE_FIELD_SELECTORS.planOfCareFrequencySummary.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WRITE_FIELD_SELECTORS.planOfCareFrequencySummary.labelPatterns.map((label) => ({
        kind: "label" as const,
        label,
        description: label.source,
      })),
    ],
  },
  {
    targetDocumentKind: "ADMISSION_ORDER",
    targetField: "orderSummary",
    interactionType: "textarea",
    candidates: [
      ...WRITE_FIELD_SELECTORS.orderSummary.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WRITE_FIELD_SELECTORS.orderSummary.labelPatterns.map((label) => ({
        kind: "label" as const,
        label,
        description: label.source,
      })),
    ],
  },
  {
    targetDocumentKind: "PHYSICIAN_ORDER",
    targetField: "orderSummary",
    interactionType: "textarea",
    candidates: [
      ...WRITE_FIELD_SELECTORS.orderSummary.selectors.map((selector) => ({
        kind: "selector" as const,
        selector,
        description: selector,
      })),
      ...WRITE_FIELD_SELECTORS.orderSummary.labelPatterns.map((label) => ({
        kind: "label" as const,
        label,
        description: label.source,
      })),
    ],
  },
];

export function listTargetFieldMappings(): readonly TargetFieldMapping[] {
  return FIELD_SELECTOR_REGISTRY;
}

export function getTargetFieldMapping(
  targetDocumentKind: DocumentKind | null | undefined,
  targetField: string | null | undefined,
): TargetFieldMapping | null {
  if (!targetDocumentKind || !targetField) {
    return null;
  }

  return FIELD_SELECTOR_REGISTRY.find((entry) =>
    entry.targetDocumentKind === targetDocumentKind &&
    entry.targetField === targetField,
  ) ?? null;
}

export async function resolveFieldTarget(
  page: WritePageLike,
  mapping: TargetFieldMapping,
): Promise<{
  status: "FOUND" | "NOT_FOUND" | "AMBIGUOUS";
  selectorUsed: string | null;
  target: ResolvedFieldTarget | null;
}> {
  for (const candidate of mapping.candidates) {
    const locator = candidate.kind === "selector"
      ? page.locator(candidate.selector)
      : page.getByLabel(candidate.label);
    const visibleMatches = await collectVisibleMatches(locator);

    if (visibleMatches.length > 1) {
      return {
        status: "AMBIGUOUS",
        selectorUsed: candidate.description,
        target: null,
      };
    }

    if (visibleMatches.length === 1) {
      return {
        status: "FOUND",
        selectorUsed: candidate.description,
        target: {
          selectorUsed: candidate.description,
          interactionType: mapping.interactionType,
          locator: visibleMatches[0],
        },
      };
    }
  }

  return {
    status: "NOT_FOUND",
    selectorUsed: null,
    target: null,
  };
}

async function collectVisibleMatches(locator: ReturnType<WritePageLike["locator"]>) {
  const count = Math.min(await locator.count(), 5);
  const matches: Array<ReturnType<typeof locator.nth>> = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      matches.push(candidate);
    }
  }

  return matches;
}
