import type { AutomationStepLog, PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import type { BatchPortalAutomationClient } from "../../workers/playwrightBatchQaWorker";
import type { OasisEpisodeSelectionResult } from "../types/oasisQaResult";
import { parseEpisodeRangeLabel, type EpisodeRangeSelectionTarget } from "./episodeRangeDropdownService";

export interface EpisodeSelectionServiceParams {
  context: PatientPortalContext;
  workItem: PatientEpisodeWorkItem;
  evidenceDir: string;
  logger: Logger;
  portalClient: BatchPortalAutomationClient;
}

export interface EpisodeSelectionServiceResult {
  result: OasisEpisodeSelectionResult;
  stepLogs: AutomationStepLog[];
}

export async function selectEpisodeForReview(
  params: EpisodeSelectionServiceParams,
): Promise<EpisodeSelectionServiceResult> {
  const targetEpisodeLabel =
    params.workItem.episodeContext.billingPeriod ??
    params.workItem.episodeContext.episodePeriod ??
    params.workItem.episodeContext.socDate ??
    params.workItem.episodeContext.episodeDate ??
    null;

  const parsedTarget = targetEpisodeLabel ? parseEpisodeRangeLabel(targetEpisodeLabel) : null;
  const target: EpisodeRangeSelectionTarget | null = targetEpisodeLabel
    ? {
        rawLabel: targetEpisodeLabel,
        startDate: parsedTarget?.startDate ?? null,
        endDate: parsedTarget?.endDate ?? null,
        required: false,
      }
    : null;

  const selection = await params.portalClient.selectEpisodeRangeForReview({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    target,
  });

  const warnings = [
    ...(targetEpisodeLabel
      ? []
      : ["No workbook episode period or billing period was available to drive Episode of selection."]),
    ...selection.result.warnings,
  ];

  const status: OasisEpisodeSelectionResult["status"] = selection.result.selectedOption
    ? selection.result.changedSelection
      ? "SELECTED"
      : "ASSUMED_CURRENT_EPISODE"
    : "UNRESOLVED";

  const result: OasisEpisodeSelectionResult = {
    status,
    targetEpisodeLabel,
    billingPeriod: params.workItem.episodeContext.billingPeriod ?? null,
    episodePeriod: params.workItem.episodeContext.episodePeriod ?? null,
    rfa: params.workItem.episodeContext.rfa ?? null,
    selectedRange: selection.result.selectedOption,
    availableRanges: selection.result.availableOptions,
    changedSelection: selection.result.changedSelection,
    selectionMethod: selection.result.selectionMethod,
    warnings,
  };

  params.logger.info(
    {
      workflowDomain: "qa",
      patientRunId: params.context.patientRunId,
      stepName: "oasis_episode_resolution",
      status: status.toLowerCase(),
      chartUrl: params.context.chartUrl,
      targetEpisodeLabel,
      billingPeriod: result.billingPeriod,
      episodePeriod: result.episodePeriod,
      rfa: result.rfa,
      selectionMethod: result.selectionMethod,
      changedSelection: result.changedSelection,
      selectedRange: result.selectedRange,
    },
    "resolved target episode for OASIS review",
  );

  return {
    result,
    stepLogs: [
      ...selection.stepLogs,
      createAutomationStepLog({
        step: "oasis_episode_resolution",
        message: targetEpisodeLabel
          ? "Resolved the target episode for OASIS review using workbook context plus the Episode of dropdown."
          : "No workbook target was available, so OASIS review is using the current Episode of dropdown selection when present.",
        patientName: params.context.patientName,
        urlBefore: params.context.chartUrl,
        urlAfter: params.context.chartUrl,
        found: [
          `workflowDomain=qa`,
          `patientRunId=${params.context.patientRunId}`,
          `episodeSelectionStatus=${status}`,
          `targetEpisodeLabel=${targetEpisodeLabel ?? "none"}`,
          `rfa=${result.rfa ?? "none"}`,
          `selectionMethod=${result.selectionMethod}`,
          `changedSelection=${result.changedSelection}`,
          `selectedRange=${result.selectedRange?.rawLabel ?? "none"}`,
        ],
        missing: result.selectedRange ? [] : ["Episode of review target"],
        evidence: [
          `billingPeriod=${result.billingPeriod ?? "none"}`,
          `episodePeriod=${result.episodePeriod ?? "none"}`,
          `availableRanges=${result.availableRanges.map((option) => option.rawLabel).join(" | ") || "none"}`,
          ...warnings,
        ],
        safeReadConfirmed: true,
      }),
    ],
  };
}
