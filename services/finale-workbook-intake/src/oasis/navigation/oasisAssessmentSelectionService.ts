import type { AutomationStepLog, PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import type { OasisAssessmentSelectionResult, OasisMenuOpenResult } from "../types/oasisQaResult";
import {
  deriveOasisAssessmentTypeFromWorkItem,
  normalizeOasisAssessmentType,
} from "./oasisAssessmentDocumentMatching";

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
  const availableNormalized = params.menuResult.availableAssessmentTypes.map(normalizeOasisAssessmentType);
  let selectedAssessmentType = requestedAssessmentType;
  let selectionReason: OasisAssessmentSelectionResult["selectionReason"] = "fallback_requested";
  const warnings: string[] = [];

  if (availableNormalized.includes(requestedAssessmentType)) {
    selectedAssessmentType = requestedAssessmentType;
    selectionReason = params.menuResult.availableAssessmentTypes
      .map((value) => value.toUpperCase())
      .includes(requestedAssessmentType)
      ? "requested_exact"
      : "requested_alias";
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
  return deriveOasisAssessmentTypeFromWorkItem(workItem);
}
