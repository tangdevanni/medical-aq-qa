import { NextResponse } from "next/server";
import {
  loadDashboardEnv,
  verifyQaUserPassword,
  type DashboardQaUser,
} from "../../../lib/env";
import { recordLoginFailure, recordLoginSuccess } from "../../../lib/auth/audit";
import { setDashboardSession } from "../../../lib/auth/session";

const INVALID_CREDENTIALS_REDIRECT = "/login?error=invalid_credentials";

function redirectSeeOther(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    await recordLoginFailure(request, email || null, "missing_credentials");
    return redirectSeeOther(request, INVALID_CREDENTIALS_REDIRECT);
  }

  const env = loadDashboardEnv();
  const user = env.qaUsers.find(
    (candidate: DashboardQaUser) =>
      candidate.email.toLowerCase() === email &&
      verifyQaUserPassword(candidate, password, env.allowPlaintextPasswords),
  );

  if (!user) {
    await recordLoginFailure(request, email, "invalid_credentials");
    return redirectSeeOther(request, INVALID_CREDENTIALS_REDIRECT);
  }

  const session = await setDashboardSession({ user });
  await recordLoginSuccess(request, session);
  return redirectSeeOther(request, "/select-agency");
}
