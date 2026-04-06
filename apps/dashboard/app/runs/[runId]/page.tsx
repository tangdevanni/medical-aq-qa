"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getRun } from "../../../lib/api";
import {
  batchStatusClass,
  diagnosisDetectionClass,
  executionStatusClass,
  lockStateClass,
  modeClass,
  qaStatusClass,
  workflowStatusClass,
} from "../../../lib/qa";
import type { RunDetail } from "../../../lib/types";

function renderDiagnosisLabel(input: {
  code: string | null;
  description: string | null;
  confidence?: string | null;
}): string {
  const code = input.code?.trim() || "No code";
  const description = input.description?.trim() || "No description";
  const confidence = input.confidence?.trim();
  return confidence ? `${code} - ${description} (${confidence})` : `${code} - ${description}`;
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
        setError(nextError instanceof Error ? nextError.message : "Failed to load run.");
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
      verificationOnly: run?.patients.filter((patient) => patient.mode === "verification_only").length ?? 0,
      inputCapable: run?.patients.filter((patient) => patient.mode === "input_capable").length ?? 0,
      unlocked: run?.patients.filter((patient) => patient.lockState === "unlocked").length ?? 0,
      diagnosisDetectionPassed: run?.patients.filter((patient) => patient.diagnosisDetectionPassed).length ?? 0,
    }),
    [run],
  );

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <Link className="link" href="/runs">
            Back to runs
          </Link>
          <h1 className="page-title">{runId}</h1>
          <p className="page-subtitle">
            Live view of patient-by-patient QA execution, lock-state gating, verification, and planned OASIS actions.
          </p>
        </div>
        <div className="actions">
          <Link className="button secondary" href="/runs/new">
            New Run
          </Link>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {!run ? <div className="panel muted">Loading run...</div> : null}

      {run ? (
        <>
          <section className="grid four">
            <div className="panel">
              <div className="metric-label">Run status</div>
              <div className="metric-value">
                <span className={batchStatusClass(run.status)}>{run.status}</span>
              </div>
              <div className="muted">{run.currentExecutionStep}</div>
            </div>
            <div className="panel">
              <div className="metric-label">Patients</div>
              <div className="metric-value">{run.totalWorkItems}</div>
              <div className="muted">{run.totalCompleted} completed</div>
            </div>
            <div className="panel">
              <div className="metric-label">Diagnosis Detection</div>
              <div className="metric-value">{run.diagnosisDetectionPassedCount}</div>
              <div className="muted">{run.totalWorkItems - run.diagnosisDetectionPassedCount} pending or incomplete</div>
            </div>
            <div className="panel">
              <div className="metric-label">Lock / Mode</div>
              <div className="metric-value">{metrics.unlocked}</div>
              <div className="muted">
                {metrics.verificationOnly} verification-only, {metrics.inputCapable} input-capable
              </div>
            </div>
          </section>

          <section className="panel stack">
            <div>
              <h2>Run Lifecycle</h2>
              <p className="page-subtitle">
                High-signal run checkpoints surfaced directly from the shared backend runner state.
              </p>
            </div>
            <div className="section-status-grid">
              {run.runLifecycle.map((status) => (
                <div className="section-pill" key={status.key}>
                  <span>{status.label}</span>
                  <span className={workflowStatusClass(status.status)}>{status.status}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Workbook Detection</h2>
                <p className="page-subtitle">
                  Parsed worksheet signatures retained with the run for demo traceability.
                </p>
              </div>
            </div>

            <div className="grid three">
              {run.parsePreview.detectedSources.map((source) => (
                <article className="signal-card" key={source.sourceType}>
                  <div className="badge-row">
                    <span className={workflowStatusClass(source.detectionStatus === "detected" ? "complete" : "blocked")}>
                      {source.detectionStatus === "detected" ? "Detected" : "Missing"}
                    </span>
                    <span className="badge">{source.sourceType}</span>
                  </div>
                  <h3>{source.detectedSheetName ?? "No matching sheet"}</h3>
                  <div className="signal-meta">
                    <span>Header matches: {source.headerMatchCount}</span>
                    <span>Rows: {source.extractedRowCount}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Patients</h2>
                <p className="page-subtitle">
                  Current workflow step, QA status, lock state, diagnosis outputs, and comparison results.
                </p>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>QA step</th>
                  <th>Diagnosis detection</th>
                  <th>Execution</th>
                  <th>Lock</th>
                  <th>Mode</th>
                  <th>Primary Dx</th>
                  <th>Other Diagnoses</th>
                  <th>Comparison</th>
                </tr>
              </thead>
              <tbody>
                {run.patients.map((patient) => (
                  <tr key={patient.workItemId}>
                    <td>
                      <Link className="link" href={`/runs/${run.id}/patients/${patient.workItemId}`}>
                        {patient.patientName}
                      </Link>
                      <div className="muted">{patient.workflowCurrentStep}</div>
                      {patient.blockReason ? <div className="muted">{patient.blockReason}</div> : null}
                    </td>
                    <td>
                      {patient.executionStep}
                      <div className="muted">{patient.stepLogCount} step log(s)</div>
                    </td>
                    <td>
                      <span className={diagnosisDetectionClass(patient.diagnosisDetectionPassed)}>
                        {patient.diagnosisDetectionPassed ? "PASS" : "Pending"}
                      </span>
                      <div className="muted">
                        {patient.diagnosisDetectionPassed
                          ? "SOC opened, lock state known, diagnoses stored"
                          : "Waiting on SOC, lock state, or stored diagnoses"}
                      </div>
                    </td>
                    <td>
                      <span className={executionStatusClass(patient.executionSummary.status)}>
                        {patient.executionSummary.status}
                      </span>
                      <div className="muted">
                        {patient.executionSummary.reasons.join(", ") || patient.status}
                      </div>
                    </td>
                    <td>
                      <span className={lockStateClass(patient.lockState)}>{patient.lockState}</span>
                    </td>
                    <td>
                      <span className={modeClass(patient.mode)}>{patient.mode}</span>
                    </td>
                    <td>
                      {patient.primaryDiagnosis
                        ? renderDiagnosisLabel(patient.primaryDiagnosis)
                        : "No primary diagnosis selected"}
                    </td>
                    <td>
                      {patient.otherDiagnoses.length > 0 ? (
                        patient.otherDiagnoses.map((diagnosis, index) => (
                          <div className="muted" key={`${patient.workItemId}:other:${index}`}>
                            {renderDiagnosisLabel(diagnosis)}
                          </div>
                        ))
                      ) : (
                        <span className="muted">No additional diagnoses extracted</span>
                      )}
                    </td>
                    <td>
                      {patient.comparisonSummary ? (
                        <>
                          <span className={workflowStatusClass(patient.comparisonSummary.passed ? "complete" : "blocked")}>
                            {patient.comparisonSummary.passed ? "Passed" : "Needs review"}
                          </span>
                          <div className="muted">
                            Missing {patient.comparisonSummary.missingCount}, extra {patient.comparisonSummary.extraCount}
                          </div>
                        </>
                      ) : (
                        <span className="badge">Pending</span>
                      )}
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
