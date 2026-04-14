import type { QaDiscoverySignal } from "../types/qaPrefetchResult";

const OASIS_PATTERNS = [
  /\boasis\b/i,
  /\bstart of care\b/i,
  /\bsoc\b/i,
  /\brecert/i,
];

export function resolveQaOasisRoute(input: {
  currentUrl: string;
  sidebarLabels: string[];
  topVisibleText: string[];
  buttonLabels: string[];
}): {
  found: boolean;
  signals: QaDiscoverySignal[];
  warnings: string[];
} {
  const signals: QaDiscoverySignal[] = [];

  if (OASIS_PATTERNS.some((pattern) => pattern.test(input.currentUrl))) {
    signals.push({
      source: "url",
      value: input.currentUrl,
    });
  }

  for (const label of input.sidebarLabels) {
    if (OASIS_PATTERNS.some((pattern) => pattern.test(label))) {
      signals.push({
        source: "sidebar_label",
        value: label,
      });
    }
  }

  for (const text of input.topVisibleText) {
    if (OASIS_PATTERNS.some((pattern) => pattern.test(text))) {
      signals.push({
        source: "page_text",
        value: text,
      });
    }
  }

  for (const label of input.buttonLabels) {
    if (OASIS_PATTERNS.some((pattern) => pattern.test(label))) {
      signals.push({
        source: "button",
        value: label,
      });
    }
  }

  return {
    found: signals.length > 0,
    signals,
    warnings: signals.length > 0 ? [] : ["No OASIS route signals were detected from the visible QA prefetch surface."],
  };
}
