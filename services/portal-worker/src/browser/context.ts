import { type Browser, type BrowserContext } from "@playwright/test";
import { type PortalWorkerEnv } from "../config/env";

export async function createPortalContext(
  browser: Browser,
  env: PortalWorkerEnv,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: env.portalBaseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 960 },
  });
}
