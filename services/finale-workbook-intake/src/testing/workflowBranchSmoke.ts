import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
  PatientMatchResult,
} from "@medical-ai-qa/shared-types";
import { pino } from "pino";
import { loadEnv } from "../config/env";
import { executeSharedPortalAccessWorkflow } from "../portal/workflows/sharedPortalAccessWorkflow";
import { runQAForPatient } from "../services/batchRunService";
import { intakeWorkbook } from "../services/workbookIntakeService";
import type { OasisExecutionActionPerformed } from "../services/oasisDiagnosisExecutionService";
import type { OasisInputActionPlan } from "../services/oasisInputActionPlanService";
import type { ResolvedPatientPortalAccess } from "../portal/context/patientPortalContext";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import type { QaPrefetchResult } from "../qa/types/qaPrefetchResult";
import type {
  OasisAssessmentNoteOpenResult,
  OasisPrintedNoteCaptureOpenResult,
  OasisMenuOpenResult,
} from "../oasis/types/oasisQaResult";
import type {
  EpisodeRangeSelectionTarget,
  ResolvedEpisodeSelection,
} from "../oasis/navigation/episodeRangeDropdownService";
import type { BillingPeriodCalendarSummary } from "../oasis/types/billingPeriodCalendarSummary";

class SmokePortalClient implements BatchPortalAutomationClient {
  async initialize(): Promise<void> {}

  async resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess> {
    return {
      patientName: input.workItem.patientIdentity.displayName,
      patientId: "PT-SMOKE-1",
      chartUrl: "https://demo.portal/provider/branch/client/PT-SMOKE-1/intake",
      dashboardUrl: "https://demo.portal/provider/branch/dashboard",
      resolvedAt: new Date().toISOString(),
      traceId: `${input.batchId}:${input.patientRunId}`,
      matchResult: {
        status: "EXACT",
        searchQuery: input.workItem.patientIdentity.displayName,
        portalPatientId: "PT-SMOKE-1",
        portalDisplayName: input.workItem.patientIdentity.displayName,
        candidateNames: [input.workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs: [],
    };
  }

  async resolvePatient(workItem: PatientEpisodeWorkItem): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
    return {
      matchResult: {
        status: "EXACT",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: "PT-SMOKE-1",
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs: [],
    };
  }

  async discoverArtifacts(_workItem: PatientEpisodeWorkItem, evidenceDir: string): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
  }> {
    await mkdir(evidenceDir, { recursive: true });
    const oasisPath = path.join(evidenceDir, "oasis.txt");
    const pocPath = path.join(evidenceDir, "poc.txt");
    const visitNotePath = path.join(evidenceDir, "visit-note.txt");

    await writeFile(
      oasisPath,
      "Medical necessity established. Patient is homebound. Comprehensive assessment completed. Skilled interventions performed by skilled nursing.",
      "utf8",
    );
    await writeFile(
      pocPath,
      "Diagnosis list updated. Goals and interventions reviewed. Plan of care includes exacerbation monitoring.",
      "utf8",
    );
    await writeFile(
      visitNotePath,
      "Skilled nursing visit performed. Skilled need requires skilled nursing for wound care. Interventions performed: wound care and teaching provided. Patient response tolerated well. Progress toward goals noted. Changes in condition addressed with improvement documented. Vitals: blood pressure and heart rate documented. Medications reviewed with no changes. Documentation supports billed services and remains consistent with OASIS diagnoses and plan of care.",
      "utf8",
    );

    return {
      artifacts: [
        {
          artifactType: "OASIS",
          status: "FOUND",
          portalLabel: "OASIS",
          locatorUsed: "text=OASIS",
          discoveredAt: new Date().toISOString(),
          downloadPath: oasisPath,
          extractedFields: {},
          notes: [],
        },
        {
          artifactType: "PLAN_OF_CARE",
          status: "FOUND",
          portalLabel: "POC",
          locatorUsed: "text=POC",
          discoveredAt: new Date().toISOString(),
          downloadPath: pocPath,
          extractedFields: {},
          notes: [],
        },
        {
          artifactType: "VISIT_NOTES",
          status: "FOUND",
          portalLabel: "Visit Notes",
          locatorUsed: "text=Visit Notes",
          discoveredAt: new Date().toISOString(),
          downloadPath: visitNotePath,
          extractedFields: {},
          notes: [],
        },
        {
          artifactType: "PHYSICIAN_ORDERS",
          status: "FOUND",
          portalLabel: "Orders",
          locatorUsed: "text=Orders",
          discoveredAt: new Date().toISOString(),
          downloadPath: pocPath,
          extractedFields: {},
          notes: [],
        },
        {
          artifactType: "COMMUNICATION_NOTES",
          status: "FOUND",
          portalLabel: "Communication Notes",
          locatorUsed: "text=Communication Notes",
          discoveredAt: new Date().toISOString(),
          downloadPath: visitNotePath,
          extractedFields: {},
          notes: [],
        },
      ],
      documentInventory: [
        {
          sourceLabel: "OASIS",
          normalizedType: "OASIS",
          discipline: "SN",
          confidence: 0.98,
          evidence: ["Smoke-test OASIS document."],
          sourceUrl: null,
          sourcePath: oasisPath,
          discoveredAt: new Date().toISOString(),
          openBehavior: "DOWNLOAD",
        },
      ],
      stepLogs: [],
    };
  }

  async executeOasisDiagnosisActionPlan(
    _workItem: PatientEpisodeWorkItem,
    _evidenceDir: string,
    _options: {
      actionPlan: OasisInputActionPlan;
      lockState: OasisLockStateSnapshot | null;
      writeEnabled: boolean;
      initialSnapshot?: OasisDiagnosisPageSnapshot | null;
    },
  ): Promise<{
    diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null;
    actionsPerformed: OasisExecutionActionPerformed[];
    insertClicksPerformed: number;
    fieldsUpdatedCount: number;
    executed: boolean;
    warnings: string[];
    stepLogs: AutomationStepLog[];
  }> {
    return {
      diagnosisPageSnapshot: null,
      actionsPerformed: [],
      insertClicksPerformed: 0,
      fieldsUpdatedCount: 0,
      executed: false,
      warnings: ["smoke_stub_execution_not_run"],
      stepLogs: [],
    };
  }

  async captureFailureArtifacts() {
    return {
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
    };
  }

  async runQaPrefetchDiscovery(input: {
    context: import("../portal/context/patientPortalContext").PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
  }): Promise<{
    result: QaPrefetchResult;
    stepLogs: AutomationStepLog[];
  }> {
    const timestamp = new Date().toISOString();
    return {
      result: {
        workflowDomain: "qa",
        workflowRunId: `${input.context.patientRunId}:qa`,
        patientRunId: input.context.patientRunId,
        patientName: input.workItem.patientIdentity.displayName,
        patientId: input.context.patientId ?? null,
        chartUrl: input.context.chartUrl,
        dashboardUrl: input.context.dashboardUrl ?? null,
        resolvedAt: input.context.resolvedAt,
        status: "COMPLETED",
        routeDiscovery: {
          currentUrl: input.context.chartUrl,
          sidebarLabels: ["Calendar", "File Uploads", "OASIS", "Active Diagnoses"],
          topVisibleText: ["Active Diagnoses", "J18.9 Pneumonia, unspecified organism"],
          routeCandidates: [
            {
              label: "File Uploads",
              classification: "patient_documents",
              source: "sidebar_label",
              confidence: "high",
              matchedValue: "File Uploads",
            },
          ],
          selectedRoute: {
            label: "File Uploads",
            classification: "patient_documents",
            source: "sidebar_label",
            confidence: "high",
            matchedValue: "File Uploads",
          },
          warnings: [],
        },
        oasisRoute: {
          found: true,
          signals: [{ source: "sidebar_label", value: "OASIS" }],
          warnings: [],
        },
        diagnosisRoute: {
          found: true,
          signals: [{ source: "page_text", value: "Active Diagnoses" }],
          visibleDiagnoses: [
            {
              text: "J18.9 Pneumonia, unspecified organism",
              code: "J18.9",
              description: "Pneumonia, unspecified organism",
            },
          ],
          warnings: [],
        },
        lockStatus: {
          status: "locked",
          signals: [{ source: "page_text", value: "Unlock" }],
        },
        selectedRouteSummary: "patient documents via sidebar_label: File Uploads",
        warningCount: 0,
        topWarning: null,
        warnings: [],
        createdAt: timestamp,
      },
      stepLogs: [
        {
          timestamp,
          step: "qa_chart_discovery_start",
          message: "QA branch began real chart discovery from PatientPortalContext.",
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: input.context.chartUrl,
          urlAfter: input.context.chartUrl,
          selectorUsed: null,
          found: ["workflowDomain=qa"],
          missing: [],
          openedDocumentLabel: null,
          openedDocumentUrl: null,
          evidence: [],
          retryCount: 0,
          safeReadConfirmed: true,
        },
        {
          timestamp,
          step: "qa_prefetch_result_persisted",
          message: "QA prefetch discovery result is ready to persist under the QA workflow domain.",
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: input.context.chartUrl,
          urlAfter: input.context.chartUrl,
          selectorUsed: null,
          found: ["selectedRouteSummary=patient documents via sidebar_label: File Uploads"],
          missing: [],
          openedDocumentLabel: null,
          openedDocumentUrl: null,
          evidence: [],
          retryCount: 0,
          safeReadConfirmed: true,
        },
      ],
    };
  }

  async openOasisMenuForReview(input: {
    context: import("../portal/context/patientPortalContext").PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
  }): Promise<{
    result: OasisMenuOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    const timestamp = new Date().toISOString();
    return {
      result: {
        opened: true,
        currentUrl: `${input.context.chartUrl}/documents?type=oasis`,
        selectorUsed: "sidebar:OASIS",
        availableAssessmentTypes: ["SOC", "RECERT"],
        warnings: [],
      },
      stepLogs: [{
        timestamp,
        step: "oasis_menu_open",
        message: "Opened OASIS menu from the patient chart sidebar.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.context.chartUrl,
        urlAfter: `${input.context.chartUrl}/documents?type=oasis`,
        selectorUsed: "sidebar:OASIS",
        found: ["workflowDomain=qa", "oasisMenuOpened=true"],
        missing: [],
        openedDocumentLabel: null,
        openedDocumentUrl: null,
        evidence: ["availableAssessmentTypes=SOC | RECERT"],
        retryCount: 0,
        safeReadConfirmed: true,
      }],
    };
  }

  async selectEpisodeRangeForReview(input: {
    context: import("../portal/context/patientPortalContext").PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    target?: EpisodeRangeSelectionTarget | null;
  }): Promise<{
    result: ResolvedEpisodeSelection;
    stepLogs: AutomationStepLog[];
  }> {
    const selectedOption = {
      rawLabel: input.target?.rawLabel ?? "03/01/2026 - 04/29/2026",
      startDate: input.target?.startDate ?? "03/01/2026",
      endDate: input.target?.endDate ?? "04/29/2026",
      isSelected: true,
    };
    return {
      result: {
        selectedOption,
        availableOptions: [selectedOption],
        changedSelection: false,
        warnings: [],
        selectionMethod: "parsed_date_match",
      },
      stepLogs: [{
        timestamp: new Date().toISOString(),
        step: "episode_options_discovered",
        message: "Discovered the Episode of dropdown options in the patient header.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.context.chartUrl,
        urlAfter: input.context.chartUrl,
        selectorUsed: "app-header-info ng-select",
        found: [selectedOption.rawLabel],
        missing: [],
        openedDocumentLabel: null,
        openedDocumentUrl: null,
        evidence: ["workflowDomain=qa", "selectionMethod=parsed_date_match"],
        retryCount: 0,
        safeReadConfirmed: true,
      }],
    };
  }

  async extractBillingPeriodCalendarSummaryForReview(input: {
    context: import("../portal/context/patientPortalContext").PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    selectedEpisode: EpisodeRangeSelectionTarget | null;
  }): Promise<{
    result: BillingPeriodCalendarSummary;
    summaryPath: string;
    stepLogs: AutomationStepLog[];
  }> {
    const summaryPath = path.join(input.evidenceDir, "billing-period-calendar-summary.json");
    await mkdir(input.evidenceDir, { recursive: true });
    const result: BillingPeriodCalendarSummary = {
      selectedEpisode: {
        rawLabel: input.selectedEpisode?.rawLabel ?? "03/01/2026 - 04/29/2026",
        startDate: "2026-03-01",
        endDate: "2026-04-29",
      },
      periods: {
        first30Days: {
          startDate: "2026-03-01",
          endDate: "2026-03-30",
          totalCards: 3,
          countsByType: { oasis: 1, sn_visit: 1, physician_order: 1 },
          cards: [],
        },
        second30Days: {
          startDate: "2026-03-31",
          endDate: "2026-04-29",
          totalCards: 2,
          countsByType: { pt_visit: 1, communication_note: 1 },
          cards: [],
        },
        outsideRange: {
          startDate: null,
          endDate: null,
          totalCards: 1,
          countsByType: { other: 1 },
          cards: [],
        },
      },
      visibleDays: [],
      warnings: [],
    };
    await writeFile(summaryPath, JSON.stringify(result, null, 2), "utf8");
    return {
      result,
      summaryPath,
      stepLogs: [{
        timestamp: new Date().toISOString(),
        step: "billing_calendar_summary_persisted",
        message: "Persisted billing-period calendar summary artifact for QA review.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.context.chartUrl,
        urlAfter: input.context.chartUrl,
        selectorUsed: "calendar-grid",
        found: ["first30=3", "second30=2", "outside=1"],
        missing: [],
        openedDocumentLabel: null,
        openedDocumentUrl: null,
        evidence: [summaryPath],
        retryCount: 0,
        safeReadConfirmed: true,
      }],
    };
  }

  async openOasisAssessmentNoteForReview(input: {
    context: import("../portal/context/patientPortalContext").PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType: string;
  }): Promise<{
    result: OasisAssessmentNoteOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    const timestamp = new Date().toISOString();
      return {
        result: {
          assessmentOpened: true,
          matchedAssessmentLabel: `${input.assessmentType} OASIS`,
          matchedRequestedAssessment: true,
          currentUrl: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
          diagnosisSectionOpened: true,
          diagnosisListFound: true,
        diagnosisListSamples: ["Active Diagnoses", "J18.9 Pneumonia, unspecified organism"],
        visibleDiagnoses: [{
          text: "J18.9 Pneumonia, unspecified organism",
          code: "J18.9",
          description: "Pneumonia, unspecified organism",
        }],
        lockStatus: "locked",
        warnings: [],
      },
      stepLogs: [{
        timestamp,
        step: "oasis_assessment_note_opened",
        message: "Opened the requested OASIS assessment note for read-only review.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.context.chartUrl,
        urlAfter: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
        selectorUsed: "table:SOC",
        found: ["assessmentOpened=true", `assessmentType=${input.assessmentType}`],
        missing: [],
        openedDocumentLabel: `${input.assessmentType} OASIS`,
        openedDocumentUrl: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
        evidence: ["diagnosisSectionOpened=true", "lockStatus=locked"],
        retryCount: 0,
        safeReadConfirmed: true,
      }],
    };
  }

  async captureOasisPrintedNoteForReview(input: {
    context: import("../portal/context/patientPortalContext").PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType: string;
    matchedAssessmentLabel?: string | null;
    printProfileKey?: import("../oasis/print/oasisPrintedNoteProfiles").OasisPrintSectionProfileKey | null;
  }): Promise<{
    result: OasisPrintedNoteCaptureOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    const printedDir = path.join(input.evidenceDir, "oasis-printed-note");
    await mkdir(printedDir, { recursive: true });
    const extractedTextPath = path.join(printedDir, "extracted-text.txt");
    const extractionResultPath = path.join(printedDir, "extraction-result.json");
    await writeFile(
      extractedTextPath,
      "Administrative Information\nPrimary Reason / Medical Necessity\nVital Signs\nDiagnosis\nMedications and Allergies",
      "utf8",
    );
    await writeFile(extractionResultPath, JSON.stringify({ assessmentType: input.assessmentType }, null, 2), "utf8");
    return {
      result: {
        assessmentType: input.assessmentType,
        printProfileKey: input.printProfileKey ?? "soc_full_document_v1",
        printProfileLabel: "Full OASIS document",
        printButtonDetected: true,
        printButtonVisible: true,
        printButtonSelectorUsed: "fin-button[title='Print']",
        printClickSucceeded: true,
        printModalDetected: true,
        printModalSelectorUsed: "ngb-modal-window[role='dialog']",
        printModalConfirmSelectorUsed: "button:has-text('Print')",
        printModalConfirmSucceeded: true,
        selectedSectionLabels: [
          "Administrative Information",
          "Primary Reason / Medical Necessity",
          "Vital Signs & Pain Assessment",
          "Diagnosis",
          "Medications and Allergies",
        ],
        currentUrl: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
        printedPdfPath: null,
        sourcePdfPath: null,
        extractedTextPath,
        extractionResultPath,
        ocrResultPath: null,
        textLength: 104,
        extractionMethod: "visible_text_fallback",
        warnings: [],
      },
      stepLogs: [{
        timestamp: new Date().toISOString(),
        step: "oasis_printed_note_review",
        message: "Persisted read-only OASIS printed-note review artifact.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.context.chartUrl,
        urlAfter: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
        selectorUsed: "fin-button[title='Print']",
        found: ["overallStatus=PARTIAL"],
        missing: [],
        openedDocumentLabel: input.matchedAssessmentLabel ?? `${input.assessmentType} OASIS`,
        openedDocumentUrl: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
        evidence: [extractedTextPath],
        retryCount: 0,
        safeReadConfirmed: true,
      }],
    };
  }

  async dispose(): Promise<void> {}
}

async function createWorkbookFixture(): Promise<{
  workbookPath: string;
  outputDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "workflow-branch-smoke-"));
  const workbookPath = path.join(tempDir, "fixture.xlsx");
  const outputDir = path.join(tempDir, "output");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 Days Tracking", "CODING", "OASIS QA REMARKS", "POC QA REMARKS"],
      ["DOE, JANE", "03/01/2026", "Alice", "Medicare", "SOC", "5", "QA done", "Locked", "Exported"],
    ]),
    "OASIS SOC-ROC-REC & POC",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["PATIENT NAME", "Medicare No.", "PAYER", "SOC Date", "episode period", "billing period", "status", "OASIS QA", "OASIS STATUS", "QA", "SN", "PT/OT/ST", "HHA/MSW", "BILLING STATUS"],
      ["Jane Doe", "12345", "Medicare", "03/01/2026", "03/01/2026 - 04/29/2026", "03/01/2026 - 03/31/2026", "Done and Reviewed", "Locked", "Locked", "Done and Reviewed", "Done and Reviewed", "", "", "Done and Reviewed"],
    ]),
    "VISIT NOTES",
  );

  XLSX.writeFile(workbook, workbookPath);

  return {
    workbookPath,
    outputDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  const fixture = await createWorkbookFixture();
  const logger = pino({ level: "silent" });

  try {
    const intake = await intakeWorkbook({
      workbookPath: fixture.workbookPath,
      outputDir: fixture.outputDir,
    });
    const patient = intake.workItems[0];
    if (!patient) {
      throw new Error("Smoke fixture did not produce a patient work item.");
    }

    const portalClient = new SmokePortalClient();
    await portalClient.initialize();

    const sharedAccess = await executeSharedPortalAccessWorkflow({
      batchId: intake.manifest.batchId,
      patientRunId: "smoke-shared-access",
      workflowDomains: ["coding", "qa"],
      workItem: patient,
      evidenceDir: path.join(fixture.outputDir, "shared-access-evidence"),
      portalClient,
      logger,
    });
    await portalClient.dispose();

    const codingRun = await runQAForPatient({
      batchId: `${intake.manifest.batchId}-coding`,
      patient,
      outputDir: path.join(fixture.outputDir, "coding"),
      portalClient: new SmokePortalClient(),
      workflowDomains: ["coding"],
    });

    const qaRun = await runQAForPatient({
      batchId: `${intake.manifest.batchId}-qa`,
      patient,
      outputDir: path.join(fixture.outputDir, "qa"),
      portalClient: new SmokePortalClient(),
      workflowDomains: ["qa"],
    });

    const dualRun = await runQAForPatient({
      batchId: `${intake.manifest.batchId}-dual`,
      patient,
      outputDir: path.join(fixture.outputDir, "dual"),
      portalClient: new SmokePortalClient(),
      workflowDomains: ["coding", "qa"],
    });

    const qaStubArtifact = dualRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa")?.workflowResultPath;
    const qaStubPayload = qaStubArtifact ? JSON.parse(await readFile(qaStubArtifact, "utf8")) as Record<string, unknown> : null;

    const output = {
      sharedAccess: {
        matchStatus: sharedAccess.matchResult.status,
        portalContexts: sharedAccess.portalContexts.map((context) => ({
          workflowDomain: context.workflowDomain,
          patientName: context.patientName,
          patientId: context.patientId ?? null,
          chartUrl: context.chartUrl,
          dashboardUrl: context.dashboardUrl ?? null,
        })),
      },
      codingRun: {
        processingStatus: codingRun.processingStatus,
        executionStep: codingRun.executionStep,
        workflowRuns: codingRun.workflowRuns.map((workflowRun) => ({
          workflowDomain: workflowRun.workflowDomain,
          status: workflowRun.status,
          workflowResultPath: workflowRun.workflowResultPath ?? null,
        })),
        hasSharedAccessLog: codingRun.automationStepLogs.some((log) => log.step === "shared_portal_access"),
      },
      qaRun: {
        processingStatus: qaRun.processingStatus,
        executionStep: qaRun.executionStep,
        workflowRuns: qaRun.workflowRuns.map((workflowRun) => ({
          workflowDomain: workflowRun.workflowDomain,
          status: workflowRun.status,
          workflowResultPath: workflowRun.workflowResultPath ?? null,
        })),
        hasQaBranchLog: qaRun.automationStepLogs.some((log) =>
          ["oasis_episode_resolution", "oasis_menu_open", "oasis_assessment_note_opened"].includes(log.step)),
      },
      dualRun: {
        processingStatus: dualRun.processingStatus,
        executionStep: dualRun.executionStep,
        workflowRuns: dualRun.workflowRuns.map((workflowRun) => ({
          workflowDomain: workflowRun.workflowDomain,
          status: workflowRun.status,
          workflowResultPath: workflowRun.workflowResultPath ?? null,
          workflowLogPath: workflowRun.workflowLogPath ?? null,
        })),
        hasCodingBranchLog: dualRun.automationStepLogs.some((log) => log.step === "coding_workflow_start"),
        hasQaBranchLog: dualRun.automationStepLogs.some((log) =>
          ["oasis_episode_resolution", "oasis_menu_open", "oasis_assessment_note_opened"].includes(log.step)),
        qaEntrySummary: qaStubPayload?.selectedRouteSummary ?? null,
      },
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await fixture.cleanup();
  }
}

void main();
