import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BatchManifest,
  BatchSummary,
  ParserException,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientRunLog,
  PatientRun,
  SubsidiaryRecord,
} from "@medical-ai-qa/shared-types";
import {
  buildOasisQaSummary,
  createBatchSummary,
  executePatientWorkItems,
  intakeWorkbook,
  persistBatchSummary,
} from "@medical-ai-qa/finale-workbook-intake";
import type { Logger } from "pino";
import type { WorkbookAcquisitionService } from "../acquisition/workbookAcquisitionService";
import type { ManualUploadWorkbookInput } from "../acquisition/manualUploadWorkbookProvider";
import type { WorkbookAcquisitionProviderId } from "../acquisition/workbookAcquisitionProvider";
import type { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import type { FilesystemScheduledRunRepository } from "../repositories/filesystemScheduledRunRepository";
import type { BatchRecord } from "../types/batchControlPlane";
import type { ScheduledRunRecord } from "../types/scheduledRun";
import type { SubsidiaryConfigService } from "./subsidiaryConfigService";

const DEFAULT_RERUN_INTERVAL_HOURS = 24;
const SCHEDULE_POLL_INTERVAL_MS = 60_000;

function createBatchId(): string {
  return `batch-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function createRunId(batchId: string, workItemId: string): string {
  return `${batchId}-${workItemId}`;
}

function createPlaceholderMatchResult(patientName: string): PatientMatchResult {
  return {
    status: "NOT_FOUND",
    searchQuery: patientName,
    portalPatientId: null,
    portalDisplayName: null,
    candidateNames: [],
    note: "Patient has not been processed yet.",
  };
}

function isTransientPatientStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["PENDING", "MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
    status,
  );
}

function isRetryEligibleStatus(status: BatchRecord["patientRuns"][number]["processingStatus"]): boolean {
  return ["BLOCKED", "FAILED", "NEEDS_HUMAN_REVIEW"].includes(status);
}

function createPendingPatientRunState(
  batch: BatchRecord,
  workItem: PatientEpisodeWorkItem,
  previous?: BatchRecord["patientRuns"][number],
): BatchRecord["patientRuns"][number] {
  const resultBundlePath = path.join(
    batch.storage.patientResultsDirectory,
    `${workItem.id}.json`,
  );

  return {
    runId: createRunId(batch.id, workItem.id),
    subsidiaryId: workItem.subsidiaryId ?? batch.subsidiary.id,
    workItemId: workItem.id,
    patientName: workItem.patientIdentity.displayName,
    processingStatus: "PENDING",
    executionStep: "PENDING",
    progressPercent: 0,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: batch.updatedAt,
    matchResult: createPlaceholderMatchResult(workItem.patientIdentity.displayName),
    qaOutcome: "INCOMPLETE",
    oasisQaSummary: buildOasisQaSummary({
      workItem,
      matchResult: createPlaceholderMatchResult(workItem.patientIdentity.displayName),
      artifacts: [],
      processingStatus: "PENDING",
    }),
    artifactCount: 0,
    hasFindings: false,
    bundleAvailable: false,
    logPath: null,
    logAvailable: false,
    retryEligible: false,
    errorSummary: null,
    resultBundlePath,
    evidenceDirectory: path.join(batch.storage.evidenceDirectory, workItem.id),
    tracePath: null,
    screenshotPaths: [],
    downloadPaths: [],
    lastAttemptAt: previous?.lastAttemptAt ?? null,
    attemptCount: previous?.attemptCount ?? 0,
  };
}

function toPersistedPatientRun(
  batch: BatchRecord,
  patientRun: PatientRun,
  previous?: BatchRecord["patientRuns"][number],
): BatchRecord["patientRuns"][number] {
  return {
    runId: patientRun.runId,
    subsidiaryId: patientRun.subsidiaryId ?? batch.subsidiary.id,
    workItemId: patientRun.workItemId,
    patientName: patientRun.patientName,
    processingStatus: patientRun.processingStatus,
    executionStep: patientRun.executionStep,
    progressPercent: patientRun.progressPercent,
    startedAt: patientRun.startedAt,
    completedAt: patientRun.completedAt,
    lastUpdatedAt: patientRun.lastUpdatedAt,
    matchResult: patientRun.matchResult,
    qaOutcome: patientRun.qaOutcome,
    oasisQaSummary: patientRun.oasisQaSummary,
    artifactCount: patientRun.artifactCount,
    hasFindings: patientRun.hasFindings,
    bundleAvailable: patientRun.bundleAvailable || Boolean(patientRun.resultBundlePath),
    logPath: patientRun.logPath,
    logAvailable: patientRun.logAvailable,
    retryEligible: patientRun.retryEligible,
    errorSummary: patientRun.errorSummary,
    resultBundlePath:
      patientRun.resultBundlePath ??
      path.join(batch.storage.patientResultsDirectory, `${patientRun.workItemId}.json`),
    evidenceDirectory: path.join(batch.storage.evidenceDirectory, patientRun.workItemId),
    tracePath: patientRun.auditArtifacts.tracePath,
    screenshotPaths: patientRun.auditArtifacts.screenshotPaths,
    downloadPaths: patientRun.auditArtifacts.downloadPaths,
    lastAttemptAt: patientRun.completedAt ?? patientRun.lastUpdatedAt,
    attemptCount: previous ? previous.attemptCount + 1 : 1,
  };
}

function countProcessedPatientRuns(batch: BatchRecord): number {
  return batch.patientRuns.filter((patientRun) => !isTransientPatientStatus(patientRun.processingStatus))
    .length;
}

function deriveBatchErrorSummary(batch: BatchRecord): string | null {
  return (
    batch.run.lastError ??
    batch.parse.lastError ??
    batch.patientRuns.find((patientRun) => patientRun.errorSummary)?.errorSummary ??
    null
  );
}

function createBatchSchedule(now: string, subsidiary: SubsidiaryRecord): BatchRecord["schedule"] {
  return {
    scheduledRunId: null,
    active: subsidiary.rerunEnabled,
    rerunEnabled: subsidiary.rerunEnabled,
    intervalHours: subsidiary.rerunIntervalHours || DEFAULT_RERUN_INTERVAL_HOURS,
    lastRunAt: null,
    nextScheduledRunAt: subsidiary.rerunEnabled
      ? calculateNextScheduledRunAt(now, subsidiary.rerunIntervalHours || DEFAULT_RERUN_INTERVAL_HOURS)
      : null,
  };
}

function calculateNextScheduledRunAt(fromIsoTimestamp: string, intervalHours: number): string {
  return new Date(Date.parse(fromIsoTimestamp) + intervalHours * 60 * 60 * 1000).toISOString();
}

export class BatchControlPlaneService {
  private readonly activeBatchJobs = new Map<string, Promise<void>>();
  private rerunTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: FilesystemBatchRepository,
    private readonly scheduledRunRepository: FilesystemScheduledRunRepository,
    private readonly acquisitionService: WorkbookAcquisitionService,
    private readonly subsidiaryConfigService: SubsidiaryConfigService,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    await this.repository.ensureReady();
    await this.scheduledRunRepository.ensureReady();
    await this.subsidiaryConfigService.initialize();
    await this.reconcileInterruptedBatches();
    this.ensureScheduler();
    await this.triggerDueScheduledRuns();
  }

  async createBatchUpload(input: {
    fileName: string;
    fileBuffer: Buffer;
    billingPeriod?: string | null;
    subsidiaryId?: string | null;
  }): Promise<BatchRecord> {
    return this.createBatchFromProvider({
      providerId: "MANUAL_UPLOAD",
      billingPeriod: input.billingPeriod ?? null,
      originalFileName: input.fileName,
      subsidiaryId: input.subsidiaryId ?? null,
      input: {
        fileName: input.fileName,
        fileBuffer: input.fileBuffer,
      },
    });
  }

  async createBatchFromProvider(params: {
    providerId: WorkbookAcquisitionProviderId;
    billingPeriod?: string | null;
    originalFileName?: string | null;
    subsidiaryId?: string | null;
    input: ManualUploadWorkbookInput | { exportName?: string | null };
  }): Promise<BatchRecord> {
    const subsidiary = params.subsidiaryId
      ? await this.subsidiaryConfigService.getSubsidiaryConfig(params.subsidiaryId)
      : await this.subsidiaryConfigService.getDefaultActiveSubsidiary();
    const batchId = createBatchId();
    const fileName = params.originalFileName?.trim() || "finale-workbook.xlsx";
    const paths = this.repository.createBatchPaths(batchId, fileName);
    const now = new Date().toISOString();

    const batch: BatchRecord = {
      id: batchId,
      subsidiary: {
        id: subsidiary.id,
        slug: subsidiary.slug,
        name: subsidiary.name,
      },
      createdAt: now,
      updatedAt: now,
      runMode: "read_only",
      billingPeriod: params.billingPeriod ?? null,
      status: "CREATED",
      schedule: createBatchSchedule(now, subsidiary),
      sourceWorkbook: {
        subsidiaryId: subsidiary.id,
        acquisitionProvider: params.providerId,
        acquisitionStatus: "PENDING",
        acquisitionReference: null,
        acquisitionNotes: [],
        originalFileName: fileName,
        storedPath: paths.sourceWorkbookPath,
        uploadedAt: now,
      },
      storage: {
        batchRoot: paths.batchRoot,
        outputRoot: paths.outputRoot,
        manifestPath: null,
        workItemsPath: null,
        parserExceptionsPath: null,
        batchSummaryPath: null,
        patientResultsDirectory: paths.patientResultsDirectory,
        evidenceDirectory: paths.evidenceDirectory,
      },
      parse: {
        requestedAt: null,
        completedAt: null,
        workItemCount: 0,
        eligibleWorkItemCount: 0,
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

    await this.repository.saveBatch(batch);

    try {
      const acquisition = await this.acquisitionService.acquireWorkbook({
        batch,
        billingPeriod: params.billingPeriod ?? null,
        providerId: params.providerId,
        input: params.input,
      });

      batch.updatedAt = acquisition.acquiredAt;
      batch.sourceWorkbook.acquisitionStatus = "ACQUIRED";
      batch.sourceWorkbook.acquisitionReference = acquisition.acquisitionReference;
      batch.sourceWorkbook.acquisitionNotes = acquisition.notes;
      batch.sourceWorkbook.originalFileName = acquisition.originalFileName;
      batch.sourceWorkbook.storedPath = acquisition.storedPath;
      batch.sourceWorkbook.uploadedAt = acquisition.acquiredAt;
      await this.repository.saveBatch(batch);

      const scheduledRun = await this.createOrRefreshScheduledRun(batch, subsidiary, acquisition.acquiredAt);
      batch.schedule.scheduledRunId = scheduledRun.id;
      await this.repository.saveBatch(batch);

      await this.deactivateOtherActiveSchedules(batch.id, batch.subsidiary.id, acquisition.acquiredAt);
      this.logger.info(
        {
          batchId,
          subsidiaryId: batch.subsidiary.id,
          subsidiarySlug: batch.subsidiary.slug,
          acquisitionProvider: params.providerId,
          rerunEnabled: batch.schedule.rerunEnabled,
          runMode: batch.runMode,
        },
        "workbook uploaded and batch created",
      );
      return batch;
    } catch (error) {
      batch.status = "FAILED";
      batch.updatedAt = new Date().toISOString();
      batch.sourceWorkbook.acquisitionStatus = "FAILED";
      batch.sourceWorkbook.acquisitionNotes = [
        error instanceof Error ? error.message : "Unknown workbook acquisition error.",
      ];
      batch.parse.lastError =
        error instanceof Error ? error.message : "Unknown workbook acquisition error.";
      await this.repository.saveBatch(batch);
      throw error;
    }
  }

  async listBatches(): Promise<BatchRecord[]> {
    return this.repository.listBatches();
  }

  async getBatch(batchId: string): Promise<BatchRecord | null> {
    return this.repository.getBatch(batchId);
  }

  async parseBatch(batchId: string): Promise<BatchRecord> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (this.activeBatchJobs.has(batchId)) {
      throw new Error(`Batch is already running: ${batchId}`);
    }

    const now = new Date().toISOString();
    batch.status = "PARSING";
    batch.updatedAt = now;
    batch.parse.requestedAt = now;
    batch.parse.lastError = null;
    await this.repository.saveBatch(batch);

    try {
      const result = await intakeWorkbook({
        batchId: batch.id,
        subsidiaryId: batch.subsidiary.id,
        workbookPath: batch.sourceWorkbook.storedPath,
        outputDir: batch.storage.outputRoot,
      });

      batch.status = "READY";
      batch.updatedAt = new Date().toISOString();
      batch.billingPeriod = result.manifest.billingPeriod ?? batch.billingPeriod;
      batch.storage.manifestPath = result.manifestPath;
      batch.storage.workItemsPath = result.workItemsPath;
      batch.storage.parserExceptionsPath = result.parserExceptionsPath;
      batch.storage.batchSummaryPath = null;
      batch.parse.completedAt = batch.updatedAt;
      batch.parse.workItemCount = result.workItems.length;
      batch.parse.eligibleWorkItemCount = result.workItems.length;
      batch.parse.parserExceptionCount = result.parserExceptions.length;
      batch.parse.sourceDetections = result.diagnostics.sourceDetections;
      batch.parse.sheetSummaries = result.diagnostics.sheetSummaries;
      batch.parse.lastError = null;
      batch.run.requestedAt = null;
      batch.run.completedAt = null;
      batch.run.patientRunCount = 0;
      batch.run.lastError = null;
      batch.patientRuns = result.workItems.map((workItem) =>
        createPendingPatientRunState(batch, workItem),
      );
      await this.repository.saveBatch(batch);

      this.logger.info(
        {
          batchId,
          subsidiaryId: batch.subsidiary.id,
          workItems: result.workItems.length,
        },
        "batch parsed",
      );
      return batch;
    } catch (error) {
      batch.status = "FAILED";
      batch.updatedAt = new Date().toISOString();
      batch.parse.completedAt = batch.updatedAt;
      batch.parse.lastError = error instanceof Error ? error.message : "Unknown parse error.";
      await this.repository.saveBatch(batch);
      throw error;
    }
  }

  async startBatchRun(batchId: string): Promise<BatchRecord> {
    let batch = await this.mustGetBatch(batchId);

    if (this.activeBatchJobs.has(batchId)) {
      return batch;
    }

    if (batch.status === "CREATED") {
      batch = await this.parseBatch(batchId);
    }

    const workItems = await this.repository.readWorkItems(batch);
    batch.patientRuns = workItems.map((workItem) => {
      const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
      return createPendingPatientRunState(batch, workItem, previous);
    });
    batch.status = "RUNNING";
    batch.updatedAt = new Date().toISOString();
    batch.run.requestedAt = batch.updatedAt;
    batch.run.completedAt = null;
    batch.run.lastError = null;
    batch.run.patientRunCount = 0;
    await this.repository.saveBatch(batch);

    const task = this.executeBatchRun(batchId).finally(() => {
      this.activeBatchJobs.delete(batchId);
    });
    this.activeBatchJobs.set(batchId, task);
    void task;

    return batch;
  }

  async deactivateBatch(batchId: string): Promise<BatchRecord> {
    const batch = await this.mustGetBatch(batchId);
    const now = new Date().toISOString();
    batch.updatedAt = now;
    batch.schedule.active = false;
    batch.schedule.rerunEnabled = false;
    batch.schedule.nextScheduledRunAt = null;
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
    this.logger.info(
      { batchId, subsidiaryId: batch.subsidiary.id },
      "batch rerun schedule deactivated",
    );
    return batch;
  }

  async retryBlockedPatientRuns(batchId: string): Promise<BatchRecord> {
    const batch = await this.mustGetBatch(batchId);
    if (this.activeBatchJobs.has(batchId)) {
      return batch;
    }

    const retryCandidates = batch.patientRuns.filter((patientRun) =>
      isRetryEligibleStatus(patientRun.processingStatus),
    );

    if (retryCandidates.length === 0) {
      throw new Error(`No blocked patient runs are eligible for retry in batch: ${batchId}`);
    }

    const workItems = await this.repository.readWorkItems(batch);
    const workItemsToRetry = workItems.filter((workItem) =>
      retryCandidates.some((candidate) => candidate.workItemId === workItem.id),
    );

    const updatedBatch = await this.prepareRetryBatch(batch, workItemsToRetry);
    const task = this.executeRetryWorkItems(updatedBatch.id, workItemsToRetry).finally(() => {
      this.activeBatchJobs.delete(updatedBatch.id);
    });
    this.activeBatchJobs.set(updatedBatch.id, task);
    void task;

    return updatedBatch;
  }

  async getWorkItems(batchId: string): Promise<PatientEpisodeWorkItem[]> {
    const batch = await this.mustGetBatch(batchId);
    return this.repository.readWorkItems(batch);
  }

  async getParserExceptions(batchId: string): Promise<ParserException[]> {
    const batch = await this.mustGetBatch(batchId);
    return this.repository.readParserExceptions(batch);
  }

  async getBatchSummary(batchId: string): Promise<BatchSummary | null> {
    const batch = await this.mustGetBatch(batchId);
    return this.repository.readBatchSummary(batch);
  }

  async getPatientRuns(batchId: string): Promise<BatchRecord["patientRuns"]> {
    const batch = await this.mustGetBatch(batchId);
    return [...batch.patientRuns].sort((left, right) => left.patientName.localeCompare(right.patientName));
  }

  async getPatientRun(runId: string): Promise<{
    batchId: string;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
  } | null> {
    const result = await this.repository.findPatientRun(runId);
    if (!result) {
      return null;
    }

    const summary = result.batch.patientRuns.find((patientRun) => patientRun.runId === runId) ?? null;
    if (!summary) {
      return null;
    }

    return {
      batchId: result.batch.id,
      summary,
      detail: summary.bundleAvailable ? result.patientRun : null,
    };
  }

  async getBatchDetailWithPatients(batchId: string): Promise<{
    batch: BatchRecord;
    patients: BatchRecord["patientRuns"];
  }> {
    const batch = await this.mustGetBatch(batchId);
    const patients = [...batch.patientRuns].sort((left, right) =>
      left.patientName.localeCompare(right.patientName),
    );

    return {
      batch,
      patients,
    };
  }

  async getBatchPatient(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
  } | null> {
    const batch = await this.mustGetBatch(batchId);
    const summary = batch.patientRuns.find((patientRun) => patientRun.workItemId === patientId);
    if (!summary) {
      return null;
    }

    const detail =
      summary.bundleAvailable && (await this.repository.fileExists(summary.resultBundlePath))
        ? await this.repository.readPatientRun(summary.resultBundlePath)
        : null;

    return {
      batch,
      summary,
      detail,
    };
  }

  async getBatchPatientLog(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    log: PatientRunLog | null;
  } | null> {
    const patient = await this.getBatchPatient(batchId, patientId);
    if (!patient) {
      return null;
    }

    const log =
      patient.summary.logAvailable &&
      patient.summary.logPath &&
      (await this.repository.fileExists(patient.summary.logPath))
        ? await this.repository.readPatientRunLog(patient.summary.logPath)
        : null;

    return {
      batch: patient.batch,
      summary: patient.summary,
      log,
    };
  }

  async getBatchPatientArtifacts(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    artifacts: Array<{
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download" | "evidence";
      name: string;
      path: string;
      exists: boolean;
      modifiedAt: string | null;
      sizeBytes: number | null;
    }>;
  } | null> {
    const patient = await this.getBatchPatient(batchId, patientId);
    if (!patient) {
      return null;
    }

    const artifacts: Array<{
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download" | "evidence";
      name: string;
      path: string;
      exists: boolean;
      modifiedAt: string | null;
      sizeBytes: number | null;
    }> = [];

    const pushFileArtifact = async (
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download",
      filePath: string | null,
    ): Promise<void> => {
      if (!filePath) {
        return;
      }

      const exists = await this.repository.fileExists(filePath);
      if (!exists) {
        artifacts.push({
          kind,
          name: path.basename(filePath),
          path: filePath,
          exists: false,
          modifiedAt: null,
          sizeBytes: null,
        });
        return;
      }

      const fileInfo = await this.repository.listFiles(path.dirname(filePath));
      const matched = fileInfo.find((entry) => entry.path === filePath);
      artifacts.push({
        kind,
        name: path.basename(filePath),
        path: filePath,
        exists: true,
        modifiedAt: matched?.modifiedAt ?? null,
        sizeBytes: matched?.sizeBytes ?? null,
      });
    };

    await pushFileArtifact("bundle", patient.summary.resultBundlePath);
    await pushFileArtifact("log", patient.summary.logPath);
    await pushFileArtifact("failure_trace", patient.summary.tracePath);

    for (const screenshotPath of patient.summary.screenshotPaths) {
      await pushFileArtifact("failure_screenshot", screenshotPath);
    }

    for (const downloadPath of patient.summary.downloadPaths) {
      await pushFileArtifact("download", downloadPath);
    }

    if (await this.repository.fileExists(patient.summary.evidenceDirectory)) {
      const evidenceFiles = await this.repository.listFilesRecursive(patient.summary.evidenceDirectory);
      artifacts.push(
        ...evidenceFiles.map((file) => ({
          kind: "evidence" as const,
          name: file.name,
          path: file.path,
          exists: true,
          modifiedAt: file.modifiedAt,
          sizeBytes: file.sizeBytes,
        })),
      );
    }

    return {
      batch: patient.batch,
      summary: patient.summary,
      artifacts,
    };
  }

  async getBatchWorkItem(
    batchId: string,
    patientId: string,
  ): Promise<PatientEpisodeWorkItem | null> {
    const batch = await this.mustGetBatch(batchId);
    const workItems = await this.repository.readWorkItems(batch);
    return workItems.find((workItem) => workItem.id === patientId) ?? null;
  }

  async getKnownPatientArtifacts(batchId: string, patientId: string): Promise<{
    batch: BatchRecord;
    summary: BatchRecord["patientRuns"][number];
    detail: PatientRun | null;
    workItem: PatientEpisodeWorkItem | null;
    patientArtifactsDirectory: string;
    artifactPaths: {
      codingInput: string;
      documentText: string;
    };
    artifactContents: {
      codingInput: unknown | null;
      documentText: unknown | null;
    };
  } | null> {
    const patient = await this.getBatchPatient(batchId, patientId);
    if (!patient) {
      return null;
    }

    const workItem = await this.getBatchWorkItem(batchId, patientId);
    const patientArtifactsDirectory = path.join(patient.batch.storage.outputRoot, "patients", patientId);
    const artifactPaths = {
      codingInput: path.join(patientArtifactsDirectory, "coding-input.json"),
      documentText: path.join(patientArtifactsDirectory, "document-text.json"),
    };

    return {
      batch: patient.batch,
      summary: patient.summary,
      detail: patient.detail,
      workItem,
      patientArtifactsDirectory,
      artifactPaths,
      artifactContents: {
        codingInput: await this.repository.readJsonIfExists(artifactPaths.codingInput),
        documentText: await this.repository.readJsonIfExists(artifactPaths.documentText),
      },
    };
  }

  async retryPatientRun(runId: string): Promise<{
    batchId: string;
    summary: BatchRecord["patientRuns"][number];
  }> {
    const locatedRun = await this.repository.findPatientRun(runId);
    if (!locatedRun) {
      throw new Error(`Patient run not found: ${runId}`);
    }

    if (this.activeBatchJobs.has(locatedRun.batch.id)) {
      const currentSummary = locatedRun.batch.patientRuns.find((patientRun) => patientRun.runId === runId);
      if (!currentSummary) {
        throw new Error(`Patient run not found: ${runId}`);
      }
      return {
        batchId: locatedRun.batch.id,
        summary: currentSummary,
      };
    }

    const workItems = await this.repository.readWorkItems(locatedRun.batch);
    const currentSummary = locatedRun.batch.patientRuns.find((patientRun) => patientRun.runId === runId);
    const workItem = workItems.find((candidate) => candidate.id === currentSummary?.workItemId);
    if (!workItem) {
      throw new Error(`Work item not found for patient run: ${runId}`);
    }

    const updatedBatch = await this.prepareRetryBatch(locatedRun.batch, [workItem]);
    const task = this.executeRetryWorkItems(updatedBatch.id, [workItem]).finally(() => {
      this.activeBatchJobs.delete(updatedBatch.id);
    });
    this.activeBatchJobs.set(updatedBatch.id, task);
    void task;

    const patientRunSummary = updatedBatch.patientRuns.find((patientRun) => patientRun.runId === runId);
    if (!patientRunSummary) {
      throw new Error(`Patient run not found after retry start: ${runId}`);
    }

    return {
      batchId: updatedBatch.id,
      summary: patientRunSummary,
    };
  }

  private async executeBatchRun(batchId: string): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const manifest = await this.repository.readManifest(batch);
    const parserExceptions = await this.repository.readParserExceptions(batch);
    const workItems = await this.repository.readWorkItems(batch);
    const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(
      batch.subsidiary.id,
    );

    try {
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          subsidiaryName: batch.subsidiary.name,
        },
        "read-only batch worker run started",
      );
      await executePatientWorkItems({
        batchId: batch.id,
        workItems,
        outputDir: batch.storage.outputRoot,
        subsidiaryRuntimeConfig,
        logger: this.logger,
        onPatientRunUpdate: async (patientRun) => {
          await this.persistPatientRunUpdate(batch.id, patientRun);
        },
      });

      await this.finalizeBatchExecution(batch.id, manifest, parserExceptions);
      this.logger.info({ batchId }, "batch run completed");
    } catch (error) {
      await this.failBatch(batch.id, error, "run");
      throw error;
    }
  }

  private async executeRetryWorkItems(
    batchId: string,
    workItems: PatientEpisodeWorkItem[],
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const manifest = await this.repository.readManifest(batch);
    const parserExceptions = await this.repository.readParserExceptions(batch);
    const subsidiaryRuntimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(
      batch.subsidiary.id,
    );

    try {
      await executePatientWorkItems({
        batchId: batch.id,
        workItems,
        outputDir: batch.storage.outputRoot,
        subsidiaryRuntimeConfig,
        logger: this.logger,
        onPatientRunUpdate: async (patientRun) => {
          await this.persistPatientRunUpdate(batch.id, patientRun);
        },
      });

      await this.finalizeBatchExecution(batch.id, manifest, parserExceptions);
      this.logger.info(
        { batchId, retriedPatients: workItems.length },
        "patient retries completed",
      );
    } catch (error) {
      await this.failBatch(batch.id, error, "retry");
      throw error;
    }
  }

  private async prepareRetryBatch(
    batch: BatchRecord,
    workItems: PatientEpisodeWorkItem[],
  ): Promise<BatchRecord> {
    batch.status = "RUNNING";
    batch.updatedAt = new Date().toISOString();
    batch.run.requestedAt = batch.updatedAt;
    batch.run.completedAt = null;
    batch.run.lastError = null;

    batch.patientRuns = batch.patientRuns.map((patientRun) => {
      const matchingWorkItem = workItems.find((workItem) => workItem.id === patientRun.workItemId);
      if (!matchingWorkItem) {
        return patientRun;
      }

      return createPendingPatientRunState(batch, matchingWorkItem, patientRun);
    });

    await this.repository.saveBatch(batch);
    return batch;
  }

  private async persistPatientRunUpdate(batchId: string, patientRun: PatientRun): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const previous = batch.patientRuns.find((candidate) => candidate.runId === patientRun.runId);
    const nextRun = toPersistedPatientRun(batch, patientRun, previous);

    batch.patientRuns = [
      ...batch.patientRuns.filter((candidate) => candidate.runId !== nextRun.runId),
      nextRun,
    ].sort((left, right) => left.patientName.localeCompare(right.patientName));
    batch.updatedAt = nextRun.lastUpdatedAt;
    batch.run.patientRunCount = countProcessedPatientRuns(batch);
    batch.run.lastError = deriveBatchErrorSummary(batch);
    await this.repository.saveBatch(batch);
  }

  private async finalizeBatchExecution(
    batchId: string,
    manifest: BatchManifest,
    parserExceptions: ParserException[],
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const patientRuns = await this.repository.listPatientRuns(batch);
    const completedAt = new Date().toISOString();
    const batchSummary = createBatchSummary({
      manifest,
      parserExceptions,
      patientRuns,
      startedAt: batch.run.requestedAt ?? batch.createdAt,
      completedAt,
    });

    batch.storage.batchSummaryPath = await persistBatchSummary(
      batch.storage.outputRoot,
      batchSummary,
    );
    batch.status = batchSummary.status;
    batch.updatedAt = completedAt;
    batch.run.completedAt = completedAt;
    batch.run.patientRunCount = countProcessedPatientRuns(batch);
    batch.run.lastError = deriveBatchErrorSummary(batch);
    batch.schedule.lastRunAt = completedAt;
    batch.schedule.nextScheduledRunAt =
      batch.schedule.active && batch.schedule.rerunEnabled
        ? calculateNextScheduledRunAt(completedAt, batch.schedule.intervalHours)
        : null;
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
  }

  private async failBatch(
    batchId: string,
    error: unknown,
    phase: "run" | "retry",
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    batch.status = "FAILED";
    batch.updatedAt = new Date().toISOString();
    batch.run.completedAt = batch.updatedAt;
    batch.run.lastError =
      error instanceof Error ? error.message : `Unknown ${phase} error.`;
    batch.schedule.lastRunAt = batch.updatedAt;
    batch.schedule.nextScheduledRunAt =
      batch.schedule.active && batch.schedule.rerunEnabled
        ? calculateNextScheduledRunAt(batch.updatedAt, batch.schedule.intervalHours)
        : null;
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
  }

  private async reconcileInterruptedBatches(): Promise<void> {
    const batches = await this.repository.listBatches();
    const reconciledAt = new Date().toISOString();

    for (const batch of batches) {
      if (!["PARSING", "RUNNING"].includes(batch.status)) {
        continue;
      }

      batch.status = "FAILED";
      batch.updatedAt = reconciledAt;

      if (batch.status === "FAILED" && batch.run.requestedAt) {
        batch.run.completedAt = reconciledAt;
        batch.run.lastError =
          batch.run.lastError ?? "Backend restarted while batch execution was in progress.";
      }

      if (batch.parse.requestedAt && !batch.parse.completedAt) {
        batch.parse.completedAt = reconciledAt;
        batch.parse.lastError =
          batch.parse.lastError ?? "Backend restarted while parsing was in progress.";
      }

      batch.patientRuns = batch.patientRuns.map((patientRun) =>
        isTransientPatientStatus(patientRun.processingStatus)
          ? {
              ...patientRun,
              processingStatus: "FAILED",
              executionStep: "FAILED",
              progressPercent: 100,
              completedAt: reconciledAt,
              lastUpdatedAt: reconciledAt,
              retryEligible: true,
              errorSummary:
                patientRun.errorSummary ??
                "Backend restarted while this patient run was in progress.",
            }
          : patientRun,
      );

      batch.schedule.lastRunAt = reconciledAt;
      batch.schedule.nextScheduledRunAt =
        batch.schedule.active && batch.schedule.rerunEnabled
          ? calculateNextScheduledRunAt(reconciledAt, batch.schedule.intervalHours)
          : null;

      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
    }
  }

  private ensureScheduler(): void {
    if (this.rerunTimer) {
      return;
    }

    this.rerunTimer = setInterval(() => {
      void this.triggerDueScheduledRuns();
    }, SCHEDULE_POLL_INTERVAL_MS);
    this.rerunTimer.unref?.();
  }

  private async triggerDueScheduledRuns(): Promise<void> {
    const now = Date.now();
    const schedules = await this.scheduledRunRepository.listScheduledRuns();

    for (const schedule of schedules) {
      if (
        !schedule.active ||
        !schedule.rerunEnabled ||
        !schedule.nextScheduledRunAt ||
        this.activeBatchJobs.has(schedule.batchId) ||
        Date.parse(schedule.nextScheduledRunAt) > now
      ) {
        continue;
      }

      const batch = await this.repository.getBatch(schedule.batchId);
      if (!batch) {
        schedule.active = false;
        schedule.rerunEnabled = false;
        schedule.nextScheduledRunAt = null;
        schedule.updatedAt = new Date().toISOString();
        await this.scheduledRunRepository.saveScheduledRun(schedule);
        continue;
      }

      if (!(await this.repository.fileExists(batch.sourceWorkbook.storedPath))) {
        batch.updatedAt = new Date().toISOString();
        batch.schedule.active = false;
        batch.schedule.rerunEnabled = false;
        batch.schedule.nextScheduledRunAt = null;
        batch.run.lastError =
          batch.run.lastError ?? "Workbook source file is no longer available for scheduled rerun.";
        await this.repository.saveBatch(batch);
        await this.syncScheduledRunForBatch(batch);
        this.logger.warn(
          { batchId: batch.id, subsidiaryId: batch.subsidiary.id },
          "scheduled rerun disabled because workbook file is missing",
        );
        continue;
      }

      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          scheduledRunId: schedule.id,
          scheduledFor: schedule.nextScheduledRunAt,
        },
        "scheduled batch rerun started",
      );
      await this.startBatchRun(batch.id);
    }
  }

  private async deactivateOtherActiveSchedules(
    currentBatchId: string,
    subsidiaryId: string,
    updatedAt: string,
  ): Promise<void> {
    const batches = await this.repository.listBatches();

    for (const batch of batches) {
      if (
        batch.id === currentBatchId ||
        batch.subsidiary.id !== subsidiaryId ||
        !batch.schedule.active
      ) {
        continue;
      }

      batch.updatedAt = updatedAt;
      batch.schedule.active = false;
      batch.schedule.rerunEnabled = false;
      batch.schedule.nextScheduledRunAt = null;
      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          replacedByBatchId: currentBatchId,
        },
        "deactivated older workbook rerun schedule",
      );
    }
  }

  private async createOrRefreshScheduledRun(
    batch: BatchRecord,
    subsidiary: SubsidiaryRecord,
    updatedAt: string,
  ): Promise<ScheduledRunRecord> {
    const schedule: ScheduledRunRecord = {
      id: batch.schedule.scheduledRunId ?? `schedule-${batch.id}`,
      subsidiaryId: subsidiary.id,
      batchId: batch.id,
      workbookPath: batch.sourceWorkbook.storedPath,
      originalFileName: batch.sourceWorkbook.originalFileName,
      active: batch.schedule.active,
      rerunEnabled: batch.schedule.rerunEnabled,
      intervalHours: batch.schedule.intervalHours,
      timezone: subsidiary.timezone,
      lastRunAt: batch.schedule.lastRunAt,
      nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
      createdAt: batch.createdAt,
      updatedAt,
    };
    const existing = await this.scheduledRunRepository.getScheduledRun(schedule.id);
    if (existing) {
      schedule.createdAt = existing.createdAt;
    }
    await this.scheduledRunRepository.saveScheduledRun(schedule);
    return schedule;
  }

  private async syncScheduledRunForBatch(batch: BatchRecord): Promise<void> {
    if (!batch.schedule.scheduledRunId) {
      return;
    }

    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(batch.subsidiary.id);
    await this.createOrRefreshScheduledRun(
      batch,
      subsidiary,
      batch.updatedAt,
    );
  }

  private async mustGetBatch(batchId: string): Promise<BatchRecord> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    return batch;
  }
}
