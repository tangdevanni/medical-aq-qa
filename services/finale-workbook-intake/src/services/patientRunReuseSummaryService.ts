import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PatientRun,
  PatientRunCacheSummary,
  VisitNoteProcessingManifest,
} from "@medical-ai-qa/shared-types";

export const PATIENT_RUN_CACHE_SUMMARY_FILE_NAME = "patient-run-cache-summary.json";

export type PatientRunStageTiming = {
  stage: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type PatientRunTimingTracker = {
  startedAtMs: number;
  stageTimings: PatientRunStageTiming[];
  time<T>(stage: string, operation: () => Promise<T>): Promise<T>;
};

type ReferralReuseMetadata = {
  processingInputFingerprint?: string;
  referralUploadFingerprint?: string;
  reusedFromPreviousRun?: boolean;
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value ?? null));
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function hashFileIfExists(filePath: string): Promise<string | null> {
  try {
    return hashText(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function createPatientRunTimingTracker(): PatientRunTimingTracker {
  const stageTimings: PatientRunStageTiming[] = [];
  return {
    startedAtMs: Date.now(),
    stageTimings,
    async time<T>(stage: string, operation: () => Promise<T>): Promise<T> {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      try {
        return await operation();
      } finally {
        const completedAtMs = Date.now();
        stageTimings.push({
          stage,
          startedAt,
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: completedAtMs - startedAtMs,
        });
      }
    },
  };
}

export async function writePatientRunCacheSummary(input: {
  outputDirectory: string;
  run: PatientRun;
  stageTimings: PatientRunStageTiming[];
  startedAtMs: number;
}): Promise<{ filePath: string; summary: PatientRunCacheSummary }> {
  const patientArtifactsDirectory = path.join(input.outputDirectory, "patients", input.run.workItemId);
  const filePath = path.join(patientArtifactsDirectory, PATIENT_RUN_CACHE_SUMMARY_FILE_NAME);
  const previousSummary = await readJsonIfExists<PatientRunCacheSummary>(filePath);
  const referralDirectory = path.join(patientArtifactsDirectory, "referral-document-processing");
  const referralReuseMetadata = await readJsonIfExists<ReferralReuseMetadata>(
    path.join(referralDirectory, "referral-reuse-metadata.json"),
  );
  const referralFactsFingerprint = await hashFileIfExists(path.join(referralDirectory, "extracted-facts.json"));

  const oasisDomState = await readJsonIfExists<Record<string, unknown>>(
    path.join(patientArtifactsDirectory, "oasis-dom-extracted-state.json"),
  );
  const oasisDomContentHash =
    asString(oasisDomState?.contentHash) ??
    asString(asRecord(oasisDomState?.coverage)?.contentHash) ??
    null;
  const oasisQaHash = await hashFileIfExists(path.join(patientArtifactsDirectory, "oasis-dom-vs-existing-extraction-comparison.json"))
    ?? await hashFileIfExists(path.join(patientArtifactsDirectory, "qa-prefetch-result.json"));

  const planOfCare = await readJsonIfExists<Record<string, unknown>>(
    path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"),
  );
  const planOfCareSource = asRecord(planOfCare?.pocSource);
  const planOfCareSourceHash =
    asString(planOfCareSource?.sourceHash) ??
    await hashFileIfExists(path.join(patientArtifactsDirectory, "plan-of-care-review-draft.json"));

  const visitNoteManifest = await readJsonIfExists<VisitNoteProcessingManifest>(
    path.join(patientArtifactsDirectory, "visit-note-processing-manifest.json"),
  );
  const noteInputs = visitNoteManifest?.visitNoteInputs ?? [];
  const reusedVisitNotes = noteInputs.filter((entry) =>
    entry.extractionSource === "cache" || entry.llmAnalysisSource === "cache"
  ).length;
  const processedVisitNotes = noteInputs.filter((entry) =>
    entry.extractionSource === "text_export" ||
    entry.extractionSource === "new_ocr" ||
    entry.llmAnalysisSource === "new_llm"
  ).length;
  const skippedVisitNotes = noteInputs.filter((entry) =>
    entry.extractionSource === "skipped" && entry.llmAnalysisSource === "skipped"
  ).length;
  const failedVisitNotes = noteInputs.filter((entry) =>
    entry.extractionStatus === "failed" || entry.analysisStatus === "failed"
  ).length;

  const totalRuntimeMs = input.run.completedAt
    ? Math.max(0, Date.now() - input.startedAtMs)
    : null;
  const referralStatus = referralReuseMetadata?.reusedFromPreviousRun
    ? "reused"
    : referralReuseMetadata?.processingInputFingerprint
      ? "processed"
      : "not_available";
  const visitNotesStatus = noteInputs.length === 0
    ? "not_available"
    : processedVisitNotes > 0 && reusedVisitNotes > 0
      ? "mixed"
      : processedVisitNotes > 0
        ? "processed"
        : reusedVisitNotes > 0
          ? "reused"
          : "not_available";

  const oasisSkippedAsUnchanged = input.run.automationStepLogs.some((log) =>
    log.step === "oasis_qa_skipped_dom_acquisition_unchanged" ||
    log.message.toLowerCase().includes("oasis dom acquisition is unchanged")
  );
  const previousFingerprints = previousSummary?.fingerprints;
  const oasisStatus = !oasisDomContentHash
    ? "not_available"
    : oasisSkippedAsUnchanged || previousFingerprints?.oasisDomContentHash === oasisDomContentHash
      ? "reused"
      : "rerun";
  const planOfCareStatus = !planOfCareSourceHash
    ? "not_available"
    : previousFingerprints?.planOfCareSourceHash === planOfCareSourceHash
      ? "reused"
      : "rerun";
  const previousTotalRuntimeMs = previousSummary?.totalRuntimeMs ?? null;
  const estimatedSavedTimeMs =
    previousTotalRuntimeMs !== null && totalRuntimeMs !== null && previousTotalRuntimeMs > totalRuntimeMs
      ? previousTotalRuntimeMs - totalRuntimeMs
      : null;

  const summary: PatientRunCacheSummary = {
    schemaVersion: "patient-run-cache-summary.v1",
    generatedAt: new Date().toISOString(),
    patientId: input.run.workItemId,
    patientName: input.run.patientName,
    runId: input.run.runId,
    batchId: input.run.batchId,
    lastCompletedAt: input.run.completedAt,
    totalRuntimeMs,
    previousTotalRuntimeMs,
    estimatedSavedTimeMs,
    stageTimings: input.stageTimings,
    fingerprints: {
      referralUploadFingerprint: referralReuseMetadata?.referralUploadFingerprint ?? null,
      referralProcessingFingerprint: referralReuseMetadata?.processingInputFingerprint ?? null,
      referralFactsFingerprint,
      oasisDomContentHash,
      oasisQaHash,
      planOfCareSourceHash,
      visitNotesDiscoveryHash: visitNoteManifest?.visitNotesDiscoveryHash ?? null,
    },
    visitNotes: {
      total: noteInputs.length,
      reused: reusedVisitNotes,
      processed: processedVisitNotes,
      skipped: skippedVisitNotes,
      failed: failedVisitNotes,
      noteHashes: noteInputs.map((entry) => ({
        visitNoteKey: entry.visitNoteKey,
        contentHash: entry.contentHash ?? null,
        textHash: entry.textHash ?? null,
        analysisInputHash: entry.analysisInputHash ?? null,
        llmAnalysisSource: entry.llmAnalysisSource ?? null,
        extractionSource: entry.extractionSource ?? null,
      })),
    },
    reuseSummary: {
      referral: referralStatus,
      oasis: oasisStatus,
      planOfCare: planOfCareStatus,
      visitNotes: visitNotesStatus,
    },
    warnings: [],
  };

  await mkdir(patientArtifactsDirectory, { recursive: true });
  await writeFile(filePath, JSON.stringify(summary, null, 2), "utf8");
  return { filePath, summary };
}

export function formatPatientRunTimingSummary(summary: PatientRunCacheSummary): string {
  const total = summary.totalRuntimeMs === null ? "unknown" : `${Math.round(summary.totalRuntimeMs / 1000)}s`;
  const saved = summary.estimatedSavedTimeMs === null || summary.estimatedSavedTimeMs === undefined
    ? "unknown"
    : `${Math.round(summary.estimatedSavedTimeMs / 1000)}s`;
  return [
    `Incremental run timing: total=${total}`,
    `savedVsPrevious=${saved}`,
    `referral=${summary.reuseSummary.referral}`,
    `oasis=${summary.reuseSummary.oasis}`,
    `poc=${summary.reuseSummary.planOfCare}`,
    `visitNotes=${summary.visitNotes.processed} processed/${summary.visitNotes.reused} reused`,
  ].join("; ");
}
