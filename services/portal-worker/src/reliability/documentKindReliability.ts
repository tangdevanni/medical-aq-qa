import {
  type DocumentKindReliability,
  type RunReliabilityRecord,
  type SelectorStabilityScore,
  documentKindReliabilitySchema,
} from "../types/reliabilityIntelligence";
import {
  average,
  classifyReliabilityLevel,
  classifyTrendWithData,
  ratio,
  toNamedCounts,
  shouldScoreDriftSignal,
  shouldScoreWorkflowOutcome,
  shouldScoreWriteOutcome,
  isReliabilityScorableSelector,
} from "./reliabilityIntelligenceShared";

export function buildDocumentKindReliability(
  records: readonly RunReliabilityRecord[],
  selectorScores: readonly SelectorStabilityScore[],
): DocumentKindReliability[] {
  const documentKinds = new Set<string>();

  for (const record of records) {
    for (const selectorHealth of record.selectorHealth) {
      documentKinds.add(selectorHealth.documentKind);
    }

    for (const driftSignal of record.driftSignals) {
      documentKinds.add(driftSignal.documentKind);
    }

    for (const writeOutcome of record.writeOutcomes) {
      if (writeOutcome.documentKind) {
        documentKinds.add(writeOutcome.documentKind);
      }
    }

    for (const workflowOutcome of record.workflowStepOutcomes) {
      if (workflowOutcome.documentKind) {
        documentKinds.add(workflowOutcome.documentKind);
      }
    }
  }

  return [...documentKinds]
    .map((documentKind) => {
      const writeOutcomes = records.flatMap((record) =>
        record.writeOutcomes.filter((outcome) => outcome.documentKind === documentKind),
      );
      const executableWriteOutcomes = writeOutcomes.filter(shouldScoreWriteOutcome);
      const workflowOutcomes = records.flatMap((record) =>
        record.workflowStepOutcomes.filter((outcome) => outcome.documentKind === documentKind),
      );
      const executableWorkflowOutcomes = workflowOutcomes.filter(shouldScoreWorkflowOutcome);
      const driftSignals = records.flatMap((record) =>
        record.driftSignals.filter((signal) =>
          signal.documentKind === documentKind && shouldScoreDriftSignal(signal)
        ),
      );
      const selectorInstabilityCount = selectorScores.filter((score) =>
        score.documentKind === documentKind &&
        score.reliabilityLevel !== "STABLE" &&
        score.reliabilityLevel !== "INSUFFICIENT_DATA",
      ).length;
      const supportDispositionCounts = toNamedCounts([
        ...records.flatMap((record) =>
          record.supportMatrixDiagnostics
            .filter((diagnostic) => diagnostic.documentKind === documentKind)
            .map((diagnostic) => diagnostic.supportDisposition),
        ),
        ...writeOutcomes
          .map((outcome) => outcome.supportDisposition)
          .filter((value): value is Exclude<typeof value, null> => value !== null),
      ]);
      const writeVerificationRate = ratio(
        executableWriteOutcomes.filter((outcome) => outcome.status === "VERIFIED").length,
        executableWriteOutcomes.length,
      );
      const workflowCompletionRate = ratio(
        executableWorkflowOutcomes.filter((outcome) =>
          outcome.status === "VERIFIED" ||
          (outcome.status === "EXECUTED" && outcome.verificationPassed)
        ).length,
        executableWorkflowOutcomes.length,
      );
      const driftDenominator =
        records.flatMap((record) =>
          record.selectorHealth.filter((entry) =>
            entry.documentKind === documentKind && isReliabilityScorableSelector(entry)
          ),
        ).length +
        executableWorkflowOutcomes.length +
        executableWriteOutcomes.length;
      const driftSignalRate = ratio(driftSignals.length, driftDenominator);
      const compositeScore = average([
        executableWriteOutcomes.length > 0 ? writeVerificationRate : 1,
        executableWorkflowOutcomes.length > 0 ? workflowCompletionRate : 1,
        1 - Math.min(1, driftSignalRate),
        selectorInstabilityCount === 0 ? 1 : Math.max(0, 1 - selectorInstabilityCount * 0.2),
      ]);
      const splitIndex = Math.max(1, Math.floor(records.length / 2));
      const previousRecords = records.slice(0, Math.max(0, records.length - splitIndex));
      const recentRecords = records.slice(records.length - splitIndex);
      const previousComposite = compositeDocumentScore(previousRecords, documentKind, selectorScores);
      const recentComposite = compositeDocumentScore(recentRecords, documentKind, selectorScores);

      return documentKindReliabilitySchema.parse({
        documentKind,
        reliabilityLevel: classifyReliabilityLevel({
          score: compositeScore,
          sampleSize: executableWriteOutcomes.length + executableWorkflowOutcomes.length,
          stableThreshold: 0.9,
          degradedThreshold: 0.7,
        }),
        writeVerificationRate,
        workflowCompletionRate,
        driftSignalRate,
        selectorInstabilityCount,
        supportDispositionCounts,
        trend: classifyTrendWithData({
          previousObservationCount: previousRecords.length,
          recentObservationCount: recentRecords.length,
          recentValue: recentComposite,
          previousValue: previousComposite,
          threshold: 0.06,
        }),
      });
    })
    .sort((left, right) =>
      left.writeVerificationRate - right.writeVerificationRate ||
      left.workflowCompletionRate - right.workflowCompletionRate ||
      left.documentKind.localeCompare(right.documentKind),
    );
}

function compositeDocumentScore(
  records: readonly RunReliabilityRecord[],
  documentKind: string,
  selectorScores: readonly SelectorStabilityScore[],
): number {
  const writeOutcomes = records.flatMap((record) =>
    record.writeOutcomes.filter((outcome) =>
      outcome.documentKind === documentKind && shouldScoreWriteOutcome(outcome),
    ),
  );
  const workflowOutcomes = records.flatMap((record) =>
    record.workflowStepOutcomes.filter((outcome) =>
      outcome.documentKind === documentKind && shouldScoreWorkflowOutcome(outcome),
    ),
  );
  const driftSignals = records.flatMap((record) =>
    record.driftSignals.filter((signal) =>
      signal.documentKind === documentKind && shouldScoreDriftSignal(signal)
    ),
  );
  const relevantSelectorScores = selectorScores.filter((score) => score.documentKind === documentKind);
  const selectorScore = relevantSelectorScores.length > 0
    ? average(relevantSelectorScores.map((score) => score.stabilityScore))
    : 1;
  const writeScore = writeOutcomes.length > 0
    ? ratio(writeOutcomes.filter((outcome) => outcome.status === "VERIFIED").length, writeOutcomes.length)
    : 1;
  const workflowScore = workflowOutcomes.length > 0
    ? ratio(
      workflowOutcomes.filter((outcome) =>
        outcome.status === "VERIFIED" || (outcome.status === "EXECUTED" && outcome.verificationPassed)
      ).length,
      workflowOutcomes.length,
    )
    : 1;
  const driftPenalty = writeOutcomes.length + workflowOutcomes.length > 0
    ? ratio(driftSignals.length, writeOutcomes.length + workflowOutcomes.length)
    : 0;

  return average([
    writeScore,
    workflowScore,
    selectorScore,
    1 - Math.min(1, driftPenalty),
  ]);
}
