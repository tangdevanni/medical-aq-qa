import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PatientDashboardArtifactPaths,
  PatientDashboardState,
  PatientRun,
  PatientWorkflowRun,
} from "@medical-ai-qa/shared-types";

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

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulValue(entry));
  }

  return true;
}

function mergeFieldMapSnapshotWithPrintedNoteValues(input: {
  fieldMapSnapshot: unknown | null;
  printedNoteChartValues: unknown | null;
}): unknown | null {
  const fieldMapSnapshot = asRecord(input.fieldMapSnapshot);
  const fields = Array.isArray(fieldMapSnapshot?.fields) ? fieldMapSnapshot.fields : null;
  const printedNoteChartValuesRecord = asRecord(input.printedNoteChartValues);
  const printedNoteChartValues = asRecord(printedNoteChartValuesRecord?.currentChartValues);

  if (!fieldMapSnapshot || !fields || !printedNoteChartValues) {
    return input.fieldMapSnapshot;
  }

  const mergedFields = fields.map((fieldValue) => {
    const field = asRecord(fieldValue);
    const fieldKey = asString(field?.key);
    if (!field || !fieldKey) {
      return fieldValue;
    }

    const recoveredChartValue = printedNoteChartValues[fieldKey];
    if (!hasMeaningfulValue(recoveredChartValue)) {
      return fieldValue;
    }

    if (asString(field.currentChartValueSource) === "chart_read") {
      return fieldValue;
    }

    return {
      ...field,
      currentChartValue: recoveredChartValue,
      currentChartValueSource: "printed_note_ocr",
      populatedInChart: true,
    };
  });

  return {
    ...fieldMapSnapshot,
    fields: mergedFields,
    already_populated_from_chart: mergedFields
      .filter((fieldValue) => {
        const field = asRecord(fieldValue);
        return typeof field?.populatedInChart === "boolean" ? field.populatedInChart : false;
      })
      .map((fieldValue) => {
        const field = asRecord(fieldValue);
        return asString(field?.key);
      })
      .filter((fieldKey): fieldKey is string => fieldKey !== null),
  };
}

export async function writePatientDashboardState(params: {
  outputDirectory: string;
  run: PatientRun;
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
  const rawFieldMapSnapshot = await readJsonIfExists(artifactPaths.fieldMapSnapshot);
  const printedNoteChartValues = await readJsonIfExists(artifactPaths.printedNoteChartValues);
  const printedNoteReview = await readJsonIfExists(artifactPaths.printedNoteReview);
  const fieldMapSnapshot = mergeFieldMapSnapshotWithPrintedNoteValues({
    fieldMapSnapshot: rawFieldMapSnapshot,
    printedNoteChartValues,
  });

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
    workItem: params.run.workItemSnapshot ?? null,
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
    },
  };

  await mkdir(patientArtifactsDirectory, { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");

  return {
    filePath,
    state,
  };
}
