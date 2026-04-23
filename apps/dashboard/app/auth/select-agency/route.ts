import { NextResponse } from "next/server";
import { recordAgencySelection } from "../../../lib/auth/audit";
import { updateSelectedAgencyInSession } from "../../../lib/auth/session";

export async function POST(request: Request) {
  const formData = await request.formData();
  const agencyId = String(formData.get("agencyId") ?? "").trim();
  if (!agencyId) {
    return NextResponse.redirect(new URL("/select-agency?error=agency_required", request.url), 303);
  }

  try {
    const session = await updateSelectedAgencyInSession(agencyId);
    await recordAgencySelection(request, session, agencyId);
    return NextResponse.redirect(new URL("/agency", request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/select-agency?error=agency_not_allowed", request.url), 303);
  }
}
