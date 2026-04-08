import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino, { type Logger } from "pino";
import type {
  BatchManifest,
  ParserException,
  PatientEpisodeWorkItem,
} from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import { aggregatePatientEpisodes } from "../mappers/patientEpisodeAggregator";
import { mapDcTransferRow } from "../mappers/dcTransferMapper";
import { mapDizRow } from "../mappers/dizMapper";
import { mapSocPocRow } from "../mappers/socPocMapper";
import { mapVisitNotesRow } from "../mappers/visitNotesMapper";
import { parseWorkbook } from "../parsers/workbookParser";

export interface WorkbookIntakeParams {
  batchId?: string;
  subsidiaryId?: string;
  workbookPath: string;
  outputDir?: string;
  logger?: Logger;
}

export interface WorkbookIntakeResult {
  manifest: BatchManifest;
  workItems: PatientEpisodeWorkItem[];
  parserExceptions: ParserException[];
  diagnostics: ReturnType<typeof parseWorkbook>["diagnostics"];
  manifestPath: string;
  workItemsPath: string;
  normalizedPatientsPath: string;
  parserExceptionsPath: string;
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
    automationEligibleWorkItemIds: input.workItems.map((item) => item.id),
    blockedWorkItemIds: [],
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
  const workItems = aggregation.workItems.map((workItem) => ({
    ...workItem,
    subsidiaryId,
  }));
  const manifest = createBatchManifest({
    batchId,
    subsidiaryId,
    workbookPath: params.workbookPath,
    outputDirectory,
    workItems,
    parserExceptions,
  });

  const manifestPath = path.join(outputDirectory, "batch-manifest.json");
  const workItemsPath = path.join(outputDirectory, "work-items.json");
  const normalizedPatientsPath = path.join(outputDirectory, "normalized-patients.json");
  const parserExceptionsPath = path.join(outputDirectory, "parser-exceptions.json");

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(workItemsPath, JSON.stringify(workItems, null, 2), "utf8");
  await writeFile(normalizedPatientsPath, JSON.stringify(workItems, null, 2), "utf8");
  await writeFile(parserExceptionsPath, JSON.stringify(parserExceptions, null, 2), "utf8");

  logger.info(
    {
      batchId,
      subsidiaryId,
      workItems: workItems.length,
      parserExceptions: parserExceptions.length,
    },
    "workbook intake completed",
  );

  return {
    manifest,
    workItems,
    parserExceptions,
    diagnostics: parsedWorkbook.diagnostics,
    manifestPath,
    workItemsPath,
    normalizedPatientsPath,
    parserExceptionsPath,
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
