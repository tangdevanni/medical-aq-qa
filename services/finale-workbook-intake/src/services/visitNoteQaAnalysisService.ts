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
  type VisitNotePocMappingLlmInvoke,
} from "./visitNotePocAlignmentAgent";
import { summarizeVisitNoteForReviewer } from "./visitNoteSummaryAgent";

export const VISIT_NOTE_PROCESSING_MANIFEST_FILE_NAME = "visit-note-processing-manifest.json";
export const VISIT_NOTE_QA_REVIEW_FILE_NAME = "visit-note-qa-review.json";

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
  const missingDocumentation: string[] = [];
  if (input.row.captureEligibility === "active_monitoring" && input.facts.length === 0) {
    missingDocumentation.push("No usable clinical facts were extracted from this active Visit Note.");
  }
  if (!input.facts.some((fact) => fact.category === "patient_response" || fact.category === "goals_addressed")) {
    missingDocumentation.push("Patient response or goal progress was not clearly documented in extracted facts.");
  }
  if (matchedTargets.length === 0 && input.row.captureEligibility === "active_monitoring") {
    missingDocumentation.push("No Plan of Care problem, goal, or intervention was matched.");
  }
  const pocUpdateSignals = input.facts
    .filter((fact) => /(wound|pain|decline|worse|new|change|fall|medication)/i.test(`${fact.category} ${fact.normalizedValue} ${fact.rawSnippet ?? ""}`))
    .map((fact) => fact.factId);
  const alignmentStatus = input.possibleContradictions.length > 0
    ? "contradiction"
    : input.alignment.verdict === "aligned" || input.alignment.verdict === "partially_aligned" || input.alignment.verdict === "not_aligned" || input.alignment.verdict === "insufficient_documentation"
      ? input.alignment.verdict
      : input.alignment.verdict === "contradiction"
        ? "contradiction"
        : "needs_review";

  return {
    visitNoteKey: input.row.visitNoteKey,
    mappingStatus: input.row.captureEligibility === "active_monitoring" ? "deterministic_only" : "skipped",
    mappingSource: input.row.captureEligibility === "active_monitoring" ? "deterministic" : "skipped",
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
    const shouldAnalyze = eligibility.captureEligibility === "active_monitoring";
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
            : "new_ocr";
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

  for (const row of discovery.rows) {
    const rowFacts = factsForRow(factPack, row.visitNoteKey);
    const alignedPocGoals = getPocGoalsForVisitType(input.planOfCare, row.normalizedVisitType);
    const alignment = analyzeVisitNotePocAlignment({
      visitType: row.normalizedVisitType,
      facts: rowFacts,
      alignedPocGoals,
    });
    if (
      row.captureEligibility === "active_monitoring" &&
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
        title: "Visit note does not prove Plan of Care alignment",
        description: alignment.rationale,
        visitNoteEvidence: alignment.visitNoteFactIds,
        pocEvidence: alignment.pocEvidenceIds,
        oasisEvidence: [],
        suggestedReviewerAction: "Compare the visit note against discipline-specific POC goals and confirm whether documentation is sufficient.",
        needsHumanReview: true,
        confidence: alignment.confidence,
      });
    }
  }

  const manifestByKey = new Map((input.manifest?.visitNoteInputs ?? []).map((entry) => [entry.visitNoteKey, entry]));
  const diagnosisContext = diagnosisContextFromPlanOfCare(input.planOfCare);
  const noteSummaries: VisitNoteQaReviewArtifact["noteSummaries"] = [];
  const mappingWarnings: string[] = [];
  for (const row of discovery.rows) {
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
    const reusable = row.captureEligibility === "active_monitoring" && !input.forceRerunVisitNotes
      ? findReusablePocMappingResult({
          previousReview: input.previousReview,
          visitNoteKey: row.visitNoteKey,
          inputHash: mappingInputHash,
        })
      : null;
    if (reusable) {
      pocMappingResult = reusable;
    } else if (row.captureEligibility === "active_monitoring") {
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
          : row.captureEligibility !== "active_monitoring" || row.captureStatus === "skipped"
            ? "skipped" as const
            : "failed" as const,
      summary: summary.summary,
      missingFields: [],
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
  const incompleteNoteCount = 0;
  const analyzedVisitNotes = noteSummaries.filter((summary) => summary.analyzed).length;
  const visitTypeStatusMatrix = Object.entries(discovery.counts.byVisitType)
    .filter(([, count]) => count > 0)
    .map(([visitType, count]) => ({
      visitType: visitType as VisitNoteQaReviewArtifact["visitTypeCounts"][number]["visitType"],
      count,
      statuses: discovery.counts.byVisitTypeAndStatus[visitType as keyof typeof discovery.counts.byVisitTypeAndStatus] ?? {},
    }));

  return {
    schemaVersion: "visit-note-qa-review.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: discovery.counts.total === 0 ? "pending" : analyzedVisitNotes > 0 ? "ready" : "partial",
    summary: {
      totalVisitNotes: discovery.counts.total,
      eligibleVisitNotes: discovery.rows.filter((row) => row.captureEligibility === "active_monitoring").length,
      analyzedVisitNotes,
      skippedVisitNotes: noteSummaries.filter((summary) => summary.analysisStatus === "skipped").length,
      missedVisitNotes: discovery.rows.filter((row) => row.normalizedStatus === "missed_visit").length,
      notStartedVisitNotes: discovery.rows.filter((row) => row.normalizedStatus === "not_started").length,
      activeMonitoringCount: discovery.rows.filter((row) => row.lifecycleStatus === "active_monitoring" || row.captureEligibility === "active_monitoring").length,
      qaCompleteFinalizedCount: discovery.rows.filter((row) => row.lifecycleStatus === "finalized_no_active_monitoring" || row.captureEligibility === "finalized_no_active_monitoring").length,
      inProgressCount: discovery.rows.filter((row) => row.normalizedStatus === "in_progress").length,
      submittedCount: discovery.rows.filter((row) => row.normalizedStatus === "submitted").length,
      qaPendingCount: discovery.rows.filter((row) => row.normalizedStatus === "qa_pending" || row.normalizedStatus === "qa_review").length,
      signedCount: discovery.rows.filter((row) => row.normalizedStatus === "signed" || row.normalizedStatus === "e_signed").length,
      capturedVisitNotes: discovery.rows.filter((row) => row.captureStatus === "captured").length,
      reusedVisitNotes: discovery.rows.filter((row) => row.skipReason === "manifest_indicates_capture_extraction_analysis_current").length,
      failedVisitNotes: discovery.rows.filter((row) => row.captureStatus === "failed").length,
      degradedVisitNotes: (factPack?.warnings.length ?? 0) + mappingWarnings.length,
      cappedVisitNotes: discovery.rows.filter((row) => row.captureStatus === "capture_pending_due_to_config_limit").length,
      byVisitType: discovery.counts.byVisitType,
      byStatus: discovery.counts.byStatus,
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
