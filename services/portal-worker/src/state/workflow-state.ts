import {
  type PortalJob,
  type WorkflowCheckpointStatus,
  type WorkflowState,
  type WorkflowStatus,
} from "@medical-ai-qa/shared-types";

function transitionState(
  state: WorkflowState,
  status: WorkflowStatus,
  note?: string,
): WorkflowState {
  state.status = status;
  state.history.push({
    status,
    at: new Date().toISOString(),
    note,
  });
  return state;
}

export function createWorkflowState(job: PortalJob): WorkflowState {
  const startedAt = new Date().toISOString();
  return {
    jobId: job.jobId,
    status: "queued",
    startedAt,
    history: [
      {
        status: "queued",
        at: startedAt,
      },
    ],
  };
}

export function markWorkflowRunning(state: WorkflowState): WorkflowState {
  return transitionState(state, "running");
}

export function markWorkflowCheckpoint(
  state: WorkflowState,
  status: WorkflowCheckpointStatus,
): WorkflowState {
  return transitionState(state, status);
}

export function markWorkflowSucceeded(
  state: WorkflowState,
  completedAt: string,
  status: WorkflowStatus = "succeeded",
): WorkflowState {
  transitionState(state, status);
  state.completedAt = completedAt;
  return state;
}

export function markWorkflowFailed(state: WorkflowState, message: string): WorkflowState {
  transitionState(state, "failed", message);
  state.completedAt = new Date().toISOString();
  state.errorMessage = message;
  return state;
}
