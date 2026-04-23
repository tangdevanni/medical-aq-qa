"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type MutableRefObject, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { getPatient } from "../../../../../lib/api";
import {
  buildComparisonWorkspaceModel,
  filterComparisonRows,
  getConfidenceLabel,
  getMappingStrengthLabel,
  getResultBadgeClass,
  getResultLabel,
  getSourceSupportLabel,
  type CompareFilterValue,
  type ComparisonSectionSummary,
  type ComparisonWorkspaceModel,
  type FieldComparison,
} from "../../../../../lib/patientComparison";
import { formatTimestamp } from "../../../../../lib/qa";
import type {
  DiagnosisEntry,
  PatientDetail,
  QaPrefetchSummary,
} from "../../../../../lib/types";

type WorkspaceTab =
  | "oasis_snapshot"
  | "compare_all"
  | "clinical_sections"
  | "coding_sensitive"
  | "uncertain"
  | "source_documents";

function hasReferralCoverage(patient: PatientDetail): boolean {
  return patient.referralQa.referralDataAvailable;
}

function hasUsableReferralCoverage(patient: PatientDetail): boolean {
  return patient.referralQa.referralDataAvailable && patient.referralQa.extractionUsabilityStatus === "usable";
}

function hasOasisCoverage(patient: PatientDetail): boolean {
  return Boolean(
    patient.qaPrefetch?.oasisFound ||
      patient.qaPrefetch?.oasisAssessmentPrimaryStatus ||
      patient.qaPrefetch?.printedNoteStatus ||
      patient.qaPrefetch?.printedNoteSections.length ||
      patient.dashboardState?.sourceCoverage.printedNoteChartValueCount,
  );
}

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeLabelForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const PORTAL_VALUE_PLACEHOLDERS = new Set([
  "no chart data captured",
  "chart value is blank",
  "printed note ocr did not capture a value",
  "no reliable chart value extracted",
]);

function formatDiagnosisEntry(entry: DiagnosisEntry | null): string {
  if (!entry) {
    return "Not available";
  }

  const description = entry.description?.trim() ?? "";
  const code = entry.code?.trim() ?? "";
  if (description && code) {
    return `${description} (${code})`;
  }

  return description || code || "Not available";
}

function DiagnosisSummaryPanel({ patient }: { patient: PatientDetail }) {
  const diagnosisEntries: Array<{ label: string; value: string }> = [
    {
      label: "Primary Diagnosis",
      value: formatDiagnosisEntry(patient.primaryDiagnosis),
    },
    {
      label: "Secondary Diagnoses",
      value:
        patient.otherDiagnoses.length > 0
          ? patient.otherDiagnoses.map((entry) => formatDiagnosisEntry(entry)).join("; ")
          : "Not available",
    },
  ];
  const diagnosisCount =
    (patient.primaryDiagnosis ? 1 : 0) + patient.otherDiagnoses.length;

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Diagnosis Summary</h2>
          <p className="page-subtitle">
            This mirrors the coding input used by the dashboard so the patient page shows the same diagnosis codes visible in the queue.
          </p>
        </div>
        <span className={`badge${diagnosisCount > 0 ? " success" : " warning"}`}>
          {diagnosisCount > 0 ? `${diagnosisCount} diagnosis${diagnosisCount === 1 ? "" : "es"}` : "No diagnoses"}
        </span>
      </div>

      <div className="workspace-summary-grid">
        {diagnosisEntries.map((entry) => (
          <div className="workspace-summary-item" key={entry.label}>
            <span className="workspace-summary-label">{entry.label}</span>
            <strong>{entry.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function BillingPeriodCardsPanel({ prefetch }: { prefetch: QaPrefetchSummary | null }) {
  if (!prefetch || !prefetch.selectedEpisodeRange) {
    return null;
  }

  const periodRows = [
    {
      label: "First 30 Days",
      rangeLabel: `${prefetch.first30TotalCards} total card(s)`,
      workbookColumns: prefetch.first30WorkbookColumns,
    },
    {
      label: "Second 30 Days",
      rangeLabel: `${prefetch.second30TotalCards} total card(s)`,
      workbookColumns: prefetch.second30WorkbookColumns,
    },
  ];

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Billing Period Cards</h2>
          <p className="page-subtitle">
            Portal cards captured from the selected billing-period window and grouped for dashboard review.
          </p>
        </div>
        <span className="badge">{prefetch.selectedEpisodeRange}</span>
      </div>

      <div className="billing-period-card-grid">
        {periodRows.map((period) => (
          <article className="priority-summary-card comparison-group-card" key={period.label}>
            <div className="comparison-group-header">
              <div>
                <h3>{period.label}</h3>
                <div className="muted">{period.rangeLabel}</div>
              </div>
            </div>
            <div className="comparison-value-grid billing-period-value-grid">
              <div>
                <div className="metric-label">SN</div>
                <div className="billing-period-summary-value">{period.workbookColumns.sn}</div>
              </div>
              <div>
                <div className="metric-label">PT/OT/ST</div>
                <div className="billing-period-summary-value">{period.workbookColumns.ptOtSt}</div>
              </div>
              <div>
                <div className="metric-label">HHA/MSW</div>
                <div className="billing-period-summary-value">{period.workbookColumns.hhaMsw}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DocumentationCoveragePanel({
  patient,
  workspace,
}: {
  patient: PatientDetail;
  workspace: ComparisonWorkspaceModel;
}) {
  const oasisStructuredValueCount = patient.dashboardState?.sourceCoverage.printedNoteChartValueCount ?? 0;
  const oasisCompletedSections =
    patient.qaPrefetch?.printedNoteCompletedSectionCount ??
    patient.dashboardState?.sourceCoverage.printedNoteCompletedSectionCount ??
    0;
  const oasisIncompleteSections = patient.qaPrefetch?.printedNoteIncompleteSectionCount ?? 0;
  const oasisSourceLabel =
    patient.qaPrefetch?.printedNoteReviewSource ??
    patient.dashboardState?.sourceCoverage.printedNoteReviewSource ??
    "Not captured";
  const needsReferralFollowUp =
    workspace.summary.missingInReferralCount > 0 || !hasUsableReferralCoverage(patient);
  const referralWarnings = patient.referralQa.warnings.slice(0, 3);

  return (
    <section className="grid three">
      <div className="panel stack workspace-info-card">
        <div className="panel-header-inline">
          <h2>OASIS Source</h2>
          <span className={hasOasisCoverage(patient) ? "badge success" : "badge warning"}>
            {hasOasisCoverage(patient) ? "Available" : "Not captured"}
          </span>
        </div>
        <div className="workspace-summary-grid">
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Review Source</span>
            <strong>{formatStatusLabel(oasisSourceLabel)}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Structured Values</span>
            <strong>{oasisStructuredValueCount}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Completed Sections</span>
            <strong>{oasisCompletedSections}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Incomplete Sections</span>
            <strong>{oasisIncompleteSections}</strong>
          </div>
        </div>
        <p className="workspace-card-copy">
          The dashboard should still surface OASIS-derived data even when referral support is missing. This is the current extracted OASIS coverage available for QA.
        </p>
      </div>

      <div className="panel stack workspace-info-card">
        <div className="panel-header-inline">
          <h2>Referral Source</h2>
          <span
            className={
              hasUsableReferralCoverage(patient)
                ? "badge success"
                : hasReferralCoverage(patient)
                  ? "badge warning"
                  : "badge danger"
            }
          >
            {hasUsableReferralCoverage(patient)
              ? "Usable"
              : hasReferralCoverage(patient)
                ? "Limited"
                : "Missing"}
          </span>
        </div>
        <div className="workspace-summary-grid">
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Availability</span>
            <strong>{hasReferralCoverage(patient) ? "Document captured" : "Not available"}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Usability</span>
            <strong>{formatStatusLabel(patient.referralQa.extractionUsabilityStatus)}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Warnings</span>
            <strong>{patient.referralQa.warningCount}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Comparison Sections</span>
            <strong>{patient.referralQa.availableSectionCount} / {patient.referralQa.totalSectionCount}</strong>
          </div>
        </div>
        {referralWarnings.length > 0 ? (
          <div className="checklist compact-checklist">
            {referralWarnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : (
          <p className="workspace-card-copy">No referral warnings were recorded for this patient.</p>
        )}
      </div>

      <div className="panel stack workspace-info-card">
        <div className="panel-header-inline">
          <h2>QA Follow-Up</h2>
          <span className={needsReferralFollowUp ? "badge danger" : "badge success"}>
            {needsReferralFollowUp ? "Needs follow-up" : "In sync"}
          </span>
        </div>
        <div className="workspace-summary-grid">
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Missing Referral Fields</span>
            <strong>{workspace.summary.missingInReferralCount}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Missing in OASIS / Chart</span>
            <strong>{workspace.summary.missingInPortalCount}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Mismatches</span>
            <strong>{workspace.summary.mismatchCount}</strong>
          </div>
          <div className="workspace-summary-item">
            <span className="workspace-summary-label">Coding Review</span>
            <strong>{workspace.summary.codingReviewCount}</strong>
          </div>
        </div>
        <p className="workspace-card-copy">
          Use the OASIS source to review the patient immediately. Referral follow-up is still required anywhere the dashboard shows OASIS-backed values without supporting referral evidence.
        </p>
      </div>
    </section>
  );
}

function hasVisiblePortalValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasUsableOasisValue(comparison: FieldComparison): boolean {
  if (comparison.portalValueSource === "oasis_capture_skipped") {
    return false;
  }

  const normalizedDisplayValue = normalizeLabelForComparison(comparison.displayPortalValue);
  if (PORTAL_VALUE_PLACEHOLDERS.has(normalizedDisplayValue)) {
    return false;
  }

  return Boolean(
    comparison.valuePresence?.hasChartValue ||
      comparison.valuePresence?.hasPrintedNoteChartValue ||
      hasVisiblePortalValue(comparison.portalValue) ||
      hasVisiblePortalValue(comparison.displayPortalValue),
  );
}

function OasisSnapshotPanel({
  patient,
  workspace,
  onInspect,
}: {
  patient: PatientDetail;
  workspace: ComparisonWorkspaceModel;
  onInspect: (fieldKey: string) => void;
}) {
  const sectionEntries = workspace.sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => hasUsableOasisValue(row)),
    }))
    .filter((section) => section.rows.length > 0);
  const totalCapturedFields = sectionEntries.reduce((sum, section) => sum + section.rows.length, 0);
  const referralMissing = !hasReferralCoverage(patient);
  const oasisCaptureSkipReason =
    patient.qaPrefetch?.oasisAssessmentDecision === "SKIP"
      ? patient.qaPrefetch.oasisAssessmentReason
      : null;

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>OASIS Snapshot</h2>
          <p className="page-subtitle">
            This is the readable OASIS view for QA. It shows what the chart currently says first, then the referral comparison can be used to confirm or flag discrepancies.
          </p>
        </div>
        <div className="badge-row">
          <span className="badge success">{totalCapturedFields} captured field{totalCapturedFields === 1 ? "" : "s"}</span>
          <span className={referralMissing ? "badge warning" : "badge"}>
            {referralMissing ? "OASIS-only view" : "Referral overlay available"}
          </span>
        </div>
      </div>

      {referralMissing ? (
        <section className="panel global-trust-banner">
          <span className="badge warning">Referral Missing</span>
          <div>
            Referral documentation is not available for this patient yet. QA can still review the extracted OASIS content here; discrepancy review becomes complete once referral documents are captured.
          </div>
        </section>
      ) : null}

      {sectionEntries.length > 0 ? (
        <div className="workspace-section-stack">
          {sectionEntries.map((section) => (
            <section className="section-queue-card" key={section.sectionKey}>
              <div className="comparison-section-summary">
                <div>
                  <h3>{section.sectionLabel}</h3>
                  <div className="muted">{section.rows.length} OASIS-backed field{section.rows.length === 1 ? "" : "s"}</div>
                </div>
                <div className="comparison-section-counts">
                  <span className="badge success">{section.rows.length} captured</span>
                  {section.missingInReferralCount > 0 ? (
                    <span className="badge warning">{section.missingInReferralCount} missing referral</span>
                  ) : null}
                  {section.mismatchCount > 0 ? (
                    <span className="badge danger">{section.mismatchCount} mismatch</span>
                  ) : null}
                </div>
              </div>
              <div className="section-queue-body">
                <div className="section-field-list">
                  {section.rows.map((row) => (
                    <article className="flagged-field-row" key={row.fieldKey}>
                      <div className="flagged-field-header">
                        <div>
                          <strong>{row.fieldLabel}</strong>
                          <div className="flagged-field-rationale">
                            {row.portalValueSourceLabel} | {row.reviewStatus}
                          </div>
                        </div>
                        <button
                          className="button secondary compact"
                          onClick={() => onInspect(row.fieldKey)}
                          type="button"
                        >
                          Inspect
                        </button>
                      </div>
                      <div className="field-debug-meta">
                        <div className="comparison-value-label">OASIS says</div>
                        <div className="comparison-value-text">{row.displayPortalValue}</div>
                      </div>
                      {hasReferralCoverage(patient) ? (
                        <div className="field-debug-meta">
                          <div className="comparison-value-label">Referral check</div>
                          <div className="comparison-value-text">{row.displayReferralValue}</div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="muted">
          {oasisCaptureSkipReason
            ? `No structured OASIS values have been promoted into the dashboard yet. ${oasisCaptureSkipReason}`
            : "No structured OASIS values have been promoted into the dashboard yet. This usually means the printed-note extraction did not produce usable chart values for this patient."}
        </div>
      )}
    </section>
  );
}

function shouldShowReviewStatus(comparison: FieldComparison): boolean {
  return normalizeLabelForComparison(comparison.reviewStatus)
    !== normalizeLabelForComparison(getResultLabel(comparison.comparisonResult));
}

function PatientCompareHeader({ workspace }: { workspace: ComparisonWorkspaceModel }) {
  return (
    <section className="workspace-header panel compare-header">
      <div>
        <div className="workspace-eyebrow">OASIS and Referral QA Workspace</div>
        <h1 className="page-title">{workspace.header.patientName}</h1>
        <div className="workspace-context-row">
          <span>Subsidiary: {workspace.header.subsidiaryName}</span>
          <span>Last refresh: {workspace.header.lastRefreshLabel}</span>
        </div>
      </div>
      <div className="workspace-header-metrics">
        <div className="workspace-header-metric">
          <span className="metric-label">OASIS Timing</span>
          <strong>{workspace.header.daysLeftLabel}</strong>
        </div>
        <div className="workspace-header-metric workspace-header-metric-wide">
          <span className="metric-label">Overall Review Verdict</span>
          <strong>{workspace.header.overallReviewVerdict}</strong>
        </div>
      </div>
    </section>
  );
}

function ComparisonSummaryBar({ workspace }: { workspace: ComparisonWorkspaceModel }) {
  const cards = [
    { label: "Total Mismatches", value: workspace.summary.mismatchCount, tone: "danger" },
    { label: "Missing in Portal", value: workspace.summary.missingInPortalCount, tone: "warning" },
    { label: "Missing Referral Documentation", value: workspace.summary.missingInReferralCount, tone: "warning" },
    { label: "Exact Matches", value: workspace.summary.exactMatchCount, tone: "success" },
    { label: "Uncertain Comparisons", value: workspace.summary.uncertainCount, tone: "default" },
    { label: "Coding-Sensitive", value: workspace.summary.codingReviewCount, tone: "danger" },
  ] as const;

  return (
    <section className="priority-summary-bar">
      {cards.map((card) => (
        <article className="priority-summary-card comparison-summary-card" key={card.label}>
          <div className="metric-label">{card.label}</div>
          <div className="priority-summary-value">{card.value}</div>
        </article>
      ))}
    </section>
  );
}

function CompareFilterBar({
  workspace,
  searchTerm,
  sectionFilter,
  resultFilter,
  showMatches,
  visibleCount,
  onSearchTermChange,
  onSectionFilterChange,
  onResultFilterChange,
  onShowMatchesChange,
}: {
  workspace: ComparisonWorkspaceModel;
  searchTerm: string;
  sectionFilter: string;
  resultFilter: CompareFilterValue;
  showMatches: boolean;
  visibleCount: number;
  onSearchTermChange: (nextValue: string) => void;
  onSectionFilterChange: (nextValue: string) => void;
  onResultFilterChange: (nextValue: CompareFilterValue) => void;
  onShowMatchesChange: (nextValue: boolean) => void;
}) {
  return (
    <section className="panel compare-filter-bar">
      <div className="compare-filter-grid">
        <label className="field compact-filter-field">
          <span>Search fields</span>
          <input
            className="input"
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Search field, section, referral, or portal value"
            value={searchTerm}
          />
        </label>

        <label className="field compact-filter-field">
          <span>Section</span>
          <select className="input" onChange={(event) => onSectionFilterChange(event.target.value)} value={sectionFilter}>
            <option value="">All sections</option>
            {workspace.sections.map((section) => (
              <option key={section.sectionKey} value={section.sectionKey}>
                {section.sectionLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="field compact-filter-field">
          <span>Compare result</span>
          <select className="input" onChange={(event) => onResultFilterChange(event.target.value as CompareFilterValue)} value={resultFilter}>
            <option value="open">Open differences only</option>
            <option value="all">All visible results</option>
            <option value="mismatch">Mismatch</option>
            <option value="missing_in_portal">Missing in Portal</option>
            <option value="missing_in_referral">Missing Referral Documentation</option>
            <option value="uncertain">Uncertain</option>
            <option value="coding_review">Coding Review</option>
            <option value="equivalent_match">Equivalent Match</option>
            <option value="match">Match</option>
          </select>
        </label>
      </div>

      <div className="compare-filter-actions">
        <label className="compare-toggle">
          <input checked={showMatches} onChange={(event) => onShowMatchesChange(event.target.checked)} type="checkbox" />
          <span>Show hidden / resolved rows</span>
        </label>
        <span className="badge">{visibleCount} visible</span>
      </div>
    </section>
  );
}

function DocumentSnippetPopover({ comparison }: { comparison: FieldComparison }) {
  return (
    <details className="artifact-drawer snippet-popover">
      <summary>
        <span>Source Snippet</span>
        <span className="badge">{comparison.evidence.length}</span>
      </summary>
      <div className="artifact-stack compact-artifact-stack">
        {comparison.sourceQualityWarning ? (
          <div className="checklist-item">
            <div className="metric-label">Why this still needs review</div>
            <div>{comparison.sourceQualityWarning}</div>
          </div>
        ) : null}

        {comparison.visibilityReason ? (
          <div className="checklist-item">
            <div className="metric-label">Visibility decision</div>
            <div>{comparison.visibilityReason}</div>
            {comparison.visibilityDecision ? <div className="muted">{comparison.visibilityDecision}</div> : null}
          </div>
        ) : null}

        {comparison.evidence.length > 0 ? (
          comparison.evidence.map((entry) => (
            <div className="checklist-item" key={entry.id}>
              <div className="checklist-item-header">
                <strong>{entry.sourceLabel}</strong>
                <div className="comparison-status-block-inline">
                  {typeof entry.pageHint === "number" ? <span className="badge">Page {entry.pageHint}</span> : null}
                  <span className="badge">{entry.confidenceLabel}</span>
                </div>
              </div>
              <div className="muted">{entry.sourceType}</div>
              <div>{entry.snippet ?? "No short source snippet available."}</div>
            </div>
          ))
        ) : (
          <div className="checklist-item">
            <div>No referral snippet is attached to this comparison.</div>
          </div>
        )}
      </div>
    </details>
  );
}

function ComparisonRow({
  comparison,
  onInspect,
  isSelected,
}: {
  comparison: FieldComparison;
  onInspect?: (fieldKey: string) => void;
  isSelected?: boolean;
}) {
  return (
    <article className={`comparison-row${isSelected ? " selected" : ""}`}>
      <div className="comparison-row-main">
        <div className="comparison-field-block">
          <div className="comparison-field-label">{comparison.fieldLabel}</div>
          <div className="comparison-field-meta">
            <span>{comparison.sectionLabel}</span>
            {comparison.sourceSectionLabel !== comparison.sectionLabel ? <span>{comparison.sourceSectionLabel}</span> : null}
            {comparison.oasisItemId ? <span>{comparison.oasisItemId}</span> : null}
          </div>
        </div>

        <div className="comparison-value-block">
          <div className="comparison-value-label">Referral Extract</div>
          <div className="comparison-value-text">{comparison.displayReferralValue}</div>
        </div>

        <div className="comparison-value-block">
          <div className="comparison-value-label">OASIS / Chart Snapshot</div>
          <div className="comparison-value-text">{comparison.displayPortalValue}</div>
          <div className="muted">Source: {comparison.portalValueSourceLabel}</div>
        </div>

        <div className="comparison-status-block">
          <span className={getResultBadgeClass(comparison.comparisonResult)}>{getResultLabel(comparison.comparisonResult)}</span>
          {shouldShowReviewStatus(comparison) ? <span className="badge">{comparison.reviewStatus}</span> : null}
          <span className="badge">{getConfidenceLabel(comparison.confidence)}</span>
          {comparison.isFormattingOnlyDifference ? <span className="badge success">Formatting only</span> : null}
          {comparison.isFieldLeakSuspected ? <span className="badge warning">Possible field leak</span> : null}
        </div>
      </div>

      <div className="comparison-row-footer">
        <div className="comparison-row-reason">{comparison.shortReason}</div>
        <div className="comparison-row-actions">
          <span className="badge">{getSourceSupportLabel(comparison.sourceSupportStrength)}</span>
          <span className="badge">{getMappingStrengthLabel(comparison.mappingStrength)}</span>
          {comparison.visibilityDecision && comparison.visibilityDecision !== "show" ? (
            <span className="badge">{formatStatusLabel(comparison.visibilityDecision)}</span>
          ) : null}
          <DocumentSnippetPopover comparison={comparison} />
          {onInspect ? (
            <button className="button secondary compact" onClick={() => onInspect(comparison.fieldKey)} type="button">
              Inspect
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ComparisonSectionAccordion({
  section,
  rows,
  onInspect,
}: {
  section: ComparisonSectionSummary;
  rows: FieldComparison[];
  onInspect: (fieldKey: string) => void;
}) {
  const sectionCounts = [
    { count: section.mismatchCount, label: "mismatch", className: "badge danger" },
    { count: section.missingInPortalCount, label: "missing in portal", className: "badge warning" },
    { count: section.missingInReferralCount, label: "missing referral documentation", className: "badge warning" },
    { count: section.uncertainCount, label: "uncertain", className: "badge" },
    { count: section.matchCount, label: "match", className: "badge success" },
  ].filter((entry) => entry.count > 0);

  return (
    <details className="section-queue-card comparison-section-accordion" open={rows.length > 0}>
      <summary className="comparison-section-summary">
        <div>
          <strong>{section.sectionLabel}</strong>
          <div className="muted">{rows.length} row(s) surfaced in this section</div>
        </div>
        <div className="comparison-section-counts">
          {sectionCounts.map((entry) => (
            <span className={entry.className} key={entry.label}>
              {entry.count} {entry.label}
            </span>
          ))}
        </div>
      </summary>

      <div className="section-queue-body">
        {rows.length > 0 ? (
          <div className="comparison-list">
            {rows.map((comparison) => (
              <ComparisonRow comparison={comparison} key={comparison.fieldKey} onInspect={onInspect} />
            ))}
          </div>
        ) : (
          <div className="muted">No rows match the current filters in this section.</div>
        )}
      </div>
    </details>
  );
}

function CodingSensitivePanel({
  rows,
  onInspect,
}: {
  rows: FieldComparison[];
  onInspect: (fieldKey: string) => void;
}) {
  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Coding-Sensitive Differences</h2>
          <p className="page-subtitle">
            Diagnosis and sequencing comparisons are separated here so QA can review them with coding context.
          </p>
        </div>
        <span className="badge danger">{rows.length}</span>
      </div>

      {rows.length > 0 ? (
        <div className="comparison-list">
          {rows.map((comparison) => (
            <ComparisonRow comparison={comparison} key={comparison.fieldKey} onInspect={onInspect} />
          ))}
        </div>
      ) : (
        <div className="muted">No coding-sensitive differences are currently surfaced.</div>
      )}
    </section>
  );
}

function UncertainReviewPanel({
  rows,
  onInspect,
}: {
  rows: FieldComparison[];
  onInspect: (fieldKey: string) => void;
}) {
  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Uncertain / Needs Review</h2>
          <p className="page-subtitle">
            These rows are separated from true mismatches because the referral evidence is too weak to trust as a correction.
          </p>
        </div>
        <span className="badge">{rows.length}</span>
      </div>

      {rows.length > 0 ? (
        <div className="comparison-list">
          {rows.map((comparison) => (
            <ComparisonRow comparison={comparison} key={comparison.fieldKey} onInspect={onInspect} />
          ))}
        </div>
      ) : (
        <div className="muted">No uncertain rows match the current filters.</div>
      )}
    </section>
  );
}

function DocumentAnchorHeader({
  title,
  documentLabel,
  sectionLabel,
  pageHint,
}: {
  title: string;
  documentLabel: string;
  sectionLabel: string | null | undefined;
  pageHint: number | null | undefined;
}) {
  return (
    <div className="document-anchor-header">
      <div>
        <h3>{title}</h3>
        <div className="muted">{documentLabel}</div>
      </div>
      <div className="document-anchor-meta">
        {sectionLabel ? <span className="badge">{sectionLabel}</span> : null}
        {typeof pageHint === "number" ? <span className="badge">Page {pageHint}</span> : null}
      </div>
    </div>
  );
}

function HighlightedSnippet({
  label,
  value,
  helperText,
  highlighted = false,
  snippetRef,
}: {
  label: string;
  value: string;
  helperText?: string | null;
  highlighted?: boolean;
  snippetRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={`highlighted-snippet${highlighted ? " active" : ""}`} ref={snippetRef}>
      <div className="metric-label">{label}</div>
      <div className="highlighted-snippet-body">{value}</div>
      {helperText ? <div className="muted">{helperText}</div> : null}
    </div>
  );
}

function SourceDocumentPane({
  title,
  documentLabel,
  sectionLabel,
  pageHint,
  children,
}: {
  title: string;
  documentLabel: string;
  sectionLabel: string | null | undefined;
  pageHint: number | null | undefined;
  children: ReactNode;
}) {
  return (
    <section className="panel source-document-pane">
      <DocumentAnchorHeader
        documentLabel={documentLabel}
        pageHint={pageHint}
        sectionLabel={sectionLabel}
        title={title}
      />
      <div className="source-document-scroll-region">{children}</div>
    </section>
  );
}

function CompareContextSidebar({
  rows,
  selectedFieldKey,
  onSelectField,
  itemRefs,
}: {
  rows: FieldComparison[];
  selectedFieldKey: string | null;
  onSelectField: (fieldKey: string) => void;
  itemRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
}) {
  return (
    <aside className="panel compare-context-sidebar">
      <div className="panel-header-inline">
        <div>
          <h2>Compare Context</h2>
          <p className="page-subtitle">Pick a field and jump directly into the referral versus portal context.</p>
        </div>
        <span className="badge">{rows.length}</span>
      </div>

      {rows.length > 0 ? (
        <div className="source-document-list">
          {rows.map((comparison) => (
            <button
              className={`source-document-list-item${selectedFieldKey === comparison.fieldKey ? " active" : ""}`}
              key={comparison.fieldKey}
              onClick={() => onSelectField(comparison.fieldKey)}
              ref={(node) => {
                itemRefs.current[comparison.fieldKey] = node;
              }}
              type="button"
            >
              <div>
                <strong>{comparison.fieldLabel}</strong>
                <div className="muted compact-meta">{comparison.sectionLabel}</div>
              </div>
              <span className={getResultBadgeClass(comparison.comparisonResult)}>
                {getResultLabel(comparison.comparisonResult)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="muted">No source-document rows are available with the current filters.</div>
      )}
    </aside>
  );
}

function SourceDocumentsWorkspace({
  rows,
  selectedFieldKey,
  onSelectField,
}: {
  rows: FieldComparison[];
  selectedFieldKey: string | null;
  onSelectField: (fieldKey: string) => void;
}) {
  const selectedComparison =
    rows.find((comparison) => comparison.fieldKey === selectedFieldKey) ??
    rows.find((comparison) => hasVisiblePortalValue(comparison.portalValue)) ??
    rows[0] ??
    null;
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const referralHighlightRef = useRef<HTMLDivElement | null>(null);
  const portalHighlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedComparison) {
      return;
    }
    itemRefs.current[selectedComparison.fieldKey]?.scrollIntoView({ block: "nearest" });
    referralHighlightRef.current?.scrollIntoView({ block: "center" });
    portalHighlightRef.current?.scrollIntoView({ block: "center" });
  }, [selectedComparison?.fieldKey]);

  return (
    <section className="source-documents-workspace">
      <div className="panel source-documents-workspace-header">
        <div className="panel-header-inline">
          <div>
            <h2>Source Documents</h2>
            <p className="page-subtitle">
              Inspect the selected field with the referral on the left and the current portal output on the right. This tab includes resolved and hidden rows so captured chart snapshot values remain inspectable.
            </p>
          </div>
          {selectedComparison ? (
            <div className="comparison-status-block comparison-status-block-inline">
              <span className={getResultBadgeClass(selectedComparison.comparisonResult)}>
                {getResultLabel(selectedComparison.comparisonResult)}
              </span>
              {shouldShowReviewStatus(selectedComparison) ? (
                <span className="badge">{selectedComparison.reviewStatus}</span>
              ) : null}
              <span className="badge">{getConfidenceLabel(selectedComparison.confidence)}</span>
            </div>
          ) : null}
        </div>
        {selectedComparison ? (
          <div className="source-documents-summary-strip">
            <span className="badge">{selectedComparison.fieldLabel}</span>
            <span className="badge">{getSourceSupportLabel(selectedComparison.sourceSupportStrength)}</span>
            <span className="badge">{getMappingStrengthLabel(selectedComparison.mappingStrength)}</span>
            {selectedComparison.inspectTarget?.referralSection ? (
              <span className="badge">Referral anchor: {selectedComparison.inspectTarget.referralSection}</span>
            ) : null}
            {selectedComparison.inspectTarget?.portalSection ? (
              <span className="badge">Portal anchor: {selectedComparison.inspectTarget.portalSection}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="source-documents-grid">
        <CompareContextSidebar
          itemRefs={itemRefs}
          onSelectField={onSelectField}
          rows={rows}
          selectedFieldKey={selectedComparison?.fieldKey ?? null}
        />

        {selectedComparison ? (
          <>
            <SourceDocumentPane
              documentLabel={selectedComparison.sourceDocuments[0] ?? "Referral document"}
              pageHint={selectedComparison.inspectTarget?.referralPage ?? null}
              sectionLabel={selectedComparison.inspectTarget?.referralSection ?? selectedComparison.sourceSectionLabel}
              title="Referral Document"
            >
              <HighlightedSnippet
                helperText="Preferred source of truth"
                highlighted
                label="Referral says"
                snippetRef={referralHighlightRef}
                value={selectedComparison.displayReferralValue}
              />
              <HighlightedSnippet
                helperText={selectedComparison.shortReason}
                label="Linked referral snippet"
                value={selectedComparison.inspectTarget?.referralSnippet ?? "No linked referral snippet available."}
              />
              {selectedComparison.evidence.slice(1).map((entry) => (
                <HighlightedSnippet
                  helperText={entry.confidenceLabel}
                  key={entry.id}
                  label={entry.sourceLabel}
                  value={entry.snippet ?? "No short source snippet available."}
                />
              ))}
            </SourceDocumentPane>

            <SourceDocumentPane
              documentLabel="Portal output"
              pageHint={selectedComparison.inspectTarget?.portalPage ?? null}
              sectionLabel={selectedComparison.inspectTarget?.portalSection ?? selectedComparison.sectionLabel}
              title="Portal Output"
            >
              <HighlightedSnippet
                helperText="Captured chart value"
                highlighted
                label="Chart snapshot"
                snippetRef={portalHighlightRef}
                value={selectedComparison.displayPortalValue}
              />
              <HighlightedSnippet
                helperText="Why this row is surfaced"
                label="Review note"
                value={selectedComparison.shortReason}
              />
              {selectedComparison.isFormattingOnlyDifference ? (
                <HighlightedSnippet
                  helperText="This should not be treated as a true mismatch."
                  label="Normalization result"
                  value="Referral and portal values align after formatting normalization."
                />
              ) : null}
              {selectedComparison.isFieldLeakSuspected ? (
                <HighlightedSnippet
                  helperText="Cross-field leakage was detected."
                  label="Mapping warning"
                  value="The referral value looks like it belongs to a different field and should be reviewed before QA treats it as a correction."
                />
              ) : null}
            </SourceDocumentPane>
          </>
        ) : (
          <div className="panel muted">Select a field from the list to inspect referral versus portal support.</div>
        )}
      </div>
    </section>
  );
}

export default function PatientDetailPage() {
  const params = useParams<{ runId: string; patientId: string }>();
  const router = useRouter();
  const runId = params.runId;
  const patientId = params.patientId;

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("oasis_snapshot");
  const [searchTerm, setSearchTerm] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<CompareFilterValue>("open");
  const [showMatches, setShowMatches] = useState(false);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);

  function handleInspect(fieldKey: string): void {
    setSelectedFieldKey(fieldKey);
    setActiveTab("source_documents");
  }

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

  useEffect(() => {
    if (!patient || patient.batchId === runId) {
      return;
    }

    router.replace(`/runs/${encodeURIComponent(patient.batchId)}/patients/${encodeURIComponent(patientId)}`);
  }, [patient, patientId, router, runId]);

  useEffect(() => {
    if (!patient) {
      return;
    }

    if (!hasReferralCoverage(patient)) {
      setActiveTab((currentTab) =>
        currentTab === "compare_all" ? "oasis_snapshot" : currentTab,
      );
    }
  }, [patient]);

  const workspace = patient ? buildComparisonWorkspaceModel(patient) : null;
  const compareAllRows = workspace
    ? filterComparisonRows(workspace.comparisons, {
        searchTerm,
        sectionFilter,
        resultFilter,
        showMatches,
      })
    : [];
  const clinicalRows = compareAllRows.filter((row) => !row.isCodingSensitive);
  const codingRows = workspace
    ? filterComparisonRows(
        workspace.comparisons.filter((row) => row.isCodingSensitive),
        { searchTerm, sectionFilter, resultFilter: showMatches ? "all" : "open", showMatches },
      )
    : [];
  const uncertainRows = workspace
    ? filterComparisonRows(
        workspace.comparisons.filter((row) => row.comparisonResult === "uncertain"),
        { searchTerm, sectionFilter, resultFilter: "all", showMatches: true },
      )
    : [];
  const sourceRows = workspace
    ? filterComparisonRows(workspace.comparisons, {
        searchTerm,
        sectionFilter,
        resultFilter: "all",
        showMatches: true,
      })
    : [];
  const sectionRows = workspace
    ? workspace.sections
        .filter((section) => section.sectionKey !== "active_diagnoses")
        .map((section) => ({
          section,
          rows: clinicalRows.filter((row) => row.sectionKey === section.sectionKey),
        }))
        .filter((entry) => entry.rows.length > 0)
    : [];
  const tabs: Array<{ key: WorkspaceTab; label: string; count?: number }> = workspace
    ? [
        {
          key: "oasis_snapshot",
          label: "OASIS Snapshot",
          count: workspace.comparisons.filter((row) => hasUsableOasisValue(row)).length,
        },
        { key: "compare_all", label: "Compare All", count: compareAllRows.length },
        { key: "clinical_sections", label: "Clinical Sections", count: sectionRows.length },
        { key: "coding_sensitive", label: "Coding-Sensitive", count: codingRows.length },
        { key: "uncertain", label: "Uncertain / Needs Review", count: uncertainRows.length },
        { key: "source_documents", label: "Source Documents", count: sourceRows.length },
      ]
    : [];

  return (
    <main className="page-shell patient-page-shell patient-dashboard stack">
      <div className="page-header">
        <div>
          <Link className="link" href="/agency">Back to agency overview</Link>
          <p className="eyebrow">OASIS and Referral QA Workspace</p>
          <p className="page-subtitle">
            Open the patient, review the extracted OASIS details, compare them against referral support when available, and work mismatches from the top down.
          </p>
        </div>
        <div className="actions">
          <Link className="button secondary" href="/select-agency?change=1">
            Change Agency
          </Link>
          <form action="/auth/logout" method="post">
            <button className="button secondary" type="submit">
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {!patient ? <div className="panel muted">Loading patient...</div> : null}

      {patient && workspace ? (
        <>
          <PatientCompareHeader workspace={workspace} />
          {workspace.globalTrustWarning ? (
            <section className="panel global-trust-banner">
              <span className="badge warning">Needs Review</span>
              <div>{workspace.globalTrustWarning}</div>
            </section>
          ) : null}
          <ComparisonSummaryBar workspace={workspace} />
          <DiagnosisSummaryPanel patient={patient} />
          <DocumentationCoveragePanel patient={patient} workspace={workspace} />
          <BillingPeriodCardsPanel prefetch={patient.qaPrefetch} />

          <div aria-label="Patient review tabs" className="workspace-tab-bar" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.key}
                className={`workspace-tab${activeTab === tab.key ? " active" : ""}`}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                type="button"
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" ? <span className="badge">{tab.count}</span> : null}
              </button>
            ))}
          </div>

          {activeTab !== "oasis_snapshot" && activeTab !== "coding_sensitive" && activeTab !== "uncertain" ? (
            <CompareFilterBar
              onResultFilterChange={setResultFilter}
              onSearchTermChange={setSearchTerm}
              onSectionFilterChange={setSectionFilter}
              onShowMatchesChange={setShowMatches}
              resultFilter={resultFilter}
              searchTerm={searchTerm}
              sectionFilter={sectionFilter}
              showMatches={showMatches}
              visibleCount={activeTab === "compare_all" ? compareAllRows.length : activeTab === "clinical_sections" ? clinicalRows.length : sourceRows.length}
              workspace={workspace}
            />
          ) : null}

          {activeTab === "oasis_snapshot" ? (
            <OasisSnapshotPanel onInspect={handleInspect} patient={patient} workspace={workspace} />
          ) : null}

          {activeTab === "compare_all" ? (
            <section className="panel stack">
              <div className="panel-header-inline">
                <div>
                  <h2>Compare All</h2>
                  <p className="page-subtitle">
                    {hasReferralCoverage(patient)
                      ? "This work queue compares referral support against the captured OASIS values and keeps OASIS-backed rows visible while follow-up is still needed."
                      : "Referral documentation is missing, so this queue mainly shows where OASIS-backed values exist without referral support. Use OASIS Snapshot as the primary chart view."}
                  </p>
                </div>
                <span className="badge">{compareAllRows.length}</span>
              </div>
              {compareAllRows.length > 0 ? (
                <div className="comparison-list">
                  {compareAllRows.map((comparison) => (
                    <ComparisonRow comparison={comparison} key={comparison.fieldKey} onInspect={handleInspect} />
                  ))}
                </div>
              ) : <div className="muted">No rows match the current filters.</div>}
            </section>
          ) : null}

          {activeTab === "clinical_sections" ? (
            <div className="workspace-section-stack">
              {sectionRows.length > 0 ? sectionRows.map((entry) => (
                <ComparisonSectionAccordion key={entry.section.sectionKey} onInspect={handleInspect} rows={entry.rows} section={entry.section} />
              )) : <div className="panel muted">No section rows match the current filters.</div>}
            </div>
          ) : null}

          {activeTab === "coding_sensitive" ? <CodingSensitivePanel onInspect={handleInspect} rows={codingRows} /> : null}
          {activeTab === "uncertain" ? <UncertainReviewPanel onInspect={handleInspect} rows={uncertainRows} /> : null}
          {activeTab === "source_documents" ? (
            <SourceDocumentsWorkspace
              onSelectField={setSelectedFieldKey}
              rows={sourceRows}
              selectedFieldKey={selectedFieldKey}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
