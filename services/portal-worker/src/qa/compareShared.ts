import {
  type CrossDocumentQaAlignment,
  type CrossDocumentQaConfidence,
  type CrossDocumentQaMismatch,
  type CrossDocumentQaResult,
  type CrossDocumentQaWarning,
  type DocumentExtraction,
  type DocumentKind,
} from "@medical-ai-qa/shared-types";

export interface CrossDocumentQaEngineInput {
  visitNote: DocumentExtraction | null;
  oasis: DocumentExtraction | null;
  planOfCare: DocumentExtraction | null;
  orders: DocumentExtraction[];
  bundleConfidence?: CrossDocumentQaConfidence;
  bundleReason?: string | null;
}

export interface CrossDocumentComparisonResult {
  bundleConfidence?: CrossDocumentQaConfidence;
  bundleReason?: string | null;
  mismatches: CrossDocumentQaMismatch[];
  alignments: CrossDocumentQaAlignment[];
  warnings: CrossDocumentQaWarning[];
}

export interface ComparableAnchor {
  documentKind: DocumentKind;
  value: string;
  normalized: string;
  tokenSet: Set<string>;
}

export function emptyCrossDocumentQaResult(): CrossDocumentQaResult {
  return {
    bundleConfidence: "LOW",
    bundleReason: "Cross-document bundle was not computed.",
    mismatches: [],
    alignments: [],
    warnings: [],
  };
}

export function normalizeAnchorValue(value: string | null | undefined): ComparableAnchor | null {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length < 6) {
    return null;
  }

  const tokenSet = new Set(
    normalized
      .split(" ")
      .filter((token) => token.length >= 2),
  );

  if (tokenSet.size < 2) {
    return null;
  }

  return {
    documentKind: "UNKNOWN",
    value: normalized,
    normalized,
    tokenSet,
  };
}

export function makeComparableAnchor(
  documentKind: DocumentKind,
  value: string | null | undefined,
): ComparableAnchor | null {
  const base = normalizeAnchorValue(value);
  return base
    ? {
        ...base,
        documentKind,
      }
    : null;
}

export function anchorsLooselyAlign(
  left: ComparableAnchor,
  right: ComparableAnchor,
): boolean {
  if (left.normalized === right.normalized) {
    return true;
  }

  if (left.normalized.includes(right.normalized) || right.normalized.includes(left.normalized)) {
    return true;
  }

  return tokenOverlapRatio(left, right) >= 0.6;
}

export function tokenOverlapRatio(
  left: ComparableAnchor,
  right: ComparableAnchor,
): number {
  const smaller = left.tokenSet.size <= right.tokenSet.size ? left.tokenSet : right.tokenSet;
  const larger = left.tokenSet.size <= right.tokenSet.size ? right.tokenSet : left.tokenSet;

  if (smaller.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      overlap += 1;
    }
  }

  return overlap / smaller.size;
}

export function buildMismatch(input: {
  type: CrossDocumentQaMismatch["type"];
  confidence: CrossDocumentQaConfidence;
  reason: string;
  sources: DocumentKind[];
}): CrossDocumentQaMismatch {
  return {
    type: input.type,
    confidence: input.confidence,
    reason: input.reason,
    sources: dedupeKinds(input.sources),
  };
}

export function buildAlignment(input: {
  type: CrossDocumentQaAlignment["type"];
  confidence: CrossDocumentQaConfidence;
  reason: string;
  sources: DocumentKind[];
}): CrossDocumentQaAlignment {
  return {
    type: input.type,
    confidence: input.confidence,
    reason: input.reason,
    sources: dedupeKinds(input.sources),
  };
}

export function buildWarning(input: {
  code: string;
  message: string;
  sources?: DocumentKind[];
}): CrossDocumentQaWarning {
  return {
    code: input.code,
    message: input.message,
    sources: dedupeKinds(input.sources ?? []),
  };
}

export function mergeComparisonResults(
  ...results: CrossDocumentComparisonResult[]
): CrossDocumentQaResult {
  const baseResult = results[0] ?? emptyCrossDocumentQaResult();

  return {
    bundleConfidence: baseResult.bundleConfidence ?? "LOW",
    bundleReason: baseResult.bundleReason ?? "Cross-document bundle was not computed.",
    mismatches: dedupeByKey(results.flatMap((result) => result.mismatches), (item) =>
      `${item.type}:${item.sources.join("|")}:${item.reason}`,
    ),
    alignments: dedupeByKey(results.flatMap((result) => result.alignments), (item) =>
      `${item.type}:${item.sources.join("|")}:${item.reason}`,
    ),
    warnings: dedupeByKey(results.flatMap((result) => result.warnings), (item) =>
      `${item.code}:${item.sources.join("|")}:${item.message}`,
    ),
  };
}

export function compareConfidenceFromOverlap(overlap: number, aligned: boolean): CrossDocumentQaConfidence {
  if (aligned) {
    if (overlap >= 0.85) {
      return "HIGH";
    }

    return overlap >= 0.6 ? "MEDIUM" : "LOW";
  }

  if (overlap <= 0.1) {
    return "HIGH";
  }

  return overlap <= 0.3 ? "MEDIUM" : "LOW";
}

function dedupeKinds(values: DocumentKind[]): DocumentKind[] {
  return [...new Set(values)];
}

function dedupeByKey<T>(
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
