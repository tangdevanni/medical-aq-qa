import {
  type DecisionConfidence,
  type DocumentKind,
  type HumanReviewReason,
  type QaDecisionIssueType,
  type SourceOfTruthCandidate,
} from "@medical-ai-qa/shared-types";
import {
  type DocumentExtractionBundle,
  bundleConfidenceIsLow,
  getDocumentByKind,
  summarizeDocumentField,
} from "./decisionShared";

export interface SourceOfTruthResolution {
  sourceOfTruth: SourceOfTruthCandidate | null;
  humanReviewReasons: HumanReviewReason[];
}

export function resolveSourceOfTruth(input: {
  issueType: QaDecisionIssueType;
  bundle: DocumentExtractionBundle;
}): SourceOfTruthResolution {
  switch (input.issueType) {
    case "FREQUENCY_MISMATCH":
      return resolveFrequencySource(input.bundle);
    case "MISSING_HOMEBOUND_REASON":
      return resolveHomeboundSource(input.bundle);
    case "DIAGNOSIS_MISMATCH":
    case "missing_diagnosis":
      return resolveDiagnosisSource(input.bundle);
    case "ORDER_NOT_REFERENCED":
      return resolveOrderSource(input.bundle);
    case "missing_visit_summary":
      return resolveVisitSummarySource(input.bundle);
    case "missing_subjective":
    case "sparse_note":
    default:
      return {
        sourceOfTruth: {
          sourceDocumentKind: null,
          targetDocumentKind: "VISIT_NOTE",
          confidence: downgradeConfidence(
            "LOW",
            bundleConfidenceIsLow(input.bundle.bundleConfidence),
          ),
          reason: "No deterministic external source document was available for this visit-note narrative issue.",
        },
        humanReviewReasons: ["INSUFFICIENT_EVIDENCE"],
      };
  }
}

function resolveDiagnosisSource(
  bundle: DocumentExtractionBundle,
): SourceOfTruthResolution {
  return buildSourceResolution({
    candidates: collectCandidates(bundle, "diagnosisSummary", ["OASIS", "PLAN_OF_CARE"]),
    targetDocumentKind: "VISIT_NOTE",
    baseReason: "Diagnosis anchor was available in a supporting clinical document while the visit note differed or was missing.",
    lowBundle: bundleConfidenceIsLow(bundle.bundleConfidence),
  });
}

function resolveFrequencySource(
  bundle: DocumentExtractionBundle,
): SourceOfTruthResolution {
  const planOfCareValue = summarizeDocumentField(bundle.planOfCare, "frequencySummary");

  if (!planOfCareValue) {
    return {
      sourceOfTruth: {
        sourceDocumentKind: null,
        targetDocumentKind: "VISIT_NOTE",
        confidence: downgradeConfidence("LOW", bundleConfidenceIsLow(bundle.bundleConfidence)),
        reason: "No plan-of-care frequency summary was available to use as a deterministic source.",
      },
      humanReviewReasons: ["MISSING_SOURCE_ANCHOR"],
    };
  }

  return {
    sourceOfTruth: {
      sourceDocumentKind: "PLAN_OF_CARE",
      targetDocumentKind: "VISIT_NOTE",
      confidence: downgradeConfidence("HIGH", bundleConfidenceIsLow(bundle.bundleConfidence)),
      reason: "Plan of care is the narrow deterministic source for visit-frequency alignment.",
    },
    humanReviewReasons: bundleConfidenceIsLow(bundle.bundleConfidence)
      ? ["LOW_BUNDLE_CONFIDENCE", "EPISODE_ASSOCIATION_WEAK"]
      : [],
  };
}

function resolveHomeboundSource(
  bundle: DocumentExtractionBundle,
): SourceOfTruthResolution {
  const homeboundValue = summarizeDocumentField(bundle.oasis, "homeboundSummary");

  if (!homeboundValue) {
    return {
      sourceOfTruth: {
        sourceDocumentKind: null,
        targetDocumentKind: "VISIT_NOTE",
        confidence: downgradeConfidence("LOW", bundleConfidenceIsLow(bundle.bundleConfidence)),
        reason: "No OASIS homebound anchor was available to support a deterministic correction.",
      },
      humanReviewReasons: ["MISSING_SOURCE_ANCHOR"],
    };
  }

  return {
    sourceOfTruth: {
      sourceDocumentKind: "OASIS",
      targetDocumentKind: "VISIT_NOTE",
      confidence: downgradeConfidence("HIGH", bundleConfidenceIsLow(bundle.bundleConfidence)),
      reason: "OASIS is the narrow source document for homebound baseline alignment.",
    },
    humanReviewReasons: bundleConfidenceIsLow(bundle.bundleConfidence)
      ? ["LOW_BUNDLE_CONFIDENCE", "EPISODE_ASSOCIATION_WEAK"]
      : [],
  };
}

function resolveOrderSource(
  bundle: DocumentExtractionBundle,
): SourceOfTruthResolution {
  const candidates = bundle.orders
    .filter((document) => summarizeDocumentField(document, "orderSummary"))
    .map((document) => document.documentKind);
  const targetDocumentKind = bundle.visitNote ? "VISIT_NOTE" : bundle.planOfCare ? "PLAN_OF_CARE" : null;

  if (candidates.length === 0) {
    return {
      sourceOfTruth: {
        sourceDocumentKind: null,
        targetDocumentKind,
        confidence: downgradeConfidence("LOW", bundleConfidenceIsLow(bundle.bundleConfidence)),
        reason: "No sanitized order summary was available for deterministic decisioning.",
      },
      humanReviewReasons: ["MISSING_SOURCE_ANCHOR"],
    };
  }

  return {
    sourceOfTruth: {
      sourceDocumentKind: candidates[0],
      targetDocumentKind,
      confidence: downgradeConfidence(
        candidates.length > 1 ? "MEDIUM" : "HIGH",
        bundleConfidenceIsLow(bundle.bundleConfidence),
      ),
      reason: "Order documents are the source of truth for order-reference alignment.",
    },
    humanReviewReasons: [
      ...(candidates.length > 1 ? ["MULTIPLE_CANDIDATE_DOCUMENTS"] as const : []),
      ...(bundleConfidenceIsLow(bundle.bundleConfidence)
        ? ["LOW_BUNDLE_CONFIDENCE", "EPISODE_ASSOCIATION_WEAK"] as const
        : []),
    ],
  };
}

function resolveVisitSummarySource(
  bundle: DocumentExtractionBundle,
): SourceOfTruthResolution {
  return buildSourceResolution({
    candidates: collectCandidates(bundle, "diagnosisSummary", ["PLAN_OF_CARE", "OASIS"]),
    targetDocumentKind: "VISIT_NOTE",
    baseReason: "Supporting clinical documents were present, but visit-summary alignment remains narrative and review oriented.",
    lowBundle: bundleConfidenceIsLow(bundle.bundleConfidence),
  });
}

function collectCandidates(
  bundle: DocumentExtractionBundle,
  field: "diagnosisSummary" | "frequencySummary" | "homeboundSummary" | "orderSummary",
  kinds: DocumentKind[],
): DocumentKind[] {
  return kinds.filter((kind) => Boolean(summarizeDocumentField(getDocumentByKind(bundle, kind), field)));
}

function buildSourceResolution(input: {
  candidates: DocumentKind[];
  targetDocumentKind: DocumentKind | null;
  baseReason: string;
  lowBundle: boolean;
}): SourceOfTruthResolution {
  if (input.candidates.length === 0) {
    return {
      sourceOfTruth: {
        sourceDocumentKind: null,
        targetDocumentKind: input.targetDocumentKind,
        confidence: downgradeConfidence("LOW", input.lowBundle),
        reason: "No deterministic supporting source anchor was available.",
      },
      humanReviewReasons: ["MISSING_SOURCE_ANCHOR"],
    };
  }

  return {
    sourceOfTruth: {
      sourceDocumentKind: input.candidates[0],
      targetDocumentKind: input.targetDocumentKind,
      confidence: downgradeConfidence(
        input.candidates.length > 1 ? "MEDIUM" : "HIGH",
        input.lowBundle,
      ),
      reason: input.baseReason,
    },
    humanReviewReasons: [
      ...(input.candidates.length > 1 ? ["MULTIPLE_CANDIDATE_DOCUMENTS"] as const : []),
      ...(input.lowBundle ? ["LOW_BUNDLE_CONFIDENCE", "EPISODE_ASSOCIATION_WEAK"] as const : []),
    ],
  };
}

function downgradeConfidence(
  confidence: DecisionConfidence,
  lowBundle: boolean,
): DecisionConfidence {
  if (!lowBundle) {
    return confidence;
  }

  switch (confidence) {
    case "HIGH":
      return "MEDIUM";
    case "MEDIUM":
      return "LOW";
    case "LOW":
    default:
      return "LOW";
  }
}
