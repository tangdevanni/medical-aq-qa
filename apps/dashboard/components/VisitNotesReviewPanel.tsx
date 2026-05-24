import React from "react";
import type { VisitNotesReview } from "../lib/types";

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function VisitNotesReviewPanel({ review }: { review: VisitNotesReview | null | undefined }) {
  if (!review?.available) {
    const status = review?.status ?? "discovery_not_run";
    const message =
      status === "discovery_missing"
        ? "Visit Notes discovery artifact is missing; QA did not confirm whether eligible notes exist."
        : status === "discovery_not_run"
          ? "Visit Notes discovery has not run for this patient yet."
          : "Visit Notes discovery is not available for this patient.";
    return (
      <section className="panel stack visit-notes-review-panel">
        <div className="panel-header-inline">
          <div>
            <h2>Visit Notes Review</h2>
            <p className="page-subtitle">
              Counts notes from Documentations -&gt; Visit Notes and checks whether each note type maps to the Plan of Care.
            </p>
          </div>
          <span className="badge warning">{formatLabel(status)}</span>
        </div>
        <div className="muted">{message}</div>
      </section>
    );
  }

  const findings = review.findings ?? [];
  const noteSummaries = review.noteSummaries ?? [];
  const visitTypeCounts = review.visitTypeCounts ?? [];
  const warnings = review.warnings ?? [];
  const pocAlignmentFindings = findings.filter((finding) => finding.category === "poc_alignment");
  const pocRelevantNoteCount = noteSummaries.filter((note) => (note.alignedPocGoals ?? []).length > 0).length;

  return (
    <section className="panel stack visit-notes-review-panel">
      <div className="panel-header-inline">
        <div>
          <h2>Visit Notes Review</h2>
          <p className="page-subtitle">
            Read-only note inventory by type with Plan of Care relevance.
          </p>
        </div>
        <span className={`badge ${review.status === "ready" ? "success" : "warning"}`}>
          {formatLabel(review.status)}
        </span>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Total Visit Notes</span>
          <strong>{review.totalVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>POC-Relevant Notes</span>
          <strong>{pocRelevantNoteCount}</strong>
        </div>
        <div className="metric-card">
          <span>Analyzed</span>
          <strong>{review.analyzedVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>Active Monitoring</span>
          <strong>{review.activeMonitoringCount}</strong>
        </div>
        <div className="metric-card">
          <span>QA Complete</span>
          <strong>{review.qaCompleteFinalizedCount}</strong>
        </div>
        <div className="metric-card">
          <span>Captured</span>
          <strong>{review.capturedVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>Reused</span>
          <strong>{review.reusedVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>Failed / Degraded</span>
          <strong>{review.failedVisitNotes + review.degradedVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>Capped Pending</span>
          <strong>{review.cappedVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>POC Alignment Issues</span>
          <strong>{review.pocAlignmentIssueCount}</strong>
        </div>
        <div className="metric-card">
          <span>Missed Visits</span>
          <strong>{review.missedVisitNotes}</strong>
        </div>
        <div className="metric-card">
          <span>Not Started</span>
          <strong>{review.notStartedVisitNotes}</strong>
        </div>
      </div>

      {visitTypeCounts.length > 0 ? (
        <div className="comparison-table visit-notes-count-table">
          <div className="comparison-table-row comparison-table-header">
            <span>Visit Type</span>
            <span>Count</span>
            <span>Status Breakdown</span>
          </div>
          {visitTypeCounts.map((entry) => (
            <div className="comparison-table-row" key={entry.visitType}>
              <span>{formatLabel(entry.visitType)}</span>
              <strong>{entry.count}</strong>
              <span className="muted">
                {Object.entries(entry.statuses)
                  .map(([status, count]) => `${formatLabel(status)} ${count}`)
                  .join(" - ") || "No status captured"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {noteSummaries.length > 0 ? (
        <div className="stack">
          <div className="panel-header-inline">
            <div>
              <h3>Visit Notes</h3>
              <p className="page-subtitle">Each row shows what was found and whether the note type is relevant to the current Plan of Care.</p>
            </div>
            <span className="badge">{noteSummaries.length}</span>
          </div>
          <div className="comparison-list">
            {noteSummaries.slice(0, 20).map((note) => {
              const alignedPocGoals = note.alignedPocGoals ?? [];
              const pocProblemMatches = note.pocProblemMatches ?? [];
              return (
                <article className="section-queue-card compact-card" key={note.visitNoteKey}>
                  <div className="comparison-row-header">
                    <div>
                      <strong>{formatLabel(note.visitType)}</strong>
                      <p className="muted">
                        {formatLabel(note.status)} {note.visitDate ? `- ${note.visitDate}` : ""}
                      </p>
                      <p className="muted">
                        {note.lifecycleStatus ? formatLabel(note.lifecycleStatus) : "Lifecycle Unknown"}
                        {note.captureStatus ? ` - ${formatLabel(note.captureStatus)}` : ""}
                        {note.mappingStatus ? ` - ${formatLabel(note.mappingStatus)}` : ""}
                      </p>
                    </div>
                    <span className={`badge ${alignedPocGoals.length > 0 ? "success" : ""}`}>
                      {alignedPocGoals.length > 0 ? "Relevant to POC" : "No POC match"}
                    </span>
                  </div>
                  <p>{note.summary}</p>
                  {note.pocMappingResult ? (
                    <p className="muted">
                      {note.pocMappingResult.rationale}
                    </p>
                  ) : null}
                  {pocProblemMatches.length > 0 ? (
                    <details className="workspace-details compact-details">
                      <summary>
                        <span>POC problems and interventions addressed</span>
                        <span className="badge success">{pocProblemMatches.length}</span>
                      </summary>
                      <div className="workspace-details-body comparison-list">
                        {pocProblemMatches.map((match) => (
                          <article className="section-queue-card compact-card" key={match.problemKey}>
                            <div className="comparison-row-header">
                              <div>
                                <strong>{match.problemTitle}</strong>
                                {match.problemStatement ? <p className="muted">{match.problemStatement}</p> : null}
                              </div>
                              <span className="badge">{pct(match.confidence)}</span>
                            </div>
                            {match.interventionTexts.length > 0 ? (
                              <ul className="poc-preview-list">
                                {match.interventionTexts.map((intervention) => <li key={intervention}>{intervention}</li>)}
                              </ul>
                            ) : (
                              <p className="muted">No specific intervention text was strongly matched.</p>
                            )}
                            <p className="muted">{match.rationale}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {alignedPocGoals.length > 0 ? (
                    <details className="workspace-details compact-details">
                      <summary>
                        <span>Matched Plan of Care goals</span>
                        <span className="badge">{alignedPocGoals.length}</span>
                      </summary>
                      <div className="workspace-details-body">
                        <ul className="poc-preview-list">
                          {alignedPocGoals.map((goal) => <li key={goal}>{goal}</li>)}
                        </ul>
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="muted">No visit note rows are currently visible.</div>
      )}

      {pocAlignmentFindings.length > 0 ? (
        <details className="workspace-details compact-details">
          <summary>
            <span>POC relevance review</span>
            <span className="badge warning">{pocAlignmentFindings.length}</span>
          </summary>
          <div className="workspace-details-body comparison-list">
            {pocAlignmentFindings.map((finding) => (
              <article className="section-queue-card visit-notes-finding-card" key={finding.findingId}>
                <div className="comparison-row-header">
                  <div>
                    <h4>{finding.title}</h4>
                    <p className="muted">
                      {formatLabel(finding.visitType)}
                      {finding.visitDate ? ` - ${finding.visitDate}` : ""}
                    </p>
                  </div>
                  <span className="badge">{pct(finding.confidence)}</span>
                </div>
                <p>{finding.description}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      {warnings.length > 0 ? (
        <details className="workspace-details compact-details">
          <summary>
            <span>Visit Notes warnings</span>
            <span className="badge warning">{warnings.length}</span>
          </summary>
          <div className="workspace-details-body">
            <ul className="poc-preview-list">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </details>
      ) : null}
    </section>
  );
}
