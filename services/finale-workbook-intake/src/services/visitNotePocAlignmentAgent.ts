import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { VisitNoteFact, VisitNoteType } from "@medical-ai-qa/shared-types";
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

function compactVisitNoteFact(fact: VisitNoteFact) {
  return {
    factId: fact.factId,
    category: fact.category,
    normalizedValue: sanitizeClinicalSnippet(fact.normalizedValue, 180),
    snippet: sanitizeClinicalSnippet(fact.rawSnippet ?? "", 180) || null,
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
    "Map only POC items supported by Visit Note evidence. Do not invent matches.",
    "Use insufficient_documentation when the note does not prove a POC problem, goal, or intervention was addressed.",
    "Use contradiction only when the Visit Note clearly conflicts with the supplied POC.",
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
      rationale: "one short evidence-grounded reason",
      missingDocumentation: ["required detail missing from the note"],
      contradictions: ["clear conflict with POC"],
      pocUpdateSignals: ["visit-note fact id suggesting POC update"],
    }),
    "VISIT_NOTE:",
    JSON.stringify({
      visitNoteKey: input.visitNoteKey,
      visitType: input.visitType,
      status: input.status ?? null,
      lifecycleStatus: input.lifecycleStatus ?? null,
      visitDate: input.visitDate ?? null,
      facts: input.facts.slice(0, 24).map(compactVisitNoteFact),
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
    return {
      status: "success",
      mappingResult: {
        ...mappingResult,
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
  const hasDisciplineCare = input.facts.some((fact) =>
    ["mobility", "therapy_exercises", "skilled_interventions", "respiratory", "medication", "adl_ability"].includes(fact.category),
  );
  if (hasDisciplineCare && hasPatientResponse && input.alignedPocGoals.length > 0) {
    return {
      verdict: "aligned",
      confidence: 0.86,
      visitNoteFactIds: factIds,
      pocEvidenceIds: input.pocEvidenceIds ?? [],
      rationale: "Visit-note facts include discipline-relevant care and patient response with related POC goals.",
    };
  }
  return {
    verdict: hasDisciplineCare ? "partially_aligned" : "not_aligned",
    confidence: hasDisciplineCare ? 0.74 : 0.68,
    visitNoteFactIds: factIds,
    pocEvidenceIds: input.pocEvidenceIds ?? [],
    rationale: hasDisciplineCare
      ? "Visit-note facts show relevant care but do not fully document response or matching POC goal progress."
      : "Extracted facts do not show discipline-relevant Plan of Care work.",
  };
}
