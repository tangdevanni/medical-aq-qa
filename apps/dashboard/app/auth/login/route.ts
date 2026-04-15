import { NextResponse } from "next/server";
import { loadDashboardEnv } from "../../../lib/env";
import { setDashboardSession } from "../../../lib/auth/session";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const env = loadDashboardEnv();
  const user = env.qaUsers.find((candidate) => candidate.email.toLowerCase() === email);

  if (!user || user.password !== password) {
    return NextResponse.redirect(new URL("/login?error=invalid_credentials", request.url));
  }

  await setDashboardSession({ user });
  return NextResponse.redirect(new URL("/select-agency", request.url));
}
