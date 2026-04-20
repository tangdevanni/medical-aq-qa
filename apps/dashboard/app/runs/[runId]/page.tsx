"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createSampleRun, getRun } from "../../../lib/api";
import {
  batchStatusClass,
  discrepancyBadgeClass,
  discrepancyLabel,
  formatDaysLeft,
  formatTimestamp,
} from "../../../lib/qa";
import type { RunDetail } from "../../../lib/types";

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const router = useRouter();
  const runId = params.runId;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startingSample, setStartingSample] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadRun(): Promise<void> {
      try {
        const nextRun = await getRun(runId);
        if (!active) {
          return;
        }
        setRun(nextRun);
        setError(null);
      } catch (nextError) {
        if (!active) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load batch.");
      }
    }

    void loadRun();
    const interval = window.setInterval(() => {
      void loadRun();
    }, 2500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [runId]);

  const metrics = useMemo(
    () => ({
      dueNowOrOverdue:
        run?.patients.filter((patient) => (patient.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER) <= 0)
          .length ?? 0,
      referralDataReady:
        run?.patients.filter((patient) => patient.referralQa.referralDataAvailable).length ?? 0,
      redDiscrepancies:
        run?.patients.filter((patient) => patient.dashboardReview.severity === "red").length ?? 0,
      yellowDiscrepancies:
        run?.patients.filter((patient) => patient.dashboardReview.severity === "yellow").length ?? 0,
      totalOpenRows:
        run?.patients.reduce((total, patient) => total + patient.dashboardReview.openRowCount, 0) ?? 0,
    }),
    [run],
  );

  async function handleStartSampleRun(): Promise<void> {
    setStartingSample(true);
    try {
      const sampleRun = await createSampleRun(runId, { limit: 5 });
      setError(null);
      router.push(`/runs/${sampleRun.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start sample run.");
      setStartingSample(false);
    }
  }

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <Link className="link" href="/agency">
            Back to agency overview
          </Link>
          <h1 className="page-title">{runId}</h1>
          <p className="page-subtitle">
            Patient queue for referral-vs-portal review. Open a patient to see what the referral supports, what the portal is missing, and where human review is still required inside the currently selected agency.
          </p>
          {run ? <p className="muted">Active subsidiary: {run.subsidiaryName}</p> : null}
        </div>
        <div className="actions">
          <button className="button" disabled={startingSample} onClick={() => void handleStartSampleRun()} type="button">
            {startingSample ? "Starting 5-patient test..." : "Run 5-Patient OCR Test"}
          </button>
          <form action="/auth/logout" method="post">
            <button className="button secondary" type="submit">
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {!run ? <div className="panel muted">Loading run...</div> : null}

      {run ? (
        <>
          <section className="grid four">
            <div className="panel">
                <div className="metric-label">Batch Status</div>
              <div className="metric-value">
                <span className={batchStatusClass(run.status)}>{run.status}</span>
              </div>
              <div className="muted">{run.totalWorkItems} patients</div>
            </div>
            <div className="panel">
              <div className="metric-label">Days Left Attention</div>
              <div className="metric-value">{metrics.dueNowOrOverdue}</div>
              <div className="muted">Patients due now or overdue for OASIS timing.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Referral Data Acquired</div>
              <div className="metric-value">{metrics.referralDataReady}</div>
              <div className="muted">Patients with usable referral QA data available.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Discrepancy Queue</div>
              <div className="metric-value">
                {metrics.totalOpenRows}
              </div>
              <div className="muted">
                {metrics.redDiscrepancies} high-risk patients, {metrics.yellowDiscrepancies} moderate-risk patients.
              </div>
            </div>
          </section>

          <section className="grid four">
            <div className="panel">
              <div className="metric-label">Run Mode</div>
              <div className="metric-value compact">{run.runMode.replace("_", " ")}</div>
            </div>
            <div className="panel">
              <div className="metric-label">Last Run</div>
              <div className="metric-value compact">{formatTimestamp(run.lastRunAt)}</div>
            </div>
            <div className="panel">
              <div className="metric-label">Next Scheduled</div>
              <div className="metric-value compact">
                {run.rerunEnabled ? formatTimestamp(run.nextScheduledRunAt) : "Disabled"}
              </div>
            </div>
            <div className="panel">
              <div className="metric-label">Read-only Summary</div>
              <div className="metric-value compact">
                {run.patientStatusSummary.ready} ready
              </div>
              <div className="muted">
                {run.patientStatusSummary.blocked + run.patientStatusSummary.failed + run.patientStatusSummary.needsManualReview} backend processing exceptions
              </div>
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Patients</h2>
                <p className="page-subtitle">
                  Patient-level triage for comparison quality, portal gaps, and referral-backed correction candidates.
                </p>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Patient Name</th>
                  <th>Days Left</th>
                  <th>Referral Data</th>
                  <th>QA Status</th>
                  <th>Discrepancies</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {run.patients.map((patient) => (
                  <tr key={patient.workItemId}>
                    <td>
                      <Link className="link" href={`/runs/${run.id}/patients/${patient.workItemId}`}>
                        {patient.patientName}
                      </Link>
                      <div className="muted">{patient.subsidiaryName}</div>
                    </td>
                    <td>{formatDaysLeft(patient.daysLeftBeforeOasisDueDate)}</td>
                    <td>
                      <span
                        className={
                          patient.referralQa.referralDataAvailable &&
                          patient.referralQa.extractionUsabilityStatus === "usable"
                            ? "badge success"
                            : patient.referralQa.referralDataAvailable
                              ? "badge warning"
                              : "badge danger"
                        }
                      >
                        {patient.referralQa.referralDataAvailable
                          ? patient.referralQa.extractionUsabilityStatus === "usable"
                            ? "Acquired"
                            : patient.referralQa.extractionUsabilityStatus
                          : "Missing"}
                      </span>
                      <div className="muted">
                        {patient.referralQa.availableSectionCount}/{patient.referralQa.totalSectionCount} sections organized
                      </div>
                    </td>
                    <td>
                      <div>{patient.referralQa.qaStatus}</div>
                      <div className="muted">
                        {patient.batchStatusSummary} | Updated {formatTimestamp(patient.lastUpdatedAt)}
                      </div>
                    </td>
                    <td>
                      <span className={discrepancyBadgeClass(patient.dashboardReview.severity)}>
                        {discrepancyLabel(patient.dashboardReview.severity)}
                      </span>
                      <div className="muted">
                        {patient.dashboardReview.openRowCount} open | {patient.dashboardReview.highPriorityOpenCount} high priority
                      </div>
                    </td>
                    <td className="table-action-cell">
                      <Link
                        className="button secondary compact"
                        href={`/runs/${run.id}/patients/${patient.workItemId}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </main>
  );
}
