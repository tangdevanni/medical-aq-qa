"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getPatient, getPatientArtifacts } from "../../../../../lib/api";
import {
  diagnosisDetectionClass,
  executionStatusClass,
  lockStateClass,
  modeClass,
  qaStatusClass,
  workflowStatusClass,
} from "../../../../../lib/qa";
import type { PatientArtifactsResponse, PatientDetail } from "../../../../../lib/types";

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

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

export default function PatientDetailPage() {
  const params = useParams<{ runId: string; patientId: string }>();
  const runId = params.runId;
  const patientId = params.patientId;

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [artifacts, setArtifacts] = useState<PatientArtifactsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPatient(): Promise<void> {
      try {
        const [nextPatient, nextArtifacts] = await Promise.all([
          getPatient(runId, patientId),
          getPatientArtifacts(runId, patientId),
        ]);
        if (!active) {
          return;
        }
        setPatient(nextPatient);
        setArtifacts(nextArtifacts);
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

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <Link className="link" href={`/runs/${runId}`}>
            Back to run
          </Link>
          <h1 className="page-title">{patient?.patientName ?? patientId}</h1>
          <p className="page-subtitle">
            Patient-level evidence for workbook input, OCR/coding output, lock state, verification, action planning, and execution result.
          </p>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {!patient ? <div className="panel muted">Loading patient...</div> : null}

      {patient ? (
        <>
          <section className="grid four">
            <div className="panel">
              <div className="metric-label">Overall QA</div>
              <div className="metric-value">
                <span className={qaStatusClass(patient.overallStatus)}>{patient.overallStatus}</span>
              </div>
              <div className="muted">{patient.currentQaStage}</div>
            </div>
            <div className="panel">
              <div className="metric-label">Diagnosis detection</div>
              <div className="metric-value">
                <span className={diagnosisDetectionClass(patient.diagnosisDetectionPassed)}>
                  {patient.diagnosisDetectionPassed ? "PASS" : "Pending"}
                </span>
              </div>
              <div className="muted">MVP success is based on SOC, lock state, and stored diagnoses.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Lock state</div>
              <div className="metric-value">
                <span className={lockStateClass(patient.lockState)}>{patient.lockState}</span>
              </div>
              <div className="muted">{patient.workflowCurrentStep}</div>
            </div>
            <div className="panel">
              <div className="metric-label">Mode</div>
              <div className="metric-value">
                <span className={modeClass(patient.mode)}>{patient.mode}</span>
              </div>
              <div className="muted">
                inputEligible={String(patient.inputEligible)} verificationOnly={String(patient.verificationOnly)}
              </div>
            </div>
            <div className="panel">
              <div className="metric-label">Execution</div>
              <div className="metric-value">
                <span className={executionStatusClass(patient.executionSummary.status)}>
                  {patient.executionSummary.status}
                </span>
              </div>
              <div className="muted">
                {patient.executionSummary.reasons.join(", ") || "No execution artifact yet"}
              </div>
            </div>
          </section>

          <section className="grid two">
            <div className="panel stack">
              <div>
                <h2>Primary Diagnosis</h2>
                <p className="page-subtitle">Structured primary diagnosis exported from OCR + LLM processing.</p>
              </div>
              {patient.primaryDiagnosis ? (
                <div className="signal-card">
                  <h3>{renderDiagnosisLabel(patient.primaryDiagnosis)}</h3>
                </div>
              ) : (
                <div className="muted">No primary diagnosis exported yet.</div>
              )}
            </div>

            <div className="panel stack">
              <div>
                <h2>Other Diagnoses</h2>
                <p className="page-subtitle">All structured secondary diagnoses currently available for demo review.</p>
              </div>
              {patient.otherDiagnoses.length > 0 ? (
                <div className="artifact-stack">
                  {patient.otherDiagnoses.map((diagnosis, index) => (
                    <div className="artifact-card" key={`${patient.workItemId}:diagnosis:${index}`}>
                      {renderDiagnosisLabel(diagnosis)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No additional diagnoses exported.</div>
              )}
            </div>
          </section>

          <section className="panel stack">
            <div>
              <h2>Workflow Status</h2>
              <p className="page-subtitle">
                Backend step/state projection built from real automation logs and artifacts.
              </p>
            </div>
            <div className="section-status-grid">
              {patient.workflowStatuses.map((status) => (
                <div className="section-pill" key={status.key}>
                  <span>{status.label}</span>
                  <span className={workflowStatusClass(status.status)}>{status.status}</span>
                </div>
              ))}
            </div>
            {patient.blockReason ? (
              <div className="badge danger">{patient.blockReason}</div>
            ) : null}
            <div className="badge-row">
              <span className={diagnosisDetectionClass(patient.diagnosisDetectionPassed)}>
                diagnosis detection: {patient.diagnosisDetectionPassed ? "PASS" : "PENDING"}
              </span>
              <span className={executionStatusClass(patient.executionSummary.status)}>
                execution: {patient.executionSummary.status}
              </span>
            </div>
          </section>

          <section className="grid two">
            <div className="panel stack">
              <div>
                <h2>Workbook Row Data</h2>
                <p className="page-subtitle">Normalized workbook row snapshot retained for this patient.</p>
              </div>
              <pre className="json">{prettyJson(patient.workItemSnapshot)}</pre>
            </div>

            <div className="panel stack">
              <div>
                <h2>OCR And Coding Summary</h2>
                <p className="page-subtitle">Document extraction and coding artifacts used to build the OASIS diagnosis payload.</p>
              </div>
              <pre className="json">{prettyJson({
                documentText: patient.artifactContents.documentText,
                codingInput: patient.artifactContents.codingInput,
              })}</pre>
            </div>
          </section>

          <section className="grid two">
            <div className="panel stack">
              <div>
                <h2>OASIS Artifacts</h2>
                <p className="page-subtitle">Hydrated JSON artifacts for review and demo playback.</p>
              </div>
              <div className="artifact-stack">
                <details className="artifact-card" open>
                  <summary>oasis-ready-diagnosis.json</summary>
                  <pre className="json">{prettyJson(patient.artifactContents.oasisReadyDiagnosis)}</pre>
                </details>
                <details className="artifact-card">
                  <summary>oasis-lock-state.json</summary>
                  <pre className="json">{prettyJson(patient.artifactContents.oasisLockState)}</pre>
                </details>
                <details className="artifact-card">
                  <summary>oasis-diagnosis-verification.json</summary>
                  <pre className="json">{prettyJson(patient.artifactContents.oasisDiagnosisVerification)}</pre>
                </details>
                <details className="artifact-card">
                  <summary>oasis-input-actions.json</summary>
                  <pre className="json">{prettyJson(patient.artifactContents.oasisInputActions)}</pre>
                </details>
                <details className="artifact-card">
                  <summary>oasis-execution-result.json</summary>
                  <pre className="json">{prettyJson(patient.artifactContents.oasisExecutionResult)}</pre>
                </details>
              </div>
            </div>

            <div className="panel stack">
              <div>
                <h2>Step Log And Evidence</h2>
                <p className="page-subtitle">Recent automation evidence and the full step log retained for this patient.</p>
              </div>
              <pre className="json">{prettyJson(patient.stepEvidenceSummary)}</pre>
              <pre className="json">{prettyJson(patient.automationStepLogs)}</pre>
            </div>
          </section>

          <section className="panel stack">
            <div>
              <h2>Artifact Inventory</h2>
              <p className="page-subtitle">Filesystem-level artifact list for the patient run.</p>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {(artifacts?.artifacts ?? []).map((artifact) => (
                  <tr key={`${artifact.kind}:${artifact.path}`}>
                    <td>{artifact.kind}</td>
                    <td>
                      {artifact.name}
                      <div className="muted">{artifact.path}</div>
                    </td>
                    <td>{artifact.sizeBytes ?? "-"}</td>
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
