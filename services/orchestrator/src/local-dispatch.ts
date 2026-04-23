import { type Logger } from "@medical-ai-qa/shared-logging";
import { type PortalJob, type PortalJobResult } from "@medical-ai-qa/shared-types";

export function createLocalDispatcher(logger: Logger) {
  return async function dispatch(job: PortalJob): Promise<PortalJobResult> {
    logger.info("Simulating local dispatch to portal-worker.", {
      jobId: job.jobId,
      portal: job.portal,
    });

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: "queued",
      completedAt: new Date().toISOString(),
      summary: "Job accepted by local dispatcher stub.",
      failures: [],
      data: {
        targetService: "portal-worker",
      },
    };
  };
}
