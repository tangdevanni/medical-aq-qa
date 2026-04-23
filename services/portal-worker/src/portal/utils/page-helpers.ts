import { DEFAULT_SERVICE_SETTINGS } from "@medical-ai-qa/shared-config";
import { type Locator, type Page } from "@playwright/test";

interface LocatorScope {
  locator(selector: string): Locator;
}

export function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function uniqueTexts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      seen.add(normalized);
    }
  }

  return [...seen];
}

export async function waitForFirstVisibleLocator(
  scope: LocatorScope,
  selectors: readonly string[],
  timeout: number = DEFAULT_SERVICE_SETTINGS.portalNavigationTimeoutMs,
): Promise<Locator | null> {
  const selectorTimeout = Math.max(400, Math.floor(timeout / Math.max(selectors.length, 1)));

  for (const selector of selectors) {
    const locator = scope.locator(selector).first();

    try {
      await locator.waitFor({ state: "visible", timeout: selectorTimeout });
      return locator;
    } catch {
      continue;
    }
  }

  return null;
}

export async function hasVisibleLocator(
  scope: LocatorScope,
  selectors: readonly string[],
  timeout: number = 1_500,
): Promise<boolean> {
  return (await waitForFirstVisibleLocator(scope, selectors, timeout)) !== null;
}

export async function clickAndWaitForSettledState(
  page: Page,
  locator: Locator,
): Promise<void> {
  await locator.click();
  await page.waitForLoadState("domcontentloaded", { timeout: 7_500 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 7_500 }).catch(() => undefined);
}

export async function waitForPageSettled(page: Page, delayMs = 250): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);
  await page.waitForTimeout(delayMs);
}

export async function scrollPageTo(page: Page, top: number): Promise<void> {
  await page.evaluate((position) => {
    const runtime = globalThis as unknown as {
      scrollTo: (x: number, y: number) => void;
    };

    runtime.scrollTo(0, position);
  }, top);
  await waitForPageSettled(page);
}

export async function getScrollMetrics(page: Page): Promise<{
  scrollHeight: number;
  scrollTop: number;
  viewportHeight: number;
}> {
  return page.evaluate(() => {
    const runtime = globalThis as unknown as {
      scrollY?: number;
      pageYOffset?: number;
      innerHeight: number;
      document: {
        documentElement: {
          scrollHeight: number;
        };
      };
    };

    return {
      scrollHeight: runtime.document.documentElement.scrollHeight,
      scrollTop: runtime.scrollY ?? runtime.pageYOffset ?? 0,
      viewportHeight: runtime.innerHeight,
    };
  });
}

export async function collectVisibleTexts(
  locator: Locator,
  limit = 25,
): Promise<string[]> {
  const count = Math.min(await locator.count(), limit);
  const texts: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await item.innerText().catch(() => null));
    if (text) {
      texts.push(text);
    }
  }

  return uniqueTexts(texts);
}

export async function countVisibleElements(
  locator: Locator,
  limit = 50,
): Promise<number> {
  const count = Math.min(await locator.count(), limit);
  let visibleCount = 0;

  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visibleCount += 1;
    }
  }

  return visibleCount;
}

export async function countVisibleSelectors(
  scope: LocatorScope,
  selectors: readonly string[],
  limitPerSelector = 25,
): Promise<number> {
  let total = 0;

  for (const selector of selectors) {
    total += await countVisibleElements(scope.locator(selector), limitPerSelector);
  }

  return total;
}

export async function readFirstVisibleText(
  scope: LocatorScope,
  selectors: readonly string[],
  timeout: number = 1_500,
): Promise<string | null> {
  const locator = await waitForFirstVisibleLocator(scope, selectors, timeout);
  if (!locator) {
    return null;
  }

  return normalizeText(await locator.textContent().catch(() => null));
}

export async function collectVisibleTextsFromSelectors(
  scope: LocatorScope,
  selectors: readonly string[],
  limit = 25,
): Promise<string[]> {
  const texts: string[] = [];

  for (const selector of selectors) {
    const items = await collectVisibleTexts(scope.locator(selector), limit);
    texts.push(...items);
  }

  return uniqueTexts(texts);
}
