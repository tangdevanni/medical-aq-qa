import { NextResponse } from "next/server";
import { recordLogoutSuccess } from "../../../lib/auth/audit";
import { clearDashboardSession, getDashboardSession } from "../../../lib/auth/session";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  await recordLogoutSuccess(request, session);
  await clearDashboardSession();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
