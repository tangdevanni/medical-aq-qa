import { access } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { FinaleBatchEnv } from "../config/env";

async function pathExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createPortalSession(env: FinaleBatchEnv): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const headless = env.PLAYWRIGHT_HEADLESS ?? env.PORTAL_HEADLESS ?? false;
  const slowMo = env.PLAYWRIGHT_SLOW_MO_MS ?? 500;
  const browser = await chromium.launch({
    headless,
    slowMo,
    devtools: !headless,
  } as any);

  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: (await pathExists(env.PORTAL_AUTH_STATE_PATH))
      ? env.PORTAL_AUTH_STATE_PATH
      : undefined,
  });

  const page = await context.newPage();
  context.setDefaultTimeout(env.PORTAL_STEP_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(Math.max(env.PORTAL_STEP_TIMEOUT_MS, 8_000));

  return { browser, context, page };
}
