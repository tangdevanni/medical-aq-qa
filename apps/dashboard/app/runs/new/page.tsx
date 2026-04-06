"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { parseRun, startRun, uploadWorkbook } from "../../../lib/api";
import { batchStatusClass, formatLabel, workflowStatusClass } from "../../../lib/qa";
import type { RunDetail } from "../../../lib/types";

export default function NewRunPage() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [billingPeriod, setBillingPeriod] = useState("");
  const [draftRun, setDraftRun] = useState<RunDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedSources = useMemo(
    () => draftRun?.parsePreview.detectedSources ?? [],
    [draftRun],
  );

  async function handleUploadAndParse(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedFile) {
      setError("Select a Finale .xlsx export to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const uploadedRun = await uploadWorkbook({
        file: selectedFile,
        billingPeriod,
      });
      const parsedRun = await parseRun(uploadedRun.id);
      setDraftRun(parsedRun);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Upload or parse failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunQa(): Promise<void> {
    if (!draftRun) {
      return;
    }

    setStarting(true);
    setError(null);

    try {
      await startRun(draftRun.id);
      router.push(`/runs/${draftRun.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Run start failed.");
      setStarting(false);
    }
  }

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Demo Control Plane</p>
          <h1 className="page-title">Create New QA Run</h1>
          <p className="page-subtitle">
            Upload a Finale Excel export, detect the workbook structure by content, preview the normalized queue, then launch the existing automation pipeline.
          </p>
        </div>
        <div className="actions">
          <Link className="button secondary" href="/runs">
            View Runs
          </Link>
        </div>
      </div>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Workbook Ingestion</span>
          <h2>Filename-agnostic parse flow</h2>
          <p>
            The dashboard uploads the raw workbook, validates the sheet signatures, and shows a patient preview before any automation starts.
          </p>
        </div>

        <form className="hero-form" onSubmit={handleUploadAndParse}>
          <label className="field">
            <span>Finale workbook</span>
            <input
              className="input"
              type="file"
              accept=".xlsx"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <label className="field">
            <span>Billing period</span>
            <input
              className="input"
              type="text"
              placeholder="Optional"
              value={billingPeriod}
              onChange={(event) => setBillingPeriod(event.target.value)}
            />
          </label>

          <div className="actions">
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Uploading and parsing..." : "Upload And Parse"}
            </button>
            {draftRun ? (
              <button
                className="button success"
                type="button"
                disabled={starting || draftRun.parsePreview.previewRows.length === 0}
                onClick={() => void handleRunQa()}
              >
                {starting ? "Starting..." : "Run QA"}
              </button>
            ) : null}
          </div>

          {error ? <div className="badge danger">{error}</div> : null}
        </form>
      </section>

      {draftRun ? (
        <>
          <section className="grid four">
            <div className="panel">
              <div className="metric-label">Run status</div>
              <div className="metric-value">
                <span className={batchStatusClass(draftRun.status)}>{draftRun.status}</span>
              </div>
              <div className="muted">{draftRun.currentExecutionStep}</div>
            </div>
            <div className="panel">
              <div className="metric-label">Detected patients</div>
              <div className="metric-value">{draftRun.totalWorkItems}</div>
              <div className="muted">Normalized patient queue rows parsed from workbook content.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Eligible patients</div>
              <div className="metric-value">{draftRun.eligibleWorkItemCount}</div>
              <div className="muted">Patients ready to enter the existing automation workflow.</div>
            </div>
            <div className="panel">
              <div className="metric-label">Workbook</div>
              <div className="metric-value compact">{draftRun.sourceWorkbook.originalFileName}</div>
              <div className="muted">{new Date(draftRun.createdAt).toLocaleString()}</div>
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Detected Source Worksheets</h2>
                <p className="page-subtitle">
                  Workbook parsing is based on header signatures and row structure, not the uploaded filename.
                </p>
              </div>
            </div>

            <div className="grid three">
              {detectedSources.map((source) => (
                <article className="signal-card" key={source.sourceType}>
                  <div className="badge-row">
                    <span className={workflowStatusClass(source.detectionStatus === "detected" ? "complete" : "blocked")}>
                      {source.detectionStatus === "detected" ? "Detected" : "Missing"}
                    </span>
                    <span className="badge">{formatLabel(source.sourceType)}</span>
                  </div>
                  <h3>{source.detectedSheetName ?? "No matching sheet found"}</h3>
                  <div className="signal-meta">
                    <span>Header match count: {source.headerMatchCount}</span>
                    <span>Minimum required: {source.minimumHeaderMatches}</span>
                    <span>Extracted rows: {source.extractedRowCount}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel stack">
            <div className="page-header">
              <div>
                <h2>Parse Preview</h2>
                <p className="page-subtitle">
                  Preview of the normalized patient queue that will be handed to the automation run.
                </p>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Billing Period</th>
                  <th>Workflow Types</th>
                  <th>Source Sheets</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {draftRun.parsePreview.previewRows.map((row) => (
                  <tr key={row.workItemId}>
                    <td>{row.patientName}</td>
                    <td>{row.billingPeriod ?? "Not provided"}</td>
                    <td>{row.workflowTypes.map(formatLabel).join(", ")}</td>
                    <td>{row.sourceSheets.join(", ")}</td>
                    <td>
                      <span className={workflowStatusClass(row.automationEligible ? "complete" : "blocked")}>
                        {row.automationEligible ? "Eligible" : "Blocked"}
                      </span>
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
