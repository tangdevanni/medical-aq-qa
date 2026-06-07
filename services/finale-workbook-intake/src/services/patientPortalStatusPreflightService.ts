import path from "node:path";
import type {
  AutomationStepLog,
  PatientEpisodeWorkItem,
  SubsidiaryRuntimeConfig,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { FinaleBatchEnv } from "../config/env";
import { resolvePortalRuntimeConfig } from "../config/portalRuntime";
import type { PatientPortalStatusSnapshot } from "../portal/types/patientPortalStatus";
import { PlaywrightBatchQaWorker } from "../workers/playwrightBatchQaWorker";

function emptyReferralFileArea(): PatientPortalStatusSnapshot["referralFileArea"] {
  return {
    available: false,
    labels: [],
  };
}

function createBaseSnapshot(input: {
  batchId: string;
  workItem: PatientEpisodeWorkItem;
  now: string;
  staleAfter: string | null;
}): PatientPortalStatusSnapshot {
  return {
    schemaVersion: "patient-portal-status-snapshot.v1",
    batchId: input.batchId,
    patientId: input.workItem.id,
    patientName: input.workItem.patientIdentity.displayName,
    status: "failed",
    capturedAt: null,
    generatedAt: input.now,
    staleAfter: input.staleAfter,
    matchResult: null,
    chartUrl: null,
    dashboardUrl: null,
    portalAdmissionStatus: null,
    oasisAssessments: [],
    currentOasisAssessmentId: null,
    referralFileArea: emptyReferralFileArea(),
    documentTableSignals: [],
    activePatientRunStatus: null,
    error: null,
  };
}

export async function capturePatientPortalStatusSnapshot(input: {
  batchId: string;
  workItem: PatientEpisodeWorkItem;
  outputDir: string;
  patientArtifactsDirectory: string;
  env: FinaleBatchEnv;
  logger: Logger;
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  staleAfter?: string | null;
}): Promise<{ snapshot: PatientPortalStatusSnapshot; stepLogs: AutomationStepLog[] }> {
  const now = new Date().toISOString();
  const worker = new PlaywrightBatchQaWorker(
    resolvePortalRuntimeConfig({
      env: input.env,
      providedRuntimeConfig: input.subsidiaryRuntimeConfig,
      fallbackSubsidiaryId: input.workItem.subsidiaryId,
    }),
    input.env,
    input.logger,
  );
  const evidenceDir = path.join(input.patientArtifactsDirectory, "patient-portal-status-preflight", "evidence");
  const patientRunId = `${input.batchId}-${input.workItem.id}-portal-status-preflight`;
  const baseSnapshot = createBaseSnapshot({
    batchId: input.batchId,
    workItem: input.workItem,
    now,
    staleAfter: input.staleAfter ?? null,
  });

  try {
    await worker.initialize(input.outputDir);
    const access = await worker.resolvePatientPortalAccess({
      batchId: input.batchId,
      patientRunId,
      workItem: input.workItem,
      evidenceDir,
    });
    if (access.matchResult.status !== "EXACT" || !access.chartUrl) {
      return {
        snapshot: {
          ...baseSnapshot,
          matchResult: access.matchResult,
          dashboardUrl: access.dashboardUrl,
          portalAdmissionStatus: access.portalAdmissionStatus,
          error: `Patient portal status preflight could not resolve an exact portal patient match. status=${access.matchResult.status}`,
        },
        stepLogs: access.stepLogs,
      };
    }
    if (!worker.readPatientPortalStatus) {
      throw new Error("Portal worker does not support patient status preflight.");
    }

    const metadata = await worker.readPatientPortalStatus(input.workItem, evidenceDir);
    const capturedAt = new Date().toISOString();
    return {
      snapshot: {
        ...baseSnapshot,
        status: "fresh",
        capturedAt,
        generatedAt: capturedAt,
        matchResult: access.matchResult,
        chartUrl: access.chartUrl,
        dashboardUrl: access.dashboardUrl,
        portalAdmissionStatus: access.portalAdmissionStatus,
        oasisAssessments: metadata.oasisAssessments,
        currentOasisAssessmentId: metadata.currentOasisAssessmentId,
        referralFileArea: metadata.referralFileArea,
        documentTableSignals: metadata.documentTableSignals,
        error: null,
      },
      stepLogs: [...access.stepLogs, ...metadata.stepLogs],
    };
  } catch (error) {
    return {
      snapshot: {
        ...baseSnapshot,
        error: error instanceof Error ? error.message : "Unknown patient portal status preflight error.",
      },
      stepLogs: [],
    };
  } finally {
    await worker.dispose().catch(() => undefined);
  }
}
