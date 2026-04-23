import {
  type ActionReliabilityScore,
  type RunReliabilityRecord,
  actionReliabilityScoreSchema,
} from "../types/reliabilityIntelligence";
import {
  classifyReliabilityLevel,
  classifyTrendWithData,
  ratio,
  splitRuns,
  isBlockedExecutionPathWorkflowOutcome,
  isBlockedExecutionPathWriteOutcome,
  shouldScoreWorkflowOutcome,
  shouldScoreWriteOutcome,
} from "./reliabilityIntelligenceShared";

const WRITE_ACTION = "WRITE_FIELD";

interface ActionAggregate {
  action: string;
  documentKind: string | null;
  targetField: string | null;
  supportLevel: ActionReliabilityScore["supportLevel"];
  attempts: number;
  verifiedSuccessCount: number;
  blockedCount: number;
  excludedObservationCount: number;
  failureCount: number;
  verificationFailureCount: number;
}

export function scoreActionReliability(
  records: readonly RunReliabilityRecord[],
): ActionReliabilityScore[] {
  const groups = new Map<string, ActionAggregate>();

  for (const record of records) {
    for (const outcome of record.writeOutcomes) {
      const key = buildActionKey({
        action: WRITE_ACTION,
        documentKind: outcome.documentKind,
        targetField: outcome.targetField,
      });
      const group = groups.get(key) ?? createAggregate({
        action: WRITE_ACTION,
        documentKind: outcome.documentKind,
        targetField: outcome.targetField,
        supportLevel: null,
      });

      if (shouldScoreWriteOutcome(outcome)) {
        group.attempts += 1;
        if (outcome.status === "VERIFIED") {
          group.verifiedSuccessCount += 1;
        } else if (outcome.status === "VERIFICATION_FAILED") {
          group.failureCount += 1;
          group.verificationFailureCount += 1;
        } else if (outcome.status === "FAILED") {
          group.failureCount += 1;
        }
      } else if (isBlockedExecutionPathWriteOutcome(outcome)) {
        group.blockedCount += 1;
      } else {
        group.excludedObservationCount += 1;
      }

      groups.set(key, group);
    }

    for (const outcome of record.workflowStepOutcomes) {
      const key = buildActionKey({
        action: outcome.action,
        documentKind: outcome.documentKind,
        targetField: outcome.targetField,
      });
      const group = groups.get(key) ?? createAggregate({
        action: outcome.action,
        documentKind: outcome.documentKind,
        targetField: outcome.targetField,
        supportLevel: outcome.supportLevel ?? null,
      });

      if (shouldScoreWorkflowOutcome(outcome)) {
        group.attempts += 1;
        if (outcome.status === "VERIFIED" || (outcome.status === "EXECUTED" && outcome.verificationPassed)) {
          group.verifiedSuccessCount += 1;
        } else if (outcome.status === "FAILED" || outcome.status === "EXECUTED") {
          group.failureCount += 1;
          if (!outcome.verificationPassed) {
            group.verificationFailureCount += 1;
          }
        }
      } else if (isBlockedExecutionPathWorkflowOutcome(outcome)) {
        group.blockedCount += 1;
      } else {
        group.excludedObservationCount += 1;
      }

      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((aggregate) => {
      const successRate = ratio(aggregate.verifiedSuccessCount, aggregate.attempts);
      const projectedRuns = projectActionRuns(records, aggregate);
      const { previous, recent } = splitRuns(projectedRuns);
      const previousStats = actionSuccessStats(previous, aggregate);
      const recentStats = actionSuccessStats(recent, aggregate);

      return actionReliabilityScoreSchema.parse({
        action: aggregate.action,
        documentKind: aggregate.documentKind,
        targetField: aggregate.targetField,
        supportLevel: aggregate.supportLevel ?? null,
        attempts: aggregate.attempts,
        verifiedSuccessCount: aggregate.verifiedSuccessCount,
        blockedCount: aggregate.blockedCount,
        excludedObservationCount: aggregate.excludedObservationCount,
        failureCount: aggregate.failureCount,
        verificationFailureCount: aggregate.verificationFailureCount,
        successRate,
        reliabilityLevel: classifyReliabilityLevel({
          score: successRate,
          sampleSize: aggregate.attempts,
          stableThreshold: 0.92,
          degradedThreshold: 0.7,
        }),
        trend: classifyTrendWithData({
          recentObservationCount: recentStats.attempts,
          previousObservationCount: previousStats.attempts,
          recentValue: recentStats.successRate,
          previousValue: previousStats.successRate,
          threshold: 0.08,
        }),
      });
    })
    .sort((left, right) =>
      left.successRate - right.successRate ||
      right.attempts - left.attempts ||
      left.action.localeCompare(right.action),
    );
}

function projectActionRuns(
  records: readonly RunReliabilityRecord[],
  aggregate: Pick<ActionAggregate, "action" | "documentKind" | "targetField">,
): RunReliabilityRecord[] {
  return records
    .map((record) => ({
      ...record,
      writeOutcomes: aggregate.action === WRITE_ACTION
        ? record.writeOutcomes.filter((outcome) =>
          buildActionKey({
            action: WRITE_ACTION,
            documentKind: outcome.documentKind,
            targetField: outcome.targetField,
          }) === buildActionKey(aggregate)
        )
        : [],
      workflowStepOutcomes: aggregate.action === WRITE_ACTION
        ? []
        : record.workflowStepOutcomes.filter((outcome) =>
          buildActionKey({
            action: outcome.action,
            documentKind: outcome.documentKind,
            targetField: outcome.targetField,
          }) === buildActionKey(aggregate)
        ),
    }))
    .filter((record) => record.writeOutcomes.length > 0 || record.workflowStepOutcomes.length > 0);
}

function actionSuccessStats(
  records: readonly RunReliabilityRecord[],
  aggregate: Pick<ActionAggregate, "action" | "documentKind" | "targetField">,
): {
  attempts: number;
  successRate: number;
} {
  let attempts = 0;
  let verified = 0;

  for (const record of records) {
    if (aggregate.action === WRITE_ACTION) {
      const outcomes = record.writeOutcomes.filter((outcome) =>
        buildActionKey({
          action: WRITE_ACTION,
          documentKind: outcome.documentKind,
          targetField: outcome.targetField,
        }) === buildActionKey(aggregate),
      );

      const scoredOutcomes = outcomes.filter(shouldScoreWriteOutcome);
      attempts += scoredOutcomes.length;
      verified += scoredOutcomes.filter((outcome) => outcome.status === "VERIFIED").length;
      continue;
    }

    const outcomes = record.workflowStepOutcomes.filter((outcome) =>
      buildActionKey({
        action: outcome.action,
        documentKind: outcome.documentKind,
        targetField: outcome.targetField,
      }) === buildActionKey(aggregate),
    );

    const scoredOutcomes = outcomes.filter(shouldScoreWorkflowOutcome);
    attempts += scoredOutcomes.length;
    verified += scoredOutcomes.filter((outcome) =>
      outcome.status === "VERIFIED" || (outcome.status === "EXECUTED" && outcome.verificationPassed)
    ).length;
  }

  return {
    attempts,
    successRate: ratio(verified, attempts),
  };
}

function createAggregate(input: {
  action: string;
  documentKind: string | null;
  targetField: string | null;
  supportLevel: ActionReliabilityScore["supportLevel"];
}): ActionAggregate {
  return {
    action: input.action,
    documentKind: input.documentKind,
    targetField: input.targetField,
    supportLevel: input.supportLevel ?? null,
    attempts: 0,
    verifiedSuccessCount: 0,
    blockedCount: 0,
    excludedObservationCount: 0,
    failureCount: 0,
    verificationFailureCount: 0,
  };
}

function buildActionKey(input: {
  action: string;
  documentKind: string | null;
  targetField: string | null;
}): string {
  return [input.documentKind ?? "", input.action, input.targetField ?? ""].join(":");
}
