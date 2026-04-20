import { NextResponse } from "next/server";
import {
  createBackendRunSample,
  getBackendPatient,
  getBackendPatientArtifacts,
  getBackendRun,
} from "../../../../../lib/server/backendApi";
import { requireSelectedAgencySession } from "../../../../../lib/auth/session";

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
      if (run.subsidiaryId !== session.selectedAgencyId) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(run);
    }

    if (segments.length === 2 && segments[1] === "status") {
      const run = await getBackendRun(segments[0]!);
      if (run.subsidiaryId !== session.selectedAgencyId) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(run);
    }

    if (segments.length === 3 && segments[1] === "patients") {
      const patient = await getBackendPatient(segments[0]!, segments[2]!);
      if (patient.subsidiaryId !== session.selectedAgencyId) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(patient);
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "status") {
      const patient = await getBackendPatient(segments[0]!, segments[2]!);
      if (patient.subsidiaryId !== session.selectedAgencyId) {
        return unauthorizedAgencyResponse();
      }
      return NextResponse.json(patient);
    }

    if (segments.length === 4 && segments[1] === "patients" && segments[3] === "artifacts") {
      const patientArtifacts = await getBackendPatientArtifacts(segments[0]!, segments[2]!);
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
      if (sourceRun.subsidiaryId !== session.selectedAgencyId) {
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
