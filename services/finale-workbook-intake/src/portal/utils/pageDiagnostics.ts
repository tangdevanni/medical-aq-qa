import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { PortalDebugConfig } from "./locatorResolution";

interface ElementSummary {
  tag: string;
  role: string | null;
  type: string | null;
  name: string;
  text: string;
}

interface TableSummary {
  tag: string;
  role: string | null;
  headers: string[];
  rowCount: number;
}

function sanitizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function sanitizeArtifactLabel(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "artifact";
}

export function buildDebugArtifactBaseName(step: string, suffix?: string): string {
  const label = suffix ? `${step}-${suffix}` : step;
  return sanitizeArtifactLabel(label);
}

async function summarizeElements(page: Page, selector: string, limit: number): Promise<ElementSummary[]> {
  return page.locator(selector).evaluateAll((elements, max) => {
    const isVisible = (element: any): boolean => {
      if (!element || typeof element.getBoundingClientRect !== "function") {
        return false;
      }

      const style = (globalThis as any).getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    return elements
      .filter((element) => isVisible(element))
      .slice(0, max as number)
      .map((element) => {
        const target = element as any;
        return {
          tag: target.tagName.toLowerCase(),
          role: target.getAttribute("role"),
          type: target.getAttribute("type"),
          name:
            target.getAttribute("aria-label") ??
            target.getAttribute("title") ??
            target.getAttribute("placeholder") ??
            "",
          text: target.innerText.replace(/\s+/g, " ").trim().slice(0, 160),
        };
      });
  }, limit).catch(() => []);
}

export async function summarizeInteractiveElements(page: Page): Promise<string[]> {
  const results = await summarizeElements(
    page,
    'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"]',
    20,
  );
  return results.map((entry) => `${entry.tag} role=${entry.role ?? "none"} name=${sanitizeText(entry.name || entry.text).slice(0, 120)}`);
}

export async function summarizeInputs(page: Page): Promise<string[]> {
  const results = await summarizeElements(page, 'input, textarea, [role="textbox"], [contenteditable="true"]', 20);
  return results.map((entry) => `${entry.tag} type=${entry.type ?? "n/a"} name=${sanitizeText(entry.name || entry.text).slice(0, 120)}`);
}

export async function summarizeButtons(page: Page): Promise<string[]> {
  const results = await summarizeElements(page, 'button, input[type="submit"], [role="button"]', 20);
  return results.map((entry) => `${entry.tag} role=${entry.role ?? "none"} name=${sanitizeText(entry.name || entry.text).slice(0, 120)}`);
}

export async function summarizeTables(page: Page): Promise<string[]> {
  const results = await page.locator('table, [role="table"], [role="grid"]').evaluateAll((elements) => {
    const isVisible = (element: any): boolean => {
      if (!element || typeof element.getBoundingClientRect !== "function") {
        return false;
      }

      const style = (globalThis as any).getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    return elements
      .filter((element) => isVisible(element))
      .slice(0, 10)
      .map((element) => {
        const target = element as any;
        const headers = Array.from(target.querySelectorAll("th") as ArrayLike<{ textContent?: string | null }>)
          .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean)
          .slice(0, 8);
        return {
          tag: target.tagName.toLowerCase(),
          role: target.getAttribute("role"),
          headers,
          rowCount: target.querySelectorAll("tr,[role='row']").length,
        } satisfies TableSummary;
      });
  }).catch(() => []);

  return results.map((entry) => `${entry.tag} role=${entry.role ?? "none"} rows=${entry.rowCount} headers=${entry.headers.join(" | ")}`);
}

export async function findCandidateElementsByText(page: Page, text: string): Promise<string[]> {
  const query = sanitizeText(text);
  if (!query) {
    return [];
  }

  const locator = page.getByText(query, { exact: false });
  const count = Math.min(await locator.count().catch(() => 0), 8);
  const matches: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const entry = locator.nth(index);
    if (!(await entry.isVisible().catch(() => false))) {
      continue;
    }

    const content = sanitizeText(await entry.textContent().catch(() => null));
    if (content) {
      matches.push(content.slice(0, 200));
    }
  }

  return matches;
}

export async function dumpTopVisibleText(page: Page, limit = 800): Promise<string> {
  const bodyText = sanitizeText(await page.textContent("body").catch(() => null));
  return bodyText.slice(0, limit);
}

export async function dumpAriaSnapshot(page: Page): Promise<string[]> {
  const results = await summarizeElements(
    page,
    '[role], button, a[href], input, textarea, select, [aria-label], [aria-labelledby]',
    30,
  );
  return results.map((entry) =>
    `${entry.tag} role=${entry.role ?? "none"} name=${sanitizeText(entry.name || entry.text).slice(0, 120)}`,
  );
}

export async function capturePageDebugArtifacts(input: {
  page: Page;
  outputDir?: string;
  step: string;
  reason: string;
  debugConfig?: PortalDebugConfig;
  textHints?: string[];
}): Promise<{
  screenshotPath: string | null;
  htmlPath: string | null;
  summaryPath: string | null;
  title: string | null;
  url: string;
}> {
  const { outputDir, page, step, reason, debugConfig } = input;
  const url = page.url();
  const title = await page.title().catch(() => null);

  if (!outputDir) {
    return {
      screenshotPath: null,
      htmlPath: null,
      summaryPath: null,
      title,
      url,
    };
  }

  await mkdir(outputDir, { recursive: true });
  const baseName = buildDebugArtifactBaseName(step, reason);
  const screenshotPath = debugConfig?.debugScreenshots === false
    ? null
    : path.join(outputDir, `${baseName}.png`);
  const htmlPath = debugConfig?.saveDebugHtml === false
    ? null
    : path.join(outputDir, `${baseName}.html`);
  const summaryPath = path.join(outputDir, `${baseName}.json`);

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  }

  if (htmlPath) {
    const html = await page.content().catch(() => "");
    await writeFile(htmlPath, html, "utf8").catch(() => undefined);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    step,
    reason,
    url,
    title,
    topVisibleText: await dumpTopVisibleText(page),
    inputs: await summarizeInputs(page),
    buttons: await summarizeButtons(page),
    interactiveElements: await summarizeInteractiveElements(page),
    tables: await summarizeTables(page),
    ariaSnapshot: await dumpAriaSnapshot(page),
    textHints: input.textHints ?? [],
    candidateTextMatches: await Promise.all((input.textHints ?? []).slice(0, 5).map(async (hint) => ({
      hint,
      matches: await findCandidateElementsByText(page, hint),
    }))),
  };

  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8").catch(() => undefined);

  return {
    screenshotPath,
    htmlPath,
    summaryPath,
    title,
    url,
  };
}

export async function pauseOnFailureIfRequested(
  page: Page,
  debugConfig?: PortalDebugConfig,
): Promise<void> {
  if (!debugConfig?.pauseOnFailure) {
    return;
  }

  await page.pause().catch(() => undefined);
}

export async function readLocatorVisibleLabels(locator: Locator, limit = 8): Promise<string[]> {
  const labels: string[] = [];
  const count = Math.min(await locator.count().catch(() => 0), limit);

  for (let index = 0; index < count; index += 1) {
    const entry = locator.nth(index);
    if (!(await entry.isVisible().catch(() => false))) {
      continue;
    }

    const label = sanitizeText(
      (await entry.getAttribute("aria-label").catch(() => null)) ??
      (await entry.getAttribute("title").catch(() => null)) ??
      (await entry.textContent().catch(() => null)),
    );
    if (label) {
      labels.push(label.slice(0, 200));
    }
  }

  return labels;
}
