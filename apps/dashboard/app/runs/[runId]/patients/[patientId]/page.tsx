"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type MutableRefObject, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { getPatient, startPatientReferralIntake } from "../../../../../lib/api";
import {
  buildComparisonWorkspaceModel,
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
import {
  buildReferralOasisCategoryModel as buildSourceAwareReferralOasisCategoryModel,
  cleanDiagnosisDescription,
  cleanOasisDisplayLabel,
  compactDisplayText,
  formatClinicalSourceDate,
  normalizeLabelForComparison,
} from "../../../../../lib/referralOasisDisplay";
import type {
  AllergyEntry,
  DiagnosisEntry,
  DiagnosisSummaryBlock,
  MedicationEntry,
  MedicationSummaryBlock,
  PatientDetail,
  QaPrefetchSummary,
} from "../../../../../lib/types";

type WorkspaceTab =
  | "referral_vs_oasis"
  | "referral_documents"
  | "oasis"
  | "plan_of_care"
  | "visit_notes";

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

function formatReferralDocumentTitle(value: string | null | undefined): string {
  const title = value?.trim();
  return title && title.length > 0 ? title : "Referral document";
}

const PORTAL_VALUE_PLACEHOLDERS = new Set([
  "no chart data captured",
  "chart value is blank",
  "printed note ocr did not capture a value",
  "no reliable chart value extracted",
  "no reliable referral value extracted",
  "no explicit primary diagnosis identified in the text",
  "no explicit other diagnoses identified in the text",
]);

function formatDiagnosisEntry(entry: DiagnosisEntry | null): string {
  if (!entry) {
    return "Not available";
  }

  const description = entry.description?.trim() ?? "";
  const code = entry.code?.trim() ?? "";
  if (description && code) {
    return `${code} - ${description}`;
  }

  return description || code || "Not available";
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
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    !PORTAL_VALUE_PLACEHOLDERS.has(normalizeLabelForComparison(trimmed)) &&
    !isOasisSectionEvidenceFallback(trimmed);
}

function isOasisSectionEvidenceFallback(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^printed oasis review captured .+ section evidence\b/i.test(value.trim());
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

function hasReferralSuggestionValue(comparison: FieldComparison): boolean {
  return hasVisiblePortalValue(comparison.displayReferralValue) &&
    (
      comparison.comparisonResult === "missing_in_portal" ||
      comparison.comparisonResult === "coding_review" ||
      !hasUsableOasisValue(comparison)
    );
}

function dedupeDisplayValues(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeLabelForComparison(trimmed);
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

type ClinicalListItem = {
  label: string;
  meta?: string | null;
};

function toDiagnosisListItem(entry: DiagnosisEntry | null): ClinicalListItem | null {
  if (!entry) {
    return null;
  }
  const label = formatDiagnosisEntry(entry);
  if (label === "Not available" || PORTAL_VALUE_PLACEHOLDERS.has(normalizeLabelForComparison(label))) {
    return null;
  }
  return {
    label,
    meta: entry.onsetDate ? `Onset: ${entry.onsetDate}` : null,
  };
}

function buildDiagnosisListFromBlock(block: DiagnosisSummaryBlock): {
  primary: ClinicalListItem | null;
  subsequent: ClinicalListItem[];
} {
  return {
    primary: toDiagnosisListItem(block.primaryDiagnosis),
    subsequent: block.otherDiagnoses
      .map((entry) => toDiagnosisListItem(entry))
      .filter((entry): entry is ClinicalListItem => entry !== null),
  };
}

function buildDiagnosisListFromRows(rows: FieldComparison[], side: "referral" | "oasis"): {
  primary: ClinicalListItem | null;
  subsequent: ClinicalListItem[];
} {
  const values = dedupeDisplayValues(buildActiveDiagnosisDisplayRows(rows)
    .filter((row) => !normalizeLabelForComparison(row.fieldLabel).includes("onset date"))
    .map((row) => side === "referral" ? row.displayReferralValue : row.displayPortalValue)
    .filter((value) => hasVisiblePortalValue(value)));
  const items = values.map((value) => ({ label: value }));
  return {
    primary: items[0] ?? null,
    subsequent: items.slice(1),
  };
}

function formatReferralDiagnosisSpan(value: string): string | null {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || /\binstructions?:/i.test(cleaned) || /^[A-Z]?\d{6,}$/.test(cleaned)) {
    return null;
  }

  const indicationMatch = cleaned.match(/^Indication:\s*(.+?)(?:"|\s+-\s+Z|\s+Z[0-9]|$)/i);
  if (indicationMatch?.[1]) {
    return indicationMatch[1].replace(/\s+-\s*$/, "").trim();
  }

  const parentheticalCodeMatch = cleaned.match(/\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b\)?/i);
  if (!parentheticalCodeMatch) {
    return cleaned;
  }
  const code = parentheticalCodeMatch[1].toUpperCase();
  const description = cleaned
    .replace(new RegExp(`\\(?\\b${code.replace(".", "\\.")}\\b\\)?`, "i"), "")
    .replace(/^[\s:)-]+|[\s:)-]+$/g, "")
    .trim();
  return description ? `${code} - ${description}` : code;
}

function buildReferralDiagnosisListFromSections(patient: PatientDetail): {
  primary: ClinicalListItem | null;
  subsequent: ClinicalListItem[];
} {
  const diagnosisSection = patient.referralSections.find((section) =>
    section.sectionKey === "active_diagnoses" ||
    normalizeLabelForComparison(section.label).includes("diagnos")
  );
  const spans = diagnosisSection?.textSpans ?? [];
  const spanTexts = spans
    .map((span) => span.text)
    .filter((text): text is string => Boolean(text?.trim()));
  const hasShoulderContext = spanTexts.some((text) => /\bright\b/i.test(text) && /\bshoulder\b/i.test(text));
  const items = dedupeDisplayValues(
    spanTexts
      .filter((text) => !(hasShoulderContext && /\bleft\s+knee\b/i.test(text)))
      .map((text) => formatReferralDiagnosisSpan(text))
      .filter((text): text is string => Boolean(text && hasVisiblePortalValue(text))),
  ).map((label) => ({ label }));

  const indicationIndex = items.findIndex((item) => /\bpost-op\b|\bpostoperative\b|\bsurgery\b/i.test(item.label));
  const primary = indicationIndex >= 0 ? items[indicationIndex] : (items[0] ?? null);
  const subsequent = items.filter((_, index) => index !== (indicationIndex >= 0 ? indicationIndex : 0));
  return { primary, subsequent };
}

function diagnosisListHasDescriptions(list: { primary: ClinicalListItem | null; subsequent: ClinicalListItem[] }): boolean {
  return [list.primary, ...list.subsequent]
    .filter((item): item is ClinicalListItem => item !== null)
    .some((item) => !isIcdCodeValue(item.label));
}

function getDiagnosisList(
  patient: PatientDetail,
  block: DiagnosisSummaryBlock,
  rows: FieldComparison[],
  side: "referral" | "oasis",
): {
  primary: ClinicalListItem | null;
  subsequent: ClinicalListItem[];
} {
  if (side === "referral") {
    const fromSections = buildReferralDiagnosisListFromSections(patient);
    if (fromSections.primary || fromSections.subsequent.length > 0) {
      return fromSections;
    }
  }
  const fromRows = buildDiagnosisListFromRows(rows, side);
  const fromBlock = buildDiagnosisListFromBlock(block);
  if (
    (fromRows.primary || fromRows.subsequent.length > 0) &&
    (side === "referral" || !diagnosisListHasDescriptions(fromBlock))
  ) {
    return fromRows;
  }
  if (fromBlock.primary || fromBlock.subsequent.length > 0) {
    return fromBlock;
  }
  if (side === "oasis") {
    return fromBlock;
  }
  if (!hasUsableReferralCoverage(patient)) {
    return fromBlock;
  }
  return fromRows;
}

function toMedicationListItems(summary: MedicationSummaryBlock | null, includeEmptyAllergy = true): ClinicalListItem[] {
  if (!summary) {
    return includeEmptyAllergy ? [{ label: "Allergy: Not documented", meta: null }] : [];
  }
  const medicationItems = summary.medications.map((entry: MedicationEntry) => {
    const metaParts = [
      entry.dose,
      entry.route,
      entry.classification,
      entry.startDate ? `Start: ${entry.startDate}` : null,
      entry.status,
    ].filter((part): part is string => Boolean(part));
    return {
      label: entry.name,
      meta: metaParts.length > 0 ? metaParts.join(" | ") : null,
    };
  });
  const allergyItems = summary.allergies.length > 0
    ? summary.allergies.map((allergy) => {
        if (typeof allergy === "string") {
          return {
            label: `Allergy: ${allergy}`,
            meta: null,
          };
        }
        const entry = allergy as AllergyEntry;
        const metaParts = [
          entry.reaction ? `Reaction: ${entry.reaction}` : null,
          entry.startDate ? `Start: ${entry.startDate}` : null,
          entry.status,
        ].filter((part): part is string => Boolean(part));
        return {
          label: `Allergy: ${entry.name}`,
          meta: metaParts.length > 0 ? metaParts.join(" | ") : null,
        };
      })
    : includeEmptyAllergy
      ? [{ label: "Allergy: Not documented", meta: null }]
      : [];
  return [...medicationItems, ...allergyItems];
}

function splitDisplayListValue(value: string): string[] {
  return value
    .split(/\s*;\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => hasVisiblePortalValue(entry));
}

function buildMedicationItemsFromRows(rows: FieldComparison[], side: "referral" | "oasis"): ClinicalListItem[] {
  return rows.flatMap((row) => {
    const value = side === "referral" ? row.displayReferralValue : row.displayPortalValue;
    const values = splitDisplayListValue(value);
    const isAllergyRow = /\ballerg/i.test(row.fieldLabel);
    return values.map((entry) => ({
      label: isAllergyRow && !/^allerg/i.test(entry) ? `Allergy: ${entry}` : entry,
      meta: null,
    }));
  });
}

function ClinicalListSection({
  title,
  items,
}: {
  title: string;
  items: ClinicalListItem[];
}) {
  return (
    <div className="clinical-list-section">
      <span className="workspace-summary-label">{title}</span>
      {items.length > 0 ? (
        <div className="clinical-value-list">
          {items.map((item, index) => (
            <div className="clinical-value-row" key={`${item.label}-${index}`}>
              <span className="clinical-value-index">{index + 1}</span>
              <div className="clinical-value-body">
                <strong>{item.label}</strong>
                {item.meta ? <span>{item.meta}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="clinical-empty">Not available</div>
      )}
    </div>
  );
}

function ClinicalSourceCard({
  title,
  count,
  countLabel,
  countPluralLabel,
  primary,
  primaryTitle = "Primary Diagnosis",
  subsequent,
  subsequentTitle,
  compact = false,
}: {
  title: string;
  count: number;
  countLabel: string;
  countPluralLabel?: string;
  primary: ClinicalListItem | null;
  primaryTitle?: string | null;
  subsequent: ClinicalListItem[];
  subsequentTitle: string;
  compact?: boolean;
}) {
  return (
    <section className={`clinical-source-card${compact ? " compact" : ""}`}>
      <div className="clinical-source-card-header">
        <div>
          <h2>{title}</h2>
        </div>
        <span className={`badge${count > 0 ? " success" : ""}`}>
          {count} {count === 1 ? countLabel : (countPluralLabel ?? `${countLabel}s`)}
        </span>
      </div>

      {primaryTitle ? (
        <ClinicalListSection
          items={primary ? [primary] : []}
          title={primaryTitle}
        />
      ) : null}
      <ClinicalListSection
        items={subsequent}
        title={subsequentTitle}
      />
    </section>
  );
}

function DiagnosisComparisonPanel({
  patient,
  rows,
}: {
  patient: PatientDetail;
  rows: FieldComparison[];
}) {
  const referralDiagnoses = getDiagnosisList(patient, patient.referralDiagnosisSummary, rows, "referral");
  const oasisDiagnoses = getDiagnosisList(patient, patient.oasisDiagnosisSummary, rows, "oasis");
  const diagnosisRows = buildActiveDiagnosisDisplayRows(rows)
    .filter((row) => hasUsableOasisValue(row) || hasVisiblePortalValue(row.displayReferralValue));
  const referralCount = (referralDiagnoses.primary ? 1 : 0) + referralDiagnoses.subsequent.length;
  const oasisCount = (oasisDiagnoses.primary ? 1 : 0) + oasisDiagnoses.subsequent.length;

  return (
    <div className="clinical-comparison-grid" aria-label="Referral diagnosis versus OASIS diagnosis">
      <ClinicalSourceCard
        count={referralCount}
        countLabel="diagnosis"
        countPluralLabel="diagnoses"
        primary={referralDiagnoses.primary}
        subsequent={referralDiagnoses.subsequent}
        subsequentTitle="Subsequent Diagnoses"
        title="Referral Diagnosis"
      />
      <ClinicalSourceCard
        count={oasisCount}
        countLabel="diagnosis"
        countPluralLabel="diagnoses"
        primary={oasisDiagnoses.primary}
        subsequent={oasisDiagnoses.subsequent}
        subsequentTitle="Subsequent Diagnoses"
        title="OASIS Diagnosis"
      />
      {diagnosisRows.length === 0 ? (
        <div className="clinical-empty wide">No active diagnosis comparison rows were produced for this patient.</div>
      ) : null}
    </div>
  );
}

function MedicationComparisonPanel({
  patient,
  rows,
}: {
  patient: PatientDetail;
  rows: FieldComparison[];
}) {
  const medicationRows = rows.filter(
    (row) => hasUsableOasisValue(row) || hasVisiblePortalValue(row.displayReferralValue),
  );
  const referralMedicationItemsFromRows = buildMedicationItemsFromRows(medicationRows, "referral");
  const oasisMedicationItemsFromRows = buildMedicationItemsFromRows(medicationRows, "oasis");
  const referralMedicationItems = toMedicationListItems(patient.referralMedicationSummary, true);
  const oasisMedicationItems = toMedicationListItems(patient.oasisMedicationSummary, false);
  const visibleReferralItems = referralMedicationItems.length > 0
    ? referralMedicationItems
    : hasUsableReferralCoverage(patient)
      ? referralMedicationItemsFromRows
      : [];
  const visibleOasisItems = oasisMedicationItems.length > 0
    ? oasisMedicationItems
    : oasisMedicationItemsFromRows.length > 0
      ? oasisMedicationItemsFromRows
      : [{ label: "Allergy: Not documented", meta: null }];

  return (
    <div className="clinical-comparison-grid medication-comparison-grid" aria-label="Referral medication versus OASIS medication">
      <ClinicalSourceCard
        compact
        count={visibleReferralItems.length}
        countLabel="item"
        primary={null}
        primaryTitle={null}
        subsequent={visibleReferralItems}
        subsequentTitle="Medications / Allergies"
        title="Referral Medication"
      />
      <ClinicalSourceCard
        compact
        count={visibleOasisItems.length}
        countLabel="item"
        primary={null}
        primaryTitle={null}
        subsequent={visibleOasisItems}
        subsequentTitle="Medications / Allergies"
        title="OASIS Medication"
      />
    </div>
  );
}

function ReferralCompletionSuggestionsPanel({
  rows,
  suggestionsEligible,
}: {
  rows: FieldComparison[];
  suggestionsEligible: boolean;
}) {
  const suggestionRows = rows
    .filter(hasReferralSuggestionValue)
    .sort((left, right) => left.fieldLabel.localeCompare(right.fieldLabel))
    .slice(0, 12);

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Review-Only OASIS Suggestions</h2>
        </div>
        {suggestionsEligible ? (
          <span className="badge success">
            {suggestionRows.length} suggestion{suggestionRows.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {suggestionsEligible && suggestionRows.length > 0 ? (
        <div className="section-field-list">
          {suggestionRows.map((row) => (
            <article className="flagged-field-row" key={`suggestion-${row.fieldKey}`}>
              <div className="flagged-field-header">
                <div>
                  <strong>{row.fieldLabel}</strong>
                  <div className="flagged-field-rationale">
                    {[row.oasisItemId, row.sectionLabel].filter(Boolean).join(" | ") || "OASIS field"}
                  </div>
                </div>
                <span className="badge warning">Review only</span>
              </div>
              <div className="comparison-value-grid">
                <div className="field-debug-meta">
                  <div className="comparison-value-label">Suggested value</div>
                  <div className="comparison-value-text">{row.displayReferralValue}</div>
                </div>
                <div className="field-debug-meta">
                  <div className="comparison-value-label">Current OASIS value</div>
                  <div className="comparison-value-text">{row.displayPortalValue}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

type ReferralOasisGroupKey =
  | "diagnoses"
  | "medications_allergies"
  | "safety_social"
  | "functional_therapy"
  | "body_systems"
  | "dates_admin";

const REFERRAL_OASIS_GROUPS: Array<{ key: ReferralOasisGroupKey; label: string }> = [
  { key: "diagnoses", label: "Diagnoses" },
  { key: "medications_allergies", label: "Medications & Allergies" },
  { key: "safety_social", label: "Safety / Social Support" },
  { key: "functional_therapy", label: "Functional / Therapy" },
  { key: "body_systems", label: "Body Systems" },
  { key: "dates_admin", label: "Dates / Admin" },
];

type PrintedNoteSectionSummary = QaPrefetchSummary["printedNoteSections"][number];

type ReferralOasisDisplayItem = {
  label: string;
  value: string;
  meta?: string | null;
  changed?: boolean;
  changeReason?: string | null;
};

type ReferralOasisCategoryModel = {
  key: ReferralOasisGroupKey;
  label: string;
  referralItems: ReferralOasisDisplayItem[];
  oasisItems: ReferralOasisDisplayItem[];
};

const SECTION_EVIDENCE_PREVIEW_LIMIT = 320;

function isPlanOfCareCategoryText(value: string): boolean {
  return /\b(plan of care|care plan|goal|goals|intervention|interventions|coordination|next visit)\b/i.test(value);
}

function getReferralOasisGroup(row: FieldComparison): ReferralOasisGroupKey | null {
  if (row.sectionKey === "diagnoses") {
    return "diagnoses";
  }
  if (row.sectionKey === "medications_allergies") {
    return "medications_allergies";
  }
  if (row.sectionKey === "safety_social_support") {
    return "safety_social";
  }
  if (row.sectionKey === "functional_therapy") {
    return "functional_therapy";
  }
  if (row.sectionKey === "body_systems") {
    return "body_systems";
  }
  if (row.sectionKey === "dates_admin") {
    return "dates_admin";
  }

  const text = `${row.sectionKey} ${row.sourceSectionLabel} ${row.fieldKey} ${row.fieldLabel}`.toLowerCase();
  if (row.sectionKey.startsWith("active_diagnoses") || /\bdiagnos|icd|onset\b/.test(text)) {
    return "diagnoses";
  }
  if (row.sectionKey.startsWith("medication_allergies") || /\bmedication|allerg|injectable|o0110|high-risk\b/.test(text)) {
    return "medications_allergies";
  }
  if (
    /\bliving|caregiver|emergency|contact|supervision|safety|risk|fall|homebound|transport|code status|directive|hospitalization|alone|support\b/.test(text)
  ) {
    return "safety_social";
  }
  if (/\bfunctional|mobility|self care|therapy|pt\b|ot\b|discipline|frequency|gg0100|gg0130|gg0170|prior function/.test(text)) {
    return "functional_therapy";
  }
  if (isPlanOfCareCategoryText(text)) {
    return null;
  }
  if (/\bneurolog|cardio|respiratory|gastro|genitourinary|integumentary|wound|pain|endocrine|diabetic|eyes|ears|mood|behavioral\b/.test(text)) {
    return "body_systems";
  }
  if (/\bdate|soc|start of care|referral|dob|address|phone|physician|provider|language|admin/.test(text)) {
    return "dates_admin";
  }
  return "body_systems";
}

function getPrintedNoteSectionReferralOasisGroup(section: PrintedNoteSectionSummary): ReferralOasisGroupKey | null {
  const key = normalizeLabelForComparison(section.key);
  const label = normalizeLabelForComparison(section.label);
  const text = `${key} ${label}`;
  if (isPlanOfCareCategoryText(text)) {
    return null;
  }
  if (text.includes("diagnos")) {
    return "diagnoses";
  }
  if (text.includes("medication") || text.includes("allerg")) {
    return "medications_allergies";
  }
  if (text.includes("administrative") || /\badmin|soc|date|provider|identity\b/.test(text)) {
    return "dates_admin";
  }
  if (text.includes("musculoskeletal") || text.includes("functional") || text.includes("therapy") || text.includes("mobility")) {
    return "functional_therapy";
  }
  if (text.includes("primary reason") || text.includes("medical necessity") || /\bsafety|risk|support|homebound|caregiver|emergency|living\b/.test(text)) {
    return "safety_social";
  }
  return "body_systems";
}

function hasReferralBackedComparisonValue(row: FieldComparison): boolean {
  return row.valuePresence?.hasDocumentValue === true || hasVisiblePortalValue(row.displayReferralValue);
}

function isOasisItemIdPlaceholder(value: string | null | undefined, row: FieldComparison): boolean {
  if (!value || !row.oasisItemId) {
    return false;
  }
  return normalizeLabelForComparison(value) === normalizeLabelForComparison(row.oasisItemId);
}

function truncateDisplayText(value: string, maxLength = SECTION_EVIDENCE_PREVIEW_LIMIT): string {
  const compacted = compactDisplayText(value);
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1).trim()}...` : compacted;
}

function buildStructuredItemMeta(row: FieldComparison, side: "referral" | "oasis"): string | null {
  const parts = [
    side === "oasis" && row.oasisItemId && !isOasisItemIdPlaceholder(row.oasisItemId, row)
      ? row.oasisItemId
      : null,
    row.sectionLabel && normalizeLabelForComparison(row.sectionLabel) !== normalizeLabelForComparison(row.fieldLabel)
      ? row.sectionLabel
      : null,
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.slice(0, 2).join(" | ") : null;
}

function dedupeReferralOasisItems(items: ReferralOasisDisplayItem[]): ReferralOasisDisplayItem[] {
  const seen = new Set<string>();
  const deduped: ReferralOasisDisplayItem[] = [];
  for (const item of items) {
    const key = `${normalizeLabelForComparison(item.label)}|${normalizeLabelForComparison(item.value)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

type OasisChangeFlagForDisplay = {
  fieldKey?: string | null;
  label?: string | null;
  kind?: string | null;
};

function findOasisChangeReason(row: FieldComparison, flags: OasisChangeFlagForDisplay[]): string | null {
  if (flags.length === 0) {
    return null;
  }
  const rowKeys = [
    row.fieldKey,
    row.fieldLabel,
    row.oasisItemId ?? "",
    row.sectionKey,
    row.sectionLabel,
  ].map(normalizeLabelForComparison).filter(Boolean);

  for (const flag of flags) {
    const flagKeys = [
      flag.fieldKey ?? "",
      flag.label ?? "",
    ].map(normalizeLabelForComparison).filter(Boolean);
    if (flagKeys.some((flagKey) =>
      rowKeys.some((rowKey) => rowKey === flagKey || rowKey.includes(flagKey) || flagKey.includes(rowKey))
    )) {
      return flag.kind === "regressed" ? "Regressed" : "Changed";
    }
  }

  return null;
}

function buildDisplayItemsFromRows(
  rows: FieldComparison[],
  side: "referral" | "oasis",
  oasisChangeFlags: OasisChangeFlagForDisplay[] = [],
): ReferralOasisDisplayItem[] {
  const items = rows.flatMap((row) => {
    const value = side === "referral" ? row.displayReferralValue : row.displayPortalValue;
    const hasValue = side === "referral"
      ? hasReferralBackedComparisonValue(row) && hasVisiblePortalValue(value)
      : hasUsableOasisValue(row) && hasVisiblePortalValue(value);

    if (!hasValue || isOasisItemIdPlaceholder(value, row)) {
      return [];
    }

    const changeReason = side === "oasis" ? findOasisChangeReason(row, oasisChangeFlags) : null;
    const label = side === "oasis" ? cleanOasisDisplayLabel(row.fieldLabel) : row.fieldLabel;
    return splitDisplayListValue(value)
      .filter((entry) => !isOasisItemIdPlaceholder(entry, row))
      .map((entry) => ({
        label,
        value: entry,
        meta: buildStructuredItemMeta(row, side),
        changed: Boolean(changeReason),
        changeReason,
      }));
  });

  return dedupeReferralOasisItems(items);
}

function diagnosisCodeFromValue(value: string): string | null {
  const direct = value.trim();
  if (isIcdCodeValue(direct)) {
    return direct.toUpperCase();
  }
  const match = direct.match(/\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function getDiagnosisSideValue(row: FieldComparison, side: "referral" | "oasis"): string {
  return side === "referral" ? row.displayReferralValue : row.displayPortalValue;
}

function getDiagnosisSideSnippet(row: FieldComparison, side: "referral" | "oasis"): string | null | undefined {
  return side === "referral" ? row.referralSnippet : row.portalSnippet;
}

function getDiagnosisRoleLabel(row: FieldComparison): string | null {
  const text = normalizeLabelForComparison(`${row.fieldKey} ${row.fieldLabel}`);
  if (text.includes("primary diagnosis")) {
    return "Primary";
  }
  const otherMatch = text.match(/\bother diagnosis (\d+)\b/);
  if (otherMatch) {
    return `Other diagnosis ${otherMatch[1]}`;
  }
  return null;
}

function getStructuredDiagnosisItems(value: unknown): ReferralOasisDisplayItem[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry): ReferralOasisDisplayItem[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const rawCode = typeof record.code === "string"
      ? record.code
      : typeof record.icd10_code === "string"
        ? record.icd10_code
        : null;
    const code = rawCode ? diagnosisCodeFromValue(rawCode) : null;
    const description = typeof record.description === "string" ? compactDisplayText(record.description) : "";
    if (!code && !description) {
      return [];
    }
    return [{
      label: code && description ? `${code} - ${description}` : code ?? description,
      value: "Diagnosis",
      meta: typeof record.role === "string" ? formatStatusLabel(record.role) : null,
    }];
  });
}

function buildDiagnosisDisplayItemsFromRows(
  rows: FieldComparison[],
  side: "referral" | "oasis",
  oasisChangeFlags: OasisChangeFlagForDisplay[] = [],
): ReferralOasisDisplayItem[] {
  const valueRows = rows.filter((row) => {
    const value = getDiagnosisSideValue(row, side);
    return side === "referral"
      ? hasReferralBackedComparisonValue(row) && hasVisiblePortalValue(value)
      : hasUsableOasisValue(row) && hasVisiblePortalValue(value);
  });
  if (side === "referral") {
    const structuredItems = valueRows.flatMap((row) => {
      if (row.fieldKey === "diagnosis_candidates" || row.fieldKey === "diagnosis_supporting_evidence") {
        return [];
      }
      return getStructuredDiagnosisItems(row.documentSupportedValue);
    });
    if (structuredItems.length > 0) {
      return dedupeReferralOasisItems(structuredItems);
    }
  }
  const onsetValues = valueRows
    .filter((row) => normalizeLabelForComparison(row.fieldLabel).includes("onset"))
    .map((row) => compactDisplayText(getDiagnosisSideValue(row, side)))
    .filter(Boolean);
  const diagnosisRows = valueRows.filter((row) => {
    const value = getDiagnosisSideValue(row, side);
    return !normalizeLabelForComparison(row.fieldLabel).includes("onset") &&
      (isIcdCodeValue(value) || /\bdiagnos|icd\b/.test(normalizeLabelForComparison(row.fieldLabel)));
  });

  if (diagnosisRows.length === 0) {
    return buildDisplayItemsFromRows(rows, side, oasisChangeFlags);
  }

  const items = diagnosisRows.flatMap((row, index): ReferralOasisDisplayItem[] => {
    const value = compactDisplayText(getDiagnosisSideValue(row, side));
    const code = diagnosisCodeFromValue(value);
    if (!code) {
      return [];
    }
    const description = cleanDiagnosisDescription(getDiagnosisSideSnippet(row, side), code) ??
      cleanDiagnosisDescription(value, code);
    const onsetDate = onsetValues[index] ?? onsetValues[0] ?? null;
    const changeReason = side === "oasis" ? findOasisChangeReason(row, oasisChangeFlags) : null;
    const roleLabel = getDiagnosisRoleLabel(row);
    return [{
      label: description ? `${code} - ${description}` : code,
      value: onsetDate ? `Onset: ${onsetDate}` : "Diagnosis",
      meta: roleLabel,
      changed: Boolean(changeReason),
      changeReason,
    }];
  });

  return dedupeReferralOasisItems(items);
}

function formatPrintedNoteCoverage(section: PrintedNoteSectionSummary): string {
  if (section.filledFieldCount > 0 && section.missingFieldCount > 0) {
    return `${section.filledFieldCount} captured, ${section.missingFieldCount} follow-up`;
  }
  if (section.filledFieldCount > 0) {
    return `${section.filledFieldCount} captured`;
  }
  if (section.missingFieldCount > 0) {
    return `${section.missingFieldCount} follow-up`;
  }
  return "Section captured";
}

function buildPrintedNoteSectionItems(
  sections: PrintedNoteSectionSummary[],
  groupKey: ReferralOasisGroupKey,
): ReferralOasisDisplayItem[] {
  const items = sections.flatMap((section) => {
    if (getPrintedNoteSectionReferralOasisGroup(section) !== groupKey) {
      return [];
    }

    const evidence = (section.evidence ?? [])
      .map((entry) => truncateDisplayText(entry))
      .filter((entry) => entry.length > 0)
      .slice(0, 2);
    const meta = `${section.label} | ${formatStatusLabel(section.status)}`;

    if (evidence.length > 0) {
      return evidence.map((entry) => ({
        label: "OASIS section evidence",
        value: entry,
        meta,
      }));
    }

    return [{
      label: "OASIS section evidence",
      value: formatPrintedNoteCoverage(section),
      meta,
    }];
  });

  return dedupeReferralOasisItems(items);
}

function buildReferralOasisCategoryModel(
  group: { key: ReferralOasisGroupKey; label: string },
  referralRows: FieldComparison[],
  oasisChangeFlags: OasisChangeFlagForDisplay[] = [],
  oasisRows: FieldComparison[] = referralRows,
): ReferralOasisCategoryModel {
  const structuredOasisItems = group.key === "diagnoses"
    ? buildDiagnosisDisplayItemsFromRows(oasisRows, "oasis", oasisChangeFlags)
    : buildDisplayItemsFromRows(oasisRows, "oasis", oasisChangeFlags);
  const referralItems = group.key === "diagnoses"
    ? buildDiagnosisDisplayItemsFromRows(referralRows, "referral")
    : buildDisplayItemsFromRows(referralRows, "referral");
  return {
    key: group.key,
    label: group.label,
    referralItems,
    oasisItems: structuredOasisItems,
  };
}

function isGenericClinicalCategoryText(value: string | null | undefined): boolean {
  const normalized = normalizeLabelForComparison(value ?? "");
  if (!normalized) {
    return false;
  }
  return new Set([
    "diagnosis",
    "diagnoses",
    "active diagnoses",
    "medication",
    "medications",
    "allergy",
    "allergies",
    "medication allergies",
    "medications allergies",
    "medications allergies injectable medication",
    "medications allergies injectables medication",
    "medications allergies injectable medications",
    "safety social support",
    "functional therapy",
    "body systems",
    "dates admin",
  ]).has(normalized);
}

function cleanClinicalItemMeta(value: string | null | undefined): string | null {
  const cleaned = (value ?? "")
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isGenericClinicalCategoryText(part))
    .join(" | ");
  return cleaned.length > 0 ? cleaned : null;
}

function CategorySourceCard({
  title,
  items,
  emptyText,
  sourceSelector,
}: {
  title: string;
  items: ReferralOasisDisplayItem[];
  emptyText: string;
  sourceSelector?: ReactNode;
}) {
  return (
    <section className="clinical-source-card compact">
      <div className="clinical-source-card-header">
        <div className="clinical-source-card-title">
          {sourceSelector ?? <h2>{title}</h2>}
        </div>
        <span className={`badge${items.length > 0 ? " success" : ""}`}>
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      {items.length > 0 ? (
        <div className="clinical-value-list">
          {items.map((item, index) => {
            const displayValue = isGenericClinicalCategoryText(item.value) ? null : item.value;
            const displayMeta = cleanClinicalItemMeta(item.meta);
            return (
              <div
                className={`clinical-value-row${item.changed ? " changed" : ""}`}
                key={`${item.label}-${item.value}-${index}`}
              >
                <span className="clinical-value-index">{index + 1}</span>
                <div className="clinical-value-body">
                  <strong>{item.label}</strong>
                  {displayValue ? <span className="clinical-value-text">{displayValue}</span> : null}
                  {displayMeta ? <span>{displayMeta}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="clinical-empty">{emptyText}</div>
      )}
    </section>
  );
}

function CategoryComparisonCards({
  model,
  referralTitle = "Referral",
  oasisTitle = "OASIS",
  referralEmptyText = "No referral support captured",
  oasisEmptyText = "No OASIS data captured",
  referralSourceSelector,
  oasisSourceSelector,
}: {
  model: ReferralOasisCategoryModel;
  referralTitle?: string;
  oasisTitle?: string;
  referralEmptyText?: string;
  oasisEmptyText?: string;
  referralSourceSelector?: ReactNode;
  oasisSourceSelector?: ReactNode;
}) {
  return (
    <div className="clinical-comparison-grid" aria-label={`${model.label} referral versus OASIS`}>
      <CategorySourceCard
        emptyText={referralEmptyText}
        items={model.referralItems}
        sourceSelector={referralSourceSelector}
        title={referralTitle}
      />
      <CategorySourceCard
        emptyText={oasisEmptyText}
        items={model.oasisItems}
        sourceSelector={oasisSourceSelector}
        title={oasisTitle}
      />
    </div>
  );
}

function rowMatchesSelectedReferralDocument(
  row: FieldComparison,
  selectedDocumentId: string | null,
  defaultDocumentId: string | null,
): boolean {
  if (!selectedDocumentId) {
    return true;
  }
  const rowDocumentIds = row.referralDocumentIds ?? [];
  if (rowDocumentIds.length > 0) {
    return rowDocumentIds.includes(selectedDocumentId);
  }
  return selectedDocumentId === defaultDocumentId;
}

function rowMatchesSelectedOasisAssessment(
  row: FieldComparison,
  selectedAssessmentId: string | null,
  defaultAssessmentId: string | null,
): boolean {
  if (!selectedAssessmentId) {
    return true;
  }
  if (row.oasisAssessmentId) {
    return row.oasisAssessmentId === selectedAssessmentId;
  }
  return selectedAssessmentId === defaultAssessmentId;
}

function ReferralVsOasisTab({
  onReferralIntakeStart,
  patient,
  referralIntakeRunning,
  workspace,
}: {
  onReferralIntakeStart: () => void;
  patient: PatientDetail;
  referralIntakeRunning: boolean;
  workspace: ComparisonWorkspaceModel;
}) {
  const referralSources = patient.dashboardState.referralOasisSources?.referralDocuments ?? [];
  const oasisSources = patient.dashboardState.referralOasisSources?.oasisAssessments ?? [];
  const defaultReferralDocumentId =
    patient.dashboardState.referralOasisSources?.defaultReferralDocumentId ?? referralSources[0]?.id ?? null;
  const defaultOasisAssessmentId =
    patient.dashboardState.referralOasisSources?.defaultOasisAssessmentId ?? oasisSources[0]?.id ?? null;
  const [selectedReferralDocumentId, setSelectedReferralDocumentId] = useState<string | null>(
    defaultReferralDocumentId,
  );
  const [selectedOasisAssessmentId, setSelectedOasisAssessmentId] = useState<string | null>(
    defaultOasisAssessmentId,
  );
  const selectedReferralDocument =
    referralSources.find((source) => source.id === selectedReferralDocumentId) ?? referralSources[0] ?? null;
  const selectedOasisAssessment =
    oasisSources.find((source) => source.id === selectedOasisAssessmentId) ?? oasisSources[0] ?? null;
  const selectedReferralHasAnyRows = workspace.comparisons.some((row) =>
    rowMatchesSelectedReferralDocument(row, selectedReferralDocument?.id ?? null, defaultReferralDocumentId) &&
    hasReferralBackedComparisonValue(row)
  );
  const selectedOasisHasAnyRows = workspace.comparisons.some((row) =>
    rowMatchesSelectedOasisAssessment(row, selectedOasisAssessment?.id ?? null, defaultOasisAssessmentId) &&
    hasUsableOasisValue(row)
  );
  const referralRowsByGroup = REFERRAL_OASIS_GROUPS.reduce((map, group) => {
    map.set(group.key, [] as FieldComparison[]);
    return map;
  }, new Map<ReferralOasisGroupKey, FieldComparison[]>());
  const oasisRowsByGroup = REFERRAL_OASIS_GROUPS.reduce((map, group) => {
    map.set(group.key, [] as FieldComparison[]);
    return map;
  }, new Map<ReferralOasisGroupKey, FieldComparison[]>());
  for (const row of workspace.comparisons) {
    const groupKey = getReferralOasisGroup(row);
    if (!groupKey) {
      continue;
    }
    if (rowMatchesSelectedReferralDocument(row, selectedReferralDocument?.id ?? null, defaultReferralDocumentId)) {
      referralRowsByGroup.get(groupKey)?.push(row);
    }
    if (rowMatchesSelectedOasisAssessment(row, selectedOasisAssessment?.id ?? null, defaultOasisAssessmentId)) {
      oasisRowsByGroup.get(groupKey)?.push(row);
    }
  }
  const oasisChangeFlags = patient.dashboardState.referralOasisSources?.oasisChangeFlags ?? [];
  const selectedReferralSourceHasSummary = Boolean(
    selectedReferralDocument?.diagnosisSummary || selectedReferralDocument?.medicationSummary,
  );
  const selectedOasisSourceHasSummary = Boolean(
    selectedOasisAssessment?.diagnosisSummary || selectedOasisAssessment?.medicationSummary,
  );
  const selectedReferralSummary = selectedReferralDocument
    ? selectedReferralSourceHasSummary
      ? {
          diagnosisSummary: selectedReferralDocument.diagnosisSummary ?? null,
          medicationSummary: selectedReferralDocument.medicationSummary ?? null,
        }
      : selectedReferralDocument.id === defaultReferralDocumentId
        ? {
            diagnosisSummary: patient.referralDiagnosisSummary,
            medicationSummary: patient.referralMedicationSummary,
          }
        : { diagnosisSummary: null, medicationSummary: null }
    : {
        diagnosisSummary: patient.referralDiagnosisSummary,
        medicationSummary: patient.referralMedicationSummary,
      };
  const selectedOasisSummary = selectedOasisAssessment
    ? selectedOasisSourceHasSummary
      ? {
          diagnosisSummary: selectedOasisAssessment.diagnosisSummary ?? null,
          medicationSummary: selectedOasisAssessment.medicationSummary ?? null,
        }
      : selectedOasisAssessment.id === defaultOasisAssessmentId
        ? {
            diagnosisSummary: patient.oasisDiagnosisSummary,
            medicationSummary: patient.oasisMedicationSummary,
          }
        : { diagnosisSummary: null, medicationSummary: null }
    : {
        diagnosisSummary: patient.oasisDiagnosisSummary,
        medicationSummary: patient.oasisMedicationSummary,
      };
  const categoryModels = new Map(
    REFERRAL_OASIS_GROUPS.map((group) => [
      group.key,
      buildSourceAwareReferralOasisCategoryModel({
        group,
        referralRows: referralRowsByGroup.get(group.key) ?? [],
        oasisRows: oasisRowsByGroup.get(group.key) ?? [],
        referralSummary: selectedReferralSummary,
        oasisSummary: selectedOasisSummary,
        oasisChangeFlags,
      }),
    ] as const),
  );
  const visibleGroups = REFERRAL_OASIS_GROUPS;
  const [activeGroup, setActiveGroup] = useState<ReferralOasisGroupKey>(() => visibleGroups[0]?.key ?? "diagnoses");
  const selectedGroup = visibleGroups.some((group) => group.key === activeGroup)
    ? activeGroup
    : visibleGroups[0]?.key ?? "diagnoses";
  const activeModel = categoryModels.get(selectedGroup) ?? {
    key: selectedGroup,
    label: visibleGroups.find((group) => group.key === selectedGroup)?.label ?? "Diagnoses",
    referralItems: [],
    oasisItems: [],
  };
  const selectedGroupLabel = visibleGroups.find((group) => group.key === selectedGroup)?.label ?? "Diagnoses";
  const selectedReferralDocumentDate = formatClinicalSourceDate(selectedReferralDocument?.date);
  const selectedOasisAssessmentDate = formatClinicalSourceDate(selectedOasisAssessment?.date);
  const referralTitle = selectedReferralDocument
    ? `${formatReferralDocumentTitle(selectedReferralDocument.title)}${selectedReferralDocumentDate ? ` (${selectedReferralDocumentDate})` : ""}`
    : "Referral";
  const oasisTitle = selectedOasisAssessment
    ? `${selectedOasisAssessment.title}${selectedOasisAssessmentDate ? ` (${selectedOasisAssessmentDate})` : ""}`
    : "OASIS";
  const referralSourceSelector = referralSources.length > 0 ? (
    <div className="clinical-source-selector">
      <h2>{referralTitle}</h2>
      <div aria-label="Referral source documents" className="clinical-source-tabs" role="tablist">
        {referralSources.map((source) => (
          <button
            aria-selected={selectedReferralDocument?.id === source.id}
            className={`clinical-source-tab${selectedReferralDocument?.id === source.id ? " active" : ""}`}
            key={source.id}
            onClick={() => setSelectedReferralDocumentId(source.id)}
            role="tab"
            title={formatReferralDocumentTitle(source.title)}
            type="button"
          >
            <span className="clinical-source-tab-title">{formatReferralDocumentTitle(source.title)}</span>
            {formatClinicalSourceDate(source.date) ? <span className="badge">{formatClinicalSourceDate(source.date)}</span> : null}
          </button>
        ))}
      </div>
    </div>
  ) : null;
  const oasisSourceSelector = oasisSources.length > 0 ? (
    <div className="clinical-source-selector">
      <h2>{oasisTitle}</h2>
      <div aria-label="OASIS assessment sources" className="clinical-source-tabs" role="tablist">
        {oasisSources.map((source) => (
          <button
            aria-selected={selectedOasisAssessment?.id === source.id}
            className={`clinical-source-tab${selectedOasisAssessment?.id === source.id ? " active" : ""}`}
            key={source.id}
            onClick={() => setSelectedOasisAssessmentId(source.id)}
            role="tab"
            type="button"
          >
            <span className="clinical-source-tab-title">{source.title}</span>
            {formatClinicalSourceDate(source.date) ? <span className="badge">{formatClinicalSourceDate(source.date)}</span> : null}
            {source.isCurrent ? <span className="badge success">Current</span> : null}
            {!source.isMonitored ? <span className="badge">View only</span> : null}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  useEffect(() => {
    if (selectedGroup !== activeGroup) {
      setActiveGroup(selectedGroup);
    }
  }, [activeGroup, selectedGroup]);

  useEffect(() => {
    if (!selectedReferralDocumentId || !referralSources.some((source) => source.id === selectedReferralDocumentId)) {
      setSelectedReferralDocumentId(defaultReferralDocumentId);
    }
  }, [defaultReferralDocumentId, referralSources, selectedReferralDocumentId]);

  useEffect(() => {
    if (!selectedOasisAssessmentId || !oasisSources.some((source) => source.id === selectedOasisAssessmentId)) {
      setSelectedOasisAssessmentId(defaultOasisAssessmentId);
    }
  }, [defaultOasisAssessmentId, oasisSources, selectedOasisAssessmentId]);

  return (
    <div className="workspace-section-stack">
      <div aria-label="Referral versus OASIS comparison groups" className="referral-oasis-category-nav" role="tablist">
        {visibleGroups.map((group) => {
          const model = categoryModels.get(group.key);
          const displayCount = (model?.referralItems.length ?? 0) + (model?.oasisItems.length ?? 0);
          return (
            <button
              aria-selected={selectedGroup === group.key}
              className={`referral-oasis-category-tab${selectedGroup === group.key ? " active" : ""}`}
              key={group.key}
              onClick={() => setActiveGroup(group.key)}
              role="tab"
              type="button"
            >
              <span>{group.label}</span>
              <span className="badge">{displayCount}</span>
            </button>
          );
        })}
      </div>

      <section className="panel stack">
        <div className="panel-header-inline referral-oasis-section-header">
          <h2>{selectedGroupLabel}</h2>
          <button
            aria-label="Check referral files for this patient"
            className="button secondary compact"
            disabled={referralIntakeRunning}
            onClick={onReferralIntakeStart}
            type="button"
          >
            {referralIntakeRunning ? "Checking..." : "Check Referral Files"}
          </button>
        </div>

        <CategoryComparisonCards
          model={activeModel}
          oasisTitle={oasisTitle}
          oasisEmptyText={
            selectedOasisAssessment && !selectedOasisHasAnyRows
              ? "OASIS assessment is viewable, but extracted rows are not available yet"
              : "No OASIS data captured"
          }
          oasisSourceSelector={oasisSourceSelector ?? undefined}
          referralEmptyText={
            selectedReferralDocument && !selectedReferralHasAnyRows
              ? "Referral document is viewable, but extracted rows are not available yet"
              : "No referral support captured"
          }
          referralSourceSelector={referralSourceSelector ?? undefined}
          referralTitle={referralTitle}
        />
      </section>
    </div>
  );
}

function isIcdCodeValue(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/i.test(value.trim());
}

function isActiveDiagnosisDescriptionRow(row: FieldComparison): boolean {
  const label = normalizeLabelForComparison(row.fieldLabel);
  const value = row.displayPortalValue.trim();
  return row.sectionKey.startsWith("active_diagnoses") &&
    hasVisiblePortalValue(value) &&
    !isIcdCodeValue(value) &&
    value.length > 0 &&
    !label.includes("onset date") &&
    !label.includes("icd 10 code");
}

function buildActiveDiagnosisDisplayRows(rows: FieldComparison[]): FieldComparison[] {
  const codeRows = rows.filter((row) => isIcdCodeValue(row.displayPortalValue));
  const descriptions = rows
    .filter(isActiveDiagnosisDescriptionRow)
    .map((row) => row.displayPortalValue.trim());

  if (codeRows.length === 0 || descriptions.length === 0) {
    return rows;
  }

  const codeDisplayByFieldKey = new Map<string, string>();
  codeRows.forEach((row, index) => {
    const code = row.displayPortalValue.trim();
    const description = descriptions[index];
    if (description) {
      codeDisplayByFieldKey.set(row.fieldKey, `${code} - ${description}`);
    }
  });

  return rows
    .filter((row) => !isActiveDiagnosisDescriptionRow(row))
    .map((row) => {
      const displayPortalValue = codeDisplayByFieldKey.get(row.fieldKey);
      return displayPortalValue
        ? {
            ...row,
            displayPortalValue,
            comparisonDisplayValue: [row.displayReferralValue, displayPortalValue].join(" | "),
          }
        : row;
    });
}

function buildOasisSnapshotSections(workspace: ComparisonWorkspaceModel): Array<ComparisonSectionSummary & { rows: FieldComparison[] }> {
  return workspace.sections
    .map((section) => {
      const rows = section.rows.filter((row) => hasUsableOasisValue(row));
      return {
        ...section,
        rows: section.sectionKey.startsWith("active_diagnoses") ? buildActiveDiagnosisDisplayRows(rows) : rows,
      };
    })
    .filter((section) => section.rows.length > 0);
}

function OasisSnapshotPanel({
  patient,
  workspace,
}: {
  patient: PatientDetail;
  workspace: ComparisonWorkspaceModel;
}) {
  const sectionEntries = buildOasisSnapshotSections(workspace);
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
            This is the readable OASIS view for QA. Referral comparison is limited to the diagnosis panel above.
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
                        <span className="badge success">Captured</span>
                      </div>
                      <div className="field-debug-meta">
                        <div className="comparison-value-label">OASIS says</div>
                        <div className="comparison-value-text">{row.displayPortalValue}</div>
                      </div>
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

function OasisInternalChecksPanel({ patient }: { patient: PatientDetail }) {
  const missingFields = patient.oasisValidation?.missingFields.slice(0, 12) ?? [];
  const internalReasons = patient.oasisGate?.topReasons.slice(0, 8) ?? [];
  const daysLeft = patient.daysLeftBeforeOasisDueDate;
  const aiAssistEligible = typeof daysLeft === "number" && daysLeft <= 15;

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Internal OASIS Checks</h2>
        </div>
        <div className="badge-row">
          {patient.oasisValidation ? (
            <span className={patient.oasisValidation.missingFieldCount > 0 ? "badge warning" : "badge success"}>
              {patient.oasisValidation.missingFieldCount} missing field{patient.oasisValidation.missingFieldCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {patient.oasisGate ? (
            <span className={patient.oasisGate.contradictionCount > 0 ? "badge danger" : "badge success"}>
              {patient.oasisGate.contradictionCount} contradiction{patient.oasisGate.contradictionCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {aiAssistEligible ? <span className="badge warning">AI assist window</span> : null}
        </div>
      </div>

      {aiAssistEligible ? (
        <section className="panel global-trust-banner">
          <span className="badge warning">Day 15+</span>
          <div>
            OASIS is inside the assist window. Missing input suggestions should be generated for reviewer approval only; referral evidence remains limited to diagnosis comparison.
          </div>
        </section>
      ) : null}

      {missingFields.length > 0 ? (
        <div className="section-field-list">
          {missingFields.map((field) => (
            <article className="flagged-field-row" key={`${field.fieldId ?? field.label}-${field.mItem ?? ""}`}>
              <div className="flagged-field-header">
                <div>
                  <strong>{field.label}</strong>
                  <div className="flagged-field-rationale">
                    {[field.mItem, field.section].filter(Boolean).join(" | ") || "Required OASIS field"}
                  </div>
                </div>
                <span className="badge warning">Missing</span>
              </div>
              <div className="muted">{field.message ?? "Enter the clinically appropriate OASIS value."}</div>
            </article>
          ))}
        </div>
      ) : null}

      {internalReasons.length > 0 ? (
        <div className="checklist compact-checklist">
          {internalReasons.map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </div>
      ) : null}

    </section>
  );
}

function ReferralDocumentsTab({
  patient,
  diagnosisRows,
  medicationRows,
}: {
  patient: PatientDetail;
  diagnosisRows: FieldComparison[];
  medicationRows: FieldComparison[];
}) {
  const daysLeft = patient.daysLeftBeforeOasisDueDate;
  const suggestionsEligible =
    !patient.oasisValidatedForPlanOfCare &&
    typeof daysLeft === "number" &&
    daysLeft <= 15 &&
    patient.referralQa.referralDataAvailable;
  const referralComparisonRows = [...diagnosisRows, ...medicationRows];

  return (
    <div className="workspace-section-stack">
      <ReferralCompletionSuggestionsPanel
        suggestionsEligible={suggestionsEligible}
        rows={referralComparisonRows}
      />
    </div>
  );
}

function cleanPlanOfCareDisplayText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\(s\)\s*/gi, "")
    .replace(/\b(?:Add Goal|Delete Problem|Add Intervention|Delete Intervention|Add Progress)\b/gi, "")
    .replace(/\bTarget:\s*\d+\s*Week\(s\)/gi, "")
    .replace(/\bTerm:\s*(?:Short|Long)-term/gi, "")
    .replace(/\bStatus:\s*(?:Unmet|Met)/gi, "")
    .replace(/\bUnmet on:\s*(?:No Data|[\d/-]+)/gi, "")
    .replace(/\bOnset:\s*\d{1,2}\/\d{1,2}\/\d{4}\b/gi, "")
    .replace(/\bSource:\s*\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}\b/gi, "")
    .replace(/\bSource:\s*\d{1,2}\/\d{1,2}\/\d{4}\b/gi, "")
    .replace(/\bNo Data\b/gi, "")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isPortalMetadataOnlyPocRow(title: string, problemText: string): boolean {
  const cleanTitle = cleanPlanOfCareDisplayText(title);
  const rawTitle = title.trim();
  const rawProblem = problemText.trim();

  return (
    /^Onset:/i.test(rawTitle) ||
    /^Source:/i.test(rawTitle) ||
    cleanTitle.length === 0 ||
    /^Onset:/i.test(rawProblem) ||
    /^Source:/i.test(rawProblem)
  );
}

function PlanOfCareGenerationTab({ patient }: { patient: PatientDetail }) {
  const validationStatus = patient.oasisValidation?.status ?? "dom_qa_complete";
  const oasisValidated = patient.oasisValidatedForPlanOfCare;
  const review = patient.planOfCareReview;
  const carePlanGroups = (review.carePlanProblemGroups ?? []).slice(0, 20);
  const draftItems = review.draftItems.slice(0, 10);
  const rows = (carePlanGroups.length > 0
    ? carePlanGroups.map((group) => ({
        key: group.groupKey,
        title: cleanPlanOfCareDisplayText(group.problemTitle),
        problemText: cleanPlanOfCareDisplayText(group.problemStatement),
        goals: group.goals.map((goal) => cleanPlanOfCareDisplayText(goal.text)).filter(Boolean),
        interventions: Array.from(new Set(group.interventions
          .map((intervention) => cleanPlanOfCareDisplayText(intervention.text))
          .filter(Boolean))),
        sourceLabel: group.sourceLabel ?? review.sourceLabel ?? "From OASIS",
        needsHumanReview: group.needsHumanReview,
        warnings: [] as string[],
      }))
    : draftItems.map((item) => ({
        key: item.diagnosisKey,
        title: cleanPlanOfCareDisplayText(item.icdCode ? `${item.diagnosisLabel} (${item.icdCode})` : item.diagnosisLabel),
        problemText: cleanPlanOfCareDisplayText(item.problemText),
        goals: item.goalText ? [cleanPlanOfCareDisplayText(item.goalText)].filter(Boolean) : [],
        interventions: item.interventions
          .map((intervention) => cleanPlanOfCareDisplayText(intervention.tailoredInstruction || intervention.text))
          .filter(Boolean),
        sourceLabel: item.sourceLabel ?? review.sourceLabel ?? "Suggested",
        needsHumanReview: item.needsHumanReview,
        warnings: [] as string[],
      }))).filter((row) =>
        row.title &&
        !isPortalMetadataOnlyPocRow(row.title, row.problemText) &&
        (row.problemText || row.goals.length > 0 || row.interventions.length > 0)
      );

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Plan of Care</h2>
        </div>
        <div className="badge-row">
          <span className={oasisValidated ? "badge success" : "badge warning"}>
            {oasisValidated ? "OASIS validated" : `OASIS ${formatStatusLabel(validationStatus)}`}
          </span>
          {review.sourceLabel ? (
            <span className={review.sourceLabel === "From OASIS" ? "badge success" : "badge warning"}>
              {review.sourceLabel}
            </span>
          ) : null}
          <span className={review.available ? "badge success" : "badge"}>
            {formatStatusLabel(review.status)}
          </span>
        </div>
      </div>

      {!oasisValidated && review.sourceType !== "oasis_portal" ? (
        <section className="panel global-trust-banner">
          <span className="badge warning">Waiting</span>
          <div>Plan of Care generation should remain gated until OASIS validation has passed.</div>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <div className="section-field-list">
          {rows.map((row, index) => (
            <details className="flagged-field-row" key={row.key} open={index === 0}>
              <summary className="flagged-field-header">
                <div>
                  <strong>{row.title}</strong>
                </div>
              </summary>
              <div className="comparison-value-grid">
                <div className="field-debug-meta">
                  <div className="comparison-value-label">Problem</div>
                  <div className="comparison-value-text">
                    {row.problemText || "No problem captured"}
                  </div>
                </div>
                <div className="field-debug-meta">
                  <div className="comparison-value-label">Goal</div>
                  <div className="comparison-value-text">
                    {row.goals[0] ?? "No goal captured"}
                  </div>
                </div>
              </div>
              {row.interventions.length > 0 ? (
                <div className="field-debug-meta">
                  <div className="comparison-value-label">
                    Intervention{row.interventions.length === 1 ? "" : "s"}
                  </div>
                  <ul className="poc-intervention-list">
                    {row.interventions.map((intervention, interventionIndex) => (
                      <li className="comparison-value-text" key={`${row.key}-intervention-${interventionIndex}`}>
                        {intervention}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          ))}
        </div>
      ) : (
        <div className="muted">No Plan of Care draft items are available yet.</div>
      )}
    </section>
  );
}

type VisitNoteSummary = PatientDetail["visitNotesReview"]["noteSummaries"][number];

function sortVisitNoteSummaries(left: VisitNoteSummary, right: VisitNoteSummary): number {
  const leftActive = left.lifecycleStatus === "active_monitoring" ? 0 : 1;
  const rightActive = right.lifecycleStatus === "active_monitoring" ? 0 : 1;
  if (leftActive !== rightActive) {
    return leftActive - rightActive;
  }

  const leftFailed = left.captureStatus === "failed" || left.analysisStatus === "failed" ? 0 : 1;
  const rightFailed = right.captureStatus === "failed" || right.analysisStatus === "failed" ? 0 : 1;
  if (leftFailed !== rightFailed) {
    return leftFailed - rightFailed;
  }

  return (right.visitDate ?? "").localeCompare(left.visitDate ?? "");
}

function formatVisitNotePocTargets(mapping: VisitNoteSummary["pocMappingResult"]): string {
  const titles = Array.from(new Set((mapping?.matchedPocItems ?? [])
    .map((item) => item.problemTitle)
    .filter((title): title is string => Boolean(title && title.trim()))));
  return titles.slice(0, 3).join(", ");
}

function formatVisitNoteDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoDate) {
    return `${isoDate[2]}/${isoDate[3]}/${isoDate[1]}`;
  }

  return trimmed;
}

function formatVisitNoteSuggestionLocation(
  suggestion: VisitNoteSummary["textInputSuggestions"][number],
): string {
  const sectionLabel = suggestion.sectionLabel?.trim();
  if (!sectionLabel || sectionLabel.length > 80 || /\bVisit Date:|Uploaded Note|Staff:|YOUNG,/i.test(sectionLabel)) {
    return suggestion.fieldLabel;
  }
  return `${sectionLabel} - ${suggestion.fieldLabel}`;
}

function formatVisitNoteMissingFields(values: string[] | undefined): string {
  const labels = Array.from(new Set((values ?? [])
    .map((value) => value.replace(/\s+(?:is blank|needs more detail)\.?$/i, "").trim())
    .filter(Boolean)));
  if (labels.length === 0) {
    return "";
  }
  return `Missing or weak fields: ${labels.slice(0, 4).join(", ")}.`;
}

function getVisitNoteCompletionBadge(summary: VisitNoteSummary): { label: string; className: string } | null {
  if (summary.completionStatus === "capture_needed") {
    return { label: "Capture needed", className: "badge danger" };
  }
  if (summary.completionStatus === "incomplete" || summary.missingFields.length > 0) {
    return { label: "Incomplete", className: "badge warning" };
  }
  return null;
}

function getVisitNoteProblemAndFix(summary: VisitNoteSummary): { problem: string; fix: string } {
  const mapping = summary.pocMappingResult;
  const relatedPoc = formatVisitNotePocTargets(mapping);
  const relatedText = relatedPoc ? ` for ${relatedPoc}` : "";
  const missingFields = formatVisitNoteMissingFields(
    summary.missingFields.length > 0 ? summary.missingFields : mapping?.missingDocumentation,
  );

  if (summary.completionStatus === "capture_needed" || summary.captureStatus === "failed" || summary.analysisStatus === "failed") {
    return {
      problem: "Visit Note DOM capture did not complete.",
      fix: "Reopen the note and rerun DOM capture so it can be checked against the Plan of Care.",
    };
  }

  if (summary.analyzed && mapping?.alignmentStatus === "contradiction") {
    return {
      problem: `Discrepancy with Plan of Care${relatedText}.`,
      fix: mapping.contradictions?.length
        ? mapping.contradictions.slice(0, 3).join(" ")
        : "Review the conflicting Visit Note and Plan of Care statements.",
    };
  }

  if (summary.analyzed && mapping?.alignmentStatus === "not_aligned") {
    return {
      problem: "No related Plan of Care diagnosis was identified from the Visit Note.",
      fix: "Review the diagnosis, visit narrative, and treatment text before sign-off.",
    };
  }

  if (summary.analyzed && mapping?.alignmentStatus === "partially_aligned") {
    return {
      problem: `Visit Note is related${relatedText}, but incomplete items remain.`,
      fix: missingFields || "Review only the unmatched or unclear Visit Note text against the Plan of Care.",
    };
  }

  if (summary.completionStatus === "incomplete") {
    return {
      problem: `Visit Note is incomplete${relatedText}.`,
      fix: missingFields || "Complete the missing or weak Visit Note text fields before QA sign-off.",
    };
  }

  if (summary.analyzed && mapping?.alignmentStatus === "insufficient_documentation") {
    return {
      problem: relatedPoc
        ? `Incomplete Visit Note${relatedText}.`
        : "Visit Note does not identify a related Plan of Care diagnosis.",
      fix: missingFields || "Complete the diagnosis, narrative, or plan fields needed for QA sign-off.",
    };
  }

  if (summary.analyzed && mapping?.alignmentStatus === "needs_review") {
    return {
      problem: relatedPoc
        ? `Review Visit Note relationship${relatedText}.`
        : "Visit Note needs QA review before sign-off.",
      fix: missingFields || "Confirm the related diagnosis and resolve any direct POC discrepancy.",
    };
  }

  if (summary.analyzed && mapping?.alignmentStatus === "aligned") {
    return {
      problem: relatedPoc
        ? `Related diagnosis: ${relatedPoc}.`
        : "Visit Note has no detected Plan of Care discrepancy.",
      fix: "No discrepancy found.",
    };
  }

  if (summary.lifecycleStatus === "active_monitoring") {
    return {
      problem: "Active Visit Note still needs DOM capture and POC alignment review.",
      fix: "Capture the note through DOM and compare it with the Plan of Care interventions.",
    };
  }

  if (summary.status === "not_started") {
    return {
      problem: "Visit Note has not started.",
      fix: "No action until the note is started.",
    };
  }

  return {
    problem: "Visit Note is outside the active review queue.",
    fix: "No action unless QA reopens it for review.",
  };
}

function VisitNotesTab({ patient }: { patient: PatientDetail }) {
  const review = patient.visitNotesReview;
  const summaries = [...review.noteSummaries].sort(sortVisitNoteSummaries);
  const reviewSummaries = summaries.filter((summary) =>
    summary.lifecycleStatus === "active_monitoring" || summary.lifecycleStatus === "finalized_no_active_monitoring"
  );
  const visibleSummaries = reviewSummaries.length > 0 ? reviewSummaries : summaries.slice(0, 8);
  const attentionCount = visibleSummaries.filter((summary) =>
    summary.captureStatus === "failed" ||
    summary.analysisStatus === "failed" ||
    summary.completionStatus === "capture_needed" ||
    summary.completionStatus === "incomplete" ||
    ["contradiction", "not_aligned", "insufficient_documentation", "partially_aligned", "needs_review"].includes(summary.pocMappingResult?.alignmentStatus ?? "")
  ).length;

  return (
    <section className="panel stack">
      <div className="panel-header-inline">
        <div>
          <h2>Visit Notes</h2>
        </div>
        <div className="badge-row">
          <span className={review.available ? "badge success" : "badge warning"}>
            {formatStatusLabel(review.status)}
          </span>
          <span className={attentionCount > 0 ? "badge warning" : "badge success"}>
            {attentionCount} need attention
          </span>
        </div>
      </div>

      {review.visitTypeCounts.length > 0 ? (
        <div className="visit-note-type-table" aria-label="Visit note status breakdown">
          <div className="visit-note-type-row visit-note-type-header">
            <span>Visit Type</span>
            <span>Count</span>
            <span>Status Breakdown</span>
          </div>
          {review.visitTypeCounts.map((entry) => (
            <div className="visit-note-type-row" key={entry.visitType}>
              <span>{formatStatusLabel(entry.visitType)}</span>
              <strong>{entry.count}</strong>
              <span>
                {Object.entries(entry.statuses)
                  .map(([status, count]) => `${formatStatusLabel(status)} ${count}`)
                  .join(" | ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {visibleSummaries.length > 0 ? (
        <div className="section-field-list">
          {visibleSummaries.map((summary) => {
            const triage = getVisitNoteProblemAndFix(summary);
            const visitDate = formatVisitNoteDate(summary.visitDate);
            const completionBadge = getVisitNoteCompletionBadge(summary);
            const missingFields = formatVisitNoteMissingFields(summary.missingFields);
            return (
              <details className="flagged-field-row visit-note-detail-card" key={summary.visitNoteKey}>
                <summary className="flagged-field-header">
                  <div>
                    <strong>{formatStatusLabel(summary.visitType)}</strong>
                    {visitDate ? <div className="muted">Visit date: {visitDate}</div> : null}
                  </div>
                  <div className="badge-row">
                    {summary.lifecycleStatus === "active_monitoring" ? (
                      <span className="badge danger">New QA</span>
                    ) : null}
                    {completionBadge ? (
                      <span className={completionBadge.className}>{completionBadge.label}</span>
                    ) : null}
                  </div>
                </summary>
                <div className="visit-note-detail-body">
                  <div className="field-debug-meta">
                    <div className="comparison-value-label">Problem</div>
                    <div className="comparison-value-text">{triage.problem}</div>
                  </div>
                  {missingFields || summary.completionReasons.length > 0 ? (
                    <div className="field-debug-meta">
                      <div className="comparison-value-label">Completion</div>
                      <div className="comparison-value-text">
                        {missingFields || summary.completionReasons.slice(0, 3).join(" ")}
                      </div>
                    </div>
                  ) : null}
                  {summary.textInputSuggestions.length > 0 ? (
                    <div className="field-debug-meta visit-note-suggestion-list">
                      <div className="comparison-value-label">Suggested Text Input</div>
                      <div className="poc-intervention-list">
                        {summary.textInputSuggestions.map((suggestion) => (
                          <div className="comparison-value-text" key={suggestion.suggestionId}>
                            <strong>{formatVisitNoteSuggestionLocation(suggestion)}</strong>
                            {suggestion.currentValue ? (
                              <div className="muted">Current: {suggestion.currentValue}</div>
                            ) : null}
                            <div>{suggestion.suggestedInput}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <div className="muted">No Visit Note review is available yet.</div>
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
        <h1 className="page-title">{workspace.header.patientName}</h1>
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
  presentation = "full",
}: {
  comparison: FieldComparison;
  onInspect?: (fieldKey: string) => void;
  isSelected?: boolean;
  presentation?: "full" | "clinical";
}) {
  const showDiagnosticDetails = presentation === "full";
  const showSourceSnippet = showDiagnosticDetails && comparison.evidence.length > 0;
  return (
    <article className={`comparison-row${isSelected ? " selected" : ""}${presentation === "clinical" ? " clinical" : ""}`}>
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
        </div>

        {showDiagnosticDetails ? (
          <div className="comparison-status-block">
            <span className={getResultBadgeClass(comparison.comparisonResult)}>{getResultLabel(comparison.comparisonResult)}</span>
            {shouldShowReviewStatus(comparison) ? <span className="badge">{comparison.reviewStatus}</span> : null}
            <span className="badge">{getConfidenceLabel(comparison.confidence)}</span>
            {comparison.isFormattingOnlyDifference ? <span className="badge success">Formatting only</span> : null}
            {comparison.isFieldLeakSuspected ? <span className="badge warning">Possible field leak</span> : null}
          </div>
        ) : null}
      </div>

      {showDiagnosticDetails || showSourceSnippet || onInspect ? (
        <div className="comparison-row-footer">
          {showDiagnosticDetails ? <div className="comparison-row-reason">{comparison.shortReason}</div> : null}
        <div className="comparison-row-actions">
          {showDiagnosticDetails ? (
            <>
              <span className="badge">{getSourceSupportLabel(comparison.sourceSupportStrength)}</span>
              <span className="badge">{getMappingStrengthLabel(comparison.mappingStrength)}</span>
              {comparison.visibilityDecision && comparison.visibilityDecision !== "show" ? (
                <span className="badge">{formatStatusLabel(comparison.visibilityDecision)}</span>
              ) : null}
            </>
          ) : null}
          {showSourceSnippet ? <DocumentSnippetPopover comparison={comparison} /> : null}
          {onInspect ? (
            <button className="button secondary compact" onClick={() => onInspect(comparison.fieldKey)} type="button">
              Inspect
            </button>
          ) : null}
        </div>
        </div>
      ) : null}
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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("referral_vs_oasis");
  const [isStartingReferralIntake, setIsStartingReferralIntake] = useState(false);
  const autoSelectedPatientRef = useRef<string | null>(null);

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

    const loadedPatientKey = `${patient.batchId}:${patient.workItemId}`;
    if (autoSelectedPatientRef.current === loadedPatientKey) {
      return;
    }
    autoSelectedPatientRef.current = loadedPatientKey;

    setActiveTab("referral_vs_oasis");
  }, [patient]);

  const workspace = patient ? buildComparisonWorkspaceModel(patient) : null;
  const diagnosisRows = workspace
    ? workspace.comparisons.filter((row) => row.sectionKey.startsWith("active_diagnoses"))
    : [];
  const medicationRows = workspace
    ? workspace.comparisons.filter((row) => row.sectionKey.startsWith("medication_allergies"))
    : [];
  const planOfCareCount = patient
    ? patient.planOfCareReview.draftItems.length + (patient.planOfCareReview.carePlanProblemGroups ?? []).length
    : 0;
  const visitNoteCount = patient?.visitNotesReview.noteSummaries.length
    ?? patient?.visitNotesReview.visitTypeCounts.reduce((total, entry) => total + entry.count, 0)
    ?? 0;
  const tabs: Array<{ key: WorkspaceTab; label: string; count?: number }> = workspace
    ? [
        { key: "referral_vs_oasis", label: "Referral vs OASIS" },
        { key: "referral_documents", label: "Referral Documents" },
        {
          key: "oasis",
          label: "OASIS",
          count: (patient?.oasisValidation?.missingFieldCount ?? 0) + (patient?.oasisGate?.contradictionCount ?? 0),
        },
        { key: "plan_of_care", label: "Plan of Care", count: planOfCareCount },
        { key: "visit_notes", label: "Visit Notes", count: visitNoteCount },
      ]
    : [];
  const referralIntakeStatus = patient?.dashboardState.referralIntakeStatus;
  const referralIntakeRunning =
    referralIntakeStatus?.status === "pending" ||
    referralIntakeStatus?.status === "running" ||
    isStartingReferralIntake;

  async function handleReferralIntakeStart(): Promise<void> {
    setIsStartingReferralIntake(true);
    try {
      await startPatientReferralIntake(runId, patientId);
    } catch (nextError) {
      console.error(nextError);
      setError(nextError instanceof Error ? nextError.message : "Failed to start referral file check.");
    } finally {
      setIsStartingReferralIntake(false);
    }
  }

  return (
    <main className="page-shell patient-page-shell patient-dashboard stack">
      <div className="page-header">
        <div>
          <Link className="link" href="/agency">Back to agency overview</Link>
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

          {activeTab === "referral_vs_oasis" ? (
            <ReferralVsOasisTab
              onReferralIntakeStart={() => void handleReferralIntakeStart()}
              patient={patient}
              referralIntakeRunning={referralIntakeRunning}
              workspace={workspace}
            />
          ) : null}

          {activeTab === "referral_documents" ? (
            <ReferralDocumentsTab
              diagnosisRows={diagnosisRows}
              medicationRows={medicationRows}
              patient={patient}
            />
          ) : null}

          {activeTab === "oasis" ? <OasisInternalChecksPanel patient={patient} /> : null}
          {activeTab === "plan_of_care" ? <PlanOfCareGenerationTab patient={patient} /> : null}
          {activeTab === "visit_notes" ? <VisitNotesTab patient={patient} /> : null}
        </>
      ) : null}
    </main>
  );
}
