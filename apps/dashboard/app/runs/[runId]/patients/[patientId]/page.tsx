"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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
import type { PatientDetail, QaPrefetchSummary, WorkflowTrackSummary } from "../../../../../lib/types";

type WorkspaceTab =
  | "compare_all"
  | "clinical_sections"
  | "coding_sensitive"
  | "uncertain"
  | "source_documents"
  | "debug";

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function PatientCompareHeader({ workspace }: { workspace: ComparisonWorkspaceModel }) {
  return (
    <section className="workspace-header panel compare-header">
      <div>
        <div className="workspace-eyebrow">Referral vs Portal Reconciliation Workspace</div>
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
    { label: "Missing in Referral", value: workspace.summary.missingInReferralCount, tone: "warning" },
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
          <span className={`badge${card.tone === "danger" ? " danger" : card.tone === "warning" ? " warning" : card.tone === "success" ? " success" : ""}`}>
            {card.label}
          </span>
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
            <option value="missing_in_referral">Missing in Referral</option>
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
          <span>Show matches</span>
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
          <div className="comparison-value-label">Referral Says</div>
          <div className="comparison-value-text">{comparison.displayReferralValue}</div>
        </div>

        <div className="comparison-value-block">
          <div className="comparison-value-label">Portal Shows</div>
          <div className="comparison-value-text">{comparison.displayPortalValue}</div>
        </div>

        <div className="comparison-status-block">
          <span className={getResultBadgeClass(comparison.comparisonResult)}>{getResultLabel(comparison.comparisonResult)}</span>
          <span className="badge">{comparison.reviewStatus}</span>
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
          {comparison.referralSnippet ? <span className="muted comparison-inline-snippet">{comparison.referralSnippet}</span> : null}
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
  return (
    <details className="section-queue-card comparison-section-accordion" open={rows.length > 0}>
      <summary className="comparison-section-summary">
        <div>
          <strong>{section.sectionLabel}</strong>
          <div className="muted">{rows.length} row(s) surfaced in this section</div>
        </div>
        <div className="comparison-section-counts">
          <span className="badge danger">{section.mismatchCount} mismatch</span>
          <span className="badge warning">{section.missingInPortalCount} missing in portal</span>
          <span className="badge warning">{section.missingInReferralCount} missing in referral</span>
          <span className="badge">{section.uncertainCount} uncertain</span>
          <span className="badge success">{section.matchCount} match</span>
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
  const selectedComparison = rows.find((comparison) => comparison.fieldKey === selectedFieldKey) ?? rows[0] ?? null;
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
              Inspect the selected field with the referral on the left and the current portal output on the right.
            </p>
          </div>
          {selectedComparison ? (
            <div className="comparison-status-block comparison-status-block-inline">
              <span className={getResultBadgeClass(selectedComparison.comparisonResult)}>
                {getResultLabel(selectedComparison.comparisonResult)}
              </span>
              <span className="badge">{selectedComparison.reviewStatus}</span>
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
                helperText="Current charted value"
                highlighted
                label="Portal shows"
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

function DebugDrawer({ title, count, children }: { title: string; count?: number | string; children: ReactNode }) {
  return (
    <details className="artifact-drawer">
      <summary>
        <span>{title}</span>
        {typeof count !== "undefined" ? <span className="badge">{count}</span> : null}
      </summary>
      <div>{children}</div>
    </details>
  );
}

function WorkflowSummary({ label, workflow }: { label: string; workflow: WorkflowTrackSummary | null }) {
  return (
    <div className="checklist-item">
      <div className="checklist-item-header">
        <strong>{label}</strong>
        <span className="badge">{workflow?.status ?? "Not started"}</span>
      </div>
      <div className="muted">{workflow?.stepName ?? "No step recorded."}</div>
      <div>{workflow?.message ?? "No workflow note recorded."}</div>
      {workflow ? <div className="muted">Updated {formatTimestamp(workflow.lastUpdatedAt)}</div> : null}
    </div>
  );
}

function renderQaPrefetchRows(prefetch: QaPrefetchSummary | null): Array<{ label: string; value: string }> {
  if (!prefetch) {
    return [{ label: "Status", value: "QA prefetch not available." }];
  }

  return [
    { label: "Status", value: prefetch.status },
    { label: "Selected route", value: prefetch.selectedRouteSummary ?? "Not resolved" },
    { label: "OASIS found", value: prefetch.oasisFound ? "Yes" : "No" },
    { label: "Diagnosis found", value: prefetch.diagnosisFound ? "Yes" : "No" },
    { label: "Printed note", value: prefetch.printedNoteStatus ?? "Not captured" },
    { label: "Printed note source", value: prefetch.printedNoteReviewSource ?? "Not captured" },
    { label: "Warnings", value: String(prefetch.warningCount + prefetch.printedNoteWarningCount) },
  ];
}

function DebugTab({ patient, workspace }: { patient: PatientDetail; workspace: ComparisonWorkspaceModel }) {
  return (
    <section className="panel stack debug-secondary-panel">
      <div>
        <h2>Debug</h2>
        <p className="page-subtitle">
          Secondary system context only. This stays collapsed so the main workflow remains focused on reconciliation.
        </p>
      </div>

      <DebugDrawer count={workspace.debug.referralWarnings.length} title="Referral Processing Status">
        <div className="artifact-stack compact-artifact-stack">
          <div className="checklist-item">
            <div className="metric-label">Referral trust level</div>
            <div>{formatStatusLabel(workspace.debug.referralUsability)}</div>
          </div>
          <div className="checklist-item">
            <div className="metric-label">Review pipeline status</div>
            <div>{formatStatusLabel(workspace.debug.qaStatus)}</div>
          </div>
          {workspace.debug.referralWarnings.length > 0 ? (
            <div className="checklist-item">
              <div className="metric-label">Warnings</div>
              <div className="checklist compact-checklist">
                {workspace.debug.referralWarnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DebugDrawer>

      <DebugDrawer title="Workflow Status">
        <div className="artifact-stack compact-artifact-stack">
          <WorkflowSummary label="Coding track" workflow={patient.codingWorkflow} />
          <WorkflowSummary label="QA track" workflow={patient.qaWorkflow} />
        </div>
      </DebugDrawer>

      <DebugDrawer title="Portal Read Context">
        <table className="table">
          <tbody>
            {renderQaPrefetchRows(patient.qaPrefetch).map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
            <tr>
              <th>Billing period</th>
              <td>{patient.workbookContext.billingPeriod ?? "Not provided"}</td>
            </tr>
            <tr>
              <th>Workflow types</th>
              <td>{patient.workbookContext.workflowTypes.join(", ") || "Not available"}</td>
            </tr>
            <tr>
              <th>Raw days-left values</th>
              <td>{patient.workbookContext.rawDaysLeftValues.join(", ") || "Not captured"}</td>
            </tr>
          </tbody>
        </table>
      </DebugDrawer>
    </section>
  );
}

export default function PatientDetailPage() {
  const params = useParams<{ runId: string; patientId: string }>();
  const runId = params.runId;
  const patientId = params.patientId;

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("compare_all");
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
        resultFilter: showMatches ? "all" : "open",
        showMatches,
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
        { key: "compare_all", label: "Compare All", count: compareAllRows.length },
        { key: "clinical_sections", label: "Clinical Sections", count: sectionRows.length },
        { key: "coding_sensitive", label: "Coding-Sensitive", count: codingRows.length },
        { key: "uncertain", label: "Uncertain / Needs Review", count: uncertainRows.length },
        { key: "source_documents", label: "Source Documents", count: sourceRows.length },
        { key: "debug", label: "Debug" },
      ]
    : [];

  return (
    <main className="page-shell patient-page-shell patient-dashboard stack">
      <div className="page-header">
        <div>
          <Link className="link" href={`/runs/${runId}`}>Back to run</Link>
          <p className="eyebrow">Referral vs Portal Reconciliation Workspace</p>
          <p className="page-subtitle">
            Open the patient, compare what the referral says against what the portal shows, and work the discrepancies from the top down.
          </p>
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

          {activeTab !== "coding_sensitive" && activeTab !== "uncertain" && activeTab !== "debug" ? (
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

          {activeTab === "compare_all" ? (
            <section className="panel stack">
              <div className="panel-header-inline">
                <div>
                  <h2>Compare All</h2>
                  <p className="page-subtitle">This is the default work queue. Matches stay hidden unless you turn them on.</p>
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
          {activeTab === "debug" ? <DebugTab patient={patient} workspace={workspace} /> : null}
        </>
      ) : null}
    </main>
  );
}
