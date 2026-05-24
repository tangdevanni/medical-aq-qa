import type { VisitNoteFact, VisitNoteType } from "@medical-ai-qa/shared-types";
import type { VisitNotePocMappingResult } from "@medical-ai-qa/shared-types";
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
