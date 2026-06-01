import type { VisitNoteFact, VisitNoteType } from "@medical-ai-qa/shared-types";

export type VisitNoteSummaryAgentResult = {
  summary: string;
  suggestedReviewerAction: string;
  confidence: number;
};

export function buildVisitNoteSummaryPrompt(visitType: VisitNoteType): string {
  return [
    "Return strict JSON only.",
    `Summarize the ${visitType} visit note for a QA reviewer.`,
    "Use only extracted visit-note facts and cited POC/OASIS context.",
  ].join(" ");
}

export function summarizeVisitNoteForReviewer(input: {
  visitType: VisitNoteType;
  facts: VisitNoteFact[];
  missingFields: string[];
  possibleContradictions: string[];
}): VisitNoteSummaryAgentResult {
  if (input.facts.length === 0) {
    return {
      summary: input.visitType === "others"
        ? "Non-clinical or unknown visit note counted but not analyzed."
        : "Clinical visit-note content has not been captured or extracted yet.",
      suggestedReviewerAction: input.missingFields.length > 0
        ? "Confirm whether the note should be completed or recaptured."
        : "No action unless this note should be clinically analyzed.",
      confidence: 0.68,
    };
  }
  return {
    summary: `${input.facts.length} extracted fact(s) were available for ${input.visitType}.`,
    suggestedReviewerAction: input.possibleContradictions.length > 0
      ? "Review the contradiction finding and determine whether it reflects improvement or documentation inconsistency."
      : input.missingFields.length > 0
        ? "Review missing-field suggestions before accepting the note."
        : "No immediate visit-note QA action from deterministic VN-1 checks.",
    confidence: 0.76,
  };
}
