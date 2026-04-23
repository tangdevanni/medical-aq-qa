import { type DocumentKind } from "@medical-ai-qa/shared-types";
import {
  type RunReliabilityRecord,
  runReliabilityRecordSchema,
} from "../types/reliabilityIntelligence";
import { type QueueQaRunReport } from "../types/queueQaPipeline";
import { type SupportDisposition } from "../types/runtimeDiagnostics";
import { getSupportDispositionForAction, getWorkflowSupport } from "../workflows/workflowSupportMatrix";
import { getWriteAllowlistEntry } from "../writes/writeAllowlist";
import { SCORING_POLICY_VERSION } from "./reliabilityIntelligenceShared";

export interface RunHistoryStoreDescriptor {
  kind: string;
  persistent: boolean;
}

export interface RunHistoryStore {
  append(record: RunReliabilityRecord): void;
  list(): readonly RunReliabilityRecord[];
  clear(): void;
  describe(): RunHistoryStoreDescriptor;
}

class InMemoryRunHistoryStore implements RunHistoryStore {
  private records: RunReliabilityRecord[] = [];

  append(record: RunReliabilityRecord): void {
    const clonedRecord = structuredClone(record);
    const existingIndex = this.records.findIndex((entry) => entry.runId === clonedRecord.runId);

    if (existingIndex >= 0) {
      this.records = this.records.map((entry, index) => index === existingIndex ? clonedRecord : entry);
      return;
    }

    this.records = [...this.records, clonedRecord];
  }

  list(): readonly RunReliabilityRecord[] {
    return structuredClone(this.records);
  }

  clear(): void {
    this.records = [];
  }

  describe(): RunHistoryStoreDescriptor {
    return {
      kind: "IN_MEMORY",
      persistent: false,
    };
  }
}

let runHistoryStore: RunHistoryStore = new InMemoryRunHistoryStore();

export function setRunHistoryStore(store: RunHistoryStore): void {
  runHistoryStore = store;
}

export function clearRunHistory(): void {
  runHistoryStore.clear();
}

export function getRunHistoryStoreDescriptor(): RunHistoryStoreDescriptor {
  return runHistoryStore.describe();
}

export function listRunHistoryRecords(): RunReliabilityRecord[] {
  return [...runHistoryStore.list()];
}

export function getLatestRunReliabilityRecord(): RunReliabilityRecord | null {
  const records = runHistoryStore.list();
  return records.length > 0 ? records[records.length - 1] ?? null : null;
}

export function recordRunReliabilityReport(
  report: QueueQaRunReport,
): RunReliabilityRecord {
  const record = buildRunReliabilityRecord(report);
  runHistoryStore.append(record);
  return record;
}

export function buildRunReliabilityRecord(
  report: QueueQaRunReport,
): RunReliabilityRecord {
  const selectorHealth = report.results.flatMap((result) => result.selectorHealth ?? []);
  const driftSignals = report.results.flatMap((result) => result.driftSignals ?? []);
  const executionTrace = report.results.flatMap((result) => result.executionTrace ?? []);
  const supportMatrixDiagnostics = report.results.flatMap((result) => result.supportMatrixDiagnostics ?? []);
  const processedResults = report.results.filter((result): result is Extract<QueueQaRunReport["results"][number], { status: "PROCESSED" }> =>
    result.status === "PROCESSED",
  );

  return runReliabilityRecordSchema.parse({
    runId: report.runId,
    timestamp: report.completedAt,
    overallStatus: report.overallStatus,
    policySnapshot: {
      capturedAt: report.completedAt,
      storageKind: getRunHistoryStoreDescriptor().kind,
      persistent: getRunHistoryStoreDescriptor().persistent,
      scoringPolicyVersion: SCORING_POLICY_VERSION,
      runtimeConfigSnapshot: report.runtimeConfigSnapshot ?? null,
      systemSupportSnapshot: report.systemSupportSnapshot ?? null,
    },
    diagnosticsSummary: report.diagnosticsSummary ?? null,
    selectorHealthSummary: report.selectorHealthSummary ?? null,
    driftSignalSummary: report.driftSignalSummary ?? null,
    reliabilitySummary: report.reliabilitySummary ?? null,
    writeSummary: report.writeSummary,
    workflowSummary: report.workflowSummary,
    selectorHealth,
    driftSignals,
    executionTrace,
    supportMatrixDiagnostics,
    writeOutcomes: processedResults.flatMap((result) =>
      result.writeExecutionResult.results.map((attempt) => {
        const supportClassification = resolveWriteSupportClassification(
          attempt.targetDocumentKind,
          attempt.targetField,
        );

        return {
          documentKind: attempt.targetDocumentKind,
          targetField: attempt.targetField,
          status: attempt.status,
          mode: attempt.mode,
          verificationPassed: attempt.verificationPassed,
          supportDisposition: supportClassification.supportDisposition,
          supportClassificationSource: "WRITE_ALLOWLIST" as const,
          supportClassificationReason: supportClassification.reason,
          contributesToReliability: supportClassification.contributesToReliability,
          guardFailures: attempt.guardFailures,
        };
      })
    ),
    workflowStepOutcomes: processedResults.flatMap((result) => {
      const workflowSupport =
        result.workflowCompletionResult.workflowSupport ??
        result.workflowSupport ??
        getWorkflowSupport({
          documentKind: result.documentExtraction.documentKind,
          targetField: result.workflowCompletionResult.targetField,
        });

      const workflowDiagnostics = (result.supportMatrixDiagnostics ?? []).filter((diagnostic) =>
        diagnostic.documentKind === result.workflowCompletionResult.documentKind &&
        diagnostic.targetField === result.workflowCompletionResult.targetField,
      );

      return result.workflowCompletionResult.steps.map((step) => ({
        ...(resolveWorkflowSupportClassification(step.action, workflowSupport, workflowDiagnostics)),
        documentKind: result.workflowCompletionResult.documentKind,
        action: step.action,
        targetField: result.workflowCompletionResult.targetField,
        status: step.status,
        verificationPassed: step.verificationPassed,
        guardFailures: step.guardFailures,
      }));
    }),
  });
}

function resolveWriteSupportClassification(
  documentKind: DocumentKind | null,
  targetField: RunReliabilityRecord["writeOutcomes"][number]["targetField"],
): {
  supportDisposition: SupportDisposition | null;
  reason: string;
  contributesToReliability: boolean;
} {
  const allowlistEntry = getWriteAllowlistEntry(documentKind, targetField);

  if (!allowlistEntry) {
    return {
      supportDisposition: "NOT_SUPPORTED",
      reason: "No write allowlist entry matched this document kind and target field.",
      contributesToReliability: false,
    };
  }

  if (allowlistEntry.allowedExecutionModes.includes("EXECUTE")) {
    return {
      supportDisposition: "EXECUTABLE",
      reason: "Write allowlist permits EXECUTE for this document kind and target field.",
      contributesToReliability: true,
    };
  }

  return {
    supportDisposition: "DRY_RUN_ONLY",
    reason: "Write allowlist permits DRY_RUN only for this document kind and target field.",
    contributesToReliability: false,
  };
}

function resolveWorkflowSupportClassification(
  action: RunReliabilityRecord["workflowStepOutcomes"][number]["action"],
  workflowSupport: ReturnType<typeof getWorkflowSupport> | null,
  diagnostics: QueueQaRunReport["results"][number]["supportMatrixDiagnostics"],
) {
  const diagnostic = (diagnostics ?? []).find((entry) => entry.action === action) ?? null;
  const supportDisposition = diagnostic?.supportDisposition ??
    (workflowSupport ? getSupportDispositionForAction(workflowSupport, action) : null);

  return {
    supportLevel: diagnostic?.supportLevel ?? workflowSupport?.supportLevel ?? null,
    supportDisposition,
    supportClassificationSource: "WORKFLOW_SUPPORT_MATRIX" as const,
    supportClassificationReason: diagnostic?.reason ??
      workflowSupport?.reason ??
      "No workflow support policy matched this document/action combination.",
    contributesToReliability: supportDisposition === "EXECUTABLE",
  };
}
