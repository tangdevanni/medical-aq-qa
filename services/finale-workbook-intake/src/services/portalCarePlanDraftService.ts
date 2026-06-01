import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PlanOfCareClinicalDomain,
  PlanOfCareReviewDraftArtifact,
  PlanOfCareReviewProblemGroup,
  PlanOfCareSourceMetadata,
  PortalDomExtractedState,
} from "@medical-ai-qa/shared-types";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function slug(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "care-plan";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function cleanPortalCarePlanText(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .replace(/\b(?:Add Goal|Delete Problem|Add Intervention|Delete Intervention|Add Progress)\b/gi, " ")
    .replace(/\b(?:Onset|Source|Target Completion|Term|Status|Unmet on|Discontinue Date\s*\/\s*Date Resolved|Assigned to Staff Type):\s*[^|]+/gi, " ")
    .replace(/_+(?=\d)/g, "")
    .replace(/(?<=\d)_+/g, " ")
    .replace(/_{2,}/g, " ")
    .replace(/\bNo Progress Yet\b/gi, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+-\s+Others$/i, "")
    .trim();
}

function splitProblemTitle(value: string): { title: string; statement: string } {
  const cleaned = cleanPortalCarePlanText(value);
  const parts = cleaned.split(/\s+-\s+/).map(cleanPortalCarePlanText).filter(Boolean);
  if (parts.length <= 1) {
    return { title: cleaned, statement: cleaned };
  }
  const first = parts[0] ?? cleaned;
  const remainder = parts.slice(1).filter((part) => !/^others$/i.test(part)).join(" - ");
  return {
    title: first,
    statement: remainder || cleaned,
  };
}

function isMetadataOnlyCarePlanText(value: string): boolean {
  const cleaned = cleanPortalCarePlanText(value);
  if (!cleaned) {
    return true;
  }
  if (/^(?:onset|source|target|term|status|unmet on)\b/i.test(cleaned)) {
    return true;
  }
  if (/^(?:\d{1,2}\/\d{1,2}\/\d{4})(?:\s*-\s*\d{1,2}\/\d{1,2}\/\d{4})?$/.test(cleaned)) {
    return true;
  }
  if (/^(?:\(s\)|s|goal\(s\)|from oasis|suggested|needs review|met goal|unmet|short-term|long-term)$/i.test(cleaned)) {
    return true;
  }
  return !/[a-z]/i.test(cleaned);
}

function inferClinicalDomain(text: string): PlanOfCareClinicalDomain {
  if (/\b(wound|incision|surgical|skin|drainage|odor)\b/i.test(text)) {
    return "wound_skin";
  }
  if (/\b(gait|ambulat|transfer|balance|fall|mobility|TUG|HEP|bed mobility|walker|assist)\b/i.test(text)) {
    return "mobility_fall_risk";
  }
  if (/\bmedication|anticoagulant|opioid|pain med|reconcile\b/i.test(text)) {
    return "medication_management";
  }
  if (/\brespiratory|oxygen|dyspnea|pneumonia|COPD\b/i.test(text)) {
    return "respiratory_infection";
  }
  if (/\bcardiac|heart|CHF|edema|blood pressure\b/i.test(text)) {
    return "cardiac_chf";
  }
  return "unknown";
}

function rowValue(headers: string[], row: string[], headerName: string): string {
  const index = headers.findIndex((header) => normalizeWhitespace(header).toLowerCase() === headerName.toLowerCase());
  return index >= 0 ? cleanPortalCarePlanText(row[index] ?? "") : "";
}

function portalPocSource(input: {
  state: PortalDomExtractedState;
  groups: PlanOfCareReviewProblemGroup[];
}): PlanOfCareSourceMetadata {
  return {
    sourceType: "oasis_portal",
    sourceLabel: "From OASIS",
    sourceHash: input.state.contentHash || hash(JSON.stringify(input.groups)),
    capturedAt: input.state.extractedAt,
  };
}

export function buildPortalCarePlanDraftFromOasisDomState(input: {
  state: PortalDomExtractedState | null;
}): PlanOfCareReviewDraftArtifact | null {
  const state = input.state;
  const carePlanTables = (state?.sections ?? [])
    .filter((section) => /\bcare\s*plan\b|\bidentified\s+problem/i.test(section.title))
    .flatMap((section) => section.tables)
    .filter((table) => table.rows.length > 0 && table.headers.some((header) => /problem/i.test(header)));

  const groups: PlanOfCareReviewProblemGroup[] = [];
  const seenGroupKeys = new Set<string>();
  for (const table of carePlanTables) {
    for (const row of table.rows) {
      const rawProblem = rowValue(table.headers, row, "Problem");
      if (!rawProblem || isMetadataOnlyCarePlanText(rawProblem)) {
        continue;
      }
      const { title, statement } = splitProblemTitle(rawProblem);
      const rawGoal = rowValue(table.headers, row, "Goal");
      const rawIntervention = rowValue(table.headers, row, "Intervention");
      const goal = isMetadataOnlyCarePlanText(rawGoal) ? "" : rawGoal;
      const intervention = isMetadataOnlyCarePlanText(rawIntervention) ? "" : rawIntervention;
      const dedupeKey = slug([title, statement, goal, intervention].join("|"));
      if (seenGroupKeys.has(dedupeKey)) {
        continue;
      }
      seenGroupKeys.add(dedupeKey);
      const evidenceFactIds = [`portal-care-plan:${hash([rawProblem, goal, intervention].join("|"))}`];
      const domain = inferClinicalDomain(`${title} ${statement} ${goal} ${intervention}`);
      groups.push({
        groupKey: `${slug(title)}-${groups.length + 1}`,
        clinicalDomain: domain,
        domainMatchStatus: domain === "unknown" ? "weak_match" : "matched",
        domainWarnings: domain === "unknown" ? ["Review portal care-plan problem category."] : [],
        problemTitle: title,
        relatedDiagnoses: [],
        problemStatement: statement,
        goals: goal
          ? [{
              text: goal,
              evidenceFactIds,
              confidence: 0.92,
              needsHumanReview: false,
            }]
          : [],
        interventions: intervention
          ? [{
              text: intervention,
              rationale: "Existing portal OASIS Plan of Care intervention.",
              evidenceFactIds,
              confidence: 0.92,
              needsHumanReview: false,
              llmGenerated: false,
            }]
          : [],
        evidenceFactIds,
        confidence: 0.92,
        needsHumanReview: !goal || !intervention,
        warnings: [],
      });
    }
  }

  if (groups.length === 0) {
    return null;
  }

  if (!state) {
    return null;
  }
  const source = portalPocSource({ state, groups });
  const groupsWithSource = groups.map((group) => ({
    ...group,
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    sourceHash: source.sourceHash,
    capturedAt: source.capturedAt,
  }));
  const needsReviewCount = groups.filter((group) => group.needsHumanReview).length;
  return {
    schemaVersion: "plan-of-care-review-draft.v1",
    generatedAt: new Date().toISOString(),
    pocSource: source,
    sourcePriorityUsed: "oasis_snapshot",
    llmStatus: "disabled",
    llmModelId: null,
    llmErrorCategory: null,
    promptDiagnosisCount: 0,
    llmTailoredDiagnosisCount: 0,
    diagnosisDrafts: [],
    carePlanProblemGroups: groupsWithSource,
    globalInterventions: [],
    summary: {
      diagnosisCount: 0,
      draftedDiagnosisCount: groups.length,
      carePlanProblemGroupCount: groups.length,
      needsReviewCount,
      lowConfidenceCount: 0,
      missingCandidateCount: needsReviewCount,
      sourcePriorityUsed: "oasis_snapshot",
      llmStatus: "disabled",
      promptDiagnosisCount: 0,
      llmTailoredDiagnosisCount: 0,
      warnings: ["Existing portal OASIS Plan of Care was captured from DOM; generated POC was skipped."],
    },
    warnings: ["Existing portal OASIS Plan of Care was captured from DOM; generated POC was skipped."],
  };
}

function preservePreviousPortalCarePlanForReview(input: {
  previous: PlanOfCareReviewDraftArtifact | null;
}): PlanOfCareReviewDraftArtifact | null {
  const previous = input.previous;
  if (previous?.pocSource?.sourceType !== "oasis_portal" || (previous.carePlanProblemGroups?.length ?? 0) === 0) {
    return null;
  }
  const warning = "Previously captured OASIS Plan of Care was not found in the latest DOM capture; review before using generated fallback.";
  const carePlanProblemGroups = (previous.carePlanProblemGroups ?? []).map((group) => ({
    ...group,
    needsHumanReview: true,
    warnings: Array.from(new Set([warning, ...group.warnings])),
  }));
  return {
    ...previous,
    generatedAt: new Date().toISOString(),
    carePlanProblemGroups,
    diagnosisDrafts: [],
    summary: {
      ...previous.summary,
      diagnosisCount: 0,
      draftedDiagnosisCount: carePlanProblemGroups.length,
      carePlanProblemGroupCount: carePlanProblemGroups.length,
      needsReviewCount: carePlanProblemGroups.length,
      missingCandidateCount: carePlanProblemGroups.length,
      warnings: Array.from(new Set([warning, ...previous.summary.warnings])),
    },
    warnings: Array.from(new Set([warning, ...previous.warnings])),
  };
}

export async function writePortalCarePlanDraftFromOasisDom(input: {
  outputDir: string;
  workItem: PatientEpisodeWorkItem;
}): Promise<string | null> {
  const patientDirectory = path.join(input.outputDir, "patients", input.workItem.id);
  const domStatePath = path.join(patientDirectory, "oasis-dom-extracted-state.json");
  const artifactPath = path.join(patientDirectory, "plan-of-care-review-draft.json");
  const raw = await readFile(domStatePath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  const state = JSON.parse(raw) as PortalDomExtractedState;
  const draft = buildPortalCarePlanDraftFromOasisDomState({ state });
  if (!draft) {
    const previousRaw = await readFile(artifactPath, "utf8").catch(() => null);
    const previous = previousRaw ? JSON.parse(previousRaw) as PlanOfCareReviewDraftArtifact : null;
    const preservedDraft = preservePreviousPortalCarePlanForReview({ previous });
    if (preservedDraft) {
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, JSON.stringify(preservedDraft, null, 2), "utf8");
      return artifactPath;
    }
    return null;
  }
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(draft, null, 2), "utf8");
  return artifactPath;
}
