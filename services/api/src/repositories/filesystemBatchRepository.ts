import { access, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
  BatchManifest,
  BatchSummary,
  ParserException,
  PatientEpisodeWorkItem,
  PatientRunLog,
  PatientRun,
} from "@medical-ai-qa/shared-types";
import { batchRecordSchema, type BatchRecord } from "../types/batchControlPlane";
import { readJsonFile, writeJsonFile } from "../utils/jsonFile";

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export class FilesystemBatchRepository {
  constructor(private readonly storageRoot: string) {}

  private get batchesRoot(): string {
    return path.join(this.storageRoot, "batches");
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    await mkdir(this.batchesRoot, { recursive: true });
  }

  createBatchPaths(batchId: string, originalFileName: string, agencySlug?: string): {
    batchRoot: string;
    sourceWorkbookPath: string;
    outputRoot: string;
    metadataPath: string;
    patientResultsDirectory: string;
    evidenceDirectory: string;
  } {
    const batchRoot = agencySlug?.trim()
      ? path.join(this.storageRoot, "batches", sanitizeFileName(agencySlug), batchId)
      : path.join(this.storageRoot, "batches", batchId);
    return {
      batchRoot,
      sourceWorkbookPath: path.join(batchRoot, "source", sanitizeFileName(originalFileName)),
      outputRoot: path.join(batchRoot, "outputs"),
      metadataPath: path.join(batchRoot, "batch.json"),
      patientResultsDirectory: path.join(batchRoot, "outputs", "patient-results"),
      evidenceDirectory: path.join(batchRoot, "outputs", "evidence"),
    };
  }

  async saveBatch(batch: BatchRecord): Promise<void> {
    const parsed = batchRecordSchema.parse(batch);
    const metadataPath = path.join(parsed.storage.batchRoot, "batch.json");
    await writeJsonFile(metadataPath, parsed);
  }

  async getBatch(batchId: string): Promise<BatchRecord | null> {
    const batchDirectory = await this.findBatchDirectory(batchId);
    if (!batchDirectory) {
      return null;
    }

    const metadataPath = path.join(batchDirectory, "batch.json");

    try {
      const batch = await readJsonFile<BatchRecord>(metadataPath);
      return batchRecordSchema.parse(batch);
    } catch {
      return null;
    }
  }

  async listBatches(): Promise<BatchRecord[]> {
    await mkdir(this.batchesRoot, { recursive: true });
    const batchDirectories = await this.listBatchDirectories();
    const batches = await Promise.all(
      batchDirectories.map(async (batchDirectory) => {
        try {
          return batchRecordSchema.parse(
            await readJsonFile<BatchRecord>(path.join(batchDirectory, "batch.json")),
          );
        } catch {
          return null;
        }
      }),
    );

    return batches
      .filter((batch): batch is BatchRecord => batch !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async readManifest(batch: BatchRecord): Promise<BatchManifest> {
    if (!batch.storage.manifestPath) {
      throw new Error("Batch has not been parsed yet.");
    }

    return readJsonFile<BatchManifest>(batch.storage.manifestPath);
  }

  async readWorkItems(batch: BatchRecord): Promise<PatientEpisodeWorkItem[]> {
    if (!batch.storage.workItemsPath) {
      throw new Error("Batch work items are not available.");
    }

    return readJsonFile<PatientEpisodeWorkItem[]>(batch.storage.workItemsPath);
  }

  async readParserExceptions(batch: BatchRecord): Promise<ParserException[]> {
    if (!batch.storage.parserExceptionsPath) {
      return [];
    }

    return readJsonFile<ParserException[]>(batch.storage.parserExceptionsPath);
  }

  async readBatchSummary(batch: BatchRecord): Promise<BatchSummary | null> {
    if (!batch.storage.batchSummaryPath) {
      return null;
    }

    return readJsonFile<BatchSummary>(batch.storage.batchSummaryPath);
  }

  async listPatientRuns(batch: BatchRecord): Promise<PatientRun[]> {
    const runs = await Promise.all(
      batch.patientRuns.map((patientRun) =>
        readJsonFile<PatientRun>(patientRun.resultBundlePath),
      ),
    );
    return runs.sort((left, right) => left.patientName.localeCompare(right.patientName));
  }

  async readPatientRun(bundlePath: string): Promise<PatientRun> {
    return readJsonFile<PatientRun>(bundlePath);
  }

  async findPatientRun(
    runId: string,
  ): Promise<{ batch: BatchRecord; patientRun: PatientRun | null } | null> {
    const batches = await this.listBatches();

    for (const batch of batches) {
      const match = batch.patientRuns.find((patientRun) => patientRun.runId === runId);
      if (match) {
        const patientRun =
          match.bundleAvailable && (await this.fileExists(match.resultBundlePath))
            ? await readJsonFile<PatientRun>(match.resultBundlePath)
            : null;

        return {
          batch,
          patientRun,
        };
      }
    }

    return null;
  }

  async readPatientRunLog(logPath: string): Promise<PatientRunLog> {
    return readJsonFile<PatientRunLog>(logPath);
  }

  async readJsonIfExists<T>(filePath: string): Promise<T | null> {
    if (!(await this.fileExists(filePath))) {
      return null;
    }
    return readJsonFile<T>(filePath);
  }

  async readTextIfExists(filePath: string): Promise<string | null> {
    if (!(await this.fileExists(filePath))) {
      return null;
    }
    return readFile(filePath, "utf8");
  }

  async listFiles(directoryPath: string): Promise<Array<{
    path: string;
    name: string;
    sizeBytes: number;
    modifiedAt: string;
  }>> {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    const files = await Promise.all(
      directoryEntries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(directoryPath, entry.name);
          const fileStat = await stat(filePath);
          return {
            path: filePath,
            name: entry.name,
            sizeBytes: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
          };
        }),
    );

    return files.sort((left, right) => left.name.localeCompare(right.name));
  }

  async listFilesRecursive(directoryPath: string): Promise<Array<{
    path: string;
    name: string;
    sizeBytes: number;
    modifiedAt: string;
  }>> {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    const files = await Promise.all(
      directoryEntries.map(async (entry) => {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          return this.listFilesRecursive(fullPath);
        }

        const fileStat = await stat(fullPath);
        return [{
          path: fullPath,
          name: entry.name,
          sizeBytes: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
        }];
      }),
    );

    return files.flat().sort((left, right) => left.path.localeCompare(right.path));
  }

  async saveBatchSummary(batch: BatchRecord, batchSummary: BatchSummary): Promise<string> {
    const batchSummaryPath =
      batch.storage.batchSummaryPath ?? path.join(batch.storage.outputRoot, "batch-summary.json");

    await writeJsonFile(batchSummaryPath, batchSummary);
    return batchSummaryPath;
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteBatch(batchId: string): Promise<void> {
    const batchDirectory = await this.findBatchDirectory(batchId);
    if (!batchDirectory) {
      return;
    }

    const batchRoot = path.resolve(batchDirectory);
    const expectedRoot = path.resolve(this.batchesRoot);

    if (!batchRoot.startsWith(`${expectedRoot}${path.sep}`)) {
      throw new Error(`Refusing to delete batch outside storage root: ${batchId}`);
    }

    await rm(batchRoot, { recursive: true, force: true });
  }

  private async findBatchDirectory(batchId: string): Promise<string | null> {
    const legacyDirectory = path.join(this.batchesRoot, batchId);
    if (await this.isBatchDirectory(legacyDirectory)) {
      return legacyDirectory;
    }

    const agencyDirectories = await readdir(this.batchesRoot, { withFileTypes: true });
    for (const entry of agencyDirectories) {
      if (!entry.isDirectory()) {
        continue;
      }

      const nestedDirectory = path.join(this.batchesRoot, entry.name, batchId);
      if (await this.isBatchDirectory(nestedDirectory)) {
        return nestedDirectory;
      }
    }

    return null;
  }

  private async listBatchDirectories(): Promise<string[]> {
    const entries = await readdir(this.batchesRoot, { withFileTypes: true });
    const batchDirectories: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(this.batchesRoot, entry.name);
      if (await this.isBatchDirectory(entryPath)) {
        batchDirectories.push(entryPath);
        continue;
      }

      const nestedEntries = await readdir(entryPath, { withFileTypes: true }).catch(() => []);
      for (const nestedEntry of nestedEntries) {
        if (!nestedEntry.isDirectory()) {
          continue;
        }

        const nestedPath = path.join(entryPath, nestedEntry.name);
        if (await this.isBatchDirectory(nestedPath)) {
          batchDirectories.push(nestedPath);
        }
      }
    }

    return batchDirectories;
  }

  private async isBatchDirectory(directoryPath: string): Promise<boolean> {
    return this.fileExists(path.join(directoryPath, "batch.json"));
  }
}
