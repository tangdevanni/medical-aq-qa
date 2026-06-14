import type {
  PatientArtifactsResponse,
  ClinicalRefreshStartResponse,
  PatientDetail,
  PatientClinicalRefreshStatus,
  PatientOasisCheckState,
  PatientReferralIntakeStatus,
  PatientStatusResponse,
  OasisCheckStartResponse,
  ReferralIntakeStartResponse,
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

export function startPatientReferralIntake(
  runId: string,
  patientId: string,
): Promise<ReferralIntakeStartResponse> {
  return fetchJson<ReferralIntakeStartResponse>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/referral-intake`,
    { method: "POST" },
  );
}

export function getPatientReferralIntakeStatus(
  runId: string,
  patientId: string,
): Promise<PatientReferralIntakeStatus> {
  return fetchJson<PatientReferralIntakeStatus>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/referral-intake/status`,
  );
}

export function startPatientClinicalRefresh(
  runId: string,
  patientId: string,
  options: { assessmentId?: string | null } = {},
): Promise<ClinicalRefreshStartResponse> {
  const body = options.assessmentId ? JSON.stringify({ assessmentId: options.assessmentId }) : undefined;
  return fetchJson<ClinicalRefreshStartResponse>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/clinical-refresh`,
    {
      method: "POST",
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body,
          }
        : {}),
    },
  );
}

export function getPatientClinicalRefreshStatus(
  runId: string,
  patientId: string,
): Promise<PatientClinicalRefreshStatus> {
  return fetchJson<PatientClinicalRefreshStatus>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/clinical-refresh/status`,
  );
}

export function startPatientOasisCheck(
  runId: string,
  patientId: string,
  assessmentId: string,
): Promise<OasisCheckStartResponse> {
  return fetchJson<OasisCheckStartResponse>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/oasis-check`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ assessmentId }),
    },
  );
}

export function getPatientOasisCheckStatus(
  runId: string,
  patientId: string,
  assessmentId: string,
): Promise<PatientOasisCheckState> {
  return fetchJson<PatientOasisCheckState>(
    `/api/session/runs/${encodeURIComponent(runId)}/patients/${encodeURIComponent(patientId)}/oasis-check/status?assessmentId=${encodeURIComponent(assessmentId)}`,
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
