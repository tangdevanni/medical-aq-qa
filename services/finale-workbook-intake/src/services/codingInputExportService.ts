import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CanonicalDiagnosisCodePair,
  CanonicalDiagnosisExtraction,
} from "./diagnosisCodingExtractionService";

const ICD10_EXACT_REGEX = /^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/;

type DiagnosisConfidence = "high" | "medium" | "low";

export type CodingInputDiagnosis = {
  code: string;
  description: string;
  confidence: DiagnosisConfidence;
};

export type CodingInputDocument = {
  primaryDiagnosis: CodingInputDiagnosis;
  otherDiagnoses: CodingInputDiagnosis[];
  suggestedOnsetType: "onset" | "exacerbate";
  suggestedSeverity: 0 | 1 | 2 | 3 | 4;
  comorbidityFlags: {
    pvd_pad: boolean;
    diabetes: boolean;
    none: boolean;
  };
  notes: string[];
};

export type OasisReadyDiagnosisDocument = CodingInputDocument;

export type CodingInputExportResult = {
  filePath: string;
  document: CodingInputDocument;
};

type DiagnosisCandidate = {
  code: string;
  description: string;
  confidence: DiagnosisConfidence;
  rank: number;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function sanitizeText(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "");
}

function normalizeIcdCode(value: string | null | undefined): string {
  const candidate = sanitizeText(value).toUpperCase().replace(/[,;:.]+$/g, "");
  if (!candidate) {
    return "";
  }
  return ICD10_EXACT_REGEX.test(candidate) ? candidate : "";
}

function normalizeDiagnosisDescription(value: string | null | undefined): string {
  return sanitizeText(value)
    .replace(/\(\s*[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\s*\)/gi, "")
    .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
    .replace(/\s+/g, " ");
}

function diagnosisKey(value: string): string {
  return normalizeDiagnosisDescription(value).toLowerCase();
}

function confidenceRank(value: DiagnosisConfidence): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
    default:
      return 1;
  }
}

function inferEntryConfidence(input: {
  pair: CanonicalDiagnosisCodePair;
  extractionConfidence: DiagnosisConfidence;
}): DiagnosisConfidence {
  if (normalizeIcdCode(input.pair.code)) {
    return "high";
  }
  return input.extractionConfidence === "high" ? "medium" : input.extractionConfidence;
}

function buildDiagnosisCandidates(canonical: CanonicalDiagnosisExtraction): DiagnosisCandidate[] {
  const basePairs = canonical.diagnosis_code_pairs.length > 0
    ? canonical.diagnosis_code_pairs
    : canonical.diagnosis_phrases.map((diagnosis) => ({
        diagnosis,
        code: null,
        code_source: null,
      }));

  const candidates: DiagnosisCandidate[] = [];
  for (const [rank, pair] of basePairs.entries()) {
    const description = normalizeDiagnosisDescription(pair.diagnosis);
    if (!description) {
      continue;
    }
    candidates.push({
      code: normalizeIcdCode(pair.code),
      description,
      confidence: inferEntryConfidence({
        pair,
        extractionConfidence: canonical.extraction_confidence,
      }),
      rank,
    });
  }

  const deduped = new Map<string, DiagnosisCandidate>();
  for (const candidate of candidates) {
    const key = diagnosisKey(candidate.description);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    const replacement =
      (candidate.code && !existing.code) ||
      confidenceRank(candidate.confidence) > confidenceRank(existing.confidence) ||
      (candidate.description.length > existing.description.length && candidate.rank <= existing.rank)
        ? candidate
        : existing;
    deduped.set(key, replacement);
  }

  const ordered = [...deduped.values()].sort((left, right) => left.rank - right.rank);
  return ordered.filter((candidate) =>
    !ordered.some((other) =>
      other !== candidate &&
      other.rank <= candidate.rank &&
      other.description.length > candidate.description.length &&
      other.description.toLowerCase().includes(candidate.description.toLowerCase()),
    ),
  );
}

function emptyDiagnosis(confidence: DiagnosisConfidence): CodingInputDiagnosis {
  return {
    code: "",
    description: "",
    confidence,
  };
}

function toCodingDiagnosis(candidate: DiagnosisCandidate | null | undefined): CodingInputDiagnosis {
  if (!candidate) {
    return emptyDiagnosis("low");
  }
  return {
    code: candidate.code,
    description: candidate.description,
    confidence: candidate.confidence,
  };
}

function inferSuggestedOnsetType(canonical: CanonicalDiagnosisExtraction, primary: CodingInputDiagnosis): "onset" | "exacerbate" {
  const combined = [
    primary.description,
    canonical.reason_for_admission ?? "",
    canonical.clinical_summary ?? "",
  ].join(" ");
  return /\b(?:acute on chronic|exacerbat|decompensat|flare|worsen|with hypoxia)\b/i.test(combined)
    ? "exacerbate"
    : "onset";
}

function inferSuggestedSeverity(primary: CodingInputDiagnosis): 0 | 1 | 2 | 3 | 4 {
  const description = primary.description.toLowerCase();
  if (!description) {
    return 0;
  }
  if (/(respiratory failure|sepsis|acute kidney failure)/i.test(description)) {
    return 4;
  }
  if (/(heart failure|pneumonia|encephalopathy|ulcer|gangrene)/i.test(description)) {
    return 3;
  }
  if (/(weakness|pain|dysphagia)/i.test(description)) {
    return 1;
  }
  return 2;
}

function inferComorbidityFlags(diagnoses: CodingInputDiagnosis[]): CodingInputDocument["comorbidityFlags"] {
  const joined = diagnoses.map((diagnosis) => diagnosis.description).join(" ");
  const pvdPad = /\b(?:peripheral vascular disease|peripheral arterial disease|pvd|pad)\b/i.test(joined);
  const diabetes = /\b(?:diabetes|diabetes mellitus|dm)\b/i.test(joined);
  return {
    pvd_pad: pvdPad,
    diabetes,
    none: !pvdPad && !diabetes,
  };
}

function buildNotes(input: {
  canonical: CanonicalDiagnosisExtraction;
  primaryDiagnosis: CodingInputDiagnosis;
}): string[] {
  const notes: string[] = [];

  if (input.canonical.reason_for_admission) {
    notes.push(`Reason for admission: ${sanitizeText(input.canonical.reason_for_admission)}`);
  }
  if (input.canonical.ordered_services.length > 0) {
    notes.push(`Ordered services: ${input.canonical.ordered_services.join(", ")}`);
  }
  if (!input.primaryDiagnosis.code) {
    notes.push("Primary diagnosis code left blank because no explicit or strongly inferable ICD-10 mapping was retained.");
  }

  return [...new Set(notes)].slice(0, 6);
}

export function buildOasisReadyDiagnosisDocument(
  canonical: CanonicalDiagnosisExtraction,
): OasisReadyDiagnosisDocument {
  const candidates = buildDiagnosisCandidates(canonical);
  const [primaryCandidate, ...otherCandidates] = candidates;
  const primaryDiagnosis = toCodingDiagnosis(primaryCandidate);
  const otherDiagnoses = otherCandidates.map((candidate) => toCodingDiagnosis(candidate)).slice(0, 12);

  return {
    primaryDiagnosis,
    otherDiagnoses,
    suggestedOnsetType: inferSuggestedOnsetType(canonical, primaryDiagnosis),
    suggestedSeverity: inferSuggestedSeverity(primaryDiagnosis),
    comorbidityFlags: inferComorbidityFlags([primaryDiagnosis, ...otherDiagnoses].filter((diagnosis) => Boolean(diagnosis.description))),
    notes: buildNotes({
      canonical,
      primaryDiagnosis,
    }),
  };
}

export async function writeCodingInputFile(input: {
  outputDirectory: string;
  patientId: string;
  batchId: string;
  canonical: CanonicalDiagnosisExtraction;
}): Promise<CodingInputExportResult> {
  const output = buildOasisReadyDiagnosisDocument(input.canonical);

  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "coding-input.json");
  await writeFile(filePath, JSON.stringify(output, null, 2), "utf8");

  return {
    filePath,
    document: output,
  };
}
