"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listRuns } from "../../lib/api";
import { batchStatusClass } from "../../lib/qa";
import type { RunListItem } from "../../lib/types";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadRuns(): Promise<void> {
      try {
        const nextRuns = await listRuns();
        if (!active) {
          return;
        }
        setRuns(nextRuns);
        setError(null);
        setLoading(false);
      } catch (nextError) {
        if (!active) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load batches.");
        setLoading(false);
      }
    }

    void loadRuns();
    const interval = window.setInterval(() => {
      void loadRuns();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const summary = useMemo(
    () => ({
      activeSchedules: runs.filter((run) => run.rerunEnabled).length,
      running: runs.filter((run) => run.status === "RUNNING").length,
      dueAttention: runs.reduce(
        (total, run) => total + run.totalBlocked + run.totalFailed + run.totalNeedsHumanReview,
        0,
      ),
    }),
    [runs],
  );

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Referral QA Dashboard</p>
          <h1 className="page-title">Referral Comparison Runs</h1>
          <p className="page-subtitle">
            Read-only runs that pull referral evidence, compare it against the portal, and surface patient charts that need correction or manual review.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/runs/new">
            Upload Workbook
          </Link>
        </div>
      </div>

      <section className="grid three">
        <div className="panel">
          <div className="metric-label">Total runs</div>
          <div className="metric-value">{runs.length}</div>
          <div className="muted">Comparison runs retained for referral-vs-portal review.</div>
        </div>
        <div className="panel">
          <div className="metric-label">Scheduled reruns</div>
          <div className="metric-value">{summary.activeSchedules}</div>
          <div className="muted">Runs configured to refresh referral comparison automatically.</div>
        </div>
        <div className="panel">
          <div className="metric-label">Flagged patients</div>
          <div className="metric-value">{summary.dueAttention}</div>
          <div className="muted">Patients blocked, failed, or still requiring human reconciliation.</div>
        </div>
      </section>

      <section className="panel stack">
        <div className="page-header">
          <div>
            <h2>Run Queue</h2>
            <p className="page-subtitle">
              Each run shows the current comparison cycle, the patient volume under review, and when the next refresh will occur.
            </p>
          </div>
        </div>

        {loading ? <div className="muted">Loading batches...</div> : null}
        {error ? <div className="badge danger">{error}</div> : null}

        {!loading && runs.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Patients</th>
                <th>Last Run</th>
                <th>Next Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="link" href={`/runs/${run.id}`}>
                      {run.id}
                    </Link>
                    <div className="muted">
                      {run.subsidiaryName} · {run.billingPeriod ?? "No billing period"}
                    </div>
                  </td>
                  <td>
                    <span className={batchStatusClass(run.status)}>{run.status}</span>
                    <div className="muted">{run.currentExecutionStep}</div>
                  </td>
                  <td>
                    {run.totalWorkItems}
                    <div className="muted">
                      {run.totalCompleted} ready, {run.totalBlocked + run.totalFailed + run.totalNeedsHumanReview} attention
                    </div>
                  </td>
                  <td>{formatTimestamp(run.lastRunAt)}</td>
                  <td>
                    {run.rerunEnabled ? formatTimestamp(run.nextScheduledRunAt) : "Disabled"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {!loading && runs.length === 0 ? <div className="muted">No referral comparison runs have been created yet.</div> : null}
      </section>
    </main>
  );
}
