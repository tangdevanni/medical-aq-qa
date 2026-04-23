import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationStepLog, PatientEpisodeWorkItem, PatientRun } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { openAssessmentNote } from "../oasis/navigation/oasisAssessmentNoteService";
import { selectOasisAssessmentType } from "../oasis/navigation/oasisAssessmentSelectionService";
import { selectEpisodeForReview } from "../oasis/navigation/episodeSelectionService";
import { openOasisMenu } from "../oasis/navigation/oasisMenuNavigationService";
import { capturePrintedOasisNoteReview } from "../oasis/print/oasisPrintedNoteReviewService";
import type { OasisQaEntryResult } from "../oasis/types/oasisQaResult";
import type { PatientPortalContext } from "../portal/context/patientPortalContext";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import { buildWorkflowRun, upsertWorkflowRun } from "./patientWorkflowRunState";
import type { SharedEvidenceBundle } from "./sharedEvidenceWorkflow";

export interface QaWorkflowOrchestratorParams {
  context: PatientPortalContext;
  run: PatientRun;
  workItem: PatientEpisodeWorkItem;
  evidenceDir: string;
  outputDir: string;
  logger: Logger;
  portalClient: BatchPortalAutomationClient;
  sharedEvidence: SharedEvidenceBundle;
}

export interface QaWorkflowOrchestratorResult {
  stepLogs: AutomationStepLog[];
  workflowResultPath: string;
  result: OasisQaEntryResult;
}

export async function runQaWorkflowOrchestrator(
  params: QaWorkflowOrchestratorParams,
): Promise<QaWorkflowOrchestratorResult> {
  const startedAt = new Date().toISOString();
  params.run.workflowRuns = upsertWorkflowRun(
    params.run.workflowRuns,
    buildWorkflowRun({
      patientRunId: params.run.runId,
      workflowDomain: "qa",
      status: "IN_PROGRESS",
      stepName: "OASIS_QA_ENTRY",
      message: "QA workflow is entering the downstream read-only OASIS review path after shared evidence discovery.",
      chartUrl: params.context.chartUrl,
      timestamp: startedAt,
      startedAt: params.context.resolvedAt,
    }),
  );

  const stepLogs: AutomationStepLog[] = [];
  const episodeSelection = await selectEpisodeForReview({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    logger: params.logger,
    portalClient: params.portalClient,
  });
  stepLogs.push(...episodeSelection.stepLogs);

  const billingCalendar = await params.portalClient.extractBillingPeriodCalendarSummaryForReview({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    selectedEpisode: episodeSelection.result.selectedRange
      ? {
          rawLabel: episodeSelection.result.selectedRange.rawLabel,
          startDate: episodeSelection.result.selectedRange.startDate,
          endDate: episodeSelection.result.selectedRange.endDate,
        }
      : null,
  });
  stepLogs.push(...billingCalendar.stepLogs);

  const oasisMenu = await openOasisMenu({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    logger: params.logger,
    portalClient: params.portalClient,
  });
  stepLogs.push(...oasisMenu.stepLogs);

  const assessmentSelection = selectOasisAssessmentType({
    context: params.context,
    workItem: params.workItem,
    menuResult: oasisMenu.result,
  });
  stepLogs.push(...assessmentSelection.stepLogs);

  const assessmentNote = await openAssessmentNote({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    selection: assessmentSelection.result,
    logger: params.logger,
    portalClient: params.portalClient,
  });
  stepLogs.push(...assessmentNote.stepLogs);

  const shouldCapturePrintedNote =
    assessmentNote.result.oasisAssessmentStatus?.decision !== "SKIP";
  const printedNoteReview = shouldCapturePrintedNote
    ? await capturePrintedOasisNoteReview({
        context: params.context,
        workItem: params.workItem,
        evidenceDir: params.evidenceDir,
        outputDir: params.outputDir,
        logger: params.logger,
        portalClient: params.portalClient,
        sharedEvidence: params.sharedEvidence,
        assessmentNote: assessmentNote.result,
        assessmentType: assessmentSelection.result.selectedAssessmentType,
      })
    : {
        result: null,
        reviewPath: null,
        stepLogs: [] as AutomationStepLog[],
      };
  stepLogs.push(...printedNoteReview.stepLogs);

  const timestamp = new Date().toISOString();
  const warnings = [
    ...params.sharedEvidence.warnings,
    ...episodeSelection.result.warnings,
    ...billingCalendar.result.warnings,
    ...oasisMenu.result.warnings,
    ...assessmentSelection.result.warnings,
    ...assessmentNote.result.warnings,
    ...(shouldCapturePrintedNote
      ? []
      : [assessmentNote.result.oasisAssessmentStatus?.reason ?? "Skipped printed OASIS note capture due to OASIS page status."]),
    ...(printedNoteReview.result?.warnings ?? []),
  ];
  const result: OasisQaEntryResult = {
    workflowDomain: "qa",
    workflowRunId: `${params.context.patientRunId}:qa`,
    patientRunId: params.context.patientRunId,
    patientName: params.context.patientName,
    patientId: params.context.patientId ?? null,
    chartUrl: params.context.chartUrl,
    dashboardUrl: params.context.dashboardUrl ?? null,
    resolvedAt: params.context.resolvedAt,
    status: warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
    routeDiscovery: {
      currentUrl: oasisMenu.result.currentUrl,
      sidebarLabels: ["OASIS"],
      topVisibleText: assessmentNote.result.diagnosisListSamples,
      routeCandidates: [
        {
          label: "OASIS",
          classification: "patient_chart",
          source: "sidebar_label",
          confidence: oasisMenu.result.opened ? "high" : "low",
          matchedValue: "OASIS",
        },
      ],
      selectedRoute: oasisMenu.result.opened
        ? {
            label: "OASIS",
            classification: "patient_chart",
            source: "sidebar_label",
            confidence: "high",
            matchedValue: "OASIS",
          }
        : null,
      warnings: oasisMenu.result.warnings,
    },
    oasisRoute: {
      found: oasisMenu.result.opened,
      signals: oasisMenu.result.opened
        ? [{ source: "sidebar_label", value: "OASIS" }]
        : [],
      warnings: oasisMenu.result.warnings,
    },
    diagnosisRoute: {
      found: assessmentNote.result.diagnosisSectionOpened || assessmentNote.result.diagnosisListFound,
      signals: assessmentNote.result.diagnosisSectionOpened
        ? [{ source: "page_text", value: "Active Diagnoses" }]
        : [],
      visibleDiagnoses: assessmentNote.result.visibleDiagnoses,
      warnings: assessmentNote.result.warnings,
    },
    lockStatus: {
      status: assessmentNote.result.lockStatus,
      signals: assessmentNote.result.lockStatus === "unknown"
        ? []
        : [{ source: "page_text", value: assessmentNote.result.lockStatus }],
    },
    oasisAssessmentStatus: assessmentNote.result.oasisAssessmentStatus
      ? {
          detectedStatuses: assessmentNote.result.oasisAssessmentStatus.detectedStatuses,
          primaryStatus: assessmentNote.result.oasisAssessmentStatus.primaryStatus,
          decision: assessmentNote.result.oasisAssessmentStatus.decision,
          processingEligible: assessmentNote.result.oasisAssessmentStatus.processingEligible,
          reason: assessmentNote.result.oasisAssessmentStatus.reason,
          signals: assessmentNote.result.oasisAssessmentStatus.matchedSignals.map((value) => ({
            source: "page_text" as const,
            value,
          })),
        }
      : undefined,
    selectedRouteSummary: oasisMenu.result.opened
      ? `oasis review entry via ${oasisMenu.result.selectorUsed ?? "sidebar"}`
      : "OASIS menu not opened",
    warningCount: warnings.length,
    topWarning: warnings[0] ?? null,
    warnings,
    createdAt: timestamp,
    entryStage: "OASIS_ENTRY",
    sharedEvidenceSummary: {
      discoveredDocumentCount: params.sharedEvidence.discoveredDocuments.length,
      extractedArtifactPaths: params.sharedEvidence.extractedArtifactPaths,
      diagnosisCodeCount: params.sharedEvidence.diagnosisCodingContext.icd10Codes.length,
      warnings: params.sharedEvidence.warnings,
    },
    episodeSelection: episodeSelection.result,
    billingCalendarSummary: billingCalendar.result,
    billingCalendarSummaryPath: billingCalendar.summaryPath,
    oasisMenu: oasisMenu.result,
    assessmentSelection: assessmentSelection.result,
    assessmentNote: assessmentNote.result,
    printedNoteReview: printedNoteReview.result,
    printedNoteReviewPath: printedNoteReview.reviewPath,
  };

  const workflowResultPath = path.join(
    params.outputDir,
    "patients",
    params.run.workItemId,
    "qa-prefetch-result.json",
  );
  await mkdir(path.dirname(workflowResultPath), { recursive: true });
  await writeFile(workflowResultPath, JSON.stringify(result, null, 2), "utf8");

  params.run.workflowRuns = upsertWorkflowRun(
    params.run.workflowRuns,
    buildWorkflowRun({
      patientRunId: params.run.runId,
      workflowDomain: "qa",
      status: "COMPLETED",
      stepName: "OASIS_QA_ENTRY_COMPLETE",
      message: result.topWarning
        ? `OASIS QA entry completed with warnings: ${result.topWarning}`
        : "OASIS QA entry completed successfully.",
      chartUrl: params.context.chartUrl,
      timestamp,
      startedAt: params.context.resolvedAt,
      completedAt: timestamp,
      workflowResultPath,
    }),
  );

  params.logger.info(
    {
      workflowDomain: "qa",
      patientRunId: params.context.patientRunId,
      workflowRunId: result.workflowRunId,
      patientName: params.context.patientName,
      stepName: "qa_prefetch_result_persisted",
      status: result.status.toLowerCase(),
      chartUrl: params.context.chartUrl,
      currentUrl: result.assessmentNote.currentUrl,
      routeClassification: result.routeDiscovery.selectedRoute?.classification ?? "unknown",
      warningCount: result.warningCount,
      selectedEpisodeRange: result.billingCalendarSummary?.selectedEpisode.rawLabel ?? null,
      first30TotalCards: result.billingCalendarSummary?.periods.first30Days.totalCards ?? 0,
      second30TotalCards: result.billingCalendarSummary?.periods.second30Days.totalCards ?? 0,
      requestedAssessmentType: result.assessmentSelection.requestedAssessmentType,
      selectedAssessmentType: result.assessmentSelection.selectedAssessmentType,
      oasisAssessmentPrimaryStatus:
        result.oasisAssessmentStatus?.primaryStatus ?? "UNKNOWN",
      oasisAssessmentDecision:
        result.oasisAssessmentStatus?.decision ?? "PROCESS",
    },
    "qa workflow completed downstream OASIS entry review",
  );

  return {
    stepLogs,
    workflowResultPath,
    result,
  };
}
