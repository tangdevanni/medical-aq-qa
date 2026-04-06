import { type DocumentTrackingHubCard } from "@medical-ai-qa/shared-types";
import { type Locator } from "@playwright/test";
import { DOCUMENT_TRACKING_SELECTORS } from "../selectors/document-tracking.selectors";
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
    const hasClickableDescendant = false;
    const role = classifyHubCardRole(label);
    const classification = classifyHubCard(label, clickable);

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
    for (const selector of DOCUMENT_TRACKING_SELECTORS.sidebarLabelSelectors) {
      const nestedLabel = this.locator.locator(selector).first();
      if (!(await nestedLabel.isVisible().catch(() => false))) {
        continue;
      }

      const value = sanitizeStructuralLabel(await nestedLabel.innerText().catch(() => null));
      if (value) {
        return value;
      }
    }

    return sanitizeStructuralLabel(await this.locator.innerText().catch(() => null));
  }

  private async resolveBestInteractionTarget(): Promise<Locator | null> {
    if (await isInteractiveSidebarLink(this.locator)) {
      return this.locator;
    }

    return null;
  }
}

async function isInteractiveSidebarLink(locator: Locator): Promise<boolean> {
  if (!(await locator.isVisible().catch(() => false))) {
    return false;
  }

  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => null);
  const role = await locator.getAttribute("role").catch(() => null);
  const href = await locator.getAttribute("href").catch(() => null);
  return (tagName === "a" || role === "link") && href !== null;
}

function classifyHubCardRole(
  label: string,
): DocumentTrackingHubCard["role"] {
  if (/document statistics/i.test(label)) {
    return "statistics_tile";
  }

  if (/need to send|need to receive|physician'?s order|plan of care|oasis|qa monitoring/i.test(label)) {
    return "tab_like_control";
  }

  return "unknown";
}

function classifyHubCard(
  label: string,
  clickable: boolean,
): DocumentTrackingHubCard["classification"] {
  if (/\bsave\b|\bsubmit\b|\bapprove\b|\bcomplete\b|\bupdate\b|\bdelete\b|\barchive\b|\brequest\b|\bupload\b|\bdownload\b/i.test(label)) {
    return "RISKY_ACTION";
  }

  if (
    clickable &&
    /qa monitoring|physician'?s order|plan of care|\boasis\b/i.test(label)
  ) {
    return "SAFE_NAV";
  }

  return "UNKNOWN";
}
