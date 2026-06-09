import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationStepLog, PatientEpisodeWorkItem, PatientRun } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { openAssessmentNote } from "../oasis/navigation/oasisAssessmentNoteService";
import { selectOasisAssessmentType } from "../oasis/navigation/oasisAssessmentSelectionService";
import { selectEpisodeForReview } from "../oasis/navigation/episodeSelectionService";
import { openOasisMenu } from "../oasis/navigation/oasisMenuNavigationService";
import type { OasisAssessmentSelectionResult, OasisQaEntryResult } from "../oasis/types/oasisQaResult";
import { loadEnv } from "../config/env";
import type { PatientPortalContext } from "../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import { buildWorkflowRun, upsertWorkflowRun } from "./patientWorkflowRunState";
import type { SharedEvidenceBundle } from "./sharedEvidenceWorkflow";
import { processOasisDomSections } from "../services/oasisDomSectionProcessingService";
import type {
  PatientPortalStatusOasisAssessment,
  PatientPortalStatusSnapshot,
} from "../portal/types/patientPortalStatus";

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

async function readPatientPortalStatusSnapshot(
  outputDir: string,
  patientId: string,
): Promise<PatientPortalStatusSnapshot | null> {
  try {
    return JSON.parse(
      await readFile(path.join(outputDir, "patients", patientId, "patient-portal-status-snapshot.json"), "utf8"),
    ) as PatientPortalStatusSnapshot;
  } catch {
    return null;
  }
}

function preflightAssessmentTypes(snapshot: PatientPortalStatusSnapshot | null): string[] {
  return Array.from(new Set(
    (snapshot?.oasisAssessments ?? [])
      .map((assessment) => assessment.assessmentType)
      .filter((assessmentType) => assessmentType !== "UNKNOWN"),
  ));
}

function safeAssessmentArtifactKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "oasis-assessment";
}

const PROCESSABLE_OASIS_ASSESSMENT_TYPES = new Set(["SOC", "ROC", "RECERT", "DC"]);

function isProcessableOasisAssessmentType(value: string): boolean {
  return PROCESSABLE_OASIS_ASSESSMENT_TYPES.has(value);
}

export function getSupplementalOasisAssessmentTargets(input: {
  snapshot: PatientPortalStatusSnapshot | null;
  currentAssessmentId: string | null;
}): PatientPortalStatusOasisAssessment[] {
  return (input.snapshot?.oasisAssessments ?? [])
    .filter((assessment) =>
      isProcessableOasisAssessmentType(assessment.assessmentType) &&
      assessment.id !== input.currentAssessmentId &&
      assessment.processingEligible !== false
    )
    .sort((left, right) => parseAssessmentDate(right.date) - parseAssessmentDate(left.date));
}

export function buildOasisAssessmentSelectionForTarget(input: {
  baseSelection: OasisAssessmentSelectionResult;
  targetAssessment: PatientPortalStatusOasisAssessment | null;
  purpose: "current_monitored" | "supplemental_once";
}): OasisAssessmentSelectionResult {
  const targetType = input.targetAssessment?.assessmentType ?? null;
  if (!targetType || !isProcessableOasisAssessmentType(targetType)) {
    return input.baseSelection;
  }

  return {
    ...input.baseSelection,
    requestedAssessmentType: targetType,
    selectedAssessmentType: targetType,
    selectionReason: "fallback_requested",
    availableAssessmentTypes: Array.from(new Set([
      ...input.baseSelection.availableAssessmentTypes,
      targetType,
    ])),
    warnings: input.purpose === "supplemental_once"
      ? [
          ...input.baseSelection.warnings,
          "Selected from patient portal status preflight for supplemental OASIS view-only processing.",
        ]
      : input.baseSelection.warnings,
  };
}

function parseAssessmentDate(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return Date.UTC(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2]));
  }
  return 0;
}

async function writeOasisAssessmentProcessingManifest(input: {
  patientArtifactsDirectory: string;
  generatedAt: string;
  assessments: Array<Record<string, unknown>>;
}): Promise<string> {
  const manifestPath = path.join(input.patientArtifactsDirectory, "oasis-assessment-processing-manifest.json");
  await mkdir(input.patientArtifactsDirectory, { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "oasis-assessment-processing-manifest.v1",
    generatedAt: input.generatedAt,
    assessments: input.assessments,
  }, null, 2), "utf8");
  return manifestPath;
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
  const portalStatusSnapshot = await readPatientPortalStatusSnapshot(params.outputDir, params.run.workItemId);
  const currentOasisAssessmentId = portalStatusSnapshot?.currentOasisAssessmentId ?? null;
  const currentOasisAssessmentTarget =
    portalStatusSnapshot?.oasisAssessments.find((assessment) => assessment.id === currentOasisAssessmentId) ?? null;
  const snapshotAssessmentTypes = preflightAssessmentTypes(portalStatusSnapshot);
  const oasisMenuForSelection = snapshotAssessmentTypes.length > 0
    ? {
        ...oasisMenu.result,
        availableAssessmentTypes: Array.from(new Set([
          ...oasisMenu.result.availableAssessmentTypes,
          ...snapshotAssessmentTypes,
        ])),
      }
    : oasisMenu.result;
  if (snapshotAssessmentTypes.length > 0) {
    stepLogs.push(createAutomationStepLog({
      step: "patient_portal_status_preflight_reused",
      message: "OASIS assessment selection reused patient portal status preflight metadata.",
      patientName: params.workItem.patientIdentity.displayName,
      urlBefore: params.context.chartUrl,
      urlAfter: oasisMenu.result.currentUrl,
      found: snapshotAssessmentTypes.map((assessmentType) => `assessmentType=${assessmentType}`),
      evidence: [
        `snapshotStatus=${portalStatusSnapshot?.status ?? "missing"}`,
        `currentOasisAssessmentId=${portalStatusSnapshot?.currentOasisAssessmentId ?? "none"}`,
      ],
      safeReadConfirmed: true,
    }));
  }

  const assessmentSelection = selectOasisAssessmentType({
    context: params.context,
    workItem: params.workItem,
    menuResult: oasisMenuForSelection,
  });
  stepLogs.push(...assessmentSelection.stepLogs);
  const currentAssessmentSelection = buildOasisAssessmentSelectionForTarget({
    baseSelection: assessmentSelection.result,
    targetAssessment: currentOasisAssessmentTarget,
    purpose: "current_monitored",
  });

  const assessmentNote = await openAssessmentNote({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    selection: currentAssessmentSelection,
    targetAssessment: currentOasisAssessmentTarget,
    logger: params.logger,
    portalClient: params.portalClient,
  });
  stepLogs.push(...assessmentNote.stepLogs);

  const shouldCapturePrintedNote =
    assessmentNote.result.oasisAssessmentStatus?.decision !== "SKIP";
  const env = loadEnv();
  const shouldAttemptDomExtraction =
    shouldCapturePrintedNote &&
    env.PORTAL_DOM_EXTRACTION_ENABLED &&
    env.OASIS_DOM_EXTRACTION_ENABLED &&
    typeof params.portalClient.extractOasisDomForReview === "function";
  let oasisDomExtraction: Awaited<ReturnType<NonNullable<BatchPortalAutomationClient["extractOasisDomForReview"]>>> | null = null;
  const domStepLogs: AutomationStepLog[] = [];
  const domWarnings: string[] = [];

  if (shouldAttemptDomExtraction) {
    try {
      oasisDomExtraction = await params.portalClient.extractOasisDomForReview?.({
        context: params.context,
        workItem: params.workItem,
        outputDir: params.outputDir,
        thresholds: {
          minFieldCount: env.DOM_EXTRACTION_MIN_FIELD_COUNT,
          minNonEmptyFieldCount: env.DOM_EXTRACTION_MIN_NONEMPTY_FIELD_COUNT,
        },
      }) ?? null;
      domStepLogs.push(...(oasisDomExtraction?.stepLogs ?? []));
      if (oasisDomExtraction?.state.coverage.fallbackRecommended) {
        domWarnings.push(...oasisDomExtraction.state.coverage.fallbackReasons);
      }
    } catch (error) {
      domWarnings.push(`oasis_dom_extraction_failed:${error instanceof Error ? error.message : "unknown_error"}`);
      domStepLogs.push(createAutomationStepLog({
        step: "oasis_dom_extraction",
        message: "OASIS DOM extraction failed; OCR fallback is disabled, so acquisition is marked as insufficient evidence.",
        patientName: params.workItem.patientIdentity.displayName,
        urlBefore: params.context.chartUrl,
        urlAfter: assessmentNote.result.currentUrl,
        missing: ["OASIS DOM extraction artifact"],
        evidence: domWarnings.slice(0, 4),
        safeReadConfirmed: true,
      }));
    }
  }
  stepLogs.push(...domStepLogs);

  const acquisitionStatus = oasisDomExtraction?.acquisitionState.acquisitionStatus ?? null;
  const domAcquisitionReady = acquisitionStatus === "ready_for_qa" ||
    acquisitionStatus === "qa_stale_due_to_oasis_change";
  const domQaAlreadyCompleted = acquisitionStatus === "qa_completed";
  const domAcquisitionPending = acquisitionStatus === "in_progress";
  const domAcquisitionInsufficient =
    shouldCapturePrintedNote &&
    !domAcquisitionReady &&
    !domAcquisitionPending &&
    !domQaAlreadyCompleted;
  if (domAcquisitionPending || domQaAlreadyCompleted) {
    stepLogs.push(createAutomationStepLog({
      step: domQaAlreadyCompleted
        ? "oasis_qa_skipped_dom_acquisition_unchanged"
        : "oasis_qa_deferred_pending_dom_completion",
      message: domQaAlreadyCompleted
        ? "Skipped OASIS QA because the DOM acquisition hash matches the prior QA input."
        : "Deferred OASIS QA because the accumulated DOM acquisition state is not ready for review.",
      patientName: params.workItem.patientIdentity.displayName,
      urlBefore: params.context.chartUrl,
      urlAfter: assessmentNote.result.currentUrl,
      found: [
        `acquisitionStatus=${acquisitionStatus}`,
        `overallContentHash=${oasisDomExtraction?.acquisitionState.overallContentHash ?? "none"}`,
      ],
      missing: oasisDomExtraction?.acquisitionState.missingRequiredSections ?? [],
      evidence: [
        ...(oasisDomExtraction?.acquisitionState.readinessReasons ?? []),
        ...(oasisDomExtraction?.acquisitionState.missingRequiredFields ?? []).slice(0, 8),
      ],
      safeReadConfirmed: true,
    }));
  }
  const printedNoteReview = {
    result: null,
    reviewPath: null,
    stepLogs: domAcquisitionInsufficient
      ? [createAutomationStepLog({
          step: "oasis_dom_acquisition_insufficient",
          message: "OASIS DOM acquisition is not ready; printed-note OCR fallback is disabled.",
          patientName: params.workItem.patientIdentity.displayName,
          urlBefore: params.context.chartUrl,
          urlAfter: assessmentNote.result.currentUrl,
          missing: ["sufficient OASIS DOM acquisition evidence"],
          evidence: [
            ...(oasisDomExtraction?.state.coverage.fallbackReasons ?? ["oasis_dom_extraction_not_available"]),
            "OCR_ENABLED=false",
          ].slice(0, 8),
          safeReadConfirmed: true,
        })]
      : [] as AutomationStepLog[],
  };
  stepLogs.push(...printedNoteReview.stepLogs);

  let oasisDomSectionProcessing: OasisQaEntryResult["oasisDomSectionProcessing"] = undefined;
  if (oasisDomExtraction) {
    const patientArtifactsDirectory = path.join(params.outputDir, "patients", params.run.workItemId);
    try {
      const sectionProcessing = await processOasisDomSections({
        state: oasisDomExtraction.state,
        patientArtifactsDirectory,
        patientId: params.workItem.id,
        patientRunId: params.context.patientRunId,
        env,
        assessmentId: currentOasisAssessmentId,
        assessmentType: currentAssessmentSelection.selectedAssessmentType,
        title: currentOasisAssessmentTarget?.title ?? null,
        date: currentOasisAssessmentTarget?.date ?? null,
        sourceDomStatePath: oasisDomExtraction.domStatePath,
      });
      oasisDomSectionProcessing = {
        manifestPath: sectionProcessing.manifestPath,
        outputsPath: sectionProcessing.outputsPath,
        processedSections: sectionProcessing.outputs.summary.processedSections,
        reusedSections: sectionProcessing.outputs.summary.reusedSections,
        deterministicSections: sectionProcessing.outputs.summary.deterministicSections,
        skippedSections: sectionProcessing.outputs.summary.skippedSections,
        failedSections: sectionProcessing.outputs.summary.failedSections,
      };
      stepLogs.push(createAutomationStepLog({
        step: "oasis_dom_section_processing",
        message: "Processed OASIS DOM sections with per-section hash reuse.",
        patientName: params.workItem.patientIdentity.displayName,
        urlBefore: params.context.chartUrl,
        urlAfter: assessmentNote.result.currentUrl,
        found: [
          `processedSections=${oasisDomSectionProcessing.processedSections}`,
          `reusedSections=${oasisDomSectionProcessing.reusedSections}`,
          `deterministicSections=${oasisDomSectionProcessing.deterministicSections}`,
          `skippedSections=${oasisDomSectionProcessing.skippedSections}`,
          `failedSections=${oasisDomSectionProcessing.failedSections}`,
          `manifestPath=${sectionProcessing.manifestPath}`,
          `outputsPath=${sectionProcessing.outputsPath}`,
          `mggSnapshotPath=${sectionProcessing.mggSnapshotPath}`,
        ],
        evidence: sectionProcessing.outputs.warnings.slice(0, 6),
        safeReadConfirmed: true,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      domWarnings.push(`oasis_dom_section_processing_failed:${message}`);
      stepLogs.push(createAutomationStepLog({
        step: "oasis_dom_section_processing_failed",
        message: "OASIS DOM section processing failed; dashboard will fall back to raw DOM state.",
        patientName: params.workItem.patientIdentity.displayName,
        urlBefore: params.context.chartUrl,
        urlAfter: assessmentNote.result.currentUrl,
        missing: ["oasis-dom-section-outputs.json"],
        evidence: [message],
        safeReadConfirmed: true,
      }));
    }
  }

  const patientArtifactsDirectory = path.join(params.outputDir, "patients", params.run.workItemId);
  const supplementalAssessmentTargets = getSupplementalOasisAssessmentTargets({
    snapshot: portalStatusSnapshot,
    currentAssessmentId: currentOasisAssessmentId,
  });
  const assessmentManifestEntries: Array<Record<string, unknown>> = [
    {
      assessmentId: currentOasisAssessmentId,
      assessmentType: currentAssessmentSelection.selectedAssessmentType,
      title: currentOasisAssessmentTarget?.title ?? null,
      date: currentOasisAssessmentTarget?.date ?? null,
      isCurrent: true,
      isMonitored: true,
      processingStatus: oasisDomExtraction ? "processed_root_current" : "not_processed",
      artifactDirectory: patientArtifactsDirectory,
      domStatePath: oasisDomExtraction?.domStatePath ?? null,
      acquisitionStatePath: oasisDomExtraction?.acquisitionStatePath ?? null,
      sectionOutputsPath: oasisDomSectionProcessing?.outputsPath ?? null,
      sectionManifestPath: oasisDomSectionProcessing?.manifestPath ?? null,
      mggSnapshotPath: oasisDomExtraction
        ? path.join(patientArtifactsDirectory, "oasis-mgg-field-snapshot.json")
        : null,
      warningCount: domWarnings.length,
    },
  ];

  for (const target of supplementalAssessmentTargets) {
    const assessmentDirectory = path.join(
      patientArtifactsDirectory,
      "oasis-assessments",
      safeAssessmentArtifactKey(target.id),
    );
    const targetSelection = buildOasisAssessmentSelectionForTarget({
      baseSelection: assessmentSelection.result,
      targetAssessment: target,
      purpose: "supplemental_once",
    });
    try {
      const supplementalAssessmentNote = await openAssessmentNote({
        context: params.context,
        workItem: params.workItem,
        evidenceDir: params.evidenceDir,
        selection: targetSelection,
        targetAssessment: target,
        logger: params.logger,
        portalClient: params.portalClient,
      });
      stepLogs.push(...supplementalAssessmentNote.stepLogs);
      const supplementalShouldCapture =
        supplementalAssessmentNote.result.oasisAssessmentStatus?.decision !== "SKIP" &&
        env.PORTAL_DOM_EXTRACTION_ENABLED &&
        env.OASIS_DOM_EXTRACTION_ENABLED &&
        typeof params.portalClient.extractOasisDomForReview === "function";
      if (!supplementalShouldCapture) {
        assessmentManifestEntries.push({
          assessmentId: target.id,
          assessmentType: target.assessmentType,
          title: target.title,
          date: target.date,
          isCurrent: false,
          isMonitored: false,
          processingStatus: "skipped",
          artifactDirectory: assessmentDirectory,
          reason: supplementalAssessmentNote.result.oasisAssessmentStatus?.reason ?? "OASIS DOM extraction disabled or assessment skipped.",
        });
        continue;
      }

      const supplementalExtraction = await params.portalClient.extractOasisDomForReview?.({
        context: params.context,
        workItem: params.workItem,
        outputDir: params.outputDir,
        patientArtifactsDirectory: assessmentDirectory,
        thresholds: {
          minFieldCount: env.DOM_EXTRACTION_MIN_FIELD_COUNT,
          minNonEmptyFieldCount: env.DOM_EXTRACTION_MIN_NONEMPTY_FIELD_COUNT,
        },
      });
      stepLogs.push(...(supplementalExtraction?.stepLogs ?? []));
      let sectionManifestPath: string | null = null;
      let sectionOutputsPath: string | null = null;
      if (supplementalExtraction) {
        const sectionProcessing = await processOasisDomSections({
          state: supplementalExtraction.state,
          patientArtifactsDirectory: assessmentDirectory,
          patientId: params.workItem.id,
          patientRunId: params.context.patientRunId,
          env,
          assessmentId: target.id,
          assessmentType: target.assessmentType,
          title: target.title,
          date: target.date,
          sourceDomStatePath: supplementalExtraction.domStatePath,
        });
        sectionManifestPath = sectionProcessing.manifestPath;
        sectionOutputsPath = sectionProcessing.outputsPath;
        stepLogs.push(createAutomationStepLog({
          step: "supplemental_oasis_dom_section_processing",
          message: `Processed supplemental ${target.assessmentType} OASIS DOM sections with per-section hash reuse.`,
          patientName: params.workItem.patientIdentity.displayName,
          urlBefore: params.context.chartUrl,
          urlAfter: supplementalAssessmentNote.result.currentUrl,
          found: [
            `assessmentId=${target.id}`,
            `processedSections=${sectionProcessing.outputs.summary.processedSections}`,
            `reusedSections=${sectionProcessing.outputs.summary.reusedSections}`,
            `outputsPath=${sectionOutputsPath}`,
            `mggSnapshotPath=${sectionProcessing.mggSnapshotPath}`,
          ],
          evidence: sectionProcessing.outputs.warnings.slice(0, 6),
          safeReadConfirmed: true,
        }));
      }

      assessmentManifestEntries.push({
        assessmentId: target.id,
        assessmentType: target.assessmentType,
        title: target.title,
        date: target.date,
        isCurrent: false,
        isMonitored: false,
        processingStatus: supplementalExtraction ? "processed_scoped" : "not_processed",
        artifactDirectory: assessmentDirectory,
        domStatePath: supplementalExtraction?.domStatePath ?? null,
        acquisitionStatePath: supplementalExtraction?.acquisitionStatePath ?? null,
        sectionOutputsPath,
        sectionManifestPath,
        mggSnapshotPath: supplementalExtraction
          ? path.join(assessmentDirectory, "oasis-mgg-field-snapshot.json")
          : null,
        contentHash: supplementalExtraction?.acquisitionState.overallContentHash ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      domWarnings.push(`supplemental_oasis_assessment_processing_failed:${target.id}:${message}`);
      assessmentManifestEntries.push({
        assessmentId: target.id,
        assessmentType: target.assessmentType,
        title: target.title,
        date: target.date,
        isCurrent: false,
        isMonitored: false,
        processingStatus: "failed",
        artifactDirectory: assessmentDirectory,
        error: message,
      });
      stepLogs.push(createAutomationStepLog({
        step: "supplemental_oasis_assessment_processing_failed",
        message: `Supplemental ${target.assessmentType} OASIS processing failed; monitored current OASIS artifacts remain usable.`,
        patientName: params.workItem.patientIdentity.displayName,
        urlBefore: params.context.chartUrl,
        urlAfter: params.context.chartUrl,
        missing: [`supplemental_oasis_assessment:${target.id}`],
        evidence: [message],
        safeReadConfirmed: true,
      }));
    }
  }

  const assessmentManifestPath = await writeOasisAssessmentProcessingManifest({
    patientArtifactsDirectory,
    generatedAt: new Date().toISOString(),
    assessments: assessmentManifestEntries,
  });
  if (supplementalAssessmentTargets.length > 0) {
    stepLogs.push(createAutomationStepLog({
      step: "oasis_assessment_processing_manifest",
      message: "Persisted OASIS assessment processing manifest for monitored current and supplemental assessment tabs.",
      patientName: params.workItem.patientIdentity.displayName,
      urlBefore: params.context.chartUrl,
      urlAfter: params.context.chartUrl,
      found: [
        `manifestPath=${assessmentManifestPath}`,
        `supplementalAssessmentCount=${supplementalAssessmentTargets.length}`,
      ],
      safeReadConfirmed: true,
    }));
  }

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
      : [assessmentNote.result.oasisAssessmentStatus?.reason ?? "Skipped OASIS DOM acquisition due to OASIS page status."]),
    ...domWarnings,
    ...(domAcquisitionInsufficient
      ? ["OASIS DOM extraction was insufficient and OCR/PDF fallback is disabled."]
      : []),
    ...(domAcquisitionPending
      ? [
          `OASIS DOM acquisition is pending completion: ${oasisDomExtraction?.acquisitionState.readinessReasons.join(", ") ?? "unknown"}`,
        ]
      : []),
    ...(domQaAlreadyCompleted
      ? ["OASIS DOM acquisition is unchanged from prior QA input; expensive QA acquisition was skipped."]
      : []),
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
    oasisDomSectionProcessing,
  };

  const workflowResultPath = path.join(
    params.outputDir,
    "patients",
    params.run.workItemId,
    "qa-prefetch-result.json",
  );
  await mkdir(path.dirname(workflowResultPath), { recursive: true });
  await writeFile(workflowResultPath, JSON.stringify(result, null, 2), "utf8");

  if (oasisDomExtraction && domAcquisitionReady) {
    const completedAcquisitionState = {
      ...oasisDomExtraction.acquisitionState,
      acquisitionStatus: "qa_completed" as const,
      lastQaInputHash: oasisDomExtraction.acquisitionState.overallContentHash,
      lastCompletedAt: timestamp,
    };
    await writeFile(
      oasisDomExtraction.acquisitionStatePath,
      JSON.stringify(completedAcquisitionState, null, 2),
      "utf8",
    );
    stepLogs.push(createAutomationStepLog({
      step: "oasis_dom_acquisition_qa_completed",
      message: "Marked OASIS DOM acquisition state as QA completed for the current content hash.",
      patientName: params.workItem.patientIdentity.displayName,
      urlBefore: params.context.chartUrl,
      urlAfter: assessmentNote.result.currentUrl,
      found: [
        `lastQaInputHash=${completedAcquisitionState.lastQaInputHash}`,
        `acquisitionStatePath=${oasisDomExtraction.acquisitionStatePath}`,
      ],
      safeReadConfirmed: true,
    }));
  }

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
