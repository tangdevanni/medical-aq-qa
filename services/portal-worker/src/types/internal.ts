import { type BrowserContext, type Page } from "@playwright/test";
import { type OpenBehavior, type PortalJob } from "@medical-ai-qa/shared-types";

export interface PortalExecutionContext {
  job: PortalJob;
  context: BrowserContext;
  page: Page;
}

export interface OpenBehaviorResult {
  openBehavior: OpenBehavior;
  routeChanged: boolean;
  modalDetected: boolean;
  newTabDetected: boolean;
  splitViewDetected: boolean;
  targetPage: Page;
  ambiguousSignals: string[];
}
