import { mkdir, readFile, writeFile } from "node:fs/promises";
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
          localTimes: ["15:00", "23:30"],
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
      assert.deepEqual(
        knownArtifacts.artifactContents.printedNoteReview,
        dashboardState.artifactContents.printedNoteReview,
      );
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
          localTimes: ["15:00", "23:30"],
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
