import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/env";
import { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import { FilesystemScheduledRunRepository } from "../repositories/filesystemScheduledRunRepository";

const DEFAULT_AGENCY_IDS = [
  "aplus-home-health",
  "active-home-health",
  "avery-home-health",
  "meadows-home-health",
  "star-home-health",
] as const;

const AGENCY_DIRECTORY_ALIASES: Record<string, string[]> = {
  "aplus-home-health": ["aplus-home-health"],
  "active-home-health": ["active-home-health"],
  "avery-home-health": ["avery-home-health"],
  "meadows-home-health": ["meadows-home-health"],
  "star-home-health": ["default", "star-home-health", "star-home-health-care-inc"],
};

function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function normalizeAgencyArg(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "star-home-health" ||
    normalized === "star-home-health-care-inc" ||
    normalized === "star" ||
    normalized === "default"
  ) {
    return "star-home-health";
  }
  return normalized;
}

function resolveAgencyIds(explicitAgencyIds: string[], runAll: boolean): string[] {
  const selected = runAll || explicitAgencyIds.length === 0
    ? [...DEFAULT_AGENCY_IDS]
    : explicitAgencyIds.map(normalizeAgencyArg);
  return [...new Set(selected)];
}

function resolveAgencyDirectoryNames(agencyIds: string[]): Set<string> {
  const directoryNames = new Set<string>();
  for (const agencyId of agencyIds) {
    for (const directoryName of AGENCY_DIRECTORY_ALIASES[agencyId] ?? [agencyId]) {
      directoryNames.add(directoryName);
    }
  }
  return directoryNames;
}

function parseArgs(argv: string[]): {
  agencyIds: string[];
  dryRun: boolean;
  includeLegacyRoot: boolean;
  includeRunning: boolean;
} {
  const explicitAgencyIds: string[] = [];
  let runAll = false;
  let dryRun = false;
  let includeLegacyRoot = true;
  let includeRunning = false;

  for (const arg of argv) {
    if (!arg) {
      continue;
    }
    if (arg === "--all") {
      runAll = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--no-legacy-root") {
      includeLegacyRoot = false;
      continue;
    }
    if (arg === "--include-running") {
      includeRunning = true;
      continue;
    }
    explicitAgencyIds.push(arg);
  }

  return {
    agencyIds: resolveAgencyIds(explicitAgencyIds, runAll),
    dryRun,
    includeLegacyRoot,
    includeRunning,
  };
}

async function removeDirectoryIfPresent(directoryPath: string): Promise<boolean> {
  if (!existsSync(directoryPath)) {
    return false;
  }

  await rm(directoryPath, { recursive: true, force: true });
  return true;
}

async function removeFileIfPresent(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false;
  }

  await rm(filePath, { force: true });
  return true;
}

type ResetRootSummary = {
  storageRoot: string;
  exists: boolean;
  targetedBatchIds: string[];
  targetedRunningBatchIds: string[];
  deletedBatchIds: string[];
  deletedScheduledRunIds: string[];
  removedAgencyDirectories: string[];
  removedSnapshotFiles: string[];
};

async function resetStorageRoot(input: {
  storageRoot: string;
  agencyIds: string[];
  agencyDirectoryNames: Set<string>;
  dryRun: boolean;
  includeRunning: boolean;
}): Promise<ResetRootSummary> {
  const summary: ResetRootSummary = {
    storageRoot: input.storageRoot,
    exists: existsSync(input.storageRoot),
    targetedBatchIds: [],
    targetedRunningBatchIds: [],
    deletedBatchIds: [],
    deletedScheduledRunIds: [],
    removedAgencyDirectories: [],
    removedSnapshotFiles: [],
  };

  if (!summary.exists) {
    return summary;
  }

  const batchRepository = new FilesystemBatchRepository(input.storageRoot);
  const scheduledRunRepository = new FilesystemScheduledRunRepository(input.storageRoot);
  const batches = await batchRepository.listBatches();
  const targetedBatches = batches.filter((batch) => {
    const batchDirectoryName = path.basename(path.dirname(batch.storage.batchRoot));
    return (
      input.agencyIds.includes(batch.subsidiary.id) ||
      input.agencyDirectoryNames.has(batch.subsidiary.slug) ||
      input.agencyDirectoryNames.has(batchDirectoryName)
    );
  });
  summary.targetedBatchIds = targetedBatches.map((batch) => batch.id);
  summary.targetedRunningBatchIds = targetedBatches
    .filter((batch) => batch.status === "RUNNING")
    .map((batch) => batch.id);

  if (!input.includeRunning && summary.targetedRunningBatchIds.length > 0) {
    throw new Error(
      `Refusing to purge RUNNING batches in ${input.storageRoot}: ${summary.targetedRunningBatchIds.join(", ")}. Stop those runs first or rerun with --include-running.`,
    );
  }

  const targetedBatchIds = new Set(summary.targetedBatchIds);
  const scheduledRuns = await scheduledRunRepository.listScheduledRuns();
  const targetedScheduledRuns = scheduledRuns.filter((schedule) =>
    input.agencyIds.includes(schedule.subsidiaryId) || targetedBatchIds.has(schedule.batchId),
  );

  if (!input.dryRun) {
    for (const scheduledRun of targetedScheduledRuns) {
      await scheduledRunRepository.deleteScheduledRun(scheduledRun.id);
      summary.deletedScheduledRunIds.push(scheduledRun.id);
    }

    for (const batch of targetedBatches) {
      await batchRepository.deleteBatch(batch.id);
      summary.deletedBatchIds.push(batch.id);
    }

    const batchesRoot = path.join(input.storageRoot, "batches");
    for (const directoryName of input.agencyDirectoryNames) {
      const directoryPath = path.join(batchesRoot, directoryName);
      if (await removeDirectoryIfPresent(directoryPath)) {
        summary.removedAgencyDirectories.push(directoryPath);
      }
    }

    const currentAgenciesSnapshotPath = path.join(batchesRoot, "current-agencies.json");
    if (await removeFileIfPresent(currentAgenciesSnapshotPath)) {
      summary.removedSnapshotFiles.push(currentAgenciesSnapshotPath);
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const { agencyIds, dryRun, includeLegacyRoot, includeRunning } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const workspaceRoot = findWorkspaceRoot(__dirname) ?? findWorkspaceRoot(process.cwd());
  const legacyStorageRoot = workspaceRoot
    ? path.resolve(workspaceRoot, "data", "control-plane")
    : path.resolve(process.cwd(), "data", "control-plane");
  const storageRoots = [
    env.API_STORAGE_ROOT,
    includeLegacyRoot && path.resolve(legacyStorageRoot) !== path.resolve(env.API_STORAGE_ROOT)
      ? legacyStorageRoot
      : null,
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const agencyDirectoryNames = resolveAgencyDirectoryNames(agencyIds);

  const results: ResetRootSummary[] = [];
  for (const storageRoot of storageRoots) {
    results.push(
      await resetStorageRoot({
        storageRoot,
        agencyIds,
        agencyDirectoryNames,
        dryRun,
        includeRunning,
      }),
    );
  }

  console.log(JSON.stringify({
    agencyIds,
    dryRun,
    includeLegacyRoot,
    includeRunning,
    storageRoots: results,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown control-plane reset error.");
  process.exitCode = 1;
});
