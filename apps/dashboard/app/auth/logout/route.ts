import { recordLogoutSuccess } from "../../../lib/auth/audit";
import { clearDashboardSession, getDashboardSession } from "../../../lib/auth/session";
import { redirectToSameOrigin } from "../../../lib/redirect";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  await recordLogoutSuccess(request, session);
  await clearDashboardSession();
  return redirectToSameOrigin("/login");
}
