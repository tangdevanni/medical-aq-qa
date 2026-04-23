import type {
  PatientRun,
  PatientWorkflowRun,
  WorkflowDomain,
  WorkflowRunStatus,
} from "@medical-ai-qa/shared-types";

export function createWorkflowRunId(patientRunId: string, workflowDomain: WorkflowDomain): string {
  return `${patientRunId}:${workflowDomain}`;
}

export function createDefaultWorkflowRuns(patientRunId: string, timestamp: string): PatientWorkflowRun[] {
  return (["coding", "qa"] as const).map((workflowDomain) => ({
    workflowRunId: createWorkflowRunId(patientRunId, workflowDomain),
    workflowDomain,
    status: "NOT_STARTED",
    stepName: "NOT_STARTED",
    message: null,
    chartUrl: null,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: timestamp,
    workflowResultPath: null,
    workflowLogPath: null,
  }));
}

export function upsertWorkflowRun(
  workflowRuns: PatientWorkflowRun[],
  nextRun: PatientWorkflowRun,
): PatientWorkflowRun[] {
  const existing = workflowRuns.find((candidate) => candidate.workflowDomain === nextRun.workflowDomain);
  const merged: PatientWorkflowRun = existing
    ? {
        ...existing,
        ...nextRun,
        workflowRunId: nextRun.workflowRunId || existing.workflowRunId,
      }
    : nextRun;

  return [
    ...workflowRuns.filter((candidate) => candidate.workflowDomain !== nextRun.workflowDomain),
    merged,
  ].sort((left, right) => left.workflowDomain.localeCompare(right.workflowDomain));
}

export function findWorkflowRun(
  workflowRuns: PatientWorkflowRun[],
  workflowDomain: WorkflowDomain,
): PatientWorkflowRun | null {
  return workflowRuns.find((candidate) => candidate.workflowDomain === workflowDomain) ?? null;
}

export function buildWorkflowRun(params: {
  patientRunId: string;
  workflowDomain: WorkflowDomain;
  status: WorkflowRunStatus;
  stepName: string;
  timestamp: string;
  startedAt?: string | null;
  completedAt?: string | null;
  chartUrl?: string | null;
  message?: string | null;
  workflowResultPath?: string | null;
  workflowLogPath?: string | null;
}): PatientWorkflowRun {
  return {
    workflowRunId: createWorkflowRunId(params.patientRunId, params.workflowDomain),
    workflowDomain: params.workflowDomain,
    status: params.status,
    stepName: params.stepName,
    message: params.message ?? null,
    chartUrl: params.chartUrl ?? null,
    startedAt: params.startedAt ?? (params.status === "NOT_STARTED" ? null : params.timestamp),
    completedAt: params.completedAt ?? null,
    lastUpdatedAt: params.timestamp,
    workflowResultPath: params.workflowResultPath ?? null,
    workflowLogPath: params.workflowLogPath ?? null,
  };
}

export function syncLegacyPatientRunFieldsFromWorkflowRuns(run: PatientRun): PatientRun {
  const codingWorkflow = findWorkflowRun(run.workflowRuns, "coding");
  if (!codingWorkflow || codingWorkflow.status === "NOT_STARTED") {
    return run;
  }

  run.notes = [...run.notes];
  return run;
}
