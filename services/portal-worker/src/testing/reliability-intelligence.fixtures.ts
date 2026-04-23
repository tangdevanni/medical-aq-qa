import {
  type RunReliabilityRecord,
  runReliabilityRecordSchema,
} from "../types/reliabilityIntelligence";
import {
  driftSignalSchema,
  executionTraceEventSchema,
  selectorHealthRecordSchema,
  supportMatrixDiagnosticSchema,
} from "../types/runtimeDiagnostics";

export function buildRunRecord(
  overrides: Partial<RunReliabilityRecord> = {},
): RunReliabilityRecord {
  return runReliabilityRecordSchema.parse({
    runId: overrides.runId ?? "run-1",
    timestamp: overrides.timestamp ?? "2026-03-25T00:00:00.000Z",
    overallStatus: overrides.overallStatus ?? "SUCCESS",
    policySnapshot: overrides.policySnapshot ?? {
      capturedAt: overrides.timestamp ?? "2026-03-25T00:00:00.000Z",
      storageKind: "IN_MEMORY",
      persistent: false,
      scoringPolicyVersion: "phase20-v2",
      runtimeConfigSnapshot: null,
      systemSupportSnapshot: null,
    },
    diagnosticsSummary: overrides.diagnosticsSummary ?? {
      totalDiagnostics: 0,
      bySeverity: [],
      byCategory: [],
      topCodes: [],
      supportLevelBlockedCounts: [],
      retryStats: {
        totalRecords: 0,
        exhaustedCount: 0,
        byPolicy: [],
      },
    },
    selectorHealthSummary: overrides.selectorHealthSummary ?? {
      totalChecks: 0,
      statusCounts: [],
      missingByDocumentKind: [],
      ambiguousByAction: [],
    },
    driftSignalSummary: overrides.driftSignalSummary ?? {
      totalSignals: 0,
      byType: [],
      byDocumentKind: [],
    },
    reliabilitySummary: overrides.reliabilitySummary ?? {
      extractionSuccessRate: 1,
      writeVerificationRate: 1,
      workflowStepVerificationRate: 1,
      blockedVsFailed: {
        blocked: 0,
        failed: 0,
      },
      selectorMissingByDocumentKind: [],
      ambiguousSelectorByAction: [],
      driftSignalsByType: [],
      supportDispositionCounts: [],
    },
    writeSummary: overrides.writeSummary ?? {
      writeAttempts: 0,
      writesExecuted: 0,
      writesVerified: 0,
      writesBlocked: 0,
      writesSkipped: 0,
      writeFailures: 0,
      verificationFailures: 0,
      dryRunCount: 0,
      topGuardFailureReasons: [],
    },
    workflowSummary: overrides.workflowSummary ?? {
      workflowAttempts: 0,
      workflowCompleted: 0,
      workflowPartial: 0,
      workflowBlocked: 0,
      workflowFailed: 0,
      workflowReviewRequired: 0,
      workflowPlannedOnly: 0,
      operatorCheckpointRequiredCount: 0,
      stepCountsByAction: [],
      workflowAttemptsByDocumentKind: [],
      workflowCompletedByDocumentKind: [],
      workflowPartialByDocumentKind: [],
      workflowReviewRequiredByDocumentKind: [],
      workflowBlockedByDocumentKind: [],
      workflowFailedByDocumentKind: [],
      workflowPlannedOnlyByDocumentKind: [],
      stepCountsByDocumentKind: [],
      checkpointCountsByCategory: [],
      supportLevelCounts: [],
      topWorkflowGuardFailures: [],
      topVerificationFailures: [],
    },
    selectorHealth: overrides.selectorHealth ?? [],
    driftSignals: overrides.driftSignals ?? [],
    executionTrace: overrides.executionTrace ?? [],
    supportMatrixDiagnostics: overrides.supportMatrixDiagnostics ?? [],
    writeOutcomes: overrides.writeOutcomes ?? [],
    workflowStepOutcomes: overrides.workflowStepOutcomes ?? [],
  });
}

export function buildSelectorHealthRecord(
  overrides: Partial<RunReliabilityRecord["selectorHealth"][number]> = {},
): RunReliabilityRecord["selectorHealth"][number] {
  return selectorHealthRecordSchema.parse({
    name: overrides.name ?? "VISIT_NOTE.SAVE_PAGE.workflowAction",
    documentKind: overrides.documentKind ?? "VISIT_NOTE",
    phase: overrides.phase ?? "WORKFLOW_EXECUTION",
    action: overrides.action ?? "SAVE_PAGE",
    targetField: overrides.targetField ?? "frequencySummary",
    required: overrides.required ?? true,
    expectedCardinality: overrides.expectedCardinality ?? "ONE",
    status: overrides.status ?? "HEALTHY",
    matchedCount: overrides.matchedCount ?? 1,
    selectorUsed: overrides.selectorUsed ?? "button.save",
    supportLevel: overrides.supportLevel ?? "REVIEW_GATED",
    supportDisposition: overrides.supportDisposition ?? "EXECUTABLE",
    reason: overrides.reason ?? null,
  });
}

export function buildDriftSignal(
  overrides: Partial<RunReliabilityRecord["driftSignals"][number]> = {},
): RunReliabilityRecord["driftSignals"][number] {
  return driftSignalSchema.parse({
    timestamp: overrides.timestamp ?? "2026-03-25T00:00:00.000Z",
    type: overrides.type ?? "SELECTOR_MISSING",
    severity: overrides.severity ?? "ERROR",
    documentKind: overrides.documentKind ?? "VISIT_NOTE",
    selectorName: overrides.selectorName ?? "VISIT_NOTE.SAVE_PAGE.workflowAction",
    action: overrides.action ?? "SAVE_PAGE",
    targetField: overrides.targetField ?? "frequencySummary",
    supportLevel: overrides.supportLevel ?? "REVIEW_GATED",
    supportDisposition: overrides.supportDisposition ?? "EXECUTABLE",
    routePath: overrides.routePath ?? "/documents/note/visitnote/[id]",
    reason: overrides.reason ?? "Expected executable selector missing.",
  });
}

export function buildSupportMatrixDiagnostic(
  overrides: Partial<RunReliabilityRecord["supportMatrixDiagnostics"][number]> = {},
): RunReliabilityRecord["supportMatrixDiagnostics"][number] {
  return supportMatrixDiagnosticSchema.parse({
    timestamp: overrides.timestamp ?? "2026-03-25T00:00:00.000Z",
    documentKind: overrides.documentKind ?? "VISIT_NOTE",
    targetField: overrides.targetField ?? "frequencySummary",
    action: overrides.action ?? "SAVE_PAGE",
    supportLevel: overrides.supportLevel ?? "REVIEW_GATED",
    supportDisposition: overrides.supportDisposition ?? "EXECUTABLE",
    driftEligible: overrides.driftEligible ?? true,
    reason: overrides.reason ?? "Executable action.",
  });
}

export function buildExecutionTraceEvent(
  overrides: Partial<RunReliabilityRecord["executionTrace"][number]> = {},
): RunReliabilityRecord["executionTrace"][number] {
  return executionTraceEventSchema.parse({
    timestamp: overrides.timestamp ?? "2026-03-25T00:00:00.000Z",
    phase: overrides.phase ?? "WORKFLOW_EXECUTION",
    event: overrides.event ?? "STEP_VERIFIED",
    status: overrides.status ?? "VERIFIED",
    documentKind: overrides.documentKind ?? "VISIT_NOTE",
    action: overrides.action ?? "SAVE_PAGE",
    targetField: overrides.targetField ?? "frequencySummary",
    selectorName: overrides.selectorName ?? null,
    supportDisposition: overrides.supportDisposition ?? "EXECUTABLE",
    detail: overrides.detail ?? "Workflow step verified.",
  });
}
