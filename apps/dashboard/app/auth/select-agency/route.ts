import { recordAgencySelection } from "../../../lib/auth/audit";
import { updateSelectedAgencyInSession } from "../../../lib/auth/session";
import { redirectToSameOrigin } from "../../../lib/redirect";

export async function POST(request: Request) {
  const formData = await request.formData();
  const agencyId = String(formData.get("agencyId") ?? "").trim();
  if (!agencyId) {
    return redirectToSameOrigin("/select-agency?error=agency_required");
  }

  try {
    const session = await updateSelectedAgencyInSession(agencyId);
    await recordAgencySelection(request, session, agencyId);
    return redirectToSameOrigin("/agency");
  } catch {
    return redirectToSameOrigin("/select-agency?error=agency_not_allowed");
  }
}
