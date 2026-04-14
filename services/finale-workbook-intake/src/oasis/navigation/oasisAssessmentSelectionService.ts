import type { AutomationStepLog, PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import type { OasisAssessmentSelectionResult, OasisMenuOpenResult } from "../types/oasisQaResult";

export interface OasisAssessmentSelectionParams {
  context: PatientPortalContext;
  workItem: PatientEpisodeWorkItem;
  menuResult: OasisMenuOpenResult;
}

export interface OasisAssessmentSelectionServiceResult {
  result: OasisAssessmentSelectionResult;
  stepLogs: AutomationStepLog[];
}

export function selectOasisAssessmentType(
  params: OasisAssessmentSelectionParams,
): OasisAssessmentSelectionServiceResult {
  const requestedAssessmentType = normalizeRequestedAssessmentType(params.workItem);
  const availableNormalized = params.menuResult.availableAssessmentTypes.map((value) => value.toUpperCase());
  let selectedAssessmentType = requestedAssessmentType;
  let selectionReason: OasisAssessmentSelectionResult["selectionReason"] = "fallback_requested";
  const warnings: string[] = [];

  if (availableNormalized.includes("SOC")) {
    selectedAssessmentType = "SOC";
    selectionReason = availableNormalized.includes(requestedAssessmentType) && requestedAssessmentType === "SOC"
      ? "requested_exact"
      : "preferred_soc";
    if (requestedAssessmentType !== "SOC") {
      warnings.push(
        `Requested OASIS assessment type ${requestedAssessmentType} was overridden to SOC because SOC is the current preferred read-only review path.`,
      );
    }
  } else if (availableNormalized.includes(requestedAssessmentType)) {
    selectedAssessmentType = requestedAssessmentType;
    selectionReason = "requested_exact";
  } else if (requestedAssessmentType === "RECERT" && availableNormalized.includes("REC")) {
    selectedAssessmentType = "REC";
    selectionReason = "requested_alias";
  } else if (params.menuResult.availableAssessmentTypes.length > 0) {
    warnings.push(
      `Requested OASIS assessment type ${requestedAssessmentType} was not explicitly listed; continuing with inferred target ${selectedAssessmentType}.`,
    );
  }

  const result: OasisAssessmentSelectionResult = {
    requestedAssessmentType,
    selectedAssessmentType,
    selectionReason,
    availableAssessmentTypes: params.menuResult.availableAssessmentTypes,
    warnings,
  };

  return {
    result,
    stepLogs: [
      createAutomationStepLog({
        step: "oasis_type_selected",
        message: `Selected ${selectedAssessmentType} as the target OASIS assessment type for read-only review.`,
        patientName: params.context.patientName,
        urlBefore: params.context.chartUrl,
        urlAfter: params.menuResult.currentUrl,
        found: [
          `workflowDomain=qa`,
          `requestedAssessmentType=${requestedAssessmentType}`,
          `selectedAssessmentType=${selectedAssessmentType}`,
          `selectionReason=${selectionReason}`,
        ],
        missing: params.menuResult.opened ? [] : ["OASIS menu"],
        evidence: [
          `availableAssessmentTypes=${params.menuResult.availableAssessmentTypes.join(" | ") || "none"}`,
          ...warnings,
        ],
        safeReadConfirmed: true,
      }),
    ],
  };
}

function normalizeRequestedAssessmentType(workItem: PatientEpisodeWorkItem): string {
  const workflowTypes = workItem.workflowTypes.map((value) => value.toUpperCase());
  if (workflowTypes.includes("RECERT")) {
    return "RECERT";
  }
  if (workflowTypes.includes("ROC")) {
    return "ROC";
  }
  if (workflowTypes.includes("SOC")) {
    return "SOC";
  }
  const rfa = workItem.episodeContext.rfa?.toUpperCase() ?? "";
  if (rfa.includes("REC")) {
    return "RECERT";
  }
  if (rfa.includes("ROC")) {
    return "ROC";
  }
  return "SOC";
}
