import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import pino from "pino";
import { FinaleWorkbookProvider } from "./acquisition/finaleWorkbookProvider";
import { ManualUploadWorkbookProvider } from "./acquisition/manualUploadWorkbookProvider";
import { WorkbookAcquisitionService } from "./acquisition/workbookAcquisitionService";
import { loadEnv } from "./config/env";
import { getHealthPayload } from "./health";
import { FilesystemBatchRepository } from "./repositories/filesystemBatchRepository";
import { FilesystemScheduledRunRepository } from "./repositories/filesystemScheduledRunRepository";
import { FilesystemSubsidiaryRepository } from "./repositories/filesystemSubsidiaryRepository";
import { registerBatchRoutes } from "./routes/batches";
import { registerPatientRunRoutes } from "./routes/patientRuns";
import { BatchControlPlaneService } from "./services/batchControlPlaneService";
import { PortalCredentialProvider } from "./services/portalCredentialProvider";
import { SubsidiaryConfigService } from "./services/subsidiaryConfigService";

export async function createApp() {
  const env = loadEnv();
  const logger = pino({
    name: "medical-ai-qa-api",
    level: env.API_LOG_LEVEL,
  });

  const app = Fastify({
    loggerInstance: logger,
  });

  await app.register(cors, {
    origin: env.API_CORS_ORIGIN === "*" ? true : env.API_CORS_ORIGIN.split(",").map((value) => value.trim()),
  });

  await app.register(multipart, {
    limits: {
      files: 1,
    },
  });

  const repository = new FilesystemBatchRepository(env.API_STORAGE_ROOT);
  const scheduledRunRepository = new FilesystemScheduledRunRepository(env.API_STORAGE_ROOT);
  const subsidiaryRepository = new FilesystemSubsidiaryRepository(env.API_STORAGE_ROOT);
  const credentialProvider = new PortalCredentialProvider(env, logger);
  const subsidiaryConfigService = new SubsidiaryConfigService(
    subsidiaryRepository,
    credentialProvider,
    env,
    logger,
  );
  const acquisitionService = new WorkbookAcquisitionService(
    [new ManualUploadWorkbookProvider(), new FinaleWorkbookProvider()],
    repository,
    logger,
  );
  const batchService = new BatchControlPlaneService(
    repository,
    scheduledRunRepository,
    acquisitionService,
    subsidiaryConfigService,
    logger,
  );
  await batchService.initialize();

  app.get("/health", async () => getHealthPayload());
  await registerBatchRoutes(app, batchService);
  await registerPatientRunRoutes(app, batchService);

  app.setErrorHandler((error: unknown, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown API error.";
    const statusCode = message.includes("not found")
      ? 404
      : message.includes("not available") ||
          message.includes("parsed yet") ||
          message.includes("already running") ||
          message.includes("eligible for retry")
        ? 409
      : message.includes("required") || message.includes("supported")
        ? 400
        : 500;

    reply.status(statusCode).send({
      message,
    });
  });

  return app;
}
