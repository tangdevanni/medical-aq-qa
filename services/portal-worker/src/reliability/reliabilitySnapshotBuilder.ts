import {
  type ReliabilitySnapshot,
  reliabilitySnapshotSchema,
} from "../types/reliabilityIntelligence";
import { scoreActionReliability } from "./actionReliabilityScorer";
import { detectReliabilityAnomalies } from "./anomalyDetector";
import { buildDocumentKindReliability } from "./documentKindReliability";
import { detectDriftTrends } from "./driftTrendDetector";
import {
  DEFAULT_RELIABILITY_WINDOW_RUNS,
  buildAggregationWindow,
  takeRecentRuns,
} from "./reliabilityIntelligenceShared";
import { scoreSelectorStability } from "./selectorStabilityScorer";
import { classifyOverallSystemHealth } from "./systemHealthClassifier";
import { type RunReliabilityRecord } from "../types/reliabilityIntelligence";

export function buildReliabilitySnapshot(input: {
  records: readonly RunReliabilityRecord[];
  maxRuns?: number;
  timestamp?: string;
}): ReliabilitySnapshot {
  const maxRuns = input.maxRuns ?? DEFAULT_RELIABILITY_WINDOW_RUNS;
  const records = takeRecentRuns(input.records, maxRuns);
  const selectorStability = scoreSelectorStability(records);
  const actionReliability = scoreActionReliability(records);
  const documentReliability = buildDocumentKindReliability(records, selectorStability);
  const driftTrends = detectDriftTrends(records);
  const anomalies = detectReliabilityAnomalies({
    records,
    selectorStability,
    actionReliability,
    documentReliability,
    driftTrends,
  });
  const overallSystemHealth = classifyOverallSystemHealth({
    selectorStability,
    actionReliability,
    documentReliability,
    driftTrends,
    anomalies,
  });

  return reliabilitySnapshotSchema.parse({
    timestamp: input.timestamp ?? new Date().toISOString(),
    aggregationWindow: buildAggregationWindow(records, maxRuns),
    selectorStability,
    actionReliability,
    documentReliability,
    driftTrends,
    anomalies,
    overallSystemHealth,
  });
}
