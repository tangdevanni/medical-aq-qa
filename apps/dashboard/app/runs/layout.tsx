import { requireSelectedAgencySession } from "../../lib/auth/session";

export default async function RunsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSelectedAgencySession();
  return children;
}
