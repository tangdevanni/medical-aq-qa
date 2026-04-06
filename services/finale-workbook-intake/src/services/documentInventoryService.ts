import type {
  DocumentInventoryDiscipline,
  DocumentInventoryItem,
  DocumentInventoryNormalizedType,
  DocumentOpenBehavior,
} from "@medical-ai-qa/shared-types";

export interface DocumentInventoryCandidate {
  label: string;
  href?: string | null;
  contextText?: string | null;
  target?: string | null;
  download?: string | null;
}

export interface DocumentInventoryCandidateEvaluation {
  accepted: boolean;
  rejectionReason: string | null;
  openBehaviorGuess: DocumentOpenBehavior;
  item: DocumentInventoryItem;
}

const TYPE_PATTERNS: Array<{
  normalizedType: DocumentInventoryNormalizedType;
  patterns: RegExp[];
  confidence: number;
}> = [
  { normalizedType: "OASIS", patterns: [/\boasis\b/i, /\bassessment\b/i], confidence: 0.95 },
  { normalizedType: "POC", patterns: [/\bplan of care\b/i, /\bpoc\b/i], confidence: 0.95 },
  { normalizedType: "VISIT_NOTE", patterns: [/\bvisit note\b/i, /\bskilled nursing visit\b/i, /\bnursing note\b/i], confidence: 0.92 },
  { normalizedType: "ORDER", patterns: [/\bphysician order\b/i, /\border\b/i], confidence: 0.88 },
  { normalizedType: "COMMUNICATION", patterns: [/\bcommunication note\b/i, /\bcommunication\b/i], confidence: 0.88 },
  { normalizedType: "MISSED_VISIT", patterns: [/\bmissed visit\b/i], confidence: 0.94 },
  { normalizedType: "SUMMARY_30", patterns: [/\b30(?:-|\s)?day summary\b/i], confidence: 0.95 },
  { normalizedType: "SUMMARY_60", patterns: [/\b60(?:-|\s)?day summary\b/i], confidence: 0.95 },
  { normalizedType: "DC_SUMMARY", patterns: [/\bdc summary\b/i, /\bdischarge summary\b/i], confidence: 0.95 },
  { normalizedType: "SUPERVISORY", patterns: [/\bsupervisory visit\b/i, /\bsupervisory\b/i], confidence: 0.9 },
  { normalizedType: "INFECTION_REPORT", patterns: [/\binfection report\b/i, /\binfection\b/i], confidence: 0.88 },
  { normalizedType: "FALL_REPORT", patterns: [/\bfall report\b/i, /\bfall\b/i], confidence: 0.88 },
];

const DISCIPLINE_PATTERNS: Array<{
  discipline: DocumentInventoryDiscipline;
  patterns: RegExp[];
}> = [
  { discipline: "SN", patterns: [/\bSN\b/i, /\bskilled nursing\b/i, /\brn\b/i, /\blvn\b/i] },
  { discipline: "PT", patterns: [/\bPT\b/i, /\bphysical therapy\b/i, /\bpta\b/i] },
  { discipline: "OT", patterns: [/\bOT\b/i, /\boccupational therapy\b/i, /\bota\b/i] },
  { discipline: "ST", patterns: [/\bST\b/i, /\bspeech therapy\b/i] },
  { discipline: "HHA", patterns: [/\bHHA\b/i, /\bhome health aide\b/i] },
  { discipline: "RD", patterns: [/\bRD\b/i, /\bdietitian\b/i] },
  { discipline: "MSW", patterns: [/\bMSW\b/i, /\bmedical social worker\b/i] },
];

const NON_DOCUMENT_PATTERNS: RegExp[] = [
  /\bvisit map\b/i,
  /\bcalendar\b/i,
  /\bgoto patient page\b/i,
  /\bgo to patient page\b/i,
  /\bpatient page\b/i,
  /\bdashboard\b/i,
  /\broute map\b/i,
];

const DOCUMENT_HINT_PATTERNS: RegExp[] = [
  /\bdocument\b/i,
  /\battachment\b/i,
  /\bdownload\b/i,
  /\bpreview\b/i,
  /\.(pdf|docx?|xlsx?|txt)\b/i,
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function combinedText(candidate: DocumentInventoryCandidate): string {
  return normalizeWhitespace([candidate.label, candidate.contextText, candidate.href].filter(Boolean).join(" "));
}

function inferDiscipline(text: string): DocumentInventoryDiscipline {
  for (const entry of DISCIPLINE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.discipline;
    }
  }

  return "UNKNOWN";
}

function guessOpenBehavior(candidate: DocumentInventoryCandidate): DocumentOpenBehavior {
  const href = candidate.href ?? "";
  const target = candidate.target ?? "";
  const download = candidate.download ?? "";
  const text = combinedText(candidate);

  if (download || /\.(pdf|docx?|xlsx?|txt|rtf)\b/i.test(href)) {
    return "DOWNLOAD";
  }

  if (target === "_blank") {
    return "NEW_TAB";
  }

  if (/\bmodal\b|\bdialog\b|\bpreview\b/i.test(text)) {
    return "MODAL";
  }

  if (href) {
    return "SAME_PAGE";
  }

  return "UNKNOWN";
}

export function evaluateDocumentInventoryCandidate(
  candidate: DocumentInventoryCandidate,
): DocumentInventoryCandidateEvaluation {
  const text = combinedText(candidate);
  const evidence: string[] = [];
  let normalizedType: DocumentInventoryNormalizedType = "OTHER";
  let confidence = 0.35;

  for (const entry of TYPE_PATTERNS) {
    const matchedPattern = entry.patterns.find((pattern) => pattern.test(text));
    if (!matchedPattern) {
      continue;
    }

    normalizedType = entry.normalizedType;
    confidence = entry.confidence;
    evidence.push(`Matched ${matchedPattern} against '${candidate.label}'.`);
    break;
  }

  if (candidate.href) {
    evidence.push(`Discovered navigable href: ${candidate.href}`);
    if (/\/documents\//i.test(candidate.href)) {
      confidence = Math.min(1, confidence + 0.05);
    }
  }

  const openBehaviorGuess = guessOpenBehavior(candidate);
  const hrefLooksLikeDocument = /\/documents\//i.test(candidate.href ?? "") || /\.(pdf|docx?|xlsx?|txt)\b/i.test(candidate.href ?? "");
  const hasDocumentHint = TYPE_PATTERNS.some((entry) => entry.patterns.some((pattern) => pattern.test(text))) ||
    DOCUMENT_HINT_PATTERNS.some((pattern) => pattern.test(text)) ||
    hrefLooksLikeDocument;
  const isNavigationOnly = NON_DOCUMENT_PATTERNS.some((pattern) => pattern.test(text)) ||
    (/\/calendar\b/i.test(candidate.href ?? "") && !hrefLooksLikeDocument);
  const rejectionReason = isNavigationOnly && !hasDocumentHint
    ? "Navigation-only chart link; not a QA-relevant clinical document."
    : null;

  const item: DocumentInventoryItem = {
    sourceLabel: candidate.label,
    normalizedType,
    discipline: inferDiscipline(text),
    confidence,
    evidence,
    sourceUrl: candidate.href ?? null,
    sourcePath: null,
    discoveredAt: new Date().toISOString(),
    openBehavior: openBehaviorGuess,
  };

  return {
    accepted: rejectionReason === null,
    rejectionReason,
    openBehaviorGuess,
    item,
  };
}

export function classifyDocumentInventoryCandidate(
  candidate: DocumentInventoryCandidate,
): DocumentInventoryItem {
  return evaluateDocumentInventoryCandidate(candidate).item;
}

export function dedupeDocumentInventory(
  items: DocumentInventoryItem[],
): DocumentInventoryItem[] {
  const seen = new Set<string>();
  const deduped: DocumentInventoryItem[] = [];

  for (const item of items.sort((left, right) => right.confidence - left.confidence)) {
    const key = `${item.normalizedType}:${item.sourceLabel}:${item.sourceUrl ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}
