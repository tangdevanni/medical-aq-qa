import {
  type ActionReliabilityScore,
  type AnomalyRecord,
  type DocumentKindReliability,
  type DriftTrend,
  type RunReliabilityRecord,
  type SelectorStabilityScore,
  anomalyRecordSchema,
} from "../types/reliabilityIntelligence";
import {
  average,
  isBlockedExecutionPathWorkflowOutcome,
  isBlockedExecutionPathWriteOutcome,
  ratio,
  splitRuns,
  shouldScoreWorkflowOutcome,
  shouldScoreWriteOutcome,
} from "./reliabilityIntelligenceShared";

export function detectReliabilityAnomalies(input: {
  records: readonly RunReliabilityRecord[];
  selectorStability: readonly SelectorStabilityScore[];
  actionReliability: readonly ActionReliabilityScore[];
  documentReliability: readonly DocumentKindReliability[];
  driftTrends: readonly DriftTrend[];
}): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];
  const runs = input.records;
  const { previous, recent } = splitRuns(runs);

  if (runs.length < 3 || recent.length === 0) {
    return anomalies;
  }

  const previousWriteStats = aggregateWriteVerification(previous);
  const recentWriteStats = aggregateWriteVerification(recent);
  if (
    previousWriteStats.attempts >= 2 &&
    recentWriteStats.attempts >= 2 &&
    previousWriteStats.rate - recentWriteStats.rate >= 0.15
  ) {
    anomalies.push(anomalyRecordSchema.parse({
      type: "DROP_IN_VERIFICATION_RATE",
      severity: recentWriteStats.rate < 0.75 ? "ERROR" : "WARNING",
      documentKind: null,
      action: null,
      selectorName: null,
      reason: `Write verification rate dropped from ${formatRate(previousWriteStats.rate)} to ${formatRate(recentWriteStats.rate)} over recent runs.`,
      baselineValue: previousWriteStats.rate,
      currentValue: recentWriteStats.rate,
    }));
  }

  const previousBlockedStats = blockedExecutableStats(previous);
  const recentBlockedStats = blockedExecutableStats(recent);
  if (
    previousBlockedStats.totalObservations >= 2 &&
    recentBlockedStats.totalObservations >= 2 &&
    recentBlockedStats.rate - previousBlockedStats.rate >= 0.2
  ) {
    anomalies.push(anomalyRecordSchema.parse({
      type: "INCREASE_IN_BLOCKED_ACTIONS",
      severity: recentBlockedStats.rate >= 0.4 ? "ERROR" : "WARNING",
      documentKind: null,
      action: null,
      selectorName: null,
      reason: `Executable blocked-action rate increased from ${formatRate(previousBlockedStats.rate)} to ${formatRate(recentBlockedStats.rate)}.`,
      baselineValue: previousBlockedStats.rate,
      currentValue: recentBlockedStats.rate,
    }));
  }

  for (const trend of input.driftTrends) {
    if (trend.trend !== "DEGRADING") {
      continue;
    }

    if (trend.recentCount < Math.max(2, trend.previousCount + 1)) {
      continue;
    }

    anomalies.push(anomalyRecordSchema.parse({
      type: "SPIKE_IN_DRIFT_SIGNALS",
      severity: trend.recentDriftRate >= 0.5 ? "ERROR" : "WARNING",
      documentKind: trend.documentKind ?? null,
      action: trend.action ?? null,
      selectorName: trend.selectorName ?? null,
      reason: `Drift signal rate increased from ${formatRate(trend.previousDriftRate)} to ${formatRate(trend.recentDriftRate)}.`,
      baselineValue: trend.previousDriftRate,
      currentValue: trend.recentDriftRate,
    }));
  }

  for (const selector of input.selectorStability) {
    if (selector.trend !== "DEGRADING") {
      continue;
    }

    if (selector.missingCount + selector.ambiguousCount < 2) {
      continue;
    }

    if (selector.reliabilityLevel === "STABLE" || selector.reliabilityLevel === "INSUFFICIENT_DATA") {
      continue;
    }

    anomalies.push(anomalyRecordSchema.parse({
      type: "SUDDEN_SELECTOR_FAILURE",
      severity: selector.reliabilityLevel === "UNSTABLE" ? "ERROR" : "WARNING",
      documentKind: selector.documentKind,
      action: selector.action ?? null,
      selectorName: selector.selectorName,
      reason: `Selector ${selector.selectorName} degraded to ${selector.reliabilityLevel} with ${selector.missingCount} missing and ${selector.ambiguousCount} ambiguous observations.`,
      baselineValue: 1,
      currentValue: selector.stabilityScore,
    }));
  }

  for (const action of input.actionReliability) {
    if (action.attempts < 3 || action.trend !== "DEGRADING") {
      continue;
    }

    if (action.reliabilityLevel === "UNSTABLE" || action.successRate <= 0.6) {
      anomalies.push(anomalyRecordSchema.parse({
        type: "EXECUTION_PATH_REGRESSION",
        severity: action.successRate <= 0.4 ? "ERROR" : "WARNING",
        documentKind: action.documentKind,
        action: action.action,
        selectorName: null,
        reason: `${action.action} reliability for ${action.documentKind ?? "UNKNOWN"} dropped to ${formatRate(action.successRate)} across ${action.attempts} executable attempts.`,
        baselineValue: 1,
        currentValue: action.successRate,
      }));
    }
  }

  for (const document of input.documentReliability) {
    if (document.reliabilityLevel === "UNSTABLE" && document.trend === "DEGRADING") {
      anomalies.push(anomalyRecordSchema.parse({
        type: "EXECUTION_PATH_REGRESSION",
        severity: "ERROR",
        documentKind: document.documentKind,
        action: null,
        selectorName: null,
        reason: `${document.documentKind} reliability is unstable with write rate ${formatRate(document.writeVerificationRate)} and workflow rate ${formatRate(document.workflowCompletionRate)}.`,
        baselineValue: null,
        currentValue: average([document.writeVerificationRate, document.workflowCompletionRate]),
      }));
    }
  }

  return dedupeAnomalies(anomalies);
}

function aggregateWriteVerification(records: readonly RunReliabilityRecord[]): {
  attempts: number;
  rate: number;
} {
  const attempts = records.reduce((total, record) =>
    total + record.writeOutcomes.filter(shouldScoreWriteOutcome).length,
  0);
  const verified = records.reduce((total, record) =>
    total + record.writeOutcomes.filter((outcome) =>
      shouldScoreWriteOutcome(outcome) && outcome.status === "VERIFIED"
    ).length,
  0);

  return {
    attempts,
    rate: ratio(verified, attempts),
  };
}

function blockedExecutableStats(records: readonly RunReliabilityRecord[]): {
  totalObservations: number;
  rate: number;
} {
  const scoredWriteCount = records.reduce((total, record) =>
    total + record.writeOutcomes.filter(shouldScoreWriteOutcome).length,
  0);
  const scoredWorkflowCount = records.reduce((total, record) =>
    total + record.workflowStepOutcomes.filter(shouldScoreWorkflowOutcome).length,
  0);
  const blockedWriteCount = records.reduce((total, record) =>
    total + record.writeOutcomes.filter(isBlockedExecutionPathWriteOutcome).length,
  0);
  const blockedWorkflowCount = records.reduce((total, record) =>
    total + record.workflowStepOutcomes.filter(isBlockedExecutionPathWorkflowOutcome).length,
  0);
  const totalObservations = scoredWriteCount + scoredWorkflowCount + blockedWriteCount + blockedWorkflowCount;

  return {
    totalObservations,
    rate: ratio(
      blockedWriteCount + blockedWorkflowCount,
      totalObservations,
    ),
  };
}

function dedupeAnomalies(anomalies: readonly AnomalyRecord[]): AnomalyRecord[] {
  const seen = new Set<string>();

  return anomalies.filter((anomaly) => {
    const key = [
      anomaly.type,
      anomaly.documentKind ?? "",
      anomaly.action ?? "",
      anomaly.selectorName ?? "",
      anomaly.reason,
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatRate(value: number): string {
  return value.toFixed(2);
}
