"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { uploadWorkbook } from "../../../lib/api";

export default function NewRunPage() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [billingPeriod, setBillingPeriod] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedFile) {
      setError("Select a Finale .xlsx export to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const run = await uploadWorkbook({
        file: selectedFile,
        billingPeriod,
      });
      router.push(`/runs/${run.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workbook upload failed.");
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Reference Workflow</p>
          <h1 className="page-title">Upload Workbook</h1>
          <p className="page-subtitle">
            Upload a Finale workbook to start a read-only diagnosis extraction batch. The system reruns the active workbook every 24 hours until it is replaced or deactivated.
          </p>
        </div>
        <div className="actions">
          <Link className="button secondary" href="/runs">
            View Batches
          </Link>
        </div>
      </div>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Read Only</span>
          <h2>Diagnosis reference batch</h2>
          <p>
            The active pipeline parses workbook rows, finds patient charts, extracts document text, and publishes primary and secondary diagnoses for QA reference only.
          </p>
        </div>

        <form className="hero-form" onSubmit={handleUpload}>
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
              {submitting ? "Uploading..." : "Upload Workbook"}
            </button>
          </div>

          {error ? <div className="badge danger">{error}</div> : null}
        </form>
      </section>
    </main>
  );
}
