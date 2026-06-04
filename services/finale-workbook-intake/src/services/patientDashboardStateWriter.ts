import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PatientDashboardArtifactPaths,
  PatientDashboardState,
  PatientRun,
  PatientWorkflowRun,
  PlanOfCareReviewDraftArtifact,
  VisitNoteFact,
  VisitNoteFactPack,
  VisitNotesDiscoveryArtifact,
} from "@medical-ai-qa/shared-types";
import type { FinaleBatchEnv } from "../config/env";
import { hydrateWorkItemWithPortalLookupContext } from "@medical-ai-qa/shared-types";
import { buildVisitNoteQaReview } from "./visitNoteQaAnalysisService";

function resolveWorkflowArtifactPath(input: {
  workflowRuns: PatientWorkflowRun[];
  workflowDomain: "coding" | "qa";
  fallbackPath: string;
}): string | null {
  const workflowRun = input.workflowRuns.find(
    (candidate) => candidate.workflowDomain === input.workflowDomain,
  );
  const candidates = Array.from(
    new Set(
      [workflowRun?.workflowResultPath ?? null, input.fallbackPath].filter(
        (candidate): candidate is string => Boolean(candidate),
      ),
    ),
  );

  return candidates[0] ?? null;
}

export function buildPatientDashboardArtifactPaths(input: {
  outputDirectory: string;
  patientId: string;
  workflowRuns: PatientWorkflowRun[];
}): PatientDashboardArtifactPaths {
  const patientArtifactsDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  const referralDirectory = path.join(patientArtifactsDirectory, "referral-document-processing");

  return {
    codingInput:
      resolveWorkflowArtifactPath({
        workflowRuns: input.workflowRuns,
        workflowDomain: "coding",
        fallbackPath: path.join(patientArtifactsDirectory, "coding-input.json"),
      }) ?? path.join(patientArtifactsDirectory, "coding-input.json"),
    documentText: path.join(patientArtifactsDirectory, "document-text.json"),
    qaPrefetch: resolveWorkflowArtifactPath({
      workflowRuns: input.workflowRuns,
      workflowDomain: "qa",
      fallbackPath: path.join(patientArtifactsDirectory, "qa-prefetch-result.json"),
    }),
    patientQaReference: path.join(referralDirectory, "patient-qa-reference.json"),
    qaDocumentSummary: path.join(referralDirectory, "qa-document-summary.json"),
    fieldMapSnapshot: path.join(referralDirectory, "field-map-snapshot.json"),
    printedNoteChartValues: path.join(patientArtifactsDirectory, "printed-note-chart-values.json"),
    printedNoteReview: path.join(patientArtifactsDirectory, "oasis-printed-note-review.json"),
    planOfCareReviewDraft: path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
    visitNotesDiscovery: path.join(patientArtifactsDirectory, "visit-notes-discovery.json"),
    visitNoteProcessingManifest: path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
    visitNoteQaReview: path.join(patientArtifactsDirectory, "visit-note-qa-review.json"),
    oasisDomSectionProcessingManifest: path.join(patientArtifactsDirectory, "oasis-dom-section-processing-manifest.json"),
    oasisDomSectionOutputs: path.join(patientArtifactsDirectory, "oasis-dom-section-outputs.json"),
    patientRunCacheSummary: path.join(patientArtifactsDirectory, "patient-run-cache-summary.json"),
  };
}

async function readJsonIfExists(filePath: string | null): Promise<unknown | null> {
  if (!filePath) {
    return null;
  }

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeDashboardText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function slugForFactId(value: string): string {
  return normalizeDashboardText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "field";
}

function classifyVisitNoteFieldFact(input: {
  label: string;
  key: string;
  value: string;
  visitType: string;
}): string {
  const text = `${input.label} ${input.key} ${input.value}`.toLowerCase();

  if (/\b(plan for next visit|follow[-\s]?up|next visit|reassess)\b/.test(text)) {
    return "follow_up_plan";
  }
  if (/\b(reason|recommendation|coordination of care|physician notified|other discipline)\b/.test(text)) {
    return "care_coordination";
  }
  if (/\b(discharge plan|discharge planning|discharge plan discussed)\b/.test(text)) {
    return "discharge_planning";
  }
  if (/\b(visit narrative|summarize key findings|notable changes|comments|provide further information|identified strengths)\b/.test(text)) {
    return "patient_response";
  }
  if (/\b(homebound|taxing effort|leaving home|mobility outside the home)\b/.test(text)) {
    return "homebound";
  }
  if (/\b(subjective|tolerated|patient response|impact of intervention|progress|consented|reports?|goal)\b/.test(text)) {
    return "patient_response";
  }
  if (/\b(training|intervention|treatment|skilled|visit narrative|plan for next visit|tx\b|exercise)\b/.test(text)) {
    return input.visitType === "physical_therapy" ? "therapy_exercises" : "skilled_interventions";
  }
  if (/\b(gait|transfer|balance|ambulation|walking|mobility|endurance|weakness|functional)\b/.test(text)) {
    return "mobility";
  }
  if (/\b(medication|drug|dose|frequency)\b/.test(text)) {
    return "medication";
  }
  if (/\b(pain|ache|sore|discomfort)\b/.test(text)) {
    return "pain";
  }
  if (/\b(diagnosis|icd|medical diagnosis|pt diagnosis)\b/.test(text)) {
    return "diagnosis";
  }
  if (/\b(safety|fall|walker|assistive|precaution)\b/.test(text)) {
    return "safety";
  }

  return "documentation_text";
}

function shouldKeepVisitNoteFieldFact(input: {
  label: string;
  key: string;
  value: string;
  inputType: string;
}): boolean {
  const text = `${input.label} ${input.key} ${input.value}`.toLowerCase();
  if (input.value.length < 2) {
    return false;
  }
  if (/^(true|false|null|undefined)$/i.test(input.value)) {
    return false;
  }
  if (/^(noteLabel|safetyOthers)$/i.test(input.key)) {
    return false;
  }
  if (input.inputType === "checkbox" && !/^(checked|selected|yes|true)$/i.test(input.value)) {
    return false;
  }

  return /\b(homebound|diagnosis|subjective|tolerated|response|training|intervention|treatment|visit narrative|summarize key findings|plan for next|next visit|follow[-\s]?up|reassess|reason|recommendation|coordination of care|physician notified|other discipline|discharge plan|provide further information|identified strengths|comments|gait|transfer|balance|ambulation|walking|mobility|endurance|weakness|pain|medication|safety|fall|goal|exercise|tx\b)\b/.test(text);
}

function isImportantVisitNoteTextField(input: {
  label: string;
  key: string;
  inputType: string;
}): boolean {
  const text = `${input.label} ${input.key}`.toLowerCase();
  if (/\bcomments?\s*\(.*(?:abnormal|impaired|explain)/i.test(text)) {
    return false;
  }
  if (/\b(other homebound reason|visit narrative|summarize key findings|plan for next|next visit|subjective information|pt diagnosis|medical diagnosis|provide further information|identified strengths|training\/intervention|impact of intervention|patient response|discharge plan discussed with|other discipline recommendations\s*-\s*reason)\b/.test(text)) {
    return true;
  }
  const isTextInput =
    /textarea|text|input|richtext|textbox|contenteditable|ql-editor|prosemirror/i.test(input.inputType) ||
    /\b(comment|narrative|reason|plan|diagnosis|subjective|training|intervention|response|summary|information)\b/.test(text);
  return isTextInput && /\b(homebound|medical diagnosis|pt diagnosis|subjective|visit narrative|summarize key findings|plan for next|next visit|reason|recommendation|coordination of care|discharge plan|provide further information|identified strengths|pain location|training|intervention|impact of intervention|patient response|goal|treatment|tx\b)\b/.test(text);
}

function isThinVisitNoteTextField(input: {
  label: string;
  key: string;
  value: string;
  inputType: string;
}): boolean {
  if (!isImportantVisitNoteTextField(input)) {
    return false;
  }
  const value = normalizeDashboardText(input.value);
  if (!value) {
    return false;
  }
  const text = `${input.label} ${input.key}`.toLowerCase();
  const words = value.split(/\s+/).filter(Boolean);
  if (/^(n\/a|na|none|no|yes|ok|good|same|unchanged|tolerated well|see above)$/i.test(value)) {
    return true;
  }

  const isNarrativeField =
    /\b(visit narrative|summarize key findings|plan for next|next visit|subjective information|provide further information|identified strengths|reason|training\/intervention|impact of intervention|patient response)\b/.test(text);
  if (!isNarrativeField) {
    return words.length < 8;
  }

  const hasClinicalSpecifics =
    /\b(assess|assessed|educat|teach|instruct|monitor|reassess|gait|transfer|walker|fww|fall|safety|pain|wound|respiratory|cardiac|medication|strength|endurance|balance|response|progress|tolerat|goal|caregiver|next visit|plan)\b/i.test(value);

  return words.length < 18 || !hasClinicalSpecifics;
}

function getIncompleteVisitNoteFieldLabel(input: {
  label: string;
  key: string;
  value: string;
  inputType: string;
}): string | null {
  if (input.value.length > 0) {
    return null;
  }

  const key = input.key.toLowerCase();
  const label = input.label.toLowerCase();
  if (key === "visitnarrativecomment") {
    return "Visit narrative";
  }
  if (key === "planfornextvisitcomment") {
    return "Plan for next visit";
  }
  if (key === "ptsubjectiveinfo") {
    return "Subjective information";
  }
  if (key === "primary_diagnosis" || /\bmedical diagnosis\b/.test(label)) {
    return "Medical diagnosis";
  }
  if (key === "patientptdiagnosis" || /\bpt diagnosis\b/.test(label)) {
    return "PT diagnosis";
  }
  if (isImportantVisitNoteTextField(input)) {
    return input.label || input.key || "Visit Note text field";
  }

  return null;
}

function visitNoteFactPriority(category: string): number {
  switch (category) {
    case "incomplete_field":
      return -1;
    case "thin_text_field":
      return 0;
    case "patient_response":
      return 1;
    case "therapy_exercises":
    case "skilled_interventions":
      return 2;
    case "follow_up_plan":
      return 3;
    case "mobility":
      return 4;
    case "homebound":
      return 5;
    case "care_coordination":
      return 6;
    case "discharge_planning":
      return 7;
    case "safety":
    case "pain":
      return 8;
    case "diagnosis":
      return 9;
    default:
      return 20;
  }
}

function addVisitNoteFact(input: {
  facts: VisitNoteFact[];
  seenFactKeys: Set<string>;
  row: VisitNotesDiscoveryArtifact["rows"][number];
  category: string;
  label: string;
  value: string;
  confidence: number;
  indexHint: number;
  fieldKey?: string;
  fieldLabel?: string;
  sectionLabel?: string;
  inputType?: string;
}): void {
  const normalizedValue = normalizeDashboardText(input.value).slice(0, 700);
  if (!normalizedValue) {
    return;
  }

  const seenKey = `${input.row.visitNoteKey}:${input.category}:${normalizedValue.toLowerCase()}`;
  if (input.seenFactKeys.has(seenKey)) {
    return;
  }
  input.seenFactKeys.add(seenKey);

  input.facts.push({
    factId: `visit-note:${input.row.visitNoteKey}:${input.category}:${slugForFactId(input.label)}:${input.indexHint}`,
    visitNoteKey: input.row.visitNoteKey,
    category: input.category,
    normalizedValue,
    rawSnippet: normalizedValue,
    confidence: input.confidence,
    ...(input.fieldKey ? { fieldKey: input.fieldKey } : {}),
    ...(input.fieldLabel ? { fieldLabel: input.fieldLabel } : {}),
    ...(input.sectionLabel ? { sectionLabel: input.sectionLabel } : {}),
    ...(input.inputType ? { inputType: input.inputType } : {}),
    source: {
      ...(input.row.visitDate ? { visitDate: input.row.visitDate } : {}),
      visitType: input.row.normalizedVisitType,
      documentType: input.row.rawDocumentType,
      ...(input.row.assignedStaffRaw ? { staff: input.row.assignedStaffRaw } : {}),
    },
  });
}

async function buildVisitNoteFactsFromDomState(input: {
  patientArtifactsDirectory: string;
  row: VisitNotesDiscoveryArtifact["rows"][number];
  facts: VisitNoteFact[];
  seenFactKeys: Set<string>;
}): Promise<number> {
  const domStatePath = path.join(
    input.patientArtifactsDirectory,
    "documents",
    "visit-notes",
    input.row.visitNoteKey,
    "dom-extracted-state.json",
  );
  const domState = asRecord(await readJsonIfExists(domStatePath));
  const sections = Array.isArray(domState?.sections) ? domState.sections : [];
  let addedCount = 0;

  for (const sectionValue of sections) {
    const section = asRecord(sectionValue);
    const sectionLabel = normalizeDashboardText(
      asString(section?.title) ?? asString(section?.label) ?? asString(section?.sectionTitle) ?? "",
    );
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const fieldValue of fields) {
      const field = asRecord(fieldValue);
      if (!field) {
        continue;
      }
      const label = normalizeDashboardText(asString(field.label) ?? asString(field.evidenceText) ?? "");
      const key = normalizeDashboardText(asString(field.key) ?? "");
      const value = normalizeDashboardText(asString(field.value) ?? "");
      const inputType = normalizeDashboardText(asString(field.inputType) ?? "");
      const incompleteLabel = getIncompleteVisitNoteFieldLabel({ label, key, value, inputType });
      if (incompleteLabel) {
        addVisitNoteFact({
          facts: input.facts,
          seenFactKeys: input.seenFactKeys,
          row: input.row,
          category: "incomplete_field",
          label: incompleteLabel,
          value: `${incompleteLabel} is blank.`,
          confidence: 0.95,
          indexHint: addedCount + 1,
          fieldKey: key || undefined,
          fieldLabel: incompleteLabel,
          sectionLabel: sectionLabel || undefined,
          inputType: inputType || undefined,
        });
        addedCount += 1;
        continue;
      }
      if (isThinVisitNoteTextField({ label, key, value, inputType })) {
        addVisitNoteFact({
          facts: input.facts,
          seenFactKeys: input.seenFactKeys,
          row: input.row,
          category: "thin_text_field",
          label: label || key || "Visit Note text field",
          value,
          confidence: 0.9,
          indexHint: addedCount + 1,
          fieldKey: key || undefined,
          fieldLabel: label || key || "Visit Note text field",
          sectionLabel: sectionLabel || undefined,
          inputType: inputType || undefined,
        });
        addedCount += 1;
      }
      if (!shouldKeepVisitNoteFieldFact({ label, key, value, inputType })) {
        continue;
      }
      addVisitNoteFact({
        facts: input.facts,
        seenFactKeys: input.seenFactKeys,
        row: input.row,
        category: classifyVisitNoteFieldFact({
          label,
          key,
          value,
          visitType: input.row.normalizedVisitType,
        }),
        label: label || key || "Visit Note field",
        value,
        confidence: /textarea|richtext|textbox|contenteditable|ql-editor|prosemirror/i.test(inputType) ? 0.9 : 0.82,
        indexHint: addedCount + 1,
        fieldKey: key || undefined,
        fieldLabel: label || key || undefined,
        sectionLabel: sectionLabel || undefined,
        inputType: inputType || undefined,
      });
      addedCount += 1;
    }
  }

  return addedCount;
}

export async function buildVisitNoteFactPackFromCapturedText(input: {
  patientArtifactsDirectory: string;
  discovery: VisitNotesDiscoveryArtifact;
}): Promise<VisitNoteFactPack> {
  const facts: VisitNoteFactPack["facts"] = [];
  const seenFactKeys = new Set<string>();
  for (const row of input.discovery.rows) {
    const domFactCount = await buildVisitNoteFactsFromDomState({
      patientArtifactsDirectory: input.patientArtifactsDirectory,
      row,
      facts,
      seenFactKeys,
    });
    const textPath = path.join(
      input.patientArtifactsDirectory,
      "documents",
      "visit-notes",
      row.visitNoteKey,
      "extracted-text.txt",
    );
    const text = (await readFile(textPath, "utf8").catch(() => "")).replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    addVisitNoteFact({
      facts,
      seenFactKeys,
      row,
      category: domFactCount > 0 ? "documentation_text" : "skilled_interventions",
      label: "Extracted Visit Note text",
      value: text.slice(0, 500),
      confidence: domFactCount > 0 ? 0.6 : 0.75,
      indexHint: 0,
    });
    if (/tolerated|response|progress|improved|declined|worse|goal/i.test(text)) {
      addVisitNoteFact({
        facts,
        seenFactKeys,
        row,
        category: "patient_response",
        label: "Visit Note patient response",
        value: text.slice(0, 500),
        confidence: 0.7,
        indexHint: 999,
      });
    }
  }

  const prioritizedFacts = facts.sort((left, right) =>
    left.visitNoteKey.localeCompare(right.visitNoteKey) ||
    visitNoteFactPriority(left.category) - visitNoteFactPriority(right.category) ||
    right.confidence - left.confidence ||
    left.factId.localeCompare(right.factId),
  );

  return {
    schemaVersion: "visit-note-fact-pack.v1",
    generatedAt: new Date().toISOString(),
    factCount: prioritizedFacts.length,
    categories: Array.from(new Set(prioritizedFacts.map((fact) => fact.category))).sort(),
    facts: prioritizedFacts,
    warnings: [],
  };
}

export async function writePatientDashboardState(params: {
  outputDirectory: string;
  run: PatientRun;
  env?: FinaleBatchEnv;
}): Promise<{ filePath: string; state: PatientDashboardState }> {
  const patientArtifactsDirectory = path.join(params.outputDirectory, "patients", params.run.workItemId);
  const filePath = path.join(patientArtifactsDirectory, "patient-dashboard-state.json");
  const artifactPaths = buildPatientDashboardArtifactPaths({
    outputDirectory: params.outputDirectory,
    patientId: params.run.workItemId,
    workflowRuns: params.run.workflowRuns,
  });
  const codingInput = await readJsonIfExists(artifactPaths.codingInput);
  const documentText = await readJsonIfExists(artifactPaths.documentText);
  const qaPrefetch = await readJsonIfExists(artifactPaths.qaPrefetch);
  const patientQaReference = await readJsonIfExists(artifactPaths.patientQaReference);
  const qaDocumentSummary = await readJsonIfExists(artifactPaths.qaDocumentSummary);
  const fieldMapSnapshot = await readJsonIfExists(artifactPaths.fieldMapSnapshot);
  const printedNoteChartValues = null;
  const printedNoteReview = null;
  const planOfCareReviewDraft = await readJsonIfExists(artifactPaths.planOfCareReviewDraft ?? null);
  const visitNotesDiscovery = await readJsonIfExists(artifactPaths.visitNotesDiscovery ?? null);
  const visitNoteProcessingManifest = await readJsonIfExists(artifactPaths.visitNoteProcessingManifest ?? null);
  const oasisDomSectionProcessingManifest = await readJsonIfExists(
    artifactPaths.oasisDomSectionProcessingManifest ?? null,
  );
  const oasisDomSectionOutputs = await readJsonIfExists(artifactPaths.oasisDomSectionOutputs ?? null);
  const patientRunCacheSummary = await readJsonIfExists(artifactPaths.patientRunCacheSummary ?? null);
  let visitNoteQaReview = await readJsonIfExists(artifactPaths.visitNoteQaReview ?? null);
  if (visitNotesDiscovery && artifactPaths.visitNoteQaReview) {
    const factPack = await buildVisitNoteFactPackFromCapturedText({
      patientArtifactsDirectory,
      discovery: visitNotesDiscovery as VisitNotesDiscoveryArtifact,
    });
    visitNoteQaReview = await buildVisitNoteQaReview({
      discovery: visitNotesDiscovery as VisitNotesDiscoveryArtifact,
      factPack,
      planOfCare: planOfCareReviewDraft as PlanOfCareReviewDraftArtifact | null,
      oasisClinicalFactPack: null,
      manifest: visitNoteProcessingManifest as never,
      previousReview: visitNoteQaReview as never,
      env: params.env,
    });
    await mkdir(path.dirname(artifactPaths.visitNoteQaReview), { recursive: true });
    await writeFile(artifactPaths.visitNoteQaReview, JSON.stringify(visitNoteQaReview, null, 2), "utf8");
  }
  const effectiveWorkItem = hydrateWorkItemWithPortalLookupContext(
    params.run.workItemSnapshot ?? null,
    params.run.matchResult,
  );

  const state: PatientDashboardState = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    batchId: params.run.batchId,
    patientId: params.run.workItemId,
    runId: params.run.runId,
    subsidiaryId: params.run.subsidiaryId,
    patientName: params.run.patientName,
    processingStatus: params.run.processingStatus,
    executionStep: params.run.executionStep,
    progressPercent: params.run.progressPercent,
    startedAt: params.run.startedAt,
    completedAt: params.run.completedAt,
    lastUpdatedAt: params.run.lastUpdatedAt,
    matchResult: params.run.matchResult,
    qaOutcome: params.run.qaOutcome,
    oasisQaSummary: params.run.oasisQaSummary,
    artifactCount: params.run.artifactCount,
    hasFindings: params.run.hasFindings,
    bundleAvailable: params.run.bundleAvailable,
    resultBundlePath: params.run.resultBundlePath,
    logPath: params.run.logPath,
    errorSummary: params.run.errorSummary,
    workItem: effectiveWorkItem,
    workflowRuns: params.run.workflowRuns,
    artifactPaths,
    artifactContents: {
      codingInput,
      documentText,
      qaPrefetch,
      patientQaReference,
      qaDocumentSummary,
      fieldMapSnapshot,
      printedNoteChartValues,
      printedNoteReview,
      planOfCareReviewDraft,
      visitNotesDiscovery,
      visitNoteProcessingManifest,
      visitNoteQaReview,
      oasisDomSectionProcessingManifest,
      oasisDomSectionOutputs,
      patientRunCacheSummary,
    },
  };

  await mkdir(patientArtifactsDirectory, { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");

  return {
    filePath,
    state,
  };
}
