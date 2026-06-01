import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type {
  PlanOfCareReviewDraftArtifact,
  VisitNoteFact,
  VisitNoteFactPack,
  VisitNotePocMappingResult,
  VisitNoteProcessingManifest,
  VisitNoteQaFinding,
  VisitNoteQaReviewArtifact,
  VisitNoteTextInputSuggestion,
  VisitNotesDiscoveryArtifact,
} from "@medical-ai-qa/shared-types";
import type { FinaleBatchEnv } from "../config/env";
import { buildVisitNoteCacheKey } from "../portal/services/visitNotesControlledCaptureService";
import {
  determineVisitNoteCaptureEligibility,
} from "./visitNoteNormalizationService";
import {
  analyzeVisitNotePocAlignment,
  runVisitNotePocMappingLlm,
  runVisitNoteTextInputSuggestionLlm,
  type VisitNoteTextInputSuggestionCandidate,
  type VisitNotePocMappingLlmInvoke,
  type VisitNoteTextInputSuggestionLlmInvoke,
} from "./visitNotePocAlignmentAgent";
import { summarizeVisitNoteForReviewer } from "./visitNoteSummaryAgent";

export const VISIT_NOTE_PROCESSING_MANIFEST_FILE_NAME = "visit-note-processing-manifest.json";
export const VISIT_NOTE_QA_REVIEW_FILE_NAME = "visit-note-qa-review.json";
const VISIT_NOTE_POC_MAPPING_LOGIC_VERSION = "diagnosis-discrepancy-v4";

function shouldReviewVisitNote(row: { captureEligibility?: string | null }): boolean {
  return row.captureEligibility === "active_monitoring" || row.captureEligibility === "finalized_no_active_monitoring";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value ?? null));
}

function factsByCategory(factPack: VisitNoteFactPack, category: string) {
  return factPack.facts.filter((fact) => fact.category === category);
}

function factsForRow(factPack: VisitNoteFactPack | null, visitNoteKey: string): VisitNoteFact[] {
  return factPack?.facts.filter((fact) => fact.visitNoteKey === visitNoteKey) ?? [];
}

function collectOasisConstraintEvidence(oasisClinicalFactPack: unknown): {
  hasSevereMobilityConstraint: boolean;
  evidenceIds: string[];
} {
  const record = typeof oasisClinicalFactPack === "object" && oasisClinicalFactPack !== null
    ? oasisClinicalFactPack as { facts?: unknown[] }
    : {};
  const facts = Array.isArray(record.facts) ? record.facts : [];
  const evidenceIds: string[] = [];
  let hasSevereMobilityConstraint = false;
  for (const fact of facts) {
    const factRecord = typeof fact === "object" && fact !== null ? fact as Record<string, unknown> : null;
    const category = typeof factRecord?.category === "string" ? factRecord.category.toLowerCase() : "";
    const text = [
      factRecord?.normalizedValue,
      factRecord?.rawValue,
      factRecord?.evidenceSnippet,
    ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
    if (
      /(mobility|functional|safety|homebound)/.test(category) &&
      /(chair|bedbound|wheelchair|requires assist|dependent|severe|cannot ambulate)/.test(text)
    ) {
      hasSevereMobilityConstraint = true;
      if (typeof factRecord?.factId === "string") {
        evidenceIds.push(factRecord.factId);
      }
    }
  }
  return { hasSevereMobilityConstraint, evidenceIds };
}

function getPocGoalsForVisitType(planOfCare: PlanOfCareReviewDraftArtifact | null, visitType: string): string[] {
  return getPocTargetsForVisitType(planOfCare, visitType)
    .flatMap((target) => target.goalTexts)
    .filter((goal, index, goals) => goals.indexOf(goal) === index)
    .slice(0, 5);
}

type VisitNotePocTarget = {
  problemKey: string;
  problemTitle: string;
  problemStatement?: string;
  goalTexts: string[];
  interventionTexts: string[];
  evidenceIds: string[];
  clinicalDomain?: string;
};

function getPocTargetsForVisitType(planOfCare: PlanOfCareReviewDraftArtifact | null, visitType: string): VisitNotePocTarget[] {
  if (!planOfCare) {
    return [];
  }
  const domainSignals =
    visitType === "physical_therapy" ? [/mobility|fall|weakness|strength/i] :
    visitType === "skilled_nursing" ? [/respiratory|cardiac|medication|skilled|wound/i] :
    visitType === "speech_therapy" ? [/swallow|dysphagia|nutrition/i] :
    visitType === "occupational_therapy" ? [/adl|functional|self-care|mobility/i] :
    visitType === "home_health_aide" ? [/adl|bathing|personal care/i] :
    visitType === "medical_social_worker" ? [/psychosocial|caregiver|support|safety/i] :
    visitType === "registered_dietitian" ? [/nutrition|diet|swallow/i] :
    visitType === "respiratory_therapy" ? [/respiratory|oxygen|breath/i] :
    [];

  const targets: VisitNotePocTarget[] = [];
  for (const draft of planOfCare.diagnosisDrafts) {
    const haystack = `${draft.clinicalDomain ?? ""} ${draft.diagnosisLabel} ${draft.problem.selectedText} ${draft.goal.selectedText}`;
    if (domainSignals.some((pattern) => pattern.test(haystack))) {
      targets.push({
        problemKey: draft.diagnosisKey,
        problemTitle: draft.diagnosisLabel,
        problemStatement: draft.problem.selectedText,
        goalTexts: [draft.goal.selectedText],
        interventionTexts: draft.interventions.map((intervention) => intervention.selectedText),
        evidenceIds: [
          ...draft.problem.evidenceFactIds,
          ...draft.goal.evidenceFactIds,
          ...draft.interventions.flatMap((intervention) => intervention.evidenceFactIds),
        ],
        clinicalDomain: draft.clinicalDomain,
      });
    }
  }
  for (const group of planOfCare.carePlanProblemGroups ?? []) {
    const haystack = `${group.clinicalDomain ?? ""} ${group.problemTitle} ${group.problemStatement}`;
    if (domainSignals.some((pattern) => pattern.test(haystack))) {
      targets.push({
        problemKey: group.groupKey,
        problemTitle: group.problemTitle,
        problemStatement: group.problemStatement,
        goalTexts: group.goals.map((goal) => goal.text),
        interventionTexts: group.interventions.map((intervention) => intervention.text),
        evidenceIds: [
          ...group.evidenceFactIds,
          ...group.goals.flatMap((goal) => goal.evidenceFactIds),
          ...group.interventions.flatMap((intervention) => intervention.evidenceFactIds),
        ],
        clinicalDomain: group.clinicalDomain,
      });
    }
  }
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.problemKey}:${target.problemTitle}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeTerms(value: string): Set<string> {
  const stopWords = new Set([
    "and", "the", "with", "for", "from", "that", "this", "will", "patient", "caregiver",
    "within", "home", "health", "skilled", "visit", "note", "define", "measurable", "goal",
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !stopWords.has(term)),
  );
}

function factSearchText(fact: VisitNoteFact): string {
  return [
    fact.category,
    fact.normalizedValue,
    fact.rawSnippet,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function scoreTextOverlap(left: string, right: string): number {
  const leftTerms = normalizeTerms(left);
  const rightTerms = normalizeTerms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(leftTerms.size, rightTerms.size);
}

function defaultInterventionSignalForVisitType(visitType: string): RegExp {
  if (visitType === "physical_therapy") {
    return /mobility|transfer|ambulat|gait|fall|exercise|strength|range of motion|rom/i;
  }
  if (visitType === "skilled_nursing") {
    return /assess|teach|instruct|medication|respiratory|cardiac|wound|vital|monitor|pneumonia|pain/i;
  }
  if (visitType === "occupational_therapy") {
    return /adl|self-care|transfer|bathing|dressing|grooming|mobility/i;
  }
  if (visitType === "speech_therapy") {
    return /swallow|dysphagia|speech|communication|nutrition/i;
  }
  return /assess|teach|instruct|monitor|safety|care|intervention|goal|progress/i;
}

function buildPocProblemMatches(input: {
  visitType: string;
  facts: VisitNoteFact[];
  targets: VisitNotePocTarget[];
}): VisitNoteQaReviewArtifact["noteSummaries"][number]["pocProblemMatches"] {
  if (input.facts.length === 0 || input.targets.length === 0) {
    return [];
  }
  const factText = input.facts.map(factSearchText).join(" ");
  const defaultSignal = defaultInterventionSignalForVisitType(input.visitType);
  return input.targets
    .map((target) => {
      const targetText = [
        target.problemTitle,
        target.problemStatement,
        ...target.goalTexts,
        ...target.interventionTexts,
      ].filter(Boolean).join(" ");
      const overlapScore = scoreTextOverlap(factText, targetText);
      const matchedInterventions = target.interventionTexts
        .map((intervention) => ({
          intervention,
          score: Math.max(scoreTextOverlap(factText, intervention), defaultSignal.test(intervention) ? 0.28 : 0),
        }))
        .filter((entry) => entry.score >= 0.18)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map((entry) => entry.intervention);
      const confidence = Math.min(
        0.92,
        Math.max(
          overlapScore,
          matchedInterventions.length > 0 ? 0.68 : 0,
          input.facts.some((fact) => ["patient_response", "goals_addressed"].includes(fact.category)) ? 0.72 : 0,
        ),
      );
      return {
        problemKey: target.problemKey,
        problemTitle: target.problemTitle,
        ...(target.problemStatement ? { problemStatement: target.problemStatement } : {}),
        interventionTexts: matchedInterventions,
        matchedFactIds: input.facts.map((fact) => fact.factId),
        confidence,
        rationale: matchedInterventions.length > 0
          ? "Visit-note facts overlap with this Plan of Care problem and one or more interventions."
          : "Visit-note facts overlap with this Plan of Care problem, but no specific intervention text was strongly matched.",
      };
    })
    .filter((match) => match.confidence >= 0.4)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);
}

function buildTextInputSuggestionCandidates(input: {
  row: VisitNotesDiscoveryArtifact["rows"][number];
  facts: VisitNoteFact[];
  pocMappingResult: VisitNotePocMappingResult;
  pocProblemMatches: VisitNoteQaReviewArtifact["noteSummaries"][number]["pocProblemMatches"];
}): VisitNoteTextInputSuggestionCandidate[] {
  const suggestionFacts = input.facts.filter((fact) =>
    fact.category === "incomplete_field" || fact.category === "thin_text_field",
  );
  const byField = new Map<string, VisitNoteFact>();
  for (const fact of suggestionFacts) {
    const fieldText = `${fact.fieldLabel ?? ""} ${fact.fieldKey ?? ""}`.toLowerCase();
    const isBlank = fact.category === "incomplete_field";
    if (isBlank && /\b(discharge plan.*others?|others?\s*\(specify\)|teaching\/training of|type of intervention)\b/.test(fieldText)) {
      continue;
    }
    const fieldKey = fact.fieldKey ?? fact.fieldLabel ?? fact.factId;
    if (!byField.has(fieldKey)) {
      byField.set(fieldKey, fact);
    }
  }

  function candidatePriority(candidate: VisitNoteTextInputSuggestionCandidate): number {
    const text = `${candidate.fieldLabel} ${candidate.fieldKey ?? ""}`.toLowerCase();
    if (/\b(other homebound reason|visit narrative|plan for next|next visit)\b/.test(text)) {
      return 0;
    }
    if (/\b(subjective|impact of intervention|patient response|training\/intervention|provide further information|identified strengths|reason)\b/.test(text)) {
      return 1;
    }
    if (candidate.currentValue) {
      return 2;
    }
    if (/\b(discharge plan.*others?|others?\s*\(specify\)|teaching\/training of)\b/.test(text)) {
      return 5;
    }
    return 3;
  }

  function cleanFieldLabel(input: { fieldKey?: string | null; fieldLabel: string }): string {
    const key = input.fieldKey?.toLowerCase() ?? "";
    const label = input.fieldLabel.replace(/\s+/g, " ").trim();
    const comparable = `${key} ${label}`.toLowerCase();
    if (/fmbedmob/i.test(input.fieldKey ?? "")) {
      return /training/i.test(comparable) ? "Bed Mobility Training" : "Bed Mobility Response";
    }
    if (/fmtransfer/i.test(input.fieldKey ?? "")) {
      return /training/i.test(comparable) ? "Transfer Training" : "Transfer Response";
    }
    if (/fmgait/i.test(input.fieldKey ?? "")) {
      return /training/i.test(comparable) ? "Gait Training" : "Gait Response";
    }
    if (/fmwheelchair/i.test(input.fieldKey ?? "")) {
      return "Wheelchair Mobility Response";
    }
    if (key === "planfornextvisitcomment" || /\bplan for next visit|follow-up assessments for the next visit\b/.test(comparable)) {
      return "Plan for Next Visit";
    }
    if (key === "visitnarrativecomment" || /\bvisit narrative|summarize key findings\b/.test(comparable)) {
      return "Visit Narrative";
    }
    if (key === "ptsubjectiveinfo" || /\bsubjective information\b/.test(comparable)) {
      return "Subjective Information";
    }
    if (key === "patientptdiagnosis" || /\bpt diagnosis\b/.test(comparable)) {
      return "PT Diagnosis";
    }
    if (/\bother homebound reason\b/.test(comparable)) {
      return "Other Homebound Reason";
    }
    if (/\bimpact of intervention/.test(comparable)) {
      return "Patient Response to Intervention";
    }
    if (/\btraining\/intervention\b/.test(comparable)) {
      return "Training/Intervention";
    }
    if (/\bprovide further information\b/.test(comparable)) {
      return "Additional Clinical Detail";
    }
    if (/\bidentified strengths and supports\b/.test(comparable)) {
      return "Strengths and Supports";
    }
    return label.replace(/\s*:\s*$/g, "");
  }

  return Array.from(byField.values())
    .map((fact, index) => {
      const rawFieldLabel =
        (fact.fieldLabel ??
        fact.normalizedValue.replace(/\s+is blank\.?$/i, "").trim()) ||
        "Visit Note text field";
      const fieldLabel = cleanFieldLabel({
        fieldKey: fact.fieldKey ?? null,
        fieldLabel: rawFieldLabel,
      });
      const reason: VisitNoteTextInputSuggestion["reason"] =
        fact.category === "incomplete_field"
          ? "blank"
          : fact.normalizedValue.split(/\s+/).filter(Boolean).length < 8
            ? "too_short"
            : "not_descriptive";
      const relatedPocProblemTitle =
        input.pocMappingResult.matchedPocItems[0]?.problemTitle ??
        input.pocProblemMatches[0]?.problemTitle ??
        null;
      return {
        suggestionId: `visit-note-suggestion:${input.row.visitNoteKey}:${fact.fieldKey ?? index}`,
        visitNoteKey: input.row.visitNoteKey,
        fieldKey: fact.fieldKey ?? null,
        fieldLabel,
        sectionLabel: fact.sectionLabel ?? null,
        currentValue: fact.category === "thin_text_field" ? fact.normalizedValue : null,
        reason,
        relatedPocProblemTitle,
        sourceFactIds: [fact.factId],
        confidence: reason === "blank" ? 0.82 : 0.74,
      };
    })
    .sort((left, right) =>
      candidatePriority(left) - candidatePriority(right) ||
      (left.currentValue ? -1 : 1) - (right.currentValue ? -1 : 1) ||
      left.fieldLabel.localeCompare(right.fieldLabel),
    )
    .slice(0, 4);
}

function buildVisitNotePocMappingResult(input: {
  row: VisitNotesDiscoveryArtifact["rows"][number];
  facts: VisitNoteFact[];
  targets: VisitNotePocTarget[];
  alignment: ReturnType<typeof analyzeVisitNotePocAlignment>;
  pocProblemMatches: VisitNoteQaReviewArtifact["noteSummaries"][number]["pocProblemMatches"];
  possibleContradictions: string[];
}): VisitNotePocMappingResult {
  const matchedTargets = input.pocProblemMatches
    .map((match) => {
      const target = input.targets.find((candidate) => candidate.problemKey === match.problemKey);
      return {
        problemKey: match.problemKey,
        problemTitle: match.problemTitle,
        goalTexts: target?.goalTexts ?? [],
        interventionTexts: match.interventionTexts.length > 0 ? match.interventionTexts : target?.interventionTexts.slice(0, 3) ?? [],
        evidenceIds: target?.evidenceIds ?? [],
      };
    });
  const incompleteFieldMessages = input.facts
    .filter((fact) => fact.category === "incomplete_field")
    .map((fact) => fact.normalizedValue);
  const missingDocumentation: string[] = [...incompleteFieldMessages];
  const reviewable = shouldReviewVisitNote(input.row);
  if (reviewable && input.facts.length === 0) {
    missingDocumentation.push("No usable clinical facts were extracted from this active Visit Note.");
  }
  if (matchedTargets.length === 0 && reviewable) {
    missingDocumentation.push("No related Plan of Care diagnosis was identified from this Visit Note.");
  }
  const pocUpdateSignals = input.facts
    .filter((fact) => /(wound|pain|decline|worse|new|change|fall|medication)/i.test(`${fact.category} ${fact.normalizedValue} ${fact.rawSnippet ?? ""}`))
    .map((fact) => fact.factId);
  let alignmentStatus: VisitNotePocMappingResult["alignmentStatus"];
  if (input.possibleContradictions.length > 0) {
    alignmentStatus = "contradiction";
  } else if (matchedTargets.length > 0 && missingDocumentation.length === 0) {
    alignmentStatus = "aligned";
  } else if (matchedTargets.length > 0 && missingDocumentation.length > 0) {
    alignmentStatus = "partially_aligned";
  } else if (
    input.alignment.verdict === "aligned" ||
    input.alignment.verdict === "partially_aligned" ||
    input.alignment.verdict === "not_aligned" ||
    input.alignment.verdict === "insufficient_documentation"
  ) {
    alignmentStatus = input.alignment.verdict;
  } else if (input.alignment.verdict === "contradiction") {
    alignmentStatus = "contradiction";
  } else {
    alignmentStatus = "needs_review";
  }

  return {
    visitNoteKey: input.row.visitNoteKey,
    mappingStatus: reviewable ? "deterministic_only" : "skipped",
    mappingSource: reviewable ? "deterministic" : "skipped",
    alignmentStatus,
    matchStrength: Math.max(input.alignment.confidence, ...input.pocProblemMatches.map((match) => match.confidence), 0),
    matchedPocItems: matchedTargets,
    visitNoteEvidence: input.facts.map((fact) => fact.factId),
    rationale: input.alignment.rationale,
    missingDocumentation: Array.from(new Set(missingDocumentation)),
    contradictions: input.possibleContradictions,
    pocUpdateSignals: Array.from(new Set(pocUpdateSignals)),
  };
}

function buildPocMappingInputHash(input: {
  row: VisitNotesDiscoveryArtifact["rows"][number];
  facts: VisitNoteFact[];
  targets: VisitNotePocTarget[];
  planOfCareHash?: string | null;
  oasisFactPackHash?: string | null;
  manifestEntry?: VisitNoteProcessingManifest["visitNoteInputs"][number] | null;
}): string {
  return hashJson({
    mappingLogicVersion: VISIT_NOTE_POC_MAPPING_LOGIC_VERSION,
    visitNoteKey: input.row.visitNoteKey,
    rowTextHash: input.row.rowTextHash,
    contentHash: input.manifestEntry?.contentHash ?? input.row.sourceUrlHash ?? input.row.portalDocumentId ?? input.row.visitNoteKey,
    textHash: input.manifestEntry?.textHash ?? null,
    facts: input.facts.map((fact) => ({
      factId: fact.factId,
      category: fact.category,
      normalizedValue: fact.normalizedValue,
      rawSnippet: fact.rawSnippet ?? null,
    })),
    pocTargets: input.targets,
    planOfCareHash: input.planOfCareHash ?? null,
    oasisFactPackHash: input.oasisFactPackHash ?? null,
  });
}

function findReusablePocMappingResult(input: {
  previousReview?: VisitNoteQaReviewArtifact | null;
  visitNoteKey: string;
  inputHash: string;
}): VisitNotePocMappingResult | null {
  const previous = input.previousReview?.noteSummaries
    .find((summary) => summary.visitNoteKey === input.visitNoteKey)
    ?.pocMappingResult;
  if (
    previous?.inputHash === input.inputHash &&
    (previous.mappingSource === "llm" || previous.mappingSource === "cache") &&
    (previous.mappingStatus === "success" || previous.mappingStatus === "reused")
  ) {
    return {
      ...previous,
      mappingStatus: "reused",
      mappingSource: "cache",
    };
  }
  return null;
}

function diagnosisContextFromPlanOfCare(planOfCare: PlanOfCareReviewDraftArtifact | null): string[] {
  return [
    ...(planOfCare?.diagnosisDrafts ?? []).map((draft) =>
      `${draft.diagnosisKey}: ${draft.diagnosisLabel}${draft.clinicalDomain ? ` (${draft.clinicalDomain})` : ""}`),
    ...(planOfCare?.carePlanProblemGroups ?? []).map((group) =>
      `${group.groupKey}: ${group.problemTitle}${group.clinicalDomain ? ` (${group.clinicalDomain})` : ""}`),
  ];
}

export function buildVisitNoteProcessingManifest(input: {
  patientRunId: string;
  discovery: VisitNotesDiscoveryArtifact | null;
  planOfCareHash: string;
  oasisFactPackHash: string;
  previousManifest?: VisitNoteProcessingManifest | null;
  textHashesByVisitNoteKey?: Record<string, string>;
  visitNoteOcrFallbackEnabled?: boolean;
  generatedAt?: string;
}): VisitNoteProcessingManifest {
  const discoveryHash = hashJson(input.discovery);
  const previousByKey = new Map((input.previousManifest?.visitNoteInputs ?? []).map((entry) => [entry.visitNoteKey, entry]));
  const activeKeys = new Set((input.discovery?.rows ?? []).map((row) => row.visitNoteKey));
  const visitNoteInputs: VisitNoteProcessingManifest["visitNoteInputs"] = (input.discovery?.rows ?? []).map((row) => {
    const previous = previousByKey.get(row.visitNoteKey);
    const textHash = input.textHashesByVisitNoteKey?.[row.visitNoteKey];
    const eligibility = row.captureEligibility
      ? { captureEligibility: row.captureEligibility, lifecycleStatus: row.lifecycleStatus ?? row.captureEligibility, skipReason: row.skipReason }
      : determineVisitNoteCaptureEligibility({
        normalizedVisitType: row.normalizedVisitType,
        normalizedStatus: row.normalizedStatus,
        rawDocumentType: row.rawDocumentType,
      });
    const shouldAnalyze = shouldReviewVisitNote(eligibility);
    const contentHash = row.sourceUrlHash ?? row.portalDocumentId ?? row.visitNoteKey;
    const analysisInputHash = hashJson({
      visitNoteKey: row.visitNoteKey,
      contentHash,
      textHash,
      planOfCareHash: input.planOfCareHash,
      oasisFactPackHash: input.oasisFactPackHash,
    });
    const extractionSource: VisitNoteProcessingManifest["visitNoteInputs"][number]["extractionSource"] =
      !shouldAnalyze || row.captureStatus !== "captured"
        ? "skipped"
          : previous?.contentHash === contentHash && previous?.textHash === textHash
            ? "cache"
            : textHash
              ? "text_export"
              : input.visitNoteOcrFallbackEnabled === true
                ? "new_ocr"
                : "skipped";
    const llmAnalysisSource: VisitNoteProcessingManifest["visitNoteInputs"][number]["llmAnalysisSource"] =
      !shouldAnalyze
        ? "skipped"
        : previous?.analysisInputHash === analysisInputHash
        ? "cache"
        : textHash
          ? "new_llm"
          : "skipped";
    const rerunReason =
      previous && previous.analysisInputHash !== analysisInputHash
        ? previous.textHash === textHash && previous.contentHash === contentHash
          ? "plan_of_care_or_oasis_hash_changed"
          : "visit_note_content_changed"
        : !previous
          ? "new_visit_note"
          : undefined;

    return {
      visitNoteKey: row.visitNoteKey,
      rowTextHash: row.rowTextHash,
      ...(contentHash ? { contentHash } : {}),
      ...(textHash ? { textHash } : {}),
      cacheKey: buildVisitNoteCacheKey(row),
      lifecycleStatus: eligibility.lifecycleStatus,
      captureEligibility: eligibility.captureEligibility,
      captureStatus: row.captureStatus,
      extractionStatus: textHash
        ? "usable"
        : row.captureStatus === "captured"
          ? "failed"
          : "skipped",
      analysisStatus: llmAnalysisSource === "cache"
        ? "cache"
        : llmAnalysisSource === "new_llm"
          ? "ready"
          : "skipped",
      reviewStatus: llmAnalysisSource === "skipped" ? "unconfirmed" : "confirmed",
      retryCount: previous?.retryCount ?? 0,
      lastProcessedAt: input.generatedAt ?? new Date().toISOString(),
      ...(row.skipReason ? { failureReason: row.skipReason } : {}),
      extractionSource,
      llmAnalysisSource,
      analysisInputHash,
      ...(rerunReason ? { rerunReason } : {}),
    };
  });
  for (const previous of input.previousManifest?.visitNoteInputs ?? []) {
    if (activeKeys.has(previous.visitNoteKey)) {
      continue;
    }
    visitNoteInputs.push({
      ...previous,
      extractionSource: "skipped",
      llmAnalysisSource: "skipped",
      rerunReason: "visit_note_removed",
      inactive: true,
    });
  }

  return {
    schemaVersion: "visit-note-processing-manifest.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    patientRunId: input.patientRunId,
    planOfCareHash: input.planOfCareHash,
    oasisFactPackHash: input.oasisFactPackHash,
    visitNotesDiscoveryHash: discoveryHash,
    visitNoteInputs,
  };
}

export async function buildVisitNoteQaReview(input: {
  discovery: VisitNotesDiscoveryArtifact | null;
  factPack: VisitNoteFactPack | null;
  planOfCare: PlanOfCareReviewDraftArtifact | null;
  oasisClinicalFactPack: unknown;
  planOfCareHash?: string | null;
  oasisFactPackHash?: string | null;
  manifest?: VisitNoteProcessingManifest | null;
  previousReview?: VisitNoteQaReviewArtifact | null;
  env?: FinaleBatchEnv;
  invokePocMappingText?: VisitNotePocMappingLlmInvoke;
  invokeTextInputSuggestionText?: VisitNoteTextInputSuggestionLlmInvoke;
  forceRerunVisitNotes?: boolean;
  generatedAt?: string;
}): Promise<VisitNoteQaReviewArtifact> {
  const discovery = input.discovery;
  const factPack = input.factPack;
  if (!discovery) {
    return {
      schemaVersion: "visit-note-qa-review.v1",
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      status: "pending",
      summary: {
        totalVisitNotes: 0,
        eligibleVisitNotes: 0,
        analyzedVisitNotes: 0,
        skippedVisitNotes: 0,
        missedVisitNotes: 0,
        notStartedVisitNotes: 0,
        activeMonitoringCount: 0,
        qaCompleteFinalizedCount: 0,
        inProgressCount: 0,
        submittedCount: 0,
        qaPendingCount: 0,
        signedCount: 0,
        capturedVisitNotes: 0,
        reusedVisitNotes: 0,
        failedVisitNotes: 0,
        degradedVisitNotes: 0,
        cappedVisitNotes: 0,
        byVisitType: {} as VisitNoteQaReviewArtifact["summary"]["byVisitType"],
        byStatus: {},
        actionableFindingCount: 0,
        contradictionCount: 0,
        positiveProgressCount: 0,
        possibleUpdateNeededCount: 0,
        pocAlignmentIssueCount: 0,
        incompleteNoteCount: 0,
      },
      visitTypeStatusMatrix: [],
      visitTypeCounts: [],
      findings: [],
      noteSummaries: [],
      warnings: ["Visit Notes QA has not run because visit-note discovery is not available."],
    };
  }
  const discoveryRows = discovery.rows.map((row) => {
    const eligibility = determineVisitNoteCaptureEligibility({
      normalizedVisitType: row.normalizedVisitType,
      normalizedStatus: row.normalizedStatus,
      rawDocumentType: row.rawDocumentType,
    });
    return {
      ...row,
      captureEligibility: eligibility.captureEligibility,
      lifecycleStatus: eligibility.lifecycleStatus,
      skipReason: eligibility.skipReason ?? row.skipReason,
    };
  });
  const effectiveDiscovery: VisitNotesDiscoveryArtifact = {
    ...discovery,
    rows: discoveryRows,
  };

  const findings: VisitNoteQaFinding[] = [];
  const oasisConstraints = collectOasisConstraintEvidence(input.oasisClinicalFactPack);
  const independentMobilityFacts = factPack ? factsByCategory(factPack, "mobility")
    .filter((fact) => /independent/i.test(fact.normalizedValue)) : [];

  for (const fact of independentMobilityFacts) {
    if (!oasisConstraints.hasSevereMobilityConstraint) {
      continue;
    }
    findings.push({
      findingId: `visit-note-finding:${fact.visitNoteKey}:mobility-contradiction`,
      visitNoteKey: fact.visitNoteKey,
      visitType: fact.source.visitType,
      ...(fact.source.visitDate ? { visitDate: fact.source.visitDate } : {}),
      severity: "high",
      category: "contradiction",
      title: "Visit note mobility conflicts with OASIS/POC mobility limitation",
      description: "Visit note evidence suggests independent ambulation while OASIS/POC evidence indicates severe mobility limitation in the same review context.",
      visitNoteEvidence: [fact.factId],
      pocEvidence: [],
      oasisEvidence: oasisConstraints.evidenceIds,
      suggestedReviewerAction: "Confirm whether the visit note reflects interval improvement or an inconsistent mobility statement before accepting the documentation.",
      needsHumanReview: true,
      confidence: Math.min(0.9, fact.confidence),
    });
  }

  for (const row of effectiveDiscovery.rows) {
    const rowFacts = factsForRow(factPack, row.visitNoteKey);
    const alignedPocGoals = getPocGoalsForVisitType(input.planOfCare, row.normalizedVisitType);
    const alignment = analyzeVisitNotePocAlignment({
      visitType: row.normalizedVisitType,
      facts: rowFacts,
      alignedPocGoals,
    });
    if (
      shouldReviewVisitNote(row) &&
      rowFacts.length > 0 &&
      (alignment.verdict === "not_aligned" || alignment.verdict === "insufficient_documentation")
    ) {
      findings.push({
        findingId: `visit-note-finding:${row.visitNoteKey}:poc-alignment`,
        visitNoteKey: row.visitNoteKey,
        visitType: row.normalizedVisitType,
        ...(row.visitDate ? { visitDate: row.visitDate } : {}),
        severity: "medium",
        category: "poc_alignment",
        title: "Visit note needs diagnosis or POC discrepancy review",
        description: alignment.rationale,
        visitNoteEvidence: alignment.visitNoteFactIds,
        pocEvidence: alignment.pocEvidenceIds,
        oasisEvidence: [],
        suggestedReviewerAction: "Confirm the note identifies the related diagnosis or complete blank required text fields before sign-off.",
        needsHumanReview: true,
        confidence: alignment.confidence,
      });
    }
  }

  const manifestByKey = new Map((input.manifest?.visitNoteInputs ?? []).map((entry) => [entry.visitNoteKey, entry]));
  const diagnosisContext = diagnosisContextFromPlanOfCare(input.planOfCare);
  const noteSummaries: VisitNoteQaReviewArtifact["noteSummaries"] = [];
  const mappingWarnings: string[] = [];
  for (const row of effectiveDiscovery.rows) {
    const rowFacts = factsForRow(factPack, row.visitNoteKey);
    const pocTargets = getPocTargetsForVisitType(input.planOfCare, row.normalizedVisitType);
    const alignedPocGoals = pocTargets
      .flatMap((target) => target.goalTexts)
      .filter((goal, index, goals) => goals.indexOf(goal) === index)
      .slice(0, 5);
    const pocProblemMatches = buildPocProblemMatches({
      visitType: row.normalizedVisitType,
      facts: rowFacts,
      targets: pocTargets,
    });
    const status = row.normalizedStatus ?? row.statusRaw ?? "unknown";
    const possibleContradictions = findings
      .filter((finding) => finding.visitNoteKey === row.visitNoteKey && finding.category === "contradiction")
      .map((finding) => finding.title);
    const alignment = analyzeVisitNotePocAlignment({
      visitType: row.normalizedVisitType,
      facts: rowFacts,
      alignedPocGoals,
      pocEvidenceIds: pocTargets.flatMap((target) => target.evidenceIds),
    });
    const manifestEntry = manifestByKey.get(row.visitNoteKey);
    const mappingInputHash = buildPocMappingInputHash({
      row,
      facts: rowFacts,
      targets: pocTargets,
      planOfCareHash: input.planOfCareHash,
      oasisFactPackHash: input.oasisFactPackHash,
      manifestEntry,
    });
    const deterministicMapping = {
      ...buildVisitNotePocMappingResult({
        row,
        facts: rowFacts,
        targets: pocTargets,
        alignment,
        pocProblemMatches,
        possibleContradictions,
      }),
      inputHash: mappingInputHash,
    };
    let pocMappingResult: VisitNotePocMappingResult = deterministicMapping;
    const reusable = shouldReviewVisitNote(row) && !input.forceRerunVisitNotes
      ? findReusablePocMappingResult({
          previousReview: input.previousReview,
          visitNoteKey: row.visitNoteKey,
          inputHash: mappingInputHash,
        })
      : null;
    if (reusable) {
      pocMappingResult = reusable;
    } else if (shouldReviewVisitNote(row)) {
      const llmResult = await runVisitNotePocMappingLlm({
        visitNoteKey: row.visitNoteKey,
        visitType: row.normalizedVisitType,
        status,
        lifecycleStatus: row.lifecycleStatus ?? row.captureEligibility,
        visitDate: row.visitDate ?? null,
        facts: rowFacts,
        pocTargets,
        diagnosisContext,
        env: input.env,
        invokeText: input.invokePocMappingText,
      });
      if (llmResult.mappingResult) {
        pocMappingResult = {
          ...llmResult.mappingResult,
          inputHash: mappingInputHash,
        };
      } else if (llmResult.status === "failed_deterministic_only") {
        pocMappingResult = {
          ...deterministicMapping,
          mappingStatus: "degraded",
          mappingSource: "deterministic_only",
          errorReason: llmResult.warnings[0] ?? "Visit Note POC mapping LLM failed; deterministic mapping was retained.",
        };
        mappingWarnings.push(...llmResult.warnings);
      }
    }
    const textInputSuggestionCandidates = buildTextInputSuggestionCandidates({
      row,
      facts: rowFacts,
      pocMappingResult,
      pocProblemMatches,
    });
    const previousSuggestions = input.previousReview?.noteSummaries
      .find((summary) => summary.visitNoteKey === row.visitNoteKey)
      ?.textInputSuggestions ?? [];
    const candidateIds = new Set(textInputSuggestionCandidates.map((candidate) => candidate.suggestionId));
    const previousSuggestionIds = new Set(previousSuggestions.map((suggestion) => suggestion.suggestionId));
    const previousSuggestionsCoverCandidates =
      textInputSuggestionCandidates.length > 0 &&
      textInputSuggestionCandidates.every((candidate) => previousSuggestionIds.has(candidate.suggestionId));
    let textInputSuggestions: VisitNoteTextInputSuggestion[] = [];
    if (reusable && previousSuggestions.length > 0 && previousSuggestionsCoverCandidates) {
      textInputSuggestions = previousSuggestions.filter((suggestion) => candidateIds.has(suggestion.suggestionId));
    } else {
      const suggestionResult = await runVisitNoteTextInputSuggestionLlm({
        visitNoteKey: row.visitNoteKey,
        visitType: row.normalizedVisitType,
        status,
        facts: rowFacts,
        matchedPocItems: pocMappingResult.matchedPocItems,
        candidates: textInputSuggestionCandidates,
        env: input.env,
        invokeText: input.invokeTextInputSuggestionText,
      });
      textInputSuggestions = suggestionResult.suggestions;
      mappingWarnings.push(...suggestionResult.warnings);
    }
    const summary = summarizeVisitNoteForReviewer({
      visitType: row.normalizedVisitType,
      facts: rowFacts,
      missingFields: [],
      possibleContradictions,
    });
    noteSummaries.push({
      visitNoteKey: row.visitNoteKey,
      visitType: row.normalizedVisitType,
      ...(row.visitDate ? { visitDate: row.visitDate } : {}),
      status,
      ...(row.lifecycleStatus ? { lifecycleStatus: row.lifecycleStatus } : {}),
      captureStatus: row.captureStatus,
      analyzed: rowFacts.length > 0,
      analysisStatus: rowFacts.length > 0
        ? "ready" as const
        : row.captureStatus === "capture_pending_due_to_config_limit"
          ? "pending" as const
          : !shouldReviewVisitNote(row) || row.captureStatus === "skipped"
            ? "skipped" as const
            : "failed" as const,
      summary: summary.summary,
      missingFields: [],
      textInputSuggestions,
      alignedPocGoals,
      pocMappingResult,
      pocProblemMatches,
      possibleContradictions,
    });
  }

  const contradictionCount = findings.filter((finding) => finding.category === "contradiction").length;
  const positiveProgressCount = findings.filter((finding) => finding.category === "positive_progress").length;
  const possibleUpdateNeededCount = findings.filter((finding) => finding.category === "possible_update_needed").length;
  const pocAlignmentIssueCount = findings.filter((finding) => finding.category === "poc_alignment").length;
  const incompleteNoteCount = noteSummaries.filter((summary) => summary.textInputSuggestions.length > 0).length;
  const analyzedVisitNotes = noteSummaries.filter((summary) => summary.analyzed).length;
  const visitTypeStatusMatrix = Object.entries(effectiveDiscovery.counts.byVisitType)
    .filter(([, count]) => count > 0)
    .map(([visitType, count]) => ({
      visitType: visitType as VisitNoteQaReviewArtifact["visitTypeCounts"][number]["visitType"],
      count,
      statuses: effectiveDiscovery.counts.byVisitTypeAndStatus[visitType as keyof typeof effectiveDiscovery.counts.byVisitTypeAndStatus] ?? {},
    }));

  return {
    schemaVersion: "visit-note-qa-review.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: effectiveDiscovery.counts.total === 0 ? "pending" : analyzedVisitNotes > 0 ? "ready" : "partial",
    summary: {
      totalVisitNotes: effectiveDiscovery.counts.total,
      eligibleVisitNotes: effectiveDiscovery.rows.filter((row) => row.captureEligibility === "active_monitoring").length,
      analyzedVisitNotes,
      skippedVisitNotes: noteSummaries.filter((summary) => summary.analysisStatus === "skipped").length,
      missedVisitNotes: effectiveDiscovery.rows.filter((row) => row.normalizedStatus === "missed_visit").length,
      notStartedVisitNotes: effectiveDiscovery.rows.filter((row) => row.normalizedStatus === "not_started").length,
      activeMonitoringCount: effectiveDiscovery.rows.filter((row) => row.lifecycleStatus === "active_monitoring" || row.captureEligibility === "active_monitoring").length,
      qaCompleteFinalizedCount: effectiveDiscovery.rows.filter((row) => row.lifecycleStatus === "finalized_no_active_monitoring" || row.captureEligibility === "finalized_no_active_monitoring").length,
      inProgressCount: effectiveDiscovery.rows.filter((row) => row.normalizedStatus === "in_progress").length,
      submittedCount: effectiveDiscovery.rows.filter((row) => row.normalizedStatus === "submitted").length,
      qaPendingCount: effectiveDiscovery.rows.filter((row) => row.normalizedStatus === "qa_pending" || row.normalizedStatus === "qa_review").length,
      signedCount: effectiveDiscovery.rows.filter((row) => row.normalizedStatus === "signed" || row.normalizedStatus === "e_signed").length,
      capturedVisitNotes: effectiveDiscovery.rows.filter((row) => row.captureStatus === "captured").length,
      reusedVisitNotes: effectiveDiscovery.rows.filter((row) => row.skipReason === "manifest_indicates_capture_extraction_analysis_current").length,
      failedVisitNotes: effectiveDiscovery.rows.filter((row) => row.captureStatus === "failed").length,
      degradedVisitNotes: (factPack?.warnings.length ?? 0) + mappingWarnings.length,
      cappedVisitNotes: effectiveDiscovery.rows.filter((row) => row.captureStatus === "capture_pending_due_to_config_limit").length,
      byVisitType: effectiveDiscovery.counts.byVisitType,
      byStatus: effectiveDiscovery.counts.byStatus,
      actionableFindingCount: findings.filter((finding) => finding.needsHumanReview).length,
      contradictionCount,
      positiveProgressCount,
      possibleUpdateNeededCount,
      pocAlignmentIssueCount,
      incompleteNoteCount,
    },
    visitTypeStatusMatrix,
    visitTypeCounts: visitTypeStatusMatrix,
    findings,
    noteSummaries,
    warnings: Array.from(new Set([...(factPack?.warnings ?? []), ...mappingWarnings])).sort(),
  };
}

export async function writeVisitNoteProcessingManifest(outputPath: string, manifest: VisitNoteProcessingManifest): Promise<void> {
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function writeVisitNoteQaReview(outputPath: string, review: VisitNoteQaReviewArtifact): Promise<void> {
  await writeFile(outputPath, JSON.stringify(review, null, 2), "utf8");
}
