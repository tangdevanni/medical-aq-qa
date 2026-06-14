import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  OasisDomAcquisitionField,
  OasisDomAcquisitionSection,
  OasisDomAcquisitionState,
  OasisDomAcquisitionStatus,
  OasisDomReadinessReason,
  PortalDomExtractedField,
  PortalDomExtractedSection,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";

export const OASIS_DOM_ACQUISITION_STATE_FILE_NAME = "oasis-dom-acquisition-state.json";

export type OasisDomAcquisitionMergeOptions = {
  patientRunId?: string;
  patientId?: string;
  oasisDocumentId?: string;
  sourceKey?: string;
  scrapedAt?: string;
  previousQaInputHash?: string | null;
  ocrFallbackEnabled?: boolean;
  minFieldCount?: number;
  minNonEmptyFieldCount?: number;
};

export type OasisDomAcquisitionReadiness = {
  status: OasisDomAcquisitionStatus;
  readinessReasons: OasisDomReadinessReason[];
  missingRequiredSections: string[];
  missingRequiredFields: string[];
  fallbackReasons: string[];
};

const DEFAULT_MIN_FIELD_COUNT = 100;
const DEFAULT_MIN_NON_EMPTY_FIELD_COUNT = 25;

const REQUIRED_SECTION_PATTERNS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "administrative_information", label: "Administrative Information", pattern: /administrative/i },
  { key: "active_diagnoses", label: "Active Diagnoses", pattern: /active diagnoses|diagnosis/i },
  { key: "vital_signs_pain", label: "Vital Signs & Pain Assessment", pattern: /vital signs|pain assessment/i },
  { key: "medication_allergies", label: "Medication & Allergies", pattern: /medication|allerg|injectable/i },
  { key: "neurological", label: "Neurological", pattern: /neurological|head|mood|eyes|ears/i },
  { key: "cardiopulmonary", label: "Cardiopulmonary", pattern: /cardiopulmonary|chest|thorax/i },
  { key: "gastrointestinal_genitourinary", label: "Gastrointestinal & Genitourinary", pattern: /gastrointestinal|genitourinary/i },
  { key: "integumentary_wound", label: "Integumentary / Skin & Wound", pattern: /integumentary|skin|wound/i },
  { key: "safety_risk_self_care", label: "Safety & Risk Assessment / Self Care", pattern: /safety|risk assessment|self care/i },
  { key: "functional_mobility", label: "Functional Assessment / Mobility & Musculoskeletal", pattern: /functional|mobility|musculoskeletal/i },
  { key: "endocrine_diabetic", label: "Endocrine / Diabetic Management", pattern: /endocrine|diabetic/i },
  { key: "plan_of_care_pt_eval", label: "Plan of Care and Physical Therapy Evaluation", pattern: /plan of care|physical therapy/i },
  { key: "patient_summary_narrative", label: "Patient Summary & Clinical Narrative", pattern: /patient summary|clinical narrative|narrative/i },
];

const CLINICAL_CUE_PATTERNS = [
  /diagnosis|M1021|M1023/i,
  /medication|allerg|injectable/i,
  /neurological|mood|cognitive|BIMS|PHQ/i,
  /mobility|ambulat|transfer|walker|musculoskeletal/i,
  /wound|skin|integumentary/i,
  /summary|narrative|homebound|medical necessity/i,
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeKey(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["firstSeenAt", "lastSeenAt", "lastChangedAt", "lastScrapedAt", "lastCompletedAt"].includes(key))
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isCompletePrintPreviewDomState(input: {
  state: Omit<OasisDomAcquisitionState, "acquisitionStatus" | "readinessReasons" | "missingRequiredSections" | "missingRequiredFields" | "fallbackReasons" | "lastCompletedAt">;
  latestDomState?: PortalDomExtractedState;
  minFieldCount: number;
  minNonEmptyFieldCount: number;
}): boolean {
  if (input.latestDomState?.diagnostics.routePattern !== "print_preview_dom") {
    return false;
  }
  if (input.latestDomState.coverage.fallbackRecommended) {
    return false;
  }

  const totalFieldCount = input.state.sections.reduce((total, section) => total + section.fieldCount, 0);
  const totalNonEmptyFieldCount = input.state.sections.reduce((total, section) => total + section.nonEmptyFieldCount, 0);
  const capturedSectionCount = input.state.sections.filter((section) =>
    section.status === "captured" || section.status === "degraded"
  ).length;
  const itemCodeCount = new Set(input.state.sections.flatMap((section) =>
    section.fields.map((field) => field.oasisItemCode).filter(Boolean))).size;
  const digest = [
    input.latestDomState.textDigest,
    ...input.state.sections.map((section) => section.title),
    ...input.state.sections.flatMap((section) => section.fields.map((field) =>
      `${field.oasisItemCode ?? ""} ${field.label ?? ""} ${field.normalizedValue}`
    )),
  ].join("\n");

  const hasOasisStructure = /\bM\d{4}\b/i.test(digest) || /\bGG\d{4}[A-Z]?\b/i.test(digest);
  const hasClinicalCoverage =
    /administrative/i.test(digest) &&
    /vital signs|pain assessment/i.test(digest) &&
    /medication|allerg/i.test(digest) &&
    /plan of care|care plan|discharge summary/i.test(digest) &&
    /functional|mobility|self care|musculoskeletal/i.test(digest);

  return capturedSectionCount >= 6 &&
    totalFieldCount >= input.minFieldCount &&
    totalNonEmptyFieldCount >= input.minNonEmptyFieldCount &&
    itemCodeCount >= 8 &&
    hasOasisStructure &&
    hasClinicalCoverage;
}

function fieldValue(field: PortalDomExtractedField): string | number | boolean | string[] | undefined {
  if (field.selectedText !== undefined) {
    return field.selectedText;
  }
  if (field.value !== undefined) {
    return field.value;
  }
  if (field.selectedValue !== undefined) {
    return field.selectedValue;
  }
  if (field.checked !== undefined) {
    return field.checked;
  }
  return undefined;
}

function normalizeValue(value: string | number | boolean | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.map(normalizeWhitespace).filter(Boolean).join(" | ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return normalizeWhitespace(value);
}

function isFilled(value: string): boolean {
  return value.length > 0 && !/^(false|unchecked|n\/a|na)$/i.test(value);
}

function sectionKeyFor(sectionTitle: string): string {
  const match = REQUIRED_SECTION_PATTERNS.find((entry) => entry.pattern.test(sectionTitle));
  return match?.key ?? normalizeKey(sectionTitle);
}

function fieldKeyFor(sectionKey: string, field: PortalDomExtractedField, index: number): string {
  return [
    sectionKey,
    normalizeKey(field.itemCode ?? ""),
    normalizeKey(field.key ?? ""),
    normalizeKey(field.label ?? ""),
    field.sourceKind,
    index,
  ].filter((value) => value && value !== "unknown").join(":");
}

function buildField(input: {
  field: PortalDomExtractedField;
  sectionKey: string;
  index: number;
  now: string;
  previous?: OasisDomAcquisitionField;
  changedFields: string[];
  regressedFields: string[];
}): OasisDomAcquisitionField {
  const value = fieldValue(input.field);
  const normalizedValue = normalizeValue(value);
  const nextHash = sha256(stableJson({
    sectionKey: input.sectionKey,
    fieldKey: fieldKeyFor(input.sectionKey, input.field, input.index),
    itemCode: input.field.itemCode,
    label: input.field.label,
    value: normalizedValue,
    sourceKind: input.field.sourceKind,
  }));
  const previous = input.previous;
  const fieldKey = previous?.fieldKey ?? fieldKeyFor(input.sectionKey, input.field, input.index);
  const hasValue = isFilled(normalizedValue);

  if (previous && isFilled(previous.normalizedValue) && !hasValue) {
    input.regressedFields.push(fieldKey);
    return {
      ...previous,
      status: "regressed",
      lastSeenAt: input.now,
      seenInLatestScrape: true,
    };
  }

  const changed = Boolean(previous && previous.contentHash !== nextHash);
  if (!previous || changed) {
    input.changedFields.push(fieldKey);
  }

  return {
    sectionKey: input.sectionKey,
    fieldKey,
    ...(input.field.itemCode ? { oasisItemCode: input.field.itemCode } : {}),
    label: input.field.label ?? input.field.key ?? "",
    value,
    normalizedValue,
    status: changed && previous ? "changed" : hasValue ? "filled" : "empty",
    firstSeenAt: previous?.firstSeenAt ?? input.now,
    lastSeenAt: input.now,
    lastChangedAt: !previous || changed ? input.now : previous.lastChangedAt,
    sourceKind: input.field.sourceKind,
    confidence: input.field.confidence,
    contentHash: nextHash,
    seenInLatestScrape: true,
  };
}

function fieldCounts(fields: OasisDomAcquisitionField[]): {
  fieldCount: number;
  nonEmptyFieldCount: number;
  itemCodeCount: number;
} {
  return {
    fieldCount: fields.length,
    nonEmptyFieldCount: fields.filter((field) => field.status === "filled" || field.status === "changed").length,
    itemCodeCount: new Set(fields.map((field) => field.oasisItemCode).filter(Boolean)).size,
  };
}

function buildSection(input: {
  section: PortalDomExtractedSection;
  now: string;
  previous?: OasisDomAcquisitionSection;
  changedFields: string[];
  regressedFields: string[];
}): OasisDomAcquisitionSection {
  const sectionKey = input.previous?.sectionKey ?? sectionKeyFor(input.section.title);
  if (input.section.status === "skipped_deferred") {
    return {
      sectionKey,
      title: input.section.title,
      status: "deferred",
      firstSeenAt: input.previous?.firstSeenAt ?? input.now,
      lastSeenAt: input.now,
      fieldCount: input.previous?.fieldCount ?? 0,
      nonEmptyFieldCount: input.previous?.nonEmptyFieldCount ?? 0,
      itemCodeCount: input.previous?.itemCodeCount ?? 0,
      fields: input.previous?.fields.map((field) => ({ ...field, seenInLatestScrape: false })) ?? [],
      fallbackReasons: input.section.fallbackReasons,
    };
  }

  const previousByKey = new Map((input.previous?.fields ?? []).map((field) => [field.fieldKey, field]));
  const fields = input.section.fields.map((field, index) => {
    const key = fieldKeyFor(sectionKey, field, index);
    return buildField({
      field,
      sectionKey,
      index,
      now: input.now,
      previous: previousByKey.get(key),
      changedFields: input.changedFields,
      regressedFields: input.regressedFields,
    });
  });
  for (const previous of input.previous?.fields ?? []) {
    if (!fields.some((field) => field.fieldKey === previous.fieldKey)) {
      fields.push({ ...previous, seenInLatestScrape: false });
    }
  }
  const counts = fieldCounts(fields);
  return {
    sectionKey,
    title: input.section.title,
    status: input.section.status === "failed" ? "failed" : input.section.status === "degraded" ? "degraded" : "captured",
    firstSeenAt: input.previous?.firstSeenAt ?? input.now,
    lastSeenAt: input.now,
    ...counts,
    fields,
    fallbackReasons: input.section.fallbackReasons,
  };
}

export function evaluateOasisDomAcquisitionReadiness(input: {
  state: Omit<OasisDomAcquisitionState, "acquisitionStatus" | "readinessReasons" | "missingRequiredSections" | "missingRequiredFields" | "fallbackReasons" | "lastCompletedAt">;
  latestDomState?: PortalDomExtractedState;
  ocrFallbackEnabled?: boolean;
  minFieldCount?: number;
  minNonEmptyFieldCount?: number;
}): OasisDomAcquisitionReadiness {
  const minFieldCount = input.minFieldCount ?? DEFAULT_MIN_FIELD_COUNT;
  const minNonEmptyFieldCount = input.minNonEmptyFieldCount ?? DEFAULT_MIN_NON_EMPTY_FIELD_COUNT;
  const readinessReasons: OasisDomReadinessReason[] = [];
  const fallbackReasons = [...(input.latestDomState?.coverage.fallbackReasons ?? [])];
  const capturedSectionKeys = new Set(
    input.state.sections
      .filter((section) => section.status === "captured" || section.status === "degraded")
      .map((section) => section.sectionKey),
  );
  const failedHighPrioritySections = input.state.sections
    .filter((section) => section.status === "failed" && REQUIRED_SECTION_PATTERNS.some((entry) => entry.key === section.sectionKey))
    .map((section) => section.sectionKey);
  const missingRequiredSections = REQUIRED_SECTION_PATTERNS
    .filter((entry) => !capturedSectionKeys.has(entry.key))
    .map((entry) => entry.label);
  const totalFieldCount = input.state.sections.reduce((total, section) => total + section.fieldCount, 0);
  const totalNonEmptyFieldCount = input.state.sections.reduce((total, section) => total + section.nonEmptyFieldCount, 0);
  const itemCodeCount = new Set(input.state.sections.flatMap((section) =>
    section.fields.map((field) => field.oasisItemCode).filter(Boolean))).size;
  const digest = [
    ...input.state.sections.map((section) => section.title),
    ...input.state.sections.flatMap((section) => section.fields.map((field) => `${field.oasisItemCode ?? ""} ${field.label ?? ""} ${field.normalizedValue}`)),
    input.latestDomState?.textDigest ?? "",
  ].join("\n");
  const missingRequiredFields: string[] = [];

  if (input.latestDomState?.coverage.fallbackRecommended) {
    readinessReasons.push("blocked_extraction_failed");
    fallbackReasons.push(...input.latestDomState.coverage.fallbackReasons);
  }
  if (readinessReasons.length === 0 && isCompletePrintPreviewDomState({
    state: input.state,
    latestDomState: input.latestDomState,
    minFieldCount,
    minNonEmptyFieldCount,
  })) {
    return {
      status: "ready_for_qa",
      readinessReasons: ["ready_for_qa"],
      missingRequiredSections: [],
      missingRequiredFields,
      fallbackReasons: [],
    };
  }
  if (missingRequiredSections.length > 0) {
    readinessReasons.push("pending_missing_required_sections");
  }
  if (totalFieldCount < minFieldCount || itemCodeCount < 8) {
    readinessReasons.push("pending_low_field_coverage");
  }
  if (totalNonEmptyFieldCount < minNonEmptyFieldCount) {
    readinessReasons.push("pending_low_nonempty_coverage");
  }
  if (failedHighPrioritySections.length > 0) {
    readinessReasons.push("pending_failed_high_priority_sections");
    missingRequiredFields.push(...failedHighPrioritySections.map((section) => `${section}:section_failed`));
  }
  if (!CLINICAL_CUE_PATTERNS.every((pattern) => pattern.test(digest))) {
    readinessReasons.push("pending_low_nonempty_coverage");
  }

  const uniqueReasons = Array.from(new Set(readinessReasons));
  if (uniqueReasons.length === 0) {
    return {
      status: "ready_for_qa",
      readinessReasons: ["ready_for_qa"],
      missingRequiredSections: [],
      missingRequiredFields,
      fallbackReasons: [],
    };
  }
  return {
    status: uniqueReasons.includes("fallback_to_ocr_required")
      ? "fallback_to_ocr_required"
      : uniqueReasons.includes("blocked_extraction_failed")
        ? "insufficient_evidence"
        : "in_progress",
    readinessReasons: uniqueReasons,
    missingRequiredSections,
    missingRequiredFields,
    fallbackReasons: Array.from(new Set(fallbackReasons)),
  };
}

export function mergeOasisDomAcquisitionState(
  previous: OasisDomAcquisitionState | null,
  latest: PortalDomExtractedState,
  options: OasisDomAcquisitionMergeOptions = {},
): OasisDomAcquisitionState {
  const now = options.scrapedAt ?? latest.extractedAt ?? new Date().toISOString();
  const changedFields: string[] = [];
  const regressedFields: string[] = [];
  const previousSections = new Map((previous?.sections ?? []).map((section) => [
    `${section.sectionKey}|${normalizeKey(section.title)}`,
    section,
  ]));
  const sections = latest.sections.map((section) => {
    const sectionKey = sectionKeyFor(section.title);
    return buildSection({
      section,
      now,
      previous: previousSections.get(`${sectionKey}|${normalizeKey(section.title)}`),
      changedFields,
      regressedFields,
    });
  });
  const latestSectionKeys = new Set(sections.map((section) => `${section.sectionKey}|${normalizeKey(section.title)}`));
  for (const previousSection of previous?.sections ?? []) {
    if (!latestSectionKeys.has(`${previousSection.sectionKey}|${normalizeKey(previousSection.title)}`)) {
      sections.push({
        ...previousSection,
        status: "not_seen_this_run",
        fields: previousSection.fields.map((field) => ({ ...field, seenInLatestScrape: false })),
      });
    }
  }
  const contentHash = sha256(stableJson({
    sections: sections.map((section) => ({
      sectionKey: section.sectionKey,
      status: section.status,
      fields: section.fields.map((field) => ({
        fieldKey: field.fieldKey,
        value: field.normalizedValue,
        status: field.status,
        hash: field.contentHash,
      })),
    })),
  }));
  const baseState = {
    artifactType: "oasis_dom_acquisition_state" as const,
    ...(options.patientRunId ?? previous?.patientRunId ? { patientRunId: options.patientRunId ?? previous?.patientRunId } : {}),
    ...(options.patientId ?? previous?.patientId ? { patientId: options.patientId ?? previous?.patientId } : {}),
    ...(options.oasisDocumentId ?? previous?.oasisDocumentId ? { oasisDocumentId: options.oasisDocumentId ?? previous?.oasisDocumentId } : {}),
    ...(options.sourceKey ?? previous?.sourceKey ?? latest.diagnostics.routePattern ? { sourceKey: options.sourceKey ?? previous?.sourceKey ?? latest.diagnostics.routePattern } : {}),
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastScrapedAt: now,
    overallContentHash: contentHash,
    ...(previous?.lastQaInputHash || options.previousQaInputHash ? { lastQaInputHash: options.previousQaInputHash ?? previous?.lastQaInputHash } : {}),
    sections,
    changedFields: Array.from(new Set(changedFields)),
    regressedFields: Array.from(new Set(regressedFields)),
  };
  const readiness = evaluateOasisDomAcquisitionReadiness({
    state: baseState,
    latestDomState: latest,
    ocrFallbackEnabled: options.ocrFallbackEnabled,
    minFieldCount: options.minFieldCount,
    minNonEmptyFieldCount: options.minNonEmptyFieldCount,
  });
  const qaWasCompleted = previous?.acquisitionStatus === "qa_completed" || Boolean(previous?.lastQaInputHash);
  const contentChangedSinceQa = changedFields.length > 0 || regressedFields.length > 0;
  const acquisitionStatus: OasisDomAcquisitionStatus = qaWasCompleted && contentChangedSinceQa
    ? "qa_stale_due_to_oasis_change"
    : qaWasCompleted
      ? "qa_completed"
      : readiness.status;

  return {
    ...baseState,
    lastCompletedAt: readiness.status === "ready_for_qa" ? now : previous?.lastCompletedAt,
    acquisitionStatus,
    missingRequiredSections: readiness.missingRequiredSections,
    missingRequiredFields: readiness.missingRequiredFields,
    readinessReasons: readiness.readinessReasons,
    fallbackReasons: readiness.fallbackReasons,
  };
}

export async function readOasisDomAcquisitionState(
  patientArtifactsDirectory: string,
): Promise<OasisDomAcquisitionState | null> {
  const filePath = path.join(patientArtifactsDirectory, OASIS_DOM_ACQUISITION_STATE_FILE_NAME);
  const content = await readFile(filePath, "utf8").catch(() => null);
  return content ? JSON.parse(content) as OasisDomAcquisitionState : null;
}

export async function writeOasisDomAcquisitionState(input: {
  patientArtifactsDirectory: string;
  state: OasisDomAcquisitionState;
}): Promise<string> {
  await mkdir(input.patientArtifactsDirectory, { recursive: true });
  const filePath = path.join(input.patientArtifactsDirectory, OASIS_DOM_ACQUISITION_STATE_FILE_NAME);
  await writeFile(filePath, JSON.stringify(input.state, null, 2), "utf8");
  return filePath;
}
