import { NextResponse } from "next/server";
import { clearDashboardSession } from "../../../lib/auth/session";

export async function POST(request: Request) {
  await clearDashboardSession();
  return NextResponse.redirect(new URL("/login", request.url));
}
