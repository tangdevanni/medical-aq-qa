import { NextResponse } from "next/server";
import { listBackendRuns } from "../../../../lib/server/backendApi";
import { agencyIdsMatch, requireSelectedAgencySession } from "../../../../lib/auth/session";

export async function GET() {
  try {
    const session = await requireSelectedAgencySession();
    const runs = await listBackendRuns();
    return NextResponse.json(
      runs.filter((run) => agencyIdsMatch(run.subsidiaryId, session.selectedAgencyId)),
    );
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to load runs." },
      { status: 500 },
    );
  }
}
