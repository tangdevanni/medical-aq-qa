import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { FinaleBatchEnv } from "../config/env";
import type { PatientPortalContext } from "../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import { runReferralDocumentProcessingPipeline } from "../referralProcessing/pipeline";
import type { ReferralDocumentProcessingResult } from "../referralProcessing/types";
import {
  extractDiagnosisCodingContext,
  type DiagnosisCodingExtractionResult,
} from "../services/diagnosisCodingExtractionService";
import {
  buildDocumentFactPack,
  writeDocumentFactPackFile,
} from "../services/documentFactPackBuilder";
import { writeDocumentInventoryFile } from "../services/documentInventoryExportService";
import { writeDocumentTextFile } from "../services/documentTextExportService";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import {
  extractDocumentsFromArtifacts,
  type ExtractedDocument,
} from "./codingWorkflowSupport";

export interface SharedEvidenceWorkflowParams {
  context: PatientPortalContext;
  workItem: PatientEpisodeWorkItem;
  evidenceDir: string;
  outputDir: string;
  env: FinaleBatchEnv;
  logger: Logger;
  portalClient: BatchPortalAutomationClient;
}

export interface SharedEvidenceBundle {
  patientName: string;
  chartUrl: string;
  artifacts: ArtifactRecord[];
  documentInventory: DocumentInventoryItem[];
  discoveredDocuments: Array<{
    type: string;
    label: string;
    path?: string | null;
  }>;
  extractedDocuments: ExtractedDocument[];
  extractedArtifactPaths: string[];
  diagnosisCodingContext: DiagnosisCodingExtractionResult;
  diagnosisSourceEvidence?: {
    primaryDiagnosisText?: string | null;
    otherDiagnosisText?: string[];
    supportingReferences?: string[];
  };
  documentInventoryExportPath: string | null;
  documentInventoryExportError: string | null;
  documentTextExportPath: string | null;
  documentTextExportError: string | null;
  documentFactPackPath?: string | null;
  documentFactPackError?: string | null;
  referralDocumentProcessing: ReferralDocumentProcessingResult | null;
  referralDocumentSummaryPath: string | null;
  warnings: string[];
}

export interface SharedEvidenceWorkflowResult {
  sharedEvidence: SharedEvidenceBundle;
  stepLogs: AutomationStepLog[];
}

export async function runSharedEvidenceWorkflow(
  params: SharedEvidenceWorkflowParams,
): Promise<SharedEvidenceWorkflowResult> {
  const stepLogs: AutomationStepLog[] = [
    createWorkflowStepLog({
      context: params.context,
      stepName: "shared_evidence_discovery_start",
      status: "started",
      message: "Shared evidence workflow started from the patient chart context.",
    }),
  ];

  params.logger.info(
    buildWorkflowLogPayload(params.context, "shared_evidence_discovery_start", "started"),
    "shared evidence workflow started",
  );

  const discoveryResult = await params.portalClient.discoverArtifacts(params.workItem, params.evidenceDir, {
    workflowPhase: "file_uploads_only",
  });
  stepLogs.push(...discoveryResult.stepLogs);

  let documentInventoryExportPath: string | null = null;
  let documentInventoryExportError: string | null = null;
  try {
    const documentInventoryExport = await writeDocumentInventoryFile({
      outputDirectory: params.outputDir,
      patientId: params.workItem.id,
      batchId: params.context.batchId,
      documentInventory: discoveryResult.documentInventory,
    });
    documentInventoryExportPath = documentInventoryExport.filePath;
  } catch (error) {
    documentInventoryExportError = error instanceof Error ? error.message : String(error);
  }

  const extractedDocuments = await extractDocumentsFromArtifacts(discoveryResult.artifacts);

  let documentTextExportPath: string | null = null;
  let documentTextExportError: string | null = null;
  try {
    const documentTextExport = await writeDocumentTextFile({
      outputDirectory: params.outputDir,
      patientId: params.workItem.id,
      batchId: params.context.batchId,
      extractedDocuments,
    });
    documentTextExportPath = documentTextExport.filePath;
    stepLogs.push(createAutomationStepLog({
      step: "document_text_export",
      message: "Wrote normalized extracted document text for read-only dashboard reference and troubleshooting.",
      patientName: params.context.patientName,
      found: [
        `documentTextPath:${documentTextExport.filePath}`,
        `documentCount:${documentTextExport.document.documentCount}`,
        `orderDocumentCount:${documentTextExport.document.orderDocumentCount}`,
        `hasAdmissionOrderText:${documentTextExport.document.hasAdmissionOrderText}`,
      ],
      missing: documentTextExport.document.hasAdmissionOrderText ? [] : ["Admission Order text"],
      evidence: documentTextExport.document.documents.flatMap((document) => [
        `[${document.documentIndex}] type=${document.type} source=${document.source} effectiveTextSource=${document.effectiveTextSource} textLength=${document.textLength}`,
        `[${document.documentIndex}] rawExtractedTextSource=${document.rawExtractedTextSource ?? "none"} textSelectionReason=${document.textSelectionReason ?? "none"}`,
        `[${document.documentIndex}] domExtractionRejectedReasons=${document.domExtractionRejectedReasons.join(" | ") || "none"}`,
        `[${document.documentIndex}] preview=${document.textPreview || "none"}`,
      ]),
      safeReadConfirmed: true,
    }));
  } catch (error) {
    documentTextExportError = error instanceof Error ? error.message : String(error);
    stepLogs.push(createAutomationStepLog({
      step: "document_text_export",
      message: "Document text export failed; continuing with in-memory extracted document text.",
      patientName: params.context.patientName,
      found: [],
      missing: ["document-text.json"],
      evidence: [documentTextExportError],
      safeReadConfirmed: true,
    }));
  }

  let documentFactPackPath: string | null = null;
  let documentFactPackError: string | null = null;
  try {
    const factPack = buildDocumentFactPack(extractedDocuments);
    const documentFactPackExport = await writeDocumentFactPackFile({
      outputDirectory: params.outputDir,
      patientId: params.workItem.id,
      batchId: params.context.batchId,
      factPack,
    });
    documentFactPackPath = documentFactPackExport.filePath;
    stepLogs.push(createAutomationStepLog({
      step: "document_fact_pack_export",
      message: "Wrote compact document fact pack to reduce downstream token usage while preserving chart evidence.",
      patientName: params.context.patientName,
      found: [
        `documentFactPackPath:${documentFactPackExport.filePath}`,
        `diagnosisCount:${documentFactPackExport.document.factPack.diagnoses.length}`,
        `medicationCount:${documentFactPackExport.document.factPack.medications.length}`,
        `allergyCount:${documentFactPackExport.document.factPack.allergies.length}`,
        `rawCharacters:${documentFactPackExport.document.factPack.stats.rawCharacters}`,
        `packedCharacters:${documentFactPackExport.document.factPack.stats.packedCharacters}`,
        `reductionPercent:${documentFactPackExport.document.factPack.stats.reductionPercent}`,
      ],
      missing: [],
      evidence: [
        ...documentFactPackExport.document.factPack.diagnoses
          .slice(0, 6)
          .map((diagnosis) => `diagnosis:${diagnosis.code ?? "no-code"}:${diagnosis.description}`),
        ...documentFactPackExport.document.factPack.homeboundEvidence
          .slice(0, 3)
          .map((snippet) => `homebound:${snippet.text}`),
        ...documentFactPackExport.document.factPack.skilledNeedEvidence
          .slice(0, 3)
          .map((snippet) => `skilled_need:${snippet.text}`),
      ],
      safeReadConfirmed: true,
    }));
  } catch (error) {
    documentFactPackError = error instanceof Error ? error.message : String(error);
    stepLogs.push(createAutomationStepLog({
      step: "document_fact_pack_export",
      message: "Document fact pack export failed; continuing with raw extracted document text.",
      patientName: params.context.patientName,
      found: [],
      missing: ["document-fact-pack.json"],
      evidence: [documentFactPackError],
      safeReadConfirmed: true,
    }));
  }

  const diagnosisCodingContext = await extractDiagnosisCodingContext({
    extractedDocuments,
    env: params.env,
  });
  stepLogs.push(createAutomationStepLog({
    step: "diagnosis_code_extract",
    message:
      diagnosisCodingContext.icd10Codes.length > 0
        ? `Extracted ${diagnosisCodingContext.icd10Codes.length} diagnosis code candidate(s) from admission/referral/OASIS text.`
        : "No ICD-10 code candidates were extracted from admission/referral/OASIS text.",
    patientName: params.context.patientName,
    found: [
      `icd10CodeCount:${diagnosisCodingContext.icd10Codes.length}`,
      `diagnosisMentionCount:${diagnosisCodingContext.diagnosisMentions.length}`,
      `diagnosisCodePairCount:${diagnosisCodingContext.canonical.diagnosis_code_pairs.length}`,
      `extractionConfidence:${diagnosisCodingContext.canonical.extraction_confidence}`,
      `llmUsed:${diagnosisCodingContext.llmUsed}`,
    ],
    missing: diagnosisCodingContext.icd10Codes.length > 0 ? [] : ["ICD-10 code candidates"],
      evidence: diagnosisCodingContext.evidence,
      safeReadConfirmed: true,
  }));

  let referralDocumentProcessing: ReferralDocumentProcessingResult | null = null;
  let referralDocumentSummaryPath: string | null = null;
  const orderDocuments = extractedDocuments.filter((document) => document.type === "ORDER");
  if (orderDocuments.length > 0) {
    const referralProcessingResult = await runReferralDocumentProcessingPipeline({
      workItem: params.workItem,
      outputDir: params.outputDir,
      env: params.env,
      logger: params.logger,
      extractedDocuments: orderDocuments,
    });
    referralDocumentProcessing = referralProcessingResult.result;
    referralDocumentSummaryPath = referralProcessingResult.result?.artifacts.qaDocumentSummaryPath ?? null;
    stepLogs.push(...referralProcessingResult.stepLogs);
  }

  stepLogs.push(createWorkflowStepLog({
    context: params.context,
    stepName: "shared_evidence_discovery_complete",
    status: "completed",
    message: "Shared evidence workflow completed and produced reusable extracted chart evidence.",
    extraFound: [
      `artifactCount=${discoveryResult.artifacts.length}`,
      `documentInventoryCount=${discoveryResult.documentInventory.length}`,
      `extractedDocumentCount=${extractedDocuments.length}`,
      `diagnosisCodeCount=${diagnosisCodingContext.icd10Codes.length}`,
    ],
  }));

  params.logger.info(
    {
      ...buildWorkflowLogPayload(params.context, "shared_evidence_discovery_complete", "completed"),
      artifactCount: discoveryResult.artifacts.length,
      documentInventoryCount: discoveryResult.documentInventory.length,
      extractedDocumentCount: extractedDocuments.length,
      diagnosisCodeCount: diagnosisCodingContext.icd10Codes.length,
    },
    "shared evidence workflow completed",
  );

  return {
    sharedEvidence: {
      patientName: params.context.patientName,
      chartUrl: params.context.chartUrl,
      artifacts: discoveryResult.artifacts,
      documentInventory: discoveryResult.documentInventory,
      discoveredDocuments: discoveryResult.documentInventory.map((item) => ({
        type: item.normalizedType,
        label: item.sourceLabel,
        path: item.sourcePath ?? null,
      })),
      extractedDocuments,
      extractedArtifactPaths: extractedDocuments
        .map((document) => document.metadata.sourcePath ?? null)
        .filter((value): value is string => Boolean(value)),
      diagnosisCodingContext,
      diagnosisSourceEvidence: {
        primaryDiagnosisText: diagnosisCodingContext.canonical.reason_for_admission,
        otherDiagnosisText: diagnosisCodingContext.diagnosisMentions,
        supportingReferences: diagnosisCodingContext.evidence.slice(0, 20),
      },
      documentInventoryExportPath,
      documentInventoryExportError,
      documentTextExportPath,
      documentTextExportError,
      documentFactPackPath,
      documentFactPackError,
      referralDocumentProcessing,
      referralDocumentSummaryPath,
      warnings: [
        ...(documentInventoryExportError ? [documentInventoryExportError] : []),
        ...(documentTextExportError ? [documentTextExportError] : []),
        ...(documentFactPackError ? [documentFactPackError] : []),
        ...(diagnosisCodingContext.llmError ? [diagnosisCodingContext.llmError] : []),
        ...(referralDocumentProcessing?.qaDocumentSummary.warnings ?? []),
      ],
    },
    stepLogs,
  };
}

function createWorkflowStepLog(input: {
  context: PatientPortalContext;
  stepName: string;
  status: string;
  message: string;
  extraFound?: string[];
}): AutomationStepLog {
  return createAutomationStepLog({
    step: input.stepName,
    message: input.message,
    patientName: input.context.patientName,
    urlBefore: input.context.chartUrl,
    urlAfter: input.context.chartUrl,
    found: [
      `workflowDomain=${input.context.workflowDomain}`,
      `patientRunId=${input.context.patientRunId}`,
      `status=${input.status}`,
      `chartUrl=${input.context.chartUrl}`,
      ...(input.extraFound ?? []),
    ],
    safeReadConfirmed: true,
  });
}

function buildWorkflowLogPayload(
  context: PatientPortalContext,
  stepName: string,
  status: string,
) {
  return {
    workflowDomain: context.workflowDomain,
    patientRunId: context.patientRunId,
    patientName: context.patientName,
    stepName,
    status,
    chartUrl: context.chartUrl,
  };
}
