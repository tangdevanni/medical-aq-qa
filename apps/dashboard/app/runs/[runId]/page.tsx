"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getRun } from "../../../lib/api";
import { batchStatusClass, formatDaysLeft } from "../../../lib/qa";
import type { DiagnosisEntry, RunDetail } from "../../../lib/types";

function renderDiagnosisLabel(input: DiagnosisEntry): string {
  const code = input.code?.trim() || "No code";
  const description = input.description?.trim() || "No description";
  return `${code} - ${description}`;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      missingDaysLeft:
        run?.patients.filter((patient) => patient.daysLeftBeforeOasisDueDate === null).length ?? 0,
      withPrimaryDiagnosis:
        run?.patients.filter((patient) => patient.primaryDiagnosis !== null).length ?? 0,
      withOtherDiagnoses:
        run?.patients.filter((patient) => patient.otherDiagnoses.length > 0).length ?? 0,
    }),
    [run],
  );

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <Link className="link" href="/runs">
            Back to batches
          </Link>
          <h1 className="page-title">{runId}</h1>
          <p className="page-subtitle">
            Read-only patient diagnosis reference for QA staff.
          </p>
          {run ? <p className="muted">Active subsidiary: {run.subsidiaryName}</p> : null}
        </div>
        <div className="actions">
          <Link className="button secondary" href="/runs/new">
            Upload Workbook
          </Link>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {!run ? <div className="panel muted">Loading batch...</div> : null}

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
              <div className="muted">{metrics.missingDaysLeft} patients missing workbook timing.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Primary Diagnoses</div>
              <div className="metric-value">{metrics.withPrimaryDiagnosis}</div>
              <div className="muted">Patients with a primary diagnosis extracted.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Other Diagnoses</div>
              <div className="metric-value">{metrics.withOtherDiagnoses}</div>
              <div className="muted">Patients with visible secondary diagnoses.</div>
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
                {run.patientStatusSummary.blocked + run.patientStatusSummary.failed + run.patientStatusSummary.needsManualReview} patients need attention
              </div>
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Patients</h2>
                <p className="page-subtitle">
                  Patient name, workbook timing, diagnosis reference data, and read-only run timestamps.
                </p>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Patient Name</th>
                  <th>Days Left</th>
                  <th>Primary Diagnosis</th>
                  <th>Other Diagnoses</th>
                  <th>Last Run</th>
                  <th>Next Scheduled</th>
                  <th>Status</th>
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
                      {patient.primaryDiagnosis ? (
                        renderDiagnosisLabel(patient.primaryDiagnosis)
                      ) : (
                        <span className="muted">No primary diagnosis</span>
                      )}
                    </td>
                    <td>
                      {patient.otherDiagnoses.length > 0 ? (
                        patient.otherDiagnoses.map((diagnosis, index) => (
                          <div className="muted" key={`${patient.workItemId}:other:${index}`}>
                            {renderDiagnosisLabel(diagnosis)}
                          </div>
                        ))
                      ) : (
                        <span className="muted">No other diagnoses</span>
                      )}
                    </td>
                    <td>{formatTimestamp(patient.lastRunAt)}</td>
                    <td>{patient.rerunEnabled ? formatTimestamp(patient.nextScheduledRunAt) : "Disabled"}</td>
                    <td>{patient.batchStatusSummary}</td>
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
