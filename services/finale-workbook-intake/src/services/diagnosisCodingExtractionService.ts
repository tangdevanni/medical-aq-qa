import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { FinaleBatchEnv } from "../config/env";
import {
  getEffectiveTextSource,
  type EffectiveTextSource,
  type ExtractedDocument,
} from "./documentExtractionService";

export type CanonicalDiagnosisCodePair = {
  diagnosis: string;
  code: string | null;
  code_source: string | null;
};

type PartialOasisDiagnosisEntry = Partial<{
  code: unknown;
  description: unknown;
  confidence: unknown;
}>;

export type CanonicalDiagnosisExtraction = {
  reason_for_admission: string | null;
  diagnosis_phrases: string[];
  diagnosis_code_pairs: CanonicalDiagnosisCodePair[];
  icd10_codes_found_verbatim: string[];
  ordered_services: string[];
  clinical_summary: string | null;
  source_quotes: string[];
  uncertain_items: string[];
  document_type: string | null;
  extraction_confidence: "low" | "medium" | "high";
};

export type DiagnosisCodingExtractionResult = {
  sourceDocumentCount: number;
  sourceCharacterCount: number;
  diagnosisMentions: string[];
  icd10Codes: string[];
  codeCategories: string[];
  canonical: CanonicalDiagnosisExtraction;
  llmUsed: boolean;
  llmModel: string | null;
  llmError: string | null;
  evidence: string[];
};

type LoggerLike = {
  info?: (obj: Record<string, unknown>, msg: string) => void;
};

type BedrockCodingExtractionResult = {
  canonical: CanonicalDiagnosisExtraction | null;
  model: string | null;
  error: string | null;
};

type PartialCanonical = Partial<{
  reason_for_admission: unknown;
  diagnosis_phrases: unknown;
  diagnosis_code_pairs: unknown;
  icd10_codes_found_verbatim: unknown;
  ordered_services: unknown;
  clinical_summary: unknown;
  source_quotes: unknown;
  uncertain_items: unknown;
  document_type: unknown;
  extraction_confidence: unknown;
  primaryDiagnosis: PartialOasisDiagnosisEntry | null;
  otherDiagnoses: unknown;
  suggestedOnsetType: unknown;
  suggestedSeverity: unknown;
  comorbidityFlags: unknown;
  notes: unknown;
}>;

const ICD10_REGEX = /\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\b/g;
const ICD10_EXACT_REGEX = /^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/;

const JUNK_ARTIFACT_PATTERNS = [
  /caching metrics?/i,
  /\bpaperclip\b/i,
  /\btrace\b/i,
  /\bng-star-inserted\b/i,
  /\btable tbody tr\b/i,
  /\ba\.tbl-link\b/i,
  /\bscrollintoviewifneeded\b/i,
  /\bdropdown active diagnoses\b/i,
  /\bhttps?:\/\//i,
  /\bclickreadonlytarget\b/i,
  /\bselector\b/i,
  /\bpostclickurl\b/i,
];

const GENERIC_EMPTY_PATTERNS = [/^(none|null|n\/a|na|unknown|not available|undefined)$/i];

const DIAGNOSIS_NOISE_PATTERNS = [
  /\bicd-?10(?:-cm)?\b.*\b(onset|date|description|severity|column)\b/i,
  /\bcode each row\b/i,
  /\bcolumn\s+\d+\b/i,
  /\bcheck all that apply\b/i,
  /\bguidance manual\b/i,
  /\bdo not assign\b/i,
  /\bexternal cause codes?\b/i,
  /\bsymptom control\b/i,
  /\blevel of highest specificity\b/i,
  /\bprocedure codes?\b/i,
  /\bno surgical or procedure codes\b/i,
  /\bchoose one value\b/i,
  /\bclinical group\b/i,
  /\bcomorbidity group\b/i,
  /\bother diagnosis\bW*\d*/i,
  /\bsequencing requirements?\b/i,
  /\bcode(s)? must be entered\b/i,
  /\bdo not infer\b/i,
  /\btrue\s+false\b/i,
];

const DIAGNOSIS_SIGNAL_PATTERNS = [
  /\bdiagnos(?:is|es)\b/i,
  /\bhypertension\b/i,
  /\bdiabetes\b/i,
  /\bpneumonia\b/i,
  /\brespiratory failure\b/i,
  /\bperipheral vascular disease\b/i,
  /\bperipheral arterial disease\b/i,
  /\bchronic kidney disease\b/i,
  /\bcoronary artery disease\b/i,
  /\bcongestive heart failure\b/i,
  /\bheart failure\b/i,
  /\batrial fibrillation\b/i,
  /\bcopd\b/i,
  /\bchf\b/i,
  /\bckd\b/i,
  /\bdementia\b/i,
  /\bstroke\b/i,
  /\bcva\b/i,
  /\bparkinson/i,
  /\bulcer\b/i,
  /\bneuropathy\b/i,
  /\bpain\b/i,
  /\bpvd\b/i,
  /\bpad\b/i,
  /\brenal\b/i,
  /\bdysphagia\b/i,
  /\bencephalopathy\b/i,
  /\bhypothyroid/i,
  /\bmelena\b/i,
  /\bdecondition/i,
  /\binfection\b/i,
  /\bweakness\b/i,
];

const DIAGNOSIS_ACTION_NOISE_PATTERNS = [
  /\bintervention(?:s)?\b/i,
  /\bmedication teaching\b/i,
  /\bdocumentation supports\b/i,
  /\bskilled need\b/i,
  /\bprovided\b/i,
  /\brequires assistance\b/i,
  /\bplan of care diagnosis list includes\b/i,
  /\bremains consistent\b/i,
];

const DIAGNOSIS_ACRONYMS = new Set([
  "CHF",
  "COPD",
  "CKD",
  "CAD",
  "PVD",
  "PAD",
  "DM",
  "CVA",
  "UTI",
]);

const EXPLICIT_DIAGNOSIS_PATTERNS = [
  /\bpneumonia\b/gi,
  /\bmultifocal pneumonia\b/gi,
  /\bacute respiratory failure(?: with hypoxia)?\b/gi,
  /\bperipheral vascular disease\b/gi,
  /\bperipheral arterial disease\b/gi,
  /\bdiabetes mellitus\b/gi,
  /\bhypertension\b/gi,
  /\bhypertensive heart disease with heart failure\b/gi,
  /\bheart failure\b/gi,
  /\bcongestive heart failure\b/gi,
  /\bacute on chronic (?:diastolic )?(?:congestive )?heart failure\b/gi,
  /\bchronic obstructive pulmonary disease\b/gi,
  /\bchronic kidney disease\b/gi,
  /\bcoronary artery disease\b/gi,
  /\batrial fibrillation\b/gi,
  /\bchronic atrial fibrillation\b/gi,
  /\bwound infection\b/gi,
  /\bulcer\b/gi,
  /\bneuropathy\b/gi,
  /\binfection\b/gi,
  /\bsepsis\b/gi,
  /\bdysphagia\b/gi,
  /\bencephalopathy\b/gi,
  /\bmetabolic encephalopathy\b/gi,
  /\bhypothyroidism\b/gi,
  /\bmelena\b/gi,
  /\bgeneralized weakness\b/gi,
  /\bmuscle weakness\b/gi,
  /\banemia\b/gi,
];

const SERVICE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Skilled Nursing", pattern: /\bskilled nursing\b|\bSN\b/i },
  { label: "Physical Therapy", pattern: /\bphysical therapy\b|\bPT\b/i },
  { label: "Occupational Therapy", pattern: /\boccupational therapy\b|\bOT\b/i },
  { label: "Speech Therapy", pattern: /\bspeech therapy\b|\bST\b/i },
  { label: "Medical Social Worker", pattern: /\bmedical social worker\b|\bMSW\b/i },
  { label: "Home Health Aide", pattern: /\bhome health aide\b|\bHHA\b/i },
];

const BEDROCK_SYSTEM_PROMPT = [
  "You are a clinical coding assistant specialized in OASIS SOC documentation and ICD-10 coding.",
  "You will be given OCR-extracted clinical text from referral/admission documents.",
  "Extract diagnoses EXACTLY in this strict JSON shape and return JSON only:",
  "{",
  '  "primaryDiagnosis": { "code": string, "description": string, "confidence": "high" | "medium" | "low" },',
  '  "otherDiagnoses": [{ "code": string, "description": string, "confidence": "high" | "medium" | "low" }],',
  '  "suggestedOnsetType": "onset" | "exacerbate",',
  '  "suggestedSeverity": 0 | 1 | 2 | 3 | 4,',
  '  "comorbidityFlags": { "pvd_pad": boolean, "diabetes": boolean, "none": boolean },',
  '  "notes": string[]',
  "}",
  "Rules:",
  "- Only extract clinically relevant diagnoses.",
  "- Prioritize conditions that justify home health services.",
  "- Identify one PRIMARY diagnosis and then OTHER diagnoses.",
  "- Use ICD-10 codes when explicitly present or strongly inferable from the text. If unsure, leave code as an empty string and lower confidence.",
  "- Ignore fax headers, facility metadata, repeated admin text, and non-clinical content.",
  "- Do not hallucinate diagnoses or codes.",
  "- suggestedOnsetType and suggestedSeverity should be conservative defaults unless clearly supported.",
  "- notes should be short and only capture real ambiguity or rationale.",
  "- Do not include extra keys.",
].join(" ");

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function effectiveTextSourceRank(source: EffectiveTextSource): number {
  switch (source) {
    case "ocr_text":
      return 0;
    case "digital_pdf_text":
      return 1;
    case "viewer_text_fallback":
      return 2;
    case "raw_pdf_fallback":
      return 3;
    default:
      return 4;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value
      .toLowerCase()
      .replace(/[.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function summarizeCodingSourceDocument(document: ExtractedDocument, index: number): string {
  const effectiveTextSource = getEffectiveTextSource(document);
  return [
    `[${index}]`,
    `type=${document.type}`,
    `effectiveTextSource=${effectiveTextSource}`,
    `source=${document.metadata.source ?? "artifact_fallback"}`,
    `textLength=${document.metadata.textLength ?? document.text.length}`,
    `pdfType=${document.metadata.pdfType ?? "none"}`,
    `ocrSuccess=${document.metadata.ocrSuccess ?? false}`,
    `ocrTextLength=${document.metadata.ocrTextLength ?? 0}`,
  ].join(" ");
}

function sanitizeFreeText(value: unknown): string {
  const text = normalizeWhitespace(typeof value === "string" ? value : String(value ?? ""));
  if (!text) {
    return "";
  }
  if (GENERIC_EMPTY_PATTERNS.some((pattern) => pattern.test(text))) {
    return "";
  }
  if (JUNK_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text))) {
    return "";
  }
  return normalizeWhitespace(
    text
      .replace(/[`*_>#]/g, " ")
      .replace(/\s+/g, " "),
  );
}

function sanitizeSourceTextForCoding(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }

  const stripped = normalizeWhitespace(
    normalized
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\b(?:table|tbody|thead|tr|td|th)\b/gi, " ")
      .replace(/\b(?:click|selector|locator|postclickurl|urlafter|urlbefore)\b/gi, " ")
      .replace(/\b(?:true|false)\b/gi, " ")
      .replace(/[^\x20-\x7E]+/g, " "),
  );

  return normalizeWhitespace(stripped);
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  const normalized = sanitizeFreeText(value).toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "low";
}

function extractRegexSections(
  text: string,
  patterns: Array<{ label: string; pattern: RegExp }>,
): string[] {
  const sections: string[] = [];
  for (const { label, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const section = sanitizeFreeText(match[1] ?? "");
      if (!section) {
        continue;
      }
      sections.push(`${label}: ${section}`);
    }
  }
  return sections;
}

function normalizeDiagnosisCandidate(value: string): string {
  return normalizeDiagnosisPhrase(
    sanitizeFreeText(value)
      .replace(/^[A-Z0-9.]+\),\s*/g, " ")
      .replace(/\(\s*[A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\s*\)/gi, " ")
      .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, " ")
      .replace(/\b(?:Primary|Other)\b/g, " ")
      .replace(/\b(?:Page|Fax Server|Facility|Physician|Pharmacy|Resident|Date|Time)\b.*$/i, " ")
      .replace(/\s+/g, " "),
  );
}

function buildDiagnosisCodePair(input: {
  diagnosis: string;
  code?: string | null;
  codeSource?: string | null;
}): CanonicalDiagnosisCodePair | null {
  const diagnosis = normalizeDiagnosisCandidate(input.diagnosis);
  if (!isMeaningfulDiagnosisCandidate(diagnosis)) {
    return null;
  }
  return {
    diagnosis,
    code: normalizeIcdCode(input.code ?? null),
    code_source: sanitizeFreeText(input.codeSource) || null,
  };
}

function isMeaningfulDiagnosisCandidate(value: string): boolean {
  const normalized = normalizeDiagnosisCandidate(value);
  if (!normalized) {
    return false;
  }
  if (normalized.length < 4 || normalized.length > 140) {
    return false;
  }
  if (isDiagnosisInstructionalNoise(normalized)) {
    return false;
  }
  if (/\b(?:page|fax server|facility code|resident information|payer information)\b/i.test(normalized)) {
    return false;
  }
  const alphaCharacters = normalized.replace(/[^A-Za-z]/g, "").length;
  if (alphaCharacters < 4) {
    return false;
  }
  return hasDiagnosisSignal(normalized) || extractExplicitDiagnosisMentions(normalized).length > 0;
}

function extractDiagnosesFromCodePrefixedText(text: string): string[] {
  const normalized = sanitizeSourceTextForCoding(text);
  if (!normalized) {
    return [];
  }

  const matches = Array.from(
    normalized.matchAll(
      /\b(?:[A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\s+([A-Z][A-Za-z0-9 ,()'\/-]{3,}?)(?=\s+(?:\d{2}\/\d{2}\/\d{4}\b|Primary\b|Other\b|\b[A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\b|$))/g,
    ),
  );

  return uniqueCaseInsensitive(
    matches
      .map((match) => normalizeDiagnosisCandidate(match[1] ?? ""))
      .filter(isMeaningfulDiagnosisCandidate),
  );
}

function extractDiagnosisCodePairsFromCodePrefixedText(text: string): CanonicalDiagnosisCodePair[] {
  const normalized = sanitizeSourceTextForCoding(text);
  if (!normalized) {
    return [];
  }

  const matches = Array.from(
    normalized.matchAll(
      /\b([A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\s+([A-Z][A-Za-z0-9 ,()'\/-]{3,}?)(?=\s+(?:\d{2}\/\d{2}\/\d{4}\b|Primary\b|Other\b|\b[A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\b|$))/g,
    ),
  );

  return uniqueCaseInsensitive(
    matches
      .map((match) => buildDiagnosisCodePair({
        code: match[1] ?? null,
        diagnosis: match[2] ?? "",
        codeSource: "ocr_text_explicit",
      }))
      .filter((pair): pair is CanonicalDiagnosisCodePair => Boolean(pair))
      .map((pair) => `${pair.diagnosis}|${pair.code ?? ""}|${pair.code_source ?? ""}`),
  ).map((entry) => {
    const [diagnosis, code, codeSource] = entry.split("|");
    return {
      diagnosis,
      code: code || null,
      code_source: codeSource || null,
    };
  });
}

function extractDiagnosesFromParenthesizedList(text: string): string[] {
  const normalized = sanitizeSourceTextForCoding(text);
  if (!normalized) {
    return [];
  }

  const matches = Array.from(
    normalized.matchAll(
      /(?:^|[,;:]\s+)([A-Z][A-Za-z0-9 ,()'\/-]{3,}?)(?=\s*\((?:[A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\))/g,
    ),
  );

  return uniqueCaseInsensitive(
    matches
      .map((match) => normalizeDiagnosisCandidate(match[1] ?? ""))
      .filter(isMeaningfulDiagnosisCandidate),
  );
}

function extractDiagnosisCodePairsFromParenthesizedList(text: string): CanonicalDiagnosisCodePair[] {
  const normalized = sanitizeSourceTextForCoding(text);
  if (!normalized) {
    return [];
  }

  const matches = Array.from(
    normalized.matchAll(
      /(?:^|[,;:]\s+)([A-Z][A-Za-z0-9 ,()'\/-]{3,}?)(?=\s*\(([A-Z1][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?)\))/g,
    ),
  );

  return uniqueCaseInsensitive(
    matches
      .map((match) => buildDiagnosisCodePair({
        diagnosis: match[1] ?? "",
        code: match[2] ?? null,
        codeSource: "ocr_text_explicit",
      }))
      .filter((pair): pair is CanonicalDiagnosisCodePair => Boolean(pair))
      .map((pair) => `${pair.diagnosis}|${pair.code ?? ""}|${pair.code_source ?? ""}`),
  ).map((entry) => {
    const [diagnosis, code, codeSource] = entry.split("|");
    return {
      diagnosis,
      code: code || null,
      code_source: codeSource || null,
    };
  });
}

function extractExplicitDiagnosisCodePairs(text: string): CanonicalDiagnosisCodePair[] {
  const pairs = [
    ...extractDiagnosisCodePairsFromParenthesizedList(text),
    ...extractDiagnosisCodePairsFromCodePrefixedText(text),
  ];
  const seen = new Set<string>();
  const deduped: CanonicalDiagnosisCodePair[] = [];
  for (const pair of pairs) {
    const key = `${pair.diagnosis.toLowerCase()}|${pair.code ?? ""}|${pair.code_source ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(pair);
  }
  return deduped;
}

function extractStructuredDiagnosisEntries(value: unknown): Array<{
  diagnosis: string;
  code: string | null;
  confidence: "high" | "medium" | "low";
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const diagnosis = normalizeDiagnosisCandidate(
      sanitizeFreeText((entry as PartialOasisDiagnosisEntry).description),
    );
    if (!isMeaningfulDiagnosisCandidate(diagnosis)) {
      return [];
    }
    return [{
      diagnosis,
      code: normalizeIcdCode(sanitizeFreeText((entry as PartialOasisDiagnosisEntry).code)) ?? null,
      confidence: normalizeConfidence((entry as PartialOasisDiagnosisEntry).confidence),
    }];
  });
}

function extractClinicalSectionsForCoding(document: ExtractedDocument): string[] {
  const text = sanitizeSourceTextForCoding(normalizeWhitespace(document.text));
  if (!text) {
    return [];
  }

  const labeledSections = extractRegexSections(text, [
    {
      label: "Order Summary",
      pattern:
        /Order Summary:\s*([\s\S]{20,600}?)(?:Confirmed By:|Ordered By Signature:|Signed Date:|Page \d+ of \d+|$)/gi,
    },
    {
      label: "Diagnoses",
      pattern:
        /Diagnoses?:\s*([\s\S]{20,1600}?)(?:Allergies:?|Order Communication|Effective Date:|Page \d+ of \d+|$)/gi,
    },
    {
      label: "Diagnosis Information",
      pattern:
        /DIAGNOSIS INFORMATION\s*([\s\S]{20,1600}?)(?:ADVANCE DIRECTIVE|MISCELLANEOUS INFORMATION|Page \d+ of \d+|$)/gi,
    },
    {
      label: "Reason For Admission",
      pattern:
        /Reason for admission\s*[:\-]?\s*([\s\S]{5,300}?)(?:Diagnos(?:is|es)|Plan:|Page \d+ of \d+|$)/gi,
    },
    {
      label: "Note Text",
      pattern:
        /Note Text:\s*([\s\S]{20,1800}?)(?:Author:|Original Signature:|Page \d+ of \d+|$)/gi,
    },
    {
      label: "Assessment",
      pattern:
        /Assessment:\s*([\s\S]{10,900}?)(?:Plan:|Page \d+ of \d+|$)/gi,
    },
    {
      label: "Past Medical History",
      pattern:
        /Past medical history\s*([\s\S]{10,500}?)(?:Physical examination|Assessment:|Plan:|Page \d+ of \d+|$)/gi,
    },
  ]);

  const extractedDiagnoses = uniqueCaseInsensitive([
    ...extractDiagnosesFromParenthesizedList(text),
    ...extractDiagnosesFromCodePrefixedText(text),
    ...extractExplicitDiagnosisMentions(text),
  ]);

  const diagnosisSection = extractedDiagnoses.length > 0
    ? [`Clinical Diagnoses: ${extractedDiagnoses.join("; ")}`]
    : [];

  return uniqueCaseInsensitive(
    [...labeledSections, ...diagnosisSection]
      .map((section) => sanitizeFreeText(section))
      .filter(Boolean),
  );
}

function isDiagnosisInstructionalNoise(text: string): boolean {
  if (!text) {
    return true;
  }
  if (JUNK_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (DIAGNOSIS_NOISE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return false;
}

function hasDiagnosisSignal(text: string): boolean {
  return DIAGNOSIS_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function isDiagnosisAcronymOnly(text: string): boolean {
  const normalized = sanitizeFreeText(text).toUpperCase();
  return DIAGNOSIS_ACRONYMS.has(normalized);
}

function extractExplicitDiagnosisMentions(text: string): string[] {
  const normalized = sanitizeFreeText(text);
  if (!normalized) {
    return [];
  }

  const mentions: string[] = [];
  for (const pattern of EXPLICIT_DIAGNOSIS_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      const value = sanitizeFreeText(match[0]);
      if (value) {
        mentions.push(value);
      }
    }
  }
  for (const acronym of DIAGNOSIS_ACRONYMS) {
    const regex = new RegExp(`\\b${acronym}\\b`, "i");
    if (regex.test(normalized)) {
      mentions.push(acronym);
    }
  }

  return uniqueCaseInsensitive(mentions);
}

function isLikelyDiagnosisPhrase(text: string): boolean {
  const normalized = sanitizeFreeText(text);
  if (!normalized) {
    return false;
  }
  if (isDiagnosisAcronymOnly(normalized)) {
    return true;
  }
  if (normalized.length < 3 || normalized.length > 160) {
    return false;
  }
  if (isDiagnosisInstructionalNoise(normalized)) {
    return false;
  }
  if (DIAGNOSIS_ACTION_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const explicitMentions = extractExplicitDiagnosisMentions(normalized);
    if (explicitMentions.length === 0) {
      return false;
    }
  }

  const alphaChars = normalized.replace(/[^A-Za-z]/g, "").length;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  if (tokenCount < 2 || alphaChars < 6) {
    return false;
  }

  const hasDigitsOnlyNoise = /^[^A-Za-z]*[0-9 ().\-]+[^A-Za-z]*$/.test(normalized);
  if (hasDigitsOnlyNoise) {
    return false;
  }

  if (!hasDiagnosisSignal(normalized) && !/\([A-Z]{2,6}\)/.test(normalized)) {
    return false;
  }

  return true;
}

function normalizeDiagnosisPhrase(value: string): string {
  return sanitizeFreeText(value)
    .replace(/^(?:primary|secondary|admitting)\s+diagnosis(?:es)?\s*[:\-]\s*/i, "")
    .replace(/^diagnosis(?:es)?\s*[:\-]\s*/i, "")
    .replace(/^reason for admission\s*[:\-]\s*/i, "")
    .replace(/\b(?:primary|secondary|admitting)\s+diagnosis(?:es)?\s*[:\-]\s*/gi, " ")
    .replace(/\bdiagnosis(?:es)?\s*[:\-]\s*/gi, " ")
    .replace(/[.]{2,}/g, ".")
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
    .trim();
}

function normalizeReasonForAdmission(value: unknown): string | null {
  const normalized = sanitizeFreeText(value);
  if (!normalized) {
    return null;
  }
  if (isDiagnosisInstructionalNoise(normalized)) {
    return null;
  }
  const reasonSignals = /\b(admit|admission|homebound|due to|because|referred for|reason)\b/i.test(normalized);
  if (!reasonSignals) {
    return null;
  }
  if (DIAGNOSIS_ACTION_NOISE_PATTERNS.some((pattern) => pattern.test(normalized)) && !/\b(due to|because|admission)\b/i.test(normalized)) {
    return null;
  }
  return normalized.slice(0, 180);
}

function isLikelySuspicious(text: string): boolean {
  if (!text) {
    return true;
  }
  if (GENERIC_EMPTY_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (JUNK_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return false;
}

function splitDiagnosisString(value: string): string[] {
  const normalized = sanitizeSourceTextForCoding(sanitizeFreeText(value));
  if (!normalized) {
    return [];
  }

  let parts = [normalized];
  const separators = [
    /\s*;\s*/g,
    /\s*\|\s*/g,
    /\n+/g,
    /\s*\/\s*/g,
    /\b(?:primary|secondary|admitting)\s+diagnosis(?:es)?\s*[:\-]\s*/gi,
    /\bdiagnosis(?:es)?\s*[:\-]\s*/gi,
  ];
  for (const separator of separators) {
    parts = parts.flatMap((part) => part.split(separator));
  }

  const maybeSplitOnAnd = parts.flatMap((part) => {
    if (!/\band\b/i.test(part)) {
      return [part];
    }
    return part.split(/\s+(?:and|&)\s+/i);
  });

  const normalizedParts = maybeSplitOnAnd
    .map((part) => normalizeDiagnosisPhrase(part))
    .filter((part) => !isLikelySuspicious(part));
  const explicitMentions = normalizedParts.flatMap((part) => extractExplicitDiagnosisMentions(part));
  const baseCandidates = normalizedParts.filter(
    (part) => !DIAGNOSIS_ACTION_NOISE_PATTERNS.some((pattern) => pattern.test(part)),
  );

  return uniqueCaseInsensitive(
    [...baseCandidates, ...explicitMentions]
      .filter((part) => isLikelyDiagnosisPhrase(part)),
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFreeText(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    const cleaned = sanitizeFreeText(value);
    return cleaned ? [cleaned] : [];
  }
  return [];
}

function normalizeIcdCode(value: unknown): string | null {
  const normalized = sanitizeFreeText(value).toUpperCase().replace(/[,;:.]+$/g, "");
  if (!normalized) {
    return null;
  }
  return ICD10_EXACT_REGEX.test(normalized) ? normalized : null;
}

function extractPossibleIcd10Codes(text: string): string[] {
  const normalized = normalizeWhitespace(text).toUpperCase();
  if (!normalized) {
    return [];
  }
  return unique(normalized.match(ICD10_REGEX) ?? []);
}

function extractDeterministicDiagnosisPhrases(text: string): string[] {
  const normalized = sanitizeSourceTextForCoding(normalizeWhitespace(text));
  if (!normalized) {
    return [];
  }

  const targetedDiagnoses = uniqueCaseInsensitive([
    ...extractDiagnosesFromParenthesizedList(normalized),
    ...extractDiagnosesFromCodePrefixedText(normalized),
    ...extractExplicitDiagnosisMentions(normalized),
  ]);

  const snippets: string[] = [];
  const patterns = [
    /order summary\s*[:\-]\s*([^\n]{4,260})/gi,
    /reason for admission\s*[:\-]\s*([^\n.;]{4,180})/gi,
    /admitting diagnosis(?:es)?\s*[:\-]\s*([^\n.;]{4,180})/gi,
    /primary diagnosis(?:es)?\s*[:\-]\s*([^\n.;]{4,180})/gi,
    /secondary diagnosis(?:es)?\s*[:\-]\s*([^\n.;]{4,180})/gi,
    /\bdiagnosis(?:es)?\s*[:\-]\s*([^\n.;]{4,180})/gi,
    /\b(?:dx)\s*[:\-]\s*([^\n.;]{4,180})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const value = sanitizeFreeText(match[1]);
      if (value.length > 3 && !isDiagnosisInstructionalNoise(value)) {
        snippets.push(...splitDiagnosisString(value));
      }
    }
  }

  const lineCandidates = normalized
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((line) => sanitizeFreeText(line))
    .filter(Boolean)
    .filter((line) => !isDiagnosisInstructionalNoise(line))
    .filter((line) => hasDiagnosisSignal(line))
    .flatMap((line) => splitDiagnosisString(line));

  if (targetedDiagnoses.length >= 3) {
    return targetedDiagnoses.slice(0, 40);
  }

  return uniqueCaseInsensitive([...targetedDiagnoses, ...snippets, ...lineCandidates]).slice(0, 40);
}

function extractReasonForAdmission(text: string): string | null {
  const normalized = sanitizeSourceTextForCoding(normalizeWhitespace(text));
  if (!normalized) {
    return null;
  }
  const patterns = [
    /order summary\s*[:\-]?\s*([^.]{5,260})/i,
    /reason for admission\s*[:\-]?\s*([^.]{5,260})/i,
    /admitted (?:for|due to)\s*([^.]{5,220})/i,
    /admitting diagnosis\s*[:\-]?\s*([^.]{5,260})/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const value = sanitizeFreeText(match[1]);
      if (value && !isDiagnosisInstructionalNoise(value) && value.length <= 180) {
        return normalizeReasonForAdmission(value);
      }
    }
  }

  const fallbackSentence = normalized
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((entry) => sanitizeFreeText(entry))
    .find((entry) =>
      Boolean(entry) &&
      !isDiagnosisInstructionalNoise(entry) &&
      /\b(admit|admission|reason)\b/i.test(entry),
    );
  if (fallbackSentence) {
    return normalizeReasonForAdmission(fallbackSentence.slice(0, 180));
  }
  return null;
}

function extractOrderedServices(text: string): string[] {
  return uniqueCaseInsensitive(
    SERVICE_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label),
  );
}

function extractSourceQuotes(text: string): string[] {
  const normalized = sanitizeSourceTextForCoding(normalizeWhitespace(text));
  if (!normalized) {
    return [];
  }
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((entry) => sanitizeFreeText(entry))
    .filter(Boolean);

  const targeted = sentences.filter((sentence) =>
    /(admission|diagnosis|icd|dx|skilled nursing|therapy|reason)/i.test(sentence),
  );

  return uniqueCaseInsensitive(
    targeted
      .filter((sentence) => !isDiagnosisInstructionalNoise(sentence))
      .filter((sentence) => sentence.length >= 12)
      .slice(0, 10)
      .map((sentence) => sentence.slice(0, 320)),
  );
}

function extractClinicalSummary(text: string): string | null {
  const quotes = extractSourceQuotes(text);
  if (quotes.length === 0) {
    return null;
  }
  return normalizeWhitespace(quotes.slice(0, 2).join(" "));
}

function inferDocumentType(extractedDocuments: ExtractedDocument[]): string | null {
  if (extractedDocuments.some((document) => document.type === "ORDER")) {
    return "Admission Order";
  }
  if (extractedDocuments.some((document) => document.type === "OASIS")) {
    return "OASIS";
  }
  if (extractedDocuments.some((document) => document.type === "POC")) {
    return "Plan Of Care";
  }
  if (extractedDocuments.some((document) => document.type === "VISIT_NOTE")) {
    return "Visit Note";
  }
  return null;
}

function inferConfidence(input: {
  diagnosisCount: number;
  codeCount: number;
  quoteCount: number;
  llmSuccessful: boolean;
}): "low" | "medium" | "high" {
  const score =
    (input.diagnosisCount > 0 ? 1 : 0) +
    (input.codeCount > 0 ? 1 : 0) +
    (input.quoteCount > 0 ? 1 : 0) +
    (input.llmSuccessful ? 1 : 0);
  if (score >= 4 || (input.diagnosisCount >= 2 && input.codeCount >= 1 && input.llmSuccessful)) {
    return "high";
  }
  if (score >= 2) {
    return "medium";
  }
  return "low";
}

function selectDocumentsForCoding(extractedDocuments: ExtractedDocument[]): {
  selectedDocuments: ExtractedDocument[];
  evidence: string[];
} {
  const orderDocuments = extractedDocuments.filter((document) => document.type === "ORDER");
  const nonOrderDocuments = extractedDocuments.filter((document) => document.type !== "ORDER");
  const orderRanks = orderDocuments.map((document) => effectiveTextSourceRank(getEffectiveTextSource(document)));
  const bestOrderRank = orderRanks.length > 0 ? Math.min(...orderRanks) : null;
  const selectedOrderDocuments = bestOrderRank === null
    ? orderDocuments
    : orderDocuments.filter(
        (document) => effectiveTextSourceRank(getEffectiveTextSource(document)) === bestOrderRank,
      );

  const selectedDocuments = [...selectedOrderDocuments, ...nonOrderDocuments].sort((left, right) => {
    const leftTypePriority = left.type === "ORDER" ? 0 : left.type === "OASIS" ? 1 : 2;
    const rightTypePriority = right.type === "ORDER" ? 0 : right.type === "OASIS" ? 1 : 2;
    if (leftTypePriority !== rightTypePriority) {
      return leftTypePriority - rightTypePriority;
    }
    return effectiveTextSourceRank(getEffectiveTextSource(left)) -
      effectiveTextSourceRank(getEffectiveTextSource(right));
  });

  const evidence = [
    `availableDocumentCount:${extractedDocuments.length}`,
    `selectedDocumentCount:${selectedDocuments.length}`,
    `orderDocumentCount:${orderDocuments.length}`,
    `selectedOrderDocumentCount:${selectedOrderDocuments.length}`,
    `bestOrderEffectiveTextSource:${bestOrderRank === null ? "none" : getEffectiveTextSource(selectedOrderDocuments[0]!)}`,
    ...selectedDocuments.map((document, index) => summarizeCodingSourceDocument(document, index)),
  ];

  return {
    selectedDocuments,
    evidence,
  };
}

function mapIcdCategory(code: string): string {
  const chapter = code.toUpperCase().charAt(0);
  if (chapter >= "A" && chapter <= "B") return "Certain infectious and parasitic diseases";
  if (chapter === "C" || chapter === "D") return "Neoplasms / blood and immune disorders";
  if (chapter === "E") return "Endocrine, nutritional and metabolic diseases";
  if (chapter === "F") return "Mental and behavioural disorders";
  if (chapter === "G") return "Diseases of the nervous system";
  if (chapter === "H") return "Diseases of eye/ear";
  if (chapter === "I") return "Diseases of the circulatory system";
  if (chapter === "J") return "Diseases of the respiratory system";
  if (chapter === "K") return "Diseases of the digestive system";
  if (chapter === "L") return "Diseases of the skin and subcutaneous tissue";
  if (chapter === "M") return "Diseases of the musculoskeletal system and connective tissue";
  if (chapter === "N") return "Diseases of the genitourinary system";
  if (chapter === "O") return "Pregnancy, childbirth and the puerperium";
  if (chapter === "P") return "Certain conditions originating in the perinatal period";
  if (chapter === "Q") return "Congenital malformations and chromosomal abnormalities";
  if (chapter === "R") return "Symptoms, signs and abnormal findings";
  if (chapter === "S" || chapter === "T") return "Injury, poisoning and other consequences of external causes";
  if (chapter === "V" || chapter === "W" || chapter === "X" || chapter === "Y") return "External causes of morbidity";
  if (chapter === "Z") return "Factors influencing health status and contact with health services";
  return "Uncategorized";
}

function buildSourceText(extractedDocuments: ExtractedDocument[]): {
  sourceText: string;
  selectedDocuments: ExtractedDocument[];
  evidence: string[];
} {
  const selection = selectDocumentsForCoding(extractedDocuments);
  const prioritizedTexts = selection.selectedDocuments
    .flatMap((document) => {
      const clinicalSections = extractClinicalSectionsForCoding(document);
      if (clinicalSections.length > 0) {
        return clinicalSections;
      }
      return [sanitizeSourceTextForCoding(normalizeWhitespace(document.text))];
    })
    .filter(Boolean);

  const combined = prioritizedTexts.join("\n\n");
  if (!combined) {
    return {
      sourceText: "",
      selectedDocuments: selection.selectedDocuments,
      evidence: selection.evidence,
    };
  }

  const focusedSegments = combined
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((segment) => sanitizeFreeText(segment))
    .filter(Boolean)
    .filter((segment) => !isDiagnosisInstructionalNoise(segment))
    .filter((segment) =>
      hasDiagnosisSignal(segment) ||
      /\b(admission|admit|reason|ordered|service|icd|dx)\b/i.test(segment),
    );

  const source = focusedSegments.length > 0 ? focusedSegments.join(". ") : combined;
  return {
    sourceText: source.slice(0, 24_000),
    selectedDocuments: selection.selectedDocuments,
    evidence: selection.evidence,
  };
}

function getBedrockClient(region: string): BedrockRuntimeClient {
  const existing = bedrockClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function isBedrockCodingLlmEnabled(env: FinaleBatchEnv): boolean {
  return Boolean(env.CODE_LLM_ENABLED && env.LLM_PROVIDER === "bedrock");
}

function resolveBedrockConfig(env: FinaleBatchEnv): { region: string; modelId: string } {
  const region = normalizeWhitespace(env.BEDROCK_REGION);
  const modelId = normalizeWhitespace(env.BEDROCK_MODEL_ID);
  if (!region) {
    throw new Error("CODE_LLM_ENABLED=true requires BEDROCK_REGION when LLM_PROVIDER=bedrock.");
  }
  if (!modelId) {
    throw new Error("CODE_LLM_ENABLED=true requires BEDROCK_MODEL_ID when LLM_PROVIDER=bedrock.");
  }
  return { region, modelId };
}

function extractConverseText(response: ConverseCommandOutput): string {
  const blocks = response.output?.message?.content;
  if (!blocks) {
    return "";
  }
  const texts: string[] = [];
  for (const block of blocks) {
    if ("text" in block && typeof block.text === "string") {
      const value = normalizeWhitespace(block.text);
      if (value) {
        texts.push(value);
      }
    }
  }
  return normalizeWhitespace(texts.join("\n"));
}

function parseLlmJsonPayload(text: string): Record<string, unknown> | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return null;
  }

  const parseCandidate = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = parseCandidate(normalized);
  if (direct) {
    return direct;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  return parseCandidate(normalized.slice(firstBrace, lastBrace + 1));
}

function normalizeDiagnosisCodePairs(
  value: unknown,
  uncertainItems: string[],
): CanonicalDiagnosisCodePair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const pairs: CanonicalDiagnosisCodePair[] = [];
  for (const rawPair of value) {
    if (!rawPair || typeof rawPair !== "object") {
      uncertainItems.push(`diagnosis_code_pairs item ignored: ${sanitizeFreeText(rawPair) || "non-object"}`);
      continue;
    }
    const pair = rawPair as Record<string, unknown>;
    const diagnosisRaw = sanitizeFreeText(pair.diagnosis);
    const codeRaw = sanitizeFreeText(pair.code);
    const codeSourceRaw = sanitizeFreeText(pair.code_source);

    const diagnosisParts = splitDiagnosisString(diagnosisRaw);
    if (diagnosisParts.length === 0) {
      uncertainItems.push(`diagnosis_code_pairs diagnosis invalid: ${diagnosisRaw || "empty"}`);
      continue;
    }

    const code = codeRaw ? normalizeIcdCode(codeRaw) : null;
    if (codeRaw && !code) {
      uncertainItems.push(`malformed_icd_code:${codeRaw}`);
    }

    const codeSource = codeSourceRaw || null;
    for (const diagnosis of diagnosisParts) {
      pairs.push({
        diagnosis,
        code,
        code_source: codeSource,
      });
    }
  }

  const seen = new Set<string>();
  const deduped: CanonicalDiagnosisCodePair[] = [];
  for (const pair of pairs) {
    const key = `${pair.diagnosis.toLowerCase()}|${pair.code ?? ""}|${pair.code_source ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(pair);
  }
  return deduped.slice(0, 80);
}

function canonicalizeExtractionCandidate(input: {
  candidate: PartialCanonical;
  fallback: PartialCanonical;
  llmSuccessful: boolean;
}): CanonicalDiagnosisExtraction {
  const structuredPrimary = input.candidate.primaryDiagnosis && typeof input.candidate.primaryDiagnosis === "object"
    ? extractStructuredDiagnosisEntries([input.candidate.primaryDiagnosis])
    : [];
  const structuredOthers = extractStructuredDiagnosisEntries(input.candidate.otherDiagnoses);
  const structuredEntries = [...structuredPrimary, ...structuredOthers];
  const uncertainItems = uniqueCaseInsensitive([
    ...toStringArray(input.fallback.uncertain_items),
    ...toStringArray(input.candidate.uncertain_items),
    ...toStringArray(input.candidate.notes),
  ]);

  const diagnosisPhrasesRaw = [
    ...structuredEntries.map((entry) => entry.diagnosis),
    ...toStringArray(input.candidate.diagnosis_phrases),
    ...toStringArray(input.fallback.diagnosis_phrases),
  ];
  const diagnosisPhrases = uniqueCaseInsensitive(
    diagnosisPhrasesRaw
      .flatMap((entry) => splitDiagnosisString(entry))
      .filter((entry) => {
        if (isLikelySuspicious(entry)) {
          uncertainItems.push(`suspicious_diagnosis_phrase:${entry}`);
          return false;
        }
        return true;
      }),
  ).slice(0, 80);

  const structuredPairs: CanonicalDiagnosisCodePair[] = structuredEntries.map((entry) => ({
    diagnosis: entry.diagnosis,
    code: entry.code,
    code_source: entry.code ? "ocr_text_explicit_or_inferred" : null,
  }));

  const pairs = [
    ...structuredPairs,
    ...normalizeDiagnosisCodePairs(
      input.candidate.diagnosis_code_pairs ?? input.fallback.diagnosis_code_pairs,
      uncertainItems,
    ),
  ];

  const fallbackPairs: CanonicalDiagnosisCodePair[] = pairs.length > 0
    ? uniqueCaseInsensitive(
        pairs.map((pair) => `${pair.diagnosis}|${pair.code ?? ""}|${pair.code_source ?? ""}`),
      ).map((entry) => {
        const [diagnosis, code, codeSource] = entry.split("|");
        return {
          diagnosis,
          code: code || null,
          code_source: codeSource || null,
        };
      })
    : diagnosisPhrases.map((diagnosis) => ({ diagnosis, code: null, code_source: null }));

  const explicitCodes = uniqueCaseInsensitive([
    ...toStringArray(input.candidate.icd10_codes_found_verbatim).map((code) => normalizeIcdCode(code) ?? ""),
    ...toStringArray(input.fallback.icd10_codes_found_verbatim).map((code) => normalizeIcdCode(code) ?? ""),
    ...fallbackPairs.map((pair) => pair.code ?? ""),
  ].filter(Boolean)).slice(0, 80);

  const malformedCodes = uniqueCaseInsensitive(
    [
      ...toStringArray(input.candidate.icd10_codes_found_verbatim),
      ...toStringArray(input.fallback.icd10_codes_found_verbatim),
    ]
      .filter((code) => Boolean(code) && !Boolean(normalizeIcdCode(code))),
  );
  for (const malformed of malformedCodes) {
    uncertainItems.push(`malformed_icd_code:${malformed}`);
  }

  const orderedServices = uniqueCaseInsensitive([
    ...toStringArray(input.candidate.ordered_services),
    ...toStringArray(input.fallback.ordered_services),
  ]).slice(0, 30);

  const sourceQuotes = uniqueCaseInsensitive([
    ...toStringArray(input.candidate.source_quotes),
    ...toStringArray(input.fallback.source_quotes),
  ])
    .filter((quote) => !isLikelySuspicious(quote))
    .map((quote) => quote.slice(0, 320))
    .slice(0, 20);

  const reasonForAdmission =
    normalizeReasonForAdmission(input.candidate.reason_for_admission) ||
    normalizeReasonForAdmission(input.fallback.reason_for_admission) ||
    null;
  const clinicalSummary =
    sanitizeFreeText(input.candidate.clinical_summary) ||
    sanitizeFreeText(input.fallback.clinical_summary) ||
    null;
  const documentType =
    sanitizeFreeText(input.candidate.document_type) ||
    sanitizeFreeText(input.fallback.document_type) ||
    null;

  const confidenceCandidate = sanitizeFreeText(input.candidate.extraction_confidence).toLowerCase();
  const extractionConfidence: "low" | "medium" | "high" =
    confidenceCandidate === "low" || confidenceCandidate === "medium" || confidenceCandidate === "high"
      ? confidenceCandidate
      : inferConfidence({
          diagnosisCount: diagnosisPhrases.length,
          codeCount: explicitCodes.length,
          quoteCount: sourceQuotes.length,
          llmSuccessful: input.llmSuccessful,
        });

  return {
    reason_for_admission: reasonForAdmission,
    diagnosis_phrases: diagnosisPhrases,
    diagnosis_code_pairs: fallbackPairs,
    icd10_codes_found_verbatim: explicitCodes,
    ordered_services: orderedServices,
    clinical_summary: clinicalSummary,
    source_quotes: sourceQuotes,
    uncertain_items: uniqueCaseInsensitive(
      uncertainItems
        .map((entry) => sanitizeFreeText(entry))
        .filter(Boolean),
    ).slice(0, 40),
    document_type: documentType,
    extraction_confidence: extractionConfidence,
  };
}

function buildDeterministicFallback(input: {
  sourceText: string;
  extractedDocuments: ExtractedDocument[];
}): PartialCanonical {
  const diagnosisPhrases = extractDeterministicDiagnosisPhrases(input.sourceText);
  const diagnosisCodePairs = extractExplicitDiagnosisCodePairs(input.sourceText);
  const icdCodes = extractPossibleIcd10Codes(input.sourceText);
  const services = extractOrderedServices(input.sourceText);
  const sourceQuotes = extractSourceQuotes(input.sourceText);
  const reasonForAdmission = extractReasonForAdmission(input.sourceText);
  const clinicalSummary = extractClinicalSummary(input.sourceText);
  const documentType = inferDocumentType(input.extractedDocuments);

  return {
    reason_for_admission: reasonForAdmission,
    diagnosis_phrases: diagnosisPhrases,
    diagnosis_code_pairs: diagnosisCodePairs.length > 0
      ? diagnosisCodePairs
      : diagnosisPhrases.map((diagnosis) => ({
          diagnosis,
          code: null,
          code_source: null,
        })),
    icd10_codes_found_verbatim: icdCodes,
    ordered_services: services,
    clinical_summary: clinicalSummary,
    source_quotes: sourceQuotes,
    uncertain_items: [],
    document_type: documentType,
    extraction_confidence: inferConfidence({
      diagnosisCount: diagnosisPhrases.length,
      codeCount: icdCodes.length,
      quoteCount: sourceQuotes.length,
      llmSuccessful: false,
    }),
  };
}

/**
 * Required IAM actions for Bedrock Converse usage:
 * - bedrock:InvokeModel
 * - bedrock:InvokeModelWithResponseStream (only if streaming is used)
 */
export async function verifyDiagnosisCodingLlmAccess(input: {
  env: FinaleBatchEnv;
  logger?: LoggerLike;
}): Promise<void> {
  if (!isBedrockCodingLlmEnabled(input.env)) {
    return;
  }

  const { region, modelId } = resolveBedrockConfig(input.env);
  const client = getBedrockClient(region);

  try {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: BEDROCK_SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [{
              text:
                "Return strict JSON only for this short note: Patient admitted for weakness and uncontrolled diabetes (E11.9). Skilled nursing and PT ordered.",
            }],
          },
        ],
        inferenceConfig: {
          temperature: 0,
          maxTokens: 250,
        },
      }),
    );

    input.logger?.info?.(
      {
        llmProvider: "bedrock",
        bedrockRegion: region,
        bedrockModelId: modelId,
        verificationOutputPresent: Boolean(extractConverseText(response)),
      },
      "Bedrock Converse startup verification succeeded",
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Bedrock Converse startup verification failed for model '${modelId}' in region '${region}'. ` +
        "Confirm model access, AWS credentials, and IAM action bedrock:InvokeModel " +
        "(plus bedrock:InvokeModelWithResponseStream if streaming is enabled). " +
        `Original error: ${errorMessage}`,
    );
  }
}

async function runBedrockCodingExtraction(input: {
  sourceText: string;
  env: FinaleBatchEnv;
  extractedDocuments: ExtractedDocument[];
}): Promise<BedrockCodingExtractionResult> {
  if (!isBedrockCodingLlmEnabled(input.env)) {
    return {
      canonical: null,
      model: null,
      error: null,
    };
  }

  const { region, modelId } = resolveBedrockConfig(input.env);
  const client = getBedrockClient(region);

  try {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: BEDROCK_SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [{
              text: [
                "Extract from the following home-health chart text.",
                "Do not include markdown or prose. Return strict JSON only.",
                `Document type hint: ${inferDocumentType(input.extractedDocuments) ?? "unknown"}`,
                "",
                input.sourceText.slice(0, 18_000),
              ].join("\n"),
            }],
          },
        ],
        inferenceConfig: {
          temperature: 0,
          maxTokens: 1_400,
        },
      }),
    );

    const content = extractConverseText(response);
    if (!content) {
      return {
        canonical: null,
        model: modelId,
        error: "bedrock_empty_content",
      };
    }

    const parsed = parseLlmJsonPayload(content);
    if (!parsed) {
      return {
        canonical: null,
        model: modelId,
        error: "bedrock_invalid_json",
      };
    }

    const deterministicFallback = buildDeterministicFallback({
      sourceText: input.sourceText,
      extractedDocuments: input.extractedDocuments,
    });

    const canonical = canonicalizeExtractionCandidate({
      candidate: parsed as PartialCanonical,
      fallback: deterministicFallback,
      llmSuccessful: true,
    });

    return {
      canonical,
      model: modelId,
      error: null,
    };
  } catch (error) {
    return {
      canonical: null,
      model: modelId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function extractDiagnosisCodingContext(input: {
  extractedDocuments: ExtractedDocument[];
  env: FinaleBatchEnv;
}): Promise<DiagnosisCodingExtractionResult> {
  const sourceBuild = buildSourceText(input.extractedDocuments);
  const sourceText = sourceBuild.sourceText;
  const deterministicFallback = buildDeterministicFallback({
    sourceText,
    extractedDocuments: sourceBuild.selectedDocuments,
  });

  const llmResult = await runBedrockCodingExtraction({
    sourceText,
    env: input.env,
    extractedDocuments: sourceBuild.selectedDocuments,
  });

  const canonical = canonicalizeExtractionCandidate({
    candidate: (llmResult.canonical ?? {}) as PartialCanonical,
    fallback: deterministicFallback,
    llmSuccessful: Boolean(llmResult.canonical && !llmResult.error),
  });

  const allCodes = uniqueCaseInsensitive(
    [
      ...canonical.icd10_codes_found_verbatim,
      ...canonical.diagnosis_code_pairs.map((pair) => pair.code ?? ""),
    ].filter(Boolean),
  ).slice(0, 80);

  const categories = unique(allCodes.map((code) => `${code}:${mapIcdCategory(code)}`)).slice(0, 80);
  const llmUsed = isBedrockCodingLlmEnabled(input.env);
  const sourceTextPreview = sanitizeFreeText(sourceText).slice(0, 500) || "none";

  return {
    sourceDocumentCount: sourceBuild.selectedDocuments.length,
    sourceCharacterCount: sourceText.length,
    diagnosisMentions: canonical.diagnosis_phrases,
    icd10Codes: allCodes,
    codeCategories: categories,
    canonical,
    llmUsed,
    llmModel: llmResult.model,
    llmError: llmResult.error,
    evidence: [
      ...sourceBuild.evidence,
      `sourceDocumentCount:${sourceBuild.selectedDocuments.length}`,
      `sourceCharacterCount:${sourceText.length}`,
      `sourceTextPreview:${sourceTextPreview}`,
      `llmProvider:${input.env.LLM_PROVIDER}`,
      `llmUsed:${llmUsed}`,
      `llmModel:${llmResult.model ?? "none"}`,
      `llmError:${llmResult.error ?? "none"}`,
      `reasonForAdmission:${canonical.reason_for_admission ?? "none"}`,
      `diagnosisPhraseCount:${canonical.diagnosis_phrases.length}`,
      `diagnosisCodePairCount:${canonical.diagnosis_code_pairs.length}`,
      `icd10Codes:${allCodes.join(" | ") || "none"}`,
      `orderedServices:${canonical.ordered_services.join(" | ") || "none"}`,
      `documentType:${canonical.document_type ?? "none"}`,
      `extractionConfidence:${canonical.extraction_confidence}`,
      `uncertainItems:${canonical.uncertain_items.join(" | ") || "none"}`,
      `codeCategories:${categories.join(" | ") || "none"}`,
    ],
  };
}
