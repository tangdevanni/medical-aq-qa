import type { QaRouteCandidate, QaRouteClassification } from "../types/qaPrefetchResult";

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function classifyUrl(url: string): QaRouteClassification | null {
  const normalizedUrl = url.toLowerCase();
  if (/\/provider\/[^/]+\/documents(?:$|[?#/])/.test(normalizedUrl) && !/\/client\//.test(normalizedUrl)) {
    return "provider_documents";
  }
  if (/\/client\/[^/]+\/file-uploads(?:$|[?#/])/.test(normalizedUrl)) {
    return "patient_documents";
  }
  if (/\/client\/[^/]+\/(intake|calendar|profile|care-plan|notes)(?:$|[?#/])/.test(normalizedUrl)) {
    return "patient_chart";
  }

  return null;
}

function classifyLabel(label: string): QaRouteClassification | null {
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.includes("file uploads") || normalizedLabel.includes("doc uploads")) {
    return "patient_documents";
  }
  if (normalizedLabel.includes("documents")) {
    return "provider_documents";
  }
  if (
    normalizedLabel.includes("calendar") ||
    normalizedLabel.includes("overview") ||
    normalizedLabel.includes("patient dashboard") ||
    normalizedLabel.includes("care plan")
  ) {
    return "patient_chart";
  }

  return null;
}

export function resolveQaDocumentRouteCandidates(input: {
  currentUrl: string;
  sidebarLabels: string[];
  topVisibleText: string[];
}): QaRouteCandidate[] {
  const candidates: QaRouteCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: QaRouteCandidate) => {
    const key = `${candidate.classification}:${candidate.source}:${candidate.matchedValue.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  const urlClassification = classifyUrl(input.currentUrl);
  if (urlClassification) {
    pushCandidate({
      label: `Current URL indicates ${urlClassification.replace(/_/g, " ")}`,
      classification: urlClassification,
      source: "url",
      confidence: "high",
      matchedValue: input.currentUrl,
    });
  }

  for (const label of input.sidebarLabels) {
    const classification = classifyLabel(label);
    if (!classification) {
      continue;
    }

    pushCandidate({
      label,
      classification,
      source: "sidebar_label",
      confidence:
        classification === "patient_documents" || classification === "patient_chart"
          ? "high"
          : "medium",
      matchedValue: normalizeValue(label),
    });
  }

  for (const text of input.topVisibleText) {
    const classification = classifyLabel(text);
    if (!classification) {
      continue;
    }

    pushCandidate({
      label: text,
      classification,
      source: "page_text",
      confidence: "low",
      matchedValue: normalizeValue(text),
    });
  }

  return candidates;
}

export function selectQaDocumentRouteCandidate(
  candidates: QaRouteCandidate[],
): QaRouteCandidate | null {
  const rank = {
    patient_documents: 0,
    patient_chart: 1,
    provider_documents: 2,
    unknown: 3,
  } satisfies Record<QaRouteClassification, number>;
  const confidenceRank = {
    high: 0,
    medium: 1,
    low: 2,
  } as const;

  return [...candidates].sort((left, right) => {
    if (rank[left.classification] !== rank[right.classification]) {
      return rank[left.classification] - rank[right.classification];
    }

    return confidenceRank[left.confidence] - confidenceRank[right.confidence];
  })[0] ?? null;
}

export function summarizeQaSelectedRoute(candidate: QaRouteCandidate | null): string {
  if (!candidate) {
    return "No patient-specific route was confirmed from the chart page.";
  }

  return `${candidate.classification.replace(/_/g, " ")} via ${candidate.source}: ${candidate.label}`;
}
