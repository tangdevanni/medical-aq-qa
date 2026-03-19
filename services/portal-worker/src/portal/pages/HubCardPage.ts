import { type DocumentTrackingHubCard } from "@medical-ai-qa/shared-types";
import { type Locator } from "@playwright/test";
import { HUB_CARD_SELECTORS } from "../selectors/hub-card.selectors";
import { sanitizeStructuralLabel } from "../discovery/control-classification";

export interface ResolvedHubCard {
  summary: DocumentTrackingHubCard;
  locator: Locator;
  target: Locator | null;
}

export class HubCardPage {
  constructor(private readonly locator: Locator) {}

  async summarize(): Promise<ResolvedHubCard | null> {
    if (!(await this.locator.isVisible().catch(() => false))) {
      return null;
    }

    const label = await this.readLabel();
    if (!label) {
      return null;
    }

    const target = await this.resolveBestInteractionTarget();
    const clickable = target !== null;
    const hasClickableDescendant = clickable && (await this.hasDistinctTarget(target));
    const role = classifyHubCardRole(label);
    const classification = classifyHubCard(label, role, clickable);

    return {
      summary: {
        label,
        classification,
        role,
        clickable,
        hasClickableDescendant,
      },
      locator: this.locator,
      target,
    };
  }

  private async readLabel(): Promise<string | null> {
    const heading = await readFirstVisibleText(this.locator, HUB_CARD_SELECTORS.headingSelectors);
    if (heading) {
      return heading;
    }

    const lines = (await this.locator.innerText().catch(() => ""))
      .split(/\r?\n/)
      .map((line) => sanitizeStructuralLabel(line))
      .filter((line): line is string => Boolean(line));

    return lines[0] ?? null;
  }

  private async resolveBestInteractionTarget(): Promise<Locator | null> {
    if (await isInteractive(this.locator)) {
      return this.locator;
    }

    for (const selector of HUB_CARD_SELECTORS.interactiveDescendantSelectors) {
      const candidates = this.locator.locator(selector);
      const count = Math.min(await candidates.count(), 12);

      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (await isInteractive(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private async hasDistinctTarget(target: Locator): Promise<boolean> {
    const locatorSignature = await readElementSignature(this.locator);
    const targetSignature = await readElementSignature(target);
    return Boolean(locatorSignature && targetSignature && locatorSignature !== targetSignature);
  }
}

async function readFirstVisibleText(
  scope: Locator,
  selectors: readonly string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const candidate = scope.locator(selector).first();
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const value = sanitizeStructuralLabel(await candidate.textContent().catch(() => null));
    if (value) {
      return value;
    }
  }

  return null;
}

async function isInteractive(locator: Locator): Promise<boolean> {
  if (!(await locator.isVisible().catch(() => false))) {
    return false;
  }

  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => null);
  const role = await locator.getAttribute("role").catch(() => null);
  const href = await locator.getAttribute("href").catch(() => null);
  const tabIndex = await locator.getAttribute("tabindex").catch(() => null);
  const hasInteractiveClass = await locator
    .evaluate((node) => {
      const element = node as { className?: string | { baseVal?: string } };
      const className =
        typeof element.className === "string"
          ? element.className
          : element.className?.baseVal ?? "";

      return /cursor-pointer|shortcut-item/i.test(className);
    })
    .catch(() => false);

  if (
    tagName === "a" ||
    tagName === "button" ||
    role === "link" ||
    role === "button" ||
    href !== null ||
    tabIndex !== null ||
    hasInteractiveClass
  ) {
    return true;
  }

  const cursor = await locator
    .evaluate((node) => {
      const runtime = globalThis as unknown as {
        getComputedStyle: (target: unknown) => { cursor?: string };
      };

      return runtime.getComputedStyle(node).cursor ?? null;
    })
    .catch(() => null);

  return cursor === "pointer";
}

function classifyHubCardRole(
  label: string,
): DocumentTrackingHubCard["role"] {
  if (/document statistics/i.test(label)) {
    return "statistics_tile";
  }

  if (/need to send|need to receive|physician'?s order|plan of care|oasis|qa monitoring/i.test(label)) {
    return "queue_entry";
  }

  return "unknown";
}

function classifyHubCard(
  label: string,
  role: DocumentTrackingHubCard["role"],
  clickable: boolean,
): DocumentTrackingHubCard["classification"] {
  if (/\bsave\b|\bsubmit\b|\bapprove\b|\bcomplete\b|\bupdate\b|\bdelete\b|\barchive\b|\brequest\b|\bupload\b|\bdownload\b/i.test(label)) {
    return "RISKY_ACTION";
  }

  if (
    clickable &&
    (/qa monitoring|physician'?s order|plan of care|\boasis\b|need to send|need to receive|document statistics/i.test(label) ||
      role === "queue_entry" ||
      role === "statistics_tile")
  ) {
    return "SAFE_NAV";
  }

  return "UNKNOWN";
}

async function readElementSignature(locator: Locator): Promise<string | null> {
  return locator
    .evaluate((node) => {
      type RuntimeElement = {
        tagName: string;
        id?: string;
        className?: string | { baseVal?: string };
        parentElement: RuntimeElement | null;
      };
      const element = node as unknown as RuntimeElement;
      const segments: string[] = [];
      let current: RuntimeElement | null = element;

      while (current && segments.length < 4) {
        let segment = current.tagName.toLowerCase();
        if (current.id) {
          segment += `#${current.id}`;
        }

        const className =
          typeof current.className === "string"
            ? current.className.trim().split(/\s+/).slice(0, 2).join(".")
            : typeof current.className?.baseVal === "string"
              ? current.className.baseVal.trim().split(/\s+/).slice(0, 2).join(".")
            : "";
        if (className) {
          segment += `.${className}`;
        }

        segments.unshift(segment);
        current = current.parentElement;
      }

      return segments.join(" > ").replace(/\s+/g, " ").trim();
    })
    .catch(() => null);
}
