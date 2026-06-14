import path from "node:path";
import type {
  PatientDashboardArtifactPaths,
  PatientWorkflowRun,
} from "@medical-ai-qa/shared-types";
import { getDocumentCatalogPath } from "../services/documentCatalogService";
import {
  ARTIFACT_LINEAGE_FILE_NAME,
  CLINICAL_COMPARISON_ROWS_FILE_NAME,
  CLINICAL_CONTRADICTION_ANALYSIS_FILE_NAME,
  CLINICAL_FACT_PACK_MANIFEST_FILE_NAME,
  CODING_INPUT_FILE_NAME,
  DIAGNOSIS_RECONCILIATION_FILE_NAME,
  DOCUMENT_FACT_PACK_FILE_NAME,
  DOCUMENT_TEXT_FILE_NAME,
  FIELD_MAP_SNAPSHOT_FILE_NAME,
  GENERATED_PLAN_OF_CARE_FILE_NAME,
  LLM_USAGE_AUDIT_FILE_NAME,
  OASIS_CLINICAL_FACT_PACK_FILE_NAME,
  OASIS_DIAGNOSIS_COMPARE_FILE_NAME,
  OASIS_DIAGNOSIS_EXTRACTION_FILE_NAME,
  OASIS_DIAGNOSIS_SNAPSHOT_FILE_NAME,
  OASIS_EXTRACTION_COVERAGE_REPORT_FILE_NAME,
  OASIS_GATE_RESULT_FILE_NAME,
  OASIS_PRINTED_NOTE_REVIEW_FILE_NAME,
  OASIS_VALIDATION_RESULT_FILE_NAME,
  PATIENT_COST_SUMMARY_FILE_NAME,
  PATIENT_DASHBOARD_STATE_FILE_NAME,
  PATIENT_QA_REFERENCE_FILE_NAME,
  PLAN_OF_CARE_CANDIDATES_FILE_NAME,
  PLAN_OF_CARE_DIAGNOSIS_SOURCE_FILE_NAME,
  PLAN_OF_CARE_REVIEW_DRAFT_FILE_NAME,
  PLAN_OF_CARE_REVIEW_SUMMARY_FILE_NAME,
  PRINTED_NOTE_CHART_VALUES_FILE_NAME,
  QA_DOCUMENT_SUMMARY_FILE_NAME,
  QA_PREFETCH_RESULT_FILE_NAME,
  REFERRAL_DIAGNOSIS_EXTRACTION_FILE_NAME,
  REFERRAL_DOCUMENT_PROCESSING_DIRECTORY_NAME,
  REFERRAL_EXTRACTED_FACTS_FILE_NAME,
  REFERRAL_OASIS_CONSISTENCY_FILE_NAME,
  SOURCE_CLINICAL_FACT_PACK_FILE_NAME,
  VISIT_NOTE_FACT_PACK_FILE_NAME,
  VISIT_NOTE_PROCESSING_MANIFEST_FILE_NAME,
  VISIT_NOTE_QA_REVIEW_FILE_NAME,
  VISIT_NOTES_DISCOVERY_FILE_NAME,
} from "./artifactNames";

function resolveWorkflowArtifactPath(input: {
  workflowRuns: PatientWorkflowRun[];
  workflowDomain: "coding" | "qa";
  fallbackPath: string;
}): string | null {
  const workflowRun = input.workflowRuns.find(
    (candidate) => candidate.workflowDomain === input.workflowDomain,
  );
  const candidates = Array.from(
    new Set(
      [workflowRun?.workflowResultPath ?? null, input.fallbackPath].filter(
        (candidate): candidate is string => Boolean(candidate),
      ),
    ),
  );

  return candidates[0] ?? null;
}

export function getPatientArtifactsDirectory(input: {
  outputDirectory: string;
  patientId: string;
}): string {
  return path.join(input.outputDirectory, "patients", input.patientId);
}

export function getReferralDocumentProcessingDirectory(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, REFERRAL_DOCUMENT_PROCESSING_DIRECTORY_NAME);
}

export function getPatientArtifactPath(
  patientArtifactsDirectory: string,
  fileName: string,
): string {
  return path.join(patientArtifactsDirectory, fileName);
}

export function getReferralDocumentProcessingArtifactPath(
  patientArtifactsDirectory: string,
  fileName: string,
): string {
  return path.join(getReferralDocumentProcessingDirectory(patientArtifactsDirectory), fileName);
}

export function buildPatientDashboardArtifactPaths(input: {
  outputDirectory: string;
  patientId: string;
  workflowRuns: PatientWorkflowRun[];
}): PatientDashboardArtifactPaths {
  const patientArtifactsDirectory = getPatientArtifactsDirectory({
    outputDirectory: input.outputDirectory,
    patientId: input.patientId,
  });

  return {
    codingInput:
      resolveWorkflowArtifactPath({
        workflowRuns: input.workflowRuns,
        workflowDomain: "coding",
        fallbackPath: getPatientArtifactPath(patientArtifactsDirectory, CODING_INPUT_FILE_NAME),
      }) ?? getPatientArtifactPath(patientArtifactsDirectory, CODING_INPUT_FILE_NAME),
    documentText: getPatientArtifactPath(patientArtifactsDirectory, DOCUMENT_TEXT_FILE_NAME),
    documentFactPack: getPatientArtifactPath(patientArtifactsDirectory, DOCUMENT_FACT_PACK_FILE_NAME),
    documentCatalog: getDocumentCatalogPath(patientArtifactsDirectory),
    qaPrefetch: resolveWorkflowArtifactPath({
      workflowRuns: input.workflowRuns,
      workflowDomain: "qa",
      fallbackPath: getPatientArtifactPath(patientArtifactsDirectory, QA_PREFETCH_RESULT_FILE_NAME),
    }),
    patientQaReference: getReferralDocumentProcessingArtifactPath(patientArtifactsDirectory, PATIENT_QA_REFERENCE_FILE_NAME),
    qaDocumentSummary: getReferralDocumentProcessingArtifactPath(patientArtifactsDirectory, QA_DOCUMENT_SUMMARY_FILE_NAME),
    fieldMapSnapshot: getReferralDocumentProcessingArtifactPath(patientArtifactsDirectory, FIELD_MAP_SNAPSHOT_FILE_NAME),
    printedNoteChartValues: getPatientArtifactPath(patientArtifactsDirectory, PRINTED_NOTE_CHART_VALUES_FILE_NAME),
    printedNoteReview: getPatientArtifactPath(patientArtifactsDirectory, OASIS_PRINTED_NOTE_REVIEW_FILE_NAME),
    oasisDiagnosisExtraction: getPatientArtifactPath(patientArtifactsDirectory, OASIS_DIAGNOSIS_EXTRACTION_FILE_NAME),
    referralDiagnosisExtraction: getPatientArtifactPath(patientArtifactsDirectory, REFERRAL_DIAGNOSIS_EXTRACTION_FILE_NAME),
    diagnosisReconciliation: getPatientArtifactPath(patientArtifactsDirectory, DIAGNOSIS_RECONCILIATION_FILE_NAME),
    clinicalComparisonRows: getPatientArtifactPath(patientArtifactsDirectory, CLINICAL_COMPARISON_ROWS_FILE_NAME),
    artifactLineage: getPatientArtifactPath(patientArtifactsDirectory, ARTIFACT_LINEAGE_FILE_NAME),
    sourceClinicalFactPack: getPatientArtifactPath(patientArtifactsDirectory, SOURCE_CLINICAL_FACT_PACK_FILE_NAME),
    oasisClinicalFactPack: getPatientArtifactPath(patientArtifactsDirectory, OASIS_CLINICAL_FACT_PACK_FILE_NAME),
    clinicalFactPackManifest: getPatientArtifactPath(patientArtifactsDirectory, CLINICAL_FACT_PACK_MANIFEST_FILE_NAME),
    oasisExtractionCoverageReport: getPatientArtifactPath(patientArtifactsDirectory, OASIS_EXTRACTION_COVERAGE_REPORT_FILE_NAME),
    clinicalContradictionAnalysis: getPatientArtifactPath(patientArtifactsDirectory, CLINICAL_CONTRADICTION_ANALYSIS_FILE_NAME),
    planOfCareDiagnosisSource: getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_DIAGNOSIS_SOURCE_FILE_NAME),
    planOfCareCandidates: getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_CANDIDATES_FILE_NAME),
    planOfCareReviewDraft: getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_REVIEW_DRAFT_FILE_NAME),
    planOfCareReviewSummary: getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_REVIEW_SUMMARY_FILE_NAME),
    visitNotesDiscovery: getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTES_DISCOVERY_FILE_NAME),
    visitNoteProcessingManifest: getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTE_PROCESSING_MANIFEST_FILE_NAME),
    visitNoteFactPack: getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTE_FACT_PACK_FILE_NAME),
    visitNoteQaReview: getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTE_QA_REVIEW_FILE_NAME),
    llmUsageAudit: getPatientArtifactPath(patientArtifactsDirectory, LLM_USAGE_AUDIT_FILE_NAME),
    oasisValidation: getPatientArtifactPath(patientArtifactsDirectory, OASIS_VALIDATION_RESULT_FILE_NAME),
    referralOasisConsistency: getPatientArtifactPath(patientArtifactsDirectory, REFERRAL_OASIS_CONSISTENCY_FILE_NAME),
    oasisGate: getPatientArtifactPath(patientArtifactsDirectory, OASIS_GATE_RESULT_FILE_NAME),
    generatedPlanOfCare: getPatientArtifactPath(patientArtifactsDirectory, GENERATED_PLAN_OF_CARE_FILE_NAME),
    patientCostSummary: getPatientArtifactPath(patientArtifactsDirectory, PATIENT_COST_SUMMARY_FILE_NAME),
  };
}

export function getPatientDashboardStatePath(patientArtifactsDirectory: string): string {
  return getPatientArtifactPath(patientArtifactsDirectory, PATIENT_DASHBOARD_STATE_FILE_NAME);
}

export function getReferralExtractedFactsPath(patientArtifactsDirectory: string): string {
  return getReferralDocumentProcessingArtifactPath(patientArtifactsDirectory, REFERRAL_EXTRACTED_FACTS_FILE_NAME);
}

export function getOasisDiagnosisSnapshotPath(patientArtifactsDirectory: string): string {
  return getPatientArtifactPath(patientArtifactsDirectory, OASIS_DIAGNOSIS_SNAPSHOT_FILE_NAME);
}

export function getOasisDiagnosisComparePath(patientArtifactsDirectory: string): string {
  return getPatientArtifactPath(patientArtifactsDirectory, OASIS_DIAGNOSIS_COMPARE_FILE_NAME);
}
