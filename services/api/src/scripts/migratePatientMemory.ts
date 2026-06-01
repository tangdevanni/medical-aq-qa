import pino from "pino";
import { FinaleWorkbookProvider } from "../acquisition/finaleWorkbookProvider";
import { ManualUploadWorkbookProvider } from "../acquisition/manualUploadWorkbookProvider";
import { WorkbookAcquisitionService } from "../acquisition/workbookAcquisitionService";
import { loadEnv } from "../config/env";
import { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import { FilesystemScheduledRunRepository } from "../repositories/filesystemScheduledRunRepository";
import { FilesystemSubsidiaryRepository } from "../repositories/filesystemSubsidiaryRepository";
import { BatchControlPlaneService } from "../services/batchControlPlaneService";
import { PatientMemoryService } from "../services/patientMemoryService";
import { PortalCredentialProvider } from "../services/portalCredentialProvider";
import { SubsidiaryConfigService } from "../services/subsidiaryConfigService";

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length).trim() || null;
  }
  const index = process.argv.indexOf(`--${name}`);
  const next = index >= 0 ? process.argv[index + 1] : null;
  return next && !next.startsWith("--") ? next.trim() : null;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = pino({
    name: "patient-memory-migration",
    level: env.API_LOG_LEVEL,
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
  const service = new BatchControlPlaneService(
    repository,
    scheduledRunRepository,
    patientMemoryService,
    acquisitionService,
    subsidiaryConfigService,
    logger,
    {
      patientMemoryWriteEnabled: env.PATIENT_MEMORY_WRITE_ENABLED,
      deltaReuseEnabled: env.DELTA_REUSE_ENABLED,
      autonomousMode: "manual_only",
    },
  );
  await service.initialize();

  const summary = await service.migratePatientMemory({
    agencyId: getArg("agency"),
    dryRun: process.argv.includes("--dry-run"),
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
