import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import type { WorkbookAcquisitionService } from "../acquisition/workbookAcquisitionService";
import type {
  BatchManifest,
  PatientDashboardState,
  PatientEpisodeWorkItem,
  PatientQueueArtifact,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import { FilesystemScheduledRunRepository } from "../repositories/filesystemScheduledRunRepository";
import { FilesystemSubsidiaryRepository } from "../repositories/filesystemSubsidiaryRepository";
import { BatchControlPlaneService } from "../services/batchControlPlaneService";
import { PatientMemoryService } from "../services/patientMemoryService";
import { PortalCredentialProvider } from "../services/portalCredentialProvider";
import { SubsidiaryConfigService } from "../services/subsidiaryConfigService";
import type { BatchRecord } from "../types/batchControlPlane";
import type { PatientPortalStatusSnapshot } from "@medical-ai-qa/finale-workbook-intake";

function createServiceFixture(input: {
  acquisitionService?: WorkbookAcquisitionService;
  serviceOptions?: ConstructorParameters<typeof BatchControlPlaneService>[6];
} = {}) {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), "medical-ai-qa-api-"));
  const repository = new FilesystemBatchRepository(storageRoot);
  const scheduledRunRepository = new FilesystemScheduledRunRepository(storageRoot);
  const patientMemoryService = new PatientMemoryService(storageRoot);
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

  const acquisitionService = input.acquisitionService ?? {
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
    patientMemoryService,
    service: new BatchControlPlaneService(
      repository,
      scheduledRunRepository,
      patientMemoryService,
      acquisitionService,
      subsidiaryConfigService,
      logger,
      input.serviceOptions,
    ),
    scheduledRunRepository,
    cleanup: () => rmSync(storageRoot, { recursive: true, force: true }),
  };
}

async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}

function createPortalStatusWorkItem(id = "patient-portal-status-1"): PatientEpisodeWorkItem {
  return {
    id,
    subsidiaryId: "default",
    patientIdentity: {
      displayName: "Portal Status Patient",
      normalizedName: "PORTAL STATUS PATIENT",
      medicareNumber: null,
    },
    episodeContext: {
      episodeDate: "2026-04-15",
      socDate: "2026-04-01",
      episodePeriod: "2026-04",
      billingPeriod: "2026-04",
      payer: null,
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    timingMetadata: {
      trackingDays: 30,
      daysInPeriod: 30,
      daysLeft: 10,
      daysLeftBeforeOasisDueDate: 7,
      rawTrackingValues: ["30"],
      rawDaysInPeriodValues: ["30"],
      rawDaysLeftValues: ["10"],
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
  };
}

async function createPortalStatusBatch(
  fixture: ReturnType<typeof createServiceFixture>,
  input: {
    patientRunStatus: BatchRecord["patientRuns"][number]["processingStatus"];
  },
): Promise<{ batch: BatchRecord; workItem: PatientEpisodeWorkItem; patientArtifactsDirectory: string }> {
  const batchId = `batch-portal-status-${input.patientRunStatus.toLowerCase()}`;
  const storage = fixture.repository.createBatchPaths(batchId, "reference-workbook.xlsx");
  const manifestPath = path.join(storage.outputRoot, "batch-manifest.json");
  const workItemsPath = path.join(storage.outputRoot, "work-items.json");
  const parserExceptionsPath = path.join(storage.outputRoot, "parser-exceptions.json");
  const workItem = createPortalStatusWorkItem();
  const manifest: BatchManifest = {
    batchId,
    subsidiaryId: "default",
    createdAt: "2026-04-15T06:00:00.000Z",
    status: "RUNNING",
    workbookPath: storage.sourceWorkbookPath,
    outputDirectory: storage.outputRoot,
    billingPeriod: "2026-04",
    totalWorkItems: 1,
    parserExceptionCount: 0,
    automationEligibleWorkItemIds: [workItem.id],
    blockedWorkItemIds: [],
  };

  await mkdir(path.dirname(storage.sourceWorkbookPath), { recursive: true });
  await mkdir(storage.outputRoot, { recursive: true });
  await writeFile(storage.sourceWorkbookPath, "workbook");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(workItemsPath, JSON.stringify([workItem], null, 2));
  await writeFile(parserExceptionsPath, JSON.stringify([], null, 2));

  const batch: BatchRecord = {
    id: batchId,
    subsidiary: {
      id: "default",
      slug: "default",
      name: "Default Subsidiary",
    },
    createdAt: "2026-04-15T06:00:00.000Z",
    updatedAt: "2026-04-15T06:05:00.000Z",
    runMode: "read_only",
    billingPeriod: "2026-04",
    status: "RUNNING",
    schedule: {
      scheduledRunId: null,
      active: true,
      rerunEnabled: true,
      intervalHours: 24,
      timezone: "Asia/Manila",
      localTimes: ["20:30"],
      lastRunAt: null,
      nextScheduledRunAt: null,
    },
    sourceWorkbook: {
      subsidiaryId: "default",
      acquisitionProvider: "MANUAL_UPLOAD",
      acquisitionStatus: "ACQUIRED",
      acquisitionReference: null,
      acquisitionNotes: [],
      acquisitionMetadata: null,
      originalFileName: "reference-workbook.xlsx",
      storedPath: storage.sourceWorkbookPath,
      uploadedAt: "2026-04-15T06:00:00.000Z",
      verification: null,
    },
    storage: {
      batchRoot: storage.batchRoot,
      outputRoot: storage.outputRoot,
      manifestPath,
      workItemsPath,
      parserExceptionsPath,
      batchSummaryPath: null,
      patientResultsDirectory: storage.patientResultsDirectory,
      evidenceDirectory: storage.evidenceDirectory,
    },
    parse: {
      requestedAt: "2026-04-15T06:00:00.000Z",
      completedAt: "2026-04-15T06:05:00.000Z",
      workItemCount: 1,
      eligibleWorkItemCount: 1,
      parserExceptionCount: 0,
      sourceDetections: [],
      sheetSummaries: [],
      lastError: null,
    },
    run: {
      requestedAt: "2026-04-15T06:06:00.000Z",
      completedAt: null,
      patientRunCount: 1,
      lastError: null,
    },
    patientRuns: [{
      runId: `${batchId}-${workItem.id}`,
      subsidiaryId: "default",
      workItemId: workItem.id,
      patientName: workItem.patientIdentity.displayName,
      processingStatus: input.patientRunStatus,
      executionStep: "TEST_ACTIVE_STEP",
      progressPercent: 50,
      startedAt: "2026-04-15T06:06:00.000Z",
      completedAt: null,
      lastUpdatedAt: "2026-04-15T06:07:00.000Z",
      matchResult: {
        status: "EXACT",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: "portal-patient-1",
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [],
        note: null,
      },
      qaOutcome: "INCOMPLETE",
      oasisQaSummary: {
        overallStatus: "IN_PROGRESS",
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
      resultBundlePath: path.join(storage.patientResultsDirectory, `${workItem.id}.json`),
      evidenceDirectory: path.join(storage.evidenceDirectory, workItem.id),
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
      workflowRuns: [],
      lastAttemptAt: null,
      attemptCount: 1,
    }],
  };

  await fixture.repository.saveBatch(batch);
  return {
    batch,
    workItem,
    patientArtifactsDirectory: path.join(storage.outputRoot, "patients", workItem.id),
  };
}

describe("BatchControlPlaneService scheduler metadata", () => {
  it("marks patient portal status preflight pending when the same patient has active chart work", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const { batch, workItem, patientArtifactsDirectory } = await createPortalStatusBatch(fixture, {
        patientRunStatus: "RUNNING_QA",
      });

      const snapshot = await fixture.service.ensurePatientPortalStatusSnapshot(batch.id, workItem.id);

      assert.equal(snapshot.status, "pending_due_to_active_patient_run");
      assert.equal(snapshot.activePatientRunStatus, "RUNNING_QA");
      assert.equal(snapshot.patientId, workItem.id);
      const persisted = JSON.parse(
        await readFile(path.join(patientArtifactsDirectory, "patient-portal-status-snapshot.json"), "utf8"),
      ) as PatientPortalStatusSnapshot;
      assert.equal(persisted.status, "pending_due_to_active_patient_run");
    } finally {
      fixture.cleanup();
    }
  });

  it("reuses an existing patient portal status snapshot while same-patient chart work is active", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      const { batch, workItem, patientArtifactsDirectory } = await createPortalStatusBatch(fixture, {
        patientRunStatus: "COLLECTING_EVIDENCE",
      });
      await mkdir(patientArtifactsDirectory, { recursive: true });
      const existingSnapshot: PatientPortalStatusSnapshot = {
        schemaVersion: "patient-portal-status-snapshot.v1",
        batchId: batch.id,
        patientId: workItem.id,
        patientName: workItem.patientIdentity.displayName,
        status: "fresh",
        capturedAt: "2026-04-15T06:01:00.000Z",
        generatedAt: "2026-04-15T06:01:00.000Z",
        staleAfter: "2999-01-01T00:00:00.000Z",
        matchResult: batch.patientRuns[0].matchResult,
        chartUrl: "https://app.finalehealth.com/client/demo",
        dashboardUrl: "https://app.finalehealth.com/provider/demo/dashboard",
        portalAdmissionStatus: "Active",
        oasisAssessments: [{
          id: "soc-04012026-oasis",
          assessmentType: "SOC",
          title: "OASIS SOC",
          date: "04/01/2026",
          detectedStatuses: ["VALIDATED"],
          primaryStatus: "VALIDATED",
          decision: "PROCESS",
          processingEligible: true,
        }],
        currentOasisAssessmentId: "soc-04012026-oasis",
        referralFileArea: {
          available: true,
          labels: ["File Uploads"],
        },
        documentTableSignals: ["SOC:04/01/2026:VALIDATED:OASIS SOC"],
        activePatientRunStatus: null,
        error: null,
      };
      await writeFile(
        path.join(patientArtifactsDirectory, "patient-portal-status-snapshot.json"),
        JSON.stringify(existingSnapshot, null, 2),
      );

      const snapshot = await fixture.service.ensurePatientPortalStatusSnapshot(batch.id, workItem.id, {
        forceRefresh: true,
      });

      assert.equal(snapshot.status, "fresh");
      assert.equal(snapshot.currentOasisAssessmentId, "soc-04012026-oasis");
      assert.equal(snapshot.activePatientRunStatus, null);
    } finally {
      fixture.cleanup();
    }
  });

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
      assert.equal(batch.storage.batchRoot.includes(path.join("batches", "default", batch.id)), true);
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

  it("starts a manual agency refresh without waiting for workbook acquisition", async () => {
    let acquisitionStarted: (() => void) | null = null;
    let rejectAcquisition!: (error: Error) => void;
    const acquisitionStartedPromise = new Promise<void>((resolve) => {
      acquisitionStarted = resolve;
    });
    const acquisitionGate = new Promise<never>((_resolve, reject) => {
      rejectAcquisition = reject;
    });
    const acquisitionService = {
      async acquireWorkbook() {
        acquisitionStarted?.();
        return acquisitionGate;
      },
    } as unknown as WorkbookAcquisitionService;
    const fixture = createServiceFixture({
      acquisitionService,
      serviceOptions: { autonomousMode: "manual_only" },
    });

    try {
      await fixture.service.initialize();
      const batch = await fixture.service.startAgencyRefresh("default");

      assert.equal(batch.status, "RUNNING");
      assert.equal(batch.sourceWorkbook.acquisitionStatus, "PENDING");
      assert.ok(batch.run.requestedAt);
      await acquisitionStartedPromise;
      await assert.rejects(
        () => fixture.service.startAgencyRefresh("default"),
        /already running/,
      );

      rejectAcquisition(new Error("planned acquisition failure"));
      await waitForCondition(async () => {
        const reloaded = await fixture.repository.getBatch(batch.id);
        return reloaded?.status === "FAILED" &&
          reloaded.sourceWorkbook.acquisitionStatus === "FAILED" &&
          reloaded.run.lastError === "planned acquisition failure";
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("removes superseded same-agency batches after a fresh agency refresh starts", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();
      await fixture.service.createBatchUpload({
        fileName: "older.xlsx",
        fileBuffer: Buffer.from("older"),
        billingPeriod: "2026-04",
      });

      const staleBatchIds = (await fixture.repository.listBatches())
        .filter((batch) => batch.subsidiary.id === "default")
        .map((batch) => batch.id);

      const refreshedBatch = await fixture.service.triggerAgencyRefresh("default");
      const remainingBatchIds = (await fixture.repository.listBatches())
        .filter((batch) => batch.subsidiary.id === "default")
        .map((batch) => batch.id);

      assert.deepEqual(remainingBatchIds, [refreshedBatch.id]);
      assert.equal(
        refreshedBatch.storage.batchRoot.includes(path.join("batches", "default", refreshedBatch.id)),
        true,
      );

      for (const staleBatchId of staleBatchIds) {
        assert.equal(await fixture.repository.getBatch(staleBatchId), null);
      }
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

      await mkdir(batch.storage.outputRoot, { recursive: true });
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

      const status = await fixture.service.updateAgencyDashboardReviewerStatus({
        agencyId: "default",
        workItemId: "patient-1",
        status: "yellow",
        updatedBy: "QA Reviewer",
      });
      const updatedSnapshot = await fixture.service.getAgencyDashboardSnapshot("default");

      assert.equal(status.status, "yellow");
      assert.equal(updatedSnapshot.patientRecords[0]?.reviewerStatus, "yellow");
      assert.equal(updatedSnapshot.patientRecords[0]?.reviewerStatusUpdatedBy, "QA Reviewer");
    } finally {
      fixture.cleanup();
    }
  });

  it("projects portal status-only exclusions into agency dashboard queue entries and summary", async () => {
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
            id: "default-2026-04-15:patient-pending",
            agencyId: "default",
            batchId: batch.id,
            workItemId: "patient-pending",
            patientName: "Pending Patient",
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

      await mkdir(batch.storage.outputRoot, { recursive: true });
      await writeFile(
        path.join(batch.storage.outputRoot, "patient-queue.json"),
        JSON.stringify(queueArtifact, null, 2),
      );

      batch.patientRuns = [
        {
          runId: `${batch.id}-patient-pending`,
          subsidiaryId: "default",
          workItemId: "patient-pending",
          patientName: "Pending Patient",
          processingStatus: "BLOCKED",
          executionStep: "PATIENT_STATUS_EXCLUDED",
          progressPercent: 100,
          startedAt: "2026-04-15T06:00:00.000Z",
          completedAt: "2026-04-15T06:01:00.000Z",
          lastUpdatedAt: "2026-04-15T06:01:00.000Z",
          matchResult: {
            status: "EXACT",
            searchQuery: "Pending Patient",
            portalPatientId: "PT-PENDING",
            portalDisplayName: "Pending Patient - Pending",
            candidateNames: ["Pending Patient"],
            note: "Portal patient status 'Pending' excludes this patient from clinical processing.",
          },
          qaOutcome: "MISSING_DOCUMENTS",
          oasisQaSummary: {
            overallStatus: "BLOCKED",
            urgency: "ON_TRACK",
            daysInPeriod: 30,
            daysLeft: 10,
            sections: [],
            blockers: ["Pending workbook status"],
          },
          artifactCount: 0,
          hasFindings: false,
          bundleAvailable: false,
          logPath: null,
          logAvailable: false,
          retryEligible: false,
          errorSummary: "Portal patient status 'Pending' excludes this patient from clinical processing.",
          resultBundlePath: path.join(batch.storage.patientResultsDirectory, "patient-pending.json"),
          evidenceDirectory: path.join(batch.storage.evidenceDirectory, "patient-pending"),
          tracePath: null,
          screenshotPaths: [],
          downloadPaths: [],
          workflowRuns: [],
          lastAttemptAt: "2026-04-15T06:01:00.000Z",
          attemptCount: 1,
        },
      ];

      await fixture.repository.saveBatch(batch);

      const snapshot = await fixture.service.getAgencyDashboardSnapshot("default");

      assert.equal(snapshot.queueEntries[0]?.status, "skipped_pending");
      assert.equal(snapshot.queueEntries[0]?.eligibility.eligible, false);
      assert.equal(snapshot.queueEntries[0]?.eligibility.reason, "pending");
      assert.equal(snapshot.refreshCycle?.queueSummary.total, 1);
      assert.equal(snapshot.refreshCycle?.queueSummary.eligible, 0);
      assert.equal(snapshot.refreshCycle?.queueSummary.skippedPending, 1);
      assert.equal(snapshot.patientRecords[0]?.queueEntry.status, "skipped_pending");
      assert.equal(snapshot.patientRecords[0]?.pipelineStage, "pending");
      assert.equal(snapshot.patientRecords[0]?.oasisStage, "pending_patient");
    } finally {
      fixture.cleanup();
    }
  });

  it("marks stale reviewer status as needs review when a newer cycle has discrepancies", async () => {
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

      const patientArtifactsDirectory = path.join(batch.storage.outputRoot, "patients", "patient-1");
      await mkdir(patientArtifactsDirectory, { recursive: true });
      await writeFile(
        path.join(batch.storage.outputRoot, "patient-queue.json"),
        JSON.stringify(queueArtifact, null, 2),
      );
      await writeFile(
        path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"),
        JSON.stringify({ recommendedDecision: "review_required" }, null, 2),
      );
      await writeFile(
        path.join(batch.storage.outputRoot, "dashboard-reviewer-statuses.json"),
        JSON.stringify(
          {
            schemaVersion: "dashboard-reviewer-statuses.v1",
            generatedAt: "2026-04-15T06:04:00.000Z",
            agencyId: "default",
            batchId: batch.id,
            statuses: {
              "patient-1": {
                workItemId: "patient-1",
                status: "green",
                updatedAt: "2026-04-15T06:04:00.000Z",
                updatedBy: "QA Reviewer",
              },
            },
          },
          null,
          2,
        ),
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

      const staleSnapshot = await fixture.service.getAgencyDashboardSnapshot("default");
      assert.equal(staleSnapshot.patientRecords[0]?.reviewerStatus, "red");
      assert.equal(staleSnapshot.patientRecords[0]?.reviewerStatusUpdatedBy, "System");

      await fixture.service.updateAgencyDashboardReviewerStatus({
        agencyId: "default",
        workItemId: "patient-1",
        status: "green",
        updatedBy: "QA Reviewer",
      });

      const reviewedSnapshot = await fixture.service.getAgencyDashboardSnapshot("default");
      assert.equal(reviewedSnapshot.patientRecords[0]?.reviewerStatus, "green");
      assert.equal(reviewedSnapshot.patientRecords[0]?.reviewerStatusUpdatedBy, "QA Reviewer");
    } finally {
      fixture.cleanup();
    }
  });

  it("prefers patient-dashboard-state.json when assembling known patient artifacts", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();

      const batchId = "batch-dashboard-state";
      const storage = fixture.repository.createBatchPaths(batchId, "reference-workbook.xlsx");
      const workItemsPath = path.join(storage.outputRoot, "work-items.json");
      const patientArtifactsDirectory = path.join(storage.outputRoot, "patients", "patient-1");
      const dashboardStatePath = path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
      const workItem: PatientEpisodeWorkItem = {
        id: "patient-1",
        subsidiaryId: "default",
        patientIdentity: {
          displayName: "Test Patient",
          normalizedName: "TEST PATIENT",
          medicareNumber: null,
        },
        episodeContext: {
          episodeDate: "2026-04-15",
          socDate: "2026-04-01",
          episodePeriod: "2026-04",
          billingPeriod: "2026-04",
          payer: null,
          assignedStaff: null,
          clinician: null,
          qaSpecialist: null,
          rfa: null,
        },
        workflowTypes: ["SOC"],
        sourceSheets: ["OASIS Tracking Report"],
        timingMetadata: {
          trackingDays: 30,
          daysInPeriod: 30,
          daysLeft: 10,
          daysLeftBeforeOasisDueDate: 7,
          rawTrackingValues: ["30"],
          rawDaysInPeriodValues: ["30"],
          rawDaysLeftValues: ["10"],
        },
        codingReviewStatus: "NOT_STARTED",
        oasisQaStatus: "NOT_STARTED",
        pocQaStatus: "NOT_STARTED",
        visitNotesQaStatus: "NOT_STARTED",
        billingPrepStatus: "NOT_STARTED",
        sourceRemarks: [],
        sourceRowReferences: [
          {
            workflowTypes: ["SOC"],
            sourceSheet: "OASIS Tracking Report",
            sourceRowNumber: 2,
          },
        ],
        sourceValues: [],
        importWarnings: [],
      };

      const dashboardState: PatientDashboardState = {
        schemaVersion: 1,
        generatedAt: "2026-04-15T06:05:00.000Z",
        batchId,
        patientId: "patient-1",
        runId: `${batchId}-patient-1`,
        subsidiaryId: "default",
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
          portalPatientId: "PT-1",
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
        resultBundlePath: path.join(storage.patientResultsDirectory, "patient-1.json"),
        logPath: null,
        errorSummary: null,
        workItem,
        workflowRuns: [],
        artifactPaths: {
          codingInput: path.join(patientArtifactsDirectory, "coding-input.json"),
          documentText: path.join(patientArtifactsDirectory, "document-text.json"),
          qaPrefetch: path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
          patientQaReference: path.join(patientArtifactsDirectory, "referral-document-processing", "patient-qa-reference.json"),
          qaDocumentSummary: path.join(patientArtifactsDirectory, "referral-document-processing", "qa-document-summary.json"),
          fieldMapSnapshot: path.join(patientArtifactsDirectory, "referral-document-processing", "field-map-snapshot.json"),
          printedNoteChartValues: path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
          printedNoteReview: path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
        },
        artifactContents: {
          codingInput: {
            primaryDiagnosis: {
              code: "J18.9",
              description: "Pneumonia",
            },
          },
          documentText: {
            documents: ["referral text"],
          },
          qaPrefetch: {
            status: "COMPLETED",
          },
          patientQaReference: {
            chartSnapshot: {
              primaryDiagnosis: "J18.9",
            },
          },
          qaDocumentSummary: {
            discrepancyCount: 1,
          },
          fieldMapSnapshot: {
            fields: ["primaryDiagnosis"],
          },
          printedNoteChartValues: {
            currentChartValues: {
              primaryDiagnosis: "J18.9",
            },
          },
          printedNoteReview: {
            reviewSource: "printed_note_ocr",
          },
        },
      };

      const batch = {
        id: batchId,
        subsidiary: {
          id: "default",
          slug: "default",
          name: "Default Subsidiary",
        },
        createdAt: "2026-04-15T06:00:00.000Z",
        updatedAt: "2026-04-15T06:05:00.000Z",
        runMode: "read_only" as const,
        billingPeriod: "2026-04",
        status: "COMPLETED" as const,
        schedule: {
          scheduledRunId: null,
          active: true,
          rerunEnabled: true,
          intervalHours: 24,
          timezone: "Asia/Manila",
          localTimes: ["20:30"],
          lastRunAt: null,
          nextScheduledRunAt: null,
        },
        sourceWorkbook: {
          subsidiaryId: "default",
          acquisitionProvider: "MANUAL_UPLOAD" as const,
          acquisitionStatus: "ACQUIRED" as const,
          acquisitionReference: null,
          acquisitionNotes: [],
          acquisitionMetadata: null,
          originalFileName: "reference-workbook.xlsx",
          storedPath: storage.sourceWorkbookPath,
          uploadedAt: "2026-04-15T06:00:00.000Z",
          verification: null,
        },
        storage: {
          batchRoot: storage.batchRoot,
          outputRoot: storage.outputRoot,
          manifestPath: null,
          workItemsPath,
          parserExceptionsPath: null,
          batchSummaryPath: null,
          patientResultsDirectory: storage.patientResultsDirectory,
          evidenceDirectory: storage.evidenceDirectory,
        },
        parse: {
          requestedAt: null,
          completedAt: null,
          workItemCount: 1,
          eligibleWorkItemCount: 1,
          parserExceptionCount: 0,
          sourceDetections: [],
          sheetSummaries: [],
          lastError: null,
        },
        run: {
          requestedAt: null,
          completedAt: null,
          patientRunCount: 1,
          lastError: null,
        },
        patientRuns: [
          {
            runId: `${batchId}-patient-1`,
            subsidiaryId: "default",
            workItemId: "patient-1",
            patientName: "Test Patient",
            processingStatus: "COMPLETE" as const,
            executionStep: "COMPLETE",
            progressPercent: 100,
            startedAt: "2026-04-15T06:00:00.000Z",
            completedAt: "2026-04-15T06:05:00.000Z",
            lastUpdatedAt: "2026-04-15T06:05:00.000Z",
            matchResult: dashboardState.matchResult,
            qaOutcome: "READY_FOR_BILLING_PREP" as const,
            oasisQaSummary: dashboardState.oasisQaSummary,
            artifactCount: 0,
            hasFindings: false,
            bundleAvailable: false,
            logPath: null,
            logAvailable: false,
            retryEligible: false,
            errorSummary: null,
            resultBundlePath: dashboardState.resultBundlePath!,
            evidenceDirectory: path.join(storage.evidenceDirectory, "patient-1"),
            tracePath: null,
            screenshotPaths: [],
            downloadPaths: [],
            workflowRuns: [],
            lastAttemptAt: "2026-04-15T06:05:00.000Z",
            attemptCount: 1,
          },
        ],
      };

      await mkdir(patientArtifactsDirectory, { recursive: true });
      await writeFile(workItemsPath, JSON.stringify([workItem], null, 2));
      await writeFile(dashboardStatePath, JSON.stringify(dashboardState, null, 2));
      await fixture.repository.saveBatch(batch);

      const knownArtifacts = await fixture.service.getKnownPatientArtifacts(batchId, "patient-1");

      assert.ok(knownArtifacts);
      assert.equal(knownArtifacts.workItem?.id, "patient-1");
      assert.deepEqual(knownArtifacts.artifactContents.codingInput, dashboardState.artifactContents.codingInput);
      assert.deepEqual(knownArtifacts.artifactContents.patientQaReference, dashboardState.artifactContents.patientQaReference);
      assert.equal(knownArtifacts.artifactPaths.codingInput, dashboardState.artifactPaths.codingInput);
      assert.equal(knownArtifacts.artifactContents.printedNoteReview, null);
      assert.equal(knownArtifacts.artifactPaths.printedNoteReview, dashboardState.artifactPaths.printedNoteReview);

      const memoryBatchId = "batch-memory-fallback";
      const memoryStorage = fixture.repository.createBatchPaths(memoryBatchId, "reference-workbook.xlsx");
      const memoryWorkItemsPath = path.join(memoryStorage.outputRoot, "work-items.json");
      const memorySourceDirectory = path.join(storage.outputRoot, "memory-source", "patient-1");
      const memoryDashboardState: PatientDashboardState = {
        ...dashboardState,
        batchId: "prior-batch",
        runId: "prior-batch-patient-1",
        artifactContents: {
          ...dashboardState.artifactContents,
          codingInput: {
            primaryDiagnosis: {
              code: "M62.81",
              description: "Muscle weakness",
            },
          },
        },
      };
      const memoryResolution = await fixture.patientMemoryService.resolvePatientMemory({
        agencySlug: "default",
        workItem,
        matchResult: dashboardState.matchResult,
      });
      await mkdir(memorySourceDirectory, { recursive: true });
      await writeFile(
        path.join(memorySourceDirectory, "patient-dashboard-state.json"),
        JSON.stringify(memoryDashboardState, null, 2),
      );
      await fixture.patientMemoryService.promoteCurrentArtifacts({
        agencySlug: "default",
        patientMemoryId: memoryResolution.patientMemoryId,
        sourcePatientArtifactsDirectory: memorySourceDirectory,
        workItem,
        matchResult: dashboardState.matchResult,
        batchId: "prior-batch",
        runId: "prior-batch-patient-1",
        artifactRelativePaths: ["patient-dashboard-state.json"],
      });

      const memoryBackedBatch = {
        ...batch,
        id: memoryBatchId,
        storage: {
          ...batch.storage,
          batchRoot: memoryStorage.batchRoot,
          outputRoot: memoryStorage.outputRoot,
          workItemsPath: memoryWorkItemsPath,
          patientResultsDirectory: memoryStorage.patientResultsDirectory,
          evidenceDirectory: memoryStorage.evidenceDirectory,
        },
        patientRuns: [
          {
            ...batch.patientRuns[0]!,
            runId: `${memoryBatchId}-patient-1`,
            resultBundlePath: path.join(memoryStorage.patientResultsDirectory, "patient-1.json"),
            evidenceDirectory: path.join(memoryStorage.evidenceDirectory, "patient-1"),
          },
        ],
      };
      await mkdir(memoryStorage.outputRoot, { recursive: true });
      await writeFile(memoryWorkItemsPath, JSON.stringify([workItem], null, 2));
      await fixture.repository.saveBatch(memoryBackedBatch);

      const memoryKnownArtifacts = await fixture.service.getKnownPatientArtifacts(memoryBatchId, "patient-1");

      assert.ok(memoryKnownArtifacts);
      assert.equal(
        memoryKnownArtifacts.artifactContents.codingInput &&
          (memoryKnownArtifacts.artifactContents.codingInput as { primaryDiagnosis?: { code?: string } })
            .primaryDiagnosis?.code,
        "M62.81",
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("loads work items once when assembling known artifacts for a batch", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();

      const batchId = "batch-known-artifacts-context";
      const storage = fixture.repository.createBatchPaths(batchId, "reference-workbook.xlsx");
      const workItemsPath = path.join(storage.outputRoot, "work-items.json");
      const now = "2026-04-15T06:05:00.000Z";
      const createWorkItem = (id: string, displayName: string): PatientEpisodeWorkItem => ({
        id,
        subsidiaryId: "default",
        patientIdentity: {
          displayName,
          normalizedName: displayName.toUpperCase(),
          medicareNumber: null,
        },
        episodeContext: {
          episodeDate: "2026-04-15",
          socDate: "2026-04-01",
          episodePeriod: "2026-04",
          billingPeriod: "2026-04",
          payer: null,
          assignedStaff: null,
          clinician: null,
          qaSpecialist: null,
          rfa: null,
        },
        workflowTypes: ["SOC"],
        sourceSheets: ["OASIS Tracking Report"],
        timingMetadata: {
          trackingDays: 30,
          daysInPeriod: 30,
          daysLeft: 10,
          daysLeftBeforeOasisDueDate: 7,
          rawTrackingValues: ["30"],
          rawDaysInPeriodValues: ["30"],
          rawDaysLeftValues: ["10"],
        },
        codingReviewStatus: "NOT_STARTED",
        oasisQaStatus: "NOT_STARTED",
        pocQaStatus: "NOT_STARTED",
        visitNotesQaStatus: "NOT_STARTED",
        billingPrepStatus: "NOT_STARTED",
        sourceRemarks: [],
        sourceRowReferences: [],
        sourceValues: [],
        importWarnings: [],
      });
      const workItems = [
        createWorkItem("patient-z", "Zulu Patient"),
        createWorkItem("patient-a", "Alpha Patient"),
      ];
      const createPatientRun = (workItem: PatientEpisodeWorkItem): BatchRecord["patientRuns"][number] => ({
        runId: `${batchId}-${workItem.id}`,
        subsidiaryId: "default",
        workItemId: workItem.id,
        patientName: workItem.patientIdentity.displayName,
        processingStatus: "COMPLETE",
        executionStep: "COMPLETE",
        progressPercent: 100,
        startedAt: now,
        completedAt: now,
        lastUpdatedAt: now,
        matchResult: {
          status: "EXACT",
          searchQuery: workItem.patientIdentity.displayName,
          portalPatientId: null,
          portalDisplayName: workItem.patientIdentity.displayName,
          candidateNames: [workItem.patientIdentity.displayName],
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
        resultBundlePath: path.join(storage.patientResultsDirectory, `${workItem.id}.json`),
        evidenceDirectory: path.join(storage.evidenceDirectory, workItem.id),
        tracePath: null,
        screenshotPaths: [],
        downloadPaths: [],
        workflowRuns: [],
        lastAttemptAt: now,
        attemptCount: 1,
      });
      const batch: BatchRecord = {
        id: batchId,
        subsidiary: {
          id: "default",
          slug: "default",
          name: "Default Subsidiary",
        },
        createdAt: now,
        updatedAt: now,
        runMode: "read_only",
        billingPeriod: "2026-04",
        status: "COMPLETED",
        schedule: {
          scheduledRunId: null,
          active: true,
          rerunEnabled: true,
          intervalHours: 24,
          timezone: "Asia/Manila",
          localTimes: ["20:30"],
          lastRunAt: null,
          nextScheduledRunAt: null,
        },
        sourceWorkbook: {
          subsidiaryId: "default",
          acquisitionProvider: "MANUAL_UPLOAD",
          acquisitionStatus: "ACQUIRED",
          acquisitionReference: null,
          acquisitionNotes: [],
          acquisitionMetadata: null,
          originalFileName: "reference-workbook.xlsx",
          storedPath: storage.sourceWorkbookPath,
          uploadedAt: now,
          verification: null,
        },
        storage: {
          batchRoot: storage.batchRoot,
          outputRoot: storage.outputRoot,
          manifestPath: null,
          workItemsPath,
          parserExceptionsPath: null,
          batchSummaryPath: null,
          patientResultsDirectory: storage.patientResultsDirectory,
          evidenceDirectory: storage.evidenceDirectory,
        },
        parse: {
          requestedAt: null,
          completedAt: null,
          workItemCount: workItems.length,
          eligibleWorkItemCount: workItems.length,
          parserExceptionCount: 0,
          sourceDetections: [],
          sheetSummaries: [],
          lastError: null,
        },
        run: {
          requestedAt: null,
          completedAt: null,
          patientRunCount: workItems.length,
          lastError: null,
        },
        patientRuns: workItems.map(createPatientRun),
      };
      let readWorkItemsCount = 0;
      const originalReadWorkItems = fixture.repository.readWorkItems.bind(fixture.repository);
      fixture.repository.readWorkItems = async (...args) => {
        readWorkItemsCount += 1;
        return originalReadWorkItems(...args);
      };

      await mkdir(storage.outputRoot, { recursive: true });
      await writeFile(workItemsPath, JSON.stringify(workItems, null, 2));
      await fixture.repository.saveBatch(batch);

      const knownArtifacts = await fixture.service.getKnownPatientArtifactsForBatch(batchId);

      assert.ok(knownArtifacts);
      assert.equal(readWorkItemsCount, 1);
      assert.deepEqual(
        knownArtifacts.patients.map((patient) => patient.workItem?.id),
        ["patient-a", "patient-z"],
      );
      assert.deepEqual(
        knownArtifacts.patients.map((patient) => patient.summary.patientName),
        ["Alpha Patient", "Zulu Patient"],
      );
      assert.equal(knownArtifacts.patients[0]?.artifactContents.codingInput, null);
      assert.equal(knownArtifacts.patients[0]?.artifactContents.patientQaReference, null);
    } finally {
      fixture.cleanup();
    }
  });

  it("prefers the newest verification rerun dashboard state for a patient", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();

      const batchId = "batch-dashboard-overlay";
      const storage = fixture.repository.createBatchPaths(batchId, "reference-workbook.xlsx");
      const workItemsPath = path.join(storage.outputRoot, "work-items.json");
      const patientQueuePath = path.join(storage.outputRoot, "patient-queue.json");
      const patientArtifactsDirectory = path.join(storage.outputRoot, "patients", "patient-1");
      const canonicalDashboardStatePath = path.join(
        patientArtifactsDirectory,
        "patient-dashboard-state.json",
      );
      const verificationRoot = path.join(
        storage.batchRoot,
        "verification-rerun-patient-1-2026-04-21T20-25-00Z",
      );
      const verificationArtifactsDirectory = path.join(
        verificationRoot,
        "patients",
        "patient-1",
      );
      const verificationDashboardStatePath = path.join(
        verificationArtifactsDirectory,
        "patient-dashboard-state.json",
      );
      const verificationBundlePath = path.join(
        verificationRoot,
        "patient-results",
        "patient-1.json",
      );
      const verificationLogPath = path.join(verificationRoot, "logs", "patient-1.json");
      const workItem: PatientEpisodeWorkItem = {
        id: "patient-1",
        subsidiaryId: "default",
        patientIdentity: {
          displayName: "Test Patient",
          normalizedName: "TEST PATIENT",
          medicareNumber: null,
        },
        episodeContext: {
          episodeDate: "2026-04-21",
          socDate: "2026-04-01",
          episodePeriod: "2026-04",
          billingPeriod: "2026-04",
          payer: null,
          assignedStaff: null,
          clinician: null,
          qaSpecialist: null,
          rfa: null,
        },
        workflowTypes: ["SOC"],
        sourceSheets: ["OASIS Tracking Report"],
        timingMetadata: {
          trackingDays: 30,
          daysInPeriod: 30,
          daysLeft: 10,
          daysLeftBeforeOasisDueDate: 7,
          rawTrackingValues: ["30"],
          rawDaysInPeriodValues: ["30"],
          rawDaysLeftValues: ["10"],
        },
        codingReviewStatus: "NOT_STARTED",
        oasisQaStatus: "NOT_STARTED",
        pocQaStatus: "NOT_STARTED",
        visitNotesQaStatus: "NOT_STARTED",
        billingPrepStatus: "NOT_STARTED",
        sourceRemarks: [],
        sourceRowReferences: [],
        sourceValues: [],
        importWarnings: [],
      };
      const patientQueue: PatientQueueArtifact = {
        generatedAt: "2026-04-21T16:21:00.000Z",
        agencyId: "default",
        batchId,
        reviewWindowId: "window-1",
        entries: [
          {
            id: "window-1:patient-1",
            agencyId: "default",
            batchId,
            reviewWindowId: "window-1",
            workItemId: "patient-1",
            patientName: "Test Patient",
            status: "eligible",
            eligibility: {
              eligible: true,
              reason: null,
              rationale: "Eligible for autonomous QA evaluation.",
              matchedSignals: [],
            },
            episodeDate: "2026-04-21",
            socDate: null,
            billingPeriod: "2026-04",
            workflowTypes: ["SOC"],
            sourceSheets: ["OASIS Tracking Report"],
            sourceRowNumbers: [2],
            notes: [],
            createdAt: "2026-04-21T16:21:00.000Z",
          },
        ],
        summary: {
          total: 1,
          eligible: 1,
          skippedNonAdmit: 0,
          skippedPending: 0,
          excludedOther: 0,
        },
      };
      const canonicalDashboardState: PatientDashboardState = {
        schemaVersion: 1,
        generatedAt: "2026-04-21T16:28:00.000Z",
        batchId,
        patientId: "patient-1",
        runId: `${batchId}-patient-1`,
        subsidiaryId: "default",
        patientName: "Test Patient",
        processingStatus: "BLOCKED",
        executionStep: "BLOCKED",
        progressPercent: 100,
        startedAt: "2026-04-21T16:21:00.000Z",
        completedAt: "2026-04-21T16:28:00.000Z",
        lastUpdatedAt: "2026-04-21T16:28:00.000Z",
        matchResult: {
          status: "EXACT",
          searchQuery: "Test Patient",
          portalPatientId: "PT-1",
          portalDisplayName: "Test Patient",
          candidateNames: ["Test Patient"],
          note: null,
        },
        qaOutcome: "MISSING_DOCUMENTS",
        oasisQaSummary: {
          overallStatus: "BLOCKED",
          urgency: "ON_TRACK",
          daysInPeriod: 30,
          daysLeft: 10,
          sections: [],
          blockers: [],
        },
        artifactCount: 1,
        hasFindings: true,
        bundleAvailable: false,
        resultBundlePath: path.join(storage.patientResultsDirectory, "patient-1.json"),
        logPath: null,
        errorSummary: "OASIS fallback text still attached.",
        workItem,
        workflowRuns: [],
        artifactPaths: {
          codingInput: path.join(patientArtifactsDirectory, "coding-input.json"),
          documentText: path.join(patientArtifactsDirectory, "document-text.json"),
          qaPrefetch: path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
          patientQaReference: path.join(
            patientArtifactsDirectory,
            "referral-document-processing",
            "patient-qa-reference.json",
          ),
          qaDocumentSummary: path.join(
            patientArtifactsDirectory,
            "referral-document-processing",
            "qa-document-summary.json",
          ),
          fieldMapSnapshot: path.join(
            patientArtifactsDirectory,
            "referral-document-processing",
            "field-map-snapshot.json",
          ),
          printedNoteChartValues: path.join(
            patientArtifactsDirectory,
            "printed-note-chart-values.json",
          ),
          printedNoteReview: path.join(
            patientArtifactsDirectory,
            "oasis-printed-note-review.json",
          ),
        },
        artifactContents: {
          codingInput: null,
          documentText: {
            documents: [
              {
                portalLabel: "OASIS documents page",
                source: "artifact_fallback",
              },
            ],
          },
          qaPrefetch: null,
          patientQaReference: null,
          qaDocumentSummary: null,
          fieldMapSnapshot: null,
          printedNoteChartValues: {
            currentChartValues: {
              therapy_need: "Stale chart snapshot value",
            },
          },
          printedNoteReview: {
            reviewSource: "printed_note_ocr",
          },
        },
      };
      const verificationDashboardState: PatientDashboardState = {
        ...canonicalDashboardState,
        generatedAt: "2026-04-21T20:32:44.000Z",
        batchId: `${batchId}-rerun`,
        runId: `${batchId}-rerun-patient-1`,
        processingStatus: "COMPLETE",
        executionStep: "COMPLETE",
        completedAt: "2026-04-21T20:32:44.000Z",
        lastUpdatedAt: "2026-04-21T20:32:44.000Z",
        qaOutcome: "READY_FOR_BILLING_PREP",
        hasFindings: false,
        resultBundlePath: verificationBundlePath,
        logPath: verificationLogPath,
        errorSummary: null,
        artifactPaths: {
          codingInput: path.join(verificationArtifactsDirectory, "coding-input.json"),
          documentText: path.join(verificationArtifactsDirectory, "document-text.json"),
          qaPrefetch: path.join(verificationArtifactsDirectory, "qa-prefetch-result.json"),
          patientQaReference: path.join(
            verificationArtifactsDirectory,
            "referral-document-processing",
            "patient-qa-reference.json",
          ),
          qaDocumentSummary: path.join(
            verificationArtifactsDirectory,
            "referral-document-processing",
            "qa-document-summary.json",
          ),
          fieldMapSnapshot: path.join(
            verificationArtifactsDirectory,
            "referral-document-processing",
            "field-map-snapshot.json",
          ),
          printedNoteChartValues: path.join(
            verificationArtifactsDirectory,
            "printed-note-chart-values.json",
          ),
          printedNoteReview: path.join(
            verificationArtifactsDirectory,
            "oasis-printed-note-review.json",
          ),
        },
        artifactContents: {
          codingInput: null,
          documentText: {
            documents: [
              {
                portalLabel: "OASIS-OASIS E1 - PT SOC",
                source: "download",
              },
            ],
          },
          qaPrefetch: {
            status: "COMPLETED",
          },
          patientQaReference: null,
          qaDocumentSummary: null,
          fieldMapSnapshot: null,
          printedNoteChartValues: {
            currentChartValues: {
              therapy_need: "Correct chart snapshot value",
            },
          },
          printedNoteReview: {
            reviewSource: "printed_note_ocr",
          },
        },
      };
      const batch = {
        id: batchId,
        subsidiary: {
          id: "default",
          slug: "default",
          name: "Default Subsidiary",
        },
        createdAt: "2026-04-21T16:21:00.000Z",
        updatedAt: "2026-04-21T16:28:00.000Z",
        runMode: "read_only" as const,
        billingPeriod: "2026-04",
        status: "COMPLETED" as const,
        schedule: {
          scheduledRunId: null,
          active: true,
          rerunEnabled: true,
          intervalHours: 24,
          timezone: "Asia/Manila",
          localTimes: ["20:30"],
          lastRunAt: null,
          nextScheduledRunAt: null,
        },
        sourceWorkbook: {
          subsidiaryId: "default",
          acquisitionProvider: "MANUAL_UPLOAD" as const,
          acquisitionStatus: "ACQUIRED" as const,
          acquisitionReference: null,
          acquisitionNotes: [],
          acquisitionMetadata: null,
          originalFileName: "reference-workbook.xlsx",
          storedPath: storage.sourceWorkbookPath,
          uploadedAt: "2026-04-21T16:21:00.000Z",
          verification: null,
        },
        storage: {
          batchRoot: storage.batchRoot,
          outputRoot: storage.outputRoot,
          manifestPath: null,
          workItemsPath,
          parserExceptionsPath: null,
          batchSummaryPath: null,
          patientResultsDirectory: storage.patientResultsDirectory,
          evidenceDirectory: storage.evidenceDirectory,
        },
        parse: {
          requestedAt: null,
          completedAt: null,
          workItemCount: 1,
          eligibleWorkItemCount: 1,
          parserExceptionCount: 0,
          sourceDetections: [],
          sheetSummaries: [],
          lastError: null,
        },
        run: {
          requestedAt: null,
          completedAt: null,
          patientRunCount: 1,
          lastError: null,
        },
        patientRuns: [
          {
            runId: canonicalDashboardState.runId,
            subsidiaryId: "default",
            workItemId: "patient-1",
            patientName: "Test Patient",
            processingStatus: "BLOCKED" as const,
            executionStep: "BLOCKED",
            progressPercent: 100,
            startedAt: canonicalDashboardState.startedAt,
            completedAt: canonicalDashboardState.completedAt,
            lastUpdatedAt: canonicalDashboardState.lastUpdatedAt,
            matchResult: canonicalDashboardState.matchResult,
            qaOutcome: canonicalDashboardState.qaOutcome,
            oasisQaSummary: canonicalDashboardState.oasisQaSummary,
            artifactCount: 1,
            hasFindings: true,
            bundleAvailable: false,
            logPath: null,
            logAvailable: false,
            retryEligible: false,
            errorSummary: canonicalDashboardState.errorSummary,
            resultBundlePath: canonicalDashboardState.resultBundlePath!,
            evidenceDirectory: path.join(storage.evidenceDirectory, "patient-1"),
            tracePath: null,
            screenshotPaths: [],
            downloadPaths: [],
            workflowRuns: [],
            lastAttemptAt: canonicalDashboardState.completedAt,
            attemptCount: 1,
          },
        ],
      };

      await mkdir(patientArtifactsDirectory, { recursive: true });
      await mkdir(path.dirname(verificationBundlePath), { recursive: true });
      await mkdir(path.dirname(verificationLogPath), { recursive: true });
      await mkdir(verificationArtifactsDirectory, { recursive: true });
      await writeFile(workItemsPath, JSON.stringify([workItem], null, 2));
      await writeFile(patientQueuePath, JSON.stringify(patientQueue, null, 2));
      await writeFile(
        canonicalDashboardStatePath,
        JSON.stringify(canonicalDashboardState, null, 2),
      );
      await writeFile(
        verificationDashboardStatePath,
        JSON.stringify(verificationDashboardState, null, 2),
      );
      await writeFile(
        verificationBundlePath,
        JSON.stringify(
          {
            runId: verificationDashboardState.runId,
            batchId: verificationDashboardState.batchId,
            subsidiaryId: "default",
            workItemId: "patient-1",
            patientName: "Test Patient",
            processingStatus: "COMPLETE",
            executionStep: "COMPLETE",
            progressPercent: 100,
            startedAt: verificationDashboardState.startedAt,
            completedAt: verificationDashboardState.completedAt,
            lastUpdatedAt: verificationDashboardState.lastUpdatedAt,
            matchResult: verificationDashboardState.matchResult,
            artifacts: [],
            artifactCount: 1,
            findings: [],
            hasFindings: false,
            qaOutcome: verificationDashboardState.qaOutcome,
            oasisQaSummary: verificationDashboardState.oasisQaSummary,
            bundleAvailable: true,
            resultBundlePath: verificationBundlePath,
            logPath: verificationLogPath,
            logAvailable: true,
            errorSummary: null,
            workflowRuns: [],
            auditArtifacts: {
              tracePath: null,
              screenshotPaths: [],
              downloadPaths: [],
            },
          },
          null,
          2,
        ),
      );
      await writeFile(verificationLogPath, JSON.stringify({ runId: verificationDashboardState.runId }, null, 2));
      const canonicalModifiedAt = new Date("2026-04-21T20:00:00.000Z");
      const verificationModifiedAt = new Date("2026-04-21T20:25:00.000Z");
      await utimes(canonicalDashboardStatePath, canonicalModifiedAt, canonicalModifiedAt);
      await utimes(verificationDashboardStatePath, verificationModifiedAt, verificationModifiedAt);
      await fixture.repository.saveBatch(batch);

      const knownArtifacts = await fixture.service.getKnownPatientArtifacts(batchId, "patient-1");
      const patientRuns = await fixture.service.getPatientRuns(batchId);

      assert.ok(knownArtifacts);
      assert.equal(knownArtifacts.patientArtifactsDirectory, verificationArtifactsDirectory);
      assert.equal(knownArtifacts.summary.runId, verificationDashboardState.runId);
      assert.equal(knownArtifacts.summary.logPath, verificationLogPath);
      assert.equal(
        knownArtifacts.artifactPaths.documentText,
        verificationDashboardState.artifactPaths.documentText,
      );
      assert.deepEqual(
        knownArtifacts.artifactContents.documentText,
        verificationDashboardState.artifactContents.documentText,
      );
      assert.equal(knownArtifacts.artifactContents.printedNoteChartValues, null);
      assert.equal(
        knownArtifacts.artifactPaths.printedNoteChartValues,
        verificationDashboardState.artifactPaths.printedNoteChartValues,
      );
      assert.equal(patientRuns[0]?.runId, verificationDashboardState.runId);
      assert.equal(patientRuns[0]?.processingStatus, "COMPLETE");
    } finally {
      fixture.cleanup();
    }
  });

  it("prefers the newest usable patient result across batches for the same agency", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();

      const workItem: PatientEpisodeWorkItem = {
        id: "patient-1",
        subsidiaryId: "default",
        patientIdentity: {
          displayName: "Test Patient",
          normalizedName: "TEST PATIENT",
          medicareNumber: null,
        },
        episodeContext: {
          episodeDate: "2026-04-21",
          socDate: "2026-04-01",
          episodePeriod: "2026-04",
          billingPeriod: "2026-04",
          payer: null,
          assignedStaff: null,
          clinician: null,
          qaSpecialist: null,
          rfa: null,
        },
        workflowTypes: ["SOC"],
        sourceSheets: ["OASIS Tracking Report"],
        timingMetadata: {
          trackingDays: 30,
          daysInPeriod: 30,
          daysLeft: 10,
          daysLeftBeforeOasisDueDate: 7,
          rawTrackingValues: ["30"],
          rawDaysInPeriodValues: ["30"],
          rawDaysLeftValues: ["10"],
        },
        codingReviewStatus: "NOT_STARTED",
        oasisQaStatus: "NOT_STARTED",
        pocQaStatus: "NOT_STARTED",
        visitNotesQaStatus: "NOT_STARTED",
        billingPrepStatus: "NOT_STARTED",
        sourceRemarks: [],
        sourceRowReferences: [],
        sourceValues: [],
        importWarnings: [],
      };

      const olderStorage = fixture.repository.createBatchPaths("batch-older", "older.xlsx");
      const newerStorage = fixture.repository.createBatchPaths("batch-newer", "newer.xlsx");
      const olderResultBundlePath = path.join(olderStorage.patientResultsDirectory, "patient-1.json");

      await mkdir(path.dirname(olderResultBundlePath), { recursive: true });
      await mkdir(newerStorage.outputRoot, { recursive: true });
      await writeFile(
        path.join(olderStorage.outputRoot, "work-items.json"),
        JSON.stringify([workItem], null, 2),
      );
      await writeFile(
        path.join(newerStorage.outputRoot, "work-items.json"),
        JSON.stringify([workItem], null, 2),
      );
      await writeFile(
        olderResultBundlePath,
        JSON.stringify(
          {
            runId: "batch-older-patient-1",
            batchId: "batch-older",
            subsidiaryId: "default",
            workItemId: "patient-1",
            patientName: "Test Patient",
            processingStatus: "COMPLETE",
            executionStep: "COMPLETE",
            progressPercent: 100,
            startedAt: "2026-04-21T20:25:22.000Z",
            completedAt: "2026-04-21T20:32:44.000Z",
            lastUpdatedAt: "2026-04-21T20:32:44.000Z",
            matchResult: {
              status: "EXACT",
              searchQuery: "Test Patient",
              portalPatientId: "PT-1",
              portalDisplayName: "Test Patient",
              candidateNames: ["Test Patient"],
              note: null,
            },
            artifacts: [],
            artifactCount: 0,
            findings: [],
            hasFindings: false,
            qaOutcome: "READY_FOR_BILLING_PREP",
            oasisQaSummary: {
              overallStatus: "READY_FOR_BILLING",
              urgency: "ON_TRACK",
              daysInPeriod: 30,
              daysLeft: 10,
              sections: [],
              blockers: [],
            },
            bundleAvailable: true,
            resultBundlePath: olderResultBundlePath,
            logPath: null,
            logAvailable: false,
            errorSummary: null,
            workflowRuns: [],
            auditArtifacts: {
              tracePath: null,
              screenshotPaths: [],
              downloadPaths: [],
            },
          },
          null,
          2,
        ),
      );

      await fixture.repository.saveBatch({
        id: "batch-older",
        subsidiary: {
          id: "default",
          slug: "default",
          name: "Default Subsidiary",
        },
        createdAt: "2026-04-21T16:21:00.000Z",
        updatedAt: "2026-04-21T20:32:44.000Z",
        runMode: "read_only" as const,
        billingPeriod: "2026-04",
        status: "COMPLETED" as const,
        schedule: {
          scheduledRunId: null,
          active: true,
          rerunEnabled: true,
          intervalHours: 24,
          timezone: "Asia/Manila",
          localTimes: ["20:30"],
          lastRunAt: null,
          nextScheduledRunAt: null,
        },
        sourceWorkbook: {
          subsidiaryId: "default",
          acquisitionProvider: "MANUAL_UPLOAD" as const,
          acquisitionStatus: "ACQUIRED" as const,
          acquisitionReference: null,
          acquisitionNotes: [],
          acquisitionMetadata: null,
          originalFileName: "older.xlsx",
          storedPath: olderStorage.sourceWorkbookPath,
          uploadedAt: "2026-04-21T16:21:00.000Z",
          verification: null,
        },
        storage: {
          batchRoot: olderStorage.batchRoot,
          outputRoot: olderStorage.outputRoot,
          manifestPath: null,
          workItemsPath: path.join(olderStorage.outputRoot, "work-items.json"),
          parserExceptionsPath: null,
          batchSummaryPath: null,
          patientResultsDirectory: olderStorage.patientResultsDirectory,
          evidenceDirectory: olderStorage.evidenceDirectory,
        },
        parse: {
          requestedAt: null,
          completedAt: null,
          workItemCount: 1,
          eligibleWorkItemCount: 1,
          parserExceptionCount: 0,
          sourceDetections: [],
          sheetSummaries: [],
          lastError: null,
        },
        run: {
          requestedAt: null,
          completedAt: "2026-04-21T20:32:44.000Z",
          patientRunCount: 1,
          lastError: null,
        },
        patientRuns: [
          {
            runId: "batch-older-patient-1",
            subsidiaryId: "default",
            workItemId: "patient-1",
            patientName: "Test Patient",
            processingStatus: "COMPLETE" as const,
            executionStep: "COMPLETE",
            progressPercent: 100,
            startedAt: "2026-04-21T20:25:22.000Z",
            completedAt: "2026-04-21T20:32:44.000Z",
            lastUpdatedAt: "2026-04-21T20:32:44.000Z",
            matchResult: {
              status: "EXACT",
              searchQuery: "Test Patient",
              portalPatientId: "PT-1",
              portalDisplayName: "Test Patient",
              candidateNames: ["Test Patient"],
              note: null,
            },
            qaOutcome: "READY_FOR_BILLING_PREP" as const,
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
            bundleAvailable: true,
            logPath: null,
            logAvailable: false,
            retryEligible: false,
            errorSummary: null,
            resultBundlePath: olderResultBundlePath,
            evidenceDirectory: path.join(olderStorage.evidenceDirectory, "patient-1"),
            tracePath: null,
            screenshotPaths: [],
            downloadPaths: [],
            workflowRuns: [],
            lastAttemptAt: "2026-04-21T20:32:44.000Z",
            attemptCount: 1,
          },
        ],
      });

      await fixture.repository.saveBatch({
        id: "batch-newer",
        subsidiary: {
          id: "default",
          slug: "default",
          name: "Default Subsidiary",
        },
        createdAt: "2026-04-21T23:57:18.000Z",
        updatedAt: "2026-04-21T23:57:28.000Z",
        runMode: "read_only" as const,
        billingPeriod: "2026-04",
        status: "RUNNING" as const,
        schedule: {
          scheduledRunId: null,
          active: true,
          rerunEnabled: true,
          intervalHours: 24,
          timezone: "Asia/Manila",
          localTimes: ["20:30"],
          lastRunAt: null,
          nextScheduledRunAt: null,
        },
        sourceWorkbook: {
          subsidiaryId: "default",
          acquisitionProvider: "MANUAL_UPLOAD" as const,
          acquisitionStatus: "ACQUIRED" as const,
          acquisitionReference: null,
          acquisitionNotes: [],
          acquisitionMetadata: null,
          originalFileName: "newer.xlsx",
          storedPath: newerStorage.sourceWorkbookPath,
          uploadedAt: "2026-04-21T23:57:18.000Z",
          verification: null,
        },
        storage: {
          batchRoot: newerStorage.batchRoot,
          outputRoot: newerStorage.outputRoot,
          manifestPath: null,
          workItemsPath: path.join(newerStorage.outputRoot, "work-items.json"),
          parserExceptionsPath: null,
          batchSummaryPath: null,
          patientResultsDirectory: newerStorage.patientResultsDirectory,
          evidenceDirectory: newerStorage.evidenceDirectory,
        },
        parse: {
          requestedAt: null,
          completedAt: null,
          workItemCount: 1,
          eligibleWorkItemCount: 1,
          parserExceptionCount: 0,
          sourceDetections: [],
          sheetSummaries: [],
          lastError: null,
        },
        run: {
          requestedAt: "2026-04-21T23:57:18.000Z",
          completedAt: null,
          patientRunCount: 0,
          lastError: null,
        },
        patientRuns: [
          {
            runId: "batch-newer-patient-1",
            subsidiaryId: "default",
            workItemId: "patient-1",
            patientName: "Test Patient",
            processingStatus: "MATCHING_PATIENT" as const,
            executionStep: "MATCHING_PATIENT",
            progressPercent: 10,
            startedAt: "2026-04-21T23:57:28.000Z",
            completedAt: null,
            lastUpdatedAt: "2026-04-21T23:57:28.000Z",
            matchResult: {
              status: "NOT_FOUND",
              searchQuery: "Test Patient",
              portalPatientId: null,
              portalDisplayName: null,
              candidateNames: [],
              note: "Patient was not searched yet.",
            },
            qaOutcome: "INCOMPLETE" as const,
            oasisQaSummary: {
              overallStatus: "IN_PROGRESS",
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
            resultBundlePath: path.join(newerStorage.patientResultsDirectory, "patient-1.json"),
            evidenceDirectory: path.join(newerStorage.evidenceDirectory, "patient-1"),
            tracePath: null,
            screenshotPaths: [],
            downloadPaths: [],
            workflowRuns: [],
            lastAttemptAt: null,
            attemptCount: 1,
          },
        ],
      });

      const latestPatient = await fixture.service.getLatestPatientForSubsidiary({
        subsidiaryId: "default",
        patientId: "patient-1",
      });

      assert.ok(latestPatient);
      assert.equal(latestPatient.batch.id, "batch-older");
      assert.equal(latestPatient.summary.runId, "batch-older-patient-1");
      assert.ok(latestPatient.detail);
      assert.equal(latestPatient.detail.processingStatus, "COMPLETE");
    } finally {
      fixture.cleanup();
    }
  });

  it("creates a sample batch with only the selected patient subset", async () => {
    const fixture = createServiceFixture();

    try {
      await fixture.service.initialize();

      const sourceBatchId = "batch-source";
      const storage = fixture.repository.createBatchPaths(sourceBatchId, "reference-workbook.xlsx");
      const manifestPath = path.join(storage.outputRoot, "batch-manifest.json");
      const workItemsPath = path.join(storage.outputRoot, "work-items.json");
      const parserExceptionsPath = path.join(storage.outputRoot, "parser-exceptions.json");
      const workItems: PatientEpisodeWorkItem[] = Array.from({ length: 6 }, (_, index) => ({
        id: `patient-${index + 1}`,
        subsidiaryId: "default",
        patientIdentity: {
          displayName: `Patient ${index + 1}`,
          normalizedName: `PATIENT ${index + 1}`,
          medicareNumber: null,
        },
        episodeContext: {
          episodeDate: "2026-04-15",
          socDate: "2026-04-01",
          episodePeriod: "2026-04",
          billingPeriod: "2026-04",
          payer: null,
          assignedStaff: null,
          clinician: null,
          qaSpecialist: null,
          rfa: null,
        },
        workflowTypes: ["SOC"],
        sourceSheets: ["OASIS Tracking Report"],
        timingMetadata: {
          trackingDays: 30,
          daysInPeriod: 30,
          daysLeft: 10,
          daysLeftBeforeOasisDueDate: 7,
          rawTrackingValues: ["30"],
          rawDaysInPeriodValues: ["30"],
          rawDaysLeftValues: ["10"],
        },
        codingReviewStatus: "NOT_STARTED",
        oasisQaStatus: "NOT_STARTED",
        pocQaStatus: "NOT_STARTED",
        visitNotesQaStatus: "NOT_STARTED",
        billingPrepStatus: "NOT_STARTED",
        sourceRemarks: [],
        sourceRowReferences: [],
        sourceValues: [],
        importWarnings: [],
      }));
      const manifest: BatchManifest = {
        batchId: sourceBatchId,
        subsidiaryId: "default",
        createdAt: "2026-04-15T06:00:00.000Z",
        status: "READY",
        workbookPath: storage.sourceWorkbookPath,
        outputDirectory: storage.outputRoot,
        billingPeriod: "2026-04",
        totalWorkItems: workItems.length,
        parserExceptionCount: 0,
        automationEligibleWorkItemIds: workItems.map((workItem) => workItem.id),
        blockedWorkItemIds: [],
      };

      await mkdir(path.dirname(storage.sourceWorkbookPath), { recursive: true });
      await mkdir(storage.outputRoot, { recursive: true });
      await writeFile(storage.sourceWorkbookPath, "sample workbook");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      await writeFile(workItemsPath, JSON.stringify(workItems, null, 2));
      await writeFile(parserExceptionsPath, JSON.stringify([], null, 2));

      const sourceBatch = {
        id: sourceBatchId,
        subsidiary: {
          id: "default",
          slug: "default",
          name: "Default Subsidiary",
        },
        createdAt: "2026-04-15T06:00:00.000Z",
        updatedAt: "2026-04-15T06:05:00.000Z",
        runMode: "read_only" as const,
        billingPeriod: "2026-04",
        status: "READY" as const,
        schedule: {
          scheduledRunId: null,
          active: true,
          rerunEnabled: true,
          intervalHours: 24,
          timezone: "Asia/Manila",
          localTimes: ["20:30"],
          lastRunAt: null,
          nextScheduledRunAt: null,
        },
        sourceWorkbook: {
          subsidiaryId: "default",
          acquisitionProvider: "MANUAL_UPLOAD" as const,
          acquisitionStatus: "ACQUIRED" as const,
          acquisitionReference: null,
          acquisitionNotes: [],
          acquisitionMetadata: null,
          originalFileName: "reference-workbook.xlsx",
          storedPath: storage.sourceWorkbookPath,
          uploadedAt: "2026-04-15T06:00:00.000Z",
          verification: null,
        },
        storage: {
          batchRoot: storage.batchRoot,
          outputRoot: storage.outputRoot,
          manifestPath,
          workItemsPath,
          parserExceptionsPath,
          batchSummaryPath: null,
          patientResultsDirectory: storage.patientResultsDirectory,
          evidenceDirectory: storage.evidenceDirectory,
        },
        parse: {
          requestedAt: "2026-04-15T06:00:00.000Z",
          completedAt: "2026-04-15T06:05:00.000Z",
          workItemCount: workItems.length,
          eligibleWorkItemCount: workItems.length,
          parserExceptionCount: 0,
          sourceDetections: [],
          sheetSummaries: [],
          lastError: null,
        },
        run: {
          requestedAt: null,
          completedAt: null,
          patientRunCount: 0,
          lastError: null,
        },
        patientRuns: [],
      };

      await fixture.repository.saveBatch(sourceBatch);

      const sampleBatch = await fixture.service.createPatientSampleBatch({
        sourceBatchId,
        limit: 5,
      });

      assert.equal(sampleBatch.status, "READY");
      assert.equal(sampleBatch.schedule.active, false);
      assert.equal(sampleBatch.patientRuns.length, 5);
      assert.equal(sampleBatch.parse.workItemCount, 5);
      assert.equal(sampleBatch.storage.workItemsPath?.includes(sampleBatch.id), true);

      const sampleWorkItems = await fixture.repository.readWorkItems(sampleBatch);
      const sampleManifest = await fixture.repository.readManifest(sampleBatch);

      assert.equal(sampleWorkItems.length, 5);
      assert.deepEqual(
        sampleWorkItems.map((workItem) => workItem.id),
        workItems.slice(0, 5).map((workItem) => workItem.id),
      );
      assert.equal(sampleManifest.batchId, sampleBatch.id);
      assert.equal(sampleManifest.totalWorkItems, 5);
      assert.deepEqual(sampleManifest.automationEligibleWorkItemIds, workItems.slice(0, 5).map((workItem) => workItem.id));
      assert.equal(sampleManifest.workbookPath, sampleBatch.sourceWorkbook.storedPath);
      assert.notEqual(sampleBatch.sourceWorkbook.storedPath, sourceBatch.sourceWorkbook.storedPath);
      assert.equal(await readFile(sampleBatch.sourceWorkbook.storedPath, "utf8"), "sample workbook");
    } finally {
      fixture.cleanup();
    }
  });
});
