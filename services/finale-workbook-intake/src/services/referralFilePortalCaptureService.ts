import path from "node:path";
import type {
  AutomationStepLog,
  PatientEpisodeWorkItem,
  SubsidiaryRuntimeConfig,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { FinaleBatchEnv } from "../config/env";
import { resolvePortalRuntimeConfig } from "../config/portalRuntime";
import type { ReferralFileCaptureResult } from "../portal/services/chartDocumentCaptureService";
import { PlaywrightBatchQaWorker } from "../workers/playwrightBatchQaWorker";

export async function capturePatientReferralFiles(input: {
  batchId: string;
  workItem: PatientEpisodeWorkItem;
  outputDir: string;
  patientArtifactsDirectory: string;
  env: FinaleBatchEnv;
  logger: Logger;
  subsidiaryRuntimeConfig?: SubsidiaryRuntimeConfig;
  captureRelevantUploadLimit?: number;
}): Promise<ReferralFileCaptureResult & { stepLogs: AutomationStepLog[] }> {
  const worker = new PlaywrightBatchQaWorker(
    resolvePortalRuntimeConfig({
      env: input.env,
      providedRuntimeConfig: input.subsidiaryRuntimeConfig,
      fallbackSubsidiaryId: input.workItem.subsidiaryId,
    }),
    input.env,
    input.logger,
  );
  const evidenceDir = path.join(input.patientArtifactsDirectory, "referral-file-acquisition", "evidence");
  const patientRunId = `${input.batchId}-${input.workItem.id}-referral-intake`;
  try {
    await worker.initialize(input.outputDir);
    const access = await worker.resolvePatientPortalAccess({
      batchId: input.batchId,
      patientRunId,
      workItem: input.workItem,
      evidenceDir,
    });
    if (access.matchResult.status !== "EXACT" || !access.chartUrl) {
      throw new Error(
        `Referral intake could not resolve an exact portal patient match. status=${access.matchResult.status}`,
      );
    }
    if (!worker.captureReferralFiles) {
      throw new Error("Portal worker does not support referral file capture.");
    }
    const capture = await worker.captureReferralFiles(input.workItem, evidenceDir, {
      patientArtifactsDirectory: input.patientArtifactsDirectory,
      captureRelevantUploadLimit: input.captureRelevantUploadLimit,
      batchId: input.batchId,
    });
    return {
      ...capture,
      stepLogs: access.stepLogs,
    };
  } finally {
    await worker.dispose().catch(() => undefined);
  }
}
