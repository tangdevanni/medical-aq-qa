import {
  type CrossDocumentQaConfidence,
  type CrossDocumentQaResult,
  type DocumentExtraction,
  type DocumentKind,
  type QaDecisionEvidenceAnchor,
  type QaDecisionResult,
  type QaDecisionWarning,
  type QueueQaRowContext,
  type VisitNoteQaReport,
  qaDecisionResultSchema,
} from "@medical-ai-qa/shared-types";
import { sanitizeDocumentText } from "../extractors/shared/sanitizeText";

export interface DocumentExtractionBundle {
  visitNote: DocumentExtraction | null;
  oasis: DocumentExtraction | null;
  planOfCare: DocumentExtraction | null;
  orders: DocumentExtraction[];
  bundleConfidence: CrossDocumentQaConfidence;
  bundleReason: string | null;
}

export interface QaDecisionEngineInput {
  currentDocument: DocumentExtraction;
  qaResult: VisitNoteQaReport | null;
  crossDocumentQa: CrossDocumentQaResult;
  bundle: DocumentExtractionBundle;
  rowContext?: QueueQaRowContext;
}

type SupportedSummaryField =
  | "diagnosisSummary"
  | "frequencySummary"
  | "homeboundSummary"
  | "orderSummary";

export function emptyQaDecisionResult(): QaDecisionResult {
  return qaDecisionResultSchema.parse({
    decisions: [],
    warnings: [],
    summary: {
      actionableCount: 0,
      reviewOnlyCount: 0,
      notActionableCount: 0,
      safeAutofixCandidateCount: 0,
      manualReviewRequiredCount: 0,
      issuesByType: {},
      decisionsByTargetDocument: {},
    },
  });
}

export function buildDecisionWarning(input: {
  code: string;
  message: string;
  issueType?: QaDecisionWarning["issueType"];
}): QaDecisionWarning {
  return {
    code: input.code,
    message: input.message,
    issueType: input.issueType,
  };
}

export function buildEvidenceAnchor(
  documentKind: DocumentKind,
  field: string,
  value: string | null | undefined,
): QaDecisionEvidenceAnchor | null {
  const summary = sanitizeDocumentText(value, 72);
  if (!summary) {
    return null;
  }

  return {
    documentKind,
    field,
    summary,
  };
}

export function summarizeDocumentField(
  document: DocumentExtraction | null,
  field: SupportedSummaryField,
): string | null {
  if (!document) {
    return null;
  }

  return sanitizeDocumentText(document.metadata[field], 72);
}

export function bundleConfidenceIsLow(
  confidence: CrossDocumentQaConfidence,
): boolean {
  return confidence === "LOW";
}

export function dedupeDecisionWarnings(
  warnings: QaDecisionWarning[],
): QaDecisionWarning[] {
  const seen = new Set<string>();
  const unique: QaDecisionWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.issueType ?? ""}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(warning);
  }

  return unique;
}

export function getDocumentByKind(
  bundle: DocumentExtractionBundle,
  documentKind: DocumentKind | null,
): DocumentExtraction | null {
  switch (documentKind) {
    case "VISIT_NOTE":
      return bundle.visitNote;
    case "OASIS":
      return bundle.oasis;
    case "PLAN_OF_CARE":
      return bundle.planOfCare;
    case "ADMISSION_ORDER":
    case "PHYSICIAN_ORDER":
      return bundle.orders.find((document) => document.documentKind === documentKind) ?? null;
    default:
      return null;
  }
}

export function getCrossDocumentWarningCodes(
  result: CrossDocumentQaResult,
): string[] {
  return [...new Set(result.warnings.map((warning) => warning.code))];
}
