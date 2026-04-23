import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalDiagnosisExtraction } from "./diagnosisCodingExtractionService";
import type {
  OasisDiagnosisPageSnapshot,
  OasisDiagnosisRowSnapshot,
} from "../portal/utils/oasisDiagnosisInspector";
import { isComparableOasisDiagnosisRow } from "../portal/utils/oasisDiagnosisInspector";

const ICD10_EXACT_REGEX = /^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/;

export interface OasisDiagnosisComparableEntry {
  diagnosis: string;
  code: string | null;
  source: "diagnosis_code_pairs" | "diagnosis_phrases";
}

export interface OasisDiagnosisComparisonMatch {
  extractedIndex: number | null;
  portalRowIndex: number | null;
  extractedDiagnosis: string | null;
  extractedCode: string | null;
  portalDescription: string | null;
  portalCode: string | null;
  matchType: "exact" | "normalized" | "mismatch";
  score: number;
  notes: string[];
}

export interface OasisDiagnosisComparisonReport {
  schemaVersion: "1";
  comparedAt: string;
  patientId: string;
  batchId: string;
  summary: {
    extractedEntryCount: number;
    portalRowCount: number;
    exactMatchCount: number;
    normalizedMatchCount: number;
    mismatchCount: number;
    missingOnPortalCount: number;
    missingInExtractionCount: number;
    suspiciousCaseCount: number;
  };
  exactMatches: OasisDiagnosisComparisonMatch[];
  normalizedMatches: OasisDiagnosisComparisonMatch[];
  mismatches: OasisDiagnosisComparisonMatch[];
  missingOnPortal: OasisDiagnosisComparisonMatch[];
  missingInExtraction: OasisDiagnosisComparisonMatch[];
  suspiciousCases: string[];
  confidenceNotes: string[];
}

export interface OasisDiagnosisSnapshotExportResult {
  filePath: string;
  snapshot: OasisDiagnosisPageSnapshot;
}

export interface OasisDiagnosisComparisonExportResult {
  filePath: string;
  report: OasisDiagnosisComparisonReport;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeText(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIcd(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, "")
    .trim();
  if (!normalized) {
    return null;
  }
  return ICD10_EXACT_REGEX.test(normalized) ? normalized : null;
}

function normalizeDate(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!slashMatch) {
    return null;
  }
  const month = slashMatch[1]!.padStart(2, "0");
  const day = slashMatch[2]!.padStart(2, "0");
  const yearRaw = slashMatch[3]!;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day}`;
}

function tokenize(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter((token) => token.length >= 3);
}

function tokenOverlap(left: string[] | string, right: string[] | string): number {
  const leftTokens = Array.isArray(left) ? left : tokenize(left);
  const rightTokens = Array.isArray(right) ? right : tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const denominator = Math.max(leftSet.size, rightSet.size);
  return denominator === 0 ? 0 : intersection / denominator;
}

function buildExtractedEntries(canonical: CanonicalDiagnosisExtraction): OasisDiagnosisComparableEntry[] {
  const entries: OasisDiagnosisComparableEntry[] = [];
  const seen = new Set<string>();

  for (const pair of canonical.diagnosis_code_pairs) {
    const diagnosis = normalizeWhitespace(pair.diagnosis);
    if (!diagnosis) {
      continue;
    }
    const code = normalizeIcd(pair.code);
    const key = `${normalizeText(diagnosis)}|${code ?? ""}|pair`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      diagnosis,
      code,
      source: "diagnosis_code_pairs",
    });
  }

  for (const phrase of canonical.diagnosis_phrases) {
    const diagnosis = normalizeWhitespace(phrase);
    if (!diagnosis) {
      continue;
    }
    const key = `${normalizeText(diagnosis)}||phrase`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      diagnosis,
      code: null,
      source: "diagnosis_phrases",
    });
  }

  return entries.slice(0, 120);
}

function buildPortalDescription(row: OasisDiagnosisRowSnapshot): string {
  if (row.description) {
    return row.description;
  }
  if (row.rawText) {
    return row.rawText.slice(0, 220);
  }
  return "";
}

function scoreMatch(
  extracted: OasisDiagnosisComparableEntry,
  row: OasisDiagnosisRowSnapshot,
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;

  const extractedCode = normalizeIcd(extracted.code);
  const portalCode = normalizeIcd(row.icd10Code);
  if (extractedCode && portalCode && extractedCode === portalCode) {
    score += 0.7;
    notes.push("Exact ICD-10 code match.");
  } else if (extractedCode && portalCode && extractedCode !== portalCode) {
    score -= 0.2;
    notes.push("ICD-10 codes differ.");
  } else if (!extractedCode && !portalCode) {
    score += 0.05;
  }

  const extractedDiagnosisNorm = normalizeText(extracted.diagnosis);
  const portalDiagnosis = buildPortalDescription(row);
  const portalDiagnosisNorm = normalizeText(portalDiagnosis);
  if (extractedDiagnosisNorm && portalDiagnosisNorm && extractedDiagnosisNorm === portalDiagnosisNorm) {
    score += 0.35;
    notes.push("Normalized diagnosis text exact match.");
  } else {
    const overlap = tokenOverlap(extractedDiagnosisNorm, portalDiagnosisNorm);
    score += overlap * 0.35;
    if (overlap >= 0.55) {
      notes.push(`Diagnosis token overlap ${overlap.toFixed(2)}.`);
    }
  }

  const onsetDateNormalized = normalizeDate(row.onsetDate);
  if (onsetDateNormalized) {
    notes.push(`Portal onset date present: ${onsetDateNormalized}.`);
  }

  return { score, notes };
}

function classifyMatchType(input: {
  score: number;
  extractedDiagnosis: string;
  extractedCode: string | null;
  portalDescription: string | null;
  portalCode: string | null;
}): "exact" | "normalized" | "mismatch" {
  const diagnosisEqual = normalizeText(input.extractedDiagnosis) === normalizeText(input.portalDescription);
  const codesEqual = normalizeIcd(input.extractedCode) === normalizeIcd(input.portalCode);
  if (diagnosisEqual && (codesEqual || (!input.extractedCode && !input.portalCode))) {
    return "exact";
  }
  if (input.score >= 0.55) {
    return "normalized";
  }
  return "mismatch";
}

export function compareExtractedDiagnosisWithPortalSnapshot(input: {
  patientId: string;
  batchId: string;
  canonical: CanonicalDiagnosisExtraction;
  snapshot: OasisDiagnosisPageSnapshot;
}): OasisDiagnosisComparisonReport {
  const extractedEntries = buildExtractedEntries(input.canonical);
  const portalRows = input.snapshot.rows.filter(isComparableOasisDiagnosisRow);
  const usedPortalRows = new Set<number>();
  const exactMatches: OasisDiagnosisComparisonMatch[] = [];
  const normalizedMatches: OasisDiagnosisComparisonMatch[] = [];
  const mismatches: OasisDiagnosisComparisonMatch[] = [];
  const missingOnPortal: OasisDiagnosisComparisonMatch[] = [];
  const missingInExtraction: OasisDiagnosisComparisonMatch[] = [];
  const suspiciousCases: string[] = [];
  const confidenceNotes: string[] = [];

  extractedEntries.forEach((entry, extractedIndex) => {
    let bestPortalRowIndex: number | null = null;
    let bestScore = -1;
    let bestNotes: string[] = [];

    portalRows.forEach((row, portalRowIndex) => {
      if (usedPortalRows.has(portalRowIndex)) {
        return;
      }
      const scored = scoreMatch(entry, row);
      if (scored.score > bestScore) {
        bestScore = scored.score;
        bestPortalRowIndex = portalRowIndex;
        bestNotes = scored.notes;
      }
    });

    if (bestPortalRowIndex === null || bestScore < 0.35) {
      missingOnPortal.push({
        extractedIndex,
        portalRowIndex: null,
        extractedDiagnosis: entry.diagnosis,
        extractedCode: entry.code,
        portalDescription: null,
        portalCode: null,
        matchType: "mismatch",
        score: Math.max(bestScore, 0),
        notes: ["No portal row reached comparison threshold."],
      });
      return;
    }

    usedPortalRows.add(bestPortalRowIndex);
    const portalRow = portalRows[bestPortalRowIndex]!;
    const portalDescription = buildPortalDescription(portalRow) || null;
    const portalCode = normalizeIcd(portalRow.icd10Code);
    const matchType = classifyMatchType({
      score: bestScore,
      extractedDiagnosis: entry.diagnosis,
      extractedCode: entry.code,
      portalDescription,
      portalCode,
    });
    const match: OasisDiagnosisComparisonMatch = {
      extractedIndex,
      portalRowIndex: bestPortalRowIndex,
      extractedDiagnosis: entry.diagnosis,
      extractedCode: entry.code,
      portalDescription,
      portalCode,
      matchType,
      score: Number(bestScore.toFixed(3)),
      notes: bestNotes,
    };

    if (matchType === "exact") {
      exactMatches.push(match);
    } else if (matchType === "normalized") {
      normalizedMatches.push(match);
    } else {
      mismatches.push(match);
    }
  });

  portalRows.forEach((row, portalRowIndex) => {
    if (usedPortalRows.has(portalRowIndex)) {
      return;
    }
    missingInExtraction.push({
      extractedIndex: null,
      portalRowIndex,
      extractedDiagnosis: null,
      extractedCode: null,
      portalDescription: buildPortalDescription(row) || null,
      portalCode: normalizeIcd(row.icd10Code),
      matchType: "mismatch",
      score: 0,
      notes: ["Portal row was not matched by extracted diagnosis entries."],
    });
  });

  for (const missingEntry of missingOnPortal) {
    if (!missingEntry.extractedDiagnosis) {
      continue;
    }
    const overlapCount = portalRows
      .filter((row) => tokenOverlap(missingEntry.extractedDiagnosis ?? "", buildPortalDescription(row)) >= 0.4)
      .length;
    if (overlapCount >= 2) {
      suspiciousCases.push(
        `Extracted diagnosis '${missingEntry.extractedDiagnosis}' appears to overlap with multiple portal rows (${overlapCount}); possible split/merge mapping.`,
      );
    }
  }

  if (input.snapshot.extractionWarnings.length > 0) {
    confidenceNotes.push(
      `Portal snapshot warnings: ${input.snapshot.extractionWarnings.join(" | ")}`,
    );
  }
  if (portalRows.length !== input.snapshot.rows.length) {
    confidenceNotes.push(
      `Ignored ${input.snapshot.rows.length - portalRows.length} empty diagnosis slot(s) while comparing extracted diagnoses to the portal snapshot.`,
    );
  }
  if (input.canonical.uncertain_items.length > 0) {
    confidenceNotes.push(
      `Extraction uncertain items: ${input.canonical.uncertain_items.join(" | ")}`,
    );
  }
  if (normalizedMatches.length > exactMatches.length) {
    confidenceNotes.push("Most mappings are normalized-text matches rather than exact field matches.");
  }
  if (missingOnPortal.length > 0 || missingInExtraction.length > 0) {
    confidenceNotes.push("Missing mappings detected between extracted and portal diagnosis sets.");
  }

  return {
    schemaVersion: "1",
    comparedAt: new Date().toISOString(),
    patientId: input.patientId,
    batchId: input.batchId,
    summary: {
      extractedEntryCount: extractedEntries.length,
      portalRowCount: portalRows.length,
      exactMatchCount: exactMatches.length,
      normalizedMatchCount: normalizedMatches.length,
      mismatchCount: mismatches.length,
      missingOnPortalCount: missingOnPortal.length,
      missingInExtractionCount: missingInExtraction.length,
      suspiciousCaseCount: suspiciousCases.length,
    },
    exactMatches,
    normalizedMatches,
    mismatches,
    missingOnPortal,
    missingInExtraction,
    suspiciousCases,
    confidenceNotes,
  };
}

export async function writeOasisDiagnosisSnapshotFile(input: {
  outputDirectory: string;
  patientId: string;
  snapshot: OasisDiagnosisPageSnapshot;
}): Promise<OasisDiagnosisSnapshotExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-diagnosis-snapshot.json");
  await writeFile(filePath, JSON.stringify(input.snapshot, null, 2), "utf8");
  return {
    filePath,
    snapshot: input.snapshot,
  };
}

export async function writeOasisDiagnosisComparisonFile(input: {
  outputDirectory: string;
  patientId: string;
  report: OasisDiagnosisComparisonReport;
}): Promise<OasisDiagnosisComparisonExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-diagnosis-compare.json");
  await writeFile(filePath, JSON.stringify(input.report, null, 2), "utf8");
  return {
    filePath,
    report: input.report,
  };
}
