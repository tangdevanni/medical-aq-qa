export type OasisAssessmentProcessingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "VALIDATED"
  | "SIGNED"
  | "ESIGNED"
  | "FOR_EXPORT"
  | "LOCKED"
  | "UNKNOWN";

export type OasisAssessmentProcessingDecision = "PROCESS" | "SKIP";

export interface OasisAssessmentProcessingSummary {
  detectedStatuses: OasisAssessmentProcessingStatus[];
  primaryStatus: OasisAssessmentProcessingStatus;
  decision: OasisAssessmentProcessingDecision;
  processingEligible: boolean;
  reason: string;
  matchedSignals: string[];
}

const STATUS_PATTERNS: Array<{
  status: Exclude<OasisAssessmentProcessingStatus, "UNKNOWN">;
  pattern: RegExp;
}> = [
  { status: "NOT_STARTED", pattern: /\bnot started\b/i },
  { status: "IN_PROGRESS", pattern: /\bin progress\b/i },
  { status: "VALIDATED", pattern: /\bvalidated\b/i },
  { status: "FOR_EXPORT", pattern: /\bfor export\b/i },
  { status: "LOCKED", pattern: /\blocked\b/i },
  { status: "ESIGNED", pattern: /\be-?signed\b/i },
  { status: "SIGNED", pattern: /\bsigned\b/i },
];

const PRIMARY_STATUS_RANK: Record<OasisAssessmentProcessingStatus, number> = {
  FOR_EXPORT: 70,
  LOCKED: 60,
  VALIDATED: 50,
  IN_PROGRESS: 40,
  NOT_STARTED: 30,
  ESIGNED: 20,
  SIGNED: 10,
  UNKNOWN: 0,
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function humanizeStatus(value: OasisAssessmentProcessingStatus): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function derivePrimaryStatus(
  statuses: OasisAssessmentProcessingStatus[],
): OasisAssessmentProcessingStatus {
  return [...statuses].sort(
    (left, right) => PRIMARY_STATUS_RANK[right] - PRIMARY_STATUS_RANK[left],
  )[0] ?? "UNKNOWN";
}

export function deriveOasisAssessmentProcessingSummary(
  rawSignals: Array<string | null | undefined>,
): OasisAssessmentProcessingSummary {
  const normalizedSignals = rawSignals
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);

  const matchedSignals = normalizedSignals.filter((signal) =>
    STATUS_PATTERNS.some(({ status, pattern }) =>
      pattern.test(signal) && !(status === "SIGNED" && /\be-?signed\b/i.test(signal))
    ),
  );

  const detectedStatuses = [
    ...new Set(
      matchedSignals.flatMap((signal) =>
        STATUS_PATTERNS
          .filter(({ status, pattern }) =>
            pattern.test(signal) && !(status === "SIGNED" && /\be-?signed\b/i.test(signal))
          )
          .map(({ status }) => status),
      ),
    ),
  ];

  const primaryStatus =
    detectedStatuses.length > 0 ? derivePrimaryStatus(detectedStatuses) : "UNKNOWN";
  const skipStatuses = detectedStatuses.filter((status) =>
    status === "FOR_EXPORT" || status === "LOCKED"
  );
  const decision: OasisAssessmentProcessingDecision =
    skipStatuses.length > 0 ? "SKIP" : "PROCESS";

  return {
    detectedStatuses,
    primaryStatus,
    decision,
    processingEligible: decision === "PROCESS",
    reason:
      decision === "SKIP"
        ? `Skip downstream OASIS capture because the assessment page shows ${skipStatuses.map(humanizeStatus).join(" and ")}.`
        : detectedStatuses.length > 0
          ? `Continue downstream OASIS capture because no skip-only status was detected. Observed ${detectedStatuses.map(humanizeStatus).join(", ")}.`
          : "Continue downstream OASIS capture because no terminal OASIS page status was detected.",
    matchedSignals: matchedSignals.slice(0, 12),
  };
}
