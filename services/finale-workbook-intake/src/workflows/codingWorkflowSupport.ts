import type {
  AutomationStepLog,
  DocumentInventoryItem,
  PatientRun,
} from "@medical-ai-qa/shared-types";
import {
  extractDocumentsFromArtifacts,
  getEffectiveTextSource,
  type ExtractedDocument,
} from "../services/documentExtractionService";
import { extractTechnicalReview } from "../services/technicalReviewExtractor";
import {
  type CodingInputDocument,
  type OasisReadyDiagnosisDocument,
} from "../services/codingInputExportService";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import type { CanonicalDiagnosisExtraction } from "../services/diagnosisCodingExtractionService";

export {
  extractDocumentsFromArtifacts,
  type ExtractedDocument,
};

export function setDocumentInventory(
  run: PatientRun,
  inventory: DocumentInventoryItem[],
): void {
  run.documentInventory = inventory;
}

export function buildFallbackCanonicalCodingInput(input: {
  run: PatientRun;
  reason?: string;
}): CanonicalDiagnosisExtraction {
  const failureReason = input.reason ?? input.run.errorSummary ?? input.run.matchResult.note ?? "coding_input_unavailable";
  return {
    reason_for_admission: null,
    diagnosis_phrases: [],
    diagnosis_code_pairs: [],
    icd10_codes_found_verbatim: [],
    ordered_services: [],
    clinical_summary: null,
    source_quotes: [],
    uncertain_items: [failureReason],
    document_type: null,
    extraction_confidence: "low",
  };
}

export function buildExtractionStepLogs(input: {
  run: PatientRun;
  extractedDocuments: ExtractedDocument[];
}): AutomationStepLog[] {
  const { run, extractedDocuments } = input;
  const oasisDocuments = extractedDocuments.filter((document) => document.type === "OASIS");
  const pocDocuments = extractedDocuments.filter((document) => document.type === "POC");
  const visitNoteDocuments = extractedDocuments.filter((document) => document.type === "VISIT_NOTE");
  const orderDocuments = extractedDocuments.filter((document) => document.type === "ORDER");
  const technicalReview = extractTechnicalReview(run.artifacts, extractedDocuments, run.documentInventory);
  const documentEvidence = extractedDocuments.flatMap((document, index) => [
    `[${index}] type=${document.type} source=${document.metadata.source ?? "artifact_fallback"} effectiveTextSource=${getEffectiveTextSource(document)} portalLabel=${document.metadata.portalLabel ?? "none"} textLength=${document.metadata.textLength ?? document.text.length}`,
    `[${index}] rawExtractedTextSource=${document.metadata.rawExtractedTextSource ?? "none"} textSelectionReason=${document.metadata.textSelectionReason ?? "none"}`,
    `[${index}] domExtractionRejectedReasons=${document.metadata.domExtractionRejectedReasons?.join(" | ") || "none"}`,
    `[${index}] preview=${document.metadata.textPreview || document.text.slice(0, 500) || "none"}`,
    ...(document.type === "ORDER"
      ? [
          `[${index}] admissionReasonPrimary=${document.metadata.admissionReasonPrimary ?? "none"}`,
          `[${index}] admissionReasonSnippets=${document.metadata.admissionReasonSnippets?.join(" | ") || "none"}`,
          `[${index}] possibleIcd10Codes=${document.metadata.possibleIcd10Codes?.join(" | ") || "none"}`,
          `[${index}] possibleIcd10CodeCount=${document.metadata.possibleIcd10Codes?.length ?? 0}`,
        ]
      : []),
  ]);

  return [
    createAutomationStepLog({
      step: "document_extraction",
      message: `Extracted ${extractedDocuments.length} document(s) for QA evaluation.`,
      patientName: run.patientName,
      found: extractedDocuments.map((document, index) =>
        `${index}:${document.type}:${getEffectiveTextSource(document)}:${document.metadata.source ?? "artifact_fallback"}:${document.metadata.textLength ?? document.text.length}`),
      missing: extractedDocuments.length > 0 ? [] : ["extracted document text"],
      evidence: documentEvidence,
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "admission_document_extract",
      message: orderDocuments.length > 0
        ? `Extracted ${orderDocuments.length} Admission Order/referral document text block(s).`
        : "No Admission Order/referral text blocks were extracted.",
      patientName: run.patientName,
      found: orderDocuments.map((document) =>
        `${document.metadata.portalLabel ?? "Admission Order"}:${document.metadata.textLength}`),
      missing: orderDocuments.length > 0 ? [] : ["Admission Order/referral text"],
      evidence: orderDocuments.flatMap((document, index) => [
        `[${index}] source=${document.metadata.source ?? "artifact_fallback"}`,
        `[${index}] effectiveTextSource=${getEffectiveTextSource(document)}`,
        `[${index}] rawExtractedTextSource=${document.metadata.rawExtractedTextSource ?? "none"}`,
        `[${index}] textSelectionReason=${document.metadata.textSelectionReason ?? "none"}`,
        `[${index}] domExtractionRejectedReasons=${document.metadata.domExtractionRejectedReasons?.join(" | ") || "none"}`,
        `[${index}] preview=${document.metadata.textPreview || document.text.slice(0, 500) || "none"}`,
        `[${index}] admissionReasonPrimary=${document.metadata.admissionReasonPrimary ?? "none"}`,
        `[${index}] admissionReasonSnippets=${document.metadata.admissionReasonSnippets?.join(" | ") || "none"}`,
        `[${index}] possibleIcd10Codes=${document.metadata.possibleIcd10Codes?.join(" | ") || "none"}`,
      ]),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "oasis_extract",
      message: oasisDocuments.length > 0
        ? `Extracted ${oasisDocuments.length} OASIS document(s).`
        : "No OASIS document content was extracted.",
      patientName: run.patientName,
      found: oasisDocuments.map((document) => document.metadata.portalLabel ?? document.metadata.sourcePath ?? "OASIS"),
      missing: oasisDocuments.length > 0 ? [] : ["OASIS"],
      evidence: oasisDocuments.flatMap((document) => document.metadata.keyPhrases?.slice(0, 4) ?? []),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "poc_extract",
      message: pocDocuments.length > 0
        ? `Extracted ${pocDocuments.length} plan-of-care document(s).`
        : "No plan-of-care content was extracted.",
      patientName: run.patientName,
      found: pocDocuments.map((document) => document.metadata.portalLabel ?? document.metadata.sourcePath ?? "POC"),
      missing: pocDocuments.length > 0 ? [] : ["POC"],
      evidence: pocDocuments.flatMap((document) => document.metadata.keyPhrases?.slice(0, 4) ?? []),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "visit_note_extract",
      message: visitNoteDocuments.length > 0
        ? `Extracted ${visitNoteDocuments.length} visit-note document(s).`
        : "No visit-note content was extracted.",
      patientName: run.patientName,
      found: visitNoteDocuments.map((document) => document.metadata.portalLabel ?? document.metadata.sourcePath ?? "VISIT_NOTE"),
      missing: visitNoteDocuments.length > 0 ? [] : ["VISIT_NOTE"],
      evidence: visitNoteDocuments.flatMap((document) => document.metadata.keyPhrases?.slice(0, 6) ?? []),
      safeReadConfirmed: true,
    }),
    createAutomationStepLog({
      step: "technical_review_extract",
      message: "Aggregated technical-review evidence from document inventory and extracted content.",
      patientName: run.patientName,
      found: [
        `orders:${technicalReview.orderCount}`,
        `summaries:${technicalReview.summaryCount}`,
        `supervisory:${technicalReview.supervisoryCount}`,
        `communication:${technicalReview.communicationCount}`,
        `missed_visits:${technicalReview.missedVisitCount}`,
        `sn_visits:${technicalReview.snVisitCount}`,
      ],
      evidence: [
        ...technicalReview.evidence.orderCount,
        ...technicalReview.evidence.summaryCount,
        ...technicalReview.evidence.supervisoryCount,
        ...technicalReview.evidence.communicationCount,
        ...technicalReview.evidence.missedVisitCount,
        ...technicalReview.evidence.snVisitCount,
      ],
      safeReadConfirmed: true,
    }),
  ];
}

export function countCodingInputDiagnoses(
  document: CodingInputDocument | OasisReadyDiagnosisDocument,
): number {
  return (document.primaryDiagnosis.description ? 1 : 0) + document.otherDiagnoses.length;
}

export function formatPrimaryDiagnosisSelected(
  document: CodingInputDocument | OasisReadyDiagnosisDocument,
): string {
  if (!document.primaryDiagnosis.description) {
    return "none";
  }
  return [
    document.primaryDiagnosis.code,
    document.primaryDiagnosis.description,
  ].filter(Boolean).join(" ");
}

export function summarizeCodeConfidence(
  document: CodingInputDocument | OasisReadyDiagnosisDocument,
): string {
  const counts = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const diagnosis of [document.primaryDiagnosis, ...document.otherDiagnoses]) {
    if (!diagnosis.description) {
      continue;
    }
    counts[diagnosis.confidence] += 1;
  }

  return `high:${counts.high} medium:${counts.medium} low:${counts.low}`;
}
