import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface QueueQaRunState {
  runId: string;
  startedAt: string;
  updatedAt: string;
  currentPage: number;
  lastProcessedFingerprint: string | null;
  processedFingerprints: string[];
}

export function createQueueQaRunState(input: {
  runId: string;
  startedAt: string;
  currentPage?: number;
  lastProcessedFingerprint?: string | null;
  processedFingerprints?: Iterable<string>;
}): QueueQaRunState {
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    currentPage: input.currentPage ?? 1,
    lastProcessedFingerprint: input.lastProcessedFingerprint ?? null,
    processedFingerprints: [...new Set(input.processedFingerprints ?? [])],
  };
}

export async function loadQueueQaRunState(statePath: string): Promise<QueueQaRunState | null> {
  try {
    const content = await readFile(statePath, "utf8");
    return JSON.parse(content) as QueueQaRunState;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function saveQueueQaRunState(
  statePath: string,
  state: QueueQaRunState,
): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function updateQueueQaRunState(
  state: QueueQaRunState,
  input: {
    currentPage: number;
    processedFingerprints: Iterable<string>;
    lastProcessedFingerprint?: string | null;
    updatedAt: string;
  },
): QueueQaRunState {
  return {
    ...state,
    currentPage: input.currentPage,
    processedFingerprints: [...new Set(input.processedFingerprints)],
    lastProcessedFingerprint: input.lastProcessedFingerprint ?? state.lastProcessedFingerprint,
    updatedAt: input.updatedAt,
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT";
}
