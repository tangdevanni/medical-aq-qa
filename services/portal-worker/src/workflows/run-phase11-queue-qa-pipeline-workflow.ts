import { type Logger } from "@medical-ai-qa/shared-logging";
import {
  WORKFLOW_CHECKPOINTS,
  type PortalJob,
  type PortalJobError,
  type PortalJobResult,
  type WorkflowCheckpointStatus,
} from "@medical-ai-qa/shared-types";
import { type PortalWorkerEnv } from "../config/env";
import { WorkflowError } from "../errors/workflow-error";
import { executeQueueQaPipeline } from "../pipelines/queueQaPipeline";

export interface Phase11QueueQaPipelineWorkflowOptions {
  onCheckpoint?: (status: WorkflowCheckpointStatus) => void;
}

export async function runPhase11QueueQaPipelineWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
  options: Phase11QueueQaPipelineWorkflowOptions = {},
): Promise<PortalJobResult> {
  try {
    const report = await executeQueueQaPipeline(job, env, logger, {
      onCheckpoint: options.onCheckpoint,
    });

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: WORKFLOW_CHECKPOINTS.qaQueuePipelineComplete,
      completedAt: report.completedAt,
      summary: buildWorkflowSummary(report),
      queueQaRunReport: report,
      failures: report.results
        .filter((result) => result.status === "ERROR")
        .map((result) => ({
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.recoverable,
        })),
      data: report as unknown as Record<string, unknown>,
    };
  } catch (error: unknown) {
    const failure = classifyWorkflowFailure(error);

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: "failed",
      completedAt: new Date().toISOString(),
      summary: failure.message,
      failures: [failure],
      error: failure,
    };
  }
}

function buildWorkflowSummary(result: Awaited<ReturnType<typeof executeQueueQaPipeline>>): string {
  return [
    `Phase 11 queue QA pipeline completed with overallStatus=${result.overallStatus}.`,
    `pagesProcessed=${result.pagesProcessed}.`,
    `rowsScanned=${result.totals.rowsScanned}.`,
    `targetsDetected=${result.totals.targetsDetected}.`,
    `notesProcessed=${result.totals.notesProcessed}.`,
    `errors=${result.totals.errors}.`,
  ].join(" ");
}

function classifyWorkflowFailure(error: unknown): PortalJobError {
  if (error instanceof WorkflowError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error && /timeout/i.test(error.message)) {
    return {
      code: "QUEUE_LOAD_FAILED",
      message: error.message,
      retryable: true,
    };
  }

  return {
    code: "QUEUE_LOAD_FAILED",
    message: error instanceof Error ? error.message : "Phase 11 queue QA pipeline failed.",
    retryable: true,
  };
}
