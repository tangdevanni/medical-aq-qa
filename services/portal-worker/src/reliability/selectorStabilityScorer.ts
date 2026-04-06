import {
  type RunReliabilityRecord,
  type SelectorStabilityScore,
  selectorStabilityScoreSchema,
} from "../types/reliabilityIntelligence";
import { type SelectorHealthRecord } from "../types/runtimeDiagnostics";
import {
  classifyReliabilityLevel,
  classifyTrendWithData,
  clampUnit,
  isReliabilityScorableSelector,
  ratio,
  splitRuns,
} from "./reliabilityIntelligenceShared";

const STATUS_WEIGHTS: Record<SelectorHealthRecord["status"], number> = {
  HEALTHY: 1,
  DEGRADED: 0.6,
  MISSING: 0,
  AMBIGUOUS: 0.25,
  UNSUPPORTED: 0,
};

export function scoreSelectorStability(
  records: readonly RunReliabilityRecord[],
): SelectorStabilityScore[] {
  const scorableGroups = new Map<string, SelectorHealthRecord[]>();
  const allGroups = new Map<string, SelectorHealthRecord[]>();

  for (const record of records) {
    for (const selectorHealth of record.selectorHealth) {
      const key = buildSelectorKey(selectorHealth);
      const allGroup = allGroups.get(key) ?? [];
      allGroup.push(selectorHealth);
      allGroups.set(key, allGroup);

      if (!isReliabilityScorableSelector(selectorHealth)) {
        continue;
      }

      const scorableGroup = scorableGroups.get(key) ?? [];
      scorableGroup.push(selectorHealth);
      scorableGroups.set(key, scorableGroup);
    }
  }

  return [...scorableGroups.entries()]
    .filter(([, entries]) => entries.length > 0)
    .map((entries) => {
      const [selectorKey, selectorEntries] = entries;
      const sampleSize = selectorEntries.length;
      const excludedObservationCount = (allGroups.get(selectorKey)?.length ?? selectorEntries.length) - selectorEntries.length;
      const healthyCount = selectorEntries.filter((entry) => entry.status === "HEALTHY").length;
      const degradedCount = selectorEntries.filter((entry) => entry.status === "DEGRADED").length;
      const missingCount = selectorEntries.filter((entry) => entry.status === "MISSING").length;
      const ambiguousCount = selectorEntries.filter((entry) => entry.status === "AMBIGUOUS").length;
      const stabilityScore = clampUnit(
        ratio(
          selectorEntries.reduce((total, entry) => total + STATUS_WEIGHTS[entry.status], 0),
          sampleSize,
        ),
      );
      const { previous, recent } = splitRuns(projectEntriesToRunRecords(records, selectorKey));
      const previousScore = averageStatusScore(previous);
      const recentScore = averageStatusScore(recent);

      return selectorStabilityScoreSchema.parse({
        selectorName: selectorEntries[0].name,
        documentKind: selectorEntries[0].documentKind,
        action: selectorEntries[0].action ?? null,
        targetField: selectorEntries[0].targetField ?? null,
        stabilityScore,
        reliabilityLevel: classifyReliabilityLevel({
          score: stabilityScore,
          sampleSize,
        }),
        trend: classifyTrendWithData({
          previousObservationCount: previous.reduce((total, record) => total + record.selectorHealth.length, 0),
          recentObservationCount: recent.reduce((total, record) => total + record.selectorHealth.length, 0),
          recentValue: recentScore,
          previousValue: previousScore,
          threshold: 0.08,
        }),
        sampleSize,
        excludedObservationCount,
        healthyCount,
        degradedCount,
        missingCount,
        ambiguousCount,
      });
    })
    .sort((left, right) =>
      left.stabilityScore - right.stabilityScore ||
      right.sampleSize - left.sampleSize ||
      left.selectorName.localeCompare(right.selectorName),
    );
}

function projectEntriesToRunRecords(
  records: readonly RunReliabilityRecord[],
  selectorKey: string,
): RunReliabilityRecord[] {
  return records
    .map((record) => ({
      ...record,
      selectorHealth: record.selectorHealth.filter((entry) =>
        buildSelectorKey(entry) === selectorKey && isReliabilityScorableSelector(entry)
      ),
    }))
    .filter((record) => record.selectorHealth.length > 0);
}

function averageStatusScore(records: readonly RunReliabilityRecord[]): number {
  if (records.length === 0) {
    return 0;
  }

  return ratio(
    records.reduce(
      (total, record) =>
        total + ratio(
          record.selectorHealth.reduce((subtotal, entry) => subtotal + STATUS_WEIGHTS[entry.status], 0),
          record.selectorHealth.length,
        ),
      0,
    ),
    records.length,
  );
}

function buildSelectorKey(entry: SelectorHealthRecord): string {
  return [
    entry.documentKind,
    entry.name,
    entry.action ?? "",
    entry.targetField ?? "",
  ].join(":");
}
