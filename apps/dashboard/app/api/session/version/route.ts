import { NextResponse } from "next/server";
import { getDashboardSession } from "../../../../lib/auth/session";
import { getDashboardRuntimeVersion } from "../../../../lib/runtimeVersion";
import { getBackendVersion } from "../../../../lib/server/backendApi";

export async function GET() {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const backend = await getBackendVersion().catch((error) => ({
    error: error instanceof Error ? error.message : "Failed to load backend version.",
  }));

  return NextResponse.json({
    dashboard: getDashboardRuntimeVersion(),
    backend,
  });
}
