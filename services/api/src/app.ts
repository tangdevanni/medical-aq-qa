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
import { registerAgencyRoutes } from "./routes/agencies";
import { registerBatchRoutes } from "./routes/batches";
import { registerPatientRunRoutes } from "./routes/patientRuns";
import { BatchControlPlaneService } from "./services/batchControlPlaneService";
import { PatientMemoryService } from "./services/patientMemoryService";
import { PortalCredentialProvider } from "./services/portalCredentialProvider";
import { SubsidiaryConfigService } from "./services/subsidiaryConfigService";
import { getApiRuntimeVersion } from "./runtimeVersion";

export async function createApp() {
  const env = loadEnv();
  const logger = pino({
    name: "medical-ai-qa-api",
    level: env.API_LOG_LEVEL,
  });

  const app = Fastify({
    loggerInstance: logger,
    requestTimeout: env.API_REQUEST_TIMEOUT_MS,
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
  const patientMemoryService = new PatientMemoryService(env.API_STORAGE_ROOT);
  const subsidiaryRepository = new FilesystemSubsidiaryRepository(env.API_STORAGE_ROOT);
  const credentialProvider = new PortalCredentialProvider(env, logger);
  const subsidiaryConfigService = new SubsidiaryConfigService(
    subsidiaryRepository,
    credentialProvider,
    env,
    logger,
  );
  const acquisitionService = new WorkbookAcquisitionService(
    [
      new ManualUploadWorkbookProvider(),
      new FinaleWorkbookProvider(subsidiaryConfigService, logger),
    ],
    repository,
    logger,
  );
  const batchService = new BatchControlPlaneService(
    repository,
    scheduledRunRepository,
    patientMemoryService,
    acquisitionService,
    subsidiaryConfigService,
    logger,
    {
      patientMemoryWriteEnabled: env.PATIENT_MEMORY_WRITE_ENABLED,
      deltaReuseEnabled: env.DELTA_REUSE_ENABLED,
      autonomousMode: env.API_AUTONOMOUS_MODE,
      scheduleLocalTimes: env.DEFAULT_SUBSIDIARY_RERUN_LOCAL_TIMES,
      workbookIntakeDay: env.DEFAULT_SUBSIDIARY_WORKBOOK_INTAKE_DAY,
      workbookIntakeLocalTime: env.DEFAULT_SUBSIDIARY_WORKBOOK_INTAKE_LOCAL_TIME,
      deltaRunWeekdays: env.DEFAULT_SUBSIDIARY_DELTA_RUN_WEEKDAYS,
    },
  );
  await batchService.initialize();

  app.get("/health", async () => getHealthPayload());
  app.get("/api/version", async () => getApiRuntimeVersion());
  await registerAgencyRoutes(app, batchService);
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
