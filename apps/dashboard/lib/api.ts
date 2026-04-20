import type {
  PatientArtifactsResponse,
  PatientDetail,
  PatientStatusResponse,
  RunDetail,
  RunListItem,
  RunStatusResponse,
} from "./types";

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
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
  return "";
}

export function listRuns(): Promise<RunListItem[]> {
  return fetchJson<RunListItem[]>("/api/session/runs");
}

export function getRun(runId: string): Promise<RunDetail> {
  return fetchJson<RunDetail>(`/api/session/runs/${encodeURIComponent(runId)}`);
}

export function getRunStatus(runId: string): Promise<RunStatusResponse> {
  return fetchJson<RunStatusResponse>(`/api/session/runs/${encodeURIComponent(runId)}/status`);
}

export function getPatient(runId: string, patientId: string): Promise<PatientDetail> {
  return fetchJson<PatientDetail>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}`,
  );
}

export function getPatientStatus(
  runId: string,
  patientId: string,
): Promise<PatientStatusResponse> {
  return fetchJson<PatientStatusResponse>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/status`,
  );
}

export function getPatientArtifacts(
  runId: string,
  patientId: string,
): Promise<PatientArtifactsResponse> {
  return fetchJson<PatientArtifactsResponse>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/artifacts`,
  );
}

export function createSampleRun(
  runId: string,
  input: {
    limit?: number;
    patientIds?: string[];
  } = {},
): Promise<RunDetail> {
  return fetchJson<RunDetail>(`/api/session/runs/${encodeURIComponent(runId)}/sample`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function uploadWorkbook(input: {
  file: File;
  billingPeriod: string;
  subsidiaryId?: string;
}): Promise<RunDetail> {
  throw new Error("Manual workbook upload is disabled in the authenticated agency-scoped dashboard.");
}
