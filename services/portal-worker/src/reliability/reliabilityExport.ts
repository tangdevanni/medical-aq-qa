import { type ReliabilitySnapshot, type RunReliabilityRecord } from "../types/reliabilityIntelligence";
import { buildReliabilitySnapshot } from "./reliabilitySnapshotBuilder";
import { listRunHistoryRecords } from "./runHistoryCollector";

let latestReliabilitySnapshot: ReliabilitySnapshot | null = null;

export function publishReliabilitySnapshot(snapshot: ReliabilitySnapshot): void {
  latestReliabilitySnapshot = snapshot;
}

export function getLatestReliabilitySnapshot(): ReliabilitySnapshot | null {
  return latestReliabilitySnapshot;
}

export function exportReliabilityInsights(input: {
  maxRuns?: number;
} = {}): {
  latestSnapshot: ReliabilitySnapshot | null;
  recentRuns: RunReliabilityRecord[];
  selectorStability: ReliabilitySnapshot["selectorStability"];
  anomalies: ReliabilitySnapshot["anomalies"];
} {
  const recentRuns = listRunHistoryRecords();
  const snapshot = latestReliabilitySnapshot ??
    (recentRuns.length > 0
      ? buildReliabilitySnapshot({
        records: recentRuns,
        maxRuns: input.maxRuns,
      })
      : null);

  return {
    latestSnapshot: snapshot,
    recentRuns,
    selectorStability: snapshot?.selectorStability ?? [],
    anomalies: snapshot?.anomalies ?? [],
  };
}
