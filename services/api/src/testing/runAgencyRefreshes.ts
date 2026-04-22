import { createApp } from "../app";

const DEFAULT_AGENCY_IDS = [
  "aplus-home-health",
  "active-home-health",
  "avery-home-health",
  "meadows-home-health",
  "default",
] as const;

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1_000;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED"]);

type RunStatusResponse = {
  id: string;
  status: string;
  currentExecutionStep: string;
  percentComplete: number;
  totalWorkItems: number;
  totalCompleted: number;
  totalBlocked: number;
  totalFailed: number;
  totalNeedsHumanReview: number;
  errorSummary: string | null;
};

type RefreshResponse = {
  agencyId: string;
  batchId: string;
  status: string;
  sourceWorkbookName: string;
  storedPath: string;
};

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function parseArgs(argv: string[]): {
  agencyIds: string[];
  pollIntervalMs: number;
  timeoutMs: number;
} {
  const explicitAgencyIds: string[] = [];
  let runAll = false;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--all") {
      runAll = true;
      continue;
    }

    if (arg === "--poll-ms") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --poll-ms.");
      }
      pollIntervalMs = Number(nextValue);
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --timeout-ms.");
      }
      timeoutMs = Number(nextValue);
      index += 1;
      continue;
    }

    explicitAgencyIds.push(arg);
  }

  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1_000) {
    throw new Error(`Invalid --poll-ms value: ${pollIntervalMs}`);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < pollIntervalMs) {
    throw new Error(`Invalid --timeout-ms value: ${timeoutMs}`);
  }

  const agencyIds = runAll || explicitAgencyIds.length === 0
    ? [...DEFAULT_AGENCY_IDS]
    : explicitAgencyIds;

  return {
    agencyIds,
    pollIntervalMs,
    timeoutMs,
  };
}

async function mustParseJson<T>(payload: string, context: string): Promise<T> {
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main(): Promise<void> {
  const { agencyIds, pollIntervalMs, timeoutMs } = parseArgs(process.argv.slice(2));
  const app = await createApp();

  try {
    const summaries: Array<{
      agencyId: string;
      batchId: string | null;
      status: string;
      totalWorkItems: number | null;
      totalCompleted: number | null;
      totalBlocked: number | null;
      totalFailed: number | null;
      totalNeedsHumanReview: number | null;
      errorSummary: string | null;
    }> = [];

    for (const agencyId of agencyIds) {
      const refreshResponse = await app.inject({
        method: "POST",
        url: `/api/agencies/${encodeURIComponent(agencyId)}/refresh`,
      });

      const refreshBody = refreshResponse.body.length > 0
        ? await mustParseJson<RefreshResponse | { message?: string }>(
            refreshResponse.body,
            `refresh ${agencyId}`,
          )
        : null;

      if (refreshResponse.statusCode >= 400 || !refreshBody || !("batchId" in refreshBody)) {
        const message =
          refreshBody && "message" in refreshBody && typeof refreshBody.message === "string"
            ? refreshBody.message
            : `Refresh failed with status ${refreshResponse.statusCode}.`;
        summaries.push({
          agencyId,
          batchId: null,
          status: "FAILED_TO_START",
          totalWorkItems: null,
          totalCompleted: null,
          totalBlocked: null,
          totalFailed: null,
          totalNeedsHumanReview: null,
          errorSummary: message,
        });
        continue;
      }

      const refresh = refreshBody;
      const startedAt = Date.now();
      let finalStatus: RunStatusResponse | null = null;

      while (Date.now() - startedAt <= timeoutMs) {
        const statusResponse = await app.inject({
          method: "GET",
          url: `/api/runs/${encodeURIComponent(refresh.batchId)}/status`,
        });

        if (statusResponse.statusCode >= 400) {
          throw new Error(
            `Unable to load status for ${refresh.batchId}: ${statusResponse.statusCode}`,
          );
        }

        const statusBody = await mustParseJson<RunStatusResponse>(
          statusResponse.body,
          `status ${refresh.batchId}`,
        );

        if (TERMINAL_STATUSES.has(statusBody.status)) {
          finalStatus = statusBody;
          break;
        }

        await sleep(pollIntervalMs);
      }

      if (!finalStatus) {
        summaries.push({
          agencyId,
          batchId: refresh.batchId,
          status: "TIMED_OUT",
          totalWorkItems: null,
          totalCompleted: null,
          totalBlocked: null,
          totalFailed: null,
          totalNeedsHumanReview: null,
          errorSummary: `Timed out after ${timeoutMs}ms waiting for terminal status.`,
        });
        continue;
      }

      summaries.push({
        agencyId,
        batchId: refresh.batchId,
        status: finalStatus.status,
        totalWorkItems: finalStatus.totalWorkItems,
        totalCompleted: finalStatus.totalCompleted,
        totalBlocked: finalStatus.totalBlocked,
        totalFailed: finalStatus.totalFailed,
        totalNeedsHumanReview: finalStatus.totalNeedsHumanReview,
        errorSummary: finalStatus.errorSummary,
      });
    }

    console.log(JSON.stringify({ summaries }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown agency refresh execution error.");
  process.exitCode = 1;
});
