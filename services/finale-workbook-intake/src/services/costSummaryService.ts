import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutomationStepLog,
  CostPlanningDecision,
  PatientCostSummary,
  PatientRun,
  PreWorkerRunPlan,
  RunCostSummary,
} from "@medical-ai-qa/shared-types";
import {
  patientCostSummarySchema,
  preWorkerRunPlanSchema,
  runCostSummarySchema,
} from "@medical-ai-qa/shared-types";
import {
  PATIENT_COST_SUMMARY_FILE_NAME,
  PRE_WORKER_RUN_PLAN_FILE_NAME,
  RUN_COST_SUMMARY_FILE_NAME,
} from "../artifacts/artifactNames";
import type { PatientRunStageTiming } from "./patientRunReuseSummaryService";

type MinimalPatientRun = Pick<
  PatientRun,
  | "batchId"
  | "runId"
  | "workItemId"
  | "patientName"
  | "startedAt"
  | "completedAt"
  | "retryEligible"
  | "errorSummary"
> & {
  automationStepLogs?: AutomationStepLog[];
};

type JsonFileEntry = {
  path: string;
  relativePath: string;
  value: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function containsText(value: unknown, pattern: RegExp): boolean {
  if (typeof value === "string") {
    return pattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsText(entry, pattern));
  }
  const record = asRecord(value);
  return record ? Object.values(record).some((entry) => containsText(entry, pattern)) : false;
}

function countLogMatches(logs: AutomationStepLog[] | undefined, pattern: RegExp): number {
  return (logs ?? []).filter((log) =>
    pattern.test(log.step) ||
    pattern.test(log.message) ||
    containsText(log.found, pattern) ||
    containsText(log.missing, pattern) ||
    containsText(log.evidence, pattern)
  ).length;
}

function runtimeMs(run: MinimalPatientRun, stageTimings: PatientRunStageTiming[]): number | null {
  if (run.startedAt && run.completedAt) {
    const started = Date.parse(run.startedAt);
    const completed = Date.parse(run.completedAt);
    if (Number.isFinite(started) && Number.isFinite(completed) && completed >= started) {
      return completed - started;
    }
  }

  if (stageTimings.length > 0) {
    return stageTimings.reduce((sum, stage) => sum + stage.durationMs, 0);
  }

  return null;
}

function portalBrowserActiveMs(stageTimings: PatientRunStageTiming[]): number {
  return stageTimings
    .filter((stage) =>
      /portal|shared_evidence|oasis_dom|visit_notes|printed_oasis/i.test(stage.stage),
    )
    .reduce((sum, stage) => sum + stage.durationMs, 0);
}

async function listJsonFiles(directory: string, root = directory): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".next-dev"].includes(entry.name)) {
        return [] as string[];
      }
      return listJsonFiles(fullPath, root);
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      return [] as string[];
    }
    const relativePath = path.relative(root, fullPath);
    if (
      relativePath === PATIENT_COST_SUMMARY_FILE_NAME ||
      relativePath === "patient-dashboard-state.json" ||
      relativePath === "patient-run-log.json"
    ) {
      return [] as string[];
    }
    return [fullPath];
  }));

  return files.flat();
}

async function readJsonEntries(patientArtifactsDirectory: string): Promise<JsonFileEntry[]> {
  const files = await listJsonFiles(patientArtifactsDirectory);
  const entries = await Promise.all(files.map(async (filePath) => {
    try {
      return {
        path: filePath,
        relativePath: path.relative(patientArtifactsDirectory, filePath),
        value: JSON.parse(await readFile(filePath, "utf8")) as unknown,
      };
    } catch {
      return null;
    }
  }));
  return entries.filter((entry): entry is JsonFileEntry => entry !== null);
}

function collectBedrockInvocations(value: unknown, relativePath: string): Array<{
  stage: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}> {
  const found: Array<{
    stage: string;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  }> = [];

  function visit(node: unknown): void {
    const record = asRecord(node);
    if (!record) {
      if (Array.isArray(node)) {
        node.forEach(visit);
      }
      return;
    }

    const invocation = asRecord(record.invocation);
    const provider = asString(invocation?.provider);
    if (provider?.toLowerCase() === "bedrock") {
      found.push({
        stage: inferStageFromPath(relativePath),
        inputTokens: asNumber(invocation?.inputTokenCount ?? invocation?.inputTokens),
        outputTokens: asNumber(invocation?.outputTokenCount ?? invocation?.outputTokens),
        totalTokens: asNumber(invocation?.totalTokenCount ?? invocation?.totalTokens),
      });
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  }

  visit(value);
  return found;
}

function inferStageFromPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("referral")) return "referral";
  if (normalized.includes("visit")) return "visit_notes";
  if (normalized.includes("plan-of-care") || normalized.includes("generated-plan")) return "plan_of_care";
  if (normalized.includes("oasis")) return "oasis";
  if (normalized.includes("coding")) return "coding";
  return path.basename(relativePath, ".json") || "unknown";
}

function collectPolicyModes(entries: JsonFileEntry[]): Record<string, number> {
  const modes: Record<string, number> = {};
  function recordMode(value: unknown): void {
    const mode = asString(value);
    if (!mode) {
      return;
    }
    modes[mode] = (modes[mode] ?? 0) + 1;
  }

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = asRecord(node);
    if (!record) {
      return;
    }
    recordMode(record.extractionPolicyMode);
    recordMode(asRecord(record.extractionPolicyDecision)?.mode);
    recordMode(asRecord(record.metadata)?.extractionPolicyMode);
    Object.values(record).forEach(visit);
  }

  entries.forEach((entry) => visit(entry.value));
  return modes;
}

function sumSectionCounts(entries: JsonFileEntry[], key: string): number {
  return entries.reduce((sum, entry) => {
    const summary = asRecord(asRecord(entry.value)?.summary);
    const value = asNumber(summary?.[key]);
    return sum + (value ?? 0);
  }, 0);
}

function readVisitNoteCounts(entries: JsonFileEntry[]): { reused: number; processed: number } {
  const manifest = entries.find((entry) => entry.relativePath.endsWith("visit-note-processing-manifest.json"));
  const inputs = asRecord(manifest?.value)?.visitNoteInputs;
  if (!Array.isArray(inputs)) {
    return { reused: 0, processed: 0 };
  }

  return inputs.reduce(
    (counts, entry) => {
      const record = asRecord(entry);
      if (record?.extractionSource === "cache" || record?.llmAnalysisSource === "cache") {
        counts.reused += 1;
      }
      if (record?.extractionSource === "text_export" || record?.llmAnalysisSource === "new_llm") {
        counts.processed += 1;
      }
      return counts;
    },
    { reused: 0, processed: 0 },
  );
}

export async function buildPatientCostSummary(input: {
  patientArtifactsDirectory: string;
  run: MinimalPatientRun;
  stageTimings?: PatientRunStageTiming[];
  planningDecision?: CostPlanningDecision | null;
  planningReason?: string | null;
}): Promise<PatientCostSummary> {
  const stageTimings = input.stageTimings ?? [];
  const entries = await readJsonEntries(input.patientArtifactsDirectory);
  const bedrockInvocations = entries.flatMap((entry) =>
    collectBedrockInvocations(entry.value, entry.relativePath),
  );
  const llmByStage = new Map<string, {
    stage: string;
    callCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>();
  for (const invocation of bedrockInvocations) {
    const current = llmByStage.get(invocation.stage) ?? {
      stage: invocation.stage,
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    current.callCount += 1;
    current.inputTokens += invocation.inputTokens ?? 0;
    current.outputTokens += invocation.outputTokens ?? 0;
    current.totalTokens += invocation.totalTokens ?? (invocation.inputTokens ?? 0) + (invocation.outputTokens ?? 0);
    llmByStage.set(invocation.stage, current);
  }

  const extractionPolicyModes = collectPolicyModes(entries);
  const visitNoteCounts = readVisitNoteCounts(entries);
  const logs = input.run.automationStepLogs ?? [];
  const acquisitionSources = Array.from(new Set([
    ...entries
      .map((entry) => asString(asRecord(entry.value)?.source))
      .filter((source): source is string => source !== null),
    ...(countLogMatches(logs, /print_preview_dom/i) > 0 ? ["print_preview_dom"] : []),
    ...(countLogMatches(logs, /legacy_dom/i) > 0 ? ["legacy_dom"] : []),
  ])).sort();

  const cacheHits =
    countLogMatches(logs, /\breused\b|\bcache\b/i) +
    sumSectionCounts(entries, "reusedSections") +
    visitNoteCounts.reused;
  const cacheMisses =
    countLogMatches(logs, /\bprocessed\b|\brerun\b|new_llm/i) +
    sumSectionCounts(entries, "processedSections") +
    visitNoteCounts.processed;

  const summary: PatientCostSummary = {
    schemaVersion: "patient-cost-summary.v1",
    generatedAt: new Date().toISOString(),
    batchId: input.run.batchId,
    runId: input.run.runId,
    patientId: input.run.workItemId,
    patientName: input.run.patientName,
    planningDecision: input.planningDecision ?? null,
    planningReason: input.planningReason ?? null,
    totalRuntimeMs: runtimeMs(input.run, stageTimings),
    portal: {
      browserActiveMs: portalBrowserActiveMs(stageTimings),
      patientSearchAttempts: countLogMatches(logs, /patient.*search|search.*patient|patient_lookup/i),
      dashboardResetAttempts: countLogMatches(logs, /dashboard.*reset|reset.*dashboard/i),
      retrySignals: countLogMatches(logs, /\bretry\b|fallback|recovery/i),
    },
    oasis: {
      acquisitionSources,
      printPreviewAccepted: acquisitionSources.includes("print_preview_dom"),
      legacyFallbacks: countLogMatches(logs, /legacy_dom|fallback.*legacy/i),
    },
    llm: {
      callCount: bedrockInvocations.length,
      inputTokens: Array.from(llmByStage.values()).reduce((sum, stage) => sum + stage.inputTokens, 0),
      outputTokens: Array.from(llmByStage.values()).reduce((sum, stage) => sum + stage.outputTokens, 0),
      totalTokens: Array.from(llmByStage.values()).reduce((sum, stage) => sum + stage.totalTokens, 0),
      unknownTokenCalls: bedrockInvocations.filter((entry) =>
        entry.inputTokens === null && entry.outputTokens === null && entry.totalTokens === null
      ).length,
      stages: Array.from(llmByStage.values()).sort((left, right) => left.stage.localeCompare(right.stage)),
    },
    textract: {
      ocrJobs:
        (extractionPolicyModes.ocr_required ?? 0) +
        countLogMatches(logs, /textract|ocr/i),
      ocrAvoidedByHtml: extractionPolicyModes.html_text ?? 0,
      ocrAvoidedByNativeText: extractionPolicyModes.native_text ?? 0,
      ocrDisabledSkips: countLogMatches(logs, /OCR_ENABLED=false|ocr.*disabled/i),
      extractionPolicyModes,
    },
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      reusedOasisSections: sumSectionCounts(entries, "reusedSections"),
      processedOasisSections: sumSectionCounts(entries, "processedSections"),
      reusedVisitNotes: visitNoteCounts.reused,
      processedVisitNotes: visitNoteCounts.processed,
    },
    failure: {
      retryEligible: input.run.retryEligible,
      reason: input.run.errorSummary,
    },
    stageTimings,
    artifactPaths: entries.map((entry) => entry.relativePath).sort(),
  };

  return patientCostSummarySchema.parse(summary);
}

export async function writePatientCostSummary(input: {
  patientArtifactsDirectory: string;
  run: MinimalPatientRun;
  stageTimings?: PatientRunStageTiming[];
  planningDecision?: CostPlanningDecision | null;
  planningReason?: string | null;
}): Promise<{ filePath: string; summary: PatientCostSummary }> {
  const filePath = path.join(input.patientArtifactsDirectory, PATIENT_COST_SUMMARY_FILE_NAME);
  const summary = await buildPatientCostSummary(input);
  await writeFile(filePath, JSON.stringify(summary, null, 2), "utf8");
  return { filePath, summary };
}

export function buildPreWorkerRunPlan(input: {
  batchId: string;
  mode: string;
  deltaReuseEnabled: boolean;
  patients: PreWorkerRunPlan["patients"];
}): PreWorkerRunPlan {
  const decisionCounts = input.patients.reduce((counts, patient) => {
    counts[patient.decision] = (counts[patient.decision] ?? 0) + 1;
    return counts;
  }, {
    reuse_complete: 0,
    reuse_terminal_exclusion: 0,
    needs_portal_acquisition: 0,
    local_projection_only: 0,
    needs_llm_only: 0,
  } as PreWorkerRunPlan["decisionCounts"]);

  return preWorkerRunPlanSchema.parse({
    schemaVersion: "pre-worker-run-plan.v1",
    generatedAt: new Date().toISOString(),
    batchId: input.batchId,
    mode: input.mode,
    deltaReuseEnabled: input.deltaReuseEnabled,
    totalPatients: input.patients.length,
    decisionCounts,
    patients: input.patients,
  });
}

export async function writePreWorkerRunPlan(input: {
  outputDirectory: string;
  plan: PreWorkerRunPlan;
}): Promise<string> {
  const filePath = path.join(input.outputDirectory, PRE_WORKER_RUN_PLAN_FILE_NAME);
  await writeFile(filePath, JSON.stringify(input.plan, null, 2), "utf8");
  return filePath;
}

async function readPatientCostSummary(filePath: string): Promise<PatientCostSummary | null> {
  try {
    return patientCostSummarySchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function readPreWorkerPlan(outputDirectory: string): Promise<PreWorkerRunPlan | null> {
  try {
    return preWorkerRunPlanSchema.parse(
      JSON.parse(await readFile(path.join(outputDirectory, PRE_WORKER_RUN_PLAN_FILE_NAME), "utf8")),
    );
  } catch {
    return null;
  }
}

export async function writeRunCostSummary(input: {
  outputDirectory: string;
  batchId: string;
  patientIds?: string[];
}): Promise<{ filePath: string; summary: RunCostSummary }> {
  const patientRoot = path.join(input.outputDirectory, "patients");
  const patientIds = input.patientIds ?? (await readdir(patientRoot).catch(() => []));
  const patientSummaries = (
    await Promise.all(patientIds.map((patientId) =>
      readPatientCostSummary(path.join(patientRoot, patientId, PATIENT_COST_SUMMARY_FILE_NAME)),
    ))
  ).filter((summary): summary is PatientCostSummary => summary !== null);
  const planning = await readPreWorkerPlan(input.outputDirectory);
  const summary: RunCostSummary = runCostSummarySchema.parse({
    schemaVersion: "run-cost-summary.v1",
    generatedAt: new Date().toISOString(),
    batchId: input.batchId,
    patientCount: patientSummaries.length,
    totalRuntimeMs: patientSummaries.reduce((sum, patient) => sum + (patient.totalRuntimeMs ?? 0), 0),
    portalBrowserActiveMs: patientSummaries.reduce((sum, patient) => sum + patient.portal.browserActiveMs, 0),
    patientSearchAttempts: patientSummaries.reduce((sum, patient) => sum + patient.portal.patientSearchAttempts, 0),
    dashboardResetAttempts: patientSummaries.reduce((sum, patient) => sum + patient.portal.dashboardResetAttempts, 0),
    llmCallCount: patientSummaries.reduce((sum, patient) => sum + patient.llm.callCount, 0),
    llmInputTokens: patientSummaries.reduce((sum, patient) => sum + patient.llm.inputTokens, 0),
    llmOutputTokens: patientSummaries.reduce((sum, patient) => sum + patient.llm.outputTokens, 0),
    llmTotalTokens: patientSummaries.reduce((sum, patient) => sum + patient.llm.totalTokens, 0),
    textractOcrJobs: patientSummaries.reduce((sum, patient) => sum + patient.textract.ocrJobs, 0),
    ocrAvoidedByHtml: patientSummaries.reduce((sum, patient) => sum + patient.textract.ocrAvoidedByHtml, 0),
    ocrAvoidedByNativeText: patientSummaries.reduce((sum, patient) => sum + patient.textract.ocrAvoidedByNativeText, 0),
    cacheHits: patientSummaries.reduce((sum, patient) => sum + patient.cache.hits, 0),
    cacheMisses: patientSummaries.reduce((sum, patient) => sum + patient.cache.misses, 0),
    planning: planning
      ? {
          totalPatients: planning.totalPatients,
          decisionCounts: planning.decisionCounts,
        }
      : null,
    patientCostSummaryPaths: patientSummaries.map((patient) =>
      path.join(patientRoot, patient.patientId, PATIENT_COST_SUMMARY_FILE_NAME),
    ),
  });
  const filePath = path.join(input.outputDirectory, RUN_COST_SUMMARY_FILE_NAME);
  await writeFile(filePath, JSON.stringify(summary, null, 2), "utf8");
  return { filePath, summary };
}
