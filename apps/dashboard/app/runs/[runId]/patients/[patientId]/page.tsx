"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getPatient } from "../../../../../lib/api";
import { formatDaysLeft } from "../../../../../lib/qa";
import type { DiagnosisEntry, PatientDetail } from "../../../../../lib/types";

function renderDiagnosisLabel(input: DiagnosisEntry): string {
  const code = input.code?.trim() || "No code";
  const description = input.description?.trim() || "No description";
  return `${code} - ${description}`;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export default function PatientDetailPage() {
  const params = useParams<{ runId: string; patientId: string }>();
  const runId = params.runId;
  const patientId = params.patientId;

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPatient(): Promise<void> {
      try {
        const nextPatient = await getPatient(runId, patientId);
        if (!active) {
          return;
        }
        setPatient(nextPatient);
        setError(null);
      } catch (nextError) {
        if (!active) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load patient.");
      }
    }

    void loadPatient();
    const interval = window.setInterval(() => {
      void loadPatient();
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [patientId, runId]);

  const rawDaysLeftValues = patient?.workbookContext.rawDaysLeftValues ?? [];

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <Link className="link" href={`/runs/${runId}`}>
            Back to batch
          </Link>
          <h1 className="page-title">{patient?.patientName ?? patientId}</h1>
          <p className="page-subtitle">
            Read-only diagnosis reference detail for QA review.
          </p>
          {patient ? <p className="muted">Active subsidiary: {patient.subsidiaryName}</p> : null}
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {!patient ? <div className="panel muted">Loading patient...</div> : null}

      {patient ? (
        <>
          <section className="grid four">
            <div className="panel">
              <div className="metric-label">Days Left</div>
              <div className="metric-value compact">
                {formatDaysLeft(patient.daysLeftBeforeOasisDueDate)}
              </div>
              <div className="muted">Finale workbook column I.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Last Run</div>
              <div className="metric-value compact">{formatTimestamp(patient.lastRunAt)}</div>
              <div className="muted">Most recent read-only batch execution.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Next Scheduled</div>
              <div className="metric-value compact">
                {patient.rerunEnabled ? formatTimestamp(patient.nextScheduledRunAt) : "Disabled"}
              </div>
              <div className="muted">Automatic 24-hour rerun cadence.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Status</div>
              <div className="metric-value compact">{patient.batchStatusSummary}</div>
              <div className="muted">{patient.runMode.replace("_", " ")}</div>
            </div>
          </section>

          <section className="grid two">
            <div className="panel stack">
              <div>
                <h2>Primary Diagnosis</h2>
                <p className="page-subtitle">The extracted primary diagnosis shown as code plus description.</p>
              </div>
              {patient.primaryDiagnosis ? (
                <div className="signal-card">
                  <h3>{renderDiagnosisLabel(patient.primaryDiagnosis)}</h3>
                </div>
              ) : (
                <div className="muted">No primary diagnosis available.</div>
              )}
            </div>

            <div className="panel stack">
              <div>
                <h2>Other Diagnoses</h2>
                <p className="page-subtitle">Visible extracted secondary diagnoses for reference.</p>
              </div>
              {patient.otherDiagnoses.length > 0 ? (
                <div className="artifact-stack">
                  {patient.otherDiagnoses.map((diagnosis, index) => (
                    <div className="signal-card" key={`${patient.workItemId}:diagnosis:${index}`}>
                      {renderDiagnosisLabel(diagnosis)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No other diagnoses available.</div>
              )}
            </div>
          </section>

          <section className="panel stack">
            <div>
              <h2>Workbook Context</h2>
              <p className="page-subtitle">Minimal source context retained for the reference dashboard.</p>
            </div>
            <table className="table">
              <tbody>
                <tr>
                  <th>Billing Period</th>
                  <td>{patient.workbookContext.billingPeriod ?? "Not provided"}</td>
                </tr>
                <tr>
                  <th>Workflow Types</th>
                  <td>{patient.workbookContext.workflowTypes.join(", ") || "Not available"}</td>
                </tr>
                <tr>
                  <th>Column I Raw Value</th>
                  <td>{rawDaysLeftValues.join(", ") || "Not captured"}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </main>
  );
}
