import { type RunReliabilityRecord } from "../types/reliabilityIntelligence";
import {
  type DriftSignal,
  type SelectorHealthRecord,
  type SupportDisposition,
} from "../types/runtimeDiagnostics";

export const DEFAULT_RELIABILITY_WINDOW_RUNS = 20;
export const MIN_SAMPLE_SIZE = 3;
export const SCORING_POLICY_VERSION = "phase20-v2";

export const WRITE_EXECUTION_GUARD_FAILURES = new Set([
  "TARGET_SELECTOR_NOT_FOUND",
  "TARGET_SELECTOR_AMBIGUOUS",
  "SELECTOR_HEALTH_DEGRADED",
  "SELECTOR_CARDINALITY_UNEXPECTED",
  "PAGE_KIND_MISMATCH",
  "EXECUTABLE_CONTROL_MISSING",
  "EXECUTABLE_CONTROL_AMBIGUOUS",
  "RETRY_EXHAUSTED",
  "POST_SAVE_SIGNAL_MISSING",
  "POST_WRITE_VERIFICATION_FAILED",
]);

export const WORKFLOW_EXECUTION_GUARD_FAILURES = new Set([
  "SELECTOR_HEALTH_DEGRADED",
  "SELECTOR_CARDINALITY_UNEXPECTED",
  "PAGE_KIND_MISMATCH",
  "EXECUTABLE_CONTROL_MISSING",
  "EXECUTABLE_CONTROL_AMBIGUOUS",
  "RETRY_EXHAUSTED",
  "POST_STEP_VERIFICATION_FAILED",
  "POST_SAVE_SIGNAL_MISSING",
  "POST_VALIDATE_SIGNAL_MISSING",
  "PAGE_STATE_AMBIGUOUS",
]);

export function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

export function clampUnit(value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

export function toNamedCounts(values: readonly string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

export function takeRecentRuns(
  records: readonly RunReliabilityRecord[],
  maxRuns: number,
): RunReliabilityRecord[] {
  return [...records]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-maxRuns);
}

export function splitRuns(records: readonly RunReliabilityRecord[]) {
  if (records.length <= 1) {
    return {
      previous: [] as RunReliabilityRecord[],
      recent: [...records],
    };
  }

  const midpoint = Math.max(1, Math.floor(records.length / 2));

  return {
    previous: records.slice(0, records.length - midpoint),
    recent: records.slice(records.length - midpoint),
  };
}

export function classifyTrend(input: {
  recentValue: number;
  previousValue: number;
  threshold?: number;
  higherIsBetter?: boolean;
}): "IMPROVING" | "STABLE" | "DEGRADING" {
  const delta = input.recentValue - input.previousValue;
  const threshold = input.threshold ?? 0.05;

  if (Math.abs(delta) < threshold) {
    return "STABLE";
  }

  if (input.higherIsBetter === false) {
    return delta < 0 ? "IMPROVING" : "DEGRADING";
  }

  return delta > 0 ? "IMPROVING" : "DEGRADING";
}

export function classifyReliabilityLevel(input: {
  score: number;
  sampleSize: number;
  stableThreshold?: number;
  degradedThreshold?: number;
  minimumSampleSize?: number;
}): "STABLE" | "DEGRADED" | "UNSTABLE" | "INSUFFICIENT_DATA" {
  const minimumSampleSize = input.minimumSampleSize ?? MIN_SAMPLE_SIZE;
  const stableThreshold = input.stableThreshold ?? 0.9;
  const degradedThreshold = input.degradedThreshold ?? 0.65;

  if (input.sampleSize < minimumSampleSize) {
    return "INSUFFICIENT_DATA";
  }

  if (input.score >= stableThreshold) {
    return "STABLE";
  }

  if (input.score >= degradedThreshold) {
    return "DEGRADED";
  }

  return "UNSTABLE";
}

export function isExecutableSupportDisposition(
  supportDisposition: SupportDisposition | null | undefined,
): boolean {
  return supportDisposition === "EXECUTABLE";
}

export function isReliabilityScorableSelector(record: SelectorHealthRecord): boolean {
  if (record.status === "UNSUPPORTED") {
    return false;
  }

  if (record.phase === "EXTRACTION" || record.phase === "COMPARISON") {
    return true;
  }

  return isExecutableSupportDisposition(record.supportDisposition);
}

export function shouldScoreDriftSignal(signal: DriftSignal): boolean {
  return isExecutableSupportDisposition(signal.supportDisposition);
}

export function shouldScoreWriteOutcome(
  outcome: RunReliabilityRecord["writeOutcomes"][number],
): boolean {
  return (
    outcome.contributesToReliability &&
    (
      outcome.status === "VERIFIED" ||
      outcome.status === "FAILED" ||
      outcome.status === "VERIFICATION_FAILED"
    )
  );
}

export function isBlockedExecutionPathWriteOutcome(
  outcome: RunReliabilityRecord["writeOutcomes"][number],
): boolean {
  return (
    outcome.contributesToReliability &&
    outcome.status === "BLOCKED" &&
    outcome.guardFailures.some((reason) => WRITE_EXECUTION_GUARD_FAILURES.has(reason))
  );
}

export function shouldScoreWorkflowOutcome(
  outcome: RunReliabilityRecord["workflowStepOutcomes"][number],
): boolean {
  return (
    outcome.contributesToReliability &&
    (
      outcome.status === "VERIFIED" ||
      outcome.status === "FAILED" ||
      outcome.status === "EXECUTED"
    )
  );
}

export function isBlockedExecutionPathWorkflowOutcome(
  outcome: RunReliabilityRecord["workflowStepOutcomes"][number],
): boolean {
  return (
    outcome.contributesToReliability &&
    outcome.status === "BLOCKED" &&
    outcome.guardFailures.some((reason) => WORKFLOW_EXECUTION_GUARD_FAILURES.has(reason))
  );
}

export function buildAggregationWindow(
  records: readonly RunReliabilityRecord[],
  maxRuns: number,
  label = `last_${maxRuns}_runs`,
) {
  const recentRuns = takeRecentRuns(records, maxRuns);

  return {
    label,
    maxRuns,
    runsConsidered: recentRuns.length,
    startTimestamp: recentRuns[0]?.timestamp ?? null,
    endTimestamp: recentRuns[recentRuns.length - 1]?.timestamp ?? null,
  };
}

export function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function classifyTrendWithData(input: {
  previousObservationCount: number;
  recentObservationCount: number;
  previousValue: number;
  recentValue: number;
  threshold?: number;
  higherIsBetter?: boolean;
}): "IMPROVING" | "STABLE" | "DEGRADING" {
  if (input.previousObservationCount <= 0 || input.recentObservationCount <= 0) {
    return "STABLE";
  }

  return classifyTrend({
    previousValue: input.previousValue,
    recentValue: input.recentValue,
    threshold: input.threshold,
    higherIsBetter: input.higherIsBetter,
  });
}
