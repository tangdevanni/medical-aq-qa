import type { DashboardPatientRecord, QueueEntryStatus } from "@medical-ai-qa/shared-types";
import Link from "next/link";
import { getBackendAgencyDashboard } from "../../lib/server/backendApi";
import { requireSelectedAgencySession } from "../../lib/auth/session";
import { formatTimestamp } from "../../lib/qa";
import AgencyLiveRefresh from "./AgencyLiveRefresh";
import { queueStatusBadgeClass } from "./patientBoardState";
import ReviewerStatusDot from "./ReviewerStatusDot";

function formatStatusLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatQueueStatusLabel(value: QueueEntryStatus): string {
  switch (value) {
    case "eligible":
      return "Eligible";
    case "skipped_pending":
      return "Pending";
    case "skipped_non_admit":
      return "Non-Admit";
    case "excluded_other":
      return "Excluded";
    default:
      return formatStatusLabel(value);
  }
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
    excluded_other: 1,
    skipped_pending: 2,
    skipped_non_admit: 3,
  };

  const leftOrder = statusOrder[left.queueEntry.status] ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = statusOrder[right.queueEntry.status] ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftDays = left.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
  const rightDays = right.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
  if (leftDays !== rightDays) {
    return leftDays - rightDays;
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const leftSeverity = left.topOasisIssue?.severity ?? left.topVisitNoteIssue?.severity ?? "low";
  const rightSeverity = right.topOasisIssue?.severity ?? right.topVisitNoteIssue?.severity ?? "low";
  const severityDelta = severityRank[leftSeverity] - severityRank[rightSeverity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  return left.queueEntry.patientName.localeCompare(right.queueEntry.patientName);
}

function getPipelineStage(record: DashboardPatientRecord): DashboardPatientRecord["pipelineStage"] {
  if (record.pipelineStage) {
    return record.pipelineStage;
  }
  if (record.queueEntry.status === "skipped_pending") {
    return "pending";
  }
  if (record.missingReferralDocumentation) {
    return "documentation";
  }
  if (
    record.oasisStage !== "ready_for_review" &&
    record.oasisStage !== "validated" &&
    record.oasisStage !== "not_applicable"
  ) {
    return "oasis";
  }
  return "plan_of_care_visit_notes";
}

function getPipelineStageView(record: DashboardPatientRecord): {
  label: string;
  className: string;
  detail: string;
} {
  if (record.queueEntry.status === "skipped_non_admit") {
    return {
      label: "Non-Admit",
      className: "badge",
      detail: "Patient is not processed because the workbook or portal status is Non-Admit.",
    };
  }
  if (record.queueEntry.status === "skipped_pending") {
    return {
      label: "Pending",
      className: "badge warning",
      detail: "Patient is not processed until the status is no longer Pending.",
    };
  }

  switch (getPipelineStage(record)) {
    case "pending":
      return {
        label: "Pending",
        className: "badge",
        detail: "Waiting to start QA processing.",
      };
    case "documentation":
      return {
        label: "Documentation",
        className: "badge warning",
        detail: "Referral or supporting documentation needs review.",
      };
    case "oasis":
      return {
        label: "OASIS",
        className: record.oasisStage === "oasis_not_filled_out" ? "badge danger" : "badge warning",
        detail: formatOasisStage(record.oasisStage),
      };
    case "plan_of_care_visit_notes":
      if (record.oasisStage === "validated") {
        return {
          label: "Visit Notes",
          className: "badge success",
          detail: "OASIS validated and Plan of Care generated.",
        };
      }
      return {
        label: "Visit Notes",
        className: "badge success",
        detail: "Plan of Care is ready; continue Visit Notes QA.",
      };
    default:
      return {
        label: "Pending",
        className: "badge",
        detail: "Waiting to start QA processing.",
      };
  }
}

function getVisitNoteReviewView(record: DashboardPatientRecord): {
  label: string;
  className: string;
  detail: string;
} | null {
  if (record.queueEntry.status !== "eligible") {
    return null;
  }

  switch (record.visitNoteReviewStatus) {
    case "new_visit_note_to_qa":
      return {
        label: "New Visit Note QA",
        className: "badge danger",
        detail: `${record.visitNoteActiveQaCount} active note${record.visitNoteActiveQaCount === 1 ? "" : "s"} need QA.`,
      };
    case "needs_review":
      return {
        label: "Visit Notes Need Review",
        className: "badge warning",
        detail: "Visit Note suggestions or POC alignment findings need review.",
      };
    case "reviewed":
      return {
        label: "Visit Notes Reviewed",
        className: "badge success",
        detail: "Captured Visit Notes have no open review signal.",
      };
    case "not_started":
      return {
        label: "Visit Notes Pending",
        className: "badge",
        detail: "Visit Notes are present but QA has not completed yet.",
      };
    default:
      return null;
  }
}

function formatDaysLeft(value: number | null): string {
  if (value === null) {
    return "Not provided";
  }
  if (value < 0) {
    return `${Math.abs(value)}d overdue`;
  }
  if (value === 0) {
    return "Due today";
  }
  return `${value}d left`;
}

function formatDashboardDaysLeft(record: DashboardPatientRecord): string {
  if (record.queueEntry.status !== "eligible") {
    return "Not applicable";
  }
  return formatDaysLeft(record.daysLeftBeforeOasisDueDate);
}

function formatDashboardOasisStage(record: DashboardPatientRecord): string {
  if (record.queueEntry.status === "skipped_non_admit") {
    return "Skipped: Non-Admit";
  }
  if (record.queueEntry.status === "skipped_pending") {
    return "Skipped: Pending";
  }
  return formatOasisStage(record.oasisStage);
}

function formatOasisStage(value: DashboardPatientRecord["oasisStage"]): string {
  switch (value) {
    case "oasis_not_filled_out":
      return "OASIS not filled";
    case "clinician_fill_later":
      return "Clinician fill later";
    case "scrape_and_prepare":
      return "Preparing";
    case "assist_oasis_fill":
      return "Assist fill";
    case "validated":
      return "Validated";
    case "ready_for_review":
      return "Review";
    case "pending_patient":
      return "Pending";
    default:
      return "Not applicable";
  }
}

function pendingFilterEnabled(input: string | string[] | undefined): boolean {
  const value = Array.isArray(input) ? input[0] : input;
  return value === "1" || value === "true";
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
  const showPending = pendingFilterEnabled(resolvedSearchParams?.showPending);
  const patientRecords = [...snapshot.patientRecords]
    .filter((record) => showPending || record.queueEntry.status !== "skipped_pending")
    .sort(compareRecords);
  const pendingPatientCount = snapshot.patientRecords.filter((record) => record.queueEntry.status === "skipped_pending").length;
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
  const dueSoonCount = patientRecords.filter((record) =>
    record.queueEntry.status === "eligible" &&
    record.daysLeftBeforeOasisDueDate !== null &&
    record.daysLeftBeforeOasisDueDate <= 15
  ).length;
  const oasisNotFilledCount = patientRecords.filter((record) => record.oasisStage === "oasis_not_filled_out").length;
  const documentationStageCount = patientRecords.filter((record) => getPipelineStage(record) === "documentation").length;
  const pocVisitNotesStageCount = patientRecords.filter((record) => getPipelineStage(record) === "plan_of_care_visit_notes").length;

  return (
    <main className="page-shell stack">
      <AgencyLiveRefresh enabled={liveRefreshEnabled} />
      <div className="page-header">
        <div>
          <h1 className="page-title">{snapshot.agency.name}</h1>
        </div>
        <div className="actions">
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
          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Patient Queue</h2>
                <p className="page-subtitle">
                  Pipeline rows show where each patient is in QA: pending, documentation, OASIS, or Plan of Care plus Visit Notes.
                </p>
              </div>
              <div className="badge-row">
                <span className="badge">{patientRecords.length} shown</span>
                <span className="badge success">{refreshCycle.queueSummary.eligible} eligible</span>
                {showPending ? (
                  <Link className="badge warning" href="/agency">
                    Hide pending
                  </Link>
                ) : (
                  <Link className="badge warning" href="/agency?showPending=1">
                    Show {pendingPatientCount} pending
                  </Link>
                )}
              </div>
            </div>

            {patientRecords.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Review</th>
                    <th>Patient</th>
                    <th>OASIS Due</th>
                    <th>Pipeline Stage</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {patientRecords.map((record) => {
                    const action = buildPatientAction(record);
                    const pipelineStage = getPipelineStageView(record);
                    const visitNoteReview = getVisitNoteReviewView(record);
                    return (
                      <tr key={record.queueEntry.id}>
                        <td>
                          <ReviewerStatusDot
                            workItemId={record.queueEntry.workItemId}
                            initialStatus={record.reviewerStatus}
                            updatedAt={record.reviewerStatusUpdatedAt}
                            updatedBy={record.reviewerStatusUpdatedBy}
                          />
                        </td>
                        <td>
                          <strong>{record.queueEntry.patientName}</strong>
                          <div className="muted">
                            {record.queueEntry.workflowTypes.join(", ") || "No workflow type"}
                          </div>
                          <div>
                            <span className={queueStatusBadgeClass(record.queueEntry.status)}>
                              {formatQueueStatusLabel(record.queueEntry.status)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong>{formatDashboardDaysLeft(record)}</strong>
                          <div className="muted">{formatDashboardOasisStage(record)}</div>
                          {record.queueEntry.status === "eligible" && record.daysSinceSoc !== null ? (
                            <div className="muted">{record.daysSinceSoc}d since SOC</div>
                          ) : null}
                        </td>
                        <td>
                          <span className={pipelineStage.className}>{pipelineStage.label}</span>
                          <div className="muted">{pipelineStage.detail}</div>
                          {visitNoteReview ? (
                            <div className="dashboard-pipeline-substatus">
                              <span className={visitNoteReview.className}>{visitNoteReview.label}</span>
                              <div className="muted">{visitNoteReview.detail}</div>
                            </div>
                          ) : null}
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
