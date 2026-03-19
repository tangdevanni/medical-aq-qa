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

const LOCAL_WORKFLOW_NAME = PORTAL_WORKFLOW_NAMES.openQaItem;

function buildLocalPortalJob(env: ReturnType<typeof loadPortalWorkerEnv>): PortalJob {
  const jobId = `local-${randomUUID()}`;

  return {
    jobId,
    portal: PORTAL_NAMES.finaleHealth,
    portalUrl: env.portalBaseUrl,
    requestedBy: "local-test-runner",
    credentials: {
      username: env.portalUsername,
      password: env.portalPassword,
    },
    payload: {
      workflow: LOCAL_WORKFLOW_NAME,
      permissions: "read_only_navigation",
      source: "local-test-runner",
      sourceType: "manual",
    },
  };
}

async function main(): Promise<void> {
  const logger = createLogger({ service: "portal-worker-local" });
  const dotenvLoadResult = loadPortalWorkerDotenv();

  logger.info("Portal worker environment diagnostics.", {
    ...getPortalWorkerStartupDiagnostics(process.env, dotenvLoadResult.loadedEnvPaths),
  });

  const env = loadPortalWorkerEnv(process.env);
  const worker = createPortalWorker(env, logger);
  const job = buildLocalPortalJob(env);
  const workflow = String(job.payload?.workflow ?? LOCAL_WORKFLOW_NAME);

  logger.info("Starting local portal-worker run.", {
    jobId: job.jobId,
    workflow,
    portal: job.portal,
    baseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
  });

  const result = await worker.run(job);

  logger.info("Completed local portal-worker run.", {
    jobId: job.jobId,
    workflow,
    portal: job.portal,
    baseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
    status: result.status,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  const logger = createLogger({ service: "portal-worker-local" });
  logger.error("Local portal-worker run failed.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
