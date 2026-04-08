import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PatientRun, PatientRunLog } from "@medical-ai-qa/shared-types";

function buildPatientRunLogRecord(patientRun: PatientRun): PatientRunLog {
  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    runId: patientRun.runId,
    batchId: patientRun.batchId,
    subsidiaryId: patientRun.subsidiaryId,
    workItemId: patientRun.workItemId,
    patientName: patientRun.patientName,
    processingStatus: patientRun.processingStatus,
    executionStep: patientRun.executionStep,
    qaOutcome: patientRun.qaOutcome,
    progressPercent: patientRun.progressPercent,
    startedAt: patientRun.startedAt,
    completedAt: patientRun.completedAt,
    lastUpdatedAt: patientRun.lastUpdatedAt,
    artifactCount: patientRun.artifactCount,
    findingsCount: patientRun.findings.length,
    bundlePath: patientRun.resultBundlePath,
    oasisQaSummary: patientRun.oasisQaSummary,
    documentInventory: [...patientRun.documentInventory],
    errorSummary: patientRun.errorSummary,
    automationStepLogs: [...patientRun.automationStepLogs],
    notes: [...patientRun.notes],
    auditArtifacts: {
      tracePath: patientRun.auditArtifacts.tracePath,
      screenshotPaths: [...patientRun.auditArtifacts.screenshotPaths],
      downloadPaths: [...patientRun.auditArtifacts.downloadPaths],
    },
  };
}

export async function writePatientRunLog(
  outputDirectory: string,
  patientRun: PatientRun,
): Promise<string> {
  const logDirectory = path.join(outputDirectory, "logs");
  await mkdir(logDirectory, { recursive: true });

  const logPath = path.join(logDirectory, `${patientRun.workItemId}.json`);
  await writeFile(logPath, JSON.stringify(buildPatientRunLogRecord(patientRun), null, 2), "utf8");
  return logPath;
}
