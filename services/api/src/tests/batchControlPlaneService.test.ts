import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import type { WorkbookAcquisitionService } from "../acquisition/workbookAcquisitionService";
import type { PatientQueueArtifact } from "@medical-ai-qa/shared-types";
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
      input: { fileName?: string; fileBuffer?: Buffer; exportName?: string };
      providerId: "MANUAL_UPLOAD" | "FINALE";
    }) {
      await mkdir(path.dirname(params.batch.sourceWorkbook.storedPath), { recursive: true });
      const fileBuffer =
        params.providerId === "MANUAL_UPLOAD"
          ? params.input.fileBuffer ?? Buffer.from("workbook")
          : Buffer.from("finale-workbook");
      const originalFileName =
        params.providerId === "MANUAL_UPLOAD"
          ? params.input.fileName ?? "reference-workbook.xlsx"
          : params.input.exportName ?? "default-oasis-30-days.xlsx";
      await writeFile(params.batch.sourceWorkbook.storedPath, fileBuffer);
      return {
        providerId: params.providerId,
        originalFileName,
        storedPath: params.batch.sourceWorkbook.storedPath,
        acquiredAt: new Date().toISOString(),
        acquisitionReference: null,
        notes: [],
        acquisitionMetadata: {
          providerId: params.providerId,
          acquisitionReference: null,
          metadataPath: null,
          selectedAgencyName: params.providerId === "FINALE" ? "Default Subsidiary" : null,
          selectedAgencyUrl: null,
          dashboardUrl: null,
          notes: [],
        },
        verification: {
          usable: true,
          verifiedAt: "2026-04-14T00:00:00.000Z",
          fileSizeBytes: fileBuffer.byteLength,
          fileExtension: ".xlsx",
          sheetNames: ["Uploaded Workbook"],
          detectedSourceTypes: [params.providerId === "FINALE" ? "trackingReport" : "manual_upload"],
          warningCount: 0,
        },
      };
    },
  } as unknown as WorkbookAcquisitionService;

  return {
    repository,
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

  it("returns a refresh cycle snapshot even before workbook parsing has produced queue artifacts", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const batch = await fixture.service.createBatchUpload({
        fileName: "reference-workbook.xlsx",
        fileBuffer: Buffer.from("workbook"),
        billingPeriod: "2026-04",
      });

      const snapshot = await fixture.service.getAgencyDashboardSnapshot("default");

      assert.equal(snapshot.refreshCycle?.batchId, batch.id);
      assert.equal(snapshot.refreshCycle?.workbookSource.originalFileName, "reference-workbook.xlsx");
      assert.equal(snapshot.refreshCycle?.queueSummary.total, 0);
      assert.equal(snapshot.refreshCycle?.status, "pending");
      assert.equal(snapshot.refreshCycle?.workbookSource.verification?.usable, true);
      assert.equal(snapshot.refreshCycle?.workbookSource.verification?.fileExtension, ".xlsx");
      assert.equal(snapshot.refreshCycle?.workbookSource.acquisition.providerId, "MANUAL_UPLOAD");
    } finally {
      fixture.cleanup();
    }
  });

  it("triggers a manual agency refresh with an agency-scoped workbook filename", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const batch = await fixture.service.triggerAgencyRefresh("default");

      assert.equal(batch.subsidiary.id, "default");
      assert.equal(batch.sourceWorkbook.acquisitionProvider, "FINALE");
      assert.equal(batch.sourceWorkbook.originalFileName, "default-oasis-30-days.xlsx");
      assert.equal(batch.sourceWorkbook.storedPath.includes("default-oasis-30-days.xlsx"), true);
    } finally {
      fixture.cleanup();
    }
  });

  it("uses the batch id for agency patient drill-down links", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const batch = await fixture.service.createBatchUpload({
        fileName: "reference-workbook.xlsx",
        fileBuffer: Buffer.from("workbook"),
        billingPeriod: "2026-04",
      });

      const queueArtifact: PatientQueueArtifact = {
        generatedAt: "2026-04-15T06:00:00.000Z",
        agencyId: "default",
        batchId: batch.id,
        reviewWindowId: "default-2026-04-15",
        summary: {
          total: 1,
          eligible: 1,
          skippedNonAdmit: 0,
          skippedPending: 0,
          excludedOther: 0,
        },
        entries: [
          {
            id: "default-2026-04-15:patient-1",
            agencyId: "default",
            batchId: batch.id,
            workItemId: "patient-1",
            patientName: "Test Patient",
            reviewWindowId: "default-2026-04-15",
            workflowTypes: ["SOC"],
            status: "eligible",
            eligibility: {
              eligible: true,
              reason: null,
              rationale: "Eligible for autonomous QA evaluation.",
              matchedSignals: [],
            },
            episodeDate: "2026-04-15",
            socDate: null,
            billingPeriod: "2026-04",
            sourceSheets: ["OASIS Tracking Report"],
            sourceRowNumbers: [2],
            notes: [],
            createdAt: "2026-04-15T06:00:00.000Z",
          },
        ],
      };

      await writeFile(
        path.join(batch.storage.outputRoot, "patient-queue.json"),
        JSON.stringify(queueArtifact, null, 2),
      );

      batch.patientRuns = [
        {
          runId: `${batch.id}-patient-1`,
          subsidiaryId: "default",
          workItemId: "patient-1",
          patientName: "Test Patient",
          processingStatus: "COMPLETE",
          executionStep: "COMPLETE",
          progressPercent: 100,
          startedAt: "2026-04-15T06:00:00.000Z",
          completedAt: "2026-04-15T06:05:00.000Z",
          lastUpdatedAt: "2026-04-15T06:05:00.000Z",
          matchResult: {
            status: "EXACT",
            searchQuery: "Test Patient",
            portalPatientId: null,
            portalDisplayName: "Test Patient",
            candidateNames: ["Test Patient"],
            note: null,
          },
          qaOutcome: "READY_FOR_BILLING_PREP",
          oasisQaSummary: {
            overallStatus: "READY_FOR_BILLING",
            urgency: "ON_TRACK",
            daysInPeriod: 30,
            daysLeft: 10,
            sections: [],
            blockers: [],
          },
          artifactCount: 0,
          hasFindings: false,
          bundleAvailable: false,
          logPath: null,
          logAvailable: false,
          retryEligible: false,
          errorSummary: null,
          resultBundlePath: path.join(batch.storage.patientResultsDirectory, "patient-1.json"),
          evidenceDirectory: path.join(batch.storage.evidenceDirectory, "patient-1"),
          tracePath: null,
          screenshotPaths: [],
          downloadPaths: [],
          workflowRuns: [],
          lastAttemptAt: "2026-04-15T06:05:00.000Z",
          attemptCount: 1,
        },
      ];

      await fixture.repository.saveBatch(batch);

      const snapshot = await fixture.service.getAgencyDashboardSnapshot("default");

      assert.equal(snapshot.patientRecords.length, 1);
      assert.equal(snapshot.patientRecords[0]?.runId, batch.id);
      assert.equal(snapshot.patientRecords[0]?.patientId, "patient-1");
    } finally {
      fixture.cleanup();
    }
  });
});
