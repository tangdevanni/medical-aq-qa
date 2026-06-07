import type {
  Agency,
  AgencyDashboardSnapshot,
} from "@medical-ai-qa/shared-types";
import type {
  PatientArtifactsResponse,
  PatientDetail,
  PatientReferralIntakeStatus,
  ReferralIntakeStartResponse,
  RunDetail,
  RunListItem,
  RunStatusResponse,
} from "../types";
import { loadDashboardEnv, type DashboardEnv } from "../env";

export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

function buildBackendUrl(pathname: string, env: DashboardEnv = loadDashboardEnv()): string {
  const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const prefix = base.endsWith("/api") ? "" : "/api";
  return `${base}${prefix}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function withBackendTimeout<T>(
  url: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = loadDashboardEnv().DASHBOARD_BACKEND_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Backend request timed out after ${timeoutMs}ms for ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBackendJson<T>(pathname: string): Promise<T> {
  const env = loadDashboardEnv();
  const url = buildBackendUrl(pathname, env);
  let response: Response;
  try {
    response = await withBackendTimeout(url, (signal) =>
      fetch(url, {
        cache: "no-store",
        signal,
      }),
    );
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown fetch error";
    throw new Error(`Backend fetch failed for ${url}: ${cause}`);
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new BackendRequestError(errorBody?.message ?? `Backend request failed: ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}

async function postBackendJson<T>(pathname: string, body?: unknown): Promise<T> {
  const env = loadDashboardEnv();
  const url = buildBackendUrl(pathname, env);
  let response: Response;
  try {
    response = await withBackendTimeout(url, (signal) =>
      fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: body === undefined ? undefined : {
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      }),
    );
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown fetch error";
    throw new Error(`Backend fetch failed for ${url}: ${cause}`);
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new BackendRequestError(errorBody?.message ?? `Backend request failed: ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}

export function listBackendAgencies(): Promise<Agency[]> {
  return fetchBackendJson<Agency[]>("/agencies");
}

export function getBackendAgencyDashboard(agencyId: string): Promise<AgencyDashboardSnapshot> {
  return fetchBackendJson<AgencyDashboardSnapshot>(`/agencies/${encodeURIComponent(agencyId)}/dashboard`);
}

export function triggerBackendAgencyRefresh(agencyId: string): Promise<{
  agencyId: string;
  batchId: string;
  status: string;
  refreshAcceptedAt: string;
  statusUrl: string;
  sourceWorkbookName: string;
  storedPath: string;
}> {
  return postBackendJson(`/agencies/${encodeURIComponent(agencyId)}/refresh`);
}

export function updateBackendAgencyReviewerStatus(
  agencyId: string,
  input: {
    workItemId: string;
    status: "red" | "yellow" | "green";
    updatedBy?: string | null;
  },
): Promise<{
  workItemId: string;
  status: "red" | "yellow" | "green";
  updatedAt: string;
  updatedBy: string | null;
}> {
  return postBackendJson(`/agencies/${encodeURIComponent(agencyId)}/dashboard/reviewer-status`, input);
}

export function createBackendRunSample(
  runId: string,
  input: {
    limit?: number;
    patientIds?: string[];
  } = {},
): Promise<RunDetail> {
  return postBackendJson(`/runs/${encodeURIComponent(runId)}/sample`, input);
}

export function listBackendRuns(): Promise<RunListItem[]> {
  return fetchBackendJson<RunListItem[]>("/runs");
}

export function getBackendRun(runId: string): Promise<RunDetail> {
  return fetchBackendJson<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
}

export function getBackendRunStatus(runId: string): Promise<RunStatusResponse> {
  return fetchBackendJson<RunStatusResponse>(`/runs/${encodeURIComponent(runId)}/status`);
}

export function getBackendPatient(runId: string, patientId: string): Promise<PatientDetail> {
  return fetchBackendJson<PatientDetail>(`/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}`);
}

export function getLatestBackendPatient(subsidiaryId: string, patientId: string): Promise<PatientDetail> {
  return fetchBackendJson<PatientDetail>(
    `/patients/${encodeURIComponent(patientId)}/latest?subsidiaryId=${encodeURIComponent(subsidiaryId)}`,
  );
}

export function getBackendPatientArtifacts(runId: string, patientId: string): Promise<PatientArtifactsResponse> {
  return fetchBackendJson<PatientArtifactsResponse>(`/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/artifacts`);
}

export function startBackendPatientReferralIntake(
  runId: string,
  patientId: string,
): Promise<ReferralIntakeStartResponse> {
  return postBackendJson<ReferralIntakeStartResponse>(
    `/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/referral-intake`,
  );
}

export function getBackendPatientReferralIntakeStatus(
  runId: string,
  patientId: string,
): Promise<PatientReferralIntakeStatus> {
  return fetchBackendJson<PatientReferralIntakeStatus>(
    `/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/referral-intake/status`,
  );
}
