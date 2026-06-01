import type { Page } from "@playwright/test";
import type { Logger } from "pino";
import type { PortalDebugConfig } from "./locatorResolution";

export type PortalNavigationErrorCategory =
  | "portal_navigation_timeout"
  | "portal_dns_failed"
  | "portal_network_unreachable"
  | "portal_connect_timeout"
  | "portal_browser_navigation_failed";

export interface PortalGotoOptions {
  page: Page;
  url: string;
  step: string;
  logger?: Logger;
  debugConfig?: PortalDebugConfig;
  timeoutMs?: number;
  attempts?: number;
}

export class PortalNavigationError extends Error {
  constructor(
    message: string,
    readonly category: PortalNavigationErrorCategory,
    readonly retryable: boolean,
    readonly causeMessage: string,
  ) {
    super(message);
    this.name = "PortalNavigationError";
  }
}

export function sanitizePortalUrl(value: string): string {
  try {
    const url = new URL(value);
    const sanitizedPath = url.pathname
      .replace(/\/provider\/[^/]+/gi, "/provider/:provider")
      .replace(/\/client\/[^/]+/gi, "/client/:client")
      .replace(/\/intake\/[^/]+/gi, "/intake/:intake")
      .replace(/\/documents\/note\/[^/]+\/[^/]+/gi, "/documents/note/:type/:note")
      .replace(/\/file-uploads\/[^/]+/gi, "/file-uploads/:file");
    return `${url.origin}${sanitizedPath}`;
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}

export function classifyPortalNavigationError(error: unknown): {
  category: PortalNavigationErrorCategory;
  retryable: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";

  if (/ENOTFOUND|EAI_AGAIN|net::ERR_NAME_NOT_RESOLVED/i.test(`${code} ${message}`)) {
    return { category: "portal_dns_failed", retryable: true };
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|net::ERR_TIMED_OUT|net::ERR_CONNECTION_TIMED_OUT/i.test(`${code} ${message}`)) {
    return { category: "portal_connect_timeout", retryable: true };
  }
  if (/ENETUNREACH|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|net::ERR_NETWORK_CHANGED|net::ERR_CONNECTION_RESET/i.test(`${code} ${message}`)) {
    return { category: "portal_network_unreachable", retryable: true };
  }
  if (/timeout .*exceeded|navigation timeout/i.test(message)) {
    return { category: "portal_navigation_timeout", retryable: true };
  }
  return { category: "portal_browser_navigation_failed", retryable: false };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function gotoPortalPage(input: PortalGotoOptions): Promise<void> {
  const timeoutMs = input.timeoutMs ?? input.debugConfig?.navigationTimeoutMs ?? 45_000;
  const attempts = Math.max(1, input.attempts ?? input.debugConfig?.navigationRetries ?? 3);
  let lastError: unknown = null;
  let lastCategory: PortalNavigationErrorCategory = "portal_browser_navigation_failed";
  let lastRetryable = false;
  const sanitizedUrl = sanitizePortalUrl(input.url);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      await input.page.goto(input.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      const title = await input.page.title().catch(() => "");
      if (attempt > 1) {
        input.logger?.info(
          {
            step: input.step,
            url: sanitizedUrl,
            attempt,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
            pageTitlePresent: title.trim().length > 0,
            currentUrl: sanitizePortalUrl(input.page.url()),
          },
          "portal navigation succeeded after retry",
        );
      }
      return;
    } catch (error) {
      lastError = error;
      const { category, retryable } = classifyPortalNavigationError(error);
      lastCategory = category;
      lastRetryable = retryable;
      input.logger?.warn(
        {
          step: input.step,
          url: sanitizedUrl,
          attempt,
          attempts,
          timeoutMs,
          elapsedMs: Date.now() - startedAt,
          errorCategory: category,
          retryable,
          errorMessage: describeError(error),
        },
        "portal navigation attempt failed",
      );

      if (!retryable || attempt >= attempts) {
        break;
      }

      const jitterMs = Math.floor(Math.random() * 250);
      const backoffMs = Math.min(1_500 * 2 ** (attempt - 1), 6_000) + jitterMs;
      await input.page.waitForTimeout(backoffMs).catch(() => undefined);
    }
  }

  throw new PortalNavigationError(
    `Portal navigation failed during ${input.step} after ${attempts} attempt(s) with ${timeoutMs}ms timeout. category=${lastCategory}; retryable=${lastRetryable}; url=${sanitizedUrl}`,
    lastCategory,
    lastRetryable,
    describeError(lastError),
  );
}
