import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AgencyDashboardSnapshot,
  Agency,
  BatchManifest,
  BatchSummary,
  DashboardPatientRecord,
  ParserException,
  PatientQueueArtifact,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientRunLog,
  PatientRun,
  ReviewWindow,
  SubsidiaryRecord,
  WorkbookSource,
} from "@medical-ai-qa/shared-types";
import {
  buildOasisQaSummary,
  createBatchSummary,
  createReviewWindow,
  createDefaultWorkflowRuns,
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
import { isWorkbookRotationDue } from "../utils/workbookRotation";
import type { SubsidiaryConfigService } from "./subsidiaryConfigService";

const DEFAULT_RERUN_INTERVAL_HOURS = 24;
const SCHEDULE_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REFRESH_TIMEZONE = "Asia/Manila";
const DEFAULT_REFRESH_LOCAL_TIMES = ["15:00", "23:30"] as const;

function createBatchId(subsidiarySlug?: string): string {
  const slugPrefix = subsidiarySlug?.trim() ? `${subsidiarySlug.trim()}-` : "";
  return `batch-${slugPrefix}${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
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

async function canReuseCompletedPatientRun(
  repository: FilesystemBatchRepository,
  patientRun: BatchRecord["patientRuns"][number] | undefined,
): Promise<boolean> {
  if (!patientRun || patientRun.processingStatus !== "COMPLETE" || !patientRun.bundleAvailable) {
    return false;
  }

  return repository.fileExists(patientRun.resultBundlePath);
}

function createPendingPatientRunState(
  batch: BatchRecord,
  workItem: PatientEpisodeWorkItem,
  previous?: BatchRecord["patientRuns"][number],
): BatchRecord["patientRuns"][number] {
  const runId = createRunId(batch.id, workItem.id);
  const resultBundlePath = path.join(
    batch.storage.patientResultsDirectory,
    `${workItem.id}.json`,
  );

  return {
    runId,
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
    workflowRuns: createDefaultWorkflowRuns(runId, batch.updatedAt),
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
    workflowRuns: patientRun.workflowRuns,
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
    timezone: subsidiary.timezone || DEFAULT_REFRESH_TIMEZONE,
    localTimes: [...DEFAULT_REFRESH_LOCAL_TIMES],
    lastRunAt: null,
    nextScheduledRunAt: subsidiary.rerunEnabled
      ? calculateNextScheduledRunAt(
          now,
          subsidiary.timezone || DEFAULT_REFRESH_TIMEZONE,
          [...DEFAULT_REFRESH_LOCAL_TIMES],
          subsidiary.rerunIntervalHours || DEFAULT_RERUN_INTERVAL_HOURS,
        )
      : null,
  };
}

function formatManilaDateParts(value: Date): { year: number; month: number; day: number } {
  const manila = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: manila.getUTCFullYear(),
    month: manila.getUTCMonth() + 1,
    day: manila.getUTCDate(),
  };
}

function buildManilaUtcCandidate(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 8, parts.minute, 0, 0));
}

function calculateNextFixedScheduleAt(fromIsoTimestamp: string, localTimes: readonly string[]): string {
  const from = new Date(fromIsoTimestamp);
  const base = formatManilaDateParts(from);

  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const candidateDate = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset, 0, 0, 0, 0));
    const dateParts = {
      year: candidateDate.getUTCFullYear(),
      month: candidateDate.getUTCMonth() + 1,
      day: candidateDate.getUTCDate(),
    };

    const candidates = [...localTimes]
      .map((localTime) => {
        const [hourText, minuteText] = localTime.split(":");
        return buildManilaUtcCandidate({
          ...dateParts,
          hour: Number(hourText),
          minute: Number(minuteText),
        });
      })
      .sort((left, right) => left.getTime() - right.getTime());

    const nextCandidate = candidates.find((candidate) => candidate.getTime() > from.getTime());
    if (nextCandidate) {
      return nextCandidate.toISOString();
    }
  }

  return new Date(Date.parse(fromIsoTimestamp) + 24 * 60 * 60 * 1000).toISOString();
}

function calculateNextScheduledRunAt(
  fromIsoTimestamp: string,
  timezone: string,
  localTimes: readonly string[],
  intervalHours: number,
): string {
  if (timezone === DEFAULT_REFRESH_TIMEZONE && localTimes.length > 0) {
    return calculateNextFixedScheduleAt(fromIsoTimestamp, localTimes);
  }

  return new Date(Date.parse(fromIsoTimestamp) + intervalHours * 60 * 60 * 1000).toISOString();
}

function mapWorkbookSourceKind(providerId: WorkbookAcquisitionProviderId): WorkbookSource["kind"] {
  switch (providerId) {
    case "MANUAL_UPLOAD":
      return "manual_upload";
    case "FINALE":
      return "finale_download";
    default:
      return "unknown";
  }
}

function createFallbackWorkbookSource(batch: BatchRecord): WorkbookSource {
  return {
    agencyId: batch.subsidiary.id,
    batchId: batch.id,
    kind: mapWorkbookSourceKind(batch.sourceWorkbook.acquisitionProvider),
    path: batch.sourceWorkbook.storedPath,
    originalFileName: batch.sourceWorkbook.originalFileName,
    sourceLabel: batch.sourceWorkbook.originalFileName,
    acquiredAt: batch.sourceWorkbook.uploadedAt,
    ingestedAt: batch.sourceWorkbook.uploadedAt,
    acquisition: batch.sourceWorkbook.acquisitionMetadata ?? {
      providerId: batch.sourceWorkbook.acquisitionProvider,
      acquisitionReference: batch.sourceWorkbook.acquisitionReference,
      metadataPath: batch.sourceWorkbook.acquisitionReference,
      selectedAgencyName: null,
      selectedAgencyUrl: null,
      dashboardUrl: null,
      notes: batch.sourceWorkbook.acquisitionNotes,
    },
    verification: batch.sourceWorkbook.verification,
  };
}

function filterEligibleWorkItems(
  workItems: PatientEpisodeWorkItem[],
  manifest: BatchManifest,
): PatientEpisodeWorkItem[] {
  const eligibleIds = new Set(manifest.automationEligibleWorkItemIds);
  return workItems.filter((workItem) => eligibleIds.has(workItem.id));
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
    await this.ensureAutonomousAgencyBatches();
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
    const batchId = createBatchId(subsidiary.slug);
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
        acquisitionMetadata: null,
        originalFileName: fileName,
        storedPath: paths.sourceWorkbookPath,
        uploadedAt: now,
        verification: null,
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
      batch.sourceWorkbook.acquisitionMetadata = acquisition.acquisitionMetadata ?? null;
      batch.sourceWorkbook.originalFileName = acquisition.originalFileName;
      batch.sourceWorkbook.storedPath = acquisition.storedPath;
      batch.sourceWorkbook.uploadedAt = acquisition.acquiredAt;
      batch.sourceWorkbook.verification = acquisition.verification ?? null;
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
      batch.sourceWorkbook.acquisitionMetadata = null;
      batch.sourceWorkbook.acquisitionNotes = [
        error instanceof Error ? error.message : "Unknown workbook acquisition error.",
      ];
      batch.sourceWorkbook.verification = null;
      batch.parse.lastError =
        error instanceof Error ? error.message : "Unknown workbook acquisition error.";
      await this.repository.saveBatch(batch);
      throw error;
    }
  }

  async listBatches(): Promise<BatchRecord[]> {
    return this.repository.listBatches();
  }

  async listAgencies(): Promise<Agency[]> {
    const subsidiaries = await this.subsidiaryConfigService.listSubsidiaries();
    return subsidiaries.map((subsidiary) => ({
      id: subsidiary.id,
      slug: subsidiary.slug,
      name: subsidiary.name,
      status: subsidiary.status,
      timezone: subsidiary.timezone,
    }));
  }

  async triggerAgencyRefresh(agencyId: string): Promise<BatchRecord> {
    const subsidiary = await this.subsidiaryConfigService.getSubsidiaryConfig(agencyId);
    const batches = await this.repository.listBatches();
    const activeBatch = batches.find((batch) =>
      batch.subsidiary.id === agencyId && this.activeBatchJobs.has(batch.id),
    );
    if (activeBatch) {
      throw new Error(`Agency refresh already running for ${subsidiary.name}.`);
    }

    const exportName = `${subsidiary.slug}-oasis-30-days.xlsx`;
    const batch = await this.createBatchFromProvider({
      providerId: "FINALE",
      subsidiaryId: subsidiary.id,
      originalFileName: exportName,
      input: {
        exportName,
      },
    });

    await this.parseBatch(batch.id);
    return this.startBatchRun(batch.id);
  }

  private async ensureAutonomousAgencyBatches(): Promise<void> {
    const subsidiaries = await this.subsidiaryConfigService.listSubsidiaries();
    const batches = await this.repository.listBatches();

    for (const subsidiary of subsidiaries) {
      if (subsidiary.status !== "ACTIVE") {
        continue;
      }

      const activeAgencyBatch = batches.find((batch) =>
        batch.subsidiary.id === subsidiary.id &&
        batch.schedule.active &&
        batch.sourceWorkbook.acquisitionProvider === "FINALE" &&
        batch.sourceWorkbook.acquisitionStatus === "ACQUIRED"
      );
      if (activeAgencyBatch) {
        continue;
      }

      try {
        const batch = await this.createBatchFromProvider({
          providerId: "FINALE",
          subsidiaryId: subsidiary.id,
          originalFileName: `${subsidiary.slug}-oasis-30-days.xlsx`,
          input: {
            exportName: `${subsidiary.slug}-oasis-30-days.xlsx`,
          },
        });
        await this.parseBatch(batch.id);
        await this.startBatchRun(batch.id);
        this.logger.info(
          {
            batchId: batch.id,
            subsidiaryId: subsidiary.id,
            subsidiarySlug: subsidiary.slug,
          },
          "initialized autonomous Finale workbook batch for active agency",
        );
      } catch (error) {
        this.logger.error(
          {
            subsidiaryId: subsidiary.id,
            subsidiarySlug: subsidiary.slug,
            errorMessage:
              error instanceof Error ? error.message : "Unknown autonomous workbook bootstrap error.",
          },
          "failed to initialize autonomous Finale workbook batch for active agency",
        );
      }
    }
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
        ingestedAt: batch.sourceWorkbook.uploadedAt,
        workbookOriginalFileName: batch.sourceWorkbook.originalFileName,
        workbookSourceKind: mapWorkbookSourceKind(batch.sourceWorkbook.acquisitionProvider),
        workbookAcquisitionMetadata: batch.sourceWorkbook.acquisitionMetadata ?? {
          providerId: batch.sourceWorkbook.acquisitionProvider,
          acquisitionReference: batch.sourceWorkbook.acquisitionReference,
          metadataPath: batch.sourceWorkbook.acquisitionReference,
          selectedAgencyName: null,
          selectedAgencyUrl: null,
          dashboardUrl: null,
          notes: batch.sourceWorkbook.acquisitionNotes,
        },
        workbookVerification: batch.sourceWorkbook.verification,
        reviewWindowTimezone: batch.schedule.timezone,
      });
      const eligibleWorkItemIds = new Set(
        result.patientQueue.entries
          .filter((entry) => entry.status === "eligible")
          .map((entry) => entry.workItemId),
      );
      const eligibleWorkItems = result.workItems.filter((workItem) => eligibleWorkItemIds.has(workItem.id));

      batch.status = "READY";
      batch.updatedAt = new Date().toISOString();
      batch.billingPeriod = result.manifest.billingPeriod ?? batch.billingPeriod;
      batch.storage.manifestPath = result.manifestPath;
      batch.storage.workItemsPath = result.workItemsPath;
      batch.storage.parserExceptionsPath = result.parserExceptionsPath;
      batch.storage.batchSummaryPath = null;
      batch.parse.completedAt = batch.updatedAt;
      batch.parse.workItemCount = result.workItems.length;
      batch.parse.eligibleWorkItemCount = result.patientQueue.summary.eligible;
      batch.parse.parserExceptionCount = result.parserExceptions.length;
      batch.parse.sourceDetections = result.diagnostics.sourceDetections;
      batch.parse.sheetSummaries = result.diagnostics.sheetSummaries;
      batch.parse.lastError = null;
      batch.run.requestedAt = null;
      batch.run.completedAt = null;
      batch.run.patientRunCount = 0;
      batch.run.lastError = null;
      batch.patientRuns = eligibleWorkItems.map((workItem) =>
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

    const manifest = await this.repository.readManifest(batch);
    const workItems = filterEligibleWorkItems(await this.repository.readWorkItems(batch), manifest);
    const plannedRuns = await Promise.all(
      workItems.map(async (workItem) => {
        const previous = batch.patientRuns.find((patientRun) => patientRun.workItemId === workItem.id);
        const reuseExisting = await canReuseCompletedPatientRun(this.repository, previous);
        return {
          workItem,
          patientRun: reuseExisting && previous ? previous : createPendingPatientRunState(batch, workItem, previous),
          reuseExisting,
        };
      }),
    );

    const workItemsToRun = plannedRuns
      .filter((plannedRun) => !plannedRun.reuseExisting)
      .map((plannedRun) => plannedRun.workItem);

    batch.patientRuns = plannedRuns.map((plannedRun) => plannedRun.patientRun);
    batch.status = "RUNNING";
    batch.updatedAt = new Date().toISOString();
    batch.run.requestedAt = batch.updatedAt;
    batch.run.completedAt = null;
    batch.run.lastError = null;
    batch.run.patientRunCount = 0;
    await this.repository.saveBatch(batch);

    if (workItemsToRun.length === 0) {
      batch.status = "COMPLETED";
      batch.updatedAt = new Date().toISOString();
      batch.run.completedAt = batch.updatedAt;
      batch.run.patientRunCount = countProcessedPatientRuns(batch);
      batch.run.lastError = deriveBatchErrorSummary(batch);
      batch.schedule.lastRunAt = batch.updatedAt;
      batch.schedule.nextScheduledRunAt =
        batch.schedule.active && batch.schedule.rerunEnabled
          ? calculateNextScheduledRunAt(
              batch.updatedAt,
              batch.schedule.timezone,
              batch.schedule.localTimes,
              batch.schedule.intervalHours,
            )
          : null;
      await this.repository.saveBatch(batch);
      await this.syncScheduledRunForBatch(batch);
      this.logger.info(
        {
          batchId: batch.id,
          subsidiaryId: batch.subsidiary.id,
          reusedPatients: plannedRuns.length,
        },
        "scheduled batch run skipped because existing patient bundles were reused",
      );
      return batch;
    }

    const task = this.executeBatchRun(batchId, workItemsToRun).finally(() => {
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
      kind:
        | "bundle"
        | "log"
        | "failure_trace"
        | "failure_screenshot"
        | "download"
        | "evidence"
        | "workflow_result"
        | "workflow_log";
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
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download" | "evidence" | "workflow_result" | "workflow_log";
      name: string;
      path: string;
      exists: boolean;
      modifiedAt: string | null;
      sizeBytes: number | null;
    }> = [];

    const pushFileArtifact = async (
      kind: "bundle" | "log" | "failure_trace" | "failure_screenshot" | "download" | "workflow_result" | "workflow_log",
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
    for (const workflowRun of patient.summary.workflowRuns) {
      if (workflowRun.workflowResultPath && workflowRun.workflowResultPath !== patient.summary.resultBundlePath) {
        await pushFileArtifact("workflow_result", workflowRun.workflowResultPath);
      }
      if (workflowRun.workflowLogPath && workflowRun.workflowLogPath !== patient.summary.logPath) {
        await pushFileArtifact("workflow_log", workflowRun.workflowLogPath);
      }
    }

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
      qaPrefetch: string | null;
      patientQaReference: string;
      qaDocumentSummary: string;
      fieldMapSnapshot: string;
    };
    artifactContents: {
      codingInput: unknown | null;
      documentText: unknown | null;
      qaPrefetch: unknown | null;
      patientQaReference: unknown | null;
      qaDocumentSummary: unknown | null;
      fieldMapSnapshot: unknown | null;
    };
  } | null> {
    const patient = await this.getBatchPatient(batchId, patientId);
    if (!patient) {
      return null;
    }

    const workItem = await this.getBatchWorkItem(batchId, patientId);
    const patientArtifactsDirectory = path.join(patient.batch.storage.outputRoot, "patients", patientId);
    const qaWorkflowRun = patient.summary.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa");
    const qaPrefetchPathCandidates = Array.from(
      new Set(
        [
          qaWorkflowRun?.workflowResultPath ?? null,
          path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
        ].filter((candidate): candidate is string => Boolean(candidate)),
      ),
    );
    let qaPrefetchPath: string | null = null;
    for (const candidate of qaPrefetchPathCandidates) {
      if (await this.repository.fileExists(candidate)) {
        qaPrefetchPath = candidate;
        break;
      }
    }
    if (!qaPrefetchPath) {
      qaPrefetchPath = qaPrefetchPathCandidates[0] ?? null;
    }
    const artifactPaths = {
      codingInput: path.join(patientArtifactsDirectory, "coding-input.json"),
      documentText: path.join(patientArtifactsDirectory, "document-text.json"),
      qaPrefetch: qaPrefetchPath,
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
        qaPrefetch: artifactPaths.qaPrefetch
          ? await this.repository.readJsonIfExists(artifactPaths.qaPrefetch)
          : null,
        patientQaReference: await this.repository.readJsonIfExists(artifactPaths.patientQaReference),
        qaDocumentSummary: await this.repository.readJsonIfExists(artifactPaths.qaDocumentSummary),
        fieldMapSnapshot: await this.repository.readJsonIfExists(artifactPaths.fieldMapSnapshot),
      },
    };
  }

  async getAgencyDashboardSnapshot(agencyId: string): Promise<AgencyDashboardSnapshot> {
    const agencyRecord = await this.subsidiaryConfigService.getSubsidiaryConfig(agencyId);
    const agency: Agency = {
      id: agencyRecord.id,
      slug: agencyRecord.slug,
      name: agencyRecord.name,
      status: agencyRecord.status,
      timezone: agencyRecord.timezone,
    };
    const batches = (await this.repository.listBatches())
      .filter((batch) => batch.subsidiary.id === agencyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const batch = batches.find((candidate) => candidate.schedule.active) ?? batches[0] ?? null;

    if (!batch) {
      return {
        agency,
        refreshCycle: null,
        queueEntries: [],
        patientRecords: [],
        lastUpdatedAt: new Date().toISOString(),
      };
    }

    const outputRoot = batch.storage.outputRoot;
    const workbookSource = await this.repository.readJsonIfExists<WorkbookSource>(
      path.join(outputRoot, "workbook-source.json"),
    );
    const reviewWindow = await this.repository.readJsonIfExists<ReviewWindow>(
      path.join(outputRoot, "review-window.json"),
    );
    const patientQueue = await this.repository.readJsonIfExists<PatientQueueArtifact>(
      path.join(outputRoot, "patient-queue.json"),
    );
    const queueEntries = patientQueue?.entries ?? [];
    const patientRecords: DashboardPatientRecord[] = queueEntries.map((queueEntry) => {
      const patientRun = batch.patientRuns.find((candidate) => candidate.workItemId === queueEntry.workItemId);
      return {
        queueEntry,
        runId: patientRun ? batch.id : null,
        patientId: patientRun?.workItemId ?? null,
        processingStatus: patientRun?.processingStatus ?? null,
        lastUpdatedAt: patientRun?.lastUpdatedAt ?? null,
        errorSummary: patientRun?.errorSummary ?? null,
      };
    });
    const resolvedWorkbookSource: WorkbookSource = workbookSource
      ? {
          ...workbookSource,
          acquisition: workbookSource.acquisition ?? {
            providerId: batch.sourceWorkbook.acquisitionProvider,
            acquisitionReference: batch.sourceWorkbook.acquisitionReference,
            metadataPath: batch.sourceWorkbook.acquisitionReference,
            selectedAgencyName: batch.sourceWorkbook.acquisitionMetadata?.selectedAgencyName ?? null,
            selectedAgencyUrl: batch.sourceWorkbook.acquisitionMetadata?.selectedAgencyUrl ?? null,
            dashboardUrl: batch.sourceWorkbook.acquisitionMetadata?.dashboardUrl ?? null,
            notes: batch.sourceWorkbook.acquisitionNotes,
          },
          verification: workbookSource.verification ?? batch.sourceWorkbook.verification,
        }
      : createFallbackWorkbookSource(batch);
    const resolvedReviewWindow =
      reviewWindow ??
      createReviewWindow({
        agencyId: agency.id,
        startsAt: batch.sourceWorkbook.uploadedAt,
        timezone: batch.schedule.timezone,
      });

    return {
      agency,
      refreshCycle: {
        id: batch.schedule.scheduledRunId ?? `refresh-${batch.id}`,
        agencyId: agency.id,
        batchId: batch.id,
        status:
          batch.status === "FAILED"
            ? "failed"
            : batch.status === "RUNNING"
              ? "running"
              : batch.status === "CREATED" || batch.status === "PARSING"
                ? "pending"
                : "completed",
        workbookSource: resolvedWorkbookSource,
        reviewWindow: resolvedReviewWindow,
        scheduleTimezone: batch.schedule.timezone,
        scheduleLocalTimes: batch.schedule.localTimes,
        lastRefreshStartedAt: batch.run.requestedAt,
        lastRefreshCompletedAt: batch.run.completedAt,
        nextRefreshAt: batch.schedule.nextScheduledRunAt,
        queueSummary: patientQueue?.summary ?? {
          total: 0,
          eligible: 0,
          skippedNonAdmit: 0,
          skippedPending: 0,
          excludedOther: 0,
        },
      },
      queueEntries,
      patientRecords,
      lastUpdatedAt: batch.updatedAt,
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

  private async executeBatchRun(
    batchId: string,
    workItemsOverride?: PatientEpisodeWorkItem[],
  ): Promise<void> {
    const batch = await this.mustGetBatch(batchId);
    const manifest = await this.repository.readManifest(batch);
    const parserExceptions = await this.repository.readParserExceptions(batch);
    const workItems =
      workItemsOverride ??
      filterEligibleWorkItems(await this.repository.readWorkItems(batch), manifest);
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
        ? calculateNextScheduledRunAt(
            completedAt,
            batch.schedule.timezone,
            batch.schedule.localTimes,
            batch.schedule.intervalHours,
          )
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
        ? calculateNextScheduledRunAt(
            batch.updatedAt,
            batch.schedule.timezone,
            batch.schedule.localTimes,
            batch.schedule.intervalHours,
          )
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
          ? calculateNextScheduledRunAt(
              reconciledAt,
              batch.schedule.timezone,
              batch.schedule.localTimes,
              batch.schedule.intervalHours,
            )
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
    const nowIso = new Date(now).toISOString();
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

      try {
        const workbookMissing = !(await this.repository.fileExists(batch.sourceWorkbook.storedPath));
        const rotationDue =
          batch.sourceWorkbook.acquisitionProvider === "FINALE" &&
          isWorkbookRotationDue(batch.sourceWorkbook.uploadedAt, nowIso);

        if (workbookMissing && batch.sourceWorkbook.acquisitionProvider !== "FINALE") {
          batch.updatedAt = nowIso;
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

        if (batch.sourceWorkbook.acquisitionProvider === "FINALE" && (workbookMissing || rotationDue)) {
          await this.reacquireFinaleWorkbook(batch, nowIso, workbookMissing ? "missing" : "rotation_due");
          await this.parseBatch(batch.id);
        }

        this.logger.info(
          {
            batchId: batch.id,
            subsidiaryId: batch.subsidiary.id,
            scheduledRunId: schedule.id,
            scheduledFor: schedule.nextScheduledRunAt,
            workbookRotationDue: rotationDue,
            workbookMissing,
          },
          "scheduled batch rerun started",
        );
        await this.startBatchRun(batch.id);
      } catch (error) {
        await this.markScheduledRefreshFailure(batch, error, nowIso);
        this.logger.error(
          {
            batchId: batch.id,
            subsidiaryId: batch.subsidiary.id,
            scheduledRunId: schedule.id,
            errorMessage: error instanceof Error ? error.message : "Unknown scheduled refresh error.",
          },
          "scheduled batch refresh failed",
        );
      }
    }
  }

  private async reacquireFinaleWorkbook(
    batch: BatchRecord,
    _triggeredAt: string,
    reason: "missing" | "rotation_due",
  ): Promise<void> {
    const acquisition = await this.acquisitionService.acquireWorkbook({
      batch,
      billingPeriod: batch.billingPeriod,
      providerId: "FINALE",
      input: {
        exportName: batch.sourceWorkbook.originalFileName,
      },
    });

    batch.updatedAt = acquisition.acquiredAt;
    batch.status = "CREATED";
    batch.sourceWorkbook.acquisitionStatus = "ACQUIRED";
    batch.sourceWorkbook.acquisitionReference = acquisition.acquisitionReference;
    batch.sourceWorkbook.acquisitionNotes = acquisition.notes;
    batch.sourceWorkbook.acquisitionMetadata = acquisition.acquisitionMetadata ?? null;
    batch.sourceWorkbook.originalFileName = acquisition.originalFileName;
    batch.sourceWorkbook.storedPath = acquisition.storedPath;
    batch.sourceWorkbook.uploadedAt = acquisition.acquiredAt;
    batch.sourceWorkbook.verification = acquisition.verification ?? null;
    batch.parse.requestedAt = null;
    batch.parse.completedAt = null;
    batch.parse.lastError = null;
    batch.run.requestedAt = null;
    batch.run.completedAt = null;
    batch.run.lastError = null;
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);

    this.logger.info(
      {
        batchId: batch.id,
        subsidiaryId: batch.subsidiary.id,
        acquisitionReference: acquisition.acquisitionReference,
        originalFileName: acquisition.originalFileName,
        reason,
      },
      "reacquired Finale workbook for scheduled refresh",
    );
  }

  private async markScheduledRefreshFailure(
    batch: BatchRecord,
    error: unknown,
    updatedAt: string,
  ): Promise<void> {
    batch.status = "FAILED";
    batch.updatedAt = updatedAt;
    batch.sourceWorkbook.acquisitionStatus =
      batch.sourceWorkbook.acquisitionProvider === "FINALE" ? "FAILED" : batch.sourceWorkbook.acquisitionStatus;
    batch.sourceWorkbook.acquisitionMetadata =
      batch.sourceWorkbook.acquisitionProvider === "FINALE" ? null : batch.sourceWorkbook.acquisitionMetadata;
    batch.sourceWorkbook.acquisitionNotes = [
      error instanceof Error ? error.message : "Unknown scheduled refresh error.",
    ];
    batch.sourceWorkbook.verification =
      batch.sourceWorkbook.acquisitionProvider === "FINALE" ? null : batch.sourceWorkbook.verification;
    batch.run.completedAt = updatedAt;
    batch.run.lastError =
      error instanceof Error ? error.message : "Unknown scheduled refresh error.";
    batch.schedule.lastRunAt = updatedAt;
    batch.schedule.nextScheduledRunAt =
      batch.schedule.active && batch.schedule.rerunEnabled
        ? calculateNextScheduledRunAt(
            updatedAt,
            batch.schedule.timezone,
            batch.schedule.localTimes,
            batch.schedule.intervalHours,
          )
        : null;
    await this.repository.saveBatch(batch);
    await this.syncScheduledRunForBatch(batch);
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
      timezone: batch.schedule.timezone || subsidiary.timezone,
      localTimes: batch.schedule.localTimes,
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
