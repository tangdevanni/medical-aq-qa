import { NextResponse } from "next/server";
import {
  BackendRequestError,
  createBackendRunSample,
  getLatestBackendPatient,
  getBackendPatientArtifacts,
  getBackendPatientOasisCheckStatus,
  getBackendPatientReferralIntakeStatus,
  getBackendRun,
  getBackendRunStatus,
  startBackendPatientOasisCheck,
  startBackendPatientReferralIntake,
} from "../../../../../lib/server/backendApi";
import { agencyIdsMatch, requireSelectedAgencySession } from "../../../../../lib/auth/session";

type Params = {
  params: Promise<{
    segments: string[];
  }>;
};

function unauthorizedAgencyResponse() {
  return NextResponse.json({ message: "Selected agency does not match requested run." }, { status: 403 });
}

export async function GET(_request: Request, { params }: Params) {
  const { segments } = await params;
  const session = await requireSelectedAgencySession();

  try {
    if (segments.length === 1) {
      const run = await getBackendRun(segments[0]!);
      if (!agencyIdsMatch(run.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(run);
    }

    if (segments.length === 2 && segments[1] === "status") {
      const status = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(status.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(status);
    }

    if (segments.length === 3 && segments[1] === "patients") {
      const status = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(status.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(status.subsidiaryId, segments[2]!);
      return NextResponse.json(patient);
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "status") {
      const status = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(status.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(status.subsidiaryId, segments[2]!);
      return NextResponse.json(patient);
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "artifacts") {
      const status = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(status.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(status.subsidiaryId, segments[2]!);
      const patientArtifacts = await getBackendPatientArtifacts(patient.batchId, patient.workItemId);
      return NextResponse.json(patientArtifacts);
    }

    if (segments.length === 5 && segments[1] === "patients" && segments[3] === "referral-intake" && segments[4] === "status") {
      const runStatus = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(runStatus.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(runStatus.subsidiaryId, segments[2]!);
      const intakeStatus = await getBackendPatientReferralIntakeStatus(patient.batchId, patient.workItemId);
      return NextResponse.json(intakeStatus);
    }

    if (segments.length === 5 && segments[1] === "patients" && segments[3] === "oasis-check" && segments[4] === "status") {
      const runStatus = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(runStatus.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const url = new URL(_request.url);
      const assessmentId = url.searchParams.get("assessmentId");
      if (!assessmentId) {
        return NextResponse.json({ message: "assessmentId is required." }, { status: 400 });
      }
      const patient = await getLatestBackendPatient(runStatus.subsidiaryId, segments[2]!);
      const checkStatus = await getBackendPatientOasisCheckStatus(patient.batchId, patient.workItemId, assessmentId);
      return NextResponse.json(checkStatus);
    }

    return NextResponse.json({ message: "Unsupported dashboard session route." }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to load run resource." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: Params) {
  const { segments } = await params;
  const session = await requireSelectedAgencySession();

  try {
    if (segments.length === 2 && segments[1] === "sample") {
      const sourceRunStatus = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(sourceRunStatus.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }

      const body = (await request.json().catch(() => ({}))) as {
        limit?: number;
        patientIds?: string[];
      };
      const sampleRun = await createBackendRunSample(segments[0]!, {
        limit: body.limit,
        patientIds: body.patientIds,
      });
      return NextResponse.json(sampleRun, { status: 202 });
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "referral-intake") {
      const status = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(status.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }

      const patient = await getLatestBackendPatient(status.subsidiaryId, segments[2]!);
      const response = await startBackendPatientReferralIntake(patient.batchId, patient.workItemId);
      return NextResponse.json(response, { status: 202 });
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "oasis-check") {
      const status = await getBackendRunStatus(segments[0]!);
      if (!agencyIdsMatch(status.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }

      const body = (await request.json().catch(() => ({}))) as { assessmentId?: string };
      if (!body.assessmentId) {
        return NextResponse.json({ message: "assessmentId is required." }, { status: 400 });
      }
      const patient = await getLatestBackendPatient(status.subsidiaryId, segments[2]!);
      const response = await startBackendPatientOasisCheck(patient.batchId, patient.workItemId, body.assessmentId);
      return NextResponse.json(response, { status: 202 });
    }

    return NextResponse.json({ message: "Unsupported dashboard session route." }, { status: 404 });
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 409) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to run dashboard action." },
      { status: 500 },
    );
  }
}
