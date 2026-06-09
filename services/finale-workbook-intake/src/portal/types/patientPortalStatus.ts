import type { AutomationStepLog, PatientMatchResult } from "@medical-ai-qa/shared-types";

export type PatientPortalStatusSnapshotStatus =
  | "missing"
  | "fresh"
  | "stale"
  | "refreshing"
  | "pending_due_to_active_patient_run"
  | "failed";

export interface PatientPortalStatusOasisAssessment {
  id: string;
  assessmentType: "SOC" | "ROC" | "RECERT" | "DC" | "UNKNOWN";
  title: string;
  date: string | null;
  sourceRowText?: string | null;
  detectedStatuses: string[];
  primaryStatus: string | null;
  decision: string | null;
  processingEligible: boolean | null;
}

export interface PatientPortalStatusReferralArea {
  available: boolean;
  labels: string[];
}

export interface PatientPortalStatusPageMetadata {
  oasisAssessments: PatientPortalStatusOasisAssessment[];
  currentOasisAssessmentId: string | null;
  referralFileArea: PatientPortalStatusReferralArea;
  documentTableSignals: string[];
  stepLogs: AutomationStepLog[];
}

export interface PatientPortalStatusSnapshot {
  schemaVersion: "patient-portal-status-snapshot.v1";
  batchId: string;
  patientId: string;
  patientName: string;
  status: PatientPortalStatusSnapshotStatus;
  capturedAt: string | null;
  generatedAt: string;
  staleAfter: string | null;
  matchResult: PatientMatchResult | null;
  chartUrl: string | null;
  dashboardUrl: string | null;
  portalAdmissionStatus: string | null;
  oasisAssessments: PatientPortalStatusOasisAssessment[];
  currentOasisAssessmentId: string | null;
  referralFileArea: PatientPortalStatusReferralArea;
  documentTableSignals: string[];
  activePatientRunStatus: string | null;
  error: string | null;
}
