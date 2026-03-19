import { createLogger } from "@medical-ai-qa/shared-logging";
import { Orchestrator } from "./orchestrator";
import { createLocalDispatcher } from "./local-dispatch";

async function main(): Promise<void> {
  const logger = createLogger({ service: "orchestrator" });
  const orchestrator = new Orchestrator({
    dispatch: createLocalDispatcher(logger),
    logger,
  });

  logger.info("Orchestrator ready.", {
    service: "orchestrator",
    mode: "local-dispatch",
  });

  await orchestrator.start();
}

void main().catch((error: unknown) => {
  const logger = createLogger({ service: "orchestrator" });
  logger.error("Orchestrator failed to start.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
