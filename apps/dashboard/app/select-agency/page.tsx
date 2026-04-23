import { redirect } from "next/navigation";
import { listBackendAgencies } from "../../lib/server/backendApi";
import { requireDashboardSession } from "../../lib/auth/session";

type SelectAgencyPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatStatusLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getErrorMessage(errorValue: string | string[] | undefined): string | null {
  if (errorValue === "agency_required") {
    return "Select an agency to continue.";
  }
  if (errorValue === "agency_not_allowed") {
    return "That agency is not available for this QA user.";
  }
  return null;
}

export default async function SelectAgencyPage({ searchParams }: SelectAgencyPageProps) {
  const session = await requireDashboardSession();
  const resolvedSearchParams = await searchParams;
  const changeAgencyRequested = resolvedSearchParams?.change === "1";
  if (session.selectedAgencyId && !changeAgencyRequested) {
    redirect("/agency");
  }

  const agencies = (await listBackendAgencies()).filter((agency) =>
    session.allowedAgencyIds.includes(agency.id),
  );
  const error = getErrorMessage(resolvedSearchParams?.error);

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Agency Queue</p>
          <h1 className="page-title">Choose an agency</h1>
          <p className="page-subtitle">
            Select the agency queue you want to review. You will only see agencies assigned to your QA account.
          </p>
        </div>
        <div className="actions">
          <form action="/auth/logout" method="post">
            <button className="button secondary" type="submit">Sign Out</button>
          </form>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}

      <section className="grid three">
        {agencies.map((agency) => (
          <form key={agency.id} className="panel stack" action="/auth/select-agency" method="post">
            <input name="agencyId" type="hidden" value={agency.id} />
            <div className="metric-label">Agency</div>
            <div className="metric-value compact">{agency.name}</div>
            <div className="muted">Timezone: {agency.timezone}</div>
            <div className="muted">Queue status: {formatStatusLabel(agency.status)}</div>
            {session.selectedAgencyId === agency.id ? (
              <div className="badge">Current Selection</div>
            ) : null}
            <div className="actions">
              <button className="button" type="submit">Load Agency</button>
            </div>
          </form>
        ))}
      </section>
    </main>
  );
}
