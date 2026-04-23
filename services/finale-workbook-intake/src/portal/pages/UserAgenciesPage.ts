import type { Locator, Page } from "@playwright/test";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { selectorRegistry } from "../selectorRegistry";
import { buildUserAgenciesUrl, findBestAgencyOptionForTargets } from "../agencySelectionService";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  clickPortalControl,
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

function isProviderDashboardUrl(value: string): boolean {
  return /\/provider\/[^/]+\/dashboard/i.test(value);
}

async function readAgencyOptionLabel(locator: Locator): Promise<string> {
  return normalizeVisibleText(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
      (await locator.getAttribute("title").catch(() => null)) ??
      (await locator.textContent().catch(() => null)),
  );
}

async function waitForAgencyDashboardContext(
  page: Page,
  debugConfig: PortalDebugConfig | undefined,
  timeoutMs = 4_000,
): Promise<boolean> {
  if (isProviderDashboardUrl(page.url())) {
    return true;
  }

  await page.waitForURL((url) => isProviderDashboardUrl(url.toString()), {
    timeout: timeoutMs,
  }).catch(() => undefined);

  if (isProviderDashboardUrl(page.url())) {
    return true;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await waitForPortalPageSettled(page, debugConfig, 300);
    if (isProviderDashboardUrl(page.url())) {
      return true;
    }
  }

  return isProviderDashboardUrl(page.url());
}

async function activateAgencyLocator(input: {
  page: Page;
  locator: Locator;
  activationLabel: string;
  debugConfig?: PortalDebugConfig;
}): Promise<string[]> {
  const evidence: string[] = [];

  try {
    const method = await clickPortalControl({
      page: input.page,
      locator: input.locator,
      debugConfig: input.debugConfig,
    });
    evidence.push(`${input.activationLabel}:${method}:url=${input.page.url()}`);
    if (await waitForAgencyDashboardContext(input.page, input.debugConfig)) {
      return evidence;
    }
  } catch (error) {
    evidence.push(
      `${input.activationLabel}:clickPortalControl:error=${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  try {
    await input.locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.locator.dblclick({ force: true });
    await waitForPortalPageSettled(input.page, input.debugConfig);
    evidence.push(`${input.activationLabel}:dblclick:url=${input.page.url()}`);
    if (await waitForAgencyDashboardContext(input.page, input.debugConfig)) {
      return evidence;
    }
  } catch (error) {
    evidence.push(
      `${input.activationLabel}:dblclick:error=${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  try {
    await input.locator.focus().catch(() => undefined);
    await input.page.keyboard.press("Enter");
    await waitForPortalPageSettled(input.page, input.debugConfig);
    evidence.push(`${input.activationLabel}:page-enter:url=${input.page.url()}`);
    if (await waitForAgencyDashboardContext(input.page, input.debugConfig)) {
      return evidence;
    }
  } catch (error) {
    evidence.push(
      `${input.activationLabel}:page-enter:error=${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  try {
    const ancestorClickResult = await input.locator.evaluate((element) => {
      const normalizeClassName = (value: unknown): string =>
        typeof value === "string" ? value.toLowerCase() : "";
      let current: {
        click?: () => void;
        className?: unknown;
        tabIndex?: number;
        onclick?: unknown;
        matches?: (selector: string) => boolean;
        tagName?: string;
        parentElement?: unknown;
      } | null = typeof element === "object" && element !== null
        ? (element as {
            click?: () => void;
            className?: unknown;
            tabIndex?: number;
            onclick?: unknown;
            matches?: (selector: string) => boolean;
            tagName?: string;
            parentElement?: unknown;
          })
        : null;

      while (current) {
        const className = normalizeClassName(current.className);
        const isLikelyAgencyCard =
          current.matches?.("a, button, [role='button'], [role='link']") === true ||
          typeof current.tabIndex === "number" && current.tabIndex >= 0 ||
          typeof current.onclick === "function" ||
          className.includes("agency") ||
          className.includes("card") ||
          className.includes("tile");

        if (isLikelyAgencyCard) {
          current.click?.();
          return {
            tagName: current.tagName ?? null,
            className: typeof current.className === "string"
              ? current.className
              : null,
          };
        }

        current = typeof current.parentElement === "object" && current.parentElement !== null
          ? (current.parentElement as typeof current)
          : null;
      }

      return null;
    });
    await waitForPortalPageSettled(input.page, input.debugConfig);
    evidence.push(
      `${input.activationLabel}:ancestor-click:${
        ancestorClickResult ? `${ancestorClickResult.tagName}:${ancestorClickResult.className}` : "none"
      }:url=${input.page.url()}`,
    );
    await waitForAgencyDashboardContext(input.page, input.debugConfig);
  } catch (error) {
    evidence.push(
      `${input.activationLabel}:ancestor-click:error=${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  return evidence;
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
    const selectionEvidence: string[] = [];
    const activationLocators: Array<{
      activationLabel: string;
      locator: Locator;
    }> = [
      {
        activationLabel: "matched-option",
        locator: best.locator,
      },
      {
        activationLabel: "nearest-clickable-ancestor",
        locator: best.locator.locator(
          "xpath=ancestor-or-self::*[self::a or self::button or @role='button' or @role='link' or @tabindex='0'][1]",
        ),
      },
      {
        activationLabel: "agency-card-ancestor",
        locator: best.locator.locator(
          "xpath=ancestor-or-self::*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'agency') or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'card') or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'tile')][1]",
        ),
      },
    ];

    for (const activation of activationLocators) {
      if (await activation.locator.count().catch(() => 0) === 0) {
        selectionEvidence.push(`${activation.activationLabel}:not-found`);
        continue;
      }
      if (!await activation.locator.first().isVisible().catch(() => false)) {
        selectionEvidence.push(`${activation.activationLabel}:not-visible`);
        continue;
      }

      selectionEvidence.push(
        ...(await activateAgencyLocator({
          page: this.page,
          locator: activation.locator.first(),
          activationLabel: activation.activationLabel,
          debugConfig: this.options.debugConfig,
        })),
      );
      if (isProviderDashboardUrl(this.page.url())) {
        break;
      }
    }

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
          ...selectionEvidence,
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
