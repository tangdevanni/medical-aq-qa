import { NextResponse } from "next/server";
import { getBackendAgencyDashboard } from "../../../../lib/server/backendApi";
import { requireSelectedAgencySession } from "../../../../lib/auth/session";

export async function GET() {
  try {
    const session = await requireSelectedAgencySession();
    const snapshot = await getBackendAgencyDashboard(session.selectedAgencyId!);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to load agency dashboard." },
      { status: 500 },
    );
  }
}
