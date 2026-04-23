import { type QaDecision, type VisitNoteQaRule } from "@medical-ai-qa/shared-types";
import { type QaDecisionEngineInput } from "../decisionShared";

export function decideSparseNote(
  input: QaDecisionEngineInput,
  rule: VisitNoteQaRule,
): QaDecision[] {
  if (rule.id !== "sparse_note" || rule.status !== "NEEDS_REVIEW" || input.currentDocument.documentKind !== "VISIT_NOTE") {
    return [];
  }

  return [{
    decisionType: "PROPOSE_REVIEW",
    issueType: "sparse_note",
    actionability: "REVIEW_ONLY",
    autoFixEligibility: "NOT_ELIGIBLE",
    confidence: input.crossDocumentQa.bundleConfidence === "LOW" ? "LOW" : "MEDIUM",
    sourceOfTruth: {
      sourceDocumentKind: null,
      targetDocumentKind: "VISIT_NOTE",
      confidence: input.crossDocumentQa.bundleConfidence === "LOW" ? "LOW" : "MEDIUM",
      reason: "Sparse visit-note content requires operator review before any correction can be proposed.",
    },
    proposedAction: {
      targetDocumentKind: "VISIT_NOTE",
      targetField: null,
      action: "REVIEW_FIELD",
      proposedValue: null,
      changeStrategy: "NONE",
    },
    reason: "The visit note contained limited structural content and does not expose enough deterministic evidence for automated correction planning.",
    evidence: {
      sourceAnchors: [],
      targetAnchors: [],
      warningCodes: input.crossDocumentQa.warnings.map((warning) => warning.code),
    },
    humanReviewReasons: [
      ...(input.crossDocumentQa.bundleConfidence === "LOW"
        ? ["LOW_BUNDLE_CONFIDENCE", "EPISODE_ASSOCIATION_WEAK"] as const
        : []),
      "INSUFFICIENT_EVIDENCE",
    ],
  }];
}
