import type { AutomationStepLog, PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import type { BatchPortalAutomationClient } from "../../workers/playwrightBatchQaWorker";
import type { OasisMenuOpenResult } from "../types/oasisQaResult";

export interface OasisMenuNavigationParams {
  context: PatientPortalContext;
  workItem: PatientEpisodeWorkItem;
  evidenceDir: string;
  logger: Logger;
  portalClient: BatchPortalAutomationClient;
}

export interface OasisMenuNavigationServiceResult {
  result: OasisMenuOpenResult;
  stepLogs: AutomationStepLog[];
}

export async function openOasisMenu(
  params: OasisMenuNavigationParams,
): Promise<OasisMenuNavigationServiceResult> {
  const result = await params.portalClient.openOasisMenuForReview({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
  });

  params.logger.info(
    {
      workflowDomain: "qa",
      patientRunId: params.context.patientRunId,
      stepName: "oasis_menu_open",
      status: result.result.opened ? "completed" : "blocked",
      chartUrl: params.context.chartUrl,
      currentUrl: result.result.currentUrl,
      selectorUsed: result.result.selectorUsed,
      availableAssessmentTypes: result.result.availableAssessmentTypes,
    },
    "opened OASIS menu for review",
  );

  return result;
}
