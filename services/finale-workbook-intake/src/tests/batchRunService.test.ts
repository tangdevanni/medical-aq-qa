import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientDashboardState,
  PatientEpisodeWorkItem,
  PatientMatchResult,
} from "@medical-ai-qa/shared-types";
import { runBatchQA, runFinaleBatch, runQAForPatient } from "../services/batchRunService";
import type { OasisExecutionActionPerformed } from "../services/oasisDiagnosisExecutionService";
import type { OasisInputActionPlan } from "../services/oasisInputActionPlanService";
import { intakeWorkbook } from "../services/workbookIntakeService";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import type { ResolvedPatientPortalAccess } from "../portal/context/patientPortalContext";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";
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

class FakePortalClient implements BatchPortalAutomationClient {
  public oasisExecutionCalls = 0;
  public discoverArtifactsCalls = 0;
  public discoverArtifactWorkflowPhases: string[] = [];

  async initialize(): Promise<void> {}

  async resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess> {
    return {
      patientName: input.workItem.patientIdentity.displayName,
      patientId: "PT-1",
      chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
      dashboardUrl: "https://demo.portal/provider/branch/dashboard",
      resolvedAt: new Date().toISOString(),
      portalAdmissionStatus: null,
      traceId: `${input.batchId}:${input.patientRunId}`,
      matchResult: {
        status: "EXACT",
        searchQuery: input.workItem.patientIdentity.displayName,
        portalPatientId: "PT-1",
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
        portalPatientId: "PT-1",
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs: [],
    };
  }

  async discoverArtifacts(
    _workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options?: {
      workflowPhase?: "full_discovery" | "file_uploads_only" | "oasis_diagnosis_only";
    },
  ): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
  }> {
    this.discoverArtifactsCalls += 1;
    this.discoverArtifactWorkflowPhases.push(options?.workflowPhase ?? "full_discovery");
    mkdirSync(evidenceDir, { recursive: true });
    const oasisPath = path.join(evidenceDir, "oasis.txt");
    const pocPath = path.join(evidenceDir, "poc.txt");
    const visitNotePath = path.join(evidenceDir, "visit-note.txt");

    writeFileSync(
      oasisPath,
      "Medical necessity established. Patient is homebound. Comprehensive assessment completed. Skilled interventions performed by skilled nursing.",
      "utf8",
    );
    writeFileSync(
      pocPath,
      "Diagnosis list updated. Goals and interventions reviewed. Plan of care includes exacerbation monitoring.",
      "utf8",
    );
    writeFileSync(
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
          evidence: ["Fixture OASIS document."],
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
    this.oasisExecutionCalls += 1;
    return {
      diagnosisPageSnapshot: null,
      actionsPerformed: [],
      insertClicksPerformed: 0,
      fieldsUpdatedCount: 0,
      executed: false,
      warnings: ["test_stub_execution_not_run"],
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
    const result: QaPrefetchResult = {
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
    };

    return {
      result,
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
      stepLogs: [
        {
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
        },
      ],
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
      stepLogs: [
        {
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
        },
      ],
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
    mkdirSync(input.evidenceDir, { recursive: true });
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
    writeFileSync(summaryPath, JSON.stringify(result, null, 2), "utf8");
    return {
      result,
      summaryPath,
      stepLogs: [
        {
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
        },
      ],
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
        visibleDiagnoses: [
          {
            text: "J18.9 Pneumonia, unspecified organism",
            code: "J18.9",
            description: "Pneumonia, unspecified organism",
          },
        ],
        lockStatus: "locked",
        warnings: [],
      },
      stepLogs: [
        {
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
        },
      ],
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
    mkdirSync(printedDir, { recursive: true });
    const extractedTextPath = path.join(printedDir, "extracted-text.txt");
    const extractionResultPath = path.join(printedDir, "extraction-result.json");
    writeFileSync(
      extractedTextPath,
      [
        "Administrative Information",
        "Primary Reason / Medical Necessity",
        "Patient is homebound and medical necessity is documented.",
        "Vital Signs blood pressure heart rate temperature.",
        "Respiratory shortness of breath oxygen.",
        "Diagnosis Active Diagnoses ICD codes listed.",
        "Medications and Allergies medication allergy oxygen therapy.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      extractionResultPath,
      JSON.stringify({ assessmentType: input.assessmentType }, null, 2),
      "utf8",
    );
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
        textLength: readFileSync(extractedTextPath, "utf8").length,
        extractionMethod: "visible_text_fallback",
        warnings: [],
      },
      stepLogs: [
        {
          timestamp: new Date().toISOString(),
          step: "oasis_print_capture",
          message: "Captured OASIS print-view text for read-only review.",
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: input.context.chartUrl,
          urlAfter: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
          selectorUsed: "fin-button[title='Print']",
          found: ["printButtonDetected=true", "printClickSucceeded=true"],
          missing: [],
          openedDocumentLabel: input.matchedAssessmentLabel ?? `${input.assessmentType} OASIS`,
          openedDocumentUrl: `${input.context.chartUrl}/oasis/${input.assessmentType.toLowerCase()}`,
          evidence: [extractedTextPath],
          retryCount: 0,
          safeReadConfirmed: true,
        },
      ],
    };
  }

  async dispose(): Promise<void> {}
}

class MixedPortalClient extends FakePortalClient {
  private resolveCount = 0;

  override async resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess> {
    this.resolveCount += 1;

    if (this.resolveCount === 1) {
      return {
        patientName: input.workItem.patientIdentity.displayName,
        patientId: null,
        chartUrl: null,
        dashboardUrl: "https://demo.portal/provider/branch/dashboard",
        resolvedAt: null,
        portalAdmissionStatus: null,
        traceId: `${input.batchId}:${input.patientRunId}`,
        matchResult: {
          status: "NOT_FOUND",
          searchQuery: input.workItem.patientIdentity.displayName,
          portalPatientId: null,
          portalDisplayName: null,
          candidateNames: [],
          note: "Patient search completed, but the patient is not currently available in portal results.",
        },
        stepLogs: [],
      };
    }

    return super.resolvePatientPortalAccess(input);
  }

  override async resolvePatient(workItem: PatientEpisodeWorkItem): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
    this.resolveCount += 1;

    if (this.resolveCount === 1) {
      return {
        matchResult: {
          status: "NOT_FOUND",
          searchQuery: workItem.patientIdentity.displayName,
          portalPatientId: null,
          portalDisplayName: null,
          candidateNames: [],
          note: "Patient search completed, but the patient is not currently available in portal results.",
        },
        stepLogs: [],
      };
    }

    return {
      matchResult: {
        status: "EXACT",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: `PT-${this.resolveCount}`,
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs: [],
    };
  }
}

class PortalExcludedStatusClient extends FakePortalClient {
  constructor(private readonly statusLabel: string) {
    super();
  }

  override async resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess> {
    const result = await super.resolvePatientPortalAccess(input);
    return {
      ...result,
      portalAdmissionStatus: this.statusLabel,
    };
  }
}

class FirstMissingReferralPortalClient extends FakePortalClient {
  private discoverCount = 0;

  override async discoverArtifacts(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options?: {
      workflowPhase?: "full_discovery" | "file_uploads_only" | "oasis_diagnosis_only";
    },
  ): Promise<{
    artifacts: ArtifactRecord[];
      documentInventory: DocumentInventoryItem[];
      stepLogs: AutomationStepLog[];
    }> {
    const result = await super.discoverArtifacts(workItem, evidenceDir, options);
    this.discoverCount += 1;
    if (this.discoverCount !== 1) {
      return result;
    }
    return {
      ...result,
      artifacts: result.artifacts.filter((artifact) => artifact.artifactType !== "PHYSICIAN_ORDERS"),
      documentInventory: result.documentInventory.filter((item) => item.normalizedType !== "ORDER"),
    };
  }
}

function writeWorkbookFixture(): { workbookPath: string; outputDir: string; cleanup: () => void } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-batch-"));
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

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DIZ"]]), "DIZ");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DC"]]), "OASIS DC-TXR-DEATH");
  XLSX.writeFile(workbook, workbookPath);

  return {
    workbookPath,
    outputDir,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe("runFinaleBatch", () => {
  it("processes every automation-eligible work item and writes patient result bundles", async () => {
    const fixture = writeWorkbookFixture();
    const portalClient = new FakePortalClient();

    try {
      const result = await runFinaleBatch({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
        portalClient,
      });

      expect(result.manifest.totalWorkItems).toBe(1);
      expect(result.patientRuns).toHaveLength(1);
      expect(result.patientRuns[0]?.processingStatus).toBe("COMPLETE");
      expect(result.patientRuns[0]?.qaOutcome).toBe("READY_FOR_BILLING_PREP");
      expect(result.patientRuns[0]?.oasisQaSummary.overallStatus).toBe("READY_FOR_BILLING");
      expect(result.patientRuns[0]?.documentInventory.length).toBeGreaterThan(0);
      expect(result.patientRuns[0]?.automationStepLogs.length).toBeGreaterThan(0);
      expect(result.batchSummary.complete).toBe(1);
      expect(result.batchSummary.qaOutcomes.READY_FOR_BILLING_PREP).toBe(1);
      expect(result.patientRuns[0]?.resultBundlePath).toMatch(/patient-results/);
      expect(result.patientRuns[0]?.logPath).toMatch(/logs/);
      expect(result.patientRuns[0]?.logAvailable).toBe(true);
      expect(result.patientRuns[0]?.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "coding")?.status).toBe("COMPLETED");
      expect(result.patientRuns[0]?.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa")?.status).toBe("COMPLETED");
      expect(portalClient.oasisExecutionCalls).toBe(0);
      expect(portalClient.discoverArtifactsCalls).toBe(1);
      expect(portalClient.discoverArtifactWorkflowPhases).toEqual(["file_uploads_only"]);
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "shared_evidence_discovery_start")).toBe(true);
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "shared_evidence_discovery_complete")).toBe(true);
      expect(result.patientRuns[0]?.automationStepLogs.some((log) =>
        [
          "oasis_menu",
          "oasis_soc_document",
          "oasis_diagnosis_section",
          "oasis_diagnosis_snapshot",
          "oasis_lock_state_export",
          "oasis_ready_diagnosis_export",
          "oasis_diagnosis_verification",
          "oasis_diagnosis_compare",
        ].includes(log.step),
      )).toBe(false);
      expect(result.patientRuns[0]?.artifacts[0]?.extractedFields).not.toHaveProperty("oasisReadyDiagnosisPath");
      expect(result.patientRuns[0]?.artifacts[0]?.extractedFields).not.toHaveProperty("oasisLockStatePath");
    } finally {
      fixture.cleanup();
    }
  }, 20_000);

  it("exposes runQAForPatient and writes a structured patient log", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const patientRun = await runQAForPatient({
        batchId: intake.manifest.batchId,
        patient: intake.workItems[0]!,
        outputDir: fixture.outputDir,
        portalClient: new FakePortalClient(),
      });

      expect(patientRun.processingStatus).toBe("COMPLETE");
      expect(patientRun.logAvailable).toBe(true);
      expect(patientRun.oasisQaSummary.blockers).toHaveLength(0);
      expect(patientRun.documentInventory.length).toBeGreaterThan(0);
      expect(patientRun.logPath).toBeTruthy();
      expect(existsSync(patientRun.logPath!)).toBe(true);
      expect(patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "coding")?.status).toBe("COMPLETED");

      const logPayload = JSON.parse(readFileSync(patientRun.logPath!, "utf8")) as {
        workItemId: string;
        processingStatus: string;
        workflowRuns: Array<{ workflowDomain: string; status: string }>;
      };

      expect(logPayload.workItemId).toBe(patientRun.workItemId);
      expect(logPayload.processingStatus).toBe("COMPLETE");
      expect(logPayload.workflowRuns.some((workflowRun) => workflowRun.workflowDomain === "coding")).toBe(true);

      const dashboardStatePath = path.join(
        fixture.outputDir,
        "patients",
        patientRun.workItemId,
        "patient-dashboard-state.json",
      );
      expect(existsSync(dashboardStatePath)).toBe(true);
      const dashboardState = JSON.parse(readFileSync(dashboardStatePath, "utf8")) as PatientDashboardState;
      expect(dashboardState.patientId).toBe(patientRun.workItemId);
      expect(dashboardState.workItem?.id).toBe(patientRun.workItemId);
      expect(dashboardState.artifactContents.codingInput).toBeTruthy();
      expect(dashboardState.artifactContents.qaPrefetch).toBeTruthy();
      expect(dashboardState.artifactContents.patientQaReference).toBeTruthy();
    } finally {
      fixture.cleanup();
    }
  });

  it("runs batch QA directly from normalized patients", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const result = await runBatchQA({
        batchId: `${intake.manifest.batchId}-rerun`,
        patients: intake.workItems,
        parserExceptions: intake.parserExceptions,
        workbookPath: fixture.workbookPath,
        outputDir: path.join(fixture.outputDir, "rerun"),
        portalClient: new FakePortalClient(),
      });

      expect(result.manifest.totalWorkItems).toBe(1);
      expect(result.patientRuns).toHaveLength(1);
      expect(result.batchSummary.totalReadyForBillingPrep).toBe(1);
      expect(result.patientRuns[0]?.oasisQaSummary.overallStatus).toBe("READY_FOR_BILLING");
      expect(existsSync(result.workItemsPath)).toBe(true);
      expect(existsSync(result.batchSummaryPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("marks patients not currently in portal without failing the batch and emits canonical logs", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });
      const firstPatient = intake.workItems[0]!;
      const secondPatient: PatientEpisodeWorkItem = {
        ...firstPatient,
        id: "patient-2",
        patientIdentity: {
          ...firstPatient.patientIdentity,
          displayName: "Jane Roe",
          normalizedName: "JANE ROE",
        },
      };

      const result = await runBatchQA({
        batchId: `${intake.manifest.batchId}-mixed`,
        patients: [firstPatient, secondPatient],
        parserExceptions: intake.parserExceptions,
        workbookPath: fixture.workbookPath,
        outputDir: path.join(fixture.outputDir, "mixed"),
        portalClient: new MixedPortalClient(),
      });

      expect(result.patientRuns).toHaveLength(2);
      expect(result.patientRuns[0]?.matchResult.status).toBe("NOT_FOUND");
      expect(result.patientRuns[0]?.qaOutcome).toBe("PORTAL_NOT_FOUND");
      expect(result.patientRuns[0]?.processingStatus).toBe("BLOCKED");
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "login")).toBe(true);
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "patient_search")).toBe(true);
      expect(result.patientRuns[1]?.processingStatus).toBe("COMPLETE");
      expect(result.patientRuns[1]?.qaOutcome).toBe("READY_FOR_BILLING_PREP");
      expect(result.batchSummary.qaOutcomes.PORTAL_NOT_FOUND).toBe(1);
      expect(result.batchSummary.qaOutcomes.READY_FOR_BILLING_PREP).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("blocks only the patient missing referral evidence and continues to the next patient", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });
      const firstPatient = intake.workItems[0]!;
      const secondPatient: PatientEpisodeWorkItem = {
        ...firstPatient,
        id: "patient-2",
        patientIdentity: {
          ...firstPatient.patientIdentity,
          displayName: "Jane Roe",
          normalizedName: "JANE ROE",
        },
      };

      const result = await runBatchQA({
        batchId: `${intake.manifest.batchId}-missing-referral`,
        patients: [firstPatient, secondPatient],
        parserExceptions: intake.parserExceptions,
        workbookPath: fixture.workbookPath,
        outputDir: path.join(fixture.outputDir, "missing-referral"),
        portalClient: new FirstMissingReferralPortalClient(),
      });

      expect(result.patientRuns).toHaveLength(2);
      expect(result.patientRuns[0]?.qaOutcome).toBe("MISSING_DOCUMENTS");
      expect(result.patientRuns[0]?.processingStatus).toBe("BLOCKED");
      expect(result.patientRuns[0]?.executionStep).toBe("REFERRAL_DOCUMENT_REQUIRED");
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "referral_document_check")).toBe(true);
      expect(result.patientRuns[0]?.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "coding")?.status).toBe("BLOCKED");
      expect(result.patientRuns[0]?.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa")?.status).toBe("BLOCKED");
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "oasis_print_capture")).toBe(false);
      expect(result.patientRuns[1]?.qaOutcome).toBe("READY_FOR_BILLING_PREP");
      expect(result.patientRuns[1]?.processingStatus).toBe("COMPLETE");
      expect(result.patientRuns[1]?.automationStepLogs.some((log) => log.step === "oasis_print_capture")).toBe(true);
      expect(result.batchSummary.qaOutcomes.MISSING_DOCUMENTS).toBe(1);
      expect(result.batchSummary.qaOutcomes.READY_FOR_BILLING_PREP).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("routes a QA-only workflow through shared access and records a separate QA workflow run", async () => {
    const fixture = writeWorkbookFixture();
    const portalClient = new FakePortalClient();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const patientRun = await runQAForPatient({
        batchId: intake.manifest.batchId,
        patient: intake.workItems[0]!,
        outputDir: fixture.outputDir,
        workflowDomains: ["qa"],
        portalClient,
      });

      const qaWorkflow = patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa");
      const codingWorkflow = patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "coding");

      expect(qaWorkflow?.status).toBe("COMPLETED");
      expect(qaWorkflow?.workflowResultPath).toMatch(/qa-prefetch-result\.json$/);
      expect(codingWorkflow?.status).toBe("NOT_STARTED");
      expect(portalClient.discoverArtifactsCalls).toBe(1);
      expect(portalClient.discoverArtifactWorkflowPhases).toEqual(["file_uploads_only"]);
      expect(patientRun.automationStepLogs.some((log) => log.step === "shared_portal_access")).toBe(true);
      expect(patientRun.automationStepLogs.some((log) => log.step === "shared_evidence_discovery_start")).toBe(true);
      expect(patientRun.automationStepLogs.some((log) => log.step === "oasis_episode_resolution")).toBe(true);
      expect(patientRun.automationStepLogs.some((log) => log.step === "billing_calendar_summary_persisted")).toBe(true);
      expect(patientRun.automationStepLogs.some((log) => log.step === "oasis_menu_open")).toBe(true);
      expect(patientRun.automationStepLogs.some((log) => log.step === "oasis_assessment_note_opened")).toBe(true);
      expect(patientRun.automationStepLogs.some((log) => log.step === "oasis_printed_note_review")).toBe(true);
      expect(patientRun.artifacts.find((artifact) => artifact.artifactType === "OASIS")).toMatchObject({
        artifactType: "OASIS",
        status: "DOWNLOADED",
        extractedFields: expect.objectContaining({
          reviewSource: "printed_note_ocr",
          extractionMethod: "visible_text_fallback",
        }),
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("skips patients when the live portal header shows Non-Admit or Pending", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const nonAdmitRun = await runQAForPatient({
        batchId: `${intake.manifest.batchId}-non-admit`,
        patient: intake.workItems[0]!,
        outputDir: path.join(fixture.outputDir, "non-admit"),
        portalClient: new PortalExcludedStatusClient("Non-Admit"),
      });

      expect(nonAdmitRun.processingStatus).toBe("BLOCKED");
      expect(nonAdmitRun.executionStep).toBe("PATIENT_STATUS_EXCLUDED");
      expect(nonAdmitRun.qaOutcome).toBe("PORTAL_MISMATCH");
      expect(nonAdmitRun.errorSummary).toContain("Portal patient status 'Non-Admit'");
      expect(nonAdmitRun.notes.some((note) => note.includes("Portal admission status evidence: Non-Admit"))).toBe(true);
      expect(nonAdmitRun.automationStepLogs.some((log) => log.step === "patient_status_gate")).toBe(true);
      expect(nonAdmitRun.workflowRuns.every((workflowRun) => workflowRun.status === "BLOCKED")).toBe(true);

      const pendingRun = await runQAForPatient({
        batchId: `${intake.manifest.batchId}-pending`,
        patient: intake.workItems[0]!,
        outputDir: path.join(fixture.outputDir, "pending"),
        portalClient: new PortalExcludedStatusClient("Pending"),
      });

      expect(pendingRun.processingStatus).toBe("BLOCKED");
      expect(pendingRun.executionStep).toBe("PATIENT_STATUS_EXCLUDED");
      expect(pendingRun.errorSummary).toContain("Portal patient status 'Pending'");
      expect(pendingRun.automationStepLogs.some((log) => log.step === "patient_status_gate")).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("supports coding and QA workflow runs coexisting for the same patient", async () => {
    const fixture = writeWorkbookFixture();
    const portalClient = new FakePortalClient();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const patientRun = await runQAForPatient({
        batchId: intake.manifest.batchId,
        patient: intake.workItems[0]!,
        outputDir: fixture.outputDir,
        workflowDomains: ["coding", "qa"],
        portalClient,
      });

      const codingWorkflow = patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "coding");
      const qaWorkflow = patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa");

      expect(codingWorkflow?.status).toBe("COMPLETED");
      expect(qaWorkflow?.status).toBe("COMPLETED");
      expect(codingWorkflow?.workflowResultPath).toMatch(/coding-input\.json$/);
      expect(qaWorkflow?.workflowResultPath).toMatch(/qa-prefetch-result\.json$/);
      expect(portalClient.discoverArtifactsCalls).toBe(1);
      expect(portalClient.discoverArtifactWorkflowPhases).toEqual(["file_uploads_only"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("defaults patient runs to both coding and QA workflows when no workflow domains are provided", async () => {
    const fixture = writeWorkbookFixture();
    const portalClient = new FakePortalClient();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const patientRun = await runQAForPatient({
        batchId: intake.manifest.batchId,
        patient: intake.workItems[0]!,
        outputDir: fixture.outputDir,
        portalClient,
      });

      const codingWorkflow = patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "coding");
      const qaWorkflow = patientRun.workflowRuns.find((workflowRun) => workflowRun.workflowDomain === "qa");

      expect(codingWorkflow?.status).toBe("COMPLETED");
      expect(qaWorkflow?.status).toBe("COMPLETED");
      expect(qaWorkflow?.workflowResultPath).toMatch(/qa-prefetch-result\.json$/);
      expect(patientRun.notes.some((note) => note.includes("QA prefetch result persisted:"))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
