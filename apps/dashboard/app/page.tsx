import { redirect } from "next/navigation";
import { getDashboardSession } from "../lib/auth/session";

export default async function HomePage() {
  const session = await getDashboardSession();
  if (!session) {
    redirect("/login");
  }

  if (!session.selectedAgencyId) {
    redirect("/select-agency");
  }

  redirect("/agency");
}
