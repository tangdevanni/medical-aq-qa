import {
  type InteractiveForensicsCandidate,
  type OrdersQaContainerSummary,
  type OrdersQaForensicsTarget,
  type PortalControlClassification,
} from "@medical-ai-qa/shared-types";
import { type Locator, type Page } from "@playwright/test";
import { classifyControl, sanitizeStructuralLabel } from "../discovery/control-classification";
import { INTERACTION_FORENSICS_SELECTORS } from "../selectors/interaction-forensics.selectors";
import { ORDERS_QA_ENTRY_PATTERNS } from "../selectors/orders-qa-entry.selectors";
import { type OrdersQaEntryMatch, OrdersQaEntryPage } from "./OrdersQaEntryPage";

export interface ResolvedInteractiveCandidate {
  metadata: InteractiveForensicsCandidate;
  locator: Locator;
  classification: PortalControlClassification;
  supportsEnter: boolean;
  supportsSpace: boolean;
}

export interface OrdersQaInteractionInspection {
  target: OrdersQaForensicsTarget;
  container: OrdersQaContainerSummary;
  interactiveCandidates: InteractiveForensicsCandidate[];
  resolvedCandidates: ResolvedInteractiveCandidate[];
}

export class InteractionForensicsPage {
  private readonly ordersQaEntryPage: OrdersQaEntryPage;

  constructor(private readonly page: Page) {
    this.ordersQaEntryPage = new OrdersQaEntryPage(page);
  }

  async inspect(): Promise<OrdersQaInteractionInspection> {
    const match = await this.ordersQaEntryPage.findTargetMatch();

    if (!match?.container) {
      return {
        target: {
          label: match?.label ?? "Orders and QA Management",
          found: false,
        },
        container: {
          visible: false,
          textSummary: null,
        },
        interactiveCandidates: [],
        resolvedCandidates: [],
      };
    }

    const containerVisible = await match.container.isVisible().catch(() => false);
    const resolvedCandidates = containerVisible
      ? await this.enumerateResolvedCandidates(match)
      : [];

    return {
      target: {
        label: match.label ?? "Orders and QA Management",
        found: true,
      },
      container: {
        visible: containerVisible,
        textSummary: match.textSummary,
      },
      interactiveCandidates: resolvedCandidates.map((candidate) => candidate.metadata),
      resolvedCandidates,
    };
  }

  async resolveCandidateByIndex(index: number): Promise<ResolvedInteractiveCandidate | null> {
    const inspection = await this.inspect();
    return inspection.resolvedCandidates.find((candidate) => candidate.metadata.candidateIndex === index) ?? null;
  }

  private async enumerateResolvedCandidates(
    match: OrdersQaEntryMatch,
  ): Promise<ResolvedInteractiveCandidate[]> {
    if (!match.container) {
      return [];
    }

    const rawCandidates: Locator[] = [];

    if (match.target) {
      rawCandidates.push(match.target);
    }

    if (await this.isInteractiveElement(match.container)) {
      rawCandidates.push(match.container);
    }

    for (const selector of INTERACTION_FORENSICS_SELECTORS.interactiveDescendantSelectors) {
      const elements = match.container.locator(selector);
      const count = Math.min(await elements.count(), 24);

      for (let index = 0; index < count; index += 1) {
        rawCandidates.push(elements.nth(index));
      }
    }

    const resolvedCandidates: ResolvedInteractiveCandidate[] = [];
    const seenSignatures = new Set<string>();

    for (const locator of rawCandidates) {
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const signature = await readElementSignature(locator);
      if (!signature || seenSignatures.has(signature)) {
        continue;
      }

      seenSignatures.add(signature);

      const candidate = await this.buildResolvedCandidate(
        locator,
        match.target,
        resolvedCandidates.length,
      );

      if (candidate) {
        resolvedCandidates.push(candidate);
      }
    }

    return resolvedCandidates;
  }

  private async buildResolvedCandidate(
    locator: Locator,
    matchedTarget: Locator | null,
    candidateIndex: number,
  ): Promise<ResolvedInteractiveCandidate | null> {
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      return null;
    }

    const tagName = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => null);
    const role = await locator.getAttribute("role").catch(() => null);
    const href = await locator.getAttribute("href").catch(() => null);
    const textLabel = sanitizeStructuralLabel(await locator.innerText().catch(() => null));
    const ariaLabel = sanitizeStructuralLabel(await locator.getAttribute("aria-label").catch(() => null));
    const titleAttr = sanitizeStructuralLabel(await locator.getAttribute("title").catch(() => null));
    const enabled = await locator.isEnabled().catch(() => true);
    const boundingBox = await locator.boundingBox().catch(() => null);
    const label = textLabel ?? ariaLabel ?? titleAttr ?? null;
    const kind = href !== null || role === "link" || tagName === "a"
      ? "link"
      : tagName === "button" || role === "button"
        ? "button"
        : "tile";
    const classification = classifyControl({
      label: label ?? "Orders and QA Management",
      kind,
      href,
      withinForm: await locator.locator("xpath=ancestor::form[1]").count().then((count) => count > 0).catch(() => false),
      inNavigation: await locator.locator("xpath=ancestor::nav[1]").count().then((count) => count > 0).catch(() => false),
    }).classification;
    const supportsEnter =
      role === "button" ||
      role === "link" ||
      tagName === "button" ||
      tagName === "a" ||
      (await locator.getAttribute("tabindex").catch(() => null)) !== null;
    const supportsSpace = role === "button" || tagName === "button";
    const isPrimaryActionLike = await this.isPrimaryActionLike(locator, matchedTarget, {
      label,
      hasHref: href !== null,
      role,
      tagName,
    });

    return {
      metadata: {
        candidateIndex,
        tagName,
        role,
        textLabel,
        ariaLabel,
        titleAttr,
        visible,
        enabled,
        hasHref: href !== null,
        boundingBox: boundingBox
          ? {
              x: Number(boundingBox.x.toFixed(1)),
              y: Number(boundingBox.y.toFixed(1)),
              width: Number(boundingBox.width.toFixed(1)),
              height: Number(boundingBox.height.toFixed(1)),
            }
          : null,
        isPrimaryActionLike,
      },
      locator,
      classification,
      supportsEnter,
      supportsSpace,
    };
  }

  private async isInteractiveElement(locator: Locator): Promise<boolean> {
    const tagName = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => null);
    const role = await locator.getAttribute("role").catch(() => null);
    const href = await locator.getAttribute("href").catch(() => null);
    const tabIndex = await locator.getAttribute("tabindex").catch(() => null);
    const cursor = await locator
      .evaluate((node) => {
        const runtime = globalThis as unknown as {
          getComputedStyle: (target: unknown) => { cursor?: string };
        };

        return runtime.getComputedStyle(node).cursor ?? null;
      })
      .catch(() => null);

    return Boolean(
      tagName === "a" ||
        tagName === "button" ||
        role === "button" ||
        role === "link" ||
        href !== null ||
        tabIndex !== null ||
        cursor === "pointer",
    );
  }

  private async isPrimaryActionLike(
    locator: Locator,
    matchedTarget: Locator | null,
    input: {
      label: string | null;
      hasHref: boolean;
      role: string | null;
      tagName: string | null;
    },
  ): Promise<boolean> {
    if (input.label && looksLikeOrdersQaLabel(input.label)) {
      return true;
    }

    const locatorSignature = await readElementSignature(locator);
    const targetSignature = matchedTarget ? await readElementSignature(matchedTarget) : null;
    if (locatorSignature && targetSignature && locatorSignature === targetSignature) {
      return true;
    }

    const matchesPrimaryHintSelector = await locator
      .evaluate((node, selectors) => {
        const element = node as unknown as {
          matches: (selector: string) => boolean;
        };

        return selectors.some((selector) => element.matches(selector));
      }, INTERACTION_FORENSICS_SELECTORS.primaryActionHintSelectors)
      .catch(() => false);

    return Boolean(
      matchesPrimaryHintSelector &&
        (input.hasHref || input.role === "button" || input.role === "link" || input.tagName === "button"),
    );
  }
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

      while (current && segments.length < 5) {
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

      return segments.join(" > ");
    })
    .catch(() => null);
}

function looksLikeOrdersQaLabel(value: string): boolean {
  return (
    ORDERS_QA_ENTRY_PATTERNS.exact.some((pattern) => pattern.test(value)) ||
    ORDERS_QA_ENTRY_PATTERNS.loose.every((pattern) => pattern.test(value))
  );
}
