import { createLogger } from "@medical-ai-qa/shared-logging";
import { createPortalWorker } from "./worker";
import {
  getPortalWorkerStartupDiagnostics,
  loadPortalWorkerEnv,
} from "./config/env";
import { loadPortalWorkerDotenv } from "./config/load-dotenv";

async function main(): Promise<void> {
  const logger = createLogger({ service: "portal-worker" });
  const dotenvLoadResult = loadPortalWorkerDotenv();

  logger.info("Portal worker environment diagnostics.", {
    ...getPortalWorkerStartupDiagnostics(process.env, dotenvLoadResult.loadedEnvPaths),
  });

  const env = loadPortalWorkerEnv(process.env);
  const worker = createPortalWorker(env, logger);

  logger.info("Portal worker ready.", {
    portalBaseUrl: env.portalBaseUrl,
    headless: env.playwrightHeadless,
  });

  await worker.start();
}

void main().catch((error: unknown) => {
  const logger = createLogger({ service: "portal-worker" });
  logger.error("Portal worker failed to start.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
