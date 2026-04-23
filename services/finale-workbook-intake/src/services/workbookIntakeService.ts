import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino, { type Logger } from "pino";
import type {
  BatchManifest,
  PatientQueueArtifact,
  ParserException,
  PatientEpisodeWorkItem,
  ReviewWindow,
  WorkbookAcquisitionMetadata,
  WorkbookSource,
  WorkbookSourceKind,
  WorkbookVerification,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { aggregatePatientEpisodes } from "../mappers/patientEpisodeAggregator";
import { mapDcTransferRow } from "../mappers/dcTransferMapper";
import { mapDizRow } from "../mappers/dizMapper";
import { mapSocPocRow } from "../mappers/socPocMapper";
import { mapVisitNotesRow } from "../mappers/visitNotesMapper";
import { parseWorkbook } from "../parsers/workbookParser";
import { buildWorkbookQueue, createWorkbookSource } from "../queue-building/buildWorkbookQueue";
import { createReviewWindow } from "../workbook-intake/reviewWindow";

export interface WorkbookIntakeParams {
  batchId?: string;
  subsidiaryId?: string;
  workbookPath: string;
  outputDir?: string;
  logger?: Logger;
  ingestedAt?: string;
  workbookSourceKind?: WorkbookSourceKind;
  workbookOriginalFileName?: string | null;
  workbookAcquisitionMetadata?: WorkbookAcquisitionMetadata | null;
  workbookVerification?: WorkbookVerification | null;
  reviewWindowTimezone?: string;
}

export interface WorkbookIntakeResult {
  manifest: BatchManifest;
  workItems: PatientEpisodeWorkItem[];
  workbookSource: WorkbookSource;
  reviewWindow: ReviewWindow;
  patientQueue: PatientQueueArtifact;
  parserExceptions: ParserException[];
  diagnostics: ReturnType<typeof parseWorkbook>["diagnostics"];
  manifestPath: string;
  workItemsPath: string;
  normalizedPatientsPath: string;
  parserExceptionsPath: string;
  workbookSourcePath: string;
  reviewWindowPath: string;
  patientQueuePath: string;
}

function createLogger(): Logger {
  const env = loadEnv();
  return pino({
    name: "finale-workbook-intake",
    level: env.FINALE_LOG_LEVEL,
  });
}

function deriveBillingPeriod(workItems: PatientEpisodeWorkItem[]): string | null {
  const uniquePeriods = Array.from(
    new Set(
      workItems
        .map((item) => item.episodeContext.billingPeriod)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return uniquePeriods.length === 1 ? uniquePeriods[0] : null;
}

function createBatchManifest(input: {
  batchId: string;
  subsidiaryId: string;
  workbookPath: string;
  outputDirectory: string;
  workItems: PatientEpisodeWorkItem[];
  patientQueue: PatientQueueArtifact;
  parserExceptions: ParserException[];
}): BatchManifest {
  return {
    batchId: input.batchId,
    subsidiaryId: input.subsidiaryId,
    createdAt: new Date().toISOString(),
    status: "READY",
    workbookPath: input.workbookPath,
    outputDirectory: input.outputDirectory,
    billingPeriod: deriveBillingPeriod(input.workItems),
    totalWorkItems: input.workItems.length,
    parserExceptionCount: input.parserExceptions.length,
    automationEligibleWorkItemIds: input.patientQueue.entries
      .filter((entry) => entry.status === "eligible")
      .map((entry) => entry.workItemId),
    blockedWorkItemIds: input.patientQueue.entries
      .filter((entry) => entry.status !== "eligible")
      .map((entry) => entry.workItemId),
  };
}

export async function intakeWorkbook(
  params: WorkbookIntakeParams,
): Promise<WorkbookIntakeResult> {
  const env = loadEnv();
  const logger = params.logger ?? createLogger();
  const outputDirectory =
    params.outputDir ??
    env.FINALE_BATCH_OUTPUT_DIR ??
    path.resolve("artifacts", "finale-batch");

  await mkdir(outputDirectory, { recursive: true });

  logger.info({ workbookPath: params.workbookPath }, "loading workbook");
  const parsedWorkbook = parseWorkbook(params.workbookPath);
  logger.info(
    {
      workbookPath: parsedWorkbook.workbookPath,
      sheetNames: parsedWorkbook.sheetNames,
      sourceDetections: parsedWorkbook.diagnostics.sourceDetections,
      sheetSummaries: parsedWorkbook.diagnostics.sheetSummaries.map((summary) => ({
        sheetName: summary.sheetName,
        detectedSourceType: summary.detectedSourceType,
        rowCount: summary.rowCount,
        headerRowNumber: summary.headerRowNumber,
        headerMatchCount: summary.headerMatchCount,
        detectedHeaders: summary.detectedHeaders,
        extractedRowCount: summary.extractedRowCount,
        excludedRows: summary.excludedRows,
      })),
    },
    "parsed workbook structure",
  );

  const fragments = [
    ...parsedWorkbook.socPocRows.map(mapSocPocRow),
    ...parsedWorkbook.dcRows.map(mapDcTransferRow),
    ...parsedWorkbook.visitNotesRows.map(mapVisitNotesRow),
    ...parsedWorkbook.dizRows.map(mapDizRow),
  ];

  const aggregation = aggregatePatientEpisodes(fragments);
  const parserExceptions = [
    ...aggregation.parserExceptions,
    ...parsedWorkbook.warnings.map<ParserException>((warning, index) => ({
      id: `workbook-warning-${index + 1}`,
      code: "WORKBOOK_WARNING",
      message: warning,
      sourceSheet: "WORKBOOK",
      sourceRowNumber: 1,
      patientDisplayName: null,
      rawValues: {},
      createdAt: new Date().toISOString(),
    })),
  ];

  if (parserExceptions.length > 0) {
    logger.warn(
      {
        workbookPath: params.workbookPath,
        parserExceptions: parserExceptions.map((exception) => ({
          code: exception.code,
          message: exception.message,
          sourceSheet: exception.sourceSheet,
          sourceRowNumber: exception.sourceRowNumber,
          patientDisplayName: exception.patientDisplayName,
          rawValues: exception.rawValues,
        })),
      },
      "workbook intake parser exceptions detected",
    );
  }

  const batchId = params.batchId ?? `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const subsidiaryId = params.subsidiaryId ?? "default";
  const ingestedAt = params.ingestedAt ?? new Date().toISOString();
  const workItems = aggregation.workItems.map((workItem) => ({
    ...workItem,
    subsidiaryId,
  }));
  const workbookSource = createWorkbookSource({
    agencyId: subsidiaryId,
    batchId,
    workbookPath: params.workbookPath,
    originalFileName: params.workbookOriginalFileName ?? path.basename(params.workbookPath),
    acquiredAt: ingestedAt,
    ingestedAt,
    kind: params.workbookSourceKind,
    acquisition: params.workbookAcquisitionMetadata ?? null,
    verification: params.workbookVerification ?? null,
  });
  const reviewWindow = createReviewWindow({
    agencyId: subsidiaryId,
    startsAt: ingestedAt,
    timezone: params.reviewWindowTimezone ?? "Asia/Manila",
  });
  const patientQueue = buildWorkbookQueue({
    batchId,
    agencyId: subsidiaryId,
    generatedAt: ingestedAt,
    workItems,
    reviewWindow,
  });
  if (patientQueue.entries.length > 0) {
    logger.info(
      {
        batchId,
        subsidiaryId,
        queueDecisions: patientQueue.entries.map((entry) => ({
          patientName: entry.patientName,
          status: entry.status,
          rationale: entry.eligibility.rationale,
          matchedSignals: entry.eligibility.matchedSignals,
        })),
      },
      "workbook queue eligibility decisions recorded",
    );
  }
  const manifest = createBatchManifest({
    batchId,
    subsidiaryId,
    workbookPath: params.workbookPath,
    outputDirectory,
    workItems,
    patientQueue,
    parserExceptions,
  });

  const manifestPath = path.join(outputDirectory, "batch-manifest.json");
  const workItemsPath = path.join(outputDirectory, "work-items.json");
  const normalizedPatientsPath = path.join(outputDirectory, "normalized-patients.json");
  const parserExceptionsPath = path.join(outputDirectory, "parser-exceptions.json");
  const workbookSourcePath = path.join(outputDirectory, "workbook-source.json");
  const reviewWindowPath = path.join(outputDirectory, "review-window.json");
  const patientQueuePath = path.join(outputDirectory, "patient-queue.json");

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(workItemsPath, JSON.stringify(workItems, null, 2), "utf8");
  await writeFile(normalizedPatientsPath, JSON.stringify(workItems, null, 2), "utf8");
  await writeFile(parserExceptionsPath, JSON.stringify(parserExceptions, null, 2), "utf8");
  await writeFile(workbookSourcePath, JSON.stringify(workbookSource, null, 2), "utf8");
  await writeFile(reviewWindowPath, JSON.stringify(reviewWindow, null, 2), "utf8");
  await writeFile(patientQueuePath, JSON.stringify(patientQueue, null, 2), "utf8");

  logger.info(
    {
      batchId,
      subsidiaryId,
      workItems: workItems.length,
      eligibleQueueEntries: patientQueue.summary.eligible,
      skippedNonAdmit: patientQueue.summary.skippedNonAdmit,
      skippedPending: patientQueue.summary.skippedPending,
      excludedOther: patientQueue.summary.excludedOther,
      parserExceptions: parserExceptions.length,
    },
    "workbook intake completed",
  );

  return {
    manifest,
    workItems,
    workbookSource,
    reviewWindow,
    patientQueue,
    parserExceptions,
    diagnostics: parsedWorkbook.diagnostics,
    manifestPath,
    workItemsPath,
    normalizedPatientsPath,
    parserExceptionsPath,
    workbookSourcePath,
    reviewWindowPath,
    patientQueuePath,
  };
}

export async function normalizeWorkbookPatients(
  params: WorkbookIntakeParams,
): Promise<{
  manifest: BatchManifest;
  patients: PatientEpisodeWorkItem[];
  parserExceptions: ParserException[];
  normalizedPatientsPath: string;
}> {
  const result = await intakeWorkbook(params);

  return {
    manifest: result.manifest,
    patients: result.workItems,
    parserExceptions: result.parserExceptions,
    normalizedPatientsPath: result.normalizedPatientsPath,
  };
}
