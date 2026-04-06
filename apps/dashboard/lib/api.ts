import type {
  PatientArtifactsResponse,
  PatientDetail,
  PatientStatusResponse,
  RunDetail,
  RunListItem,
  RunStatusResponse,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const API_PREFIX = API_BASE_URL.endsWith("/api") ? "" : "/api";

function buildApiUrl(pathname: string): string {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${API_BASE_URL}${API_PREFIX}${normalizedPathname}`;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(input), {
    ...init,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorBody?.message ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function listRuns(): Promise<RunListItem[]> {
  return fetchJson<RunListItem[]>("/runs");
}

export function getRun(runId: string): Promise<RunDetail> {
  return fetchJson<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
}

export function getRunStatus(runId: string): Promise<RunStatusResponse> {
  return fetchJson<RunStatusResponse>(`/runs/${encodeURIComponent(runId)}/status`);
}

export function getPatient(runId: string, patientId: string): Promise<PatientDetail> {
  return fetchJson<PatientDetail>(
    `/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}`,
  );
}

export function getPatientStatus(
  runId: string,
  patientId: string,
): Promise<PatientStatusResponse> {
  return fetchJson<PatientStatusResponse>(
    `/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/status`,
  );
}

export function getPatientArtifacts(
  runId: string,
  patientId: string,
): Promise<PatientArtifactsResponse> {
  return fetchJson<PatientArtifactsResponse>(
    `/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/artifacts`,
  );
}

export async function uploadWorkbook(input: {
  file: File;
  billingPeriod: string;
}): Promise<RunDetail> {
  const formData = new FormData();
  formData.append("workbook", input.file);
  if (input.billingPeriod.trim()) {
    formData.append("billingPeriod", input.billingPeriod.trim());
  }

  return fetchJson<RunDetail>("/runs/upload", {
    method: "POST",
    body: formData,
  });
}

export async function parseRun(runId: string): Promise<RunDetail> {
  return fetchJson<RunDetail>(`/runs/${encodeURIComponent(runId)}/parse`, {
    method: "POST",
  });
}

export async function startRun(runId: string): Promise<RunDetail> {
  return fetchJson<RunDetail>(`/runs/${encodeURIComponent(runId)}/start`, {
    method: "POST",
  });
}
