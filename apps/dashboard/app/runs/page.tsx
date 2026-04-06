"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listRuns } from "../../lib/api";
import { batchStatusClass } from "../../lib/qa";
import type { RunListItem } from "../../lib/types";

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
        setError(nextError instanceof Error ? nextError.message : "Failed to load runs.");
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
      running: runs.filter((run) => run.status === "RUNNING").length,
      completed: runs.filter((run) => run.status === "COMPLETED" || run.status === "COMPLETED_WITH_EXCEPTIONS").length,
      blockedPatients: runs.reduce((total, run) => total + run.totalBlocked, 0),
    }),
    [runs],
  );

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Demo Operations</p>
          <h1 className="page-title">QA Runs</h1>
          <p className="page-subtitle">
            Near-live run monitoring for uploaded Finale workbooks and patient-by-patient QA execution.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/runs/new">
            New Run
          </Link>
        </div>
      </div>

      <section className="grid three">
        <div className="panel">
          <div className="metric-label">Total runs</div>
          <div className="metric-value">{runs.length}</div>
          <div className="muted">Uploaded workbook runs retained in the control plane.</div>
        </div>
        <div className="panel">
          <div className="metric-label">Running now</div>
          <div className="metric-value">{summary.running}</div>
          <div className="muted">Actively polling live patient execution progress.</div>
        </div>
        <div className="panel">
          <div className="metric-label">Blocked patients</div>
          <div className="metric-value">{summary.blockedPatients}</div>
          <div className="muted">Patients currently blocked by portal, matching, or QA conditions.</div>
        </div>
      </section>

      <section className="panel stack">
        <div className="page-header">
          <div>
            <h2>Run List</h2>
            <p className="page-subtitle">
              Each row shows run status, timing, and aggregate patient counts for the demo workflow.
            </p>
          </div>
        </div>

        {loading ? <div className="muted">Loading runs...</div> : null}
        {error ? <div className="badge danger">{error}</div> : null}

        {!loading && runs.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Patients</th>
                <th>Completed</th>
                <th>Blocked</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="link" href={`/runs/${run.id}`}>
                      {run.id}
                    </Link>
                    <div className="muted">{run.billingPeriod ?? "No billing period"}</div>
                  </td>
                  <td>
                    <span className={batchStatusClass(run.status)}>{run.status}</span>
                    <div className="muted">{run.currentExecutionStep}</div>
                  </td>
                  <td>
                    {run.totalWorkItems}
                    <div className="muted">{run.eligibleWorkItemCount} eligible</div>
                  </td>
                  <td>{run.totalCompleted}</td>
                  <td>{run.totalBlocked + run.totalFailed + run.totalNeedsHumanReview}</td>
                  <td>{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {!loading && runs.length === 0 ? <div className="muted">No runs have been created yet.</div> : null}
      </section>
    </main>
  );
}
