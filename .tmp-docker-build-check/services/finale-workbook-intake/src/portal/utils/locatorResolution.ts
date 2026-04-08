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
