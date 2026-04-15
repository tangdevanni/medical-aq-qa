import type { Locator, Page } from "@playwright/test";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { selectorRegistry } from "../selectorRegistry";
import { buildUserAgenciesUrl, findBestAgencyOptionForTargets } from "../agencySelectionService";
import { createAutomationStepLog } from "../utils/automationLog";
import {
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

interface AgencyOptionMatch {
  label: string;
  href: string | null;
  locator: Locator;
}

function normalizeVisibleText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function readAgencyOptionLabel(locator: Locator): Promise<string> {
  return normalizeVisibleText(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
      (await locator.getAttribute("title").catch(() => null)) ??
      (await locator.textContent().catch(() => null)),
  );
}

export class UserAgenciesPage {
  constructor(
    private readonly page: Page,
    private readonly options: {
      logger?: Logger;
      debugConfig?: PortalDebugConfig;
      debugDir?: string;
    } = {},
  ) {}

  async selectAgency(input: {
    baseUrl: string;
    agencyNames: string[];
  }): Promise<{
    selectedAgencyName: string;
    selectedAgencyUrl: string;
    availableAgencies: string[];
    stepLogs: AutomationStepLog[];
  }> {
    const targetUrl = buildUserAgenciesUrl(input.baseUrl);
    const urlBefore = this.page.url();
    await this.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    const markerResolution = await resolveFirstVisibleLocator({
      page: this.page,
      candidates: selectorRegistry.userAgencies.pageMarkers,
      step: "user_agencies_page_marker",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      settle: async () => waitForPortalPageSettled(this.page, this.options.debugConfig),
    });
    const stepLogs: AutomationStepLog[] = [
      createAutomationStepLog({
        step: "agency_list_discovered",
        message: "Opened the Finale user-agencies page to resolve the real agency context.",
        urlBefore,
        urlAfter: this.page.url(),
        selectorUsed: markerResolution.matchedCandidate?.description ?? null,
        found: [this.page.url()],
        missing: markerResolution.locator ? [] : ["userAgencies.pageMarkers"],
        evidence: markerResolution.attempts.map(selectorAttemptToEvidence),
        safeReadConfirmed: true,
      }),
    ];

    const optionsResolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates: selectorRegistry.userAgencies.agencyOptions,
      step: "agency_option_list",
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 50,
    });

    const options: AgencyOptionMatch[] = [];
    for (const item of optionsResolution.items) {
      const label = await readAgencyOptionLabel(item.locator);
      const href = await item.locator.getAttribute("href").catch(() => null);
      if (!label) {
        continue;
      }
      options.push({
        label,
        href,
        locator: item.locator,
      });
    }

    const best = findBestAgencyOptionForTargets(options, input.agencyNames);
    if (!best) {
      const failureArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "agency-selection",
        reason: "agency-not-found",
        debugConfig: this.options.debugConfig,
        textHints: [...input.agencyNames, "agencies", "select agency"],
      });
      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      throw new Error(
        `Unable to find any expected agency label (${input.agencyNames.join(", ")}) on the Finale user-agencies page. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
      );
    }

    this.options.logger?.info(
      {
        targetAgencies: input.agencyNames,
        discoveredAgencies: options.map((option) => option.label),
        selectedAgency: best.label,
        selectedAgencyHref: best.href,
        matchedTargetAgency: best.matchedTarget,
      },
      "portal agency list discovered",
    );

    const selectionUrlBefore = this.page.url();
    await best.locator.click();
    await waitForPortalPageSettled(this.page, this.options.debugConfig);

    stepLogs.push(
      createAutomationStepLog({
        step: "agency_selected",
        message: `Selected '${best.label}' from the Finale agency list.`,
        urlBefore: selectionUrlBefore,
        urlAfter: this.page.url(),
        selectorUsed: "userAgencies.agencyOptions",
        found: options.map((option) => option.label),
        evidence: [
          ...optionsResolution.attempts.map(selectorAttemptToEvidence),
          `selectedAgency=${best.label}`,
          `selectedAgencyHref=${best.href ?? "none"}`,
        ],
        safeReadConfirmed: true,
      }),
    );

    return {
      selectedAgencyName: best.label,
      selectedAgencyUrl: this.page.url(),
      availableAgencies: options.map((option) => option.label),
      stepLogs,
    };
  }
}
