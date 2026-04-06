import {
  type ActionReliabilityScore,
  type AnomalyRecord,
  type DocumentKindReliability,
  type DriftTrend,
  type ReliabilityLevel,
  type SelectorStabilityScore,
} from "../types/reliabilityIntelligence";

export function classifyOverallSystemHealth(input: {
  selectorStability: readonly SelectorStabilityScore[];
  actionReliability: readonly ActionReliabilityScore[];
  documentReliability: readonly DocumentKindReliability[];
  driftTrends: readonly DriftTrend[];
  anomalies: readonly AnomalyRecord[];
}): ReliabilityLevel {
  const criticalAnomalies = input.anomalies.filter((anomaly) => anomaly.severity === "CRITICAL").length;
  const errorAnomalies = input.anomalies.filter((anomaly) => anomaly.severity === "ERROR").length;
  const unstableSelectors = input.selectorStability.filter((score) => score.reliabilityLevel === "UNSTABLE").length;
  const unstableActions = input.actionReliability.filter((score) => score.reliabilityLevel === "UNSTABLE").length;
  const unstableDocuments = input.documentReliability.filter((score) => score.reliabilityLevel === "UNSTABLE").length;
  const degradingDrift = input.driftTrends.filter((trend) =>
    trend.trend === "DEGRADING" && trend.recentCount >= Math.max(2, trend.previousCount + 1),
  ).length;

  if (criticalAnomalies > 0 || errorAnomalies >= 2 || unstableActions >= 2 || unstableDocuments >= 1) {
    return "UNSTABLE";
  }

  if (unstableSelectors > 0 || unstableActions > 0 || degradingDrift > 0 || input.anomalies.length > 0) {
    return "DEGRADED";
  }

  const anyEvidence =
    input.selectorStability.length > 0 ||
    input.actionReliability.length > 0 ||
    input.documentReliability.length > 0;

  return anyEvidence ? "STABLE" : "INSUFFICIENT_DATA";
}
