import type { Logger } from "pino";
import type { AutomationStepLog, PatientEpisodeWorkItem, WorkflowDomain } from "@medical-ai-qa/shared-types";
import type { BatchPortalAutomationClient } from "../../workers/playwrightBatchQaWorker";
import { createAutomationStepLog } from "../utils/automationLog";
import type {
  PatientPortalContext,
  ResolvedPatientPortalAccess,
} from "../context/patientPortalContext";

export interface ExecuteSharedPortalAccessWorkflowParams {
  batchId: string;
  patientRunId: string;
  workflowDomains: WorkflowDomain[];
  workItem: PatientEpisodeWorkItem;
  evidenceDir?: string;
  portalClient: BatchPortalAutomationClient;
  logger: Logger;
}

export interface SharedPortalAccessWorkflowResult {
  matchResult: ResolvedPatientPortalAccess["matchResult"];
  portalAdmissionStatus: string | null;
  portalContexts: PatientPortalContext[];
  stepLogs: AutomationStepLog[];
}

export async function executeSharedPortalAccessWorkflow(
  params: ExecuteSharedPortalAccessWorkflowParams,
): Promise<SharedPortalAccessWorkflowResult> {
  params.logger.info(
    {
      patientRunId: params.patientRunId,
      patientName: params.workItem.patientIdentity.displayName,
      workflowDomains: params.workflowDomains,
      stepName: "shared_portal_access_start",
      status: "started",
    },
    "starting shared portal access workflow",
  );

  const access = await params.portalClient.resolvePatientPortalAccess({
    batchId: params.batchId,
    patientRunId: params.patientRunId,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
  });
  const portalContexts = buildPortalContexts({
    access,
    batchId: params.batchId,
    patientRunId: params.patientRunId,
    workflowDomains: params.workflowDomains,
  });
  const stepLogs = [
    ...access.stepLogs,
    createAutomationStepLog({
      step: "shared_portal_access",
      message:
        portalContexts.length > 0
          ? `Shared portal access reached the patient chart and produced ${portalContexts.length} workflow context(s).`
          : `Shared portal access completed without a patient chart context because match status was ${access.matchResult.status}.`,
      patientName: params.workItem.patientIdentity.displayName,
      urlBefore: access.dashboardUrl,
      urlAfter: access.chartUrl ?? access.dashboardUrl,
      found: portalContexts.map((context) => `${context.workflowDomain}:${context.chartUrl}`),
      missing: portalContexts.length > 0 ? [] : ["patient chart context"],
      evidence: [
        `matchStatus=${access.matchResult.status}`,
        `portalPatientId=${access.patientId ?? "none"}`,
        `portalAdmissionStatus=${access.portalAdmissionStatus ?? "none"}`,
        `dashboardUrl=${access.dashboardUrl ?? "none"}`,
        `chartUrl=${access.chartUrl ?? "none"}`,
      ],
      safeReadConfirmed: true,
    }),
  ];

  params.logger.info(
    {
      patientRunId: params.patientRunId,
      patientName: params.workItem.patientIdentity.displayName,
      workflowDomains: params.workflowDomains,
      stepName: "shared_portal_access_complete",
      status: portalContexts.length > 0 ? "completed" : "blocked",
      chartUrl: access.chartUrl,
    },
    "completed shared portal access workflow",
  );

  return {
    matchResult: access.matchResult,
    portalAdmissionStatus: access.portalAdmissionStatus,
    portalContexts,
    stepLogs,
  };
}

function buildPortalContexts(input: {
  access: ResolvedPatientPortalAccess;
  batchId: string;
  patientRunId: string;
  workflowDomains: WorkflowDomain[];
}): PatientPortalContext[] {
  if (!input.access.chartUrl || !input.access.resolvedAt) {
    return [];
  }

  return input.workflowDomains.map((workflowDomain) => ({
    batchId: input.batchId,
    patientRunId: input.patientRunId,
    workflowDomain,
    patientName: input.access.patientName,
    patientId: input.access.patientId,
    chartUrl: input.access.chartUrl!,
    dashboardUrl: input.access.dashboardUrl,
    resolvedAt: input.access.resolvedAt!,
    traceId: input.access.traceId,
  }));
}
