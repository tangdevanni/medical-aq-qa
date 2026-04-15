import { NextResponse } from "next/server";
import { updateSelectedAgencyInSession } from "../../../lib/auth/session";

export async function POST(request: Request) {
  const formData = await request.formData();
  const agencyId = String(formData.get("agencyId") ?? "").trim();
  if (!agencyId) {
    return NextResponse.redirect(new URL("/select-agency?error=agency_required", request.url));
  }

  try {
    await updateSelectedAgencyInSession(agencyId);
    return NextResponse.redirect(new URL("/agency", request.url));
  } catch {
    return NextResponse.redirect(new URL("/select-agency?error=agency_not_allowed", request.url));
  }
}
