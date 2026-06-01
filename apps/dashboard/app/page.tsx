import { redirect } from "next/navigation";
import { getDashboardSession } from "../lib/auth/session";
import { resolveDashboardRedirectLocation } from "../lib/redirect";

export default async function HomePage() {
  const session = await getDashboardSession();
  if (!session) {
    redirect(resolveDashboardRedirectLocation("/login"));
  }

  if (!session.selectedAgencyId) {
    redirect(resolveDashboardRedirectLocation("/select-agency"));
  }

  redirect(resolveDashboardRedirectLocation("/agency"));
}
