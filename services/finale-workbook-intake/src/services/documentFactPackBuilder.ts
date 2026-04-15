import { basename, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { ExtractedDocument } from "./documentExtractionService";

export interface FactSnippet {
  field: string;
  text: string;
  source?: string;
  page?: number;
}

export interface DiagnosisFact {
  code?: string;
  description: string;
  rank?: "primary" | "secondary";
  source?: string;
  page?: number;
}

export interface MedicationFact {
  name: string;
  dose?: string;
  route?: string;
  frequency?: string;
  source?: string;
  page?: number;
}

export interface DocumentFactPack {
  documentType: "oasis";
  diagnoses: DiagnosisFact[];
  medications: MedicationFact[];
  allergies: string[];
  homeboundEvidence: FactSnippet[];
  skilledNeedEvidence: FactSnippet[];
  hospitalizationReasons: FactSnippet[];
  assessmentValues: FactSnippet[];
  uncategorizedEvidence: FactSnippet[];
  stats: {
    rawCharacters: number;
    packedCharacters: number;
    reductionPercent: number;
  };
}

export interface DocumentFactPackFile {
  schemaVersion: "1";
  generatedAt: string;
  patientId: string;
  batchId: string;
  factPack: DocumentFactPack;
}

export interface DocumentFactPackExportResult {
  filePath: string;
  document: DocumentFactPackFile;
}

type DocumentLine = {
  text: string;
  source?: string;
  page?: number;
  documentType: ExtractedDocument["type"];
  lineKey: string;
};

const MAX_SNIPPET_LENGTH = 220;
const MAX_FACTS_PER_SECTION = 12;
const ICD_CODE_PATTERN = /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b/g;
const MEDICATION_DOSE_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?|ml|mL|tablet(?:s)?|tab(?:s)?|capsule(?:s)?|cap(?:s)?|drops?)\b/i;
const MEDICATION_ROUTE_PATTERN =
  /\b(po|iv|im|sq|subq|subcutaneous|topical|inhalation|neb|nasal|ophthalmic|otic|pr|sl|patch)\b/i;
const MEDICATION_FREQUENCY_PATTERN =
  /\b(?:daily|bid|tid|qid|qhs|qam|qpm|every\s+\d+\s*(?:hours?|days?)|weekly|twice daily|three times daily|as needed|prn)\b/i;
const ASSESSMENT_PATTERN =
  /\b(?:score|total|pain\s*(?:scale)?|phq-?9|braden|morse|fall risk|blood pressure|bp|pulse|respiratory rate|temperature|spo2|oxygen saturation)\b/i;
const HOMEBOUND_PATTERN =
  /\b(?:homebound|taxing effort|requires assistance|assist(?:ed)? ambulation|walker|wheelchair|cane|fall risk|weakness|limited endurance|unable to leave home)\b/i;
const SKILLED_NEED_PATTERN =
  /\b(?:skilled nursing|skilled need|wound care|medication management|disease management|assessment|teaching|education|monitoring|pt eval|ot eval|st eval|therapy|intervention|gait training|evaluate and treat|eval and treat)\b/i;
const HOSPITALIZATION_PATTERN =
  /\b(?:reason for (?:referral|admission|hospitalization)|hospitalization|hospital|discharge|post acute|referred for|admitted for)\b/i;
const ALLERGY_PATTERN = /\b(?:allerg(?:y|ies)|nkda|nka)\b/i;
const DIAGNOSIS_PATTERN = /\b(?:primary diagnosis|secondary diagnosis|other diagnos(?:is|es)|active diagnosis|diagnosis(?:es)?|icd)\b/i;
const UNCAT_CLINICAL_PATTERN =
  /\b(?:pain|wound|edema|oxygen|sob|shortness of breath|caregiver|fall|vitals?|blood pressure|weight|diet|bowel|urinary|catheter)\b/i;
const BOILERPLATE_PATTERNS: RegExp[] = [
  /\bautomatic zoom\b/i,
  /\bactual size\b/i,
  /\bpage fit\b/i,
  /\bpage width\b/i,
  /\btools\b/i,
  /\bprint\b/i,
  /^\s*page\s+\d+(?:\s+of\s+\d+)?\s*$/i,
  /^\s*printed by\b/i,
  /^\s*generated on\b/i,
  /^\s*finale health\b/i,
  /^\s*star home health\b/i,
  /^\s*active home health\b/i,
  /^\s*aplus home health\b/i,
  /^\s*avery home health\b/i,
  /^\s*meadows home health\b/i,
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeMultilineText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildSourceLabel(document: ExtractedDocument): string | undefined {
  const portalLabel = normalizeWhitespace(String(document.metadata.portalLabel ?? ""));
  if (portalLabel) {
    return portalLabel;
  }

  const sourcePath = normalizeWhitespace(String(document.metadata.sourcePath ?? ""));
  if (sourcePath) {
    return basename(sourcePath);
  }

  return document.type;
}

function clipSnippet(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= MAX_SNIPPET_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 1).trim()}…`;
}

function stripBoilerplate(line: string): string {
  return line
    .replace(/\b(?:patient name|patient id|dob|date of birth)\b\s*[:\-]?\s*[A-Z0-9,./ -]{6,}/gi, "")
    .replace(/\b(?:agency|provider)\b\s*[:\-]?\s*[A-Z0-9,./ -]{6,}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldDropLine(line: string): boolean {
  const normalized = normalizeWhitespace(line);
  if (!normalized) {
    return true;
  }
  if (normalized.length < 3) {
    return true;
  }
  if (/^[\W_]+$/.test(normalized)) {
    return true;
  }
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function splitLongLine(line: string): string[] {
  if (line.length < 260) {
    return [line];
  }
  return line
    .split(/(?<=[.;])\s+(?=[A-Z0-9])/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);
}

function buildDocumentLines(extractedDocuments: ExtractedDocument[]): DocumentLine[] {
  const uniqueKeys = new Set<string>();
  const lines: DocumentLine[] = [];

  for (const document of extractedDocuments) {
    const source = buildSourceLabel(document);
    const normalizedText = normalizeMultilineText(document.text);
    const rawLines = normalizedText
      .split("\n")
      .flatMap((line) => splitLongLine(line));

    for (const rawLine of rawLines) {
      const cleaned = stripBoilerplate(rawLine);
      if (shouldDropLine(cleaned)) {
        continue;
      }

      const lineKey = cleaned.toLowerCase();
      if (uniqueKeys.has(lineKey)) {
        continue;
      }
      uniqueKeys.add(lineKey);

      lines.push({
        text: cleaned,
        source,
        page: undefined,
        documentType: document.type,
        lineKey,
      });
    }
  }

  return lines;
}

function buildSnippet(field: string, line: DocumentLine): FactSnippet {
  return {
    field,
    text: clipSnippet(line.text),
    source: line.source,
    page: line.page,
  };
}

function cleanDiagnosisDescription(line: string): string {
  return normalizeWhitespace(
    line
      .replace(/\b(?:primary diagnosis|secondary diagnosis(?:es)?|other diagnoses?|active diagnoses?|diagnoses?|icd(?:-10)?(?: code)?s?)\b[:\-]?/gi, "")
      .replace(ICD_CODE_PATTERN, " ")
      .replace(/\b(?:dx|codes?)\b[:\-]?/gi, " ")
      .replace(/\s+/g, " "),
  );
}

function extractDiagnosisFacts(lines: DocumentLine[], extractedDocuments: ExtractedDocument[]): DiagnosisFact[] {
  const facts: DiagnosisFact[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const matchesDiagnosis = DIAGNOSIS_PATTERN.test(line.text);
    const codes = Array.from(line.text.matchAll(ICD_CODE_PATTERN), (match) => match[1]);
    if (!matchesDiagnosis && codes.length === 0) {
      continue;
    }

    const rank: DiagnosisFact["rank"] =
      /\bprimary diagnosis\b/i.test(line.text)
        ? "primary"
        : /\b(?:secondary diagnosis|other diagnoses?)\b/i.test(line.text)
          ? "secondary"
          : undefined;

    const description = cleanDiagnosisDescription(line.text);
    if (codes.length === 0 && description) {
      const key = `${rank ?? "unknown"}|${description.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push({
          description: clipSnippet(description),
          rank,
          source: line.source,
          page: line.page,
        });
      }
      continue;
    }

    for (const code of codes) {
      const key = `${code}|${description.toLowerCase()}|${rank ?? "unknown"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      facts.push({
        code,
        description: clipSnippet(description || line.text),
        rank,
        source: line.source,
        page: line.page,
      });
    }
  }

  for (const document of extractedDocuments) {
    const possibleCodes = Array.isArray(document.metadata.possibleIcd10Codes)
      ? document.metadata.possibleIcd10Codes.map((entry) => normalizeWhitespace(String(entry)))
      : [];
    const source = buildSourceLabel(document);
    for (const code of possibleCodes) {
      if (!code) {
        continue;
      }
      const key = `${code}|metadata`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      facts.push({
        code,
        description: "Diagnosis code candidate from extracted document metadata",
        source,
      });
    }
  }

  return facts.slice(0, MAX_FACTS_PER_SECTION);
}

function parseMedicationLine(line: DocumentLine): MedicationFact | null {
  const normalized = normalizeWhitespace(line.text);
  if (!normalized) {
    return null;
  }

  const medicationCue =
    /\bmedications?\b/i.test(normalized) ||
    MEDICATION_DOSE_PATTERN.test(normalized) ||
    /\b(?:tab|tablet|capsule|insulin|warfarin|metformin|lasix|furosemide|lisinopril|aspirin|acetaminophen)\b/i.test(normalized);
  if (!medicationCue) {
    return null;
  }

  const cleaned = normalized
    .replace(/\bmedications?\b[:\-]?/i, "")
    .replace(/\b(?:continue|current|scheduled|prn)\b[:\-]?/i, "")
    .trim();
  if (!cleaned) {
    return null;
  }

  const dose = cleaned.match(MEDICATION_DOSE_PATTERN)?.[0];
  const route = cleaned.match(MEDICATION_ROUTE_PATTERN)?.[0];
  const frequency = cleaned.match(MEDICATION_FREQUENCY_PATTERN)?.[0];
  const name = normalizeWhitespace(
    cleaned
      .replace(MEDICATION_DOSE_PATTERN, " ")
      .replace(MEDICATION_ROUTE_PATTERN, " ")
      .replace(MEDICATION_FREQUENCY_PATTERN, " ")
      .replace(/\b(?:take|give|apply|inject)\b/gi, " ")
      .replace(/\s+/g, " "),
  );

  if (!name || name.length < 2) {
    return null;
  }

  return {
    name: clipSnippet(name),
    dose: dose ? normalizeWhitespace(dose) : undefined,
    route: route ? normalizeWhitespace(route) : undefined,
    frequency: frequency ? normalizeWhitespace(frequency) : undefined,
    source: line.source,
    page: line.page,
  };
}

function extractMedicationFacts(lines: DocumentLine[]): MedicationFact[] {
  const facts: MedicationFact[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const medication = parseMedicationLine(line);
    if (!medication) {
      continue;
    }
    const key = [
      medication.name.toLowerCase(),
      medication.dose?.toLowerCase() ?? "",
      medication.route?.toLowerCase() ?? "",
      medication.frequency?.toLowerCase() ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    facts.push(medication);
  }

  return facts.slice(0, MAX_FACTS_PER_SECTION);
}

function extractAllergies(lines: DocumentLine[]): string[] {
  const allergies: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!ALLERGY_PATTERN.test(line.text)) {
      continue;
    }
    const normalized = normalizeWhitespace(
      line.text
        .replace(/\ballerg(?:y|ies)\b[:\-]?/gi, "")
        .replace(/\bnkda\b/gi, "No known drug allergies")
        .replace(/\bnka\b/gi, "No known allergies")
        .replace(/\s+/g, " "),
    );
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    allergies.push(clipSnippet(normalized));
  }

  return allergies.slice(0, MAX_FACTS_PER_SECTION);
}

function collectEvidence(
  lines: DocumentLine[],
  field: string,
  pattern: RegExp,
  consumedLineKeys: Set<string>,
): FactSnippet[] {
  const snippets: FactSnippet[] = [];

  for (const line of lines) {
    if (!pattern.test(line.text)) {
      continue;
    }
    if (consumedLineKeys.has(line.lineKey)) {
      continue;
    }
    consumedLineKeys.add(line.lineKey);
    snippets.push(buildSnippet(field, line));
    if (snippets.length >= MAX_FACTS_PER_SECTION) {
      break;
    }
  }

  return snippets;
}

function collectAssessmentValues(lines: DocumentLine[], consumedLineKeys: Set<string>): FactSnippet[] {
  const snippets: FactSnippet[] = [];

  for (const line of lines) {
    const hasStructuredValue =
      ASSESSMENT_PATTERN.test(line.text) ||
      /\b\d{1,3}\/10\b/.test(line.text) ||
      /\b(?:yes|no)\b/i.test(line.text) ||
      /\bM\d{4}\b/i.test(line.text);
    if (!hasStructuredValue) {
      continue;
    }
    if (consumedLineKeys.has(line.lineKey)) {
      continue;
    }
    consumedLineKeys.add(line.lineKey);
    snippets.push(buildSnippet("assessment_value", line));
    if (snippets.length >= MAX_FACTS_PER_SECTION) {
      break;
    }
  }

  return snippets;
}

function collectUncategorizedEvidence(lines: DocumentLine[], consumedLineKeys: Set<string>): FactSnippet[] {
  const snippets: FactSnippet[] = [];
  for (const line of lines) {
    if (consumedLineKeys.has(line.lineKey)) {
      continue;
    }
    if (!UNCAT_CLINICAL_PATTERN.test(line.text)) {
      continue;
    }
    consumedLineKeys.add(line.lineKey);
    snippets.push(buildSnippet("clinical_evidence", line));
    if (snippets.length >= MAX_FACTS_PER_SECTION) {
      break;
    }
  }
  return snippets;
}

function buildPackedCharacters(pack: Omit<DocumentFactPack, "stats">): number {
  const content = [
    ...pack.diagnoses.flatMap((diagnosis) => [
      diagnosis.code ?? "",
      diagnosis.description,
    ]),
    ...pack.medications.flatMap((medication) => [
      medication.name,
      medication.dose ?? "",
      medication.route ?? "",
      medication.frequency ?? "",
    ]),
    ...pack.allergies,
    ...pack.homeboundEvidence.map((snippet) => snippet.text),
    ...pack.skilledNeedEvidence.map((snippet) => snippet.text),
    ...pack.hospitalizationReasons.map((snippet) => snippet.text),
    ...pack.assessmentValues.map((snippet) => snippet.text),
    ...pack.uncategorizedEvidence.map((snippet) => snippet.text),
  ];

  return content.join("\n").length;
}

function buildStats(rawCharacters: number, packedCharacters: number) {
  const reductionPercent = rawCharacters > 0
    ? Number((((rawCharacters - packedCharacters) / rawCharacters) * 100).toFixed(1))
    : 0;
  return {
    rawCharacters,
    packedCharacters,
    reductionPercent,
  };
}

export function buildDocumentFactPack(extractedDocuments: ExtractedDocument[]): DocumentFactPack {
  const relevantDocuments = extractedDocuments.filter((document) =>
    document.type === "OASIS" ||
    document.type === "ORDER" ||
    document.type === "POC" ||
    document.type === "VISIT_NOTE");
  const rawCharacters = relevantDocuments.reduce((total, document) => total + document.text.length, 0);
  const lines = buildDocumentLines(relevantDocuments);
  const consumedLineKeys = new Set<string>();

  const diagnoses = extractDiagnosisFacts(lines, relevantDocuments);
  const medications = extractMedicationFacts(lines);
  const allergies = extractAllergies(lines);
  const homeboundEvidence = collectEvidence(lines, "homebound", HOMEBOUND_PATTERN, consumedLineKeys);
  const skilledNeedEvidence = collectEvidence(lines, "skilled_need", SKILLED_NEED_PATTERN, consumedLineKeys);
  const hospitalizationReasons = collectEvidence(
    lines,
    "hospitalization_reason",
    HOSPITALIZATION_PATTERN,
    consumedLineKeys,
  );
  const assessmentValues = collectAssessmentValues(lines, consumedLineKeys);
  const uncategorizedEvidence = collectUncategorizedEvidence(lines, consumedLineKeys);

  const packWithoutStats = {
    documentType: "oasis" as const,
    diagnoses,
    medications,
    allergies,
    homeboundEvidence,
    skilledNeedEvidence,
    hospitalizationReasons,
    assessmentValues,
    uncategorizedEvidence,
  };

  return {
    ...packWithoutStats,
    stats: buildStats(rawCharacters, buildPackedCharacters(packWithoutStats)),
  };
}

export async function writeDocumentFactPackFile(input: {
  outputDirectory: string;
  patientId: string;
  batchId: string;
  factPack: DocumentFactPack;
}): Promise<DocumentFactPackExportResult> {
  const patientDirectory = join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = join(patientDirectory, "document-fact-pack.json");
  const document: DocumentFactPackFile = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    patientId: input.patientId,
    batchId: input.batchId,
    factPack: input.factPack,
  };
  await writeFile(filePath, JSON.stringify(document, null, 2), "utf8");

  return {
    filePath,
    document,
  };
}
