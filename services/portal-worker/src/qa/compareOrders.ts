import { type DocumentExtraction } from "@medical-ai-qa/shared-types";
import {
  anchorsLooselyAlign,
  buildAlignment,
  buildMismatch,
  buildWarning,
  compareConfidenceFromOverlap,
  makeComparableAnchor,
  tokenOverlapRatio,
  type ComparableAnchor,
  type CrossDocumentComparisonResult,
} from "./compareShared";

export function compareOrders(input: {
  visitNote: DocumentExtraction | null;
  planOfCare: DocumentExtraction | null;
  orders: DocumentExtraction[];
}): CrossDocumentComparisonResult {
  if (input.orders.length === 0) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "NO_ORDER_DOCUMENTS",
          message: "Order comparison was skipped because no order documents were available.",
        }),
      ],
    };
  }

  const referenceAnchors = buildReferenceAnchors(input.visitNote, input.planOfCare);
  if (referenceAnchors.length === 0) {
    return {
      mismatches: [
        buildMismatch({
          type: "ORDER_NOT_REFERENCED",
          confidence: "MEDIUM",
          reason: "Order documents were present, but no visit-note or plan-of-care reference anchors were available.",
          sources: input.orders.map((order) => order.documentKind),
        }),
      ],
      alignments: [],
      warnings: [],
    };
  }

  const results: CrossDocumentComparisonResult[] = [];
  for (const order of input.orders) {
    const orderAnchor = makeComparableAnchor(order.documentKind, order.metadata.orderSummary);
    if (!orderAnchor) {
      results.push({
        mismatches: [],
        alignments: [],
        warnings: [
          buildWarning({
            code: "MISSING_ORDER_SUMMARY",
            message: "An order document was available but did not expose a usable order summary anchor.",
            sources: [order.documentKind],
          }),
        ],
      });
      continue;
    }

    let bestMatch: ComparableAnchor | null = null;
    let bestOverlap = 0;

    for (const referenceAnchor of referenceAnchors) {
      const overlap = tokenOverlapRatio(orderAnchor, referenceAnchor);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = referenceAnchor;
      }

      if (anchorsLooselyAlign(orderAnchor, referenceAnchor)) {
        bestMatch = referenceAnchor;
        bestOverlap = overlap;
        break;
      }
    }

    if (bestMatch && anchorsLooselyAlign(orderAnchor, bestMatch)) {
      results.push({
        mismatches: [],
        alignments: [
          buildAlignment({
            type: "ORDER_REFERENCED",
            confidence: compareConfidenceFromOverlap(bestOverlap, true),
            reason: "An order summary loosely aligned with a note or plan-of-care reference anchor.",
            sources: [order.documentKind, bestMatch.documentKind],
          }),
        ],
        warnings: [],
      });
      continue;
    }

    results.push({
      mismatches: [
        buildMismatch({
          type: "ORDER_NOT_REFERENCED",
          confidence: compareConfidenceFromOverlap(bestOverlap, false),
          reason: "An order summary did not loosely align with any visit-note or plan-of-care reference anchor.",
          sources: [
            order.documentKind,
            ...referenceAnchors.map((referenceAnchor) => referenceAnchor.documentKind),
          ],
        }),
      ],
      alignments: [],
      warnings: [],
    });
  }

  return {
    mismatches: dedupe(results.flatMap((result) => result.mismatches), (value) =>
      `${value.type}:${value.sources.join("|")}:${value.reason}`,
    ),
    alignments: dedupe(results.flatMap((result) => result.alignments), (value) =>
      `${value.type}:${value.sources.join("|")}:${value.reason}`,
    ),
    warnings: dedupe(results.flatMap((result) => result.warnings), (value) =>
      `${value.code}:${value.sources.join("|")}:${value.message}`,
    ),
  };
}

function buildReferenceAnchors(
  visitNote: DocumentExtraction | null,
  planOfCare: DocumentExtraction | null,
): ComparableAnchor[] {
  const anchors: ComparableAnchor[] = [];
  const visitAnchors = [
    makeComparableAnchor("VISIT_NOTE", visitNote?.metadata.orderSummary ?? null),
    makeComparableAnchor("VISIT_NOTE", visitNote?.metadata.frequencySummary ?? null),
  ].filter((anchor): anchor is ComparableAnchor => Boolean(anchor));
  const planAnchors = [
    makeComparableAnchor("PLAN_OF_CARE", planOfCare?.metadata.orderSummary ?? null),
    makeComparableAnchor("PLAN_OF_CARE", planOfCare?.metadata.frequencySummary ?? null),
  ].filter((anchor): anchor is ComparableAnchor => Boolean(anchor));

  anchors.push(...visitAnchors, ...planAnchors);
  return anchors;
}

function dedupe<T>(
  values: T[],
  buildKey: (value: T) => string,
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const value of values) {
    const key = buildKey(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
}
