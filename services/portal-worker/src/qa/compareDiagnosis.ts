import { type DocumentExtraction } from "@medical-ai-qa/shared-types";
import {
  anchorsLooselyAlign,
  buildAlignment,
  buildMismatch,
  buildWarning,
  compareConfidenceFromOverlap,
  makeComparableAnchor,
  mergeComparisonResults,
  tokenOverlapRatio,
  type CrossDocumentComparisonResult,
} from "./compareShared";

export function compareDiagnosis(input: {
  visitNote: DocumentExtraction | null;
  oasis: DocumentExtraction | null;
  planOfCare: DocumentExtraction | null;
}): CrossDocumentComparisonResult {
  const documents = [input.visitNote, input.oasis, input.planOfCare].filter(
    (document): document is DocumentExtraction => Boolean(document),
  );
  const comparable = documents
    .map((document) => ({
      document,
      anchor: makeComparableAnchor(document.documentKind, document.metadata.diagnosisSummary),
    }))
    .filter((entry) => Boolean(entry.anchor));

  if (documents.length < 2) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "MISSING_DIAGNOSIS_DOCUMENTS",
          message: "Diagnosis comparison requires at least two extracted clinical documents.",
          sources: documents.map((document) => document.documentKind),
        }),
      ],
    };
  }

  if (comparable.length < 2) {
    return {
      mismatches: [],
      alignments: [],
      warnings: [
        buildWarning({
          code: "MISSING_DIAGNOSIS_ANCHORS",
          message: "Diagnosis comparison was skipped because fewer than two documents exposed a diagnosis summary anchor.",
          sources: documents.map((document) => document.documentKind),
        }),
      ],
    };
  }

  const findings: CrossDocumentComparisonResult[] = [];
  for (let index = 0; index < comparable.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < comparable.length; otherIndex += 1) {
      const left = comparable[index]!;
      const right = comparable[otherIndex]!;
      const overlap = tokenOverlapRatio(left.anchor!, right.anchor!);
      const aligned = anchorsLooselyAlign(left.anchor!, right.anchor!);

      findings.push(aligned
        ? {
            mismatches: [],
            alignments: [
              buildAlignment({
                type: "DIAGNOSIS_ALIGNED",
                confidence: compareConfidenceFromOverlap(overlap, true),
                reason: "Diagnosis summaries loosely aligned across extracted documents.",
                sources: [left.document.documentKind, right.document.documentKind],
              }),
            ],
            warnings: [],
          }
        : {
            mismatches: [
              buildMismatch({
                type: "DIAGNOSIS_MISMATCH",
                confidence: compareConfidenceFromOverlap(overlap, false),
                reason: "Diagnosis summaries differed materially after loose normalization.",
                sources: [left.document.documentKind, right.document.documentKind],
              }),
            ],
            alignments: [],
            warnings: [],
          });
    }
  }

  return mergeComparisonResults(...findings);
}
