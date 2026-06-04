import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { VisitNoteFact, VisitNoteTextInputSuggestion, VisitNoteType } from "@medical-ai-qa/shared-types";
import type { VisitNotePocMappingResult } from "@medical-ai-qa/shared-types";
import type { FinaleBatchEnv } from "../config/env";
import {
  resolveBedrockConfig,
  sendBedrockConverseWithProfileFallback,
} from "../config/bedrock";
import { sanitizeClinicalSnippet } from "./clinicalTextQualityService";
import { getVisitNoteDisciplineExpectations } from "./visitNoteDisciplineExpectations";

export type VisitNotePocAlignmentVerdict =
  | "aligned"
  | "partially_aligned"
  | "not_aligned"
  | "insufficient_documentation"
  | "positive_progress"
  | "possible_update_needed"
  | "contradiction"
  | "missed_visit"
  | "incomplete_note"
  | "capture_needed"
  | "capture_failed"
  | "not_applicable";

export type VisitNotePocAlignmentResult = {
  verdict: VisitNotePocAlignmentVerdict;
  confidence: number;
  visitNoteFactIds: string[];
  pocEvidenceIds: string[];
  oasisFactIds?: string[];
  rationale: string;
};

export type VisitNotePocMappingLlmInvoke = (prompt: string) => Promise<string>;
export type VisitNoteTextInputSuggestionLlmInvoke = (prompt: string) => Promise<string>;

export type VisitNotePocMappingLlmResult = {
  status: "disabled" | "success" | "failed_deterministic_only";
  mappingResult: VisitNotePocMappingResult | null;
  warnings: string[];
  invocationModelId?: string | null;
  errorCategory?: "invalid_json" | "invocation_failed" | null;
  promptTokenEstimate: number;
};

export type VisitNotePocMappingPromptTarget = {
  problemKey: string;
  problemTitle: string;
  problemStatement?: string;
  goalTexts: string[];
  interventionTexts: string[];
  evidenceIds: string[];
  clinicalDomain?: string;
};

export type VisitNoteTextInputSuggestionCandidate = Omit<
  VisitNoteTextInputSuggestion,
  "suggestedInput" | "source" | "confidence"
> & {
  sourceFactIds: string[];
  confidence: number;
  detailsToPreserve?: string[];
  sourceTexts?: string[];
};

const POC_ALIGNMENT_VERDICTS = new Set<VisitNotePocAlignmentVerdict>([
  "aligned",
  "partially_aligned",
  "not_aligned",
  "insufficient_documentation",
  "positive_progress",
  "possible_update_needed",
  "contradiction",
  "missed_visit",
  "incomplete_note",
  "capture_needed",
  "capture_failed",
  "not_applicable",
]);

function stringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Visit-note LLM alignment output field ${fieldName} must be an array.`);
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function parseVisitNotePocAlignmentLlmJson(raw: string): VisitNotePocAlignmentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Visit-note LLM alignment output was not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Visit-note LLM alignment output must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const verdict = record.verdict;
  if (typeof verdict !== "string" || !POC_ALIGNMENT_VERDICTS.has(verdict as VisitNotePocAlignmentVerdict)) {
    throw new Error("Visit-note LLM alignment output has an unsupported verdict.");
  }
  const confidence = record.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Visit-note LLM alignment output confidence must be a number between 0 and 1.");
  }
  const rationale = sanitizeClinicalSnippet(typeof record.rationale === "string" ? record.rationale : "", 500);
  if (!rationale) {
    throw new Error("Visit-note LLM alignment output rationale was empty or not clinically usable.");
  }
  return {
    verdict: verdict as VisitNotePocAlignmentVerdict,
    confidence,
    visitNoteFactIds: stringArray(record.visitNoteFactIds ?? [], "visitNoteFactIds"),
    pocEvidenceIds: stringArray(record.pocEvidenceIds ?? [], "pocEvidenceIds"),
    oasisFactIds: stringArray(record.oasisFactIds ?? [], "oasisFactIds"),
    rationale,
  };
}

function mappingStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function parseVisitNotePocMappingLlmJson(raw: string, visitNoteKey = "visit-note"): VisitNotePocMappingResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Visit-note POC mapping LLM output was not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Visit-note POC mapping LLM output must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const alignmentStatus = record.alignmentStatus;
  const allowedStatuses = new Set(["aligned", "partially_aligned", "not_aligned", "insufficient_documentation", "contradiction", "needs_review"]);
  if (typeof alignmentStatus !== "string" || !allowedStatuses.has(alignmentStatus)) {
    throw new Error("Visit-note POC mapping LLM output has an unsupported alignmentStatus.");
  }
  const matchStrength = record.matchStrength;
  if (typeof matchStrength !== "number" || !Number.isFinite(matchStrength) || matchStrength < 0 || matchStrength > 1) {
    throw new Error("Visit-note POC mapping LLM output matchStrength must be a number between 0 and 1.");
  }
  const matchedPocItems = Array.isArray(record.matchedPocItems)
    ? record.matchedPocItems
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
      .map((entry) => ({
        problemKey: typeof entry.problemKey === "string" ? entry.problemKey : "",
        problemTitle: typeof entry.problemTitle === "string" ? sanitizeClinicalSnippet(entry.problemTitle, 160) : "Plan of Care problem",
        goalTexts: mappingStringArray(entry.goalTexts).map((value) => sanitizeClinicalSnippet(value, 240)).filter(Boolean),
        interventionTexts: mappingStringArray(entry.interventionTexts).map((value) => sanitizeClinicalSnippet(value, 240)).filter(Boolean),
        evidenceIds: mappingStringArray(entry.evidenceIds),
      }))
    : [];
  const rationale = sanitizeClinicalSnippet(typeof record.rationale === "string" ? record.rationale : "", 500);
  if (!rationale) {
    throw new Error("Visit-note POC mapping LLM output rationale was empty or not clinically usable.");
  }
  return {
    visitNoteKey,
    alignmentStatus: alignmentStatus as VisitNotePocMappingResult["alignmentStatus"],
    matchStrength,
    matchedPocItems,
    visitNoteEvidence: mappingStringArray(record.visitNoteEvidence),
    rationale,
    missingDocumentation: mappingStringArray(record.missingDocumentation),
    contradictions: mappingStringArray(record.contradictions),
    pocUpdateSignals: mappingStringArray(record.pocUpdateSignals),
  };
}

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function getBedrockClient(region: string): BedrockRuntimeClient {
  const existing = bedrockClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function extractConverseText(response: ConverseCommandOutput): string {
  const blocks = response.output?.message?.content;
  if (!blocks) {
    return "";
  }
  return normalizeWhitespace(blocks
    .map((block) => "text" in block ? block.text : "")
    .filter((text): text is string => typeof text === "string")
    .join("\n"));
}

function compactVisitNoteFact(fact: VisitNoteFact, maxLength = 180) {
  return {
    factId: fact.factId,
    category: fact.category,
    normalizedValue: sanitizeClinicalSnippet(fact.normalizedValue, maxLength),
    snippet: sanitizeClinicalSnippet(fact.rawSnippet ?? "", maxLength) || null,
    confidence: Number(fact.confidence.toFixed(2)),
  };
}

function compactPocTarget(target: VisitNotePocMappingPromptTarget) {
  return {
    problemKey: target.problemKey,
    problemTitle: sanitizeClinicalSnippet(target.problemTitle, 160),
    clinicalDomain: target.clinicalDomain ?? null,
    problemStatement: sanitizeClinicalSnippet(target.problemStatement ?? "", 220) || null,
    goalTexts: target.goalTexts.map((goal) => sanitizeClinicalSnippet(goal, 220)).filter(Boolean).slice(0, 4),
    interventionTexts: target.interventionTexts.map((intervention) => sanitizeClinicalSnippet(intervention, 240)).filter(Boolean).slice(0, 6),
    evidenceIds: target.evidenceIds.slice(0, 12),
  };
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeLlmMissingDocumentation(input: {
  missingDocumentation: string[];
  facts: VisitNoteFact[];
  matchedPocItems: VisitNotePocMappingResult["matchedPocItems"];
  alignmentStatus: VisitNotePocMappingResult["alignmentStatus"];
  contradictions: string[];
}): {
  missingDocumentation: string[];
  alignmentStatus: VisitNotePocMappingResult["alignmentStatus"];
} {
  const incompleteFacts = input.facts.filter((fact) => fact.category === "incomplete_field");
  const incompleteLabels = incompleteFacts.map((fact) => fact.normalizedValue);
  const incompleteLabelKeys = new Set(incompleteLabels.map(normalizeComparableText));
  const normalizedMissing = input.missingDocumentation
    .map((entry) => {
      const matchingFact = incompleteFacts.find((fact) => fact.factId === entry);
      return matchingFact?.normalizedValue ?? entry;
    })
    .filter((entry) => {
      const comparable = normalizeComparableText(entry);
      if (/no related plan of care diagnosis|no related diagnosis|missing related diagnosis/.test(comparable)) {
        return true;
      }
      return incompleteLabelKeys.has(comparable);
    });
  const uniqueMissing = Array.from(new Set(normalizedMissing));
  if (input.contradictions.length > 0 || input.alignmentStatus === "contradiction") {
    return {
      missingDocumentation: uniqueMissing,
      alignmentStatus: "contradiction",
    };
  }
  if (input.matchedPocItems.length === 0) {
    return {
      missingDocumentation: uniqueMissing.length > 0 ? uniqueMissing : ["No related Plan of Care diagnosis was identified from this Visit Note."],
      alignmentStatus: "insufficient_documentation",
    };
  }
  return {
    missingDocumentation: uniqueMissing,
    alignmentStatus: uniqueMissing.length > 0 ? "partially_aligned" : "aligned",
  };
}

export function buildVisitNotePocMappingPrompt(input: {
  visitNoteKey: string;
  visitType: VisitNoteType;
  status?: string | null;
  lifecycleStatus?: string | null;
  visitDate?: string | null;
  facts: VisitNoteFact[];
  pocTargets: VisitNotePocMappingPromptTarget[];
  diagnosisContext?: string[] | null;
}): string {
  return [
    "Return strict JSON only. Do not include markdown, commentary, or code fences.",
    "You are mapping one active home-health Visit Note to the supplied Plan of Care items for read-only QA.",
    "Primary task: identify which diagnosis or POC item the Visit Note is about, using only Visit Note evidence and supplied POC items.",
    "Secondary task: identify direct discrepancies between the Visit Note and the matched Plan of Care item.",
    "Blank important text fields are incomplete documentation. Use incomplete_field facts as missingDocumentation.",
    "Do not create broad best-practice omissions. MissingDocumentation must be limited to blank fields or a missing diagnosis/POC match.",
    "Use contradiction only when the Visit Note clearly conflicts with the supplied POC.",
    "Use aligned when a related diagnosis/POC item is identified and no blank required field or discrepancy is present.",
    "Use partially_aligned when the related diagnosis/POC item is identified but important blanks remain.",
    "Use insufficient_documentation when no related diagnosis/POC item can be identified from the note.",
    "When referencing Visit Note evidence, preserve concrete details such as measurements, counts, distances, scores, vitals, frequencies, device names, assist levels, and cueing details.",
    "Preserve supplied POC problemKey values exactly.",
    "Required JSON shape:",
    JSON.stringify({
      alignmentStatus: "aligned | partially_aligned | not_aligned | insufficient_documentation | contradiction | needs_review",
      matchStrength: 0.0,
      matchedPocItems: [{
        problemKey: "supplied POC problemKey",
        problemTitle: "supplied title",
        goalTexts: ["supported POC goal text"],
        interventionTexts: ["supported POC intervention text"],
        evidenceIds: ["supplied POC evidence id"],
      }],
      visitNoteEvidence: ["visit-note fact id"],
      rationale: "one short reason naming the related diagnosis or why it could not be identified",
      missingDocumentation: ["human-readable blank field name or missing related diagnosis/POC match only"],
      contradictions: ["clear conflict with POC only"],
      pocUpdateSignals: ["visit-note fact id suggesting POC update"],
    }),
    "VISIT_NOTE:",
    JSON.stringify({
      visitNoteKey: input.visitNoteKey,
      visitType: input.visitType,
      status: input.status ?? null,
      lifecycleStatus: input.lifecycleStatus ?? null,
      visitDate: input.visitDate ?? null,
      facts: input.facts.slice(0, 24).map((fact) => compactVisitNoteFact(fact, 320)),
    }),
    "POC_ITEMS:",
    JSON.stringify(input.pocTargets.slice(0, 12).map(compactPocTarget)),
    "DIAGNOSIS_CONTEXT:",
    JSON.stringify((input.diagnosisContext ?? []).map((entry) => sanitizeClinicalSnippet(entry, 160)).filter(Boolean).slice(0, 12)),
  ].join("\n");
}

function isVisitNotePocMappingLlmEnabled(env: FinaleBatchEnv | undefined): boolean {
  const enabled = env?.VISIT_NOTE_POC_MAPPING_LLM_ENABLED ?? env?.CODE_LLM_ENABLED;
  return Boolean(enabled && env?.LLM_PROVIDER === "bedrock");
}

async function invokeBedrock(input: {
  env: FinaleBatchEnv;
  prompt: string;
}): Promise<{ content: string; invocationModelId: string | null }> {
  const config = resolveBedrockConfig({
    ...input.env,
    CODE_LLM_ENABLED: true,
    BEDROCK_MODEL_ID: input.env.VISIT_NOTE_POC_MAPPING_MODEL_ID ?? input.env.BEDROCK_MODEL_ID,
  });
  const client = getBedrockClient(config.region);
  const { response, invocationModelId } = await sendBedrockConverseWithProfileFallback({
    client,
    config,
    command: {
      messages: [{
        role: "user",
        content: [{ text: input.prompt }],
      }],
      inferenceConfig: {
        temperature: 0,
        maxTokens: input.env.VISIT_NOTE_POC_MAPPING_MAX_TOKENS,
      },
    },
  });
  return {
    content: extractConverseText(response),
    invocationModelId,
  };
}

export async function runVisitNotePocMappingLlm(input: {
  visitNoteKey: string;
  visitType: VisitNoteType;
  status?: string | null;
  lifecycleStatus?: string | null;
  visitDate?: string | null;
  facts: VisitNoteFact[];
  pocTargets: VisitNotePocMappingPromptTarget[];
  diagnosisContext?: string[] | null;
  env?: FinaleBatchEnv;
  invokeText?: VisitNotePocMappingLlmInvoke;
}): Promise<VisitNotePocMappingLlmResult> {
  if (input.pocTargets.length === 0 || (!input.invokeText && !isVisitNotePocMappingLlmEnabled(input.env))) {
    return {
      status: "disabled",
      mappingResult: null,
      warnings: [],
      invocationModelId: null,
      errorCategory: null,
      promptTokenEstimate: 0,
    };
  }
  const prompt = buildVisitNotePocMappingPrompt(input);
  const promptTokenEstimate = Math.ceil(prompt.length / 4);
  try {
    const invoked = input.invokeText
      ? { content: await input.invokeText(prompt), invocationModelId: "test-invoker" }
      : await invokeBedrock({ env: input.env!, prompt });
    const mappingResult = parseVisitNotePocMappingLlmJson(invoked.content, input.visitNoteKey);
    const normalizedMissing = normalizeLlmMissingDocumentation({
      missingDocumentation: mappingResult.missingDocumentation,
      facts: input.facts,
      matchedPocItems: mappingResult.matchedPocItems,
      alignmentStatus: mappingResult.alignmentStatus,
      contradictions: mappingResult.contradictions,
    });
    return {
      status: "success",
      mappingResult: {
        ...mappingResult,
        alignmentStatus: normalizedMissing.alignmentStatus,
        missingDocumentation: normalizedMissing.missingDocumentation,
        mappingStatus: "success",
        mappingSource: "llm",
        modelId: invoked.invocationModelId,
      },
      warnings: [],
      invocationModelId: invoked.invocationModelId,
      errorCategory: null,
      promptTokenEstimate,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed_deterministic_only",
      mappingResult: null,
      warnings: [`Visit Note POC mapping LLM failed; deterministic mapping was retained. ${sanitizeClinicalSnippet(message, 220)}`],
      invocationModelId: null,
      errorCategory: /JSON|alignmentStatus|matchStrength|rationale/i.test(message) ? "invalid_json" : "invocation_failed",
      promptTokenEstimate,
    };
  }
}

function countSentences(value: string): number {
  return value.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

function normalizeSuggestedInput(value: string): string {
  return sanitizeClinicalSnippet(value, 900)
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function normalizeDetailComparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-z0-9%./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueClinicalDetails(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    const key = normalizeDetailComparable(trimmed);
    if (!trimmed || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

export function extractVisitNoteDetailsToPreserve(value: string | null | undefined): string[] {
  const text = value ?? "";
  if (!text.trim()) {
    return [];
  }
  const patterns = [
    /\b\d+(?:\.\d+)?\s*(?:deg|degrees?|°?\s*f|bpm|\/min|mm\/hg|%|lbs?|pounds?|ft|feet|mg|mcg|meq|ml|l\/min|days?|weeks?|hrs?|hours?|minutes?|mins?|x\/wk|x\/week|x\/day)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:\/|-)\s*\d+(?:\.\d+)?\b/g,
    /\b\d+(?:\.\d+)?\s*\/\s*(?:10|5)\b/gi,
    /\b(?:FWW|RW|4WW|SPC|WC|W\/C|SBA|CGA|MIN A|MOD A|MAX A|MIN ASSIST|MOD ASSIST|MAX ASSIST|VC'?S?|TC'?S?|VC\/TC|VCS\/TCS|PRN|BID|TID|QID|PO|O2|SPO2|TUG|HEP|ROM|ADL|ADLS)\b/gi,
    /\b[A-Z]\d{2}(?:\.\d+)?\b/g,
  ];
  return uniqueClinicalDetails(patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[0] ?? "")));
}

function collectDetailsToPreserveForCandidate(input: {
  candidate: VisitNoteTextInputSuggestionCandidate;
  facts: VisitNoteFact[];
}): string[] {
  if (input.candidate.detailsToPreserve?.length) {
    return uniqueClinicalDetails(input.candidate.detailsToPreserve);
  }
  const sourceFactIds = new Set(input.candidate.sourceFactIds);
  const sourceFacts = input.facts.filter((fact) => sourceFactIds.has(fact.factId));
  return uniqueClinicalDetails([
    ...extractVisitNoteDetailsToPreserve(input.candidate.currentValue),
    ...sourceFacts.flatMap((fact) => [
      ...extractVisitNoteDetailsToPreserve(fact.normalizedValue),
      ...extractVisitNoteDetailsToPreserve(fact.rawSnippet),
    ]),
  ]);
}

function collectSuggestionSourceTextsForCandidate(input: {
  candidate: VisitNoteTextInputSuggestionCandidate;
  facts: VisitNoteFact[];
}): string[] {
  const sourceFactIds = new Set(input.candidate.sourceFactIds);
  const sourceFacts = input.facts.filter((fact) => sourceFactIds.has(fact.factId));
  return uniqueClinicalDetails([
    input.candidate.currentValue ?? "",
    ...sourceFacts.flatMap((fact) => [
      fact.normalizedValue,
      fact.rawSnippet ?? "",
    ]),
  ]);
}

function withDetailsToPreserve(input: {
  candidates: VisitNoteTextInputSuggestionCandidate[];
  facts: VisitNoteFact[];
}): VisitNoteTextInputSuggestionCandidate[] {
  return input.candidates.map((candidate) => ({
    ...candidate,
    detailsToPreserve: collectDetailsToPreserveForCandidate({ candidate, facts: input.facts }),
    sourceTexts: collectSuggestionSourceTextsForCandidate({ candidate, facts: input.facts }),
  }));
}

function suggestionPreservesRequiredDetails(input: {
  candidate: VisitNoteTextInputSuggestionCandidate;
  suggestedInput: string;
}): boolean {
  const detailsToPreserve = input.candidate.detailsToPreserve ?? [];
  if (detailsToPreserve.length === 0) {
    return true;
  }
  const haystack = normalizeDetailComparable(input.suggestedInput);
  return detailsToPreserve.every((detail) => haystack.includes(normalizeDetailComparable(detail)));
}

const SOURCE_BACKING_STOP_WORDS = new Set([
  "able",
  "about",
  "after",
  "also",
  "been",
  "before",
  "care",
  "clinician",
  "continue",
  "during",
  "field",
  "from",
  "home",
  "note",
  "patient",
  "review",
  "should",
  "that",
  "their",
  "there",
  "this",
  "visit",
  "with",
]);

function extractSourceTerms(value: string): string[] {
  const normalized = normalizeDetailComparable(value);
  return Array.from(new Set(Array.from(normalized.matchAll(/\b[a-z][a-z0-9/-]{3,}\b/g), (match) => match[0])
    .filter((word) => !SOURCE_BACKING_STOP_WORDS.has(word))));
}

function extractConcreteTerms(value: string): string[] {
  return uniqueClinicalDetails([
    ...Array.from(value.matchAll(/\b\d+(?:\.\d+)?(?:\s*(?:\/|-)\s*\d+(?:\.\d+)?)?(?:\s*(?:ft|feet|mg|mcg|meq|ml|%|bpm|mm\/hg|x\/wk|x\/week|x\/day))?\b/gi), (match) => match[0] ?? ""),
    ...Array.from(value.matchAll(/\b(?:FWW|RW|4WW|SPC|WC|W\/C|SBA|CGA|MIN A|MOD A|MAX A|VC'?S?|TC'?S?|VC\/TC|PRN|BID|TID|QID|PO|O2|SPO2|TUG|HEP|ROM|ADL|ADLS)\b/gi), (match) => match[0] ?? ""),
    ...Array.from(value.matchAll(/\b[A-Z]\d{2}(?:\.\d+)?\b/g), (match) => match[0] ?? ""),
  ]);
}

function suggestionIsSourceBacked(input: {
  candidate: VisitNoteTextInputSuggestionCandidate;
  suggestedInput: string;
}): boolean {
  if (input.candidate.reason === "blank") {
    return false;
  }
  const sourceText = [
    input.candidate.currentValue ?? "",
    ...(input.candidate.sourceTexts ?? []),
  ].join(" ");
  if (normalizeWhitespace(sourceText).length < 12) {
    return false;
  }
  const sourceComparable = normalizeDetailComparable(sourceText);
  const missingConcreteTerm = extractConcreteTerms(input.suggestedInput)
    .some((term) => !sourceComparable.includes(normalizeDetailComparable(term)));
  if (missingConcreteTerm) {
    return false;
  }
  const sourceTerms = new Set(extractSourceTerms(sourceText));
  if (sourceTerms.size === 0) {
    return false;
  }
  const sentences = input.suggestedInput
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.every((sentence) =>
    extractSourceTerms(sentence).some((term) => sourceTerms.has(term)),
  );
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function pushTextInputSuggestion(input: {
  suggestions: VisitNoteTextInputSuggestion[];
  candidate: VisitNoteTextInputSuggestionCandidate;
  suggestedInput: string;
}): void {
  const suggestedInput = normalizeSuggestedInput(input.suggestedInput);
  if (!suggestedInput) {
    return;
  }
  const sentenceCount = countSentences(suggestedInput);
  if (sentenceCount < 1 || sentenceCount > 5) {
    return;
  }
  if (!suggestionIsSourceBacked({ candidate: input.candidate, suggestedInput })) {
    return;
  }
  if (!suggestionPreservesRequiredDetails({ candidate: input.candidate, suggestedInput })) {
    return;
  }
  input.suggestions.push({
    ...input.candidate,
    suggestedInput,
    confidence: Math.max(0.5, Math.min(1, input.candidate.confidence)),
  });
}

function parseVisitNoteTextInputSuggestionsDelimited(
  raw: string,
  candidatesById: Map<string, VisitNoteTextInputSuggestionCandidate>,
): VisitNoteTextInputSuggestion[] {
  const content = stripCodeFence(raw);
  const markerPattern = /SUGGESTION\|([^|\r\n]+)\|/g;
  const markers = Array.from(content.matchAll(markerPattern));
  const suggestions: VisitNoteTextInputSuggestion[] = [];
  if (markers.length > 0) {
    markers.forEach((marker, index) => {
      const suggestionId = marker[1]?.trim() ?? "";
      const candidate = candidatesById.get(suggestionId);
      if (!candidate) {
        return;
      }
      const start = (marker.index ?? 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? content.length;
      pushTextInputSuggestion({
        suggestions,
        candidate,
        suggestedInput: content.slice(start, end),
      });
    });
    return suggestions;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("SUGGESTION|")) {
      continue;
    }
    const parts = trimmed.split("|");
    const suggestionId = parts[1]?.trim() ?? "";
    const candidate = candidatesById.get(suggestionId);
    if (!candidate) {
      continue;
    }
    pushTextInputSuggestion({
      suggestions,
      candidate,
      suggestedInput: parts.slice(2).join("|"),
    });
  }
  return suggestions;
}

export function parseVisitNoteTextInputSuggestionsLlmJson(
  raw: string,
  candidates: VisitNoteTextInputSuggestionCandidate[],
): VisitNoteTextInputSuggestion[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.suggestionId, candidate]));
  const delimitedSuggestions = parseVisitNoteTextInputSuggestionsDelimited(raw, candidatesById);
  if (delimitedSuggestions.length > 0 || /SUGGESTION\|/.test(stripCodeFence(raw))) {
    return delimitedSuggestions;
  }

  let parsed: unknown;
  try {
    const trimmed = stripCodeFence(raw);
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    parsed = JSON.parse(jsonStart >= 0 && jsonEnd > jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed);
  } catch (error) {
    throw new Error(`Visit-note text suggestion LLM output was not valid JSON: ${(error as Error).message}`);
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawSuggestions = Array.isArray(record?.suggestions) ? record.suggestions : null;
  if (!rawSuggestions) {
    throw new Error("Visit-note text suggestion LLM output must include a suggestions array.");
  }

  const suggestions: VisitNoteTextInputSuggestion[] = [];
  for (const value of rawSuggestions) {
    const suggestion = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    const suggestionId = typeof suggestion?.suggestionId === "string" ? suggestion.suggestionId : "";
    const candidate = candidatesById.get(suggestionId);
    if (!candidate) {
      continue;
    }
    const suggestedSentences = Array.isArray(suggestion?.suggestedSentences)
      ? suggestion.suggestedSentences.filter((sentence): sentence is string => typeof sentence === "string")
      : [];
    pushTextInputSuggestion({
      suggestions,
      candidate,
      suggestedInput: typeof suggestion?.suggestedInput === "string"
        ? suggestion.suggestedInput
        : suggestedSentences.join(" "),
    });
  }

  return suggestions;
}

export function buildVisitNoteTextInputSuggestionPrompt(input: {
  visitNoteKey: string;
  visitType: VisitNoteType;
  status?: string | null;
  facts: VisitNoteFact[];
  matchedPocItems: VisitNotePocMappingResult["matchedPocItems"];
  candidates: VisitNoteTextInputSuggestionCandidate[];
}): string {
  const candidates = withDetailsToPreserve({
    candidates: input.candidates,
    facts: input.facts,
  });
  return [
    "Return line-delimited records only. Do not include markdown, commentary, bullets, numbering, or code fences.",
    "You are rewriting clinician-entered home-health Visit Note text so it reads clearly while preserving the original clinical content.",
    "Only create suggestedInput from clinician-entered Visit Note currentValue, sourceTexts, and detailsToPreserve supplied for that field.",
    "Do not add, infer, or suggest assessment findings, interventions, goals, education, patient responses, devices, measurements, dates, or plans that are not present in the supplied Visit Note source text.",
    "If the supplied Visit Note source text does not support a field, omit that SUGGESTION line.",
    "Each suggestedInput must be 1-5 complete sentences.",
    "Use plain, clear, professional clinician language. Do not sound legalistic or overly formal.",
    "The text should be suitable for a clinician to review and paste into the named input field.",
    "Do not use Plan of Care, referral, or OASIS content as source text for the recommendation.",
    "When rewriting an existing currentValue, preserve every concrete detail from that value and sourceTexts.",
    "Preserve all supplied measurements, counts, distances, scores, vitals, medication doses, frequencies, dates, device names, assist levels, and cueing details exactly when they appear in currentValue or detailsToPreserve.",
    "Do not generalize specific details. For example, do not rewrite '75 ft with FWW and vc/tc' as only 'ambulated with assistance'.",
    "Do not mention the dashboard, QA, AI, LLM, or that documentation was insufficient.",
    "Required output format:",
    "SUGGESTION|copy the supplied suggestionId exactly|1-5 sentence suggested input for the field",
    "Return one SUGGESTION line for each field. Do not use the pipe character inside the suggested input text.",
    "VISIT_NOTE_CONTEXT:",
    JSON.stringify({
      visitNoteKey: input.visitNoteKey,
      visitType: input.visitType,
      status: input.status ?? null,
      facts: input.facts.slice(0, 30).map((fact) => compactVisitNoteFact(fact, 320)),
    }),
    "FIELDS_NEEDING_SUGGESTIONS:",
    JSON.stringify(candidates.map((candidate) => ({
      suggestionId: candidate.suggestionId,
      fieldLabel: candidate.fieldLabel,
      sectionLabel: candidate.sectionLabel,
      currentValue: candidate.currentValue,
      reason: candidate.reason,
      relatedPocProblemTitle: candidate.relatedPocProblemTitle,
      detailsToPreserve: candidate.detailsToPreserve ?? [],
      sourceTexts: candidate.sourceTexts ?? [],
    }))),
  ].join("\n");
}

export async function runVisitNoteTextInputSuggestionLlm(input: {
  visitNoteKey: string;
  visitType: VisitNoteType;
  status?: string | null;
  facts: VisitNoteFact[];
  matchedPocItems: VisitNotePocMappingResult["matchedPocItems"];
  candidates: VisitNoteTextInputSuggestionCandidate[];
  env?: FinaleBatchEnv;
  invokeText?: VisitNoteTextInputSuggestionLlmInvoke;
}): Promise<{ suggestions: VisitNoteTextInputSuggestion[]; warnings: string[]; promptTokenEstimate: number }> {
  if (input.candidates.length === 0) {
    return { suggestions: [], warnings: [], promptTokenEstimate: 0 };
  }
  if (!input.invokeText && !isVisitNotePocMappingLlmEnabled(input.env)) {
    return {
      suggestions: [],
      warnings: ["Visit Note text input suggestions require the Visit Note LLM to be enabled."],
      promptTokenEstimate: 0,
    };
  }
  const candidates = withDetailsToPreserve({
    candidates: input.candidates,
    facts: input.facts,
  });
  const prompt = buildVisitNoteTextInputSuggestionPrompt({
    ...input,
    candidates,
  });
  let promptTokenEstimate = Math.ceil(prompt.length / 4);
  try {
    const invoked = input.invokeText
      ? { content: await input.invokeText(prompt), invocationModelId: "test-invoker" }
      : await invokeBedrock({ env: input.env!, prompt });
    const suggestions = parseVisitNoteTextInputSuggestionsLlmJson(invoked.content, candidates);
    const suggestedIds = new Set(suggestions.map((suggestion) => suggestion.suggestionId));
    const missingCandidates = candidates.filter((candidate) => !suggestedIds.has(candidate.suggestionId));
    const warnings: string[] = [];

    for (const candidate of missingCandidates) {
      const singlePrompt = buildVisitNoteTextInputSuggestionPrompt({
        ...input,
        candidates: [candidate],
      });
      promptTokenEstimate += Math.ceil(singlePrompt.length / 4);
      try {
        const singleInvoked = input.invokeText
          ? { content: await input.invokeText(singlePrompt), invocationModelId: "test-invoker" }
          : await invokeBedrock({ env: input.env!, prompt: singlePrompt });
        const singleSuggestions = parseVisitNoteTextInputSuggestionsLlmJson(singleInvoked.content, [candidate]);
        for (const suggestion of singleSuggestions) {
          if (!suggestedIds.has(suggestion.suggestionId)) {
            suggestions.push(suggestion);
            suggestedIds.add(suggestion.suggestionId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Visit Note text input suggestion LLM failed for ${candidate.fieldLabel}. ${sanitizeClinicalSnippet(message, 180)}`);
      }
    }
    const remainingMissing = candidates.filter((candidate) => !suggestedIds.has(candidate.suggestionId));
    for (const candidate of remainingMissing) {
      if ((candidate.detailsToPreserve ?? []).length > 0) {
        warnings.push(`Visit Note text input suggestion for ${candidate.fieldLabel} did not preserve required note details and was not used.`);
      }
    }

    return {
      suggestions,
      warnings,
      promptTokenEstimate,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackSuggestions: VisitNoteTextInputSuggestion[] = [];
    const fallbackWarnings = [`Visit Note text input suggestion LLM bulk response failed. ${sanitizeClinicalSnippet(message, 180)}`];
    if (candidates.length > 1) {
      for (const candidate of candidates) {
        const singlePrompt = buildVisitNoteTextInputSuggestionPrompt({
          ...input,
          candidates: [candidate],
        });
        promptTokenEstimate += Math.ceil(singlePrompt.length / 4);
        try {
          const singleInvoked = input.invokeText
            ? { content: await input.invokeText(singlePrompt), invocationModelId: "test-invoker" }
            : await invokeBedrock({ env: input.env!, prompt: singlePrompt });
          fallbackSuggestions.push(...parseVisitNoteTextInputSuggestionsLlmJson(singleInvoked.content, [candidate]));
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          fallbackWarnings.push(`Visit Note text input suggestion LLM failed for ${candidate.fieldLabel}. ${sanitizeClinicalSnippet(fallbackMessage, 180)}`);
        }
      }
    }
    if (fallbackSuggestions.length > 0) {
      return {
        suggestions: fallbackSuggestions,
        warnings: fallbackWarnings,
        promptTokenEstimate,
      };
    }
    return {
      suggestions: [],
      warnings: [`Visit Note text input suggestion LLM failed; no suggested field text was generated. ${sanitizeClinicalSnippet(message, 220)}`],
      promptTokenEstimate,
    };
  }
}

export function buildVisitNotePocAlignmentPrompt(input: {
  visitType: VisitNoteType;
  factCount: number;
}): string {
  const expectations = getVisitNoteDisciplineExpectations(input.visitType);
  return [
    "Return strict JSON only.",
    "Evaluate whether this visit note supports the Plan of Care for its discipline.",
    `Visit type: ${input.visitType}.`,
    `Expected documentation: ${expectations.expectations.join("; ")}.`,
    `Visit-note fact count: ${input.factCount}.`,
    "Allowed verdicts: aligned, partially_aligned, not_aligned, insufficient_documentation, positive_progress, possible_update_needed, contradiction, missed_visit, incomplete_note, capture_needed, capture_failed, not_applicable.",
    "Classify plausible improvement in a newer note as positive_progress or possible_update_needed, not automatic contradiction.",
    "Return visitNoteFactIds, pocEvidenceIds, oasisFactIds, confidence, and rationale.",
    "Use insufficient_documentation when facts are too sparse.",
  ].join(" ");
}

export function analyzeVisitNotePocAlignment(input: {
  visitType: VisitNoteType;
  facts: VisitNoteFact[];
  alignedPocGoals: string[];
  pocEvidenceIds?: string[];
}): VisitNotePocAlignmentResult {
  if (input.visitType === "others") {
    return {
      verdict: "not_applicable",
      confidence: 0.72,
      visitNoteFactIds: [],
      pocEvidenceIds: input.pocEvidenceIds ?? [],
      rationale: "Unknown or administrative visit-note type is counted but not POC-aligned in VN-1.",
    };
  }
  if (input.facts.length === 0) {
    return {
      verdict: "insufficient_documentation",
      confidence: 0.78,
      visitNoteFactIds: [],
      pocEvidenceIds: input.pocEvidenceIds ?? [],
      rationale: "No extracted visit-note facts are available to prove Plan of Care alignment.",
    };
  }
  const factIds = input.facts.map((fact) => fact.factId);
  const hasPatientResponse = input.facts.some((fact) => fact.category === "patient_response" || fact.category === "goals_addressed");
  const hasIncompleteFields = input.facts.some((fact) => fact.category === "incomplete_field");
  const hasDisciplineCare = input.facts.some((fact) =>
    [
      "mobility",
      "therapy_exercises",
      "skilled_interventions",
      "respiratory",
      "medication",
      "adl_ability",
      "homebound",
      "safety",
      "pain",
      "diagnosis",
      "follow_up_plan",
      "care_coordination",
      "discharge_planning",
      "documentation_text",
    ].includes(fact.category),
  );
  if (hasDisciplineCare && input.alignedPocGoals.length > 0 && !hasIncompleteFields) {
    return {
      verdict: "aligned",
      confidence: 0.86,
      visitNoteFactIds: factIds,
      pocEvidenceIds: input.pocEvidenceIds ?? [],
      rationale: hasPatientResponse
        ? "Visit-note facts identify related care and patient response for the Plan of Care."
        : "Visit-note facts identify related care for the Plan of Care.",
    };
  }
  return {
    verdict: hasIncompleteFields ? "insufficient_documentation" : hasDisciplineCare ? "partially_aligned" : "not_aligned",
    confidence: hasDisciplineCare ? 0.74 : 0.68,
    visitNoteFactIds: factIds,
    pocEvidenceIds: input.pocEvidenceIds ?? [],
    rationale: hasIncompleteFields
      ? "Visit-note facts include blank required text fields."
      : hasDisciplineCare
        ? "Visit-note facts show related care, but the matched Plan of Care diagnosis remains uncertain."
        : "Extracted facts do not identify a related Plan of Care diagnosis.",
  };
}
