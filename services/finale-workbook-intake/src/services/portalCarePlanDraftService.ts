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

function toFileSystemPath(value: string): string {
  return process.platform === "win32" ? path.toNamespacedPath(value) : value;
}

function normalizeAssessmentType(value: string | null | undefined): string {
  return normalizeWhitespace(value).toUpperCase().replace(/[^A-Z]/g, "");
}

function isPlanOfCareSourceAssessmentType(value: string | null | undefined): boolean {
  const normalized = normalizeAssessmentType(value);
  return normalized === "SOC" || normalized === "ROC" || normalized === "RECERT";
}

function isExcludedPlanOfCareAssessment(input: {
  assessmentType?: string | null;
  title?: string | null;
}): boolean {
  const type = normalizeAssessmentType(input.assessmentType);
  const title = normalizeWhitespace(input.title).toLowerCase();
  return type === "DC" ||
    type === "DISCHARGE" ||
    type === "DEATHATHOME" ||
    /\b(?:dc|discharge|death at home)\b/i.test(title);
}

function parseAssessmentDate(value: string | null | undefined): number {
  const normalized = normalizeWhitespace(value);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized);
  if (match) {
    const [, month, day, year] = match;
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function resolvePlanOfCareOasisDomStatePath(input: {
  patientDirectory: string;
}): Promise<string | null> {
  const manifestRaw = await readFile(
    toFileSystemPath(path.join(input.patientDirectory, "oasis-assessment-processing-manifest.json")),
    "utf8",
  ).catch(() => null);
  const manifest = manifestRaw ? asRecord(JSON.parse(manifestRaw) as unknown) : null;
  const assessments = Array.isArray(manifest?.assessments) ? manifest.assessments : [];
  const candidates = assessments
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) =>
      isPlanOfCareSourceAssessmentType(asString(entry.assessmentType)) &&
      !isExcludedPlanOfCareAssessment({
        assessmentType: asString(entry.assessmentType),
        title: asString(entry.title),
      })
    )
    .map((entry) => ({
      assessmentType: asString(entry.assessmentType),
      title: asString(entry.title),
      date: asString(entry.date),
      isCurrent: entry.isCurrent === true,
      domStatePath: asString(entry.domStatePath),
      processingStatus: asString(entry.processingStatus),
    }))
    .filter((entry) =>
      entry.domStatePath &&
      entry.processingStatus !== "failed" &&
      entry.processingStatus !== "skipped_requested_not_opened"
    )
    .sort((left, right) =>
      parseAssessmentDate(right.date) - parseAssessmentDate(left.date) ||
      Number(right.isCurrent) - Number(left.isCurrent)
    );
  const manifestCandidate = candidates[0]?.domStatePath ?? null;
  if (manifestCandidate) {
    return manifestCandidate;
  }

  const rootDomStatePath = path.join(input.patientDirectory, "oasis-dom-extracted-state.json");
  const rootRaw = await readFile(toFileSystemPath(rootDomStatePath), "utf8").catch(() => null);
  if (!rootRaw) {
    return null;
  }
  const rootState = asRecord(JSON.parse(rootRaw) as unknown);
  const rootAssessmentType = asString(rootState?.assessmentType);
  const rootTitle = asString(rootState?.assessmentTitle) ?? asString(rootState?.title);
  return isPlanOfCareSourceAssessmentType(rootAssessmentType) &&
    !isExcludedPlanOfCareAssessment({ assessmentType: rootAssessmentType, title: rootTitle })
    ? rootDomStatePath
    : null;
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

function rowValueAny(headers: string[], row: string[], headerNames: string[]): string {
  for (const headerName of headerNames) {
    const value = rowValue(headers, row, headerName);
    if (value) {
      return value;
    }
  }
  return "";
}

function carePlanFieldValue(input: {
  state: PortalDomExtractedState;
  rowNumber: string;
  kind: "goal" | "intervention";
}): string {
  const rowNumber = normalizeWhitespace(input.rowNumber);
  const expectedKey = rowNumber ? `care_plan_problem_${rowNumber}_${input.kind}` : "";
  const labelPattern = input.kind === "goal"
    ? /\bcare\s*plan\s+goal\b|\bgoal(?:\(s\))?\b|\bpatient\s+goal\b/i
    : /\bcare\s*plan\s+intervention\b|\bintervention\b/i;

  for (const section of input.state.sections ?? []) {
    if (!/\bcare\s*plan\b|\bidentified\s+problem/i.test(section.title)) {
      continue;
    }
    for (const field of section.fields ?? []) {
      const fieldKey = normalizeWhitespace(field.key).toLowerCase();
      const fieldLabel = normalizeWhitespace(field.label);
      const sameRow = expectedKey
        ? fieldKey === expectedKey || fieldKey.startsWith(`care_plan_problem_${rowNumber}_`)
        : true;
      if (!sameRow || !labelPattern.test(`${fieldLabel} ${fieldKey}`)) {
        continue;
      }
      const rawValue = Array.isArray(field.value) ? field.value.join(" ") : String(field.value ?? "");
      const value = cleanPortalCarePlanText(rawValue);
      if (!isMetadataOnlyCarePlanText(value)) {
        return value;
      }
    }
  }

  return "";
}

function sectionVisibleText(section: PortalDomExtractedState["sections"][number]): string {
  const text = asString((section as { visibleTextDigest?: unknown }).visibleTextDigest);
  return text ?? "";
}

function sectionLines(section: PortalDomExtractedState["sections"][number]): string[] {
  return sectionVisibleText(section)
    .split(/\r?\n/)
    .map(cleanPortalCarePlanText)
    .filter(Boolean);
}

function removeCarePlanLabel(value: string, label: "Problem" | "Goals" | "Interventions"): string {
  const pattern = new RegExp(`^${label}:?\\s*`, "i");
  return cleanPortalCarePlanText(value.replace(pattern, ""));
}

function firstClinicalLine(lines: string[]): string {
  return lines
    .map(cleanPortalCarePlanText)
    .find((line) =>
      line &&
      !isMetadataOnlyCarePlanText(line) &&
      !/^(?:target completion|term|status|assigned staff|progress toward goals)\b/i.test(line)
    ) ?? "";
}

function buildCarePlanGroup(input: {
  title: string;
  statement: string;
  goals: string[];
  interventions: string[];
  index: number;
}): PlanOfCareReviewProblemGroup | null {
  const title = cleanPortalCarePlanText(input.title);
  const statement = cleanPortalCarePlanText(input.statement || input.title);
  if (!title || isMetadataOnlyCarePlanText(title)) {
    return null;
  }

  const goals = input.goals.map(cleanPortalCarePlanText).filter((goal) => goal && !isMetadataOnlyCarePlanText(goal));
  const interventions = input.interventions
    .map(cleanPortalCarePlanText)
    .filter((intervention) => intervention && !isMetadataOnlyCarePlanText(intervention));
  const evidenceFactIds = [`portal-care-plan:${hash([title, statement, ...goals, ...interventions].join("|"))}`];
  const domain = inferClinicalDomain(`${title} ${statement} ${goals.join(" ")} ${interventions.join(" ")}`);

  return {
    groupKey: `${slug(title)}-${input.index}`,
    clinicalDomain: domain,
    domainMatchStatus: domain === "unknown" ? "weak_match" : "matched",
    domainWarnings: domain === "unknown" ? ["Review portal care-plan problem category."] : [],
    problemTitle: title,
    relatedDiagnoses: [],
    problemStatement: statement,
    goals: goals.map((goal) => ({
      text: goal,
      evidenceFactIds,
      confidence: 0.9,
      needsHumanReview: false,
    })),
    interventions: interventions.map((intervention) => ({
      text: intervention,
      rationale: "Existing portal OASIS Plan of Care intervention.",
      evidenceFactIds,
      confidence: 0.9,
      needsHumanReview: false,
      llmGenerated: false,
    })),
    evidenceFactIds,
    confidence: 0.9,
    needsHumanReview: goals.length === 0 || interventions.length === 0,
    warnings: [],
  };
}

function parseCarePlanSectionGroups(state: PortalDomExtractedState): PlanOfCareReviewProblemGroup[] {
  const groups: PlanOfCareReviewProblemGroup[] = [];
  const seenGroupKeys = new Set<string>();
  let current: { title: string; statement: string; goals: string[]; interventions: string[] } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const group = buildCarePlanGroup({ ...current, index: groups.length + 1 });
    current = null;
    if (!group) {
      return;
    }
    const dedupeKey = slug([
      group.problemTitle,
      group.problemStatement,
      group.goals.map((goal) => goal.text).join("|"),
      group.interventions.map((intervention) => intervention.text).join("|"),
    ].join("|"));
    if (!seenGroupKeys.has(dedupeKey)) {
      seenGroupKeys.add(dedupeKey);
      groups.push(group);
    }
  };

  for (const section of state.sections ?? []) {
    const title = normalizeWhitespace(section.title);
    const lines = sectionLines(section);
    const visibleText = sectionVisibleText(section);
    const problemMatch = /(?:^|\n)\s*Problem:\s*([^\n]+)/i.exec(visibleText);
    if (problemMatch?.[1]) {
      flush();
      const { title: problemTitle, statement } = splitProblemTitle(removeCarePlanLabel(problemMatch[1], "Problem"));
      current = {
        title: problemTitle,
        statement,
        goals: [],
        interventions: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (/^Goals:?$/i.test(title) || /^Goals:?$/i.test(lines[0] ?? "")) {
      const clinicalGoal = firstClinicalLine(
        lines[0] && /^Goals:?$/i.test(lines[0]) ? lines.slice(1) : lines.map((line) => removeCarePlanLabel(line, "Goals")),
      );
      if (clinicalGoal) {
        current.goals.push(clinicalGoal);
      }
      continue;
    }

    if (/^Interventions\b/i.test(title) || /^Interventions\b/i.test(lines[0] ?? "")) {
      const clinicalIntervention = firstClinicalLine(
        lines[0] && /^Interventions\b/i.test(lines[0])
          ? lines.slice(1)
          : lines.map((line) => removeCarePlanLabel(line, "Interventions")),
      );
      if (clinicalIntervention) {
        current.interventions.push(clinicalIntervention);
      }
      continue;
    }
  }

  flush();
  return groups;
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
  if (!state) {
    return null;
  }

  const carePlanTables = (state?.sections ?? [])
    .filter((section) => /\bcare\s*plan\b|\bidentified\s+problem/i.test(section.title))
    .flatMap((section) => section.tables)
    .filter((table) => table.rows.length > 0 && table.headers.some((header) => /problem/i.test(header)));

  const groups: PlanOfCareReviewProblemGroup[] = [];
  const seenGroupKeys = new Set<string>();
  for (const table of carePlanTables) {
    for (const row of table.rows) {
      const rawProblem = rowValueAny(table.headers, row, [
        "Problem",
        "Problem(s)",
        "Identified Problem",
        "Care Plan Problem",
        "Problem Statement",
      ]);
      if (!rawProblem || isMetadataOnlyCarePlanText(rawProblem)) {
        continue;
      }
      const { title, statement } = splitProblemTitle(rawProblem);
      const rowNumber = rowValueAny(table.headers, row, ["#", "No", "Number"]) || String(groups.length + 1);
      const rawGoal = rowValueAny(table.headers, row, [
        "Goal",
        "Goal(s)",
        "Patient Goal",
        "Patient / Caregiver Goal",
        "Short-Term Goal",
        "Long-Term Goal",
        "Short Term Goal",
        "Long Term Goal",
      ]) || carePlanFieldValue({ state, rowNumber, kind: "goal" });
      const rawIntervention = rowValueAny(table.headers, row, [
        "Intervention",
        "Intervention(s)",
        "Plan Intervention",
        "Care Plan Intervention",
        "Order / Intervention",
      ]) || carePlanFieldValue({ state, rowNumber, kind: "intervention" });
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
    groups.push(...parseCarePlanSectionGroups(state));
  }

  if (groups.length === 0) {
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
  const domStatePath = await resolvePlanOfCareOasisDomStatePath({ patientDirectory });
  const artifactPath = path.join(patientDirectory, "plan-of-care-review-draft.json");
  const raw = domStatePath ? await readFile(toFileSystemPath(domStatePath), "utf8").catch(() => null) : null;
  if (!raw) {
    return null;
  }
  const state = JSON.parse(raw) as PortalDomExtractedState;
  const draft = buildPortalCarePlanDraftFromOasisDomState({ state });
  if (!draft) {
    const previousRaw = await readFile(toFileSystemPath(artifactPath), "utf8").catch(() => null);
    const previous = previousRaw ? JSON.parse(previousRaw) as PlanOfCareReviewDraftArtifact : null;
    const preservedDraft = preservePreviousPortalCarePlanForReview({ previous });
    if (preservedDraft) {
      await mkdir(toFileSystemPath(path.dirname(artifactPath)), { recursive: true });
      await writeFile(toFileSystemPath(artifactPath), JSON.stringify(preservedDraft, null, 2), "utf8");
      return artifactPath;
    }
    return null;
  }
  await mkdir(toFileSystemPath(path.dirname(artifactPath)), { recursive: true });
  await writeFile(toFileSystemPath(artifactPath), JSON.stringify(draft, null, 2), "utf8");
  return artifactPath;
}
