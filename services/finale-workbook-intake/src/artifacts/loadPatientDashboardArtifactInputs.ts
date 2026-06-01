import type { PatientDashboardArtifactPaths, ClinicalComparisonRow } from "@medical-ai-qa/shared-types";
import {
  fileExists,
  readJsonArtifact,
  readJsonArtifactIfExists,
} from "./jsonArtifactIO";
import {
  ARTIFACT_LINEAGE_FILE_NAME,
  CLINICAL_COMPARISON_ROWS_FILE_NAME,
  CLINICAL_CONTRADICTION_ANALYSIS_FILE_NAME,
  CLINICAL_FACT_PACK_MANIFEST_FILE_NAME,
  DIAGNOSIS_RECONCILIATION_FILE_NAME,
  OASIS_CLINICAL_FACT_PACK_FILE_NAME,
  OASIS_DIAGNOSIS_EXTRACTION_FILE_NAME,
  OASIS_EXTRACTION_COVERAGE_REPORT_FILE_NAME,
  PLAN_OF_CARE_CANDIDATES_FILE_NAME,
  PLAN_OF_CARE_DIAGNOSIS_SOURCE_FILE_NAME,
  PLAN_OF_CARE_REVIEW_DRAFT_FILE_NAME,
  PLAN_OF_CARE_REVIEW_SUMMARY_FILE_NAME,
  REFERRAL_DIAGNOSIS_EXTRACTION_FILE_NAME,
  SOURCE_CLINICAL_FACT_PACK_FILE_NAME,
  VISIT_NOTE_FACT_PACK_FILE_NAME,
  VISIT_NOTE_PROCESSING_MANIFEST_FILE_NAME,
  VISIT_NOTE_QA_REVIEW_FILE_NAME,
  VISIT_NOTES_DISCOVERY_FILE_NAME,
} from "./artifactNames";
import {
  getOasisDiagnosisComparePath,
  getOasisDiagnosisSnapshotPath,
  getPatientArtifactPath,
  getReferralExtractedFactsPath,
} from "./patientArtifactPaths";
import {
  getComparisonInputManifestPath,
  getDocumentExtractionCachePath,
  readComparisonInputManifest,
  readDocumentExtractionCacheManifest,
  type ComparisonInputManifest,
  type DocumentExtractionCacheManifest,
} from "../services/documentExtractionCacheService";
import {
  getDocumentCatalogPath,
  readDocumentCatalogFileIfExists,
  type DocumentCatalogFile,
} from "../services/documentCatalogService";

export type PatientDashboardResolvedArtifactPaths = {
  clinicalComparisonRowsPath: string;
  artifactLineagePath: string;
  documentExtractionCachePath: string;
  documentCatalogPath: string;
  comparisonInputManifestPath: string;
  sourceClinicalFactPackPath: string;
  oasisClinicalFactPackPath: string;
  oasisDiagnosisExtractionPath: string;
  referralDiagnosisExtractionPath: string;
  diagnosisReconciliationPath: string;
  clinicalFactPackManifestPath: string;
  oasisExtractionCoverageReportPath: string;
  clinicalContradictionAnalysisPath: string;
  planOfCareDiagnosisSourcePath: string;
  planOfCareCandidatesPath: string;
  planOfCareReviewDraftPath: string;
  planOfCareReviewSummaryPath: string;
  visitNotesDiscoveryPath: string;
  visitNoteProcessingManifestPath: string;
  visitNoteFactPackPath: string;
  visitNoteQaReviewPath: string;
  referralExtractedFactsPath: string;
  oasisDiagnosisSnapshotPath: string;
  oasisDiagnosisComparePath: string;
};

export type PatientDashboardArtifactInputs = PatientDashboardResolvedArtifactPaths & {
  codingInput: unknown | null;
  documentText: unknown | null;
  documentFactPack: unknown | null;
  referralExtractedFacts: unknown | null;
  qaPrefetch: unknown | null;
  patientQaReference: unknown | null;
  qaDocumentSummary: unknown | null;
  rawFieldMapSnapshot: unknown | null;
  printedNoteChartValues: unknown | null;
  printedNoteReview: unknown | null;
  visitNotesDiscovery: unknown | null;
  previousVisitNoteProcessingManifest: unknown | null;
  previousVisitNoteQaReview: unknown | null;
  oasisDiagnosisSnapshot: unknown | null;
  oasisDiagnosisCompare: unknown | null;
  patientQaReferenceExists: boolean;
  fieldMapSnapshotExists: boolean;
  printedNoteChartValuesExists: boolean;
  printedNoteReviewExists: boolean;
  documentExtractionCacheManifest: DocumentExtractionCacheManifest | null;
  documentCatalog: DocumentCatalogFile | null;
  previousComparisonInputManifest: ComparisonInputManifest | null;
  llmUsageAudit: unknown | null;
  oasisValidation: unknown | null;
  referralOasisConsistency: unknown | null;
  oasisGate: unknown | null;
  generatedPlanOfCare: unknown | null;
};

export function resolvePatientDashboardArtifactInputPaths(input: {
  patientArtifactsDirectory: string;
  artifactPaths: PatientDashboardArtifactPaths;
}): PatientDashboardResolvedArtifactPaths {
  const { patientArtifactsDirectory, artifactPaths } = input;

  return {
    clinicalComparisonRowsPath:
      artifactPaths.clinicalComparisonRows ??
      getPatientArtifactPath(patientArtifactsDirectory, CLINICAL_COMPARISON_ROWS_FILE_NAME),
    artifactLineagePath:
      artifactPaths.artifactLineage ??
      getPatientArtifactPath(patientArtifactsDirectory, ARTIFACT_LINEAGE_FILE_NAME),
    documentExtractionCachePath: getDocumentExtractionCachePath(patientArtifactsDirectory),
    documentCatalogPath: getDocumentCatalogPath(patientArtifactsDirectory),
    comparisonInputManifestPath: getComparisonInputManifestPath(patientArtifactsDirectory),
    sourceClinicalFactPackPath:
      artifactPaths.sourceClinicalFactPack ??
      getPatientArtifactPath(patientArtifactsDirectory, SOURCE_CLINICAL_FACT_PACK_FILE_NAME),
    oasisClinicalFactPackPath:
      artifactPaths.oasisClinicalFactPack ??
      getPatientArtifactPath(patientArtifactsDirectory, OASIS_CLINICAL_FACT_PACK_FILE_NAME),
    oasisDiagnosisExtractionPath:
      artifactPaths.oasisDiagnosisExtraction ??
      getPatientArtifactPath(patientArtifactsDirectory, OASIS_DIAGNOSIS_EXTRACTION_FILE_NAME),
    referralDiagnosisExtractionPath:
      artifactPaths.referralDiagnosisExtraction ??
      getPatientArtifactPath(patientArtifactsDirectory, REFERRAL_DIAGNOSIS_EXTRACTION_FILE_NAME),
    diagnosisReconciliationPath:
      artifactPaths.diagnosisReconciliation ??
      getPatientArtifactPath(patientArtifactsDirectory, DIAGNOSIS_RECONCILIATION_FILE_NAME),
    clinicalFactPackManifestPath:
      artifactPaths.clinicalFactPackManifest ??
      getPatientArtifactPath(patientArtifactsDirectory, CLINICAL_FACT_PACK_MANIFEST_FILE_NAME),
    oasisExtractionCoverageReportPath:
      artifactPaths.oasisExtractionCoverageReport ??
      getPatientArtifactPath(patientArtifactsDirectory, OASIS_EXTRACTION_COVERAGE_REPORT_FILE_NAME),
    clinicalContradictionAnalysisPath:
      artifactPaths.clinicalContradictionAnalysis ??
      getPatientArtifactPath(patientArtifactsDirectory, CLINICAL_CONTRADICTION_ANALYSIS_FILE_NAME),
    planOfCareDiagnosisSourcePath:
      artifactPaths.planOfCareDiagnosisSource ??
      getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_DIAGNOSIS_SOURCE_FILE_NAME),
    planOfCareCandidatesPath:
      artifactPaths.planOfCareCandidates ??
      getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_CANDIDATES_FILE_NAME),
    planOfCareReviewDraftPath:
      artifactPaths.planOfCareReviewDraft ??
      getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_REVIEW_DRAFT_FILE_NAME),
    planOfCareReviewSummaryPath:
      artifactPaths.planOfCareReviewSummary ??
      getPatientArtifactPath(patientArtifactsDirectory, PLAN_OF_CARE_REVIEW_SUMMARY_FILE_NAME),
    visitNotesDiscoveryPath:
      artifactPaths.visitNotesDiscovery ??
      getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTES_DISCOVERY_FILE_NAME),
    visitNoteProcessingManifestPath:
      artifactPaths.visitNoteProcessingManifest ??
      getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTE_PROCESSING_MANIFEST_FILE_NAME),
    visitNoteFactPackPath:
      artifactPaths.visitNoteFactPack ??
      getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTE_FACT_PACK_FILE_NAME),
    visitNoteQaReviewPath:
      artifactPaths.visitNoteQaReview ??
      getPatientArtifactPath(patientArtifactsDirectory, VISIT_NOTE_QA_REVIEW_FILE_NAME),
    referralExtractedFactsPath: getReferralExtractedFactsPath(patientArtifactsDirectory),
    oasisDiagnosisSnapshotPath: getOasisDiagnosisSnapshotPath(patientArtifactsDirectory),
    oasisDiagnosisComparePath: getOasisDiagnosisComparePath(patientArtifactsDirectory),
  };
}

export async function readClinicalComparisonRowsIfExists(
  filePath: string,
): Promise<ClinicalComparisonRow[] | null> {
  try {
    const payload = await readJsonArtifact(filePath);
    if (!Array.isArray(payload)) {
      return null;
    }
    return payload as ClinicalComparisonRow[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadPatientDashboardArtifactInputs(input: {
  patientArtifactsDirectory: string;
  artifactPaths: PatientDashboardArtifactPaths;
}): Promise<PatientDashboardArtifactInputs> {
  const resolvedPaths = resolvePatientDashboardArtifactInputPaths(input);
  const { artifactPaths } = input;

  const [
    codingInput,
    documentText,
    documentFactPack,
    referralExtractedFacts,
    qaPrefetch,
    patientQaReference,
    qaDocumentSummary,
    rawFieldMapSnapshot,
    printedNoteChartValues,
    printedNoteReview,
    visitNotesDiscovery,
    previousVisitNoteProcessingManifest,
    previousVisitNoteQaReview,
    oasisDiagnosisSnapshot,
    oasisDiagnosisCompare,
    patientQaReferenceExists,
    fieldMapSnapshotExists,
    printedNoteChartValuesExists,
    printedNoteReviewExists,
    documentExtractionCacheManifest,
    documentCatalog,
    previousComparisonInputManifest,
    llmUsageAudit,
    oasisValidation,
    referralOasisConsistency,
    oasisGate,
    generatedPlanOfCare,
  ] = await Promise.all([
    readJsonArtifactIfExists(artifactPaths.codingInput),
    readJsonArtifactIfExists(artifactPaths.documentText),
    readJsonArtifactIfExists(artifactPaths.documentFactPack),
    readJsonArtifactIfExists(resolvedPaths.referralExtractedFactsPath),
    readJsonArtifactIfExists(artifactPaths.qaPrefetch),
    readJsonArtifactIfExists(artifactPaths.patientQaReference),
    readJsonArtifactIfExists(artifactPaths.qaDocumentSummary),
    readJsonArtifactIfExists(artifactPaths.fieldMapSnapshot),
    readJsonArtifactIfExists(artifactPaths.printedNoteChartValues),
    readJsonArtifactIfExists(artifactPaths.printedNoteReview),
    readJsonArtifactIfExists(resolvedPaths.visitNotesDiscoveryPath),
    readJsonArtifactIfExists(resolvedPaths.visitNoteProcessingManifestPath),
    readJsonArtifactIfExists(resolvedPaths.visitNoteQaReviewPath),
    readJsonArtifactIfExists(resolvedPaths.oasisDiagnosisSnapshotPath),
    readJsonArtifactIfExists(resolvedPaths.oasisDiagnosisComparePath),
    fileExists(artifactPaths.patientQaReference),
    fileExists(artifactPaths.fieldMapSnapshot),
    fileExists(artifactPaths.printedNoteChartValues),
    fileExists(artifactPaths.printedNoteReview),
    readDocumentExtractionCacheManifest(resolvedPaths.documentExtractionCachePath),
    readDocumentCatalogFileIfExists(resolvedPaths.documentCatalogPath),
    readComparisonInputManifest(resolvedPaths.comparisonInputManifestPath),
    readJsonArtifactIfExists(artifactPaths.llmUsageAudit),
    readJsonArtifactIfExists(artifactPaths.oasisValidation),
    readJsonArtifactIfExists(artifactPaths.referralOasisConsistency),
    readJsonArtifactIfExists(artifactPaths.oasisGate),
    readJsonArtifactIfExists(artifactPaths.generatedPlanOfCare),
  ]);

  return {
    ...resolvedPaths,
    codingInput,
    documentText,
    documentFactPack,
    referralExtractedFacts,
    qaPrefetch,
    patientQaReference,
    qaDocumentSummary,
    rawFieldMapSnapshot,
    printedNoteChartValues,
    printedNoteReview,
    visitNotesDiscovery,
    previousVisitNoteProcessingManifest,
    previousVisitNoteQaReview,
    oasisDiagnosisSnapshot,
    oasisDiagnosisCompare,
    patientQaReferenceExists,
    fieldMapSnapshotExists,
    printedNoteChartValuesExists,
    printedNoteReviewExists,
    documentExtractionCacheManifest,
    documentCatalog,
    previousComparisonInputManifest,
    llmUsageAudit,
    oasisValidation,
    referralOasisConsistency,
    oasisGate,
    generatedPlanOfCare,
  };
}
