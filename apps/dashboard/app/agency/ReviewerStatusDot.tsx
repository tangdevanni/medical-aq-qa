"use client";

import { useEffect, useRef, useState } from "react";

type ReviewerStatus = "red" | "yellow" | "green";

const STATUS_SEQUENCE: ReviewerStatus[] = ["red", "yellow", "green"];

const STATUS_LABEL: Record<ReviewerStatus, string> = {
  red: "Needs review",
  yellow: "Being reviewed",
  green: "Reviewed",
};

function nextStatus(value: ReviewerStatus | null): ReviewerStatus {
  if (!value) {
    return "red";
  }
  const index = STATUS_SEQUENCE.indexOf(value);
  return STATUS_SEQUENCE[(index + 1) % STATUS_SEQUENCE.length] ?? "red";
}

export default function ReviewerStatusDot(input: {
  workItemId: string;
  initialStatus: ReviewerStatus | null;
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  const [status, setStatus] = useState<ReviewerStatus | null>(input.initialStatus);
  const [updatedAt, setUpdatedAt] = useState<string | null>(input.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const requestInFlightRef = useRef(false);
  const label = status ? STATUS_LABEL[status] : "Unmarked";

  useEffect(() => {
    setStatus(input.initialStatus);
    setUpdatedAt(input.updatedAt);
    setError(null);
    requestInFlightRef.current = false;
    setIsSaving(false);
  }, [input.workItemId, input.initialStatus, input.updatedAt, input.updatedBy]);

  async function handleClick() {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    setIsSaving(true);

    const next = nextStatus(status);
    const previous = { status, updatedAt };
    setStatus(next);
    setError(null);

    try {
      const response = await fetch("/api/session/dashboard/reviewer-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workItemId: input.workItemId, status: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? "Unable to update status.");
      }
      const body = await response.json() as {
        status: ReviewerStatus;
        updatedAt: string;
        updatedBy: string | null;
      };
      setStatus(body.status);
      setUpdatedAt(body.updatedAt);
    } catch (caught) {
      setStatus(previous.status);
      setUpdatedAt(previous.updatedAt);
      setError(caught instanceof Error ? caught.message : "Unable to update status.");
    } finally {
      requestInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <div className="reviewer-status-control">
      <button
        type="button"
        className={`reviewer-status-dot ${status ? `reviewer-status-${status}` : "reviewer-status-empty"}`}
        aria-label={`Reviewer status: ${label}. Click to change.`}
        title={`${label}. Click to change.`}
        disabled={isSaving}
        aria-busy={isSaving}
        onClick={() => {
          void handleClick();
        }}
      >
        <span />
      </button>
      <div aria-live="polite">
        <div className="reviewer-status-label">{label}</div>
        {error ? <div className="reviewer-status-error">{error}</div> : null}
      </div>
    </div>
  );
}
