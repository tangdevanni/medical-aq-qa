import { PORTAL_WORKFLOW_NAMES } from "@medical-ai-qa/shared-config";
import { type Logger } from "@medical-ai-qa/shared-logging";
import { type PortalJob, type PortalJobResult } from "@medical-ai-qa/shared-types";
import { createAuditLogger } from "./audit/logger";
import { AUDIT_EVENTS } from "./audit/events";
import { WORKFLOW_FAILURE_CODES } from "./errors/failure-codes";
import { WorkflowError } from "./errors/workflow-error";
import { loadPortalWorkerEnv, type PortalWorkerEnv } from "./config/env";
import {
  createWorkflowState,
  markWorkflowCheckpoint,
  markWorkflowFailed,
  markWorkflowRunning,
  markWorkflowSucceeded,
} from "./state/workflow-state";
import { runDocumentTrackingHubDiscoveryWorkflow } from "./workflows/run-document-tracking-hub-discovery";
import { runOrdersQaInteractionForensicsWorkflow } from "./workflows/run-orders-qa-interaction-forensics";
import { runOrdersQaEntryWorkflow } from "./workflows/run-orders-qa-entry-workflow";
import { runPhase7TileInteractionWorkflow } from "./workflows/run-phase7-tile-interaction-workflow";
import { runPortalDiscoveryWorkflow } from "./workflows/run-portal-discovery-workflow";
import { runOpenQaItemWorkflow } from "./workflows/run-open-qa-item-workflow";

export class PortalWorker {
  private readonly audit: ReturnType<typeof createAuditLogger>;

  constructor(
    private readonly env: PortalWorkerEnv,
    private readonly logger: Logger,
  ) {
    this.audit = createAuditLogger(logger);
  }

  async start(): Promise<void> {
    this.logger.info("Portal worker bootstrap complete.", {
      portalBaseUrl: this.env.portalBaseUrl,
    });
  }

  async run(job: PortalJob): Promise<PortalJobResult> {
    let state = createWorkflowState(job);
    this.audit.record(AUDIT_EVENTS.workflowStarted, {
      jobId: job.jobId,
      portal: job.portal,
    });

    try {
      state = markWorkflowRunning(state);
      const workflowName =
        typeof job.payload?.workflow === "string"
          ? job.payload.workflow
          : PORTAL_WORKFLOW_NAMES.openQaItem;
      const workflowRunner =
        workflowName === PORTAL_WORKFLOW_NAMES.documentTrackingHubDiscovery
          ? runDocumentTrackingHubDiscoveryWorkflow
          : workflowName === PORTAL_WORKFLOW_NAMES.phase7TileInteraction
          ? runPhase7TileInteractionWorkflow
          : workflowName === PORTAL_WORKFLOW_NAMES.ordersQaInteractionForensics
          ? runOrdersQaInteractionForensicsWorkflow
          : workflowName === PORTAL_WORKFLOW_NAMES.ordersQaEntryDiscovery
            ? runOrdersQaEntryWorkflow
            : workflowName === PORTAL_WORKFLOW_NAMES.portalDiscovery ||
                workflowName === PORTAL_WORKFLOW_NAMES.phase4PortalDiscovery
              ? runPortalDiscoveryWorkflow
              : runOpenQaItemWorkflow;

      const result = await workflowRunner(job, this.env, this.logger, {
        onCheckpoint(status) {
          markWorkflowCheckpoint(state, status);
        },
      });

      if (result.status === "failed") {
        markWorkflowFailed(state, result.summary);

        this.audit.record(AUDIT_EVENTS.workflowFailed, {
          jobId: job.jobId,
          code: result.error?.code ?? WORKFLOW_FAILURE_CODES.unknown,
          retryable: result.error?.retryable ?? true,
        });

        return result;
      }

      markWorkflowSucceeded(state, result.completedAt, result.status);

      this.audit.record(AUDIT_EVENTS.workflowCompleted, {
        jobId: job.jobId,
        status: result.status,
      });

      return result;
    } catch (error: unknown) {
      const workflowError =
        error instanceof WorkflowError
          ? error
          : new WorkflowError(
              WORKFLOW_FAILURE_CODES.unknown,
              error instanceof Error ? error.message : "Unknown workflow failure.",
              true,
            );

      markWorkflowFailed(state, workflowError.message);

      this.audit.record(AUDIT_EVENTS.workflowFailed, {
        jobId: job.jobId,
        code: workflowError.code,
        retryable: workflowError.retryable,
      });

      return {
        jobId: job.jobId,
        portal: job.portal,
        status: "failed",
        completedAt: new Date().toISOString(),
        summary: workflowError.message,
        failures: [
          {
            code: workflowError.code,
            message: workflowError.message,
            retryable: workflowError.retryable,
          },
        ],
        error: {
          code: workflowError.code,
          message: workflowError.message,
          retryable: workflowError.retryable,
        },
      };
    }
  }
}

export function createPortalWorker(
  env = loadPortalWorkerEnv(process.env),
  logger: Logger,
): PortalWorker {
  return new PortalWorker(env, logger);
}
