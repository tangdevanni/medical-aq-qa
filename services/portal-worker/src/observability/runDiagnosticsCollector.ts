import {
  diagnosticsSummarySchema,
  driftSignalSummarySchema,
  selectorHealthSummarySchema,
  traceStatsSchema,
  type DiagnosticsSummary,
  type DriftSignalSummary,
  type SelectorHealthSummary,
  type TraceStats,
} from "../types/runtimeDiagnostics";
import { type QueueQaRowProcessResult } from "../types/queueQaPipeline";

export function collectRunDiagnostics(results: QueueQaRowProcessResult[]): {
  diagnosticsSummary: DiagnosticsSummary;
  selectorHealthSummary: SelectorHealthSummary;
  driftSignalSummary: DriftSignalSummary;
  traceStats: TraceStats;
} {
  const diagnostics = results.flatMap((result) => result.runtimeDiagnostics ?? []);
  const selectorHealth = results.flatMap((result) => result.selectorHealth ?? []);
  const driftSignals = results.flatMap((result) => result.driftSignals ?? []);
  const retryAttempts = results.flatMap((result) => result.retryAttempts ?? []);
  const traceEvents = results.flatMap((result) => result.executionTrace ?? []);
  const supportDiagnostics = results.flatMap((result) => result.supportMatrixDiagnostics ?? []);

  return {
    diagnosticsSummary: diagnosticsSummarySchema.parse({
      totalDiagnostics: diagnostics.length,
      bySeverity: toCounts(diagnostics.map((entry) => entry.severity)),
      byCategory: toCounts(diagnostics.map((entry) => entry.category)),
      topCodes: toCounts(diagnostics.map((entry) => entry.code)).slice(0, 10),
      supportLevelBlockedCounts: toCounts(
        supportDiagnostics
          .filter((entry) => entry.supportDisposition !== "EXECUTABLE")
          .map((entry) => entry.supportDisposition),
      ),
      retryStats: {
        totalRecords: retryAttempts.length,
        exhaustedCount: retryAttempts.filter((entry) => entry.outcome === "EXHAUSTED").length,
        byPolicy: toCounts(retryAttempts.map((entry) => entry.policyName)),
      },
    }),
    selectorHealthSummary: selectorHealthSummarySchema.parse({
      totalChecks: selectorHealth.length,
      statusCounts: toCounts(selectorHealth.map((entry) => entry.status)),
      missingByDocumentKind: toCounts(
        selectorHealth
          .filter((entry) => entry.status === "MISSING")
          .map((entry) => entry.documentKind),
      ),
      ambiguousByAction: toCounts(
        selectorHealth
          .filter((entry) => entry.status === "AMBIGUOUS")
          .map((entry) => entry.action ?? "NO_ACTION"),
      ),
    }),
    driftSignalSummary: driftSignalSummarySchema.parse({
      totalSignals: driftSignals.length,
      byType: toCounts(driftSignals.map((entry) => entry.type)),
      byDocumentKind: toCounts(driftSignals.map((entry) => entry.documentKind)),
    }),
    traceStats: traceStatsSchema.parse({
      totalEvents: traceEvents.length,
      byPhase: toCounts(traceEvents.map((entry) => entry.phase)),
      byStatus: toCounts(traceEvents.map((entry) => entry.status)),
    }),
  };
}

function toCounts(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}
