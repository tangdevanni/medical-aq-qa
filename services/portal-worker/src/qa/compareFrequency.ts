import { type DocumentExtraction } from "@medical-ai-qa/shared-types";
import {
  anchorsLooselyAlign,
  buildAlignment,
  buildMismatch,
  buildWarning,
  compareConfidenceFromOverlap,
  makeComparableAnchor,
  tokenOverlapRatio,
  type CrossDocumentComparisonResult,
} from "./compareShared";

export function compareFrequency(input: {
  visitNote: DocumentExtraction | null;
  planOfCare: DocumentExtraction | null;
}): CrossDocumentComparisonResult {
  const sources = [input.visitNote, input.planOfCare].filter(
    (document): document is DocumentExtraction => Boolean(document),
  );

  if (!input.visitNote || !input.planOfCare) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "MISSING_FREQUENCY_DOCUMENT",
          message: "Frequency comparison requires both a visit note and a plan of care.",
          sources: sources.map((document) => document.documentKind),
        }),
      ],
    };
  }

  const visitAnchor = makeComparableAnchor("VISIT_NOTE", input.visitNote.metadata.frequencySummary);
  const planAnchor = makeComparableAnchor("PLAN_OF_CARE", input.planOfCare.metadata.frequencySummary);

  if (!visitAnchor || !planAnchor) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "MISSING_FREQUENCY_ANCHOR",
          message: "Frequency comparison was skipped because one or both documents did not expose a usable frequency summary.",
          sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
        }),
      ],
    };
  }

  const visitSignature = extractFrequencySignature(input.visitNote.metadata.frequencySummary);
  const planSignature = extractFrequencySignature(input.planOfCare.metadata.frequencySummary);
  if (visitSignature && planSignature) {
    return visitSignature === planSignature
      ? {
          mismatches: [],
          alignments: [
            buildAlignment({
              type: "FREQUENCY_ALIGNED",
              confidence: "HIGH",
              reason: "Visit-note and plan-of-care frequency signatures matched.",
              sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
            }),
          ],
          warnings: [],
        }
      : {
          mismatches: [
            buildMismatch({
              type: "FREQUENCY_MISMATCH",
              confidence: "HIGH",
              reason: "Visit-note and plan-of-care frequency signatures differed.",
              sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
            }),
          ],
          alignments: [],
          warnings: [],
        };
  }

  const overlap = tokenOverlapRatio(visitAnchor, planAnchor);
  const aligned = anchorsLooselyAlign(visitAnchor, planAnchor);

  return aligned
    ? {
        mismatches: [],
        alignments: [
          buildAlignment({
            type: "FREQUENCY_ALIGNED",
            confidence: compareConfidenceFromOverlap(overlap, true),
            reason: "Visit-note and plan-of-care frequency summaries loosely aligned.",
            sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
          }),
        ],
        warnings: [],
      }
    : {
        mismatches: [
          buildMismatch({
            type: "FREQUENCY_MISMATCH",
            confidence: compareConfidenceFromOverlap(overlap, false),
            reason: "Visit-note and plan-of-care frequency summaries did not loosely align.",
            sources: ["VISIT_NOTE", "PLAN_OF_CARE"],
          }),
        ],
        alignments: [],
        warnings: [],
      };
}

function extractFrequencySignature(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .replace(/\bonce\b/g, "1x")
    .replace(/\btwice\b/g, "2x")
    .replace(/\bthree times\b/g, "3x")
    .replace(/\s+/g, " ")
    .trim();

  const explicitCadence = normalized.match(/\b(\d+)\s*x\s*(?:per\s*)?(day|week|month|daily|weekly|monthly|biweekly)\b/);
  if (explicitCadence) {
    const unit = explicitCadence[2]
      .replace("daily", "day")
      .replace("weekly", "week")
      .replace("monthly", "month")
      .replace("biweekly", "biweekly");
    return `${explicitCadence[1]}x-${unit}`;
  }

  const simpleCadence = normalized.match(/\b(daily|weekly|biweekly|monthly)\b/);
  if (simpleCadence) {
    return simpleCadence[1];
  }

  const everyCadence = normalized.match(/\bevery\s+([a-z]+)\b/);
  if (everyCadence) {
    return `every-${everyCadence[1]}`;
  }

  return null;
}
