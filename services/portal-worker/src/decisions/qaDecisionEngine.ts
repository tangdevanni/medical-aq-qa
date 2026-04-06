import {
  type QaDecision,
  type QaDecisionResult,
  type VisitNoteQaRule,
  qaDecisionResultSchema,
} from "@medical-ai-qa/shared-types";
import { buildQaDecisionSummary } from "./decisionSummaryBuilder";
import {
  buildDecisionWarning,
  dedupeDecisionWarnings,
  emptyQaDecisionResult,
  type QaDecisionEngineInput,
} from "./decisionShared";
import { decideDiagnosisMismatch } from "./rules/decideDiagnosisMismatch";
import { decideFrequencyMismatch } from "./rules/decideFrequencyMismatch";
import { decideHomeboundMismatch } from "./rules/decideHomeboundMismatch";
import { decideMissingSection } from "./rules/decideMissingSection";
import { decideOrderReferenceMismatch } from "./rules/decideOrderReferenceMismatch";
import { decideSparseNote } from "./rules/decideSparseNote";

export function runQaDecisionEngine(
  input: QaDecisionEngineInput,
): QaDecisionResult {
  const warnings = collectDecisionWarnings(input);
  const decisions: QaDecision[] = [];

  for (const mismatch of input.crossDocumentQa.mismatches) {
    switch (mismatch.type) {
      case "DIAGNOSIS_MISMATCH":
        decisions.push(...decideDiagnosisMismatch(input, mismatch));
        break;
      case "FREQUENCY_MISMATCH":
        decisions.push(...decideFrequencyMismatch(input, mismatch));
        break;
      case "MISSING_HOMEBOUND_REASON":
        decisions.push(...decideHomeboundMismatch(input, mismatch));
        break;
      case "ORDER_NOT_REFERENCED":
        decisions.push(...decideOrderReferenceMismatch(input, mismatch));
        break;
    }
  }

  for (const rule of input.qaResult?.rules ?? []) {
    decisions.push(...decideVisitNoteRule(input, rule));
  }

  if (decisions.length === 0 && warnings.length === 0) {
    return emptyQaDecisionResult();
  }

  return qaDecisionResultSchema.parse({
    decisions,
    warnings,
    summary: buildQaDecisionSummary(decisions),
  });
}

function decideVisitNoteRule(
  input: QaDecisionEngineInput,
  rule: VisitNoteQaRule,
): QaDecision[] {
  if (rule.id === "sparse_note") {
    return decideSparseNote(input, rule);
  }

  return decideMissingSection(input, rule);
}

function collectDecisionWarnings(
  input: QaDecisionEngineInput,
) {
  const warnings = [...input.crossDocumentQa.warnings.map((warning) =>
    buildDecisionWarning({
      code: warning.code,
      message: warning.message,
    })
  )];

  if (input.currentDocument.documentKind === "UNKNOWN") {
    warnings.push(buildDecisionWarning({
      code: "UNKNOWN_DOCUMENT_KIND",
      message: "Current document kind remained unknown, so decisioning stayed conservative.",
    }));
  }

  if (input.crossDocumentQa.bundleConfidence === "LOW") {
    warnings.push(buildDecisionWarning({
      code: "LOW_BUNDLE_CONFIDENCE",
      message: input.crossDocumentQa.bundleReason ??
        "Document bundle confidence was low, so actionability was downgraded.",
    }));
  }

  if (input.currentDocument.documentKind === "VISIT_NOTE" && !input.qaResult) {
    warnings.push(buildDecisionWarning({
      code: "MISSING_VISIT_NOTE_QA",
      message: "Visit-note QA results were unavailable for the current visit-note decision pass.",
    }));
  }

  return dedupeDecisionWarnings(warnings);
}
