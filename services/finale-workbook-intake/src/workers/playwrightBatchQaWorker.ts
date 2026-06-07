import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  OasisValidationResult,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PortalDomExtractedState,
  SubsidiaryRuntimeConfig,
  VisitNoteDiscoveryRow,
  VisitNoteProcessingManifest,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { OasisCalendarScopeResult } from "../qa/oasis/calendar/oasisCalendarTypes";
import type { FinaleBatchEnv } from "../config/env";
import { createPortalSession } from "../browser/context";
import type { OasisReadyDiagnosisDocument } from "../services/codingInputExportService";
import type { OasisExecutionActionPerformed } from "../services/oasisDiagnosisExecutionService";
import type { OasisInputActionPlan } from "../services/oasisInputActionPlanService";
import { LoginPage } from "../portal/pages/LoginPage";
import { PatientChartPage } from "../portal/pages/PatientChartPage";
import { PatientSearchPage } from "../portal/pages/PatientSearchPage";
import type { ReferralFileCaptureResult } from "../portal/services/chartDocumentCaptureService";
import { createAutomationStepLog } from "../portal/utils/automationLog";
import { gotoPortalPage } from "../portal/utils/portalNavigation";
import { diagnosePortalNetwork } from "../portal/utils/portalNetworkDiagnostics";
import type { ResolvedPatientPortalAccess } from "../portal/context/patientPortalContext";
import type { PortalDebugConfig } from "../portal/utils/locatorResolution";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";
import type { PatientPortalStatusPageMetadata } from "../portal/types/patientPortalStatus";
import { capturePageDebugArtifacts } from "../portal/utils/pageDiagnostics";
import { discoverVisitNotesFromPage } from "../portal/services/visitNotesDiscoveryService";
import {
  buildVisitNotesDiscoveryArtifact,
  VISIT_NOTES_DISCOVERY_FILE_NAME,
} from "../portal/services/visitNotesDiscoveryService";
import {
  isSafeVisitNoteOpenCandidate,
  persistVisitNoteCaptureResult,
} from "../portal/services/visitNoteCaptureService";
import { planControlledVisitNoteCapture } from "../portal/services/visitNotesControlledCaptureService";
import { extractOasisDomStateFromPage } from "../portal/domExtraction/oasisDomExtraction";
import { extractVisitNoteDomStateFromCurrentPage } from "../portal/domExtraction/visitNotesDomExtraction";
import { persistOasisDomAcquisitionArtifacts } from "../portal/domExtraction/oasisDomBridge";
import {
  mergeOasisDomAcquisitionState,
  readOasisDomAcquisitionState,
  writeOasisDomAcquisitionState,
} from "../portal/domExtraction/oasisDomAcquisitionState";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import { QaChartDiscoveryService } from "../qa/navigation/qaChartDiscoveryService";
import type { PatientPortalContext } from "../portal/context/patientPortalContext";
import type { QaPrefetchResult } from "../qa/types/qaPrefetchResult";
import type {
  OasisAssessmentNoteOpenResult,
  OasisPrintedNoteCaptureOpenResult,
  OasisMenuOpenResult,
} from "../oasis/types/oasisQaResult";
import {
  selectEpisodeRange,
  type EpisodeRangeSelectionTarget,
  type ResolvedEpisodeSelection,
} from "../oasis/navigation/episodeRangeDropdownService";
import type { BillingPeriodCalendarSummary } from "../oasis/types/billingPeriodCalendarSummary";
import { parseBillingPeriodCalendar } from "../oasis/calendar/billingPeriodCalendarParser";
import type { OasisPrintSectionProfileKey } from "../oasis/print/oasisPrintedNoteProfiles";
import { deriveOasisAssessmentTypeFromWorkItem } from "../oasis/navigation/oasisAssessmentDocumentMatching";

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function readFirstArtifactHash(directory: string, fileNames: string[]): Promise<string | undefined> {
  for (const fileName of fileNames) {
    const content = await readFile(path.join(directory, fileName), "utf8").catch(() => null);
    if (content?.trim()) {
      return hashString(content);
    }
  }
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function firstSafeVisitNoteAction(row: Locator): Promise<Locator | null> {
  const candidates = row.locator("a, button, [role='button'], [title], [aria-label]");
  const count = Math.min(await candidates.count().catch(() => 0), 20);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const labelParts = await Promise.all([
      candidate.innerText({ timeout: 500 }).catch(() => ""),
      candidate.getAttribute("aria-label").catch(() => ""),
      candidate.getAttribute("title").catch(() => ""),
      candidate.getAttribute("href").catch(() => ""),
    ]);
    const label = labelParts.filter(Boolean).join(" ");
    if (isSafeVisitNoteOpenCandidate(label)) {
      return candidate;
    }
  }
  return null;
}

async function captureVisitNoteRowReadOnly(input: {
  page: Page;
  row: VisitNoteDiscoveryRow;
  patientArtifactsDirectory: string;
  timeoutMs?: number;
  useDomExtraction?: boolean;
}): Promise<VisitNoteDiscoveryRow> {
  return withTimeout((async () => {
    const rowLocator = input.page.locator("table tbody tr, fin-datatable table tbody tr, .datatable-body-row, [role='row']");
    const row = rowLocator.nth(input.row.rowIndex ?? 0);
    const action = await firstSafeVisitNoteAction(row);
    if (!action) {
      await persistVisitNoteCaptureResult({
        patientArtifactsDirectory: input.patientArtifactsDirectory,
        row: input.row,
        captureStrategy: "unavailable",
        captureStatus: "failed",
        failureReason: "no_safe_read_only_action_found",
      });
      return { ...input.row, captureStatus: "failed", skipReason: "no_safe_read_only_action_found" };
    }

    const beforeUrl = input.page.url();
    const downloadPromise = input.page.waitForEvent("download", { timeout: 7_000 }).catch(() => null);
    const popupPromise = input.page.waitForEvent("popup", { timeout: 7_000 }).catch(() => null);
    await action.click({ timeout: 5_000 });
    const [download, popup] = await Promise.all([downloadPromise, popupPromise]);
    const targetPage = popup ?? input.page;
    await targetPage.waitForLoadState("domcontentloaded", { timeout: 7_000 }).catch(() => undefined);
    await targetPage.waitForTimeout(750).catch(() => undefined);

    if (download) {
      const noteDirectory = path.join(input.patientArtifactsDirectory, "documents", "visit-notes", input.row.visitNoteKey);
      await mkdir(noteDirectory, { recursive: true });
      const downloadPath = path.join(noteDirectory, `download${path.extname(download.suggestedFilename()) || ".bin"}`);
      await download.saveAs(downloadPath);
      const body = await readFile(downloadPath);
      const isPdf = /\.pdf$/i.test(download.suggestedFilename());
      await persistVisitNoteCaptureResult({
        patientArtifactsDirectory: input.patientArtifactsDirectory,
        row: input.row,
        ...(isPdf ? { sourcePdf: body } : { sourceText: body.toString("utf8") }),
        captureStrategy: isPdf ? "pdf_export" : "source_text",
        captureStatus: "captured",
        sourceUrl: beforeUrl,
      });
    } else {
      const [sourceHtml, bodyText, domState] = await Promise.all([
        targetPage.content().catch(() => ""),
        targetPage.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
        input.useDomExtraction === false
          ? Promise.resolve(null)
          : extractVisitNoteDomStateFromCurrentPage({ page: targetPage }).catch(() => null),
      ]);
      const sourceText = domState?.textDigest?.trim() || bodyText;
      const persisted = await persistVisitNoteCaptureResult({
        patientArtifactsDirectory: input.patientArtifactsDirectory,
        row: input.row,
        sourceHtml,
        sourceText,
        captureStrategy: sourceHtml ? "html_text" : "source_text",
        captureStatus: sourceText.trim() || sourceHtml.trim() ? "captured" : "failed",
        sourceUrl: targetPage.url(),
        failureReason: sourceText.trim() || sourceHtml.trim() ? null : "empty_visit_note_viewer",
      });
      if (domState) {
        await writeFile(
          path.join(persisted.noteDirectory, "dom-extracted-state.json"),
          JSON.stringify(domState, null, 2),
          "utf8",
        ).catch(() => undefined);
      }
    }

    if (popup) {
      await popup.close().catch(() => undefined);
    } else if (input.page.url() !== beforeUrl) {
      await input.page.goBack({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => undefined);
    } else {
      await input.page.keyboard.press("Escape").catch(() => undefined);
    }
    return { ...input.row, captureStatus: "captured" };
  })(), input.timeoutMs ?? 45_000, "capture_timeout");
}

export interface BatchPortalAutomationClient {
  initialize(outputDir?: string): Promise<void>;
  resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess>;
  resolvePatient(workItem: PatientEpisodeWorkItem, evidenceDir?: string): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }>;
  discoverArtifacts(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options?: {
      workflowPhase?: "full_discovery" | "file_uploads_only" | "oasis_diagnosis_only";
      oasisReadyDiagnosis?: OasisReadyDiagnosisDocument | null;
      oasisReadyDiagnosisPath?: string | null;
      patientArtifactsDirectory?: string | null;
      captureRelevantUploadLimit?: number;
    },
  ): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
    oasisLockState?: OasisLockStateSnapshot | null;
    diagnosisPageSnapshot?: OasisDiagnosisPageSnapshot | null;
    calendarScope?: OasisCalendarScopeResult | null;
    calendarScopePath?: string | null;
  }>;
  captureReferralFiles?(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options: {
      patientArtifactsDirectory: string;
      captureRelevantUploadLimit?: number;
      batchId: string;
    },
  ): Promise<ReferralFileCaptureResult>;
  readPatientPortalStatus?(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
  ): Promise<PatientPortalStatusPageMetadata>;
  debugFileUploadsDiscovery?(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options: {
      patientArtifactsDirectory: string;
      captureRelevantUploadLimit?: number;
      probeFileUploadActions?: boolean;
      discoverFileUploadInteractions?: boolean;
      probeFileUploadRowOpen?: boolean;
    },
  ): Promise<{
    discoveryPath: string | null;
    actionDiscoveryPath: string | null;
    actionProbePath: string | null;
    interactionDiscoveryPath: string | null;
    interactionProbePath: string | null;
    catalogPath: string;
    artifactLineagePath: string;
    summary: {
      totalRows: number;
      sourceContainerSelectorUsed: string | null;
      paginationDetected: boolean;
      virtualScrollDetected: boolean;
      rowTypeCounts: Record<string, number>;
      relevanceCounts: Record<string, number>;
      eligibleForCapture: number;
      capturedCount: number;
      cacheHitCount: number;
      skippedReasons: Record<string, number>;
      safeActionRows: number;
      detectedActionCount: number;
      probeResultCounts: Record<string, number>;
      capturePossibleCount: number;
      interactionStrategyCounts: Record<string, number>;
      interactionNetworkEndpointCount: number;
      interactionProbeResultCounts: Record<string, number>;
      rowSelectionExperimentCount: number;
    };
    stepLogs: AutomationStepLog[];
  }>;
  executeOasisDiagnosisActionPlan(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options: {
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
  }>;
  runQaPrefetchDiscovery(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
  }): Promise<{
    result: QaPrefetchResult;
    stepLogs: AutomationStepLog[];
  }>;
  openOasisMenuForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
  }): Promise<{
    result: OasisMenuOpenResult;
    stepLogs: AutomationStepLog[];
  }>;
  selectEpisodeRangeForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    target?: EpisodeRangeSelectionTarget | null;
  }): Promise<{
    result: ResolvedEpisodeSelection;
    stepLogs: AutomationStepLog[];
  }>;
  extractBillingPeriodCalendarSummaryForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    selectedEpisode: EpisodeRangeSelectionTarget | null;
  }): Promise<{
    result: BillingPeriodCalendarSummary;
    summaryPath: string;
    stepLogs: AutomationStepLog[];
  }>;
  openOasisAssessmentNoteForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType: string;
  }): Promise<{
    result: OasisAssessmentNoteOpenResult;
    stepLogs: AutomationStepLog[];
  }>;
  captureOasisPrintedNoteForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType: string;
    matchedAssessmentLabel?: string | null;
    printProfileKey?: OasisPrintSectionProfileKey | null;
  }): Promise<{
    result: OasisPrintedNoteCaptureOpenResult;
    stepLogs: AutomationStepLog[];
  }>;
  extractOasisDomForReview?(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    outputDir: string;
    patientArtifactsDirectory?: string;
    thresholds?: {
      minFieldCount?: number;
      minNonEmptyFieldCount?: number;
    };
  }): Promise<{
    state: PortalDomExtractedState;
    acquisitionState: import("@medical-ai-qa/shared-types").OasisDomAcquisitionState;
    domStatePath: string;
    acquisitionStatePath: string;
    bridgeTextPath: string;
    comparisonPath: string;
    recommendedDecision: string;
    stepLogs: AutomationStepLog[];
  }>;
  validateOasisAssessmentForReview?(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType?: string;
    oasisAssessmentStatus?: OasisAssessmentNoteOpenResult["oasisAssessmentStatus"];
  }): Promise<{
    result: OasisValidationResult;
    stepLogs: AutomationStepLog[];
  }>;
  discoverVisitNotesForReview?(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    patientArtifactsDirectory: string;
    evidenceDir: string;
    episode?: {
      label?: string;
      startDate?: string;
      endDate?: string;
    };
    captureVisitNotesLimit?: number;
    forceRerunVisitNotes?: boolean;
    probeVisitNoteActions?: boolean;
    debug?: boolean;
  }): Promise<{
    discoveryPath: string;
    stepLogs: AutomationStepLog[];
  }>;
  captureFailureArtifacts(workItemId: string, outputDir: string): Promise<{
    tracePath: string | null;
    screenshotPaths: string[];
    downloadPaths: string[];
  }>;
  dispose(): Promise<void>;
}

type DashboardBootstrapResult = {
  ready: boolean;
  dashboardUrl: string | null;
  patientLookupEntryContext: "current_page_global_search" | "dashboard_reset_then_global_search";
  fallbackDashboardResetRequired: boolean;
  stepLogs: AutomationStepLog[];
  blockReason?: string;
};

export class PlaywrightBatchQaWorker implements BatchPortalAutomationClient {
  private session: Awaited<ReturnType<typeof createPortalSession>> | null = null;
  private pendingInitializationStepLogs: AutomationStepLog[] = [];
  private batchOutputDir: string | null = null;
  private currentDebugDir: string | null = null;
  private dashboardUrl: string | null = null;
  private currentPatientChartUrl: string | null = null;
  private readonly debugConfig: PortalDebugConfig;

  constructor(
    private readonly runtimeConfig: SubsidiaryRuntimeConfig,
    private readonly env: FinaleBatchEnv,
    private readonly logger: Logger,
  ) {
    this.debugConfig = {
      debugSelectors: env.PORTAL_DEBUG_SELECTORS ?? false,
      saveDebugHtml: env.PORTAL_SAVE_DEBUG_HTML ?? false,
      pauseOnFailure: env.PORTAL_PAUSE_ON_FAILURE ?? false,
      stepTimeoutMs: env.PORTAL_ACTION_TIMEOUT_MS,
      navigationTimeoutMs: env.PORTAL_NAVIGATION_TIMEOUT_MS,
      navigationRetries: env.PORTAL_NAVIGATION_RETRIES,
      debugScreenshots: env.PORTAL_DEBUG_SCREENSHOTS ?? true,
      selectorRetryCount: env.PORTAL_SELECTOR_RETRY_COUNT,
    };
  }

  private async ensurePatientChartContextForOasis(input: {
    context: PatientPortalContext;
    workItem?: PatientEpisodeWorkItem;
    evidenceDir: string;
    reason: string;
  }): Promise<{
    success: boolean;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    const chartUrl = this.currentPatientChartUrl ?? input.context.chartUrl;
    if (!chartUrl) {
      return {
        success: false,
        stepLogs: [createAutomationStepLog({
          step: "patient_chart_context_check",
          message: "Cannot restore patient chart context because no chart URL is available.",
          urlBefore: this.session.page.url(),
          urlAfter: this.session.page.url(),
          patientName: input.workItem?.patientIdentity.displayName,
          missing: ["patient chart URL"],
          evidence: [
            `reason:${input.reason}`,
            `patientKey:${input.workItem?.id ?? "unknown"}`,
          ],
          safeReadConfirmed: true,
        })],
      };
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    const recovery = await patientChartPage.ensurePatientChartContextForOasis({
      chartUrl,
      reason: input.reason,
      patientKey: input.workItem?.id ?? input.context.patientId ?? null,
    });
    return {
      success: recovery.success,
      stepLogs: recovery.stepLogs,
    };
  }

  async initialize(outputDir?: string): Promise<void> {
    this.batchOutputDir = outputDir ? path.resolve(outputDir) : null;
    const networkDiagnostic = await diagnosePortalNetwork({
      portalUrl: this.runtimeConfig.portalBaseUrl,
      timeoutMs: Math.min(this.env.PORTAL_NAVIGATION_TIMEOUT_MS, 10_000),
    });
    this.logger.info(
      {
        subsidiaryId: this.runtimeConfig.subsidiaryId,
        subsidiaryName: this.runtimeConfig.subsidiaryName,
        portalUrl: networkDiagnostic.url,
        portalHost: networkDiagnostic.host,
        dnsResolved: networkDiagnostic.dnsResolved,
        httpsReachable: networkDiagnostic.httpsReachable,
        statusCode: networkDiagnostic.statusCode,
        latencyMs: networkDiagnostic.latencyMs,
        errorCategory: networkDiagnostic.errorCategory,
      },
      "completed pre-login Finale portal network diagnostic",
    );

    if (!networkDiagnostic.dnsResolved || !networkDiagnostic.httpsReachable) {
      throw new Error(
        `Portal startup failed before browser launch. stage=portal_navigation; errorCategory=${networkDiagnostic.errorCategory ?? "portal_network_unreachable"}; retryable=true; message=Finale portal network diagnostic failed for ${networkDiagnostic.url}.`,
      );
    }

    this.session = await createPortalSession(this.env);
    await this.session.context.tracing.start({
      screenshots: true,
      snapshots: true,
    });

    const debugDir = this.batchOutputDir ? path.join(this.batchOutputDir, "debug", "session") : undefined;
    const loginPage = new LoginPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir,
    });
    const loginStepLogs = await loginPage.ensureLoggedIn({
      baseUrl: this.runtimeConfig.portalBaseUrl,
      username: this.runtimeConfig.credentials.username,
      password: this.runtimeConfig.credentials.password,
    });
    this.dashboardUrl = this.resolveDashboardUrl({
      configuredDashboardUrl: this.runtimeConfig.portalDashboardUrl ?? undefined,
      currentUrl: this.session.page.url(),
    });
    this.logger.info(
      {
        subsidiaryId: this.runtimeConfig.subsidiaryId,
        subsidiaryName: this.runtimeConfig.subsidiaryName,
        configuredDashboardUrl: this.runtimeConfig.portalDashboardUrl ?? null,
        currentUrlAfterLogin: this.session.page.url(),
        dashboardUrlResolvedAtInit: this.dashboardUrl,
      },
      "resolved dashboard reset URL after login",
    );

    this.pendingInitializationStepLogs = [
      ...loginStepLogs,
      createAutomationStepLog({
        step: "playwright_session",
        message: "Initialized Playwright session for active workbook-driven QA flow.",
        urlBefore: this.runtimeConfig.portalBaseUrl,
        urlAfter: this.session.page.url(),
        found: [this.session.page.url()],
        evidence: [
          `subsidiaryId=${this.runtimeConfig.subsidiaryId}`,
          `debugSelectors=${this.debugConfig.debugSelectors}`,
          `saveDebugHtml=${this.debugConfig.saveDebugHtml}`,
          `pauseOnFailure=${this.debugConfig.pauseOnFailure}`,
          `stepTimeoutMs=${this.debugConfig.stepTimeoutMs}`,
          `navigationTimeoutMs=${this.debugConfig.navigationTimeoutMs ?? "unset"}`,
          `navigationRetries=${this.debugConfig.navigationRetries ?? "unset"}`,
          `selectorRetryCount=${this.debugConfig.selectorRetryCount}`,
          `configuredDashboardUrl=${this.runtimeConfig.portalDashboardUrl ?? "unset"}`,
          `dashboardResetUrl=${this.dashboardUrl ?? "unresolved"}`,
        ],
        safeReadConfirmed: true,
      }),
    ];
  }

  private async ensureUsableSessionPage(
    workItem: PatientEpisodeWorkItem,
    reason: string,
  ): Promise<AutomationStepLog[]> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    if (!this.session.page.isClosed()) {
      return [];
    }

    const urlBefore = this.session.page.url();
    try {
      const openPage = this.session.context.pages().find((candidate) => !candidate.isClosed());
      this.session.page = openPage ?? await this.session.context.newPage();
      this.logger.warn(
        {
          workItemId: workItem.id,
          subsidiaryId: this.runtimeConfig.subsidiaryId,
          recoveryReason: reason,
          recoveredUrl: this.session.page.url(),
        },
        "recovered closed Playwright page before patient workflow",
      );
      return [
        createAutomationStepLog({
          step: "playwright_session_recovery",
          message: "Recovered a closed portal page before continuing the patient workflow.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore,
          urlAfter: this.session.page.url(),
          found: ["open browser context"],
          evidence: [`recoveryReason=${reason}`],
          safeReadConfirmed: true,
        }),
      ];
    } catch (error) {
      this.logger.warn(
        {
          workItemId: workItem.id,
          subsidiaryId: this.runtimeConfig.subsidiaryId,
          recoveryReason: reason,
          errorMessage: error instanceof Error ? error.message : "Unknown page recovery error.",
        },
        "reinitializing Playwright session after closed page recovery failed",
      );
      await this.dispose().catch(() => undefined);
      await this.initialize(this.batchOutputDir ?? undefined);
      if (!this.session) {
        throw new Error("Playwright session reinitialization did not produce a usable session.");
      }
      return [
        createAutomationStepLog({
          step: "playwright_session_recovery",
          message: "Reinitialized the portal browser session after the previous page/context was closed.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore,
          urlAfter: this.session.page.url(),
          found: ["new browser session"],
          evidence: [`recoveryReason=${reason}`],
          safeReadConfirmed: true,
        }),
      ];
    }
  }

  async resolvePatient(workItem: PatientEpisodeWorkItem, evidenceDir?: string): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    const recoveryStepLogs = await this.ensureUsableSessionPage(workItem, "before_patient_lookup");
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    const session = this.session;

    this.logger.info(
      { workItemId: workItem.id, subsidiaryId: this.runtimeConfig.subsidiaryId },
      "matching patient",
    );
    this.currentDebugDir = evidenceDir ? path.join(evidenceDir, "debug") : null;
    const buildPatientSearchPage = () => new PatientSearchPage(session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir ?? undefined,
    });
    let patientSearchPage = buildPatientSearchPage();
    const initializationLogs = this.pendingInitializationStepLogs;
    this.pendingInitializationStepLogs = [];
    const currentUrlBeforePatientLookup = session.page.url();
    const bootstrap = await this.bootstrapDashboardContextForPatientLookup({
      workItem,
      patientSearchPage,
      currentUrlBeforePatientLookup,
      initializationLogs,
    });
    const orchestrationStepLogs: AutomationStepLog[] = [...recoveryStepLogs, ...bootstrap.stepLogs];
    let fallbackDashboardResetRequired = bootstrap.fallbackDashboardResetRequired;
    let patientLookupEntryContext = bootstrap.patientLookupEntryContext;
    const dashboardUrl = bootstrap.dashboardUrl;

    if (!bootstrap.ready) {
      return {
        matchResult: {
          status: "ERROR",
          searchQuery: workItem.patientIdentity.displayName,
          portalPatientId: null,
          portalDisplayName: null,
          candidateNames: [],
          note: bootstrap.blockReason ?? "dashboard_context_not_established",
        },
        stepLogs: orchestrationStepLogs,
      };
    }

    let result = await patientSearchPage.resolvePatient(workItem);
    if (result.matchResult.status === "ERROR" && !fallbackDashboardResetRequired) {
      session.page = result.activePage;
      patientSearchPage = buildPatientSearchPage();
      patientLookupEntryContext = "dashboard_reset_then_global_search";
      fallbackDashboardResetRequired = true;
      this.logger.warn(
        {
          workItemId: workItem.id,
          currentUrlBeforePatientLookup,
          currentUrlAfterFailedCurrentPageLookup: session.page.url(),
          patientLookupMethod: "global_dashboard_search_only",
          patientLookupEntryContext: "current_page_global_search",
        },
        "global patient search failed from the current page context; retrying once after dashboard reset",
      );

      orchestrationStepLogs.push(
        createAutomationStepLog({
          step: "patient_lookup_entry",
          message: "Global patient search failed from the current page context, so the workflow is retrying once after dashboard reset.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore: currentUrlBeforePatientLookup,
          urlAfter: session.page.url(),
          found: ["current_page_global_search"],
          evidence: [
            `Patient lookup method: global_dashboard_search_only`,
            `Patient lookup entry context: current_page_global_search`,
            `Current URL after failed current-page lookup: ${session.page.url()}`,
          ],
          safeReadConfirmed: true,
        }),
      );

      const dashboardReset = await this.runFallbackDashboardReset({
        patientSearchPage,
        workItem,
        dashboardUrl,
        currentUrlBeforePatientLookup: session.page.url(),
        globalSearchAvailableInCurrentContext: false,
        fallbackReason: "global_search_failed_from_current_context",
      });
      orchestrationStepLogs.push(...dashboardReset.stepLogs);
      if (!dashboardReset.ready) {
        return {
          matchResult: {
            status: "ERROR",
            searchQuery: workItem.patientIdentity.displayName,
            portalPatientId: null,
            portalDisplayName: null,
            candidateNames: [],
            note: "dashboard_context_not_established: global_search_failed_from_current_context",
          },
          stepLogs: [
            ...orchestrationStepLogs,
            ...result.stepLogs,
          ],
        };
      }

      result = await patientSearchPage.resolvePatient(workItem);
    }

    this.logger.info(
      {
        workItemId: workItem.id,
        patientLookupMethod: "global_dashboard_search_only",
        patientLookupEntryContext,
        currentUrlBeforePatientLookup,
        globalSearchAvailableBeforePatientLookup: true,
        fallbackDashboardResetRequired,
        fallbackDashboardResetTargetUrl: fallbackDashboardResetRequired ? dashboardUrl ?? null : null,
        currentUrlAfterPatientLookup: result.activePage.url(),
        matchStatus: result.matchResult.status,
        matchedPatient: result.matchResult.portalDisplayName,
      },
      "patient lookup completed through global dashboard search",
    );
    session.page = result.activePage;
    this.currentPatientChartUrl = result.matchResult.status === "EXACT"
      ? result.activePage.url()
      : null;

    return {
      matchResult: result.matchResult,
      stepLogs: [
        ...orchestrationStepLogs,
        ...result.stepLogs,
      ],
    };
  }

  async resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess> {
    const resolvedAt = new Date().toISOString();
    const patientResolution = await this.resolvePatient(input.workItem, input.evidenceDir);
    let portalAdmissionStatus: string | null = null;

    if (patientResolution.matchResult.status === "EXACT" && this.session) {
      const patientChartPage = new PatientChartPage(this.session.page, {
        logger: this.logger,
        debugConfig: this.debugConfig,
        debugDir: this.currentDebugDir ?? undefined,
      });
      const statusProbe = await patientChartPage.readPatientAdmissionStatus();
      portalAdmissionStatus = statusProbe.statusLabel;
      patientResolution.stepLogs.push(...statusProbe.stepLogs);
    }

    return {
      patientName: input.workItem.patientIdentity.displayName,
      patientId: patientResolution.matchResult.portalPatientId,
      chartUrl:
        patientResolution.matchResult.status === "EXACT"
          ? this.currentPatientChartUrl
          : null,
      dashboardUrl: this.dashboardUrl,
      resolvedAt:
        patientResolution.matchResult.status === "EXACT" && this.currentPatientChartUrl
          ? resolvedAt
          : null,
      portalAdmissionStatus,
      traceId: `${input.batchId}:${input.patientRunId}`,
      matchResult: patientResolution.matchResult,
      stepLogs: patientResolution.stepLogs,
    };
  }

  async discoverArtifacts(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options?: {
      workflowPhase?: "full_discovery" | "file_uploads_only" | "oasis_diagnosis_only";
      oasisReadyDiagnosis?: OasisReadyDiagnosisDocument | null;
      oasisReadyDiagnosisPath?: string | null;
      patientArtifactsDirectory?: string | null;
      captureRelevantUploadLimit?: number;
    },
  ): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
    oasisLockState?: OasisLockStateSnapshot | null;
    diagnosisPageSnapshot?: OasisDiagnosisPageSnapshot | null;
    calendarScope?: OasisCalendarScopeResult | null;
    calendarScopePath?: string | null;
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.logger.info(
      { workItemId: workItem.id, subsidiaryId: this.runtimeConfig.subsidiaryId },
      "discovering chart artifacts",
    );
    this.currentDebugDir = path.join(evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.discoverArtifacts(evidenceDir, {
      workflowPhase: options?.workflowPhase,
      patientChartUrl: this.currentPatientChartUrl,
      oasisReadyDiagnosis: options?.oasisReadyDiagnosis,
      oasisReadyDiagnosisPath: options?.oasisReadyDiagnosisPath,
      assessmentType: deriveOasisAssessmentTypeFromWorkItem(workItem),
      patientId: workItem.id,
      patientArtifactsDirectory: options?.patientArtifactsDirectory,
      captureRelevantUploadLimit: options?.captureRelevantUploadLimit,
    });
  }

  async captureReferralFiles(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options: {
      patientArtifactsDirectory: string;
      captureRelevantUploadLimit?: number;
      batchId: string;
    },
  ): Promise<ReferralFileCaptureResult> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    if (!this.currentPatientChartUrl) {
      throw new Error("Patient chart URL was not resolved before referral file capture.");
    }

    this.logger.info(
      { workItemId: workItem.id, subsidiaryId: this.runtimeConfig.subsidiaryId },
      "capturing patient referral files from File Uploads",
    );
    this.currentDebugDir = path.join(evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.captureReferralFiles(options.patientArtifactsDirectory, {
      batchId: options.batchId,
      patientId: workItem.id,
      patientChartUrl: this.currentPatientChartUrl,
      captureRelevantUploadLimit: options.captureRelevantUploadLimit,
    });
  }

  async readPatientPortalStatus(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
  ): Promise<PatientPortalStatusPageMetadata> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.logger.info(
      { workItemId: workItem.id, subsidiaryId: this.runtimeConfig.subsidiaryId },
      "reading patient portal status metadata",
    );
    this.currentDebugDir = path.join(evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.readPatientPortalStatusMetadata({
      chartUrl: this.currentPatientChartUrl,
    });
  }

  async debugFileUploadsDiscovery(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options: {
      patientArtifactsDirectory: string;
      captureRelevantUploadLimit?: number;
      probeFileUploadActions?: boolean;
      discoverFileUploadInteractions?: boolean;
      probeFileUploadRowOpen?: boolean;
    },
  ): Promise<{
    discoveryPath: string | null;
    actionDiscoveryPath: string | null;
    actionProbePath: string | null;
    interactionDiscoveryPath: string | null;
    interactionProbePath: string | null;
    catalogPath: string;
    artifactLineagePath: string;
    summary: {
      totalRows: number;
      sourceContainerSelectorUsed: string | null;
      paginationDetected: boolean;
      virtualScrollDetected: boolean;
      rowTypeCounts: Record<string, number>;
      relevanceCounts: Record<string, number>;
      eligibleForCapture: number;
      capturedCount: number;
      cacheHitCount: number;
      skippedReasons: Record<string, number>;
      safeActionRows: number;
      detectedActionCount: number;
      probeResultCounts: Record<string, number>;
      capturePossibleCount: number;
      interactionStrategyCounts: Record<string, number>;
      interactionNetworkEndpointCount: number;
      interactionProbeResultCounts: Record<string, number>;
      rowSelectionExperimentCount: number;
    };
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    if (!this.currentPatientChartUrl) {
      throw new Error("Patient chart URL is not available; resolve patient portal access before File Uploads debug discovery.");
    }

    this.currentDebugDir = path.join(evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return (patientChartPage as any).debugFileUploadsDiscovery({
      chartUrl: this.currentPatientChartUrl,
      evidenceDirectory: evidenceDir,
      patientArtifactsDirectory: options.patientArtifactsDirectory,
      patientId: workItem.id,
      captureRelevantUploadLimit: options.captureRelevantUploadLimit,
      probeFileUploadActions: options.probeFileUploadActions,
      discoverFileUploadInteractions: options.discoverFileUploadInteractions,
      probeFileUploadRowOpen: options.probeFileUploadRowOpen,
    });
  }

  async executeOasisDiagnosisActionPlan(
    _workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options: {
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
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.executeOasisDiagnosisActionPlan({
      chartUrl: this.currentPatientChartUrl,
      actionPlan: options.actionPlan,
      lockState: options.lockState,
      writeEnabled: options.writeEnabled,
      initialSnapshot: options.initialSnapshot,
    });
  }

  async runQaPrefetchDiscovery(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
  }): Promise<{
    result: QaPrefetchResult;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const service = new QaChartDiscoveryService({
      page: this.session.page,
      context: input.context,
      logger: this.logger,
    });

    return service.discover();
  }

  async openOasisMenuForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
  }): Promise<{
    result: OasisMenuOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.openOasisMenuForReview({
      chartUrl: this.currentPatientChartUrl ?? input.context.chartUrl,
      patientKey: input.workItem.id,
    });
  }

  async openOasisAssessmentNoteForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType: string;
  }): Promise<{
    result: OasisAssessmentNoteOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.openOasisAssessmentNoteForReview({
      chartUrl: this.currentPatientChartUrl ?? input.context.chartUrl,
      assessmentType: input.assessmentType,
      patientKey: input.workItem.id,
    });
  }

  async captureOasisPrintedNoteForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType: string;
    matchedAssessmentLabel?: string | null;
    printProfileKey?: OasisPrintSectionProfileKey | null;
  }): Promise<{
    result: OasisPrintedNoteCaptureOpenResult;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return patientChartPage.captureOasisPrintedNoteForReview({
      chartUrl: this.currentPatientChartUrl ?? input.context.chartUrl,
      evidenceDir: input.evidenceDir,
      assessmentType: input.assessmentType,
      patientKey: input.workItem.id,
      matchedAssessmentLabel: input.matchedAssessmentLabel,
      printProfileKey: input.printProfileKey,
    });
  }

  async extractOasisDomForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    outputDir: string;
    patientArtifactsDirectory?: string;
    thresholds?: {
      minFieldCount?: number;
      minNonEmptyFieldCount?: number;
    };
  }): Promise<{
    state: PortalDomExtractedState;
    acquisitionState: import("@medical-ai-qa/shared-types").OasisDomAcquisitionState;
    domStatePath: string;
    acquisitionStatePath: string;
    bridgeTextPath: string;
    comparisonPath: string;
    recommendedDecision: string;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    const extraction = await extractOasisDomStateFromPage({
      page: this.session.page,
      debugConfig: this.debugConfig,
      thresholds: {
        minFieldCount: input.thresholds?.minFieldCount,
        minNonEmptyFieldCount: input.thresholds?.minNonEmptyFieldCount,
      },
    });
    const patientArtifactsDirectory = input.patientArtifactsDirectory ??
      path.join(input.outputDir, "patients", input.workItem.id);
    const previousAcquisitionState = await readOasisDomAcquisitionState(patientArtifactsDirectory);
    const acquisitionState = mergeOasisDomAcquisitionState(previousAcquisitionState, extraction.state, {
      patientRunId: input.context.patientRunId,
      patientId: input.workItem.id,
      sourceKey: extraction.state.diagnostics.routePattern,
      ocrFallbackEnabled: this.env.OCR_FALLBACK_ENABLED,
      minFieldCount: input.thresholds?.minFieldCount,
      minNonEmptyFieldCount: input.thresholds?.minNonEmptyFieldCount,
    });
    const persisted = await persistOasisDomAcquisitionArtifacts({
      state: extraction.state,
      patientArtifactsDirectory,
      patientCase: input.context.patientRunId,
    });
    const acquisitionStatePath = await writeOasisDomAcquisitionState({
      patientArtifactsDirectory,
      state: acquisitionState,
    });
    const stepLogs = [
      createAutomationStepLog({
        step: "oasis_dom_extraction",
        message: "Persisted read-only OASIS DOM extraction and incremental acquisition state artifacts.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.context.chartUrl,
        urlAfter: this.session.page.url(),
        found: [
          `sectionCount=${extraction.state.coverage.sectionCount}`,
          `fieldCount=${extraction.state.coverage.fieldCount}`,
          `nonEmptyFieldCount=${extraction.state.coverage.nonEmptyFieldCount}`,
          `tableCount=${extraction.state.coverage.tableCount}`,
          `fallbackRecommended=${extraction.state.coverage.fallbackRecommended}`,
          `acquisitionStatus=${acquisitionState.acquisitionStatus}`,
          `overallContentHash=${acquisitionState.overallContentHash}`,
          `recommendedDecision=${persisted.comparison.recommendedDecision}`,
        ],
        missing: acquisitionState.acquisitionStatus === "ready_for_qa" || acquisitionState.acquisitionStatus === "qa_completed"
          ? []
          : [
              ...acquisitionState.missingRequiredSections.map((section) => `section:${section}`),
              ...acquisitionState.readinessReasons,
            ].slice(0, 12),
        evidence: [
          `domStatePath=${persisted.domStatePath}`,
          `acquisitionStatePath=${acquisitionStatePath}`,
          `bridgeTextPath=${persisted.bridgeTextPath}`,
          `comparisonPath=${persisted.comparisonPath}`,
          `optionLabels=${extraction.optionLabels.join(" | ") || "none"}`,
          `skippedDeferredSections=${extraction.skippedDeferredSections.join(" | ") || "none"}`,
          `changedFields=${acquisitionState.changedFields.length}`,
          `regressedFields=${acquisitionState.regressedFields.length}`,
          ...extraction.state.coverage.fallbackReasons.slice(0, 8),
        ],
        safeReadConfirmed: true,
      }),
    ];

    return {
      state: extraction.state,
      acquisitionState,
      domStatePath: persisted.domStatePath,
      acquisitionStatePath,
      bridgeTextPath: persisted.bridgeTextPath,
      comparisonPath: persisted.comparisonPath,
      recommendedDecision: persisted.comparison.recommendedDecision,
      stepLogs,
    };
  }

  async validateOasisAssessmentForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    assessmentType?: string;
    oasisAssessmentStatus?: OasisAssessmentNoteOpenResult["oasisAssessmentStatus"];
  }): Promise<{
    result: OasisValidationResult;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const patientChartPage = new PatientChartPage(this.session.page, {
      logger: this.logger,
      debugConfig: this.debugConfig,
      debugDir: this.currentDebugDir,
    });
    return (patientChartPage as any).validateOasisAssessmentForReview({
      chartUrl: this.currentPatientChartUrl ?? input.context.chartUrl,
      assessmentType: input.assessmentType,
      patientKey: input.workItem.id,
      oasisAssessmentStatus: input.oasisAssessmentStatus,
    });
  }

  async discoverVisitNotesForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    patientArtifactsDirectory: string;
    evidenceDir: string;
    episode?: {
      label?: string;
      startDate?: string;
      endDate?: string;
    };
    captureVisitNotesLimit?: number;
    forceRerunVisitNotes?: boolean;
    probeVisitNoteActions?: boolean;
    debug?: boolean;
  }): Promise<{
    discoveryPath: string;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const discoveryRecovery = await this.ensurePatientChartContextForOasis({
      context: input.context,
      workItem: input.workItem,
      evidenceDir: input.evidenceDir,
      reason: "restore_patient_chart_before_visit_notes_discovery",
    });
    if (!discoveryRecovery.success) {
      const artifact = buildVisitNotesDiscoveryArtifact({
        patientKeyHash: input.workItem.id,
        episode: input.episode,
        pageUrl: this.session.page.url(),
        rows: [],
        warnings: [
          "Visit Notes discovery skipped because patient chart context could not be restored.",
        ],
      });
      const discoveryPath = path.join(input.patientArtifactsDirectory, VISIT_NOTES_DISCOVERY_FILE_NAME);
      await mkdir(path.dirname(discoveryPath), { recursive: true });
      await writeFile(discoveryPath, JSON.stringify(artifact, null, 2), "utf8");
      return {
        discoveryPath,
        stepLogs: [
          ...discoveryRecovery.stepLogs,
          createAutomationStepLog({
            step: "visit_notes_discovery",
            message: "Skipped Visit Notes discovery because patient chart context recovery failed.",
            patientName: input.workItem.patientIdentity.displayName,
            urlBefore: input.context.chartUrl,
            urlAfter: this.session.page.url(),
            found: [`visitNotesDiscoveryPath=${discoveryPath}`],
            missing: ["patient chart route", "Visit Notes rows"],
            evidence: artifact.warnings,
            safeReadConfirmed: true,
          }),
        ],
      };
    }

    const visitNotesChartUrl = this.currentPatientChartUrl ?? input.context.chartUrl;
    if (visitNotesChartUrl && this.session.page.url() !== visitNotesChartUrl) {
      const urlBeforeRestore = this.session.page.url();
      await this.session.page.goto(visitNotesChartUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
      await this.session.page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      await this.session.page.waitForTimeout(750).catch(() => undefined);
      discoveryRecovery.stepLogs.push(createAutomationStepLog({
        step: "visit_notes_chart_context_restore",
        message: "Restored the base patient chart route before Visit Notes sidebar discovery.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: urlBeforeRestore,
        urlAfter: this.session.page.url(),
        found: [`targetChartUrl=${visitNotesChartUrl}`],
        evidence: ["visit_notes_sidebar_discovery_requires_base_patient_chart_context"],
        safeReadConfirmed: true,
      }));
    }

    const discovery = await discoverVisitNotesFromPage({
      page: this.session.page,
      patientKeyHash: input.workItem.id,
      patientName: input.workItem.patientIdentity.displayName,
      patientArtifactsDirectory: input.patientArtifactsDirectory,
      episode: input.episode,
      logger: this.logger,
    });
    const previousManifest = await readJsonIfExists<VisitNoteProcessingManifest>(
      path.join(input.patientArtifactsDirectory, "visit-note-processing-manifest.json"),
    );
    const planOfCareHash = await readFirstArtifactHash(input.patientArtifactsDirectory, [
      "plan-of-care-review-draft.json",
      "generated-plan-of-care.json",
    ]);
    const oasisFactPackHash = await readFirstArtifactHash(input.patientArtifactsDirectory, [
      "oasis-clinical-fact-pack.json",
      "oasis-validation-result.json",
    ]);
    const capturePlan = planControlledVisitNoteCapture({
      discovery: discovery.artifact,
      captureVisitNotesLimit: input.captureVisitNotesLimit,
      forceRerunVisitNotes: input.forceRerunVisitNotes,
      previousManifest,
      currentPlanOfCareHash: planOfCareHash,
      currentOasisFactPackHash: oasisFactPackHash,
    });
    const capturedRows: VisitNoteDiscoveryRow[] = [];
    const captureStepLogs: AutomationStepLog[] = [...discoveryRecovery.stepLogs];
    for (const row of capturePlan.rows) {
      const shouldCaptureRow =
        row.captureEligibility === "active_monitoring" ||
        row.captureEligibility === "finalized_no_active_monitoring";
      if (row.captureStatus !== "not_attempted" || !shouldCaptureRow) {
        if (row.captureStatus === "capture_pending_due_to_config_limit") {
          captureStepLogs.push(createAutomationStepLog({
            step: "visit_note_capture",
            message: "Visit Note content capture remains pending because VISIT_NOTE_CAPTURE_MAX_NOTES capped this run.",
            patientName: input.workItem.patientIdentity.displayName,
            found: [
              `visitNoteKey:${row.visitNoteKey}`,
              `captureStatus:${row.captureStatus}`,
            ],
            evidence: [row.skipReason ?? "VISIT_NOTE_CAPTURE_MAX_NOTES reached"],
            safeReadConfirmed: true,
          }));
        }
        capturedRows.push(row);
        continue;
      }
      this.logger.info({
        patientRunId: input.workItem.id,
        visitNoteKey: row.visitNoteKey,
        visitType: row.normalizedVisitType,
        visitStatus: row.normalizedStatus,
        manifestDecision: "capture_needed",
        captureStrategy: "read_only_row_action",
      }, "capturing visit note content");
      try {
        const capturedRow = await captureVisitNoteRowReadOnly({
          page: this.session.page,
          row,
          patientArtifactsDirectory: input.patientArtifactsDirectory,
          timeoutMs: this.env.VISIT_NOTE_CAPTURE_TIMEOUT_MS,
          useDomExtraction: this.env.VISIT_NOTES_DOM_EXTRACTION_ENABLED,
        });
        capturedRows.push(capturedRow);
        captureStepLogs.push(createAutomationStepLog({
          step: "visit_note_capture",
          message: `Captured Visit Note content for ${row.normalizedVisitType}.`,
          patientName: input.workItem.patientIdentity.displayName,
          evidence: [
            `visitNoteKey:${row.visitNoteKey}`,
            `captureStatus:${capturedRow.captureStatus}`,
          ],
          safeReadConfirmed: true,
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await persistVisitNoteCaptureResult({
          patientArtifactsDirectory: input.patientArtifactsDirectory,
          row,
          captureStrategy: "unavailable",
          captureStatus: "failed",
          failureReason: reason.slice(0, 180),
        }).catch(() => undefined);
        capturedRows.push({ ...row, captureStatus: "failed", skipReason: reason.slice(0, 180) });
        captureStepLogs.push(createAutomationStepLog({
          step: "visit_note_capture",
          message: "Visit Note content capture failed without interrupting the patient run.",
          patientName: input.workItem.patientIdentity.displayName,
          evidence: [
            `visitNoteKey:${row.visitNoteKey}`,
            `reason:${reason.slice(0, 180)}`,
          ],
          safeReadConfirmed: true,
        }));
      }
    }
    const restoreAfterVisitNoteCaptures = await withTimeout(
      this.ensurePatientChartContextForOasis({
        context: input.context,
        workItem: input.workItem,
        evidenceDir: input.evidenceDir,
        reason: "restore_patient_chart_after_visit_note_captures",
      }),
      Math.min(this.env.VISIT_NOTE_CAPTURE_TIMEOUT_MS, 15_000),
      "visit_note_post_capture_restore_timeout",
    ).catch((error) => ({
      success: false,
      stepLogs: [createAutomationStepLog({
        step: "visit_note_post_capture_restore",
        message: "Timed out restoring patient chart context after Visit Note captures; continuing the patient run.",
        patientName: input.workItem.patientIdentity.displayName,
        evidence: [error instanceof Error ? error.message : String(error)],
        safeReadConfirmed: true,
      })],
    }));
    captureStepLogs.push(...restoreAfterVisitNoteCaptures.stepLogs);

    const updatedDiscovery = {
      ...discovery.artifact,
      rows: capturedRows,
      warnings: [...discovery.artifact.warnings, ...capturePlan.warnings],
    };
    await writeFile(discovery.discoveryPath, JSON.stringify(updatedDiscovery, null, 2), "utf8");
    return {
      discoveryPath: discovery.discoveryPath,
      stepLogs: [...discovery.stepLogs, ...captureStepLogs],
    };
  }

  async selectEpisodeRangeForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    target?: EpisodeRangeSelectionTarget | null;
  }): Promise<{
    result: ResolvedEpisodeSelection;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const recovery = await this.ensurePatientChartContextForOasis({
      context: input.context,
      workItem: input.workItem,
      evidenceDir: input.evidenceDir,
      reason: "restore_patient_chart_before_episode_selection",
    });
    const selection = await selectEpisodeRange({
      page: this.session.page,
      logger: this.logger,
      context: input.context,
      workflowRunId: `${input.context.patientRunId}:${input.context.workflowDomain}`,
      debugConfig: this.debugConfig,
      target: input.target,
    });
    return {
      result: selection.result,
      stepLogs: [...recovery.stepLogs, ...selection.stepLogs],
    };
  }

  async extractBillingPeriodCalendarSummaryForReview(input: {
    context: PatientPortalContext;
    workItem: PatientEpisodeWorkItem;
    evidenceDir: string;
    selectedEpisode: EpisodeRangeSelectionTarget | null;
  }): Promise<{
    result: BillingPeriodCalendarSummary;
    summaryPath: string;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    this.currentDebugDir = path.join(input.evidenceDir, "debug");
    const recovery = await this.ensurePatientChartContextForOasis({
      context: input.context,
      workItem: input.workItem,
      evidenceDir: input.evidenceDir,
      reason: "restore_patient_chart_before_billing_calendar",
    });
    const parsed = await parseBillingPeriodCalendar({
      page: this.session.page,
      logger: this.logger,
      context: input.context,
      workflowRunId: `${input.context.patientRunId}:${input.context.workflowDomain}`,
      outputDirectory: input.evidenceDir,
      debugConfig: this.debugConfig,
      selectedEpisode: input.selectedEpisode
        ? {
            rawLabel: input.selectedEpisode.rawLabel ?? [input.selectedEpisode.startDate, input.selectedEpisode.endDate].filter(Boolean).join(" - "),
            startDate: input.selectedEpisode.startDate ?? null,
            endDate: input.selectedEpisode.endDate ?? null,
            isSelected: true,
          }
        : null,
    });

    return {
      result: parsed.summary,
      summaryPath: parsed.summaryPath,
      stepLogs: [...recovery.stepLogs, ...parsed.stepLogs],
    };
  }

  async captureFailureArtifacts(
    workItemId: string,
    outputDir: string,
  ): Promise<{
    tracePath: string | null;
    screenshotPaths: string[];
    downloadPaths: string[];
  }> {
    if (!this.session) {
      return {
        tracePath: null,
        screenshotPaths: [],
        downloadPaths: [],
      };
    }

    const failureDir = path.join(outputDir, "failures");
    await mkdir(failureDir, { recursive: true });

    const screenshotPath = path.join(failureDir, `${workItemId}.png`);
    await this.session.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    await capturePageDebugArtifacts({
      page: this.session.page,
      outputDir: this.currentDebugDir ?? path.join(outputDir, "debug", workItemId),
      step: "failure",
      reason: workItemId,
      debugConfig: this.debugConfig,
      textHints: ["patient", "documents", "search", "chart"],
    }).catch(() => undefined);

    const tracePath = this.env.PORTAL_TRACE_ON_FAILURE === false
      ? null
      : path.join(failureDir, `${workItemId}.zip`);

    if (tracePath) {
      await this.session.context.tracing.stop({ path: tracePath }).catch(() => undefined);
      await this.session.context.tracing.start({
        screenshots: true,
        snapshots: true,
      }).catch(() => undefined);
    }

    return {
      tracePath,
      screenshotPaths: [screenshotPath],
      downloadPaths: [],
    };
  }

  async dispose(): Promise<void> {
    if (!this.session) {
      return;
    }

    await this.session.context.close();
    await this.session.browser.close();
    this.session = null;
    this.dashboardUrl = null;
  }

  private resolveDashboardUrl(input: {
    configuredDashboardUrl?: string;
    currentUrl?: string;
  }): string | null {
    const configuredDashboardUrl = this.normalizeProviderDashboardUrl(input.configuredDashboardUrl);
    if (configuredDashboardUrl) {
      return configuredDashboardUrl;
    }

    const currentDashboardUrl = this.normalizeProviderDashboardUrl(input.currentUrl);
    if (currentDashboardUrl) {
      return currentDashboardUrl;
    }

    if (this.dashboardUrl) {
      return this.dashboardUrl;
    }

    return this.deriveProviderDashboardUrl(input.currentUrl);
  }

  private async bootstrapDashboardContextForPatientLookup(input: {
    workItem: PatientEpisodeWorkItem;
    patientSearchPage: PatientSearchPage;
    currentUrlBeforePatientLookup: string;
    initializationLogs: AutomationStepLog[];
  }): Promise<DashboardBootstrapResult> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }

    const currentUrl = this.session.page.url();
    const dashboardUrl = this.resolveDashboardUrl({
      configuredDashboardUrl: this.runtimeConfig.portalDashboardUrl ?? undefined,
      currentUrl,
    });
    const missingPortalBootstrapConfig = !this.runtimeConfig.portalBaseUrl && !dashboardUrl;
    const currentContextRequiresReset = this.shouldForceDashboardReset(currentUrl, dashboardUrl);
    const stepLogs: AutomationStepLog[] = [...input.initializationLogs];

    stepLogs.push(
      createAutomationStepLog({
        step: "run_started",
        message: "Patient run started from the shared Playwright portal runner.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: currentUrl,
        urlAfter: currentUrl,
        found: [`currentUrl=${currentUrl}`],
        evidence: [
          `subsidiaryId=${this.runtimeConfig.subsidiaryId}`,
          `portalBaseUrl=${this.runtimeConfig.portalBaseUrl ?? "unset"}`,
          `configuredDashboardUrl=${this.runtimeConfig.portalDashboardUrl ?? "unset"}`,
          `resolvedDashboardUrl=${dashboardUrl ?? "unresolved"}`,
          `currentContextRequiresReset=${currentContextRequiresReset}`,
        ],
        safeReadConfirmed: true,
      }),
    );

    if (missingPortalBootstrapConfig) {
      stepLogs.push(
        createAutomationStepLog({
          step: "dashboard_ready",
          message: "Provider dashboard context could not be established because portal bootstrap URLs were not configured.",
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: currentUrl,
          urlAfter: currentUrl,
          missing: ["portalBaseUrl or portalDashboardUrl"],
          evidence: [
            "dashboard_context_not_established",
            `currentUrlAfterLogin=${currentUrl}`,
          ],
          safeReadConfirmed: true,
        }),
      );

      return {
        ready: false,
        dashboardUrl: null,
        patientLookupEntryContext: "dashboard_reset_then_global_search",
        fallbackDashboardResetRequired: true,
        stepLogs,
        blockReason: "dashboard_context_not_established: missing_portal_bootstrap_configuration",
      };
    }

    let dashboardReady = false;
    let fallbackDashboardResetRequired = currentContextRequiresReset;
    let patientLookupEntryContext: DashboardBootstrapResult["patientLookupEntryContext"] =
      currentContextRequiresReset ? "dashboard_reset_then_global_search" : "current_page_global_search";

    if (currentContextRequiresReset) {
      const dashboardReset = await this.runFallbackDashboardReset({
        patientSearchPage: input.patientSearchPage,
        workItem: input.workItem,
        dashboardUrl,
        currentUrlBeforePatientLookup: currentUrl,
        globalSearchAvailableInCurrentContext: false,
        fallbackReason: this.classifyDashboardResetReason(currentUrl, dashboardUrl),
      });
      stepLogs.push(...dashboardReset.stepLogs);
      dashboardReady = dashboardReset.ready;
    } else {
      const readiness = await input.patientSearchPage.waitForDashboardReady();
      stepLogs.push(...readiness.stepLogs);
      dashboardReady = readiness.ready;
      if (!readiness.ready && dashboardUrl) {
        patientLookupEntryContext = "dashboard_reset_then_global_search";
        fallbackDashboardResetRequired = true;
        const dashboardReset = await this.runFallbackDashboardReset({
          patientSearchPage: input.patientSearchPage,
          workItem: input.workItem,
          dashboardUrl,
          currentUrlBeforePatientLookup: currentUrl,
          globalSearchAvailableInCurrentContext: false,
          fallbackReason: "dashboard_ready_signal_missing_after_login",
        });
        stepLogs.push(...dashboardReset.stepLogs);
        dashboardReady = dashboardReset.ready;
      }
    }

    if (!dashboardReady) {
      return {
        ready: false,
        dashboardUrl,
        patientLookupEntryContext,
        fallbackDashboardResetRequired: true,
        stepLogs,
        blockReason: "dashboard_context_not_established: dashboard_ready_signal_missing",
      };
    }

    const availability = await input.patientSearchPage.canUseGlobalPatientSearch(input.workItem);
    stepLogs.push(...availability.stepLogs);
    fallbackDashboardResetRequired = fallbackDashboardResetRequired || !availability.available;
    if (!availability.available && dashboardUrl) {
      patientLookupEntryContext = "dashboard_reset_then_global_search";
      const dashboardReset = await this.runFallbackDashboardReset({
        patientSearchPage: input.patientSearchPage,
        workItem: input.workItem,
        dashboardUrl,
        currentUrlBeforePatientLookup: this.session.page.url(),
        globalSearchAvailableInCurrentContext: false,
        fallbackReason: "global_search_unavailable_after_dashboard_bootstrap",
      });
      stepLogs.push(...dashboardReset.stepLogs);
      if (dashboardReset.ready) {
        const availabilityAfterReset = await input.patientSearchPage.canUseGlobalPatientSearch(input.workItem);
        stepLogs.push(...availabilityAfterReset.stepLogs);
        if (availabilityAfterReset.available) {
          stepLogs.push(
            createAutomationStepLog({
              step: "patient_lookup_entry",
              message: "Patient lookup will start after shared dashboard bootstrap confirmed provider dashboard readiness and global search availability.",
              patientName: input.workItem.patientIdentity.displayName,
              urlBefore: input.currentUrlBeforePatientLookup,
              urlAfter: this.session.page.url(),
              found: [
                `patientLookupEntryContext=${patientLookupEntryContext}`,
                "dashboard_context_established",
                "globalSearchAvailable=true",
              ],
              evidence: [
                `currentUrlAfterLogin=${input.currentUrlBeforePatientLookup}`,
                `currentUrlBeforeSearch=${this.session.page.url()}`,
                `resolvedDashboardUrl=${dashboardUrl ?? "unresolved"}`,
              ],
              safeReadConfirmed: true,
            }),
          );
          return {
            ready: true,
            dashboardUrl,
            patientLookupEntryContext,
            fallbackDashboardResetRequired: true,
            stepLogs,
          };
        }
      }

      return {
        ready: false,
        dashboardUrl,
        patientLookupEntryContext,
        fallbackDashboardResetRequired: true,
        stepLogs,
        blockReason: "dashboard_context_not_established: global_search_unavailable_after_bootstrap",
      };
    }

    stepLogs.push(
      createAutomationStepLog({
        step: "patient_lookup_entry",
        message: "Patient lookup will start after shared dashboard bootstrap confirmed provider dashboard readiness and global search availability.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: input.currentUrlBeforePatientLookup,
        urlAfter: this.session.page.url(),
        found: [
          `patientLookupEntryContext=${patientLookupEntryContext}`,
          "dashboard_context_established",
          "globalSearchAvailable=true",
        ],
        evidence: [
          `currentUrlAfterLogin=${input.currentUrlBeforePatientLookup}`,
          `currentUrlBeforeSearch=${this.session.page.url()}`,
          `resolvedDashboardUrl=${dashboardUrl ?? "unresolved"}`,
          `globalSearchSelectorUsed=${availability.selectorUsed ?? "none"}`,
        ],
        safeReadConfirmed: true,
      }),
    );

    return {
      ready: true,
      dashboardUrl,
      patientLookupEntryContext,
      fallbackDashboardResetRequired,
      stepLogs,
    };
  }

  private shouldForceDashboardReset(currentUrl: string, dashboardUrl: string | null): boolean {
    if (!currentUrl || currentUrl === "about:blank") {
      return true;
    }
    if (currentUrl.startsWith("about:")) {
      return true;
    }
    if (!this.isProviderContextUrl(currentUrl)) {
      return true;
    }
    if (dashboardUrl && currentUrl.replace(/\/$/, "") !== dashboardUrl.replace(/\/$/, "") && !currentUrl.startsWith(`${dashboardUrl.replace(/\/$/, "")}/`)) {
      return true;
    }
    return false;
  }

  private isProviderContextUrl(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    try {
      const parsed = new URL(value);
      return /^\/provider\/[^/]+(?:\/|$)/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  private classifyDashboardResetReason(currentUrl: string, dashboardUrl: string | null): string {
    if (!currentUrl || currentUrl === "about:blank" || currentUrl.startsWith("about:")) {
      return "current_url_about_blank";
    }
    if (!this.isProviderContextUrl(currentUrl)) {
      return "current_url_missing_provider_context";
    }
    if (dashboardUrl && currentUrl.replace(/\/$/, "") !== dashboardUrl.replace(/\/$/, "") && !currentUrl.startsWith(`${dashboardUrl.replace(/\/$/, "")}/`)) {
      return "current_url_not_provider_dashboard";
    }
    return "dashboard_context_recovery_required";
  }

  private async runFallbackDashboardReset(input: {
    patientSearchPage: PatientSearchPage;
    workItem: PatientEpisodeWorkItem;
    dashboardUrl: string | null;
    currentUrlBeforePatientLookup: string;
    globalSearchAvailableInCurrentContext: boolean;
    fallbackReason: string;
  }): Promise<{
    ready: boolean;
    stepLogs: AutomationStepLog[];
  }> {
    if (!this.session) {
      throw new Error("Playwright batch worker was not initialized.");
    }
    if (!input.dashboardUrl) {
      return {
        ready: false,
        stepLogs: [
          createAutomationStepLog({
            step: "dashboard_reset",
            message: "Failed to reset to the provider dashboard because no provider dashboard URL could be resolved.",
            patientName: input.workItem.patientIdentity.displayName,
            urlBefore: input.currentUrlBeforePatientLookup,
            urlAfter: this.session.page.url(),
            missing: ["resolved provider dashboard URL"],
            evidence: [
              "dashboard_context_not_established",
              `fallbackReason=${input.fallbackReason}`,
              `currentUrl=${this.session.page.url()}`,
              `configuredDashboardUrl=${this.runtimeConfig.portalDashboardUrl ?? "unset"}`,
            ],
            safeReadConfirmed: true,
          }),
        ],
      };
    }

    this.logger.info(
      {
        workItemId: input.workItem.id,
        currentUrlBeforePatientLookup: input.currentUrlBeforePatientLookup,
        globalSearchAvailableInCurrentContext: input.globalSearchAvailableInCurrentContext,
        fallbackDashboardResetRequired: true,
        fallbackDashboardResetTargetUrl: input.dashboardUrl,
        fallbackReason: input.fallbackReason,
      },
      "falling back to provider dashboard reset before global patient search",
    );

    const dashboardReset = await input.patientSearchPage.resetToDashboard({
      baseUrl: input.dashboardUrl,
      workItem: input.workItem,
    });
    if (dashboardReset.ready) {
      this.dashboardUrl = this.resolveDashboardUrl({
        configuredDashboardUrl:
          this.runtimeConfig.portalDashboardUrl ?? this.dashboardUrl ?? undefined,
        currentUrl: this.session.page.url(),
      }) ?? input.dashboardUrl;
    }

    const pageTitleAfterReset = await this.session.page.title().catch(() => "unknown");
    const bodyTextAfterReset = ((await this.session.page.locator("body").textContent().catch(() => null)) ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    this.logger.info(
      {
        workItemId: input.workItem.id,
        fallbackDashboardResetTargetUrl: input.dashboardUrl,
        currentUrlAfterFallbackReset: this.session.page.url(),
        pageTitleAfterFallbackReset: pageTitleAfterReset,
        bodyTextAfterFallbackReset: bodyTextAfterReset,
        dashboardReady: dashboardReset.ready,
      },
      "fallback dashboard reset finished before patient match",
    );

    return dashboardReset;
  }

  private normalizeProviderDashboardUrl(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = new URL(value);
      const match = parsed.pathname.match(/^\/provider\/[^/]+\/dashboard\/?$/i);
      if (!match) {
        return null;
      }

      return `${parsed.origin}${match[0].replace(/\/$/, "")}`;
    } catch {
      return null;
    }
  }

  private deriveProviderDashboardUrl(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = new URL(value);
      const match = parsed.pathname.match(/^\/provider\/([^/]+)(?:\/.*)?$/i);
      if (!match?.[1]) {
        return null;
      }

      return `${parsed.origin}/provider/${match[1]}/dashboard`;
    } catch {
      return null;
    }
  }
}
