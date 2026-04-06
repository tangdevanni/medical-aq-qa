import { randomUUID } from "node:crypto";
import { PORTAL_NAMES, PORTAL_WORKFLOW_NAMES } from "@medical-ai-qa/shared-config";
import { createLogger } from "@medical-ai-qa/shared-logging";
import { type PortalJob } from "@medical-ai-qa/shared-types";
import {
  getPortalWorkerStartupDiagnostics,
  loadPortalWorkerEnv,
} from "./config/env";
import { loadPortalWorkerDotenv } from "./config/load-dotenv";
import { createPortalWorker } from "./worker";

function buildPhase11QueueQaPipelineJob(
  env: ReturnType<typeof loadPortalWorkerEnv>,
): PortalJob {
  const jobId = `phase11-${randomUUID()}`;

  return {
    jobId,
    portal: PORTAL_NAMES.finaleHealth,
    portalUrl: env.portalBaseUrl,
    requestedBy: "local-phase11-queue-qa-pipeline-runner",
    credentials: {
      username: env.portalUsername,
      password: env.portalPassword,
    },
    payload: {
      workflow: PORTAL_WORKFLOW_NAMES.phase11QueueQaPipeline,
      permissions: "read_only_navigation",
      source: "local-phase11-queue-qa-pipeline-runner",
      sourceType: "manual",
      readOnly: true,
      startPage: 1,
      maxRowsToScan: 10,
      maxPages: 3,
      maxTargetNotesToProcess: 5,
      includeNonTargetsInReport: true,
      captureSectionSamples: false,
      stopOnFirstFailure: false,
      revisitQueueBetweenRows: true,
      resumeFromState: false,
      statePath: "services/portal-worker/output/phase12-state.json",
      exportJsonPath: "services/portal-worker/output/phase12-report.json",
      exportCsvPath: "services/portal-worker/output/phase12-report.csv",
      debug: false,
    },
  };
}

export async function main(): Promise<void> {
  const logger = createLogger({ service: "portal-worker-phase11" });
  const dotenvLoadResult = loadPortalWorkerDotenv();

  logger.info("Portal worker environment diagnostics.", {
    ...getPortalWorkerStartupDiagnostics(process.env, dotenvLoadResult.loadedEnvPaths),
  });

  const env = loadPortalWorkerEnv(process.env);
  const worker = createPortalWorker(env, logger);
  const job = buildPhase11QueueQaPipelineJob(env);

  logger.info("Starting Phase 11 queue QA pipeline run.", {
    jobId: job.jobId,
    workflow: job.payload?.workflow,
    portal: job.portal,
    baseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
  });

  const result = await worker.run(job);

  logger.info("Completed Phase 11 queue QA pipeline run.", {
    jobId: job.jobId,
    workflow: job.payload?.workflow,
    portal: job.portal,
    baseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
    status: result.status,
    overallStatus: result.queueQaRunReport?.overallStatus ?? null,
    pagesProcessed: result.queueQaRunReport?.pagesProcessed ?? 0,
    processed: result.queueQaRunReport?.totals.notesProcessed ?? 0,
    errors: result.queueQaRunReport?.totals.errors ?? 0,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  const logger = createLogger({ service: "portal-worker-phase11" });
  logger.error("Phase 11 queue QA pipeline run failed.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
