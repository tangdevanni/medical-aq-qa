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

function buildPhase8DocumentHubJob(
  env: ReturnType<typeof loadPortalWorkerEnv>,
): PortalJob {
  const jobId = `phase8-${randomUUID()}`;

  return {
    jobId,
    portal: PORTAL_NAMES.finaleHealth,
    portalUrl: env.portalBaseUrl,
    requestedBy: "local-phase8-document-hub-runner",
    credentials: {
      username: env.portalUsername,
      password: env.portalPassword,
    },
    payload: {
      workflow: PORTAL_WORKFLOW_NAMES.documentTrackingHubDiscovery,
      permissions: "read_only_navigation",
      source: "local-phase8-document-hub-runner",
      sourceType: "manual",
      readOnly: true,
    },
  };
}

async function main(): Promise<void> {
  const logger = createLogger({ service: "portal-worker-phase8" });
  const dotenvLoadResult = loadPortalWorkerDotenv();

  logger.info("Portal worker environment diagnostics.", {
    ...getPortalWorkerStartupDiagnostics(process.env, dotenvLoadResult.loadedEnvPaths),
  });

  const env = loadPortalWorkerEnv(process.env);
  const worker = createPortalWorker(env, logger);
  const job = buildPhase8DocumentHubJob(env);

  logger.info("Starting Phase 8 document-tracking hub discovery run.", {
    jobId: job.jobId,
    workflow: job.payload?.workflow,
    portal: job.portal,
    baseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
  });

  const result = await worker.run(job);

  logger.info("Completed Phase 8 document-tracking hub discovery run.", {
    jobId: job.jobId,
    workflow: job.payload?.workflow,
    portal: job.portal,
    baseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
    status: result.status,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  const logger = createLogger({ service: "portal-worker-phase8" });
  logger.error("Phase 8 document-tracking hub discovery run failed.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
