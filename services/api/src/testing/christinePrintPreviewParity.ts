import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv as loadFinaleEnv } from "@medical-ai-qa/finale-workbook-intake/src/config/env";
import {
  buildCanonicalOasisFromTextFile,
  persistCanonicalOasisArtifacts,
} from "@medical-ai-qa/finale-workbook-intake/src/oasis/canonical/printPreviewCanonicalOasis";
import {
  processOasisDomSections,
} from "@medical-ai-qa/finale-workbook-intake/src/services/oasisDomSectionProcessingService";
import { toDashboardPatientDetail } from "../mappers/dashboardRunViews";

const CHRISTINE_PATIENT_ID = "CHRISTINE_YOUNG__a89bc267c323fb6a";
const REQUIRED_BASELINE_FILES = [
  "patient-dashboard-state.json",
  "qa-prefetch-result.json",
  "oasis-dom-section-outputs.json",
];

type DifferenceSeverity = "ignored" | "minor" | "material" | "critical";

type Difference = {
  severity: DifferenceSeverity;
  rowFamily: string;
  path: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
};

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  return fileExists(filePath).then((exists) => exists ? readJson<T>(filePath) : null);
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath).then((entry) => entry.isFile()).catch(() => false);
}

async function walkForDashboardStates(root: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const normalized = fullPath.replace(/\\/g, "/").toLowerCase();
    if (
      normalized.includes("print-preview") ||
      normalized.includes("print_preview_dom") ||
      normalized.includes("parity") ||
      normalized.includes("/ab-christine-preview") ||
      normalized.includes("\\ab-christine-preview") ||
      normalized.includes("/baseline-legacy-dom") ||
      normalized.includes("\\baseline-legacy-dom") ||
      normalized.includes("/candidate-print-preview-dom") ||
      normalized.includes("\\candidate-print-preview-dom")
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkForDashboardStates(fullPath, acc);
    } else if (entry.isFile() && entry.name === "patient-dashboard-state.json") {
      acc.push(fullPath);
    }
  }
  return acc;
}

async function locateChristineBaseline(root: string): Promise<string> {
  const candidates = await walkForDashboardStates(root);
  const qualified: Array<{ directory: string; mtimeMs: number }> = [];
  for (const dashboardStatePath of candidates) {
    const directory = path.dirname(dashboardStatePath);
    const state = await readJson<Record<string, unknown>>(dashboardStatePath).catch(() => null);
    const patientId = String(state?.patientId ?? "");
    const patientName = String(state?.patientName ?? "");
    if (patientId !== CHRISTINE_PATIENT_ID && !/christine\s+young/i.test(patientName)) {
      continue;
    }
    const missing = [];
    for (const fileName of REQUIRED_BASELINE_FILES) {
      if (!(await fileExists(path.join(directory, fileName)))) {
        missing.push(fileName);
      }
    }
    if (missing.length > 0) {
      continue;
    }
    qualified.push({
      directory,
      mtimeMs: (await stat(dashboardStatePath)).mtimeMs,
    });
  }
  if (qualified.length === 0) {
    throw new Error(
      `Christine golden baseline not found under ${root}. Missing required co-located files: ${REQUIRED_BASELINE_FILES.join(", ")}`,
    );
  }
  qualified.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return qualified[0].directory;
}

async function locatePrintPreviewText(input: {
  explicitPath?: string | null;
  baselineDirectory: string;
  searchRoot: string;
}): Promise<string> {
  if (input.explicitPath) {
    if (!(await fileExists(input.explicitPath))) {
      throw new Error(`PRINT_PREVIEW_TEXT_PATH does not exist: ${input.explicitPath}`);
    }
    return input.explicitPath;
  }
  const direct = path.join(input.baselineDirectory, "oasis-print-preview-dom", "extracted-text.txt");
  if (await fileExists(direct)) {
    return direct;
  }
  const matches: string[] = [];
  async function walk(root: string): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.replace(/\\/g, "/").endsWith("/oasis-print-preview-dom/extracted-text.txt")) {
        const content = await readFile(fullPath, "utf8").catch(() => "");
        if (/YOUNG,\s*CHRISTINE|CHRISTINE\s+YOUNG/i.test(content)) {
          matches.push(fullPath);
        }
      }
    }
  }
  await walk(input.searchRoot);
  if (matches.length === 0) {
    throw new Error(
      "Print-preview OASIS text artifact was not found. Expected oasis-print-preview-dom/extracted-text.txt or PRINT_PREVIEW_TEXT_PATH.",
    );
  }
  return matches[0];
}

function makeProjectionInput(state: any, artifactContents: Record<string, unknown>) {
  const now = state.generatedAt ?? new Date().toISOString();
  const summary = {
    runId: state.runId,
    workItemId: state.patientId,
    subsidiaryId: state.subsidiaryId ?? "star-home-health",
    patientName: state.patientName,
    processingStatus: state.processingStatus,
    executionStep: state.executionStep,
    progressPercent: state.progressPercent,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastUpdatedAt: state.lastUpdatedAt ?? now,
    errorSummary: state.errorSummary,
    retryEligible: false,
    attemptCount: 1,
    resultBundlePath: state.resultBundlePath,
    logPath: state.logPath,
    matchResult: state.matchResult,
    qaOutcome: state.qaOutcome,
    workflowRuns: state.workflowRuns ?? [],
  };
  return {
    batch: {
      id: state.batchId,
      status: "COMPLETED",
      createdAt: state.startedAt ?? now,
      updatedAt: state.lastUpdatedAt ?? now,
      subsidiary: {
        id: state.subsidiaryId ?? "star-home-health",
        slug: state.subsidiaryId ?? "star-home-health",
        name: "Star Home Health",
      },
      storage: {
        outputRoot: path.dirname(path.dirname(state.artifactPaths?.documentText ?? "")),
      },
      parse: {},
      run: {},
      schedule: {},
      patientRuns: [summary],
    },
    summary,
    workItem: state.workItem ?? null,
    changeSummary: state.changeSummary ?? null,
    artifactContents,
  } as any;
}

function normalizeText(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim()
    .toLowerCase();
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (/^(id|runId|batchId|artifactPath|path|generatedAt|createdAt|updatedAt|lastUpdatedAt|capturedAt|processedAt)$/i.test(key)) {
        continue;
      }
      if (key === "source") {
        normalized[key] = "source_normalized";
        continue;
      }
      normalized[key] = stableNormalize(record[key]);
    }
    return normalized;
  }
  return normalizeText(value);
}

function pickProjectionFamilies(detail: any) {
  return {
    diagnoses: stableNormalize({
      primaryDiagnosis: detail.primaryDiagnosis,
      otherDiagnoses: detail.otherDiagnoses,
      referralDiagnosisSummary: detail.referralDiagnosisSummary,
      oasisDiagnosisSummary: detail.oasisDiagnosisSummary,
      diagnosisComparisonStatus: detail.diagnosisComparisonStatus,
    }),
    medications: stableNormalize({
      referralMedicationSummary: detail.referralMedicationSummary,
      oasisMedicationSummary: detail.oasisMedicationSummary,
    }),
    allergies: stableNormalize(detail.dashboardState?.rows?.filter((row: any) => /allerg/i.test(`${row.sectionKey} ${row.label} ${row.documentValue} ${row.chartValue}`))),
    carePlan: stableNormalize(detail.planOfCareReview),
    visitNotes: stableNormalize(detail.visitNotesReview),
    oasisDocumentation: stableNormalize(detail.oasisDocumentationReview),
    referralDocumentation: stableNormalize(detail.referralDocumentationReview),
    qaWarnings: stableNormalize([
      ...(detail.qaPrefetch?.warnings ?? []),
      ...(detail.dashboardState?.sourceCoverage?.warnings ?? []),
    ]),
    qaBlockers: stableNormalize(
      detail.dashboardState?.rows?.filter((row: any) => /missing|blocked|no oasis document content/i.test(`${row.result} ${row.shortReason} ${row.note}`)),
    ),
    dashboardRows: stableNormalize(detail.dashboardState?.rows ?? []),
  };
}

function compareFamilies(a: Record<string, unknown>, b: Record<string, unknown>): {
  differences: Difference[];
  summary: Record<string, "pass" | "minor" | "fail">;
} {
  const differences: Difference[] = [];
  const summary: Record<string, "pass" | "minor" | "fail"> = {};
  for (const family of Object.keys(a)) {
    const oldValue = a[family];
    const newValue = b[family];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      summary[family] = "pass";
      continue;
    }
    const severity: DifferenceSeverity = family === "qaBlockers" ? "critical" : "material";
    differences.push({
      severity,
      rowFamily: family,
      path: family,
      oldValue,
      newValue,
      reason: `${family} differs after dashboard parity normalization`,
    });
    summary[family] = "fail";
  }
  return { differences, summary };
}

async function main(): Promise<void> {
  const searchRoot = process.env.CHRISTINE_BASELINE_ROOT ??
    path.resolve(process.cwd(), "..", "..", "..", "medical-aq-qa");
  const baselineDirectory = await locateChristineBaseline(searchRoot);
  const previewTextPath = await locatePrintPreviewText({
    explicitPath: process.env.PRINT_PREVIEW_TEXT_PATH ?? null,
    baselineDirectory,
    searchRoot,
  });
  const outputDirectory = process.env.CHRISTINE_PARITY_OUTPUT_DIR ??
    path.join(baselineDirectory, "print-preview-parity", "christine-young");
  await mkdir(outputDirectory, { recursive: true });

  const baselineState = await readJson<any>(path.join(baselineDirectory, "patient-dashboard-state.json"));
  const baselineArtifactContents = {
    ...(baselineState.artifactContents ?? {}),
    qaPrefetch: await readJson(path.join(baselineDirectory, "qa-prefetch-result.json")),
    oasisDomSectionOutputs: await readJson(path.join(baselineDirectory, "oasis-dom-section-outputs.json")),
    oasisDomSectionProcessingManifest: await readJsonIfExists(path.join(baselineDirectory, "oasis-dom-section-processing-manifest.json")),
    oasisDomExtractedState: await readJsonIfExists(path.join(baselineDirectory, "oasis-dom-extracted-state.json")),
    oasisDomAcquisitionState: await readJsonIfExists(path.join(baselineDirectory, "oasis-dom-acquisition-state.json")),
    printedNoteChartValues: await readJsonIfExists(path.join(baselineDirectory, "printed-note-chart-values.json")),
    printedNoteReview: await readJsonIfExists(path.join(baselineDirectory, "oasis-printed-note-review.json")),
  };
  const baselineProjection = toDashboardPatientDetail(makeProjectionInput(baselineState, baselineArtifactContents));

  const canonical = await buildCanonicalOasisFromTextFile({
    textPath: previewTextPath,
    source: "print_preview_dom",
  });
  if (!canonical.document.qualityGate.passed) {
    throw new Error(`Print-preview quality gate failed: ${canonical.document.qualityGate.warnings.join("; ")}`);
  }
  const canonicalPaths = await persistCanonicalOasisArtifacts({
    patientArtifactsDirectory: outputDirectory,
    canonical,
  });
  const sectionProcessing = await processOasisDomSections({
    state: canonical.portalDomState,
    patientArtifactsDirectory: outputDirectory,
    patientId: baselineState.patientId,
    patientRunId: baselineState.runId,
    env: loadFinaleEnv(),
    sourceDomStatePath: canonicalPaths.documentPath,
  });
  const candidateArtifactContents = {
    ...(baselineState.artifactContents ?? {}),
    qaPrefetch: {
      ...(baselineArtifactContents.qaPrefetch as Record<string, unknown>),
      warnings: (baselineArtifactContents.qaPrefetch as any)?.warnings ?? [],
      oasisEvidenceSource: "print_preview_dom",
    },
    oasisDomExtractedState: canonical.portalDomState,
    oasisDomSectionProcessingManifest: sectionProcessing.manifest,
    oasisDomSectionOutputs: sectionProcessing.outputs,
  };
  const candidateProjection = toDashboardPatientDetail(makeProjectionInput(baselineState, candidateArtifactContents));

  const baselineNormalized = pickProjectionFamilies(baselineProjection);
  const candidateNormalized = pickProjectionFamilies(candidateProjection);
  const comparison = compareFamilies(baselineNormalized, candidateNormalized);
  const report = {
    schemaVersion: "christine-dashboard-parity.v1",
    generatedAt: new Date().toISOString(),
    baselineDirectory,
    previewTextPath,
    outputDirectory,
    canonicalPaths,
    sectionOutputsPath: sectionProcessing.outputsPath,
    summary: comparison.summary,
    differenceCounts: {
      ignored: comparison.differences.filter((diff) => diff.severity === "ignored").length,
      minor: comparison.differences.filter((diff) => diff.severity === "minor").length,
      material: comparison.differences.filter((diff) => diff.severity === "material").length,
      critical: comparison.differences.filter((diff) => diff.severity === "critical").length,
    },
    differences: comparison.differences,
  };

  await Promise.all([
    writeFile(path.join(outputDirectory, "christine-young-dashboard-baseline-normalized.json"), JSON.stringify(baselineNormalized, null, 2), "utf8"),
    writeFile(path.join(outputDirectory, "christine-young-print-preview-dashboard-normalized.json"), JSON.stringify(candidateNormalized, null, 2), "utf8"),
    writeFile(path.join(outputDirectory, "christine-young-dashboard-parity-report.json"), JSON.stringify(report, null, 2), "utf8"),
    writeFile(path.join(outputDirectory, "run-verification-manifest.json"), JSON.stringify({
      generatedAt: report.generatedAt,
      baselineDirectory,
      previewTextPath,
      outputDirectory,
      liveAcquisitionTriggered: false,
      featureFlags: {
        OASIS_ACQUISITION_SOURCE: process.env.OASIS_ACQUISITION_SOURCE ?? null,
      },
    }, null, 2), "utf8"),
  ]);

  const failed = report.differenceCounts.material > 0 || report.differenceCounts.critical > 0;
  console.log(JSON.stringify({
    status: failed ? "failed" : "passed",
    reportPath: path.join(outputDirectory, "christine-young-dashboard-parity-report.json"),
    differenceCounts: report.differenceCounts,
  }, null, 2));
  if (failed) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
