import { NextResponse } from "next/server";
import { getDashboardSession } from "../../../lib/auth/session";
import { triggerBackendAgencyRefresh } from "../../../lib/server/backendApi";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const formData = await request.formData();
  const action = String(formData.get("action") ?? "").trim();
  if (action !== "refresh_agency") {
    return NextResponse.redirect(new URL("/agency?error=unsupported_session_action", request.url));
  }

  const agencyId = String(formData.get("agencyId") ?? "").trim();
  if (!agencyId) {
    return NextResponse.redirect(new URL("/agency?error=refresh_agency_required", request.url));
  }

  if (!session.allowedAgencyIds.includes(agencyId)) {
    return NextResponse.redirect(new URL("/agency?error=refresh_agency_not_allowed", request.url));
  }

  try {
    const result = await triggerBackendAgencyRefresh(agencyId);
    return NextResponse.redirect(
      new URL(`/agency?refresh=started&batchId=${encodeURIComponent(result.batchId)}`, request.url),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger agency refresh.";
    return NextResponse.redirect(
      new URL(`/agency?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
