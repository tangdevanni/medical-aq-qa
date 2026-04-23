import { requireSelectedAgencySession } from "../../lib/auth/session";

export default async function BatchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSelectedAgencySession();
  return children;
}
