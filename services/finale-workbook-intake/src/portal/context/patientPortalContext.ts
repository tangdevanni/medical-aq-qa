import type { AutomationStepLog, PatientMatchResult, WorkflowDomain } from "@medical-ai-qa/shared-types";

export type { WorkflowDomain } from "@medical-ai-qa/shared-types";

export interface PatientPortalContext {
  batchId: string;
  patientRunId: string;
  workflowDomain: WorkflowDomain;
  patientName: string;
  patientId?: string | null;
  chartUrl: string;
  dashboardUrl?: string | null;
  resolvedAt: string;
  traceId?: string;
}

export interface ResolvedPatientPortalAccess {
  patientName: string;
  patientId: string | null;
  chartUrl: string | null;
  dashboardUrl: string | null;
  resolvedAt: string | null;
  portalAdmissionStatus: string | null;
  traceId?: string;
  matchResult: PatientMatchResult;
  stepLogs: AutomationStepLog[];
}
