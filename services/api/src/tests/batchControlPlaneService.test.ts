import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import type { WorkbookAcquisitionService } from "../acquisition/workbookAcquisitionService";
import { loadEnv } from "../config/env";
import { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import { FilesystemScheduledRunRepository } from "../repositories/filesystemScheduledRunRepository";
import { FilesystemSubsidiaryRepository } from "../repositories/filesystemSubsidiaryRepository";
import { BatchControlPlaneService } from "../services/batchControlPlaneService";
import { PortalCredentialProvider } from "../services/portalCredentialProvider";
import { SubsidiaryConfigService } from "../services/subsidiaryConfigService";

function createServiceFixture() {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), "medical-ai-qa-api-"));
  const repository = new FilesystemBatchRepository(storageRoot);
  const scheduledRunRepository = new FilesystemScheduledRunRepository(storageRoot);
  const subsidiaryRepository = new FilesystemSubsidiaryRepository(storageRoot);
  const logger = pino({ enabled: false });
  const env = loadEnv({
    DEFAULT_SUBSIDIARY_ID: "default",
    DEFAULT_SUBSIDIARY_SLUG: "default",
    DEFAULT_SUBSIDIARY_NAME: "Default Subsidiary",
    DEFAULT_SUBSIDIARY_PORTAL_BASE_URL: "https://app.finalehealth.com/provider/demo",
    PORTAL_USERNAME: "local-user",
    PORTAL_PASSWORD: "local-pass",
  });
  const credentialProvider = new PortalCredentialProvider(env, logger, {
    PORTAL_USERNAME: "local-user",
    PORTAL_PASSWORD: "local-pass",
  });
  const subsidiaryConfigService = new SubsidiaryConfigService(
    subsidiaryRepository,
    credentialProvider,
    env,
    logger,
  );

  const acquisitionService = {
    async acquireWorkbook(params: {
      batch: { sourceWorkbook: { storedPath: string } };
      input: { fileName: string; fileBuffer: Buffer };
    }) {
      await mkdir(path.dirname(params.batch.sourceWorkbook.storedPath), { recursive: true });
      await writeFile(params.batch.sourceWorkbook.storedPath, params.input.fileBuffer);
      return {
        providerId: "MANUAL_UPLOAD" as const,
        originalFileName: params.input.fileName,
        storedPath: params.batch.sourceWorkbook.storedPath,
        acquiredAt: new Date().toISOString(),
        acquisitionReference: null,
        notes: [],
      };
    },
  } as unknown as WorkbookAcquisitionService;

  return {
    service: new BatchControlPlaneService(
      repository,
      scheduledRunRepository,
      acquisitionService,
      subsidiaryConfigService,
      logger,
    ),
    scheduledRunRepository,
    cleanup: () => rmSync(storageRoot, { recursive: true, force: true }),
  };
}

describe("BatchControlPlaneService scheduler metadata", () => {
  it("creates a read-only 24-hour rerun schedule on workbook upload", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const batch = await fixture.service.createBatchUpload({
        fileName: "reference-workbook.xlsx",
        fileBuffer: Buffer.from("workbook"),
        billingPeriod: "2026-04",
      });

      assert.equal(batch.runMode, "read_only");
      assert.equal(batch.subsidiary.id, "default");
      assert.equal(batch.schedule.active, true);
      assert.equal(batch.schedule.rerunEnabled, true);
      assert.equal(batch.schedule.intervalHours, 24);
      assert.ok(batch.schedule.scheduledRunId);
      assert.ok(batch.schedule.nextScheduledRunAt);
      assert.equal(
        Date.parse(batch.schedule.nextScheduledRunAt!) > Date.parse(batch.createdAt),
        true,
      );

      const scheduledRun = await fixture.scheduledRunRepository.getScheduledRun(batch.schedule.scheduledRunId!);
      assert.ok(scheduledRun);
      assert.equal(scheduledRun.subsidiaryId, "default");
      assert.equal(scheduledRun.batchId, batch.id);
    } finally {
      fixture.cleanup();
    }
  });

  it("deactivates the older workbook schedule when a newer workbook is uploaded", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const firstBatch = await fixture.service.createBatchUpload({
        fileName: "older.xlsx",
        fileBuffer: Buffer.from("older"),
        billingPeriod: "2026-04",
      });
      const secondBatch = await fixture.service.createBatchUpload({
        fileName: "newer.xlsx",
        fileBuffer: Buffer.from("newer"),
        billingPeriod: "2026-04",
      });

      const firstReloaded = await fixture.service.getBatch(firstBatch.id);
      const secondReloaded = await fixture.service.getBatch(secondBatch.id);

      assert.ok(firstReloaded);
      assert.ok(secondReloaded);
      assert.equal(firstReloaded.schedule.active, false);
      assert.equal(firstReloaded.schedule.rerunEnabled, false);
      assert.equal(firstReloaded.schedule.nextScheduledRunAt, null);
      assert.equal(secondReloaded.schedule.active, true);
      assert.equal(secondReloaded.schedule.rerunEnabled, true);

      const firstSchedule = await fixture.scheduledRunRepository.getScheduledRun(firstReloaded.schedule.scheduledRunId!);
      const secondSchedule = await fixture.scheduledRunRepository.getScheduledRun(secondReloaded.schedule.scheduledRunId!);

      assert.ok(firstSchedule);
      assert.ok(secondSchedule);
      assert.equal(firstSchedule.active, false);
      assert.equal(secondSchedule.active, true);
      assert.equal(firstSchedule.subsidiaryId, "default");
      assert.equal(secondSchedule.subsidiaryId, "default");
    } finally {
      fixture.cleanup();
    }
  });
});
