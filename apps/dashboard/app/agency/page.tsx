import type { DashboardPatientRecord, QueueEntryStatus } from "@medical-ai-qa/shared-types";
import Link from "next/link";
import { getBackendAgencyDashboard } from "../../lib/server/backendApi";
import { requireSelectedAgencySession } from "../../lib/auth/session";
import { formatTimestamp } from "../../lib/qa";

function formatStatusLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function queueStatusBadgeClass(status: QueueEntryStatus): string {
  if (status === "eligible") {
    return "badge success";
  }
  if (status === "skipped_pending") {
    return "badge warning";
  }
  if (status === "excluded_other") {
    return "badge danger";
  }
  return "badge";
}

function getRefreshHealth(input: {
  status: "pending" | "running" | "completed" | "failed";
  lastRefreshCompletedAt: string | null;
  nextRefreshAt: string | null;
}): { label: string; className: string; detail: string } {
  if (input.status === "failed") {
    return {
      label: "Refresh failed",
      className: "badge danger",
      detail: "The last autonomous refresh failed and needs backend attention.",
    };
  }

  if (input.status === "running") {
    return {
      label: "Refresh running",
      className: "badge warning",
      detail: "The backend is actively rebuilding workbook and patient comparison data.",
    };
  }

  if (!input.lastRefreshCompletedAt) {
    return {
      label: "Awaiting first refresh",
      className: "badge warning",
      detail: "Workbook intake is configured, but the first completed refresh has not been recorded yet.",
    };
  }

  if (input.nextRefreshAt && Date.parse(input.nextRefreshAt) <= Date.now()) {
    return {
      label: "Refresh overdue",
      className: "badge danger",
      detail: "The next scheduled refresh time has passed without a completed cycle.",
    };
  }

  return {
    label: "Autonomous refresh healthy",
    className: "badge success",
    detail: "The dashboard is reading the latest processed agency data from the scheduled backend cycle.",
  };
}

function getWorkbookVerificationLabel(input: {
  verification: { usable: boolean; warningCount: number } | null;
  refreshStatus: "pending" | "running" | "completed" | "failed";
}): { label: string; className: string } {
  if (!input.verification) {
    return {
      label: input.refreshStatus === "failed" ? "Verification missing" : "Awaiting verification",
      className: input.refreshStatus === "failed" ? "badge danger" : "badge warning",
    };
  }

  if (!input.verification.usable) {
    return {
      label: "Workbook unusable",
      className: "badge danger",
    };
  }

  if (input.verification.warningCount > 0) {
    return {
      label: `Verified with ${input.verification.warningCount} warning${input.verification.warningCount === 1 ? "" : "s"}`,
      className: "badge warning",
    };
  }

  return {
    label: "Workbook verified",
    className: "badge success",
  };
}

function buildPatientAction(record: DashboardPatientRecord): { href: string; label: string } | null {
  if (record.runId && record.patientId && record.queueEntry.status === "eligible") {
    return {
      href: `/runs/${record.runId}/patients/${record.patientId}`,
      label: "Open patient",
    };
  }

  if (record.runId) {
    return {
      href: `/runs/${record.runId}`,
      label: "View run",
    };
  }

  return null;
}

function compareRecords(left: DashboardPatientRecord, right: DashboardPatientRecord): number {
  const statusOrder: Record<QueueEntryStatus, number> = {
    eligible: 0,
    skipped_pending: 1,
    skipped_non_admit: 2,
    excluded_other: 3,
  };

  const leftOrder = statusOrder[left.queueEntry.status] ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = statusOrder[right.queueEntry.status] ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.queueEntry.patientName.localeCompare(right.queueEntry.patientName);
}

type AgencyDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getAgencyPageNotice(input: string | string[] | undefined): {
  className: string;
  message: string;
} | null {
  if (input === "started") {
    return {
      className: "badge success",
      message: "Manual agency refresh started. The backend is reacquiring the workbook and rebuilding the queue for the selected agency.",
    };
  }

  if (!input) {
    return null;
  }

  const message = Array.isArray(input) ? input[0] : input;
  if (!message) {
    return null;
  }

  const knownMessages: Record<string, string> = {
    refresh_agency_required: "Choose an agency before starting a manual refresh.",
    refresh_agency_not_allowed: "This QA user is not allowed to refresh that agency.",
    unsupported_session_action: "The requested dashboard session action is not supported.",
  };

  return {
    className: "badge danger",
    message: knownMessages[message] ?? message,
  };
}

export default async function AgencyDashboardPage({ searchParams }: AgencyDashboardPageProps) {
  const session = await requireSelectedAgencySession();
  const snapshot = await getBackendAgencyDashboard(session.selectedAgencyId!);
  const resolvedSearchParams = await searchParams;
  const agencyPageNotice =
    getAgencyPageNotice(resolvedSearchParams?.refresh) ??
    getAgencyPageNotice(resolvedSearchParams?.error);
  const refreshCycle = snapshot.refreshCycle;
  const patientRecords = [...snapshot.patientRecords].sort(compareRecords);
  const workbookAcquisition = refreshCycle
    ? refreshCycle.workbookSource.acquisition ?? {
        providerId: null,
        acquisitionReference: null,
        metadataPath: null,
        selectedAgencyName: null,
        selectedAgencyUrl: null,
        dashboardUrl: null,
        notes: [],
      }
    : null;
  const workbookVerification = refreshCycle?.workbookSource.verification ?? null;
  const refreshHealth = refreshCycle
    ? getRefreshHealth({
        status: refreshCycle.status,
        lastRefreshCompletedAt: refreshCycle.lastRefreshCompletedAt,
        nextRefreshAt: refreshCycle.nextRefreshAt,
      })
    : null;
  const workbookHealth = refreshCycle
    ? getWorkbookVerificationLabel({
        verification: workbookVerification,
        refreshStatus: refreshCycle.status,
      })
    : null;

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Agency QA Workspace</p>
          <h1 className="page-title">{snapshot.agency.name}</h1>
          <p className="page-subtitle">
            Dashboard access is authenticated separately from portal automation. QA users select an agency, and the dashboard reads that agency&apos;s workbook-driven 15-day review window plus the already-running autonomous refresh data.
          </p>
          <div className="workspace-context-row">
            <span>Selected agency: {snapshot.agency.slug}</span>
            <span>Timezone: {snapshot.agency.timezone}</span>
            <span>Last updated: {formatTimestamp(snapshot.lastUpdatedAt)}</span>
          </div>
        </div>
        <div className="actions">
          <form action="/api/session" method="post">
            <input name="action" type="hidden" value="refresh_agency" />
            <input name="agencyId" type="hidden" value={snapshot.agency.id} />
            <button className="button" type="submit">
              Run Agency Refresh
            </button>
          </form>
          <Link className="button secondary" href="/select-agency?change=1">
            Change Agency
          </Link>
          <form action="/auth/logout" method="post">
            <button className="button" type="submit">
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {agencyPageNotice ? <div className={agencyPageNotice.className}>{agencyPageNotice.message}</div> : null}

      {refreshCycle ? (
        <>
          <section className="grid four">
            <div className="panel">
              <div className="metric-label">Eligible Patients</div>
              <div className="metric-value">{refreshCycle.queueSummary.eligible}</div>
              <div className="muted">Only eligible workbook entries create patient comparison runs.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Skipped Pending</div>
              <div className="metric-value">{refreshCycle.queueSummary.skippedPending}</div>
              <div className="muted">Pending patients stay out of autonomous QA until their status changes.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Skipped Non-Admit</div>
              <div className="metric-value">{refreshCycle.queueSummary.skippedNonAdmit}</div>
              <div className="muted">Non-admit rows remain visible for auditability but are not evaluated.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Review Window</div>
              <div className="metric-value compact">{refreshCycle.reviewWindow.label}</div>
              <div className="muted">
                {refreshCycle.reviewWindow.durationDays}-day workbook-driven review cycle
              </div>
            </div>
          </section>

          <section className="grid three">
            <div className="panel stack">
              <div className="panel-header-inline">
                <h2>Autonomous Refresh</h2>
                <span className={refreshHealth?.className ?? "badge"}>{refreshHealth?.label ?? "Unknown"}</span>
              </div>
              <div className="muted">{refreshHealth?.detail}</div>
              <div className="workspace-context-row">
                <span>Last start: {formatTimestamp(refreshCycle.lastRefreshStartedAt)}</span>
                <span>Last complete: {formatTimestamp(refreshCycle.lastRefreshCompletedAt)}</span>
                <span>Next refresh: {formatTimestamp(refreshCycle.nextRefreshAt)}</span>
              </div>
              <div className="workspace-context-row">
                <span>Schedule: {refreshCycle.scheduleLocalTimes.join(" and ")} {refreshCycle.scheduleTimezone}</span>
                <span>Cycle id: {refreshCycle.id}</span>
                <span>Batch: {refreshCycle.batchId}</span>
              </div>
            </div>

            <div className="panel stack">
              <div className="panel-header-inline">
                <h2>Workbook Source</h2>
                <div className="badge-row">
                  <span className="badge">{formatStatusLabel(refreshCycle.workbookSource.kind)}</span>
                  <span className={workbookHealth?.className ?? "badge"}>{workbookHealth?.label ?? "Unknown"}</span>
                </div>
              </div>
              <div>
                <strong>{refreshCycle.workbookSource.originalFileName}</strong>
              </div>
              <div className="muted">{refreshCycle.workbookSource.sourceLabel}</div>
              <div className="workspace-context-row">
                <span>Acquired: {formatTimestamp(refreshCycle.workbookSource.acquiredAt)}</span>
                <span>Ingested: {formatTimestamp(refreshCycle.workbookSource.ingestedAt)}</span>
              </div>
              {workbookAcquisition?.selectedAgencyName ? (
                <div className="workspace-context-row">
                  <span>Finale agency: {workbookAcquisition.selectedAgencyName}</span>
                  <span>Provider: {workbookAcquisition.providerId ?? "Unknown"}</span>
                </div>
              ) : null}
              {workbookVerification ? (
                <>
                  <div className="workspace-context-row">
                    <span>Verified: {formatTimestamp(workbookVerification.verifiedAt)}</span>
                    <span>Size: {workbookVerification.fileSizeBytes.toLocaleString()} bytes</span>
                    <span>Format: {workbookVerification.fileExtension}</span>
                  </div>
                  <div className="muted">
                    Sheets: {workbookVerification.sheetNames.join(", ") || "None detected"}
                  </div>
                  <div className="muted">
                    Recognized QA sheets: {workbookVerification.detectedSourceTypes.join(", ") || "None detected"}
                  </div>
                </>
              ) : null}
              {workbookAcquisition && workbookAcquisition.notes.length > 0 ? (
                <div className="checklist compact-checklist">
                  {workbookAcquisition.notes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </div>
              ) : null}
              <div className="muted">Source path: {refreshCycle.workbookSource.path}</div>
            </div>

            <div className="panel stack">
              <div className="panel-header-inline">
                <h2>Queue Policy</h2>
                <span className="badge">15-day window</span>
              </div>
              <div className="muted">
                The workbook defines the active patient review scope. Eligibility is explicit and testable before any portal comparison run is created.
              </div>
              <div className="checklist compact-checklist">
                <div>Evaluate: workbook patients inside the active review window.</div>
                <div>Skip: status indicates non-admit.</div>
                <div>Skip: status indicates pending.</div>
                <div>Retain: workbook source, timestamps, agency, and queue reason.</div>
              </div>
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Patient Queue</h2>
                <p className="page-subtitle">
                  This queue is normalized from the active workbook. Eligible patients link into the existing run and patient drill-down pages. Skipped entries remain visible with explicit reasons.
                </p>
              </div>
              <div className="badge-row">
                <span className="badge">{refreshCycle.queueSummary.total} total</span>
                <span className="badge success">{refreshCycle.queueSummary.eligible} eligible</span>
                <span className="badge warning">{refreshCycle.queueSummary.skippedPending} pending</span>
              </div>
            </div>

            {patientRecords.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Queue Status</th>
                    <th>Eligibility Reason</th>
                    <th>Workbook Context</th>
                    <th>Backend Status</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {patientRecords.map((record) => {
                    const action = buildPatientAction(record);
                    return (
                      <tr key={record.queueEntry.id}>
                        <td>
                          <strong>{record.queueEntry.patientName}</strong>
                          <div className="muted">
                            {record.queueEntry.workflowTypes.join(", ") || "No workflow type"}
                          </div>
                        </td>
                        <td>
                          <span className={queueStatusBadgeClass(record.queueEntry.status)}>
                            {formatStatusLabel(record.queueEntry.status)}
                          </span>
                        </td>
                        <td>
                          <div>{record.queueEntry.eligibility.rationale}</div>
                          {record.queueEntry.eligibility.matchedSignals.length > 0 ? (
                            <div className="muted">
                              Signals: {record.queueEntry.eligibility.matchedSignals.join(", ")}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div>Episode: {record.queueEntry.episodeDate ?? "Not provided"}</div>
                          <div className="muted">SOC: {record.queueEntry.socDate ?? "Not provided"}</div>
                          <div className="muted">
                            Billing: {record.queueEntry.billingPeriod ?? "Not provided"}
                          </div>
                        </td>
                        <td>
                          <div>
                            {record.processingStatus ? formatStatusLabel(record.processingStatus) : "Not started"}
                          </div>
                          <div className="muted">Updated: {formatTimestamp(record.lastUpdatedAt)}</div>
                          {record.errorSummary ? <div className="muted">{record.errorSummary}</div> : null}
                        </td>
                        <td className="table-action-cell">
                          {action ? (
                            <Link className="button secondary compact" href={action.href}>
                              {action.label}
                            </Link>
                          ) : (
                            <span className="muted">No run</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="muted">No queue entries are available for the active workbook cycle yet.</div>
            )}
          </section>
        </>
      ) : (
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">Awaiting Intake</span>
            <h2>No active agency refresh cycle yet</h2>
            <p>
              This agency has no active workbook-driven queue on disk yet. Once the backend ingests the workbook from its configured source, the dashboard will load the review window, queue summary, and patient drill-down links automatically.
            </p>
          </div>
          <div className="hero-form">
            <div className="field">
              <span>Agency</span>
              <div>{snapshot.agency.name}</div>
            </div>
            <div className="field">
              <span>Timezone</span>
              <div>{snapshot.agency.timezone}</div>
            </div>
            <div className="field">
              <span>Last dashboard update</span>
              <div>{formatTimestamp(snapshot.lastUpdatedAt)}</div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
