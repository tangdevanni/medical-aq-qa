import type { AutomationStepLog, PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import type { BatchPortalAutomationClient } from "../../workers/playwrightBatchQaWorker";
import type {
  OasisAssessmentNoteOpenResult,
  OasisAssessmentSelectionResult,
} from "../types/oasisQaResult";

export interface OasisAssessmentNoteParams {
  context: PatientPortalContext;
  workItem: PatientEpisodeWorkItem;
  evidenceDir: string;
  selection: OasisAssessmentSelectionResult;
  logger: Logger;
  portalClient: BatchPortalAutomationClient;
}

export interface OasisAssessmentNoteServiceResult {
  result: OasisAssessmentNoteOpenResult;
  stepLogs: AutomationStepLog[];
}

export async function openAssessmentNote(
  params: OasisAssessmentNoteParams,
): Promise<OasisAssessmentNoteServiceResult> {
  const result = await params.portalClient.openOasisAssessmentNoteForReview({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    assessmentType: params.selection.selectedAssessmentType,
  });
  const warnings = [...result.result.warnings];
  const matchedAssessmentLabel = result.result.matchedAssessmentLabel?.toUpperCase() ?? "";
  const matchedRequestedAssessment =
    result.result.assessmentOpened &&
    (matchedAssessmentLabel.includes(params.selection.selectedAssessmentType.toUpperCase()) ||
      (params.selection.selectedAssessmentType === "REC" && /RECERT/i.test(matchedAssessmentLabel)));
  if (result.result.assessmentOpened && !matchedRequestedAssessment) {
    warnings.push(
      `Opened assessment label '${result.result.matchedAssessmentLabel ?? "unknown"}' did not match requested assessment type ${params.selection.selectedAssessmentType}.`,
    );
  }
  const normalizedResult: OasisAssessmentNoteOpenResult = {
    ...result.result,
    matchedRequestedAssessment,
    warnings,
  };

  params.logger.info(
    {
      workflowDomain: "qa",
      patientRunId: params.context.patientRunId,
      stepName: "oasis_assessment_note_opened",
      status: normalizedResult.assessmentOpened && normalizedResult.matchedRequestedAssessment ? "completed" : normalizedResult.assessmentOpened ? "warning" : "blocked",
      chartUrl: params.context.chartUrl,
      currentUrl: normalizedResult.currentUrl,
      assessmentType: params.selection.selectedAssessmentType,
      selectionReason: params.selection.selectionReason,
      matchedAssessmentLabel: normalizedResult.matchedAssessmentLabel,
      matchedRequestedAssessment: normalizedResult.matchedRequestedAssessment,
      diagnosisSectionOpened: normalizedResult.diagnosisSectionOpened,
      diagnosisListFound: normalizedResult.diagnosisListFound,
      lockStatus: normalizedResult.lockStatus,
      oasisAssessmentPrimaryStatus: normalizedResult.oasisAssessmentStatus?.primaryStatus ?? "UNKNOWN",
      oasisAssessmentDecision: normalizedResult.oasisAssessmentStatus?.decision ?? "PROCESS",
      warnings: normalizedResult.warnings,
    },
    "opened OASIS assessment note for read-only review",
  );

  return {
    result: normalizedResult,
    stepLogs: result.stepLogs,
  };
}
