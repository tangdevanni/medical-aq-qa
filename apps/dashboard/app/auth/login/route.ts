import {
  loadDashboardEnv,
  verifyQaUserPassword,
  type DashboardQaUser,
} from "../../../lib/env";
import { recordLoginFailure, recordLoginSuccess } from "../../../lib/auth/audit";
import { setDashboardSession } from "../../../lib/auth/session";
import { redirectToSameOrigin } from "../../../lib/redirect";

const INVALID_CREDENTIALS_REDIRECT = "/login?error=invalid_credentials";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    await recordLoginFailure(request, email || null, "missing_credentials");
    return redirectToSameOrigin(INVALID_CREDENTIALS_REDIRECT);
  }

  const env = loadDashboardEnv();
  const user = env.qaUsers.find(
    (candidate: DashboardQaUser) =>
      candidate.email.toLowerCase() === email &&
      verifyQaUserPassword(candidate, password, env.allowPlaintextPasswords),
  );

  if (!user) {
    await recordLoginFailure(request, email, "invalid_credentials");
    return redirectToSameOrigin(INVALID_CREDENTIALS_REDIRECT);
  }

  const session = await setDashboardSession({ user });
  await recordLoginSuccess(request, session);
  return redirectToSameOrigin("/select-agency");
}
