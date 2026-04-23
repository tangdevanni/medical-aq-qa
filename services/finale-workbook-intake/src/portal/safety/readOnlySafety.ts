import type { PortalActionSafetyClass, PortalSafetyConfig } from "@medical-ai-qa/shared-types";
import type { Page } from "@playwright/test";

export interface DangerousControlDetection {
  label: string;
  classification: PortalActionSafetyClass;
  selectorUsed: string;
}

const DANGEROUS_LABEL_PATTERN =
  /\b(save|submit|validate|approve|sign|complete|update|assign|create|add|upload|delete|archive|send|billing ready)\b/i;

const DANGEROUS_CONTROL_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'input[type="file"]',
  '[contenteditable="true"]',
  '[role="button"]',
  'button',
  'a[role="button"]',
] as const;

const READ_ONLY_SAFETY_DEFAULT: PortalSafetyConfig = {
  safetyMode: "READ_ONLY",
  allowAuthSubmit: true,
  allowSearchAndFilterInput: true,
  allowArtifactDownloads: true,
  enforceDangerousControlDetection: true,
};

export class ReadOnlyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyViolationError";
  }
}

export function assertReadOnlyActionAllowed(input: {
  safety?: PortalSafetyConfig | null;
  actionClass: PortalActionSafetyClass;
  description: string;
}): void {
  const safety = resolvePortalSafetyConfig(input.safety);

  if (safety.safetyMode !== "READ_ONLY") {
    return;
  }

  if (input.actionClass === "AUTH_ONLY" && !safety.allowAuthSubmit) {
    throw new ReadOnlyViolationError(`Blocked auth submit in READ_ONLY mode: ${input.description}`);
  }

  if (input.actionClass === "READ_FILTER" && !safety.allowSearchAndFilterInput) {
    throw new ReadOnlyViolationError(`Blocked filter/search input in READ_ONLY mode: ${input.description}`);
  }

  if (input.actionClass === "READ_OPEN_DOC" && !safety.allowArtifactDownloads) {
    throw new ReadOnlyViolationError(`Blocked artifact open/download in READ_ONLY mode: ${input.description}`);
  }

  if (["AUTH_ONLY", "READ_NAV", "READ_FILTER", "READ_OPEN_DOC", "READ_TRANSFER"].includes(input.actionClass)) {
    return;
  }

  throw new ReadOnlyViolationError(`Blocked non-read portal action in READ_ONLY mode: ${input.description}`);
}

export function resolvePortalSafetyConfig(
  safety?: PortalSafetyConfig | null,
): PortalSafetyConfig {
  return {
    ...READ_ONLY_SAFETY_DEFAULT,
    ...(safety ?? {}),
    safetyMode: safety?.safetyMode ?? READ_ONLY_SAFETY_DEFAULT.safetyMode,
  };
}

export async function detectDangerousControls(page: Page): Promise<DangerousControlDetection[]> {
  const detections: DangerousControlDetection[] = [];
  const seen = new Set<string>();

  for (const selector of DANGEROUS_CONTROL_SELECTORS) {
    const locators = page.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 20);

    for (let index = 0; index < count; index += 1) {
      const locator = locators.nth(index);
      if (!(await locator.isVisible().catch(() => false))) {
        continue;
      }

      const label = (
        (await locator.getAttribute("aria-label").catch(() => null)) ??
        (await locator.getAttribute("title").catch(() => null)) ??
        (await locator.textContent().catch(() => null)) ??
        ""
      ).replace(/\s+/g, " ").trim();

      if (!DANGEROUS_LABEL_PATTERN.test(label) && selector !== 'input[type="file"]' && selector !== '[contenteditable="true"]') {
        continue;
      }

      const key = `${selector}:${label}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      detections.push({
        label: label || selector,
        classification: "WRITE_MUTATION",
        selectorUsed: selector,
      });
    }
  }

  return detections;
}
