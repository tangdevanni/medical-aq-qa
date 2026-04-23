import type { DashboardPatientRecord, QueueEntryStatus } from "@medical-ai-qa/shared-types";
import Link from "next/link";
import { getBackendAgencyDashboard } from "../../lib/server/backendApi";
import { requireSelectedAgencySession } from "../../lib/auth/session";
import { formatTimestamp } from "../../lib/qa";
import AgencyLiveRefresh from "./AgencyLiveRefresh";
import { getQaReadiness, getSourceCoverage, queueStatusBadgeClass } from "./patientBoardState";

function formatStatusLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatScheduleLabel(times: string[], timezone: string): string {
  if (times.length === 0) {
    return timezone;
  }

  if (times.length === 1) {
    return `${times[0]} ${timezone}`;
  }

  return `${times.join(" and ")} ${timezone}`;
}

function hasLiveBackendWork(input: {
  refreshCycleStatus: "pending" | "running" | "completed" | "failed" | null;
  patientRecords: DashboardPatientRecord[];
}): boolean {
  if (input.refreshCycleStatus === "pending" || input.refreshCycleStatus === "running") {
    return true;
  }

  return input.patientRecords.some((record) =>
    record.processingStatus !== null &&
    ["PENDING", "MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      record.processingStatus,
    ));
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
      detail: "The latest data refresh failed. Review the run before using this queue for QA.",
    };
  }

  if (input.status === "running") {
    return {
      label: "Refresh running",
      className: "badge warning",
      detail: "New workbook and patient review data is being collected. The dashboard will update as results become available.",
    };
  }

  if (!input.lastRefreshCompletedAt) {
    return {
      label: "Awaiting first refresh",
      className: "badge warning",
      detail: "No completed data refresh has been recorded for this agency yet.",
    };
  }

  if (input.nextRefreshAt && Date.parse(input.nextRefreshAt) <= Date.now()) {
    return {
      label: "Refresh overdue",
      className: "badge danger",
      detail: "The next scheduled refresh time has passed without a completed update.",
    };
  }

  return {
    label: "Data current",
    className: "badge success",
    detail: "The dashboard is showing the latest processed agency data.",
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
  const liveRefreshEnabled = hasLiveBackendWork({
    refreshCycleStatus: refreshCycle?.status ?? null,
    patientRecords,
  });
  const patientNeedsDocumentationFollowUp = (record: DashboardPatientRecord): boolean =>
    record.missingReferralDocumentation;
  const patientsMissingReferralDocumentation = patientRecords.filter(patientNeedsDocumentationFollowUp);
  const missingReferralDocumentationCount = patientsMissingReferralDocumentation.length;
  const readyForQaCount = patientRecords.filter((record) => getQaReadiness(record).label === "Ready for QA").length;
  const blockedQaCount = patientRecords.filter((record) => getQaReadiness(record).label === "Blocked").length;
  const oasOnlyCount = patientRecords.filter((record) => getSourceCoverage(record).label === "OASIS only").length;

  return (
    <main className="page-shell stack">
      <AgencyLiveRefresh enabled={liveRefreshEnabled} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Agency QA Workspace</p>
          <h1 className="page-title">{snapshot.agency.name}</h1>
          <p className="page-subtitle">
            Review patients ready for QA, identify missing referral documentation, and open patient-level OASIS and referral comparisons.
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
            <div className="panel">
              <div className="metric-label">Ready for QA</div>
              <div className="metric-value">{readyForQaCount}</div>
              <div className="muted">Patients whose current QA outcome is ready for review.</div>
            </div>
            <div className="panel">
              <div className="metric-label">OASIS Only</div>
              <div className="metric-value">{oasOnlyCount}</div>
              <div className="muted">Patients with OASIS-backed detail available but missing referral support.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Blocked</div>
              <div className="metric-value">{blockedQaCount}</div>
              <div className="muted">Patients blocked by portal matching or another hard stop.</div>
            </div>
          </section>

          <section className="grid three">
            <div className="panel stack workspace-info-card">
              <div className="panel-header-inline">
                <h2>Data Refresh</h2>
                <span className={refreshHealth?.className ?? "badge"}>{refreshHealth?.label ?? "Unknown"}</span>
              </div>
              <p className="workspace-card-copy">{refreshHealth?.detail}</p>
              <div className="workspace-summary-grid">
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Last Start</span>
                  <strong>{formatTimestamp(refreshCycle.lastRefreshStartedAt)}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Last Complete</span>
                  <strong>{formatTimestamp(refreshCycle.lastRefreshCompletedAt)}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Next Refresh</span>
                  <strong>{formatTimestamp(refreshCycle.nextRefreshAt)}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Schedule</span>
                  <strong>{formatScheduleLabel(refreshCycle.scheduleLocalTimes, refreshCycle.scheduleTimezone)}</strong>
                </div>
              </div>
              <details className="workspace-technical-details">
                <summary>Run Details</summary>
                <div className="workspace-detail-list">
                  <div>
                    <span className="workspace-summary-label">Cycle Id</span>
                    <strong>{refreshCycle.id}</strong>
                  </div>
                  <div>
                    <span className="workspace-summary-label">Batch Id</span>
                    <strong>{refreshCycle.batchId}</strong>
                  </div>
                </div>
              </details>
            </div>

            <div className="panel stack workspace-info-card">
              <div className="panel-header-inline">
                <h2>Workbook</h2>
                <div className="badge-row">
                  <span className="badge">{formatStatusLabel(refreshCycle.workbookSource.kind)}</span>
                  <span className={workbookHealth?.className ?? "badge"}>{workbookHealth?.label ?? "Unknown"}</span>
                </div>
              </div>
              <div className="workspace-source-title">
                <strong>{refreshCycle.workbookSource.originalFileName}</strong>
                <span className="muted">{refreshCycle.workbookSource.sourceLabel}</span>
              </div>
              <div className="workspace-summary-grid">
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Acquired</span>
                  <strong>{formatTimestamp(refreshCycle.workbookSource.acquiredAt)}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Ingested</span>
                  <strong>{formatTimestamp(refreshCycle.workbookSource.ingestedAt)}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Provider</span>
                  <strong>{workbookAcquisition?.providerId ?? "Unknown"}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Finale Agency</span>
                  <strong>{workbookAcquisition?.selectedAgencyName ?? "Not recorded"}</strong>
                </div>
              </div>
              {workbookVerification ? (
                <div className="workspace-summary-grid">
                  <div className="workspace-summary-item">
                    <span className="workspace-summary-label">Verified</span>
                    <strong>{formatTimestamp(workbookVerification.verifiedAt)}</strong>
                  </div>
                  <div className="workspace-summary-item">
                    <span className="workspace-summary-label">Workbook Size</span>
                    <strong>{workbookVerification.fileSizeBytes.toLocaleString()} bytes</strong>
                  </div>
                  <div className="workspace-summary-item">
                    <span className="workspace-summary-label">Format</span>
                    <strong>{workbookVerification.fileExtension}</strong>
                  </div>
                  <div className="workspace-summary-item">
                    <span className="workspace-summary-label">Recognized Sheet Types</span>
                    <strong>{workbookVerification.detectedSourceTypes.join(", ") || "None detected"}</strong>
                  </div>
                </div>
              ) : null}
              <details className="workspace-technical-details">
                <summary>Source Details</summary>
                <div className="workspace-detail-list">
                  {workbookVerification ? (
                    <>
                      <div>
                        <span className="workspace-summary-label">Sheets</span>
                        <strong>{workbookVerification.sheetNames.join(", ") || "None detected"}</strong>
                      </div>
                    </>
                  ) : null}
                  {workbookAcquisition && workbookAcquisition.notes.length > 0 ? (
                    <div className="workspace-note-list">
                      {workbookAcquisition.notes.map((note) => (
                        <div key={note}>{note}</div>
                      ))}
                    </div>
                  ) : null}
                  <div>
                    <span className="workspace-summary-label">Source Path</span>
                    <strong className="workspace-breakable">{refreshCycle.workbookSource.path}</strong>
                  </div>
                  {workbookAcquisition?.dashboardUrl ? (
                    <div>
                      <span className="workspace-summary-label">Dashboard URL</span>
                      <strong className="workspace-breakable">{workbookAcquisition.dashboardUrl}</strong>
                    </div>
                  ) : null}
                </div>
              </details>
            </div>

            <div className="panel stack workspace-info-card">
              <div className="panel-header-inline">
                <h2>Queue Rules</h2>
                <span className="badge">{refreshCycle.reviewWindow.durationDays}-day window</span>
              </div>
              <p className="workspace-card-copy">
                The workbook defines which patients are in scope for the current QA review queue.
              </p>
              <div className="workspace-summary-grid">
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Review Window</span>
                  <strong>{refreshCycle.reviewWindow.label}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Eligible</span>
                  <strong>{refreshCycle.queueSummary.eligible}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Skipped Pending</span>
                  <strong>{refreshCycle.queueSummary.skippedPending}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span className="workspace-summary-label">Skipped Non-Admit</span>
                  <strong>{refreshCycle.queueSummary.skippedNonAdmit}</strong>
                </div>
              </div>
              <div className="workspace-rule-list">
                <div className="workspace-rule-item"><strong>Evaluate</strong><span>Patients inside the active review window.</span></div>
                <div className="workspace-rule-item"><strong>Skip</strong><span>Rows marked pending or non-admit.</span></div>
                <div className="workspace-rule-item"><strong>Retain</strong><span>Workbook source, agency context, timestamps, and queue reason.</span></div>
              </div>
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Patient Queue</h2>
                <p className="page-subtitle">
                  This queue is the QA readiness board. Use it to see who is ready for QA, who only has OASIS available, and who is still blocked before opening the patient detail workspace.
                </p>
              </div>
              <div className="badge-row">
                <span className="badge">{refreshCycle.queueSummary.total} total</span>
                <span className="badge success">{refreshCycle.queueSummary.eligible} eligible</span>
                <span className="badge warning">{refreshCycle.queueSummary.skippedPending} pending</span>
              </div>
            </div>

            {missingReferralDocumentationCount > 0 ? (
              <div className="documentation-alert">
                <div className="documentation-alert-header">
                  <div>
                    <strong>Missing Referral Documentation</strong>
                    <div className="muted">
                      {missingReferralDocumentationCount} patient{missingReferralDocumentationCount === 1 ? "" : "s"} already have OASIS-backed review data, but their referral documentation is still missing or incomplete.
                    </div>
                  </div>
                  <span className="badge danger">
                    {missingReferralDocumentationCount} requiring referral follow-up
                  </span>
                </div>
                <div className="documentation-alert-list">
                  {patientsMissingReferralDocumentation.slice(0, 6).map((record) => (
                    <span key={record.queueEntry.id} className="documentation-alert-chip">
                      {record.queueEntry.patientName}
                      {record.missingReferralFieldCount > 0
                        ? ` (${record.missingReferralFieldCount} field${record.missingReferralFieldCount === 1 ? "" : "s"})`
                        : ""}
                    </span>
                  ))}
                  {missingReferralDocumentationCount > 6 ? (
                    <span className="documentation-alert-chip documentation-alert-chip-muted">
                      +{missingReferralDocumentationCount - 6} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {patientRecords.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>QA Status</th>
                    <th>Documents</th>
                    <th>Dates</th>
                    <th>Processing</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {patientRecords.map((record) => {
                    const action = buildPatientAction(record);
                    const readiness = getQaReadiness(record);
                    const sourceCoverage = getSourceCoverage(record);
                    return (
                      <tr key={record.queueEntry.id}>
                        <td>
                          <strong>{record.queueEntry.patientName}</strong>
                          <div className="muted">
                            {record.queueEntry.workflowTypes.join(", ") || "No workflow type"}
                          </div>
                        </td>
                        <td>
                          <span className={readiness.className}>{readiness.label}</span>
                          {readiness.label === "Ready for QA" ? null : <div className="muted">{readiness.detail}</div>}
                        </td>
                        <td>
                          <span className={sourceCoverage.className}>{sourceCoverage.label}</span>
                          <div className="muted">{sourceCoverage.detail}</div>
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
                            <span className={queueStatusBadgeClass(record.queueEntry.status)}>
                              {formatStatusLabel(record.queueEntry.status)}
                            </span>
                          </div>
                          <div className="muted">
                            Processing: {record.processingStatus ? formatStatusLabel(record.processingStatus) : "Not started"}
                          </div>
                          {record.queueEntry.status === "eligible" ? null : (
                            <div className="muted">{record.queueEntry.eligibility.rationale}</div>
                          )}
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
