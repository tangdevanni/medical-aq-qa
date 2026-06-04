import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PatientRun } from "@medical-ai-qa/shared-types";
import { loadEnv } from "../config/env";
import {
  extractReferralDirectDocument,
  type ReferralDirectDocumentExtractionResult,
} from "../referralProcessing/directDocumentExtractor";
import type {
  QaDocumentSummary,
  ReferralDocumentProcessingResult,
  ReferralLlmProposal,
  SourceDocumentArtifact,
  SourceDocumentReference,
} from "../referralProcessing/types";

interface BatchFile {
  id: string;
  storage: {
    batchRoot?: string;
    outputRoot: string;
  };
  patientRuns: PatientRun[];
}

interface BaselineArtifacts {
  sourceMeta: SourceDocumentArtifact | null;
  extractedFacts: ReferralDocumentProcessingResult["extractedFacts"] | null;
  llmProposal: ReferralLlmProposal | null;
  qaDocumentSummary: QaDocumentSummary | null;
}

interface PatientComparisonSummary {
  patientId: string;
  patientName: string;
  referralArtifactDirectory: string;
  selectedSourceDocument: SourceDocumentReference | null;
  baseline: {
    diagnosisCount: number;
    medicationFactCount: number;
    primaryDiagnosis: string | null;
    diagnosisCandidates: Array<{
      description: string;
      icd10_code: string | null;
      confidence: number;
      requires_human_review: boolean;
    }>;
    extractionUsabilityStatus: string | null;
    warnings: string[];
  };
  directDocument: {
    status: "completed" | "dry_run" | "failed" | "missing_source";
    resultPath: string | null;
    acceptedDiagnosisCount: number;
    acceptedMedicationCount: number;
    rejectedDiagnosisCount: number;
    rejectedMedicationCount: number;
    latencyMs: number | null;
    inputTokenCount: number | null;
    outputTokenCount: number | null;
    totalTokenCount: number | null;
    warnings: string[];
    error: string | null;
  };
  comparison: {
    baselineDiagnosisCodes: string[];
    directDiagnosisCodes: string[];
    overlappingDiagnosisCodes: string[];
    baselineHasZ4789LeftKneeRisk: boolean;
    directHasZ4789RightShoulderSupport: boolean;
    directMedicationStartDateCount: number;
    verdict:
      | "not_evaluated"
      | "direct_document_better_for_suspect_diagnosis"
      | "direct_document_comparable"
      | "needs_manual_review";
    reasons: string[];
  };
}

interface IndexSummary {
  schemaVersion: "referral-direct-document-comparison-index.v1";
  generatedAt: string;
  batchPath: string;
  batchId: string;
  outputRoot: string;
  dryRun: boolean;
  requestedPatients: string[];
  patientCount: number;
  completedCount: number;
  failedCount: number;
  missingSourceCount: number;
  outputDirectory: string;
  patients: PatientComparisonSummary[];
}

function argValue(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "patient";
}

async function findWorkspaceRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not find workspace root from ${startDir}.`);
    }
    currentDir = parentDir;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function findFilesByName(root: string, fileName: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (currentPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) {
        matches.push(fullPath);
      }
    }
  };

  await visit(root);
  return matches;
}

async function findLatestStarHomeBatchPath(): Promise<string> {
  const workspaceRoot = await findWorkspaceRoot(process.cwd());
  const root = path.join(workspaceRoot, "services", "api", "data", "control-plane", "batches", "star-home-health");
  const batchPaths = await findFilesByName(root, "batch.json");
  if (batchPaths.length === 0) {
    throw new Error(`No Star Home batch.json files found under ${root}. Pass --batch explicitly.`);
  }

  const withStats = await Promise.all(
    batchPaths.map(async (batchPath) => ({
      batchPath,
      mtimeMs: (await stat(batchPath)).mtimeMs,
    })),
  );

  return withStats.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]!.batchPath;
}

function parsePatientList(value: string | null): string[] {
  return normalizeWhitespace(value)
    .split(",")
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
}

function matchesPatient(run: PatientRun, patientQuery: string): boolean {
  const normalizedQuery = normalizeWhitespace(patientQuery).toLowerCase();
  if (!normalizedQuery) {
    return false;
  }
  return (
    run.patientName.toLowerCase() === normalizedQuery ||
    run.workItemId.toLowerCase() === normalizedQuery ||
    run.patientName.toLowerCase().includes(normalizedQuery) ||
    run.workItemId.toLowerCase().includes(normalizedQuery.replace(/\s+/g, "_"))
  );
}

async function loadBaselineArtifacts(referralDir: string): Promise<BaselineArtifacts> {
  return {
    sourceMeta: await readJsonIfExists<SourceDocumentArtifact>(path.join(referralDir, "source-meta.json")),
    extractedFacts: await readJsonIfExists<ReferralDocumentProcessingResult["extractedFacts"]>(
      path.join(referralDir, "extracted-facts.json"),
    ),
    llmProposal: await readJsonIfExists<ReferralLlmProposal>(path.join(referralDir, "llm-proposal.json")),
    qaDocumentSummary: await readJsonIfExists<QaDocumentSummary>(path.join(referralDir, "qa-document-summary.json")),
  };
}

function selectSourceDocument(sourceMeta: SourceDocumentArtifact | null): SourceDocumentReference | null {
  if (!sourceMeta) {
    return null;
  }
  const selected = sourceMeta.selectedDocumentId
    ? sourceMeta.sourceDocuments.find((document) => document.documentId === sourceMeta.selectedDocumentId)
    : null;
  return selected?.localFilePath
    ? selected
    : sourceMeta.sourceDocuments.find((document) => Boolean(document.localFilePath)) ?? null;
}

async function selectPatientRuns(batch: BatchFile, patientQueries: string[], limit: number): Promise<PatientRun[]> {
  if (patientQueries.length > 0) {
    const selected: PatientRun[] = [];
    for (const query of patientQueries) {
      const match = batch.patientRuns.find((run) => matchesPatient(run, query));
      if (!match) {
        throw new Error(`Patient was not found in batch ${batch.id}: ${query}`);
      }
      selected.push(match);
    }
    return selected;
  }

  const selected: PatientRun[] = [];
  for (const run of batch.patientRuns) {
    const referralDir = path.join(batch.storage.outputRoot, "patients", run.workItemId, "referral-document-processing");
    const sourceMeta = await readJsonIfExists<SourceDocumentArtifact>(path.join(referralDir, "source-meta.json"));
    const sourceDocument = selectSourceDocument(sourceMeta);
    if (sourceDocument?.localFilePath && await pathExists(sourceDocument.localFilePath)) {
      selected.push(run);
    }
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value).toUpperCase().replace(/[^A-Z0-9.]/g, "");
  return normalized || null;
}

function uniqueCodes(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeCode).filter((value): value is string => Boolean(value)))).sort();
}

function primaryDiagnosis(proposal: ReferralLlmProposal | null): string | null {
  const candidate = proposal?.diagnosis_candidates.find((diagnosis) => diagnosis.is_primary_candidate) ??
    proposal?.diagnosis_candidates[0] ??
    null;
  if (!candidate) {
    return null;
  }
  return normalizeWhitespace([candidate.icd10_code, candidate.description].filter(Boolean).join(" - ")) || null;
}

function medicationFactCount(facts: ReferralDocumentProcessingResult["extractedFacts"] | null): number {
  return facts?.facts.filter((fact) =>
    /medication|pain|allerg/i.test(`${fact.fact_key} ${fact.category}`),
  ).length ?? 0;
}

function hasZ4789LeftKneeRisk(proposal: ReferralLlmProposal | null): boolean {
  return Boolean(proposal?.diagnosis_candidates.some((diagnosis) => {
    const code = normalizeCode(diagnosis.icd10_code);
    const text = normalizeWhitespace([
      diagnosis.description,
      ...diagnosis.source_spans,
    ].join(" ")).toLowerCase();
    return code === "Z47.89" && /left knee|arthroplasty of left knee|history of arthroplasty/i.test(text);
  }));
}

function hasZ4789RightShoulderSupport(result: ReferralDirectDocumentExtractionResult | null): boolean {
  return Boolean(result?.accepted.diagnoses.some((diagnosis) => {
    const code = normalizeCode(diagnosis.icd10_code);
    const text = normalizeWhitespace([
      diagnosis.description,
      diagnosis.source_quote,
      ...diagnosis.body_site_terms,
      ...diagnosis.laterality_terms,
    ].join(" ")).toLowerCase();
    return code === "Z47.89" && /right shoulder|orthopedic aftercare|orthopaedic aftercare/i.test(text);
  }));
}

function buildComparison(input: {
  baseline: BaselineArtifacts;
  directResult: ReferralDirectDocumentExtractionResult | null;
  directStatus: PatientComparisonSummary["directDocument"]["status"];
  directError: string | null;
}): PatientComparisonSummary["comparison"] {
  const baselineDiagnosisCodes = uniqueCodes(
    input.baseline.llmProposal?.diagnosis_candidates.map((diagnosis) => diagnosis.icd10_code) ?? [],
  );
  const directDiagnosisCodes = uniqueCodes(
    input.directResult?.accepted.diagnoses.map((diagnosis) => diagnosis.icd10_code) ?? [],
  );
  const baselineCodeSet = new Set(baselineDiagnosisCodes);
  const overlappingDiagnosisCodes = directDiagnosisCodes.filter((code) => baselineCodeSet.has(code));
  const baselineHasZ4789LeftKneeRisk = hasZ4789LeftKneeRisk(input.baseline.llmProposal);
  const directHasZ4789RightShoulderSupport = hasZ4789RightShoulderSupport(input.directResult);
  const directMedicationStartDateCount =
    input.directResult?.accepted.medications.filter((medication) => normalizeWhitespace(medication.start_date).length > 0).length ?? 0;

  const reasons: string[] = [];
  let verdict: PatientComparisonSummary["comparison"]["verdict"] = "needs_manual_review";
  if (input.directStatus !== "completed") {
    verdict = "not_evaluated";
    reasons.push(input.directError ?? `Direct-document branch status: ${input.directStatus}`);
  } else if (baselineHasZ4789LeftKneeRisk && directHasZ4789RightShoulderSupport) {
    verdict = "direct_document_better_for_suspect_diagnosis";
    reasons.push("Direct-document branch supports Z47.89 with right-shoulder/orthopedic-aftercare source evidence.");
  } else if (directDiagnosisCodes.length > 0 && overlappingDiagnosisCodes.length > 0) {
    verdict = "direct_document_comparable";
    reasons.push("Direct-document branch produced source-quoted diagnoses with overlapping ICD codes.");
  } else {
    reasons.push("Direct-document branch requires manual review before judging quality.");
  }

  if ((input.directResult?.rejected.diagnoses.length ?? 0) > 0) {
    reasons.push("Some direct-document diagnoses were rejected because source_quote was missing.");
  }
  if ((input.directResult?.rejected.medications.length ?? 0) > 0) {
    reasons.push("Some direct-document medications were rejected because source_quote was missing.");
  }

  return {
    baselineDiagnosisCodes,
    directDiagnosisCodes,
    overlappingDiagnosisCodes,
    baselineHasZ4789LeftKneeRisk,
    directHasZ4789RightShoulderSupport,
    directMedicationStartDateCount,
    verdict,
    reasons,
  };
}

async function comparePatient(input: {
  batch: BatchFile;
  run: PatientRun;
  outputDirectory: string;
  dryRun: boolean;
}): Promise<PatientComparisonSummary> {
  const referralDir = path.join(
    input.batch.storage.outputRoot,
    "patients",
    input.run.workItemId,
    "referral-document-processing",
  );
  const baseline = await loadBaselineArtifacts(referralDir);
  const selectedSourceDocument = selectSourceDocument(baseline.sourceMeta);
  const patientOutputDir = path.join(input.outputDirectory, `${slugify(input.run.patientName)}-${input.run.workItemId}`);
  await mkdir(patientOutputDir, { recursive: true });

  await writeFile(
    path.join(patientOutputDir, "baseline-summary.json"),
    JSON.stringify({
      patientId: input.run.workItemId,
      patientName: input.run.patientName,
      referralArtifactDirectory: referralDir,
      selectedSourceDocument,
      qaDocumentSummary: baseline.qaDocumentSummary,
      diagnosisCandidates: baseline.llmProposal?.diagnosis_candidates ?? [],
      medicationFactCount: medicationFactCount(baseline.extractedFacts),
    }, null, 2),
    "utf8",
  );

  let directResult: ReferralDirectDocumentExtractionResult | null = null;
  let directStatus: PatientComparisonSummary["directDocument"]["status"] = "missing_source";
  let directError: string | null = null;
  const directResultPath = path.join(patientOutputDir, "direct-document-result.json");

  if (!selectedSourceDocument?.localFilePath || !(await pathExists(selectedSourceDocument.localFilePath))) {
    directError = "No readable local referral source document was found in source-meta.json.";
  } else if (input.dryRun) {
    directStatus = "dry_run";
  } else {
    try {
      const env = loadEnv({
        ...process.env,
        CODE_LLM_ENABLED: process.env.CODE_LLM_ENABLED ?? "true",
      });
      directResult = await extractReferralDirectDocument({
        env,
        filePath: selectedSourceDocument.localFilePath,
        patientName: input.run.patientName,
        sourceLabel: selectedSourceDocument.sourceLabel,
      });
      await writeFile(directResultPath, JSON.stringify(directResult, null, 2), "utf8");
      directStatus = "completed";
    } catch (error) {
      directStatus = "failed";
      directError = error instanceof Error ? error.message : String(error);
      await writeFile(directResultPath, JSON.stringify({
        patientId: input.run.workItemId,
        patientName: input.run.patientName,
        error: directError,
        generatedAt: new Date().toISOString(),
      }, null, 2), "utf8");
    }
  }

  const comparison = buildComparison({
    baseline,
    directResult,
    directStatus,
    directError,
  });
  const summary: PatientComparisonSummary = {
    patientId: input.run.workItemId,
    patientName: input.run.patientName,
    referralArtifactDirectory: referralDir,
    selectedSourceDocument,
    baseline: {
      diagnosisCount: baseline.llmProposal?.diagnosis_candidates.length ?? 0,
      medicationFactCount: medicationFactCount(baseline.extractedFacts),
      primaryDiagnosis: primaryDiagnosis(baseline.llmProposal),
      diagnosisCandidates: baseline.llmProposal?.diagnosis_candidates.map((diagnosis) => ({
        description: diagnosis.description,
        icd10_code: diagnosis.icd10_code,
        confidence: diagnosis.confidence,
        requires_human_review: diagnosis.requires_human_review,
      })) ?? [],
      extractionUsabilityStatus: baseline.qaDocumentSummary?.extractionUsabilityStatus ?? null,
      warnings: [
        ...(baseline.llmProposal?.warnings ?? []),
        ...(baseline.qaDocumentSummary?.warnings ?? []),
      ],
    },
    directDocument: {
      status: directStatus,
      resultPath: directStatus === "completed" || directStatus === "failed" ? directResultPath : null,
      acceptedDiagnosisCount: directResult?.accepted.diagnoses.length ?? 0,
      acceptedMedicationCount: directResult?.accepted.medications.length ?? 0,
      rejectedDiagnosisCount: directResult?.rejected.diagnoses.length ?? 0,
      rejectedMedicationCount: directResult?.rejected.medications.length ?? 0,
      latencyMs: directResult?.invocation.latencyMs ?? null,
      inputTokenCount: directResult?.invocation.inputTokenCount ?? null,
      outputTokenCount: directResult?.invocation.outputTokenCount ?? null,
      totalTokenCount: directResult?.invocation.totalTokenCount ?? null,
      warnings: directResult?.warnings ?? [],
      error: directError,
    },
    comparison,
  };

  await writeFile(
    path.join(patientOutputDir, "comparison-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  return summary;
}

async function main(): Promise<void> {
  const batchPath = path.resolve(argValue("batch") ?? await findLatestStarHomeBatchPath());
  const batch = JSON.parse(await readFile(batchPath, "utf8")) as BatchFile;
  const requestedPatients = parsePatientList(argValue("patients"));
  const limit = Math.max(1, Number(argValue("limit") ?? "5") || 5);
  const dryRun = hasFlag("dry-run");
  const outputDirectory = path.resolve(
    argValue("out") ??
      path.join("tmp", "referral-direct-doc-comparison", new Date().toISOString().replace(/[:.]/g, "-")),
  );
  await mkdir(outputDirectory, { recursive: true });

  const runs = await selectPatientRuns(batch, requestedPatients, limit);
  const patients: PatientComparisonSummary[] = [];
  for (const run of runs) {
    patients.push(await comparePatient({
      batch,
      run,
      outputDirectory,
      dryRun,
    }));
  }

  const index: IndexSummary = {
    schemaVersion: "referral-direct-document-comparison-index.v1",
    generatedAt: new Date().toISOString(),
    batchPath,
    batchId: batch.id,
    outputRoot: batch.storage.outputRoot,
    dryRun,
    requestedPatients,
    patientCount: patients.length,
    completedCount: patients.filter((patient) => patient.directDocument.status === "completed").length,
    failedCount: patients.filter((patient) => patient.directDocument.status === "failed").length,
    missingSourceCount: patients.filter((patient) => patient.directDocument.status === "missing_source").length,
    outputDirectory,
    patients,
  };
  const indexPath = path.join(outputDirectory, "comparison-index.json");
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
  console.log(JSON.stringify({
    batchPath,
    outputDirectory,
    indexPath,
    dryRun,
    patientCount: patients.length,
    completedCount: index.completedCount,
    failedCount: index.failedCount,
    missingSourceCount: index.missingSourceCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
