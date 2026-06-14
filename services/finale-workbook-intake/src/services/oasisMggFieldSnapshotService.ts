import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PortalDomExtractedField,
  PortalDomExtractedState,
  PortalDomExtractionConfidence,
} from "@medical-ai-qa/shared-types";

export const OASIS_MGG_FIELD_SNAPSHOT_FILE_NAME = "oasis-mgg-field-snapshot.json";

export type OasisMggFieldGroup = "M fields" | "GG fields";

export type OasisMggFieldSnapshotField = {
  fieldKey: string;
  fieldGroup: OasisMggFieldGroup;
  itemCode: string;
  itemLabel: string | null;
  sectionTitle: string | null;
  selectedValue: string | null;
  selectedOptionText: string | null;
  optionTexts: string[];
  confidence: PortalDomExtractionConfidence;
  sourceEvidenceText: string | null;
};

export type OasisMggFieldSnapshotArtifact = {
  schemaVersion: "oasis-mgg-field-snapshot.v1";
  generatedAt: string;
  assessmentId: string | null;
  assessmentType: string | null;
  title: string | null;
  date: string | null;
  sourceDomStatePath: string | null;
  fieldCount: number;
  fields: OasisMggFieldSnapshotField[];
  warnings: string[];
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeOasisItemCode(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value).toUpperCase();
  const ggMatch = normalized.match(/\bGG\d{4}[A-Z0-9]*\b/)?.[0];
  if (ggMatch) {
    return ggMatch;
  }
  return normalized.match(/\bM\d{4}/)?.[0] ?? null;
}

export const DISCHARGE_COMPARABLE_M_ITEM_CODES = new Set([
  "M1033",
  "M1242",
  "M1400",
  "M1600",
  "M1610",
  "M1620",
  "M1630",
  "M1700",
  "M1710",
  "M1720",
  "M1740",
  "M1745",
  "M1800",
  "M1810",
  "M1820",
  "M1830",
  "M1840",
  "M1845",
  "M1850",
  "M1860",
  "M1870",
  "M2020",
  "M2030",
]);

export function isDischargeComparableItemCode(itemCode: string): boolean {
  if (itemCode.startsWith("GG")) {
    return /^GG0130[A-Z0-9]*$/.test(itemCode) || /^GG0170[A-P][A-Z0-9]*$/.test(itemCode);
  }
  return DISCHARGE_COMPARABLE_M_ITEM_CODES.has(itemCode);
}

function itemCodeForField(field: PortalDomExtractedField): string | null {
  for (const candidate of [
    field.itemCode,
    field.key,
    field.label,
  ]) {
    const itemCode = normalizeOasisItemCode(candidate);
    if (itemCode) {
      return itemCode;
    }
  }

  return normalizeOasisItemCode([
    field.evidenceText,
    ...(field.optionTexts ?? []),
  ].filter(Boolean).join(" "));
}

function selectedValue(field: PortalDomExtractedField): string | null {
  if (field.selectedValue !== undefined) {
    return normalizeWhitespace(field.selectedValue);
  }
  if (typeof field.value === "number" || typeof field.value === "boolean") {
    return String(field.value);
  }
  if (typeof field.value === "string") {
    return normalizeWhitespace(field.value);
  }
  if (Array.isArray(field.value)) {
    const value = field.value.map(normalizeWhitespace).filter(Boolean).join(" | ");
    return value || null;
  }
  return null;
}

function selectedOptionText(field: PortalDomExtractedField): string | null {
  const text = normalizeWhitespace(field.selectedText);
  if (text) {
    return text;
  }
  const value = selectedValue(field);
  if (!value) {
    return null;
  }
  const matchingOption = (field.optionTexts ?? []).find((option) =>
    normalizeWhitespace(option).toLowerCase().startsWith(value.toLowerCase()),
  );
  return normalizeWhitespace(matchingOption) || value;
}

function optionTextsFromEvidence(field: PortalDomExtractedField): string[] {
  const explicit = (field.optionTexts ?? [])
    .map(normalizeWhitespace)
    .filter(Boolean);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }
  const evidence = normalizeWhitespace(field.evidenceText);
  if (!evidence) {
    return [];
  }
  const optionsMarkerIndex = evidence.indexOf("Options:");
  const optionsText = optionsMarkerIndex >= 0 ? evidence.slice(optionsMarkerIndex + "Options:".length) : evidence;
  return Array.from(new Set(optionsText
    .split(/\s+\|\s+|\n+/)
    .map(normalizeWhitespace)
    .filter((option) => /^\(?-?\d{1,2}\)?\.?\s+|^\(-\)\s+/.test(option))
    .slice(0, 30)));
}

function itemLabel(field: PortalDomExtractedField, itemCode: string): string | null {
  const label = normalizeWhitespace(field.label ?? field.key ?? "");
  if (!label) {
    return null;
  }
  return normalizeWhitespace(label.replace(new RegExp(`\\b${itemCode}\\b`, "i"), "").replace(/^[\s:.-]+/, "")) || label;
}

export function buildOasisMggFieldSnapshot(input: {
  state: PortalDomExtractedState;
  assessmentId?: string | null;
  assessmentType?: string | null;
  title?: string | null;
  date?: string | null;
  sourceDomStatePath?: string | null;
  generatedAt?: string;
}): OasisMggFieldSnapshotArtifact {
  const fields: OasisMggFieldSnapshotField[] = [];
  const seen = new Set<string>();

  for (const section of input.state.sections ?? []) {
    for (const field of section.fields ?? []) {
      const itemCode = itemCodeForField(field);
      if (!itemCode) {
        continue;
      }
      if (!isDischargeComparableItemCode(itemCode)) {
        continue;
      }
      const fieldGroup: OasisMggFieldGroup = itemCode.startsWith("GG") ? "GG fields" : "M fields";
      const selected = selectedValue(field);
      const selectedText = selectedOptionText(field);
      if (!selected && !selectedText && field.checked !== true) {
        continue;
      }
      const snapshotField: OasisMggFieldSnapshotField = {
        fieldKey: normalizeWhitespace(field.key ?? itemCode),
        fieldGroup,
        itemCode,
        itemLabel: itemLabel(field, itemCode),
        sectionTitle: normalizeWhitespace(field.section ?? section.title) || null,
        selectedValue: selected,
        selectedOptionText: selectedText,
        optionTexts: optionTextsFromEvidence(field),
        confidence: field.confidence,
        sourceEvidenceText: normalizeWhitespace(field.evidenceText) || null,
      };
      const dedupeKey = `${snapshotField.itemCode}|${snapshotField.selectedValue}|${snapshotField.selectedOptionText}`.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      fields.push(snapshotField);
    }
  }

  return {
    schemaVersion: "oasis-mgg-field-snapshot.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    assessmentId: input.assessmentId ?? null,
    assessmentType: input.assessmentType ?? null,
    title: input.title ?? null,
    date: input.date ?? null,
    sourceDomStatePath: input.sourceDomStatePath ?? null,
    fieldCount: fields.length,
    fields,
    warnings: fields.length === 0 ? ["No selected M/GG DOM fields were captured."] : [],
  };
}

export async function writeOasisMggFieldSnapshot(input: {
  state: PortalDomExtractedState;
  patientArtifactsDirectory: string;
  assessmentId?: string | null;
  assessmentType?: string | null;
  title?: string | null;
  date?: string | null;
  sourceDomStatePath?: string | null;
  generatedAt?: string;
}): Promise<{
  snapshotPath: string;
  snapshot: OasisMggFieldSnapshotArtifact;
}> {
  const snapshot = buildOasisMggFieldSnapshot(input);
  const snapshotPath = path.join(input.patientArtifactsDirectory, OASIS_MGG_FIELD_SNAPSHOT_FILE_NAME);
  await mkdir(input.patientArtifactsDirectory, { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  return { snapshotPath, snapshot };
}
