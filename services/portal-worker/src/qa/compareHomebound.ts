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

export function compareHomebound(input: {
  visitNote: DocumentExtraction | null;
  oasis: DocumentExtraction | null;
}): CrossDocumentComparisonResult {
  if (!input.oasis) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "MISSING_OASIS_DOCUMENT",
          message: "Homebound comparison requires an OASIS document.",
          sources: [],
        }),
      ],
    };
  }

  const oasisAnchor = makeComparableAnchor("OASIS", input.oasis.metadata.homeboundSummary);
  if (!oasisAnchor) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "MISSING_OASIS_HOMEBOUND_ANCHOR",
          message: "Homebound comparison was skipped because OASIS did not expose a usable homebound summary.",
          sources: ["OASIS"],
        }),
      ],
    };
  }

  if (!input.visitNote) {
    return {
      mismatches: [
        buildMismatch({
          type: "MISSING_HOMEBOUND_REASON",
          confidence: "MEDIUM",
          reason: "OASIS exposed a homebound summary but no visit note was available for comparison.",
          sources: ["OASIS"],
        }),
      ],
      alignments: [],
      warnings: [],
    };
  }

  const visitAnchor = makeComparableAnchor("VISIT_NOTE", input.visitNote.metadata.homeboundSummary);
  if (!visitAnchor) {
    return {
      mismatches: [
        buildMismatch({
          type: "MISSING_HOMEBOUND_REASON",
          confidence: "HIGH",
          reason: "OASIS exposed a homebound summary but the visit note did not expose a corresponding homebound anchor.",
          sources: ["OASIS", "VISIT_NOTE"],
        }),
      ],
      alignments: [],
      warnings: [],
    };
  }

  const overlap = tokenOverlapRatio(oasisAnchor, visitAnchor);
  const aligned = anchorsLooselyAlign(oasisAnchor, visitAnchor);

  return aligned
    ? {
        mismatches: [],
        alignments: [
          buildAlignment({
            type: "HOMEBOUND_DOCUMENTED",
            confidence: compareConfidenceFromOverlap(overlap, true),
            reason: "Homebound summaries were present in both OASIS and visit note and loosely aligned.",
            sources: ["OASIS", "VISIT_NOTE"],
          }),
        ],
        warnings: [],
      }
    : {
        mismatches: [
          buildMismatch({
            type: "MISSING_HOMEBOUND_REASON",
            confidence: compareConfidenceFromOverlap(overlap, false),
            reason: "OASIS exposed a homebound summary but the visit-note anchor did not loosely align.",
            sources: ["OASIS", "VISIT_NOTE"],
          }),
        ],
        alignments: [],
        warnings: [],
      };
}
