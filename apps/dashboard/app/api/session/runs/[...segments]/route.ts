import { NextResponse } from "next/server";
import {
  createBackendRunSample,
  getLatestBackendPatient,
  getBackendPatientArtifacts,
  getBackendRun,
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
      const run = await getBackendRun(segments[0]!);
      if (!agencyIdsMatch(run.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(run);
    }

    if (segments.length === 3 && segments[1] === "patients") {
      const run = await getBackendRun(segments[0]!);
      if (!agencyIdsMatch(run.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(run.subsidiaryId, segments[2]!);
      return NextResponse.json(patient);
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "status") {
      const run = await getBackendRun(segments[0]!);
      if (!agencyIdsMatch(run.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(run.subsidiaryId, segments[2]!);
      return NextResponse.json(patient);
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "artifacts") {
      const run = await getBackendRun(segments[0]!);
      if (!agencyIdsMatch(run.subsidiaryId, session.selectedAgencyId)) {
        return unauthorizedAgencyResponse();
      }
      const patient = await getLatestBackendPatient(run.subsidiaryId, segments[2]!);
      const patientArtifacts = await getBackendPatientArtifacts(patient.batchId, patient.workItemId);
      return NextResponse.json(patientArtifacts);
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
      const sourceRun = await getBackendRun(segments[0]!);
      if (!agencyIdsMatch(sourceRun.subsidiaryId, session.selectedAgencyId)) {
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

    return NextResponse.json({ message: "Unsupported dashboard session route." }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to run dashboard action." },
      { status: 500 },
    );
  }
}
