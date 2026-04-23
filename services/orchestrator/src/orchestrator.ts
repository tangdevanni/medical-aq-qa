import { type PortalJob, type PortalJobResult } from "@medical-ai-qa/shared-types";
import { DEFAULT_SERVICE_SETTINGS } from "@medical-ai-qa/shared-config";
import { type Logger } from "@medical-ai-qa/shared-logging";

export interface OrchestratorDependencies {
  dispatch: (job: PortalJob) => Promise<PortalJobResult>;
  logger: Logger;
}

export class Orchestrator {
  constructor(private readonly dependencies: OrchestratorDependencies) {}

  async start(): Promise<void> {
    this.dependencies.logger.info("Polling loop not yet implemented.", {
      pollIntervalMs: DEFAULT_SERVICE_SETTINGS.orchestratorPollIntervalMs,
    });
  }

  async run(job: PortalJob): Promise<PortalJobResult> {
    this.dependencies.logger.info("Dispatching portal job.", {
      jobId: job.jobId,
      portal: job.portal,
      requestedBy: job.requestedBy,
    });

    const result = await this.dependencies.dispatch(job);

    this.dependencies.logger.info("Portal job dispatch completed.", {
      jobId: job.jobId,
      portal: job.portal,
      status: result.status,
    });

    return result;
  }
}
