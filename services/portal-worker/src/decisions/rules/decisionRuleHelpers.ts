import {
  type QaDecision,
  type QaDecisionActionability,
  type QaDecisionAutoFixEligibility,
  type QaDecisionIssueType,
  type SourceOfTruthCandidate,
} from "@medical-ai-qa/shared-types";
import {
  type QaDecisionEngineInput,
  buildEvidenceAnchor,
  getCrossDocumentWarningCodes,
  getDocumentByKind,
} from "../decisionShared";
import { resolveSourceOfTruth } from "../sourceOfTruthResolver";

export function shouldEmitDecisionForCurrentDocument(
  input: QaDecisionEngineInput,
  targetDocumentKind: SourceOfTruthCandidate["targetDocumentKind"],
): boolean {
  if (!targetDocumentKind) {
    return input.currentDocument.documentKind === "VISIT_NOTE";
  }

  return input.currentDocument.documentKind === targetDocumentKind;
}

export function resolveDecisionContext(
  input: QaDecisionEngineInput,
  issueType: QaDecisionIssueType,
) {
  const resolution = resolveSourceOfTruth({
    issueType,
    bundle: input.bundle,
  });
  const sourceDocument = getDocumentByKind(input.bundle, resolution.sourceOfTruth?.sourceDocumentKind ?? null);
  const targetDocument = getDocumentByKind(input.bundle, resolution.sourceOfTruth?.targetDocumentKind ?? null);

  return {
    resolution,
    sourceDocument,
    targetDocument,
    warningCodes: getCrossDocumentWarningCodes(input.crossDocumentQa),
  };
}

export function buildCommonEvidence(input: {
  sourceDocumentKind: SourceOfTruthCandidate["sourceDocumentKind"];
  sourceField: string;
  sourceValue: string | null;
  targetDocumentKind: SourceOfTruthCandidate["targetDocumentKind"];
  targetField: string;
  targetValue: string | null;
  warningCodes: string[];
}) {
  const sourceAnchor = input.sourceDocumentKind
    ? buildEvidenceAnchor(input.sourceDocumentKind, input.sourceField, input.sourceValue)
    : null;
  const targetAnchor = input.targetDocumentKind
    ? buildEvidenceAnchor(input.targetDocumentKind, input.targetField, input.targetValue)
    : null;

  return {
    sourceAnchors: sourceAnchor ? [sourceAnchor] : [],
    targetAnchors: targetAnchor ? [targetAnchor] : [],
    warningCodes: input.warningCodes,
  };
}

export function determineDecisionType(
  actionability: QaDecisionActionability,
  hasProposedValue: boolean,
): QaDecision["decisionType"] {
  if (actionability === "NOT_ACTIONABLE") {
    return "PROPOSE_SKIP";
  }

  if (actionability === "REVIEW_ONLY") {
    return "PROPOSE_REVIEW";
  }

  return hasProposedValue ? "PROPOSE_UPDATE" : "PROPOSE_REVIEW";
}

export function determineAutoFixEligibility(input: {
  actionability: QaDecisionActionability;
  allowSafeAutofix: boolean;
  manualReviewReasons: string[];
}): QaDecisionAutoFixEligibility {
  if (input.actionability !== "ACTIONABLE") {
    return "NOT_ELIGIBLE";
  }

  if (input.allowSafeAutofix && input.manualReviewReasons.length === 0) {
    return "SAFE_AUTOFIX_CANDIDATE";
  }

  return "MANUAL_REVIEW_REQUIRED";
}
