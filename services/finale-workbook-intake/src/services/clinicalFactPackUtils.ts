import { createHash } from "node:crypto";
import type {
  ClinicalFact,
  ClinicalFactCategory,
  ClinicalFactEvidence,
  ClinicalFactPack,
  ClinicalFactSourceType,
} from "@medical-ai-qa/shared-types";
import { CLINICAL_TEXT_QUALITY_FILTER_VERSION } from "./clinicalQualityVersion";

export const SOURCE_CLINICAL_FACT_PACK_FILE_NAME = "source-clinical-fact-pack.json";
export const OASIS_CLINICAL_FACT_PACK_FILE_NAME = "oasis-clinical-fact-pack.json";
export const CLINICAL_FACT_PACK_MANIFEST_FILE_NAME = "clinical-fact-pack-manifest.json";

export type ClinicalFactPackManifest = {
  schemaVersion: 1;
  qualityFilterVersion: string;
  sourceFactPackHash: string;
  oasisFactPackHash: string;
  sourceFactCount: number;
  oasisFactCount: number;
  sourceCategories: ClinicalFactCategory[];
  oasisCategories: ClinicalFactCategory[];
  generatedAt: string;
  inputArtifactHashes: Record<string, string | null>;
  oasisCoverage?: {
    categoriesPresent: ClinicalFactCategory[];
    categoriesMissing: ClinicalFactCategory[];
    structuredFactCount: number;
    sectionFallbackFactCount: number;
    lowConfidenceFactCount: number;
    coverageWarnings: string[];
  };
  warnings: string[];
};

export function normalizeWhitespace(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function normalizeValue(value: unknown): string {
  return normalizeWhitespace(String(value ?? "")).toLowerCase();
}

export function clipSnippet(value: unknown, maxLength = 220): string | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trim()}...`;
}

export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

export function hashClinicalValue(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value ?? null)).digest("hex");
}

export function buildFactId(input: {
  sourceType: ClinicalFactSourceType;
  category: ClinicalFactCategory;
  normalizedValue: string;
  sourceDocumentKey?: string | null;
}): string {
  const hash = createHash("sha256")
    .update([
      input.sourceType,
      input.category,
      normalizeValue(input.normalizedValue),
      input.sourceDocumentKey ?? "",
    ].join("|"))
    .digest("hex")
    .slice(0, 16);
  return `${input.sourceType}:${input.category}:${hash}`;
}

export function buildFact(input: Omit<ClinicalFact, "factId"> & { factId?: string }): ClinicalFact | null {
  const normalizedValue = normalizeWhitespace(input.normalizedValue);
  const label = normalizeWhitespace(input.label);
  if (!normalizedValue || !label) {
    return null;
  }
  const sourceDocumentKey = normalizeWhitespace(input.sourceDocumentKey) || undefined;
  const factId = input.factId ?? buildFactId({
    sourceType: input.sourceType,
    category: input.category,
    normalizedValue,
    sourceDocumentKey,
  });
  return {
    ...input,
    factId,
    label,
    normalizedValue,
    rawValue: normalizeWhitespace(input.rawValue) || undefined,
    sourceDocumentKey,
    sourceArtifactPath: normalizeWhitespace(input.sourceArtifactPath) || undefined,
    evidence: input.evidence
      .filter((entry) => normalizeWhitespace(entry.artifactPath))
      .map((entry) => ({
        ...entry,
        artifactPath: normalizeWhitespace(entry.artifactPath),
        documentKey: normalizeWhitespace(entry.documentKey) || undefined,
        section: normalizeWhitespace(entry.section) || undefined,
        snippet: clipSnippet(entry.snippet),
      })),
    confidence: Math.max(0, Math.min(1, input.confidence)),
  };
}

export function dedupeFacts(facts: Array<ClinicalFact | null>): ClinicalFact[] {
  const byKey = new Map<string, ClinicalFact>();
  for (const fact of facts) {
    if (!fact) {
      continue;
    }
    const key = [
      fact.category,
      normalizeValue(fact.normalizedValue),
      fact.sourceDocumentKey ?? "",
      fact.polarity,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || fact.confidence > existing.confidence) {
      byKey.set(key, fact);
    } else if (existing && fact.evidence.length > 0) {
      byKey.set(key, {
        ...existing,
        evidence: [...existing.evidence, ...fact.evidence].slice(0, 6),
      });
    }
  }
  return Array.from(byKey.values()).sort((left, right) =>
    left.category.localeCompare(right.category) ||
    left.normalizedValue.localeCompare(right.normalizedValue));
}

export function buildPack(input: {
  patientId: string;
  source: "source" | "oasis";
  facts: Array<ClinicalFact | null>;
  warnings?: string[];
  generatedAt?: string;
}): ClinicalFactPack {
  const facts = dedupeFacts(input.facts);
  return {
    schemaVersion: 1,
    qualityFilterVersion: CLINICAL_TEXT_QUALITY_FILTER_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    patientId: input.patientId,
    source: input.source,
    factCount: facts.length,
    categories: Array.from(new Set(facts.map((fact) => fact.category))).sort(),
    facts,
    warnings: input.warnings ?? [],
  };
}

export function evidence(input: {
  artifactPath: string | null | undefined;
  documentKey?: string | null;
  section?: string | null;
  snippet?: string | null;
  extractedAt?: string | null;
}): ClinicalFactEvidence[] {
  const artifactPath = normalizeWhitespace(input.artifactPath);
  if (!artifactPath) {
    return [];
  }
  return [{
    artifactPath,
    documentKey: normalizeWhitespace(input.documentKey) || undefined,
    section: normalizeWhitespace(input.section) || undefined,
    snippet: clipSnippet(input.snippet),
    extractedAt: normalizeWhitespace(input.extractedAt) || undefined,
  }];
}

export function hashFactPack(pack: ClinicalFactPack | null | undefined): string {
  return hashClinicalValue(pack ? {
    qualityFilterVersion: pack.qualityFilterVersion ?? "legacy",
    facts: pack.facts.map((fact) => ({
      category: fact.category,
      normalizedValue: fact.normalizedValue,
      label: fact.label,
      rawValue: fact.rawValue ?? null,
      evidence: fact.evidence.map((entry) => ({
        artifactPath: entry.artifactPath,
        section: entry.section ?? null,
        snippet: entry.snippet ?? null,
      })),
      polarity: fact.polarity,
      clinicalStatus: fact.clinicalStatus ?? null,
      date: fact.date ?? null,
      sourceType: fact.sourceType,
      sourceDocumentKey: fact.sourceDocumentKey ?? null,
      confidence: fact.confidence,
    })),
  } : null);
}
