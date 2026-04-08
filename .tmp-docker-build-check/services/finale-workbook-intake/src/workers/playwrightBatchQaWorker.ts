import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  SubsidiaryRuntimeConfig,
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
import { createAutomationStepLog } from "../portal/utils/automationLog";
import type { PortalDebugConfig } from "../portal/utils/locatorResolution";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";
import { capturePageDebugArtifacts } from "../portal/utils/pageDiagnostics";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";

export interface BatchPortalAutomationClient {
  initialize(outputDir?: string): Promise<void>;
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
      stepTimeoutMs: env.PORTAL_STEP_TIMEOUT_MS,
      debugScreenshots: env.PORTAL_DEBUG_SCREENSHOTS ?? true,
      selectorRetryCount: env.PORTAL_SELECTOR_RETRY_COUNT,
    };
  }

  async initialize(outputDir?: string): Promise<void> {
    this.batchOutputDir = outputDir ? path.resolve(outputDir) : null;
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
          `selectorRetryCount=${this.debugConfig.selectorRetryCount}`,
          `configuredDashboardUrl=${this.runtimeConfig.portalDashboardUrl ?? "unset"}`,
          `dashboardResetUrl=${this.dashboardUrl ?? "unresolved"}`,
        ],
        safeReadConfirmed: true,
      }),
    ];
  }

  async resolvePatient(workItem: PatientEpisodeWorkItem, evidenceDir?: string): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
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
    const orchestrationStepLogs: AutomationStepLog[] = [...bootstrap.stepLogs];
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

  async discoverArtifacts(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
    options?: {
      workflowPhase?: "full_discovery" | "file_uploads_only" | "oasis_diagnosis_only";
      oasisReadyDiagnosis?: OasisReadyDiagnosisDocument | null;
      oasisReadyDiagnosisPath?: string | null;
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
