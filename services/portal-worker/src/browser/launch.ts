import { chromium, type Browser } from "@playwright/test";
import { type PortalWorkerEnv } from "../config/env";

export async function launchBrowser(env: PortalWorkerEnv): Promise<Browser> {
  return chromium.launch({
    headless: env.playwrightHeadless,
    slowMo: env.playwrightSlowMoMs,
  });
}
