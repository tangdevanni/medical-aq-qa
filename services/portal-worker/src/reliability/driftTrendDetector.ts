import {
  type DriftTrend,
  type RunReliabilityRecord,
  driftTrendSchema,
} from "../types/reliabilityIntelligence";
import {
  classifyTrendWithData,
  clampUnit,
  ratio,
  shouldScoreDriftSignal,
  splitRuns,
  isReliabilityScorableSelector,
} from "./reliabilityIntelligenceShared";

export function detectDriftTrends(
  records: readonly RunReliabilityRecord[],
): DriftTrend[] {
  const groups = new Map<string, {
    selectorName: string | null;
    documentKind: DriftTrend["documentKind"];
    action: DriftTrend["action"];
  }>();

  for (const record of records) {
    for (const signal of record.driftSignals) {
      if (!shouldScoreDriftSignal(signal)) {
        continue;
      }

      const key = buildDriftKey(signal);
      groups.set(key, {
        selectorName: signal.selectorName ?? null,
        documentKind: signal.documentKind,
        action: signal.action ?? null,
      });
    }
  }

  return [...groups.entries()]
    .map(([key, descriptor]) => {
      const projectedRuns = records.map((record) => ({
        ...record,
        driftSignals: record.driftSignals.filter((signal) =>
          buildDriftKey(signal) === key && shouldScoreDriftSignal(signal)
        ),
      }));
      const scopeKey = driftScopeFromDriftKey(key);
      const { previous, recent } = splitRuns(projectedRuns);
      const previousCount = previous.reduce((total, record) => total + record.driftSignals.length, 0);
      const recentCount = recent.reduce((total, record) => total + record.driftSignals.length, 0);
      const previousOpportunityCount = countDriftOpportunities(previous, scopeKey);
      const recentOpportunityCount = countDriftOpportunities(recent, scopeKey);
      const previousRate = clampUnit(ratio(previousCount, previousOpportunityCount));
      const recentRate = clampUnit(ratio(recentCount, recentOpportunityCount));
      const excludedSignalCount = records.flatMap((record) =>
        record.driftSignals.filter((signal) => buildDriftKey(signal) === key && !shouldScoreDriftSignal(signal)),
      ).length;

      return driftTrendSchema.parse({
        selectorName: descriptor.selectorName,
        documentKind: descriptor.documentKind ?? null,
        action: descriptor.action ?? null,
        trend: classifyTrendWithData({
          previousObservationCount: previousOpportunityCount,
          recentObservationCount: recentOpportunityCount,
          recentValue: recentRate,
          previousValue: previousRate,
          threshold: 0.2,
          higherIsBetter: false,
        }),
        recentDriftRate: recentRate,
        previousDriftRate: previousRate,
        recentCount,
        previousCount,
        scoredOpportunityCount: previousOpportunityCount + recentOpportunityCount,
        excludedSignalCount,
      });
    })
    .sort((left, right) =>
      right.recentDriftRate - left.recentDriftRate ||
      right.recentCount - left.recentCount ||
      (left.selectorName ?? "").localeCompare(right.selectorName ?? ""),
    );
}

function buildDriftKey(signal: RunReliabilityRecord["driftSignals"][number]): string {
  return [
    signal.documentKind,
    signal.selectorName ?? "",
    signal.action ?? "",
    signal.targetField ?? "",
    signal.type,
  ].join(":");
}

function countDriftOpportunities(
  records: readonly RunReliabilityRecord[],
  driftKey: string,
): number {
  return records.filter((record) => hasDriftOpportunity(record, driftKey)).length;
}

function hasDriftOpportunity(
  record: RunReliabilityRecord,
  scopeKey: string,
): boolean {
  return record.selectorHealth.some((entry) =>
    buildOpportunityKey({
      documentKind: entry.documentKind,
      selectorName: entry.name,
      action: entry.action ?? null,
      targetField: entry.targetField ?? null,
    }) === scopeKey && isReliabilityScorableSelector(entry),
  ) || record.supportMatrixDiagnostics.some((entry) =>
    buildOpportunityKey({
      documentKind: entry.documentKind,
      selectorName: null,
      action: entry.action ?? null,
      targetField: entry.targetField ?? null,
    }) === scopeKey && entry.driftEligible,
  );
}

function buildOpportunityKey(input: {
  documentKind: string | null;
  selectorName: string | null;
  action: string | null;
  targetField: string | null;
}): string {
  return [
    input.documentKind ?? "",
    input.selectorName ?? "",
    input.action ?? "",
    input.targetField ?? "",
  ].join(":");
}

function driftScopeFromDriftKey(driftKey: string): string {
  return driftKey.split(":").slice(0, 4).join(":");
}
