import { getDashboardSession } from "../../../lib/auth/session";
import { redirectToSameOrigin } from "../../../lib/redirect";
import { triggerBackendAgencyRefresh } from "../../../lib/server/backendApi";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return redirectToSameOrigin("/login");
  }

  const formData = await request.formData();
  const action = String(formData.get("action") ?? "").trim();
  if (action !== "refresh_agency") {
    return redirectToSameOrigin("/agency?error=unsupported_session_action");
  }

  const agencyId = String(formData.get("agencyId") ?? "").trim();
  if (!agencyId) {
    return redirectToSameOrigin("/agency?error=refresh_agency_required");
  }

  if (!session.allowedAgencyIds.includes(agencyId)) {
    return redirectToSameOrigin("/agency?error=refresh_agency_not_allowed");
  }

  try {
    const result = await triggerBackendAgencyRefresh(agencyId);
    return redirectToSameOrigin(`/agency?refresh=started&batchId=${encodeURIComponent(result.batchId)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger agency refresh.";
    return redirectToSameOrigin(`/agency?error=${encodeURIComponent(message)}`);
  }
}
