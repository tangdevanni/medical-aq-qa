import Link from "next/link";

export default function NewRunPage() {
  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Autonomous Refresh</p>
          <h1 className="page-title">Workbook intake is backend-managed</h1>
          <p className="page-subtitle">
            QA users no longer upload workbooks from the dashboard. After sign-in and agency selection, the UI reads the agency-scoped workbook queue and scheduled refresh outputs that the backend maintains automatically.
          </p>
        </div>
        <div className="actions">
          <Link className="button secondary" href="/agency">
            Back to Agency Overview
          </Link>
        </div>
      </div>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">15-Day Queue</span>
          <h2>Autonomous agency-scoped processing</h2>
          <p>
            The backend owns workbook acquisition, queue normalization, patient vetting, and scheduled portal refresh. The dashboard is read-only and should never imply that a QA user has to trigger scraping or upload a file every session.
          </p>
        </div>

        <div className="hero-form">
          <div className="field">
            <span>Refresh schedule</span>
            <div>3:00 PM and 11:30 PM Asia/Manila</div>
          </div>
          <div className="field">
            <span>Queue source</span>
            <div>Active workbook review window from the configured agency source path</div>
          </div>
          <div className="field">
            <span>Eligibility policy</span>
            <div>Skip non-admits and pending patients before creating comparisons</div>
          </div>
        </div>
      </section>
    </main>
  );
}
