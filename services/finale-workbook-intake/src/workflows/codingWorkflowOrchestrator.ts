import type {
  AutomationStepLog,
  PatientEpisodeWorkItem,
  PatientRun,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import type { PatientPortalContext } from "../portal/context/patientPortalContext";
import { evaluateDeterministicQa } from "../qa/deterministicQaEngine";
import { buildOasisQaSummary } from "../services/oasisQaEvaluator";
import { writeCodingInputFile } from "../services/codingInputExportService";
import {
  buildExtractionStepLogs,
  countCodingInputDiagnoses,
  formatPrimaryDiagnosisSelected,
  setDocumentInventory,
  summarizeCodeConfidence,
} from "./codingWorkflowSupport";
import { buildWorkflowRun, upsertWorkflowRun } from "./patientWorkflowRunState";
import type { SharedEvidenceBundle } from "./sharedEvidenceWorkflow";

export interface CodingWorkflowOrchestratorParams {
  context: PatientPortalContext;
  run: PatientRun;
  workItem: PatientEpisodeWorkItem;
  sharedEvidence: SharedEvidenceBundle;
  outputDir: string;
  logger: Logger;
  emitRunUpdate: () => Promise<void>;
}

export interface CodingWorkflowOrchestratorResult {
  stepLogs: AutomationStepLog[];
}

export async function runCodingWorkflowOrchestrator(
  params: CodingWorkflowOrchestratorParams,
): Promise<CodingWorkflowOrchestratorResult> {
  const stepLogs: AutomationStepLog[] = [];
  const startedAt = new Date().toISOString();
  const updateCodingWorkflowRun = (input: {
    status: "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "FAILED";
    stepName: string;
    message: string;
    completedAt?: string | null;
  }) => {
    params.run.workflowRuns = upsertWorkflowRun(
      params.run.workflowRuns,
      buildWorkflowRun({
        patientRunId: params.run.runId,
        workflowDomain: "coding",
        status: input.status,
        stepName: input.stepName,
        message: input.message,
        chartUrl: params.context.chartUrl,
        timestamp: new Date().toISOString(),
        startedAt,
        completedAt: input.completedAt ?? null,
      }),
    );
  };

  stepLogs.push(createWorkflowBranchStepLog({
    context: params.context,
    stepName: "coding_workflow_start",
    message: "Coding workflow branch started from the shared patient chart context.",
    status: "started",
  }));
  updateCodingWorkflowRun({
    status: "IN_PROGRESS",
    stepName: "DISCOVERING_CHART",
    message: "Coding workflow branch started.",
  });
  params.logger.info(buildWorkflowLogPayload(params.context, "coding_workflow_start", "started"), "coding workflow branch started");

  try {
    params.run.processingStatus = "DISCOVERING_CHART";
    params.run.executionStep = "DISCOVERING_CHART";
    params.run.progressPercent = 25;
    await params.emitRunUpdate();

    params.run.processingStatus = "COLLECTING_EVIDENCE";
    params.run.executionStep = "COLLECTING_EVIDENCE";
    params.run.progressPercent = 55;
    updateCodingWorkflowRun({
      status: "IN_PROGRESS",
      stepName: "COLLECTING_EVIDENCE",
      message: "Coding workflow is collecting chart evidence.",
    });
    await params.emitRunUpdate();

    params.run.artifacts = params.sharedEvidence.artifacts;
    setDocumentInventory(params.run, params.sharedEvidence.documentInventory);

    if (params.sharedEvidence.documentInventoryExportPath) {
      params.run.notes.push(`Document inventory exported: ${params.sharedEvidence.documentInventoryExportPath}`);
    } else if (params.sharedEvidence.documentInventoryExportError) {
      params.run.notes.push(`Document inventory export failed: ${params.sharedEvidence.documentInventoryExportError}`);
    }

    params.run.processingStatus = "RUNNING_QA";
    params.run.executionStep = "RUNNING_QA";
    params.run.progressPercent = 80;
    updateCodingWorkflowRun({
      status: "IN_PROGRESS",
      stepName: "RUNNING_QA",
      message: "Coding workflow is generating coding outputs from chart artifacts.",
    });
    await params.emitRunUpdate();

    const extractedDocuments = params.sharedEvidence.extractedDocuments;
    const documentTextExportPath = params.sharedEvidence.documentTextExportPath;
    if (documentTextExportPath) {
      params.run.notes.push(`Document text exported: ${documentTextExportPath}`);
    } else if (params.sharedEvidence.documentTextExportError) {
      params.run.notes.push(`Document text export failed: ${params.sharedEvidence.documentTextExportError}`);
    }

    params.run.notes.push(`Extracted ${extractedDocuments.length} document(s) for QA evaluation.`);
    stepLogs.push(...buildExtractionStepLogs({
      run: params.run,
      extractedDocuments,
    }));

    const codingContext = params.sharedEvidence.diagnosisCodingContext;

    let codingInputExport: Awaited<ReturnType<typeof writeCodingInputFile>> | null = null;
    try {
      codingInputExport = await writeCodingInputFile({
        outputDirectory: params.outputDir,
        patientId: params.workItem.id,
        batchId: params.context.batchId,
        canonical: codingContext.canonical,
      });
      stepLogs.push(createAutomationStepLog({
        step: "coding_input_export",
        message: "Wrote read-only diagnosis reference output for dashboard consumption.",
        patientName: params.run.patientName,
        found: [
          `codingInputPath:${codingInputExport.filePath}`,
          `diagnosisCount:${countCodingInputDiagnoses(codingInputExport.document)}`,
          `primaryDiagnosisSelected:${formatPrimaryDiagnosisSelected(codingInputExport.document)}`,
          `otherDiagnosisCount:${codingInputExport.document.otherDiagnoses.length}`,
          `codeConfidenceSummary:${summarizeCodeConfidence(codingInputExport.document)}`,
          `noteCount:${codingInputExport.document.notes.length}`,
          `primaryDiagnosisCode:${codingInputExport.document.primaryDiagnosis.code || "none"}`,
        ],
        missing: [],
        evidence: [
          `primaryDiagnosisDescription:${codingInputExport.document.primaryDiagnosis.description || "none"}`,
          `suggestedOnsetType:${codingInputExport.document.suggestedOnsetType}`,
          `suggestedSeverity:${codingInputExport.document.suggestedSeverity}`,
          `comorbidityFlags:${JSON.stringify(codingInputExport.document.comorbidityFlags)}`,
        ],
        safeReadConfirmed: true,
      }));
      params.run.notes.push(`Coding input exported: ${codingInputExport.filePath}`);
    } catch (error) {
      stepLogs.push(createAutomationStepLog({
        step: "coding_input_export",
        message: "Coding input export failed; continuing without exported coding-input.json.",
        patientName: params.run.patientName,
        found: [],
        missing: ["coding-input.json"],
        evidence: [error instanceof Error ? error.message : String(error)],
        safeReadConfirmed: true,
      }));
      params.run.notes.push(`Coding input export failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (params.run.artifacts.length > 0) {
      const firstArtifact = params.run.artifacts[0]!;
      firstArtifact.extractedFields = {
        ...firstArtifact.extractedFields,
        diagnosisMentionCount: String(codingContext.diagnosisMentions.length),
        diagnosisMentions: codingContext.diagnosisMentions.join(" | "),
        diagnosisCodeCount: String(codingContext.icd10Codes.length),
        diagnosisCodes: codingContext.icd10Codes.join(" | "),
        diagnosisCodeCategories: codingContext.codeCategories.join(" | "),
        diagnosisCanonicalJson: JSON.stringify(codingContext.canonical),
        codingInputPath: codingInputExport?.filePath ?? null,
        codingInputJson: codingInputExport ? JSON.stringify(codingInputExport.document) : null,
        reasonForAdmission: codingContext.canonical.reason_for_admission,
        diagnosisCodePairs: codingContext.canonical.diagnosis_code_pairs
          .map((pair) => `${pair.diagnosis} => ${pair.code ?? "null"} (${pair.code_source ?? "null"})`)
          .join(" | "),
        primaryDiagnosis: codingInputExport?.document.primaryDiagnosis.description ?? null,
        primaryDiagnosisCode: codingInputExport?.document.primaryDiagnosis.code ?? null,
        otherDiagnoses: codingInputExport?.document.otherDiagnoses
          .map((diagnosis) => `${diagnosis.description}${diagnosis.code ? ` (${diagnosis.code})` : ""}`)
          .join(" | ") ?? "",
        suggestedOnsetType: codingInputExport?.document.suggestedOnsetType ?? null,
        suggestedSeverity: codingInputExport?.document.suggestedSeverity != null
          ? String(codingInputExport.document.suggestedSeverity)
          : null,
        comorbidityFlags: codingInputExport
          ? JSON.stringify(codingInputExport.document.comorbidityFlags)
          : null,
        orderedServices: codingContext.canonical.ordered_services.join(" | "),
        extractionConfidence: codingContext.canonical.extraction_confidence,
        uncertainDiagnosisItems: codingContext.canonical.uncertain_items.join(" | "),
        codingLlmUsed: String(codingContext.llmUsed),
        codingLlmModel: codingContext.llmModel,
        codingLlmError: codingContext.llmError,
        documentTextPath: documentTextExportPath,
      };
    }
    if (codingContext.icd10Codes.length > 0) {
      params.run.notes.push(`Diagnosis code candidates: ${codingContext.icd10Codes.join(", ")}`);
    }

    const qa = evaluateDeterministicQa({
      workItem: params.workItem,
      matchResult: params.run.matchResult,
      artifacts: params.run.artifacts,
      processingStatus: "COMPLETE",
      extractedDocuments,
      documentInventory: params.run.documentInventory,
    });

    params.run.findings = qa.findings;
    params.run.qaOutcome = qa.qaOutcome;
    params.run.processingStatus = processingStatusForOutcome(params.run);
    params.run.executionStep = params.run.processingStatus;
    params.run.progressPercent = 100;
    params.run.oasisQaSummary = buildOasisQaSummary({
      workItem: params.workItem,
      matchResult: params.run.matchResult,
      artifacts: params.run.artifacts,
      processingStatus: params.run.processingStatus,
      extractedDocuments,
      documentInventory: params.run.documentInventory,
    });
    stepLogs.push({
      timestamp: new Date().toISOString(),
      step: "qa_summary",
      message: `QA summary computed with overallStatus=${params.run.oasisQaSummary.overallStatus}.`,
      patientName: params.run.patientName,
      urlBefore: null,
      urlAfter: null,
      selectorUsed: null,
      found: params.run.oasisQaSummary.sections.map((section) => `${section.key}:${section.status}`),
      missing: params.run.oasisQaSummary.blockers,
      openedDocumentLabel: null,
      openedDocumentUrl: null,
      evidence: params.run.oasisQaSummary.blockers,
      retryCount: 0,
      safeReadConfirmed: true,
    });
    params.run.errorSummary =
      params.run.processingStatus === "COMPLETE"
        ? null
        : params.run.notes.at(-1) ??
          params.run.matchResult.note ??
          `Patient run ended with status ${params.run.processingStatus}.`;

    updateCodingWorkflowRun({
      status:
        params.run.processingStatus === "COMPLETE"
          ? "COMPLETED"
          : params.run.processingStatus === "BLOCKED" || params.run.processingStatus === "NEEDS_HUMAN_REVIEW"
            ? "BLOCKED"
            : "FAILED",
      stepName: params.run.executionStep,
      message: params.run.errorSummary ?? "Coding workflow completed successfully.",
      completedAt: new Date().toISOString(),
    });
    stepLogs.push(createWorkflowBranchStepLog({
      context: params.context,
      stepName: "coding_workflow_complete",
      message: "Coding workflow branch completed.",
      status: "completed",
    }));
    params.logger.info(buildWorkflowLogPayload(params.context, "coding_workflow_complete", "completed"), "coding workflow branch completed");

    return {
      stepLogs,
    };
  } catch (error) {
    updateCodingWorkflowRun({
      status: "FAILED",
      stepName: "FAILED",
      message: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    stepLogs.push(createWorkflowBranchStepLog({
      context: params.context,
      stepName: "coding_workflow_failed",
      message: error instanceof Error ? error.message : "Coding workflow branch failed.",
      status: "failed",
    }));
    params.logger.error({
      ...buildWorkflowLogPayload(params.context, "coding_workflow_failed", "failed"),
      error: error instanceof Error ? error.message : String(error),
    }, "coding workflow branch failed");
    throw error;
  }
}

function processingStatusForOutcome(run: PatientRun): PatientRun["processingStatus"] {
  switch (run.qaOutcome) {
    case "READY_FOR_BILLING_PREP":
      return "COMPLETE";
    case "PORTAL_NOT_FOUND":
    case "AMBIGUOUS_PATIENT":
    case "PORTAL_MISMATCH":
    case "MISSING_DOCUMENTS":
      return "BLOCKED";
    case "NEEDS_MANUAL_QA":
      return "NEEDS_HUMAN_REVIEW";
    default:
      return "NEEDS_HUMAN_REVIEW";
  }
}

function createWorkflowBranchStepLog(input: {
  context: PatientPortalContext;
  stepName: string;
  status: string;
  message: string;
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
