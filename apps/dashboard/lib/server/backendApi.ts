import type {
  Agency,
  AgencyDashboardSnapshot,
} from "@medical-ai-qa/shared-types";
import type {
  PatientArtifactsResponse,
  PatientDetail,
  RunDetail,
  RunListItem,
} from "../types";
import { loadDashboardEnv } from "../env";

function buildBackendUrl(pathname: string): string {
  const env = loadDashboardEnv();
  const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const prefix = base.endsWith("/api") ? "" : "/api";
  return `${base}${prefix}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function fetchBackendJson<T>(pathname: string): Promise<T> {
  const url = buildBackendUrl(pathname);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown fetch error";
    throw new Error(`Backend fetch failed for ${url}: ${cause}`);
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorBody?.message ?? `Backend request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function postBackendJson<T>(pathname: string, body?: unknown): Promise<T> {
  const url = buildBackendUrl(pathname);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: body === undefined ? undefined : {
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown fetch error";
    throw new Error(`Backend fetch failed for ${url}: ${cause}`);
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorBody?.message ?? `Backend request failed: ${response.status}`);
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
  sourceWorkbookName: string;
  storedPath: string;
}> {
  return postBackendJson(`/agencies/${encodeURIComponent(agencyId)}/refresh`);
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
