import { requireSelectedAgencySession } from "../../lib/auth/session";

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSelectedAgencySession();
  return children;
}
