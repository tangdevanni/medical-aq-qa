import type { Locator, Page } from "@playwright/test";
import type { Logger } from "pino";
import {
  buildLocatorForCandidate,
  describeSelectorCandidate,
  type PortalSelectorCandidate,
} from "../selectors/types";

export interface PortalDebugConfig {
  debugSelectors: boolean;
  saveDebugHtml: boolean;
  pauseOnFailure: boolean;
  stepTimeoutMs: number;
  debugScreenshots: boolean;
  selectorRetryCount: number;
}

export interface SelectorAttemptResult {
  selector: string;
  strategy: PortalSelectorCandidate["strategy"];
  description: string;
  count: number;
  visibleCount: number;
  elapsedMs: number;
  outcome: "matched" | "not_found" | "not_visible" | "error";
  sampleTexts: string[];
  errorMessage: string | null;
}

export interface ResolvedSelectorResult {
  locator: Locator | null;
  matchedCandidate: PortalSelectorCandidate | null;
  attempts: SelectorAttemptResult[];
}

export interface VisiblePortalModalResolution {
  locator: Locator | null;
  selectorUsed: string | null;
}

async function readSampleTexts(locator: Locator, count: number): Promise<string[]> {
  const samples: string[] = [];
  const sampleCount = Math.min(count, 3);

  for (let index = 0; index < sampleCount; index += 1) {
    const entry = locator.nth(index);
    const text = (
      (await entry.getAttribute("aria-label").catch(() => null)) ??
      (await entry.getAttribute("title").catch(() => null)) ??
      (await entry.textContent().catch(() => null)) ??
      ""
    ).replace(/\s+/g, " ").trim();

    if (text) {
      samples.push(text.slice(0, 180));
    }
  }

  return samples;
}

function emitSelectorAttemptLog(
  logger: Logger | undefined,
  debugConfig: PortalDebugConfig | undefined,
  step: string,
  attempt: SelectorAttemptResult,
): void {
  if (!logger || !debugConfig?.debugSelectors) {
    return;
  }

  logger.info(
    {
      step,
      strategy: attempt.strategy,
      selector: attempt.selector,
      outcome: attempt.outcome,
      count: attempt.count,
      visibleCount: attempt.visibleCount,
      elapsedMs: attempt.elapsedMs,
      sampleTexts: attempt.sampleTexts,
      errorMessage: attempt.errorMessage,
    },
    "portal selector attempt",
  );
}

export function selectorAttemptToEvidence(attempt: SelectorAttemptResult): string {
  const samples = attempt.sampleTexts.length > 0
    ? ` samples=${attempt.sampleTexts.join(" | ")}`
    : "";
  const errorMessage = attempt.errorMessage ? ` error=${attempt.errorMessage}` : "";

  return [
    `[${attempt.outcome}]`,
    `${attempt.description}`,
    `count=${attempt.count}`,
    `visible=${attempt.visibleCount}`,
    `elapsedMs=${attempt.elapsedMs}`,
    samples,
    errorMessage,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function tryCandidate(
  page: Page | Locator,
  candidate: PortalSelectorCandidate,
): Promise<{
  locator: Locator;
  attempt: SelectorAttemptResult;
}> {
  const startedAt = Date.now();
  const locator = buildLocatorForCandidate(page, candidate);

  try {
    const count = await locator.count().catch(() => 0);
    let visibleCount = 0;
    if (count > 0) {
      const inspectCount = Math.min(count, 5);
      for (let index = 0; index < inspectCount; index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) {
          visibleCount += 1;
        }
      }
    }

    const attempt: SelectorAttemptResult = {
      selector: describeSelectorCandidate(candidate),
      strategy: candidate.strategy,
      description: candidate.description,
      count,
      visibleCount,
      elapsedMs: Date.now() - startedAt,
      outcome: visibleCount > 0 ? "matched" : count > 0 ? "not_visible" : "not_found",
      sampleTexts: await readSampleTexts(locator, count),
      errorMessage: null,
    };

    return {
      locator,
      attempt,
    };
  } catch (error) {
    return {
      locator,
      attempt: {
        selector: describeSelectorCandidate(candidate),
        strategy: candidate.strategy,
        description: candidate.description,
        count: 0,
        visibleCount: 0,
        elapsedMs: Date.now() - startedAt,
        outcome: "error",
        sampleTexts: [],
        errorMessage: error instanceof Error ? error.message : "Unknown selector resolution error.",
      },
    };
  }
}

export async function waitForPortalPageSettled(
  page: Page,
  debugConfig?: PortalDebugConfig,
  delayMs = 250,
): Promise<void> {
  const timeoutMs = debugConfig?.stepTimeoutMs ?? 5_000;
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 3_500) }).catch(() => undefined);
  await page.waitForTimeout(delayMs);
}

export async function clickPortalControl(input: {
  page: Page;
  locator: Locator;
  debugConfig?: PortalDebugConfig;
}): Promise<string> {
  const clickStrategies: Array<{
    name: string;
    action: () => Promise<void>;
  }> = [
    {
      name: "scrollIntoViewIfNeeded()+click()",
      action: async () => {
        await input.locator.scrollIntoViewIfNeeded().catch(() => undefined);
        await input.locator.click();
      },
    },
    {
      name: "click({ force: true })",
      action: async () => {
        await input.locator.scrollIntoViewIfNeeded().catch(() => undefined);
        await input.locator.click({ force: true });
      },
    },
    {
      name: "evaluate(el => el.click())",
      action: async () => {
        await input.locator.evaluate((element) => {
          (element as { click: () => void }).click();
        });
      },
    },
    {
      name: "focus()+Enter",
      action: async () => {
        await input.locator.focus().catch(() => undefined);
        await input.page.keyboard.press("Enter");
      },
    },
  ];

  let lastError: unknown = null;
  for (const strategy of clickStrategies) {
    try {
      await strategy.action();
      await waitForPortalPageSettled(input.page, input.debugConfig);
      return strategy.name;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to activate portal control with available click strategies.");
}

export async function resolveVisiblePortalModal(page: Page): Promise<VisiblePortalModalResolution> {
  const selectors = [
    "ngb-modal-window[role='dialog']",
    "ngb-modal-window",
    ".modal.show [role='dialog']",
    ".modal.show .modal-dialog",
    ".modal.show",
    '[aria-modal="true"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count().catch(() => 0) > 0 && await locator.isVisible().catch(() => false)) {
      return {
        locator,
        selectorUsed: selector,
      };
    }
  }

  return {
    locator: null,
    selectorUsed: null,
  };
}

export async function dismissVisiblePortalModal(input: {
  page: Page;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
}): Promise<{
  dismissed: boolean;
  selectorUsed: string | null;
  actionUsed: string | null;
}> {
  const modalResolution = await resolveVisiblePortalModal(input.page);
  if (!modalResolution.locator) {
    return {
      dismissed: false,
      selectorUsed: null,
      actionUsed: null,
    };
  }

  const closeSelectors = [
    '[aria-label="Close"]',
    'button[aria-label="Close"]',
    "button.btn-close",
    "button.close",
    'button:has-text("Close")',
    'button:has-text("Dismiss")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Okay")',
    'button:has-text("Continue")',
    'button:has-text("Skip")',
    ".modal-footer button",
    "button",
  ];

  for (const selector of closeSelectors) {
    const button = modalResolution.locator.locator(selector).filter({ visible: true }).last();
    if (await button.count().catch(() => 0) === 0) {
      continue;
    }

    try {
      const label = (
        (await button.getAttribute("aria-label").catch(() => null)) ??
        (await button.textContent().catch(() => null)) ??
        selector
      ).replace(/\s+/g, " ").trim() || selector;
      const clickMethod = await clickPortalControl({
        page: input.page,
        locator: button,
        debugConfig: input.debugConfig,
      });
      const remainingModal = await resolveVisiblePortalModal(input.page);
      if (!remainingModal.locator) {
        input.logger?.info(
          {
            selectorUsed: modalResolution.selectorUsed,
            modalAction: `${selector}:${label}:${clickMethod}`,
          },
          "dismissed visible portal modal",
        );
        return {
          dismissed: true,
          selectorUsed: modalResolution.selectorUsed,
          actionUsed: `${selector}:${label}:${clickMethod}`,
        };
      }
    } catch {
      continue;
    }
  }

  const keyboardActions = ["Escape", "Esc"] as const;
  for (const key of keyboardActions) {
    await input.page.keyboard.press(key).catch(() => undefined);
    await waitForPortalPageSettled(input.page, input.debugConfig);
    const remainingModal = await resolveVisiblePortalModal(input.page);
    if (!remainingModal.locator) {
      input.logger?.info(
        {
          selectorUsed: modalResolution.selectorUsed,
          modalAction: `keyboard:${key}`,
        },
        "dismissed visible portal modal",
      );
      return {
        dismissed: true,
        selectorUsed: modalResolution.selectorUsed,
        actionUsed: `keyboard:${key}`,
      };
    }
  }

  const viewport = input.page.viewportSize();
  if (viewport) {
    await input.page.mouse.click(Math.max(8, Math.floor(viewport.width * 0.02)), Math.max(8, Math.floor(viewport.height * 0.98))).catch(() => undefined);
    await waitForPortalPageSettled(input.page, input.debugConfig);
    const remainingModal = await resolveVisiblePortalModal(input.page);
    if (!remainingModal.locator) {
      input.logger?.info(
        {
          selectorUsed: modalResolution.selectorUsed,
          modalAction: "backdrop:mouse-click",
        },
        "dismissed visible portal modal",
      );
      return {
        dismissed: true,
        selectorUsed: modalResolution.selectorUsed,
        actionUsed: "backdrop:mouse-click",
      };
    }
  }

  return {
    dismissed: false,
    selectorUsed: modalResolution.selectorUsed,
    actionUsed: null,
  };
}

export async function resolveFirstVisibleLocator(input: {
  page: Page | Locator;
  candidates: PortalSelectorCandidate[];
  step: string;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
  settle?: () => Promise<void>;
}): Promise<ResolvedSelectorResult> {
  const attempts: SelectorAttemptResult[] = [];
  const retryCount = input.debugConfig?.selectorRetryCount ?? 1;

  for (let round = 0; round < retryCount; round += 1) {
    for (const candidate of input.candidates) {
      const resolution = await tryCandidate(input.page, candidate);
      attempts.push(resolution.attempt);
      emitSelectorAttemptLog(input.logger, input.debugConfig, input.step, resolution.attempt);

      if (resolution.attempt.outcome === "matched") {
        return {
          locator: resolution.locator.first(),
          matchedCandidate: candidate,
          attempts,
        };
      }
    }

    if (round < retryCount - 1) {
      if (input.settle) {
        await input.settle();
      } else if ("waitForTimeout" in input.page) {
        await input.page.waitForTimeout(250);
      }
    }
  }

  return {
    locator: null,
    matchedCandidate: null,
    attempts,
  };
}

export async function resolveVisibleLocatorList(input: {
  page: Page | Locator;
  candidates: PortalSelectorCandidate[];
  step: string;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
  maxItems?: number;
}): Promise<{
  items: Array<{
    locator: Locator;
    candidate: PortalSelectorCandidate;
  }>;
  attempts: SelectorAttemptResult[];
}> {
  const attempts: SelectorAttemptResult[] = [];
  const maxItems = input.maxItems ?? 40;

  for (const candidate of input.candidates) {
    const resolution = await tryCandidate(input.page, candidate);
    attempts.push(resolution.attempt);
    emitSelectorAttemptLog(input.logger, input.debugConfig, input.step, resolution.attempt);

    if (resolution.attempt.count === 0) {
      continue;
    }

    const items: Array<{
      locator: Locator;
      candidate: PortalSelectorCandidate;
    }> = [];
    const count = Math.min(resolution.attempt.count, maxItems);
    for (let index = 0; index < count; index += 1) {
      const item = resolution.locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        items.push({
          locator: item,
          candidate,
        });
      }
    }

    if (items.length > 0) {
      return {
        items,
        attempts,
      };
    }
  }

  return {
    items: [],
    attempts,
  };
}
