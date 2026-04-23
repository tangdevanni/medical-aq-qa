import type { Locator, Page } from "@playwright/test";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { selectorRegistry } from "../selectorRegistry";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  clickPortalControl,
  dismissVisiblePortalModal,
  resolveFirstVisibleLocator,
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../utils/locatorResolution";
import {
  capturePageDebugArtifacts,
  pauseOnFailureIfRequested,
} from "../utils/pageDiagnostics";

interface ControlCandidate {
  label: string;
  locator: Locator;
}

function normalizeVisibleText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function readControlLabel(locator: Locator): Promise<string> {
  return normalizeVisibleText(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
      (await locator.getAttribute("title").catch(() => null)) ??
      (await locator.textContent().catch(() => null)),
  );
}

export function looksLikeOasisThirtyDaysLabel(value: string): boolean {
  return /oasis\s*30\s*day(?:['’]s|s)?/i.test(value.replace(/\s+/g, " "));
}

export function scoreOasisThirtyDaysControl(label: string): number {
  const normalized = normalizeVisibleText(label).toLowerCase();
  if (!normalized) {
    return 0;
  }
  if (looksLikeOasisThirtyDaysLabel(normalized)) {
    return 1_000;
  }

  let score = 0;
  if (normalized.includes("oasis")) {
    score += 150;
  }
  if (normalized.includes("30")) {
    score += 150;
  }
  if (normalized.includes("day")) {
    score += 100;
  }

  return score;
}

export class FinaleDashboardPage {
  constructor(
    private readonly page: Page,
    private readonly options: {
      logger?: Logger;
      debugConfig?: PortalDebugConfig;
      debugDir?: string;
    } = {},
  ) {}

  async ensureDashboardHome(input: {
    dashboardUrl?: string | null;
  }): Promise<{
    dashboardUrl: string;
    stepLogs: AutomationStepLog[];
  }> {
    const stepLogs: AutomationStepLog[] = [];
    let markerResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.finaleDashboard.pageMarkers,
      step: "dashboard_home_marker",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });

    if (!markerResolution.locator && input.dashboardUrl) {
      const urlBefore = this.page.url();
      await this.page.goto(input.dashboardUrl, { waitUntil: "domcontentloaded" });
      await waitForPortalPageSettled(this.page, this.options.debugConfig);
      markerResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: selectorRegistry.finaleDashboard.pageMarkers,
        step: "dashboard_home_marker_after_nav",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
      });
      stepLogs.push(
        createAutomationStepLog({
          step: "dashboard_home",
          message: "Navigated into the selected agency dashboard home.",
          urlBefore,
          urlAfter: this.page.url(),
          selectorUsed: markerResolution.matchedCandidate?.description ?? null,
          found: markerResolution.locator ? [this.page.url()] : [],
          missing: markerResolution.locator ? [] : ["finaleDashboard.pageMarkers"],
          evidence: markerResolution.attempts.map(selectorAttemptToEvidence),
          safeReadConfirmed: true,
        }),
      );
    }

    if (!markerResolution.locator) {
      const failureArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "dashboard-home",
        reason: "dashboard-not-detected",
        debugConfig: this.options.debugConfig,
        textHints: ["dashboard", "oasis", "search patient"],
      });
      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      throw new Error(
        `The selected agency dashboard home was not detected after login. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
      );
    }

    if (stepLogs.length === 0) {
      stepLogs.push(
        createAutomationStepLog({
          step: "dashboard_home",
          message: "Confirmed the selected agency dashboard home is loaded.",
          urlBefore: this.page.url(),
          urlAfter: this.page.url(),
          selectorUsed: markerResolution.matchedCandidate?.description ?? null,
          found: [this.page.url()],
          evidence: markerResolution.attempts.map(selectorAttemptToEvidence),
          safeReadConfirmed: true,
        }),
      );
    }

    return {
      dashboardUrl: this.page.url(),
      stepLogs,
    };
  }

  async openOasisThirtyDaysPanel(): Promise<{
    selectedTabLabel: string;
    stepLogs: AutomationStepLog[];
  }> {
    const attemptedTabLabels: string[] = [];
    const modalDismissals: string[] = [];
    let tabsResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: selectorRegistry.finaleDashboard.oasisThirtyDaysTabs,
      step: "oasis_thirty_days_tabs",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 30,
    });

    const collectVisibleTabs = async (): Promise<ControlCandidate[]> => {
      const controls: ControlCandidate[] = [];
      for (const item of tabsResolution.items) {
        const label = await readControlLabel(item.locator);
        if (!label) {
          continue;
        }
        controls.push({
          label,
          locator: item.locator,
        });
      }
      return controls;
    };

    let visibleTabs = await collectVisibleTabs();
    if (visibleTabs.length === 0) {
      await waitForPortalPageSettled(this.page, this.options.debugConfig, 500);
      tabsResolution = await resolveVisibleLocatorList({
        page: this.page,
        candidates: selectorRegistry.finaleDashboard.oasisThirtyDaysTabs,
        step: "oasis_thirty_days_tabs_retry",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        maxItems: 30,
      });
      visibleTabs = await collectVisibleTabs();
    }

    const rankedTabs = visibleTabs
      .map((entry) => ({ ...entry, score: scoreOasisThirtyDaysControl(entry.label) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    if (rankedTabs.length === 0) {
      const failureArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "oasis-thirty-days",
        reason: "tab-not-found",
        debugConfig: this.options.debugConfig,
        textHints: ["OASIS 30 Day's", "OASIS 30 Days", "OASIS 30"],
      });
      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      throw new Error(
        `The 'OASIS 30 Day's' tab was not found on the Finale dashboard. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
      );
    }

    const urlBefore = this.page.url();
    for (const candidate of rankedTabs) {
      attemptedTabLabels.push(candidate.label);
      const modalDismissal = await dismissVisiblePortalModal({
        page: this.page,
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
      });
      if (modalDismissal.dismissed) {
        modalDismissals.push(
          `${modalDismissal.selectorUsed ?? "unknown"}:${modalDismissal.actionUsed ?? "unknown"}`,
        );
      }

      await clickPortalControl({
        page: this.page,
        locator: candidate.locator,
        debugConfig: this.options.debugConfig,
      }).catch(() => undefined);

      const panelResolution = await resolveFirstVisibleLocator({
        page: this.page,
        candidates: [
          ...selectorRegistry.finaleDashboard.exportControls,
          ...selectorRegistry.finaleDashboard.panelReadinessSignals,
        ],
        step: "oasis_thirty_days_panel_ready",
        logger: this.options.logger,
        debugConfig: this.options.debugConfig,
        settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
      });

      if (!panelResolution.locator) {
        continue;
      }

      this.options.logger?.info(
        {
          selectedTabLabel: candidate.label,
          dashboardUrl: this.page.url(),
          modalDismissals,
        },
        "located OASIS 30 Day's dashboard tab",
      );

      return {
        selectedTabLabel: candidate.label,
        stepLogs: [
          createAutomationStepLog({
            step: "oasis_thirty_days_tab",
            message: `Opened the '${candidate.label}' dashboard panel.`,
            urlBefore,
            urlAfter: this.page.url(),
            selectorUsed: "finaleDashboard.oasisThirtyDaysTabs",
            found: visibleTabs.map((entry) => entry.label),
            evidence: [
              ...tabsResolution.attempts.map(selectorAttemptToEvidence),
              ...panelResolution.attempts.map(selectorAttemptToEvidence),
              ...modalDismissals.map((entry) => `modalDismissed=${entry}`),
              `selectedTab=${candidate.label}`,
            ],
            safeReadConfirmed: true,
          }),
        ],
      };
    }
    const failureArtifacts = await capturePageDebugArtifacts({
      page: this.page,
      outputDir: this.options.debugDir,
      step: "oasis-thirty-days",
      reason: "panel-not-ready",
      debugConfig: this.options.debugConfig,
      textHints: [...attemptedTabLabels, "Export", "Excel", "Patient"],
    });
    await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
    throw new Error(
      `The OASIS 30 Day's panel did not become ready after trying '${attemptedTabLabels.join(", ")}'. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
    );
  }
}
