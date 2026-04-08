import type { Locator, Page } from "@playwright/test";
import type {
  AutomationStepLog,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PortalSafetyConfig,
} from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { selectorRegistry } from "../selectorRegistry";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../utils/locatorResolution";
import {
  buildPatientSearchQueries,
  normalizePatientNameForGlobalSearch,
  normalizePatientNameForGlobalSearchResult,
  scorePatientSearchCandidate,
} from "../utils/patientSearchMatching";
import {
  capturePageDebugArtifacts,
  dumpTopVisibleText,
  findCandidateElementsByText,
  pauseOnFailureIfRequested,
  summarizeButtons,
  summarizeInputs,
} from "../utils/pageDiagnostics";
import {
  assertReadOnlyActionAllowed,
  detectDangerousControls,
  resolvePortalSafetyConfig,
} from "../safety/readOnlySafety";

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeComparable(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .replace(/[,/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatientLinkNamePattern(value: string): RegExp {
  const normalized = normalizeWhitespace(value).replace(/,/g, " ");
  const tokens = normalized.split(/\s+/).map((entry) => entry.trim()).filter(Boolean);

  if (tokens.length === 0) {
    return /.^/i;
  }

  if (tokens.length === 1) {
    return new RegExp(escapeRegExp(tokens[0]!), "i");
  }

  const forward = tokens.map((token) => escapeRegExp(token)).join(".*");
  const reverse = [...tokens].reverse().map((token) => escapeRegExp(token)).join(".*");
  return new RegExp(`(?:${forward}|${reverse})`, "i");
}

function extractGlobalSearchNameParts(searchQuery: string): {
  normalizedQuery: string;
  lastName: string;
  firstName: string;
  firstToken: string;
} {
  const normalizedQuery = normalizeComparable(searchQuery);
  const commaSeparated = normalizeWhitespace(searchQuery)
    .split(",")
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
  const lastName = normalizeComparable(commaSeparated[0] ?? "");
  const firstName = normalizeComparable(commaSeparated.slice(1).join(" "));
  const firstToken = firstName.split(" ").filter(Boolean)[0] ?? "";

  return {
    normalizedQuery,
    lastName,
    firstName,
    firstToken,
  };
}

async function readVisibleLocatorText(locator: Locator): Promise<string> {
  return normalizeWhitespace(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
    (await locator.getAttribute("title").catch(() => null)) ??
    (await locator.textContent().catch(() => null)),
  );
}

async function summarizeLocatorContext(locator: Locator): Promise<string> {
  const summary = normalizeWhitespace(
    (await locator.getAttribute("class").catch(() => null)) ??
    (await locator.getAttribute("role").catch(() => null)) ??
    (await locator.textContent().catch(() => null)),
  );
  return summary.slice(0, 240);
}

async function countVisibleLocators(locator: Locator, maxItems = 40): Promise<number> {
  const count = await locator.count().catch(() => 0);
  let visibleCount = 0;

  for (let index = 0; index < Math.min(count, maxItems); index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visibleCount += 1;
    }
  }

  return visibleCount;
}

async function pickFirstVisibleLocator(
  choices: Array<{ locator: Locator; summary: string }>,
): Promise<{ locator: Locator; summary: string } | null> {
  for (const choice of choices) {
    if (await choice.locator.isVisible().catch(() => false)) {
      return choice;
    }
  }

  return null;
}

async function pickFirstPresentLocator(
  choices: Array<{ locator: Locator; summary: string }>,
): Promise<{ locator: Locator; summary: string } | null> {
  for (const choice of choices) {
    const count = await choice.locator.count().catch(() => 0);
    if (count > 0) {
      return choice;
    }
  }

  return null;
}

interface SearchResultCandidate {
  label: string;
  rowText: string;
  rowLocator: Locator;
  rowSelector: string;
  containerSummary: string;
  portalPatientId: string | null;
  score: number;
  reasons: string[];
  queryUsed: string;
  exactMatch: boolean;
  containsFullQuery: boolean;
  containsFirstAndLast: boolean;
}

interface SearchResultsSnapshot {
  ready: boolean;
  rowCount: number;
  candidateTexts: string[];
  textSample: string;
  noResultsVisible: boolean;
  resultSelectorUsed: string | null;
  evidence: string[];
  resultLocators?: Locator[];
}

interface GlobalSearchLaunchResult {
  ready: boolean;
  searchQuery: string;
  controlSelectorUsed: string | null;
  inputSelectorUsed: string | null;
  searchSurface: Locator | null;
  searchSurfaceSelectorUsed: string | null;
  resultsSnapshot: SearchResultsSnapshot | null;
  stepLogs: AutomationStepLog[];
}

interface GlobalSearchAvailabilityResult {
  available: boolean;
  selectorUsed: string | null;
  stepLogs: AutomationStepLog[];
}

interface DashboardReadyResult {
  ready: boolean;
  stepLogs: AutomationStepLog[];
}

interface DashboardResetResult {
  ready: boolean;
  stepLogs: AutomationStepLog[];
}

interface GlobalSearchTriggerResolution {
  locator: Locator | null;
  selectorUsed: string | null;
  evidence: string[];
}

export class PatientSearchPage {
  private readonly safety: PortalSafetyConfig;

  constructor(
    private readonly page: Page,
    private readonly options: {
      logger?: Logger;
      debugConfig?: PortalDebugConfig;
      debugDir?: string;
      safety?: PortalSafetyConfig;
    } = {},
  ) {
    this.safety = resolvePortalSafetyConfig(this.options.safety);
  }

  async waitForDashboardReady(): Promise<DashboardReadyResult> {
    const deadline = Date.now() + 10_000;
    const attempts: string[] = [];
    let attemptNumber = 0;

    while (Date.now() < deadline) {
      attemptNumber += 1;
      await this.page.waitForLoadState("networkidle", {
        timeout: Math.min(this.options.debugConfig?.stepTimeoutMs ?? 6_000, 2_500),
      }).catch(() => undefined);

      const stableDom = await this.waitForStableDom(500);
      const signal = await this.detectDashboardReadySignal();
      const url = this.page.url();
      const title = await this.page.title().catch(() => "unknown");
      const buttonCount = await this.page.locator("button, [role='button']").count().catch(() => 0);
      const inputCount = await this.page.locator("input, textarea, [role='textbox'], [role='combobox']").count().catch(() => 0);
      const visibleTextSample = await dumpTopVisibleText(this.page, 240);

      attempts.push(
        `attempt=${attemptNumber}` +
        ` signal=${signal ?? "none"}` +
        ` stableDom=${stableDom}` +
        ` url=${url}` +
        ` title=${title}` +
        ` buttons=${buttonCount}` +
        ` inputs=${inputCount}` +
        ` text=${visibleTextSample}`,
      );

      if (signal) {
        return {
          ready: true,
          stepLogs: [createAutomationStepLog({
            step: "dashboard_ready",
            message: `Provider dashboard ready confirmed using '${signal}'.`,
            urlBefore: url,
            urlAfter: this.page.url(),
            found: [signal],
            evidence: attempts,
            safeReadConfirmed: true,
          })],
        };
      }

      await this.page.waitForTimeout(500);
    }

    const debugArtifacts = await capturePageDebugArtifacts({
      page: this.page,
      outputDir: this.options.debugDir,
      step: "dashboard-ready",
      reason: "timeout",
      debugConfig: this.options.debugConfig,
      textHints: ["dashboard", "search patient", "ctrl k", "patient"],
    });

    return {
      ready: false,
      stepLogs: [createAutomationStepLog({
        step: "dashboard_ready",
        message: "Provider dashboard readiness was not confirmed before patient search began.",
        urlBefore: this.page.url(),
        urlAfter: this.page.url(),
        missing: ["dashboard ready signal"],
        evidence: [
          ...attempts,
          debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
          debugArtifacts.htmlPath ? `Debug HTML: ${debugArtifacts.htmlPath}` : "",
          debugArtifacts.screenshotPath ? `Debug screenshot: ${debugArtifacts.screenshotPath}` : "",
        ].filter(Boolean),
        safeReadConfirmed: true,
      })],
    };
  }

  async resetToDashboard(input: {
    baseUrl: string;
    workItem: PatientEpisodeWorkItem;
  }): Promise<DashboardResetResult> {
    const urlBeforeReset = this.page.url();
    const attempts: string[] = [];
    const stepLogs: AutomationStepLog[] = [];

    const runDashboardCheck = async (label: string): Promise<DashboardReadyResult> => {
      const result = await this.waitForDashboardReady();
      attempts.push(`${label}: dashboardDetected=${result.ready} currentUrl=${this.page.url()}`);
      stepLogs.push(...result.stepLogs);
      return result;
    };

    await this.page.goto(input.baseUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    let dashboardReady = await runDashboardCheck("goto_base_url");

    if (!dashboardReady.ready) {
      await this.page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      dashboardReady = await runDashboardCheck("reload_after_missing_dashboard");
    }

    if (!dashboardReady.ready) {
      await this.page.goto(input.baseUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      dashboardReady = await runDashboardCheck("retry_goto_base_url");
    }

    if (!dashboardReady.ready) {
      await this.page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      dashboardReady = await runDashboardCheck("retry_reload_after_missing_dashboard");
    }

    stepLogs.unshift(
      createAutomationStepLog({
        step: "dashboard_reset",
        message: dashboardReady.ready
          ? "Reset the portal session to the provider dashboard before patient matching."
          : "Failed to reset the portal session to a ready provider dashboard before patient matching.",
        patientName: input.workItem.patientIdentity.displayName,
        urlBefore: urlBeforeReset,
        urlAfter: this.page.url(),
        found: dashboardReady.ready ? [this.page.url()] : [],
        missing: dashboardReady.ready ? [] : ["provider dashboard after reset"],
        evidence: [
          "Reset triggered: true",
          `Current URL before patient: ${urlBeforeReset}`,
          `Current URL after reset: ${this.page.url()}`,
          `Dashboard reset target URL: ${input.baseUrl}`,
          `Dashboard markers found: ${dashboardReady.ready}`,
          ...attempts,
        ],
        safeReadConfirmed: true,
      }),
    );

    this.options.logger?.info(
      {
        dashboardResetTargetUrl: input.baseUrl,
        currentUrlAfterReset: this.page.url(),
        dashboardReady: dashboardReady.ready,
      },
      "dashboard reset completed",
    );

    return {
      ready: dashboardReady.ready,
      stepLogs,
    };
  }

  private async resolveGlobalSearchTrigger(): Promise<GlobalSearchTriggerResolution> {
    const explicitText = this.page.getByText(/Search Patient/i).first();
    const explicitTextClickableParent = explicitText
      .locator("xpath=ancestor-or-self::*[self::button or @role='button' or self::fin-button or @tabindex='0'][1]")
      .first();
    const combinedTextControl = this.page
      .locator(':is(button, [role="button"], fin-button, [tabindex="0"]):has-text("Search Patient"):has-text("Ctrl K")')
      .first();
    const visibleSearchControl = this.page
      .locator(':is(button, [role="button"], fin-button, [tabindex="0"]):has-text("Search Patient")')
      .first();
    const shortcutControl = this.page
      .locator(':is(button, [role="button"], fin-button, [tabindex="0"]):has-text("Ctrl K")')
      .first();

    await explicitText.waitFor({
      state: "visible",
      timeout: Math.min(this.options.debugConfig?.stepTimeoutMs ?? 6_000, 2_500),
    }).catch(() => undefined);
    await explicitTextClickableParent.waitFor({
      state: "visible",
      timeout: 800,
    }).catch(() => undefined);
    await combinedTextControl.waitFor({
      state: "visible",
      timeout: 800,
    }).catch(() => undefined);
    await visibleSearchControl.waitFor({
      state: "visible",
      timeout: 800,
    }).catch(() => undefined);
    await shortcutControl.waitFor({
      state: "visible",
      timeout: 800,
    }).catch(() => undefined);

    const manualVisibleChoice = await pickFirstVisibleLocator([
      {
        locator: explicitTextClickableParent,
        summary: 'getByText(/Search Patient/i) -> nearest clickable parent',
      },
      {
        locator: combinedTextControl,
        summary: ':is(button,[role="button"],fin-button,[tabindex="0"]):has-text("Search Patient"):has-text("Ctrl K")',
      },
      {
        locator: visibleSearchControl,
        summary: ':is(button,[role="button"],fin-button,[tabindex="0"]):has-text("Search Patient")',
      },
      {
        locator: shortcutControl,
        summary: ':is(button,[role="button"],fin-button,[tabindex="0"]):has-text("Ctrl K")',
      },
      {
        locator: explicitText,
        summary: 'getByText(/Search Patient/i)',
      },
    ]);
    const manualPresentChoice = await pickFirstPresentLocator([
      {
        locator: explicitTextClickableParent,
        summary: 'getByText(/Search Patient/i) -> nearest clickable parent (present)',
      },
      {
        locator: combinedTextControl,
        summary: ':is(button,[role="button"],fin-button,[tabindex="0"]):has-text("Search Patient"):has-text("Ctrl K") (present)',
      },
      {
        locator: visibleSearchControl,
        summary: ':is(button,[role="button"],fin-button,[tabindex="0"]):has-text("Search Patient") (present)',
      },
      {
        locator: shortcutControl,
        summary: ':is(button,[role="button"],fin-button,[tabindex="0"]):has-text("Ctrl K") (present)',
      },
      {
        locator: explicitText,
        summary: 'getByText(/Search Patient/i) (present)',
      },
    ]);

    const controlResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.patientSearch.globalSearchControl,
      step: "global_patient_search_trigger_resolution",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig, 200),
    });

    if (manualVisibleChoice) {
      return {
        locator: manualVisibleChoice.locator,
        selectorUsed: manualVisibleChoice.summary,
        evidence: [
          `Resolved global search trigger with visible manual selector '${manualVisibleChoice.summary}'.`,
          ...controlResolution.attempts.map(selectorAttemptToEvidence),
        ],
      };
    }

    if (manualPresentChoice) {
      return {
        locator: manualPresentChoice.locator,
        selectorUsed: manualPresentChoice.summary,
        evidence: [
          `Resolved global search trigger with present manual selector '${manualPresentChoice.summary}' even though Playwright visibility did not confirm it in the probe path.`,
          ...controlResolution.attempts.map(selectorAttemptToEvidence),
        ],
      };
    }

    return {
      locator: controlResolution.locator,
      selectorUsed: controlResolution.matchedCandidate?.description ?? null,
      evidence: controlResolution.attempts.map(selectorAttemptToEvidence),
    };
  }

  async canUseGlobalPatientSearch(workItem?: PatientEpisodeWorkItem): Promise<GlobalSearchAvailabilityResult> {
    const currentUrl = this.page.url();
    await waitForPortalPageSettled(this.page, this.options.debugConfig, 200);
    const triggerResolution = await this.resolveGlobalSearchTrigger();
    const available = triggerResolution.locator !== null;
    const selectorUsed = triggerResolution.selectorUsed;

    this.options.logger?.info(
      {
        currentUrlBeforePatientLookup: currentUrl,
        globalSearchAvailableInCurrentContext: available,
        globalSearchAvailabilitySelector: selectorUsed,
        globalSearchAvailabilityEvidence: triggerResolution.evidence,
      },
      "global patient search availability checked",
    );

    return {
      available,
      selectorUsed,
      stepLogs: [
        createAutomationStepLog({
          step: "patient_lookup_entry",
          message: available
            ? "Global patient search is available from the current authenticated page context."
            : "Global patient search is not available from the current authenticated page context.",
          patientName: workItem?.patientIdentity.displayName,
          urlBefore: currentUrl,
          urlAfter: this.page.url(),
          selectorUsed,
          found: available && selectorUsed ? [selectorUsed] : [],
          missing: available ? [] : ["global patient search trigger in current context"],
          evidence: [
            `Current URL before patient lookup: ${currentUrl}`,
            `Global search available in current context: ${available}`,
            `Global search availability selector used: ${selectorUsed ?? "none"}`,
            ...triggerResolution.evidence,
          ],
          safeReadConfirmed: true,
        }),
      ],
    };
  }

  async resolvePatient(workItem: PatientEpisodeWorkItem): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
    activePage: Page;
  }> {
    const searchQueries = buildPatientSearchQueries(workItem);
    const normalizedSearchName = normalizePatientNameForGlobalSearch(workItem.patientIdentity.displayName);
    const expectedDisplayName = normalizePatientNameForGlobalSearchResult(workItem.patientIdentity.displayName);
    const stepLogs: AutomationStepLog[] = [
      createAutomationStepLog({
        step: "patient_search_start",
        message: `Starting patient search with ${searchQueries.length} query variant(s).`,
        patientName: workItem.patientIdentity.displayName,
        urlBefore: this.page.url(),
        urlAfter: this.page.url(),
        found: [normalizedSearchName, expectedDisplayName, ...searchQueries].filter(Boolean),
        evidence: [
          `Original workbook patient name: ${workItem.patientIdentity.displayName}`,
          `Normalized global search query: ${normalizedSearchName || "unavailable"}`,
          `Normalized expected display name: ${expectedDisplayName || "unavailable"}`,
          `Workbook name variants: ${searchQueries.join(" | ") || "none"}`,
        ],
        safeReadConfirmed: true,
      }),
    ];
    const urlBefore = this.page.url();

    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: normalizedSearchName,
        normalizedExpectedDisplayName: expectedDisplayName,
        currentUrl: urlBefore,
      },
      "starting global patient search",
    );

    const globalSearch = await this.openGlobalPatientSearch(workItem, urlBefore, normalizedSearchName);
    stepLogs.push(...globalSearch.stepLogs);
    if (!globalSearch.ready) {
      stepLogs.push(
        createAutomationStepLog({
          step: "chart_open",
          message: "Patient chart open was skipped because the global patient search UI did not complete successfully.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore,
          urlAfter: this.page.url(),
          missing: ["global patient search UI"],
          safeReadConfirmed: true,
        }),
      );

      return {
        matchResult: {
          status: "ERROR",
          searchQuery: normalizedSearchName || searchQueries[0] || workItem.patientIdentity.displayName,
          portalPatientId: null,
          portalDisplayName: null,
          candidateNames: [],
          note: "Global patient search UI could not be completed from the current authenticated portal context.",
        },
        stepLogs,
        activePage: this.page,
      };
    }

    const resultScan = await this.collectResultCandidates(
      workItem,
      normalizedSearchName,
      expectedDisplayName,
      globalSearch.searchSurface ?? this.page,
    );
    const resultCandidates = [...resultScan.candidates].sort((left, right) =>
      Number(right.exactMatch) - Number(left.exactMatch) ||
      right.score - left.score ||
      left.label.localeCompare(right.label),
    );
    const candidateNames = resultCandidates.map((candidate) => candidate.label);
    const dangerousControls = await detectDangerousControls(this.page);
    const matchedExactCandidates = resultCandidates.filter((candidate) => candidate.exactMatch);

    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: normalizedSearchName,
        normalizedExpectedDisplayName: expectedDisplayName,
        globalSearchControlSelector: globalSearch.controlSelectorUsed,
        globalSearchInputSelector: globalSearch.inputSelectorUsed,
        candidateTileCount: resultScan.rowCount,
        candidateTileTexts: resultScan.candidateTexts,
        candidateSearchResultTexts: resultScan.candidateTexts,
      },
      "global patient search candidates collected",
    );

    stepLogs.push(
      createAutomationStepLog({
        step: "patient_search",
        message: `Global patient search completed with ${candidateNames.length} candidate(s).`,
        patientName: workItem.patientIdentity.displayName,
        urlBefore,
        urlAfter: this.page.url(),
        selectorUsed: [
          globalSearch.controlSelectorUsed,
          globalSearch.inputSelectorUsed,
          resultScan.resultSelectorUsed,
        ].filter(Boolean).join(" -> ") || null,
        found: candidateNames.slice(0, 8),
        evidence: [
          `Original workbook patient name: ${workItem.patientIdentity.displayName}`,
          `Normalized global search query: ${normalizedSearchName || "unavailable"}`,
          `Normalized expected display name: ${expectedDisplayName || "unavailable"}`,
          `Global search control selector used: ${globalSearch.controlSelectorUsed ?? "unknown"}`,
          `Global search surface selector used: ${globalSearch.searchSurfaceSelectorUsed ?? "unknown"}`,
          `Global search input selector used: ${globalSearch.inputSelectorUsed ?? "unknown"}`,
          `Result selector used: ${resultScan.resultSelectorUsed ?? "unknown"}`,
          `Search results ready: ${resultScan.ready}`,
          `Visible result row count: ${resultScan.rowCount}`,
          `No results marker visible: ${resultScan.noResultsVisible}`,
          `Candidate search result texts: ${resultScan.candidateTexts.join(" | ") || "none"}`,
          `Result text sample: ${resultScan.textSample || "none"}`,
          ...(globalSearch.resultsSnapshot?.evidence.slice(0, 8) ?? []),
          ...resultScan.evidence.slice(0, 8),
          ...resultCandidates.slice(0, 8).map((candidate) =>
            `Candidate '${candidate.label}' row='${candidate.rowText}' selector='${candidate.rowSelector}' container='${candidate.containerSummary}' score=${candidate.score} exact=${candidate.exactMatch} containsFullQuery=${candidate.containsFullQuery} containsFirstAndLast=${candidate.containsFirstAndLast} reasons=${candidate.reasons.join("; ")}`,
          ),
          ...dangerousControls.map((entry) => `Dangerous control detected: ${entry.label}`),
        ],
        safeReadConfirmed: true,
      }),
    );

    if (matchedExactCandidates.length === 1) {
      return this.completeResolvedPatientMatch({
        candidate: matchedExactCandidates[0]!,
        candidateNames,
        normalizedSearchName,
        expectedDisplayName,
        stepLogs,
        workItem,
      });
    }

    if (matchedExactCandidates.length > 1) {
      return this.buildAmbiguousSearchResult({
        workItem,
        searchQuery: normalizedSearchName,
        stepLogs,
        candidateNames,
        candidates: matchedExactCandidates,
        message: "Multiple exact patient matches were returned by the global search.",
      });
    }

    if (candidateNames.length === 0) {
      const notFoundReason = resultScan.noResultsVisible
        ? "Global patient search returned an explicit no-results state for the workbook patient."
        : "Global patient search completed, but no matching patient result was available to open.";
      const debugArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "patient-search",
        reason: "no-results",
        debugConfig: this.options.debugConfig,
        textHints: [normalizedSearchName, workItem.patientIdentity.displayName],
      });

      return {
        matchResult: {
          status: "NOT_FOUND",
          searchQuery: normalizedSearchName,
          portalPatientId: null,
          portalDisplayName: null,
          candidateNames: [],
          note: notFoundReason,
        },
        stepLogs: [
          ...stepLogs,
          createAutomationStepLog({
            step: "patient_search_match_resolution",
            message: notFoundReason,
            patientName: workItem.patientIdentity.displayName,
            urlBefore: this.page.url(),
            urlAfter: this.page.url(),
            missing: ["matching patient result"],
            evidence: [
              `Original workbook patient name: ${workItem.patientIdentity.displayName}`,
              `Normalized global search query: ${normalizedSearchName || "unavailable"}`,
              `Normalized expected display name: ${expectedDisplayName || "unavailable"}`,
              `Candidate search result texts: ${resultScan.candidateTexts.join(" | ") || "none"}`,
              `Visible result row count: ${resultScan.rowCount}`,
              `No results marker visible: ${resultScan.noResultsVisible}`,
              debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
              ...(await Promise.all(
                [normalizedSearchName, ...searchQueries].slice(0, 3).map(async (query) => {
                  const matches = await findCandidateElementsByText(this.page, query);
                  return matches.length > 0
                    ? `Text matches for '${query}': ${matches.join(" | ")}`
                    : `Text matches for '${query}': none`;
                }),
              )),
            ].filter(Boolean),
            safeReadConfirmed: true,
          }),
          createAutomationStepLog({
            step: "chart_open",
            message: `Patient chart open was skipped because the patient is not currently available in global portal search results. ${notFoundReason}`,
            patientName: workItem.patientIdentity.displayName,
            urlBefore: this.page.url(),
            urlAfter: this.page.url(),
            missing: ["matching patient result"],
            evidence: [
              `Original workbook patient name: ${workItem.patientIdentity.displayName}`,
              `Normalized global search query: ${normalizedSearchName || "unavailable"}`,
              `Normalized expected display name: ${expectedDisplayName || "unavailable"}`,
              `Candidate search result texts: ${resultScan.candidateTexts.join(" | ") || "none"}`,
              `Visible result row count: ${resultScan.rowCount}`,
              `No results marker visible: ${resultScan.noResultsVisible}`,
              ...(debugArtifacts.summaryPath ? [`Debug summary: ${debugArtifacts.summaryPath}`] : []),
            ],
            safeReadConfirmed: true,
          }),
        ],
        activePage: this.page,
      };
    }

    return {
      matchResult: {
        status: "NOT_FOUND",
        searchQuery: normalizedSearchName,
        portalPatientId: null,
        portalDisplayName: null,
        candidateNames,
        note: "Global patient search returned visible result tiles, but no exact patient-name match was found.",
      },
      stepLogs: [
        ...stepLogs,
        createAutomationStepLog({
          step: "patient_search_match_resolution",
          message: "Global patient search returned result tiles, but no exact normalized patient-name match was found.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          found: candidateNames.slice(0, 8),
          evidence: resultCandidates.slice(0, 8).flatMap((candidate) => [
            `Candidate '${candidate.label}' exact=${candidate.exactMatch} containsFirstAndLast=${candidate.containsFirstAndLast} score=${candidate.score}`,
            ...candidate.reasons,
          ]),
          safeReadConfirmed: true,
        }),
        createAutomationStepLog({
          step: "chart_open",
          message: "Patient chart open was skipped because no exact patient tile match was available in the global search modal.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          found: candidateNames.slice(0, 8),
          safeReadConfirmed: true,
        }),
      ],
      activePage: this.page,
    };
  }

  private async openGlobalPatientSearch(
    workItem: PatientEpisodeWorkItem,
    urlBefore: string,
    searchQuery: string,
  ): Promise<GlobalSearchLaunchResult> {
    const stepLogs: AutomationStepLog[] = [];
    const triggerResolution = await this.resolveGlobalSearchTrigger();
    const triggerLocator = triggerResolution.locator;
    const triggerSelectorUsed = triggerResolution.selectorUsed;
    const triggerEvidence = [...triggerResolution.evidence];
    let triggerClickMethod = "standard_click";

    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: searchQuery,
        globalSearchTriggerSelector: triggerSelectorUsed,
      },
      "search trigger found",
    );

    if (!triggerLocator) {
      const debugArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "global-search-control",
        reason: "search-control-missing",
        debugConfig: this.options.debugConfig,
        textHints: ["Search Patient", "Ctrl K", searchQuery],
      });

      stepLogs.push(
        createAutomationStepLog({
          step: "global_patient_search_open",
          message: "Global patient search trigger was not found in the current authenticated portal context.",
          patientName: workItem.patientIdentity.displayName,
          urlBefore,
          urlAfter: this.page.url(),
          missing: ["global patient search trigger"],
          evidence: [
            `Original workbook patient name: ${workItem.patientIdentity.displayName}`,
            `Normalized global search query: ${searchQuery || "unavailable"}`,
            ...triggerEvidence,
            ...(await summarizeButtons(this.page)).map((entry) => `Button: ${entry}`),
            debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
            debugArtifacts.htmlPath ? `Debug HTML: ${debugArtifacts.htmlPath}` : "",
            debugArtifacts.screenshotPath ? `Debug screenshot: ${debugArtifacts.screenshotPath}` : "",
          ].filter(Boolean),
          safeReadConfirmed: true,
        }),
      );

      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      return {
        ready: false,
        searchQuery,
        controlSelectorUsed: null,
        inputSelectorUsed: null,
        searchSurface: null,
        searchSurfaceSelectorUsed: null,
        resultsSnapshot: null,
        stepLogs,
      };
    }

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "READ_NAV",
      description: "click global Search Patient trigger from provider dashboard",
    });
    await triggerLocator.scrollIntoViewIfNeeded().catch(() => undefined);
    const triggerClicked = await triggerLocator.click().then(() => true).catch(() => false);
    if (!triggerClicked) {
      triggerClickMethod = "force_click";
      const forceClicked = await triggerLocator.click({ force: true }).then(() => true).catch(() => false);
      if (!forceClicked) {
        triggerClickMethod = "dom_click";
        await triggerLocator.evaluate((node) => {
          const clickableNode = node as { click?: () => void };
          if (typeof clickableNode.click === "function") {
            clickableNode.click();
          }
        }).catch(() => undefined);
      }
    }
    await waitForPortalPageSettled(this.page, this.options.debugConfig);
    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: searchQuery,
        globalSearchTriggerSelector: triggerSelectorUsed,
        globalSearchTriggerEvidence: triggerEvidence,
        globalSearchTriggerClickMethod: triggerClickMethod,
      },
      "search trigger clicked",
    );

    const searchSurfaceResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.patientSearch.globalSearchSurface,
      step: "global_patient_search_surface",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });
    const searchScope = searchSurfaceResolution.locator ?? this.page;
    const explicitOpenModalHeader = this.page.locator("div.search-header.open").first();
    const explicitResultsContainer = this.page.locator("section.search-body__content").first();
    await explicitOpenModalHeader.waitFor({
      state: "visible",
      timeout: Math.min(this.options.debugConfig?.stepTimeoutMs ?? 6_000, 2_000),
    }).catch(() => undefined);
    await explicitResultsContainer.waitFor({
      state: "visible",
      timeout: 800,
    }).catch(() => undefined);
    const modalVisibilityChoice = await pickFirstVisibleLocator([
      {
        locator: explicitOpenModalHeader,
        summary: "div.search-header.open",
      },
      {
        locator: explicitResultsContainer,
        summary: "section.search-body__content",
      },
      ...(searchSurfaceResolution.locator
        ? [{
            locator: searchSurfaceResolution.locator,
            summary: searchSurfaceResolution.matchedCandidate?.description ?? "resolved global search surface",
          }]
        : []),
    ]);
    const modalVisible = modalVisibilityChoice !== null;
    const modalSelectorUsed = modalVisibilityChoice?.summary ?? searchSurfaceResolution.matchedCandidate?.description ?? null;
    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: searchQuery,
        globalSearchTriggerSelector: triggerSelectorUsed,
        globalSearchModalSelector: modalSelectorUsed,
        modalVisible,
      },
      "search modal visible",
    );
    const explicitPlaceholderInput = searchScope.locator('input[type="text"][placeholder*="Search patients"]').first();
    const explicitClassInput = searchScope.locator("input.search_input").first();
    const explicitOpenHeaderInput = searchScope.locator('div.search-header.open input[type="text"]').first();
    await explicitPlaceholderInput.waitFor({
      state: "visible",
      timeout: Math.min(this.options.debugConfig?.stepTimeoutMs ?? 6_000, 2_500),
    }).catch(() => undefined);
    await explicitClassInput.waitFor({
      state: "visible",
      timeout: 1_000,
    }).catch(() => undefined);
    await explicitOpenHeaderInput.waitFor({
      state: "visible",
      timeout: 1_000,
    }).catch(() => undefined);
    const inputResolution = await resolveFirstVisibleLocator({
      page: searchScope,
      candidates: selectorRegistry.patientSearch.globalSearchInput,
      step: searchSurfaceResolution.locator ? "global_patient_search_input_scoped" : "global_patient_search_input_page",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
    });

    let inputLocator: Locator | null = null;
    let inputSelectorUsed: string | null = null;
    const inputEvidence: string[] = [];
    if (await explicitPlaceholderInput.isVisible().catch(() => false)) {
      inputLocator = explicitPlaceholderInput;
      inputSelectorUsed = 'input[type="text"][placeholder*="Search patients"]';
      inputEvidence.push("Search input found by confirmed Search patients placeholder selector.");
    } else if (await explicitClassInput.isVisible().catch(() => false)) {
      inputLocator = explicitClassInput;
      inputSelectorUsed = "input.search_input";
      inputEvidence.push("Search input found by confirmed search_input class selector.");
    } else if (await explicitOpenHeaderInput.isVisible().catch(() => false)) {
      inputLocator = explicitOpenHeaderInput;
      inputSelectorUsed = 'div.search-header.open input[type="text"]';
      inputEvidence.push("Search input found by confirmed open search-header selector.");
    } else if (inputResolution.locator) {
      inputLocator = inputResolution.locator;
      inputSelectorUsed = inputResolution.matchedCandidate?.description ?? "selectorRegistry.patientSearch.globalSearchInput";
      inputEvidence.push(`Search input found by fallback selector '${inputSelectorUsed}'.`);
    }

    stepLogs.push(
      createAutomationStepLog({
        step: "global_patient_search_open",
        message: inputLocator
          ? "Clicked the global Search Patient trigger and found the visible search input."
          : "Clicked the global Search Patient trigger and will type into the auto-focused field before falling back to a visible input.",
        patientName: workItem.patientIdentity.displayName,
        urlBefore,
        urlAfter: this.page.url(),
        selectorUsed: triggerSelectorUsed,
        found: inputLocator ? ["Search Patient trigger", "search input"] : ["Search Patient trigger"],
        missing: [],
        evidence: [
          `Original workbook patient name: ${workItem.patientIdentity.displayName}`,
          `Normalized global search query: ${searchQuery || "unavailable"}`,
          `Search trigger clicked: true`,
          `Trigger click method: ${triggerClickMethod}`,
          `Search modal visible: ${modalVisible}`,
          `Global search control selector used: ${triggerSelectorUsed ?? "unknown"}`,
          `Global search surface selector used: ${searchSurfaceResolution.matchedCandidate?.description ?? "unresolved"}`,
          `Global search modal selector used: ${modalSelectorUsed ?? "unknown"}`,
          ...triggerEvidence,
          ...searchSurfaceResolution.attempts.map(selectorAttemptToEvidence),
          ...inputEvidence,
          ...inputResolution.attempts.map(selectorAttemptToEvidence),
        ],
        safeReadConfirmed: true,
      }),
    );

    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: searchQuery,
        searchInputFound: Boolean(inputLocator),
        globalSearchInputSelector: inputSelectorUsed,
      },
      "search input found",
    );

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "READ_FILTER",
      description: `type normalized patient query ${searchQuery} into focused global search field`,
    });
    let typingIntoFocusedFieldSucceeded = false;
    let usedDirectInputFallback = false;
    await this.page.keyboard.press("Control+A").catch(() => undefined);
    await this.page.keyboard.press("Backspace").catch(() => undefined);
    await this.page.keyboard.type(searchQuery, { delay: 40 }).catch(() => undefined);
    await waitForPortalPageSettled(this.page, this.options.debugConfig, 200);

    await explicitResultsContainer.waitFor({
      state: "visible",
      timeout: Math.min(this.options.debugConfig?.stepTimeoutMs ?? 6_000, 2_500),
    }).catch(() => undefined);
    let resultsSnapshot = await this.waitForSearchResults(searchSurfaceResolution.locator ?? this.page);
    if (resultsSnapshot.ready && resultsSnapshot.rowCount > 0) {
      typingIntoFocusedFieldSucceeded = true;
    }

    if (!typingIntoFocusedFieldSucceeded) {
      if (!inputLocator) {
        const debugArtifacts = await capturePageDebugArtifacts({
          page: this.page,
          outputDir: this.options.debugDir,
          step: "global-search-input",
          reason: "search-input-missing",
          debugConfig: this.options.debugConfig,
          textHints: ["Search Patient", "patient", searchQuery],
        });
        stepLogs.push(
          createAutomationStepLog({
            step: "patient_search_input",
            message: "Typing into the auto-focused global search field did not produce results, and no visible input was available for fallback fill.",
            patientName: workItem.patientIdentity.displayName,
            urlBefore: this.page.url(),
            urlAfter: this.page.url(),
            missing: ["global patient search input fallback"],
            evidence: [
              `Typing into focused field succeeded: false`,
              `Candidate search result texts: ${resultsSnapshot.candidateTexts.join(" | ") || "none"}`,
              ...inputEvidence,
              ...(await summarizeInputs(this.page)).map((entry) => `Input: ${entry}`),
              debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
              debugArtifacts.htmlPath ? `Debug HTML: ${debugArtifacts.htmlPath}` : "",
            ].filter(Boolean),
            safeReadConfirmed: true,
          }),
        );
        await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
        return {
          ready: false,
          searchQuery,
          controlSelectorUsed: triggerSelectorUsed,
          inputSelectorUsed: null,
          searchSurface: searchSurfaceResolution.locator,
          searchSurfaceSelectorUsed: searchSurfaceResolution.matchedCandidate?.description ?? null,
          resultsSnapshot,
          stepLogs,
        };
      }

      usedDirectInputFallback = true;
      await inputLocator.click().catch(() => undefined);
      await inputLocator.fill("").catch(() => undefined);
      await inputLocator.fill(searchQuery).catch(() => undefined);
      await waitForPortalPageSettled(this.page, this.options.debugConfig, 200);
      resultsSnapshot = await this.waitForSearchResults(searchSurfaceResolution.locator ?? this.page);
    }

    this.options.logger?.info(
      {
        originalWorkbookPatientName: workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: searchQuery,
        globalSearchTriggerSelector: triggerSelectorUsed,
        globalSearchInputSelector: inputSelectorUsed,
        typingIntoFocusedFieldSucceeded,
        usedDirectInputFallback,
        searchQueryTyped: searchQuery,
        resultCount: resultsSnapshot.rowCount,
        candidateSearchResultTexts: resultsSnapshot.candidateTexts,
      },
      "search query typed",
    );

    stepLogs.push(
      createAutomationStepLog({
        step: "patient_search_input",
        message: resultsSnapshot.ready
          ? "Typed the normalized query into the global patient search and waited for results."
          : "Typed the normalized query into the global patient search, but the results UI did not settle clearly.",
        patientName: workItem.patientIdentity.displayName,
        urlBefore: this.page.url(),
        urlAfter: this.page.url(),
        selectorUsed: inputSelectorUsed,
        found: resultsSnapshot.candidateTexts.slice(0, 8),
        missing: resultsSnapshot.ready ? [] : ["settled global patient search results"],
        evidence: [
          `Search trigger clicked: true`,
          `Search input found: true`,
          `Typing into focused field succeeded: ${typingIntoFocusedFieldSucceeded}`,
          `Used direct input fallback: ${usedDirectInputFallback}`,
          `Search query typed: ${searchQuery || "unavailable"}`,
          `Result count: ${resultsSnapshot.rowCount}`,
          `Candidate search result texts: ${resultsSnapshot.candidateTexts.join(" | ") || "none"}`,
          ...resultsSnapshot.evidence,
        ],
        safeReadConfirmed: true,
      }),
    );

    return {
      ready: true,
      searchQuery,
      controlSelectorUsed: triggerSelectorUsed,
      inputSelectorUsed,
      searchSurface: searchSurfaceResolution.locator,
      searchSurfaceSelectorUsed: searchSurfaceResolution.matchedCandidate?.description ?? null,
      resultsSnapshot,
      stepLogs,
    };
  }

  private async waitForSearchResults(searchScope: Page | Locator): Promise<SearchResultsSnapshot> {
    const evidence: string[] = [];

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await waitForPortalPageSettled(this.page, this.options.debugConfig, 200);
      const directTileLocator = searchScope.locator("section.search-body__content div.search-body__item");
      const directSectionTileLocator = searchScope.locator("section.search-body__content").filter({ has: searchScope.locator("div.search-body__item") });
      const directHighlightTileLocator = searchScope.locator("div.search-body__item").filter({ has: searchScope.locator("ngb-highlight") });
      const directClickableTileLocator = searchScope.locator('section.search-body__content[tabindex="0"], div.search-body__item[tabindex="0"], section.search-body__content :is(a[href], button, [role="button"], [role="link"]):has(ngb-highlight)');
      const directSectionTileVisibleCount = await countVisibleLocators(directSectionTileLocator, 20);
      const directTileVisibleCount = await countVisibleLocators(directTileLocator, 20);
      const directHighlightTileVisibleCount = await countVisibleLocators(directHighlightTileLocator, 20);
      const directClickableTileVisibleCount = await countVisibleLocators(directClickableTileLocator, 20);
      const directResultLocators: Locator[] = [];

      if (directSectionTileVisibleCount > 0 && directTileVisibleCount === 0) {
        const limit = Math.min(await directSectionTileLocator.count().catch(() => 0), 20);
        for (let index = 0; index < limit; index += 1) {
          const item = directSectionTileLocator.nth(index);
          if (await item.isVisible().catch(() => false)) {
            directResultLocators.push(item);
          }
        }
      } else if (directTileVisibleCount > 0) {
        const limit = Math.min(await directTileLocator.count().catch(() => 0), 20);
        for (let index = 0; index < limit; index += 1) {
          const item = directTileLocator.nth(index);
          if (await item.isVisible().catch(() => false)) {
            directResultLocators.push(item);
          }
        }
      } else if (directHighlightTileVisibleCount > 0) {
        const limit = Math.min(await directHighlightTileLocator.count().catch(() => 0), 20);
        for (let index = 0; index < limit; index += 1) {
          const item = directHighlightTileLocator.nth(index);
          if (await item.isVisible().catch(() => false)) {
            directResultLocators.push(item);
          }
        }
      } else if (directClickableTileVisibleCount > 0) {
        const limit = Math.min(await directClickableTileLocator.count().catch(() => 0), 20);
        for (let index = 0; index < limit; index += 1) {
          const item = directClickableTileLocator.nth(index);
          if (await item.isVisible().catch(() => false)) {
            directResultLocators.push(item);
          }
        }
      }

      if (directResultLocators.length > 0) {
        const candidateTexts = (await Promise.all(
          directResultLocators.slice(0, 8).map(async (item) => readVisibleLocatorText(item)),
        )).filter(Boolean);
        const textSample = candidateTexts.join(" | ").slice(0, 400);
        const resultSelectorUsed = directSectionTileVisibleCount > 0 && directTileVisibleCount === 0
          ? "section.search-body__content"
          : directTileVisibleCount > 0
          ? "section.search-body__content div.search-body__item"
          : directHighlightTileVisibleCount > 0
            ? "div.search-body__item:has(ngb-highlight)"
            : "section.search-body__content clickable tiles";
        evidence.push(`attempt=${attempt} resultSelector=${resultSelectorUsed} rowCount=${directResultLocators.length} text=${textSample || "none"}`);
        return {
          ready: true,
          rowCount: directResultLocators.length,
          candidateTexts,
          textSample,
          noResultsVisible: false,
          resultSelectorUsed,
          evidence,
          resultLocators: directResultLocators,
        };
      }

      const resolution = await resolveVisibleLocatorList({
        page: searchScope,
        candidates: selectorRegistry.patientSearch.resultRows,
        step: "global_patient_search_results_wait",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 20,
      });

      if (resolution.items.length > 0) {
        const candidateTexts = await Promise.all(
          resolution.items.slice(0, 8).map(async (item) => readVisibleLocatorText(item.locator)),
        );
        const nonEmptyCandidateTexts = candidateTexts.filter(Boolean);
        const textSample = nonEmptyCandidateTexts.join(" | ").slice(0, 400);
        evidence.push(`attempt=${attempt} rowCount=${resolution.items.length} text=${textSample || "none"}`);
        return {
          ready: true,
          rowCount: resolution.items.length,
          candidateTexts: nonEmptyCandidateTexts,
          textSample,
          noResultsVisible: false,
          resultSelectorUsed: resolution.items[0]?.candidate.description ?? null,
          evidence,
          resultLocators: resolution.items.map((item) => item.locator),
        };
      }

      const noResultsVisible = await searchScope.getByText(/no results|no patient|no matches|no records/i).first().isVisible().catch(() => false);
      const searchTextSample = await dumpTopVisibleText(this.page, 240);
      evidence.push(`attempt=${attempt} rowCount=0 noResults=${noResultsVisible} text=${searchTextSample}`);
      if (noResultsVisible) {
        return {
          ready: true,
          rowCount: 0,
          candidateTexts: [],
          textSample: searchTextSample,
          noResultsVisible: true,
          resultSelectorUsed: null,
          evidence,
        };
      }
    }

    return {
      ready: false,
      rowCount: 0,
      candidateTexts: [],
      textSample: await dumpTopVisibleText(this.page, 240),
      noResultsVisible: false,
      resultSelectorUsed: null,
      evidence,
    };
  }

  private async collectResultCandidates(
    workItem: PatientEpisodeWorkItem,
    searchQuery: string,
    expectedDisplayName: string,
    searchScope: Page | Locator,
  ): Promise<SearchResultsSnapshot & { candidates: SearchResultCandidate[] }> {
    const explicitSectionTileLocator = searchScope.locator("section.search-body__content").filter({ has: searchScope.locator("div.search-body__item") });
    const explicitTileLocator = searchScope.locator("section.search-body__content div.search-body__item");
    const explicitHighlightTileLocator = searchScope.locator("div.search-body__item").filter({ has: searchScope.locator("ngb-highlight") });
    const explicitSectionTileCount = await countVisibleLocators(explicitSectionTileLocator, 40);
    const explicitTileCount = await countVisibleLocators(explicitTileLocator, 40);
    const explicitHighlightTileCount = await countVisibleLocators(explicitHighlightTileLocator, 40);
    const resolution = explicitSectionTileCount > 0 && explicitTileCount === 0
      ? {
          items: await (async () => {
            const items: Array<{ locator: Locator; candidate: { description: string } }> = [];
            const count = Math.min(await explicitSectionTileLocator.count().catch(() => 0), 40);
            for (let index = 0; index < count; index += 1) {
              const item = explicitSectionTileLocator.nth(index);
              if (await item.isVisible().catch(() => false)) {
                items.push({
                  locator: item,
                  candidate: { description: "section.search-body__content" },
                });
              }
            }
            return items;
          })(),
          attempts: [],
        }
      : explicitTileCount > 0
      ? {
          items: await (async () => {
            const items: Array<{ locator: Locator; candidate: { description: string } }> = [];
            const count = Math.min(await explicitTileLocator.count().catch(() => 0), 40);
            for (let index = 0; index < count; index += 1) {
              const item = explicitTileLocator.nth(index);
              if (await item.isVisible().catch(() => false)) {
                items.push({
                  locator: item,
                  candidate: { description: "section.search-body__content div.search-body__item" },
                });
              }
            }
            return items;
          })(),
          attempts: [],
        }
      : explicitHighlightTileCount > 0
        ? {
            items: await (async () => {
              const items: Array<{ locator: Locator; candidate: { description: string } }> = [];
              const count = Math.min(await explicitHighlightTileLocator.count().catch(() => 0), 40);
              for (let index = 0; index < count; index += 1) {
                const item = explicitHighlightTileLocator.nth(index);
                if (await item.isVisible().catch(() => false)) {
                  items.push({
                    locator: item,
                    candidate: { description: "div.search-body__item:has(ngb-highlight)" },
                  });
                }
              }
              return items;
            })(),
            attempts: [],
          }
        : await resolveVisibleLocatorList({
            page: searchScope,
            candidates: selectorRegistry.patientSearch.resultRows,
            step: "patient_search_results",
            logger: this.options.logger,
            debugConfig: this.options.debugConfig,
            maxItems: 40,
          });
    const candidates: SearchResultCandidate[] = [];
    const candidateTexts: string[] = [];
    const nameParts = extractGlobalSearchNameParts(expectedDisplayName);
    const expectedDisplayComparable = normalizeWhitespace(expectedDisplayName).toUpperCase();

    for (const result of resolution.items) {
      const tileSection = result.locator.locator("xpath=ancestor-or-self::section[contains(concat(' ', normalize-space(@class), ' '), ' search-body__content ')][1]").first();
      const tileItem = result.locator.locator("xpath=ancestor-or-self::div[contains(concat(' ', normalize-space(@class), ' '), ' search-body__item ')][1]").first();
      const tileLocator = await tileItem.isVisible().catch(() => false)
        ? tileItem
        : await result.locator.isVisible().catch(() => false)
          ? result.locator
          : tileSection;
      const directLink = tileLocator
        .locator('a[href*="/client/"][href*="/intake/"], a[href*="/client/"][href*="/calendar"], a[href*="/patient/"]')
        .first();
      const sectionText = normalizeWhitespace(await tileSection.innerText().catch(() => null));
      const linkText = normalizeWhitespace(await directLink.textContent().catch(() => null));
      const highlightNode = tileSection.locator("ngb-highlight, ngb-highlight span").first();
      const highlightText = normalizeWhitespace(await highlightNode.textContent().catch(() => null));
      const rowText = normalizeWhitespace(await tileLocator.innerText().catch(() => null));
      const authoritativePatientName = highlightText || normalizeWhitespace(await tileSection.locator("ngb-highlight span").first().textContent().catch(() => null));
      const label = authoritativePatientName || rowText || linkText || sectionText;

      if (!label) {
        continue;
      }

      candidateTexts.push(authoritativePatientName || label);
      const combinedText = normalizeWhitespace(`${label} ${rowText} ${sectionText}`);
      const comparableDisplayLabel = normalizeWhitespace(authoritativePatientName || label).toUpperCase();
      const normalizedLabel = normalizeComparable(label);
      const normalizedRowText = normalizeComparable(rowText);
      const normalizedCombinedText = normalizeComparable(combinedText);
      const scoring = scorePatientSearchCandidate(workItem, combinedText);
      const exactMatch = comparableDisplayLabel.startsWith(expectedDisplayComparable) ||
        normalizedLabel === nameParts.normalizedQuery ||
        normalizedCombinedText === nameParts.normalizedQuery;
      const containsFullQuery = Boolean(nameParts.normalizedQuery) && normalizedCombinedText.includes(nameParts.normalizedQuery);
      const containsFirstAndLast = Boolean(nameParts.lastName) &&
        Boolean(nameParts.firstToken) &&
        normalizedCombinedText.includes(nameParts.lastName) &&
        normalizedCombinedText.includes(nameParts.firstToken);
      const reasons = [...scoring.reasons];

      if (exactMatch) {
        reasons.push("ngb-highlight patient-name text starts with the normalized LAST, FIRST display name");
      }
      if (containsFullQuery && !exactMatch) {
        reasons.push("row text contains the full normalized global search query");
      }
      if (containsFirstAndLast) {
        reasons.push("row/card text contains both last and first name tokens");
      }
      if (nameParts.firstName && normalizedRowText.includes(nameParts.firstName)) {
        reasons.push("row text contains the full first-name segment");
      }

      candidates.push({
        label: authoritativePatientName || label,
        rowText: rowText || label,
        rowLocator: tileLocator,
        rowSelector: result.candidate.description,
        containerSummary: await summarizeLocatorContext(
          await tileSection.isVisible().catch(() => false) ? tileSection : tileLocator,
        ),
        portalPatientId:
          (await tileLocator.getAttribute("data-patient-id").catch(() => null)) ??
          (await tileLocator.getAttribute("data-id").catch(() => null)),
        score: scoring.score + (exactMatch ? 200 : 0) + (containsFullQuery ? 120 : 0) + (containsFirstAndLast ? 60 : 0),
        reasons,
        queryUsed: searchQuery,
        exactMatch,
        containsFullQuery,
        containsFirstAndLast,
      });
    }

    const noResultsVisible = await searchScope.getByText(/no results|no patient|no matches|no records/i).first().isVisible().catch(() => false);
    const textSample = candidateTexts.join(" | ").slice(0, 400) || await dumpTopVisibleText(this.page, 240);
    const evidence = [
      `rowCount=${resolution.items.length}`,
      `noResultsVisible=${noResultsVisible}`,
      `Normalized query typed=${searchQuery}`,
      `Normalized expected display name=${expectedDisplayName}`,
      ...candidateTexts.slice(0, 8).map((text, index) => `candidate[${index + 1}]=${text}`),
    ];

    if (candidates.length === 0 && this.options.debugDir) {
      const debugArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "patient-search-results",
        reason: "rows-missing",
        debugConfig: this.options.debugConfig,
        textHints: [searchQuery, workItem.patientIdentity.displayName],
      });

      if (debugArtifacts.summaryPath && this.options.logger) {
        this.options.logger.warn(
          {
            searchQuery,
            summaryPath: debugArtifacts.summaryPath,
            url: this.page.url(),
            candidateTexts,
          },
          "global patient search returned no visible result rows",
        );
      }
    }

    return {
      ready: true,
      candidates,
      rowCount: resolution.items.length,
      candidateTexts,
      textSample,
      noResultsVisible,
      resultSelectorUsed: resolution.items[0]?.candidate.description ?? null,
      evidence,
    };
  }

  private async completeResolvedPatientMatch(input: {
    candidate: SearchResultCandidate;
    candidateNames: string[];
    normalizedSearchName: string;
    expectedDisplayName: string;
    stepLogs: AutomationStepLog[];
    workItem: PatientEpisodeWorkItem;
  }): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
    activePage: Page;
  }> {
    const chartOpen = await this.openChartForCandidate(input.candidate, input.workItem, input.normalizedSearchName);
    this.options.logger?.info(
      {
        originalWorkbookPatientName: input.workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: input.normalizedSearchName,
        normalizedExpectedDisplayName: input.expectedDisplayName,
        candidateTileTexts: input.candidateNames,
        exactMatchedTileText: input.candidate.label,
        matchedTileText: input.candidate.label,
        matchedPatientResultText: input.candidate.label,
        clickedPatientResult: input.candidate.rowText,
        clickedTileSelector: input.candidate.rowSelector,
        clickedTileContainerSummary: input.candidate.containerSummary,
        clickTargetUsed: chartOpen.selectorUsed,
      urlAfterPatientNavigation: chartOpen.activePage.url(),
      clickCausedNavigation: chartOpen.opened,
      chartPageMarkersFound: chartOpen.found,
    },
      "patient search result selected",
    );

    return {
      matchResult: {
        status: chartOpen.opened ? "EXACT" : "ERROR",
        searchQuery: input.normalizedSearchName,
        portalPatientId: input.candidate.portalPatientId,
        portalDisplayName: input.candidate.label,
        candidateNames: input.candidateNames,
        note: chartOpen.opened ? null : chartOpen.message,
      },
      stepLogs: [
        ...input.stepLogs,
        createAutomationStepLog({
          step: "patient_search_match_resolution",
          message: `Selected patient result '${input.candidate.label}' from the global search.`,
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          found: [input.candidate.label],
          evidence: [
            `Matched patient result text: ${input.candidate.label}`,
            `Matched row text: ${input.candidate.rowText}`,
            `Normalized global search query: ${input.normalizedSearchName}`,
            `Normalized expected display name: ${input.expectedDisplayName}`,
            `Clicked tile selector/container summary: ${input.candidate.rowSelector} :: ${input.candidate.containerSummary}`,
            ...input.candidate.reasons,
          ],
          safeReadConfirmed: true,
        }),
        createAutomationStepLog({
          step: "chart_open",
          message: chartOpen.message,
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: this.page.url(),
          urlAfter: chartOpen.activePage.url(),
          selectorUsed: chartOpen.selectorUsed,
          found: chartOpen.found,
          missing: chartOpen.opened ? [] : ["patient chart"],
          evidence: chartOpen.evidence,
          safeReadConfirmed: true,
        }),
      ],
      activePage: chartOpen.activePage,
    };
  }

  private buildAmbiguousSearchResult(input: {
    workItem: PatientEpisodeWorkItem;
    searchQuery: string;
    stepLogs: AutomationStepLog[];
    candidateNames: string[];
    candidates: SearchResultCandidate[];
    message: string;
  }): {
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
    activePage: Page;
  } {
    const ambiguityEvidence = input.candidates.slice(0, 8).flatMap((candidate) => [
      `Ambiguous candidate '${candidate.label}' score=${candidate.score} exact=${candidate.exactMatch} containsFirstAndLast=${candidate.containsFirstAndLast}`,
      ...candidate.reasons,
    ]);

    this.options.logger?.warn(
      {
        originalWorkbookPatientName: input.workItem.patientIdentity.displayName,
        normalizedGlobalSearchQuery: input.searchQuery,
        candidateSearchResultTexts: input.candidateNames,
      },
      "global patient search remained ambiguous",
    );

    return {
      matchResult: {
        status: "AMBIGUOUS",
        searchQuery: input.searchQuery,
        portalPatientId: null,
        portalDisplayName: null,
        candidateNames: input.candidateNames,
        note: input.message,
      },
      stepLogs: [
        ...input.stepLogs,
        createAutomationStepLog({
          step: "patient_search_match_resolution",
          message: input.message,
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          found: input.candidateNames.slice(0, 8),
          evidence: ambiguityEvidence,
          safeReadConfirmed: true,
        }),
        createAutomationStepLog({
          step: "chart_open",
          message: "Patient chart open was skipped because global patient search results were ambiguous.",
          patientName: input.workItem.patientIdentity.displayName,
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          found: input.candidateNames.slice(0, 8),
          evidence: ambiguityEvidence,
          safeReadConfirmed: true,
        }),
      ],
      activePage: this.page,
    };
  }

  private async waitForStableDom(stableMs: number): Promise<boolean> {
    return this.page.evaluate(async (targetStableMs) => {
      await new Promise<void>((resolve) => {
        let stableTimer: ReturnType<typeof setTimeout> | null = null;
        let finished = false;
        const browserGlobal = globalThis as any;
        const body = browserGlobal.document?.body;

        const observer = typeof browserGlobal.MutationObserver === "function" && body
          ? new browserGlobal.MutationObserver(() => {
              schedule();
            })
          : null;

        const complete = () => {
          if (finished) {
            return;
          }
          finished = true;
          observer?.disconnect();
          if (stableTimer) {
            clearTimeout(stableTimer);
          }
          resolve();
        };

        const schedule = () => {
          if (stableTimer) {
            clearTimeout(stableTimer);
          }
          stableTimer = setTimeout(complete, targetStableMs);
        };

        if (!observer || !body) {
          schedule();
          setTimeout(complete, Math.max(targetStableMs * 2, 1_500));
          return;
        }

        observer.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
        });

        schedule();
        setTimeout(complete, Math.max(targetStableMs * 2, 1_500));
      });

      return true;
    }, stableMs).catch(() => false);
  }

  private async openChartForCandidate(
    candidate: SearchResultCandidate,
    workItem: PatientEpisodeWorkItem,
    searchQuery: string,
  ): Promise<{
    opened: boolean;
    activePage: Page;
    selectorUsed: string | null;
    found: string[];
    evidence: string[];
    message: string;
  }> {
    const tileSection = candidate.rowLocator.locator("xpath=ancestor-or-self::section[contains(concat(' ', normalize-space(@class), ' '), ' search-body__content ')][1]").first();
    const tileContainer = candidate.rowLocator.locator("xpath=ancestor-or-self::*[contains(concat(' ', normalize-space(@class), ' '), ' search-body__item ')][1]").first();
    const focusableTile = candidate.rowLocator.locator("xpath=ancestor-or-self::*[@tabindex='0'][1]").first();
    const highlightLocator = candidate.rowLocator.locator("ngb-highlight").first();
    const clickableHighlightParent = highlightLocator
      .locator("xpath=ancestor::*[self::a or self::button or @role='link' or @role='button' or contains(concat(' ', normalize-space(@class), ' '), ' search-body__item ')][1]")
      .first();
    const clickableTileChild = tileContainer
      .locator(":is(a[href], button, [role='button'], [role='link'])")
      .first();
    const exactNamedLink = candidate.rowLocator.getByRole("link", { name: buildPatientLinkNamePattern(searchQuery) }).first();
    const displayNameLink = candidate.rowLocator.getByRole("link", { name: buildPatientLinkNamePattern(workItem.patientIdentity.displayName) }).first();
    const directPatientLink = candidate.rowLocator.locator('a[href*="/client/"][href*="/intake/"], a[href*="/client/"][href*="/calendar"], a[href*="/patient/"]').first();
    const preferredEvidence: string[] = [];
    let clickTargetLocator: Locator | null = null;
    let selectorUsed: string | null = null;

    if (await tileSection.isVisible().catch(() => false)) {
      clickTargetLocator = tileSection;
      selectorUsed = `${candidate.rowSelector} :: section.search-body__content`;
      preferredEvidence.push("Preferred click target was the outer search-body__content tile section.");
    } else if (await clickableHighlightParent.isVisible().catch(() => false)) {
      clickTargetLocator = clickableHighlightParent;
      selectorUsed = `${candidate.rowSelector} :: nearest clickable parent around ngb-highlight`;
      preferredEvidence.push("Preferred click target was the nearest clickable parent around the highlighted patient name.");
    } else if (await clickableTileChild.isVisible().catch(() => false)) {
      clickTargetLocator = clickableTileChild;
      selectorUsed = `${candidate.rowSelector} :: clickable control inside tile`;
      preferredEvidence.push("Preferred click target was a clickable control inside the matched patient result tile.");
    } else if (await tileContainer.isVisible().catch(() => false)) {
      clickTargetLocator = tileContainer;
      selectorUsed = `${candidate.rowSelector} :: tile container`;
      preferredEvidence.push("Preferred click target was the matched patient result tile container.");
    } else if (await exactNamedLink.isVisible().catch(() => false)) {
      clickTargetLocator = exactNamedLink;
      selectorUsed = `role=link name=${buildPatientLinkNamePattern(searchQuery).toString()}`;
      preferredEvidence.push("Preferred patient result link matched the normalized LAST, FIRST query.");
    } else if (await displayNameLink.isVisible().catch(() => false)) {
      clickTargetLocator = displayNameLink;
      selectorUsed = `role=link name=${buildPatientLinkNamePattern(workItem.patientIdentity.displayName).toString()}`;
      preferredEvidence.push("Preferred patient result link matched the workbook display name.");
    } else if (await directPatientLink.isVisible().catch(() => false)) {
      clickTargetLocator = directPatientLink;
      selectorUsed = 'a[href*="/client/"][href*="/intake/"], a[href*="/client/"][href*="/calendar"], a[href*="/patient/"]';
      preferredEvidence.push("Preferred patient result anchor matched the portal patient href pattern.");
    }

    const clickTarget = clickTargetLocator
      ? { locator: clickTargetLocator, matchedCandidate: null, attempts: [] }
      : await resolveFirstVisibleLocator({
          page: candidate.rowLocator,
          candidates: selectorRegistry.patientSearch.resultOpenTargets,
          step: "patient_chart_open_target",
          logger: this.options.logger,
          debugConfig: this.options.debugConfig,
        });

    if (!selectorUsed) {
      selectorUsed = clickTarget.matchedCandidate?.description ?? candidate.rowSelector;
    }

    const currentPage = this.page;
    const urlBefore = currentPage.url();
    const dashboardUrlBeforeClick = urlBefore;
    const newPagePromise = currentPage.context().waitForEvent("page", {
      timeout: this.options.debugConfig?.stepTimeoutMs ?? 6_000,
    }).catch(() => null);

    assertReadOnlyActionAllowed({
      safety: this.safety,
      actionClass: "READ_NAV",
      description: `open patient chart for ${workItem.patientIdentity.displayName} from global search results`,
    });

    const resolvedClickTarget = clickTarget.locator ?? candidate.rowLocator;
    if (clickTarget.locator) {
      await clickTarget.locator.click().catch(() => undefined);
    } else {
      await candidate.rowLocator.click().catch(() => undefined);
    }

    await waitForPortalPageSettled(currentPage, this.options.debugConfig);
    const openedPage = await newPagePromise;
    const activePage = openedPage ?? currentPage;
    if (openedPage) {
      await waitForPortalPageSettled(openedPage, this.options.debugConfig);
    }

    const navigationEvidence: string[] = [];
    let foundIndicators: string[] = [];
    let opened = false;
    let dashboardUrlChanged = false;
    let usedEnterRetry = false;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await waitForPortalPageSettled(activePage, this.options.debugConfig, 250);
      foundIndicators = await this.detectChartIndicators(activePage);
      const urlAfter = activePage.url();
      const urlChanged = urlAfter !== urlBefore;
      dashboardUrlChanged = urlAfter !== dashboardUrlBeforeClick && !/\/dashboard(?:[/?#]|$)/i.test(urlAfter);
      const urlLooksLikePatientIntakePage = /\/client\/.+\/intake/i.test(urlAfter);
      const chartMarkersFound = foundIndicators.length > 0;
      navigationEvidence.push(
        `attempt=${attempt} urlChanged=${urlChanged} dashboardUrlChanged=${dashboardUrlChanged} urlLooksLikePatientIntakePage=${urlLooksLikePatientIntakePage} chartMarkersFound=${chartMarkersFound} markers=${foundIndicators.join(" | ") || "none"} url=${urlAfter}`,
      );

      if (dashboardUrlChanged && (urlLooksLikePatientIntakePage || chartMarkersFound)) {
        opened = true;
        break;
      }
    }

    if (!opened) {
      this.options.logger?.warn(
        {
          exactMatchedTileText: candidate.label,
          clickTargetUsed: selectorUsed,
          navigationUrlAfterClick: activePage.url(),
        },
        "patient tile click did not navigate; retrying with focus and Enter",
      );
      const enterTarget = await pickFirstVisibleLocator([
        {
          locator: focusableTile,
          summary: `${candidate.rowSelector} :: focusable tile tabindex=0`,
        },
        {
          locator: resolvedClickTarget,
          summary: `${selectorUsed ?? candidate.rowSelector} :: retry target`,
        },
      ]);

      if (enterTarget) {
        usedEnterRetry = true;
        selectorUsed = enterTarget.summary;
        await enterTarget.locator.focus().catch(() => undefined);
        await this.page.keyboard.press("Enter").catch(() => undefined);
        await waitForPortalPageSettled(activePage, this.options.debugConfig, 250);

        for (let attempt = 1; attempt <= 4; attempt += 1) {
          await waitForPortalPageSettled(activePage, this.options.debugConfig, 250);
          foundIndicators = await this.detectChartIndicators(activePage);
          const urlAfter = activePage.url();
          const urlChanged = urlAfter !== urlBefore;
          dashboardUrlChanged = urlAfter !== dashboardUrlBeforeClick && !/\/dashboard(?:[/?#]|$)/i.test(urlAfter);
          const urlLooksLikePatientIntakePage = /\/client\/.+\/intake/i.test(urlAfter);
          const chartMarkersFound = foundIndicators.length > 0;
          navigationEvidence.push(
            `enterRetryAttempt=${attempt} urlChanged=${urlChanged} dashboardUrlChanged=${dashboardUrlChanged} urlLooksLikePatientIntakePage=${urlLooksLikePatientIntakePage} chartMarkersFound=${chartMarkersFound} markers=${foundIndicators.join(" | ") || "none"} url=${urlAfter}`,
          );

          if (dashboardUrlChanged && (urlLooksLikePatientIntakePage || chartMarkersFound)) {
            opened = true;
            break;
          }
        }
      }
    }

    this.options.logger?.info(
      {
        exactMatchedTileText: candidate.label,
        matchedTileText: candidate.label,
        matchedPatientResultText: candidate.label,
        clickedPatientResult: candidate.rowText,
        clickTargetSummary: selectorUsed,
        clickConfirmation: true,
        navigationUrlAfterClick: activePage.url(),
        clickCausedNavigation: opened,
        usedEnterRetry,
        dashboardUrlChanged,
        chartPageMarkersFound: foundIndicators,
      },
      "patient result click navigation check",
    );

    if (!opened) {
      const debugArtifacts = await capturePageDebugArtifacts({
        page: activePage,
        outputDir: this.options.debugDir,
        step: "chart-open",
        reason: "navigation-not-confirmed",
        debugConfig: this.options.debugConfig,
        textHints: [candidate.label, "documents", "chart", "patient"],
      });
      await pauseOnFailureIfRequested(activePage, this.options.debugConfig);

      return {
        opened: false,
        activePage,
        selectorUsed,
        found: foundIndicators,
        evidence: [
          `Matched patient result text: ${candidate.label}`,
          `Clicked patient result text: ${candidate.rowText}`,
          `Clicked tile selector/container summary: ${candidate.rowSelector} :: ${candidate.containerSummary}`,
          `Click target summary: ${selectorUsed ?? "unknown"}`,
          `URL after patient navigation attempt: ${activePage.url()}`,
          `Used Enter retry: ${usedEnterRetry}`,
          `Dashboard URL changed: ${dashboardUrlChanged}`,
          `Chart/page markers found: ${foundIndicators.join(" | ") || "none"}`,
          ...preferredEvidence,
          ...clickTarget.attempts.map(selectorAttemptToEvidence),
          ...candidate.reasons,
          ...navigationEvidence,
          debugArtifacts.summaryPath ? `Debug summary: ${debugArtifacts.summaryPath}` : "",
          debugArtifacts.htmlPath ? `Debug HTML: ${debugArtifacts.htmlPath}` : "",
          debugArtifacts.screenshotPath ? `Debug screenshot: ${debugArtifacts.screenshotPath}` : "",
        ].filter(Boolean),
        message: dashboardUrlChanged
          ? `Patient result '${candidate.label}' was clicked but patient-page markers never confirmed.`
          : `Patient result '${candidate.label}' was clicked but the portal stayed on the dashboard, so the tile click did not open the patient page.`,
      };
    }

    return {
      opened: true,
      activePage,
      selectorUsed,
      found: foundIndicators.length > 0 ? foundIndicators : [candidate.label],
      evidence: [
        `Matched patient result text: ${candidate.label}`,
        `Clicked patient result text: ${candidate.rowText}`,
        `Clicked tile selector/container summary: ${candidate.rowSelector} :: ${candidate.containerSummary}`,
        `Click target summary: ${selectorUsed ?? "unknown"}`,
        `URL after patient navigation: ${activePage.url()}`,
        `Used Enter retry: ${usedEnterRetry}`,
        `Dashboard URL changed: ${dashboardUrlChanged}`,
        `Chart/page markers found: ${foundIndicators.join(" | ") || "none"}`,
        ...preferredEvidence,
        ...clickTarget.attempts.map(selectorAttemptToEvidence),
        ...candidate.reasons,
        ...navigationEvidence,
      ],
      message: `Opened the patient page from global search in read-only mode for ${candidate.label}.`,
    };
  }

  private async detectChartIndicators(page: Page): Promise<string[]> {
    const indicators = await resolveVisibleLocatorList({
      page,
      candidates: selectorRegistry.patientSearch.chartIndicators,
      step: "chart_indicators",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 8,
    });

    const found: string[] = [];
    for (const indicator of indicators.items) {
      const label = normalizeWhitespace(
        (await indicator.locator.getAttribute("aria-label").catch(() => null)) ??
        (await indicator.locator.textContent().catch(() => null)),
      );
      found.push(label || indicator.candidate.description);
    }

    return found;
  }

  private async detectDashboardReadySignal(): Promise<string | null> {
    const primarySignals = [
      'button:has-text("Search Patient")',
      'fin-button:has-text("Search Patient")',
      '[role="button"]:has-text("Search Patient")',
      "fin-datatable",
      ".dashboard",
      "main",
    ] as const;

    for (const selector of primarySignals) {
      const count = await this.page.locator(selector).count().catch(() => 0);
      if (count > 0) {
        return selector;
      }
    }

    return null;
  }
}
