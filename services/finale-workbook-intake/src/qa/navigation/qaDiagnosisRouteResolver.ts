import type {
  QaDiscoverySignal,
  QaLockStatus,
  QaVisibleDiagnosis,
} from "../types/qaPrefetchResult";

const DIAGNOSIS_PATTERNS = [
  /\bdiagnos(?:is|es)\b/i,
  /\bicd-?10\b/i,
  /\bactive diagnoses\b/i,
];

const ICD_CODE_PATTERN = /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b/;

function buildVisibleDiagnoses(lines: string[]): QaVisibleDiagnosis[] {
  const diagnoses: QaVisibleDiagnosis[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(line)) && !ICD_CODE_PATTERN.test(line)) {
      continue;
    }

    const normalized = line.trim().replace(/\s+/g, " ");
    if (/^(active diagnoses|diagnosis list)$/i.test(normalized)) {
      continue;
    }
    if (normalized.length < 6 || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());

    const codeMatch = normalized.match(ICD_CODE_PATTERN);
    diagnoses.push({
      text: normalized,
      code: codeMatch?.[1] ?? null,
      description: codeMatch
        ? normalized.replace(codeMatch[0], "").replace(/^[\s\-:]+/, "").trim() || null
        : null,
    });
  }

  return diagnoses.slice(0, 8);
}

export function resolveQaDiagnosisRoute(input: {
  currentUrl: string;
  sidebarLabels: string[];
  topVisibleText: string[];
  interactiveLabels: string[];
}): {
  found: boolean;
  signals: QaDiscoverySignal[];
  visibleDiagnoses: QaVisibleDiagnosis[];
  warnings: string[];
} {
  const signals: QaDiscoverySignal[] = [];

  if (DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(input.currentUrl))) {
    signals.push({
      source: "url",
      value: input.currentUrl,
    });
  }

  for (const label of input.sidebarLabels) {
    if (DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(label))) {
      signals.push({
        source: "sidebar_label",
        value: label,
      });
    }
  }

  for (const text of input.topVisibleText) {
    if (DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(text)) || ICD_CODE_PATTERN.test(text)) {
      signals.push({
        source: "page_text",
        value: text,
      });
    }
  }

  for (const label of input.interactiveLabels) {
    if (DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(label))) {
      signals.push({
        source: "interactive_label",
        value: label,
      });
    }
  }

  const visibleDiagnoses = buildVisibleDiagnoses(input.topVisibleText);

  return {
    found: signals.length > 0 || visibleDiagnoses.length > 0,
    signals,
    visibleDiagnoses,
    warnings:
      signals.length > 0 || visibleDiagnoses.length > 0
        ? []
        : ["No diagnosis route signals were detected from the visible QA prefetch surface."],
  };
}

export function detectQaLockStatus(input: {
  currentUrl: string;
  buttonLabels: string[];
  interactiveLabels: string[];
  topVisibleText: string[];
}): {
  status: QaLockStatus;
  signals: QaDiscoverySignal[];
} {
  const values = [
    input.currentUrl,
    ...input.buttonLabels,
    ...input.interactiveLabels,
    ...input.topVisibleText,
  ];
  const lockedSignals = values
    .filter((value) => /\block(?:ed)?\b/i.test(value))
    .map((value) => ({ source: "page_text" as const, value }));
  const unlockSignals = values
    .filter((value) => /\bunlock(?:ed)?\b/i.test(value))
    .map((value) => ({ source: "page_text" as const, value }));

  if (unlockSignals.length > 0) {
    return {
      status: "locked",
      signals: unlockSignals,
    };
  }

  if (lockedSignals.length > 0) {
    return {
      status: "unlocked",
      signals: lockedSignals,
    };
  }

  return {
    status: "unknown",
    signals: [],
  };
}
