import type { Locator, Page } from "@playwright/test";
import type {
  PortalDomExtractedSection,
  PortalDomExtractedState,
  PortalDomSectionStatus,
} from "@medical-ai-qa/shared-types";
import {
  buildPortalDomExtractedState,
  extractPortalDomStateFromPage,
  type PortalDomExtractionThresholds,
} from "./portalDomExtraction";
import { waitForPortalPageSettled, type PortalDebugConfig } from "../utils/locatorResolution";

export type OasisDomSectionOption = {
  label: string;
  isSelected: boolean;
};

export type OasisDomSectionResult = {
  label: string;
  status: PortalDomSectionStatus;
  fallbackReasons: string[];
};

export type OasisDomExtractionResult = {
  state: PortalDomExtractedState;
  sectionResults: OasisDomSectionResult[];
  optionLabels: string[];
  skippedDeferredSections: string[];
};

const OASIS_PAGE_SELECTORS = [
  "app-document-note app-oasis fin-select.select-oasis-pages ng-select",
  "app-oasis fin-select.select-oasis-pages ng-select",
  "fin-select.select-oasis-pages ng-select",
  "fin-select[class*='select-oasis-pages'] ng-select",
  "app-oasis ng-select:has(input[role='combobox'])",
];

const OASIS_PAGE_TRIGGER_SELECTORS = [
  ".ng-select-container",
  ".ng-arrow-wrapper",
  "input[role='combobox']",
  "[role='combobox']",
];

const OASIS_PAGE_OPTION_SELECTORS = [
  "ng-dropdown-panel .ng-option",
  "ng-dropdown-panel [role='option']",
  ".ng-dropdown-panel .ng-option",
  ".ng-dropdown-panel [role='option']",
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function optionKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function isCarePlanProblemSection(label: string): boolean {
  return /\bcare\s*plan\b/i.test(label) || /\bidentified\s+problem/i.test(label);
}

function cleanCarePlanText(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .replace(/_+(?=\d)/g, "")
    .replace(/(?<=\d)_+/g, " ")
    .replace(/_{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function isCarePlanMetadataOnly(value: string): boolean {
  const cleaned = cleanCarePlanText(value);
  if (!cleaned) {
    return true;
  }
  if (/^(?:\(?s\)?|goal\(s\)|met goal\(s\)|no progress yet)$/i.test(cleaned)) {
    return true;
  }
  if (/^(?:target completion|term|status|unmet on|onset|source)\b/i.test(cleaned)) {
    return true;
  }
  return !/[a-z]/i.test(cleaned);
}

function extractBetween(text: string, start: RegExp, end: RegExp): string {
  const startMatch = text.match(start);
  if (!startMatch || startMatch.index === undefined) {
    return "";
  }
  const startIndex = startMatch.index + startMatch[0].length;
  const tail = text.slice(startIndex);
  const endMatch = tail.match(end);
  return cleanCarePlanText(endMatch?.index === undefined ? tail : tail.slice(0, endMatch.index));
}

async function extractCarePlanGoalFromHeaderDom(header: Locator): Promise<string> {
  const rawGoal = await header.evaluate((element) => {
    let root = (element as any).parentElement;
    while (root && !root.querySelector("[class*='careplan-summary__goal-content']")) {
      root = root.parentElement;
    }
    if (!root) {
      return "";
    }

    const goalBlocks = Array.from(root.querySelectorAll("[class*='careplan-summary__goal-content']")) as any[];
    for (const block of goalBlocks) {
      const title = (block.querySelector("[class*='careplan-summary__goal-title']")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const preText = block.querySelector("pre")?.textContent ?? "";
      const blockText = preText || block.textContent || "";
      if (title && !/^goal(?:\(s\))?$/i.test(title)) {
        continue;
      }
      const trimmed = blockText.replace(/\s+/g, " ").trim();
      if (!trimmed) {
        continue;
      }
      if (title && trimmed.toLowerCase().startsWith(title.toLowerCase())) {
        return trimmed.slice(title.length).trim();
      }
      return trimmed;
    }
    return "";
  }).catch(() => "");

  const goal = cleanCarePlanText(rawGoal);
  return isCarePlanMetadataOnly(goal) ? "" : goal;
}

async function extractCarePlanSectionFromPage(input: {
  page: Page;
  label: string;
  debugConfig?: PortalDebugConfig;
}): Promise<PortalDomExtractedSection | null> {
  const headers = input.page.locator("[class*='careplan-summary__header-label']");
  const headerCount = Math.min(await headers.count().catch(() => 0), 50);
  if (headerCount === 0) {
    return null;
  }

  const titles: string[] = [];
  for (let index = 0; index < headerCount; index += 1) {
    const title = cleanCarePlanText(await headers.nth(index).textContent({ timeout: 800 }).catch(() => null));
    if (title) {
      titles.push(title);
    }
  }

  const rows: string[][] = [];
  const fields: PortalDomExtractedSection["fields"] = [];
  const digestChunks: string[] = [];

  for (let index = 0; index < titles.length; index += 1) {
    const header = headers.nth(index);
    await header.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => undefined);
    await header.click({ timeout: 2_000 }).catch(async () => {
      await header.evaluate((element) => (element as any).click()).catch(() => undefined);
    });
    await waitForPortalPageSettled(input.page, input.debugConfig, 350);

    const bodyText = await input.page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const title = titles[index] ?? `Care Plan Problem ${index + 1}`;
    const startIndex = bodyText.indexOf(title);
    const nextTitleIndex = titles
      .slice(index + 1)
      .map((candidate) => bodyText.indexOf(candidate, startIndex + title.length))
      .filter((candidate) => candidate > startIndex)
      .sort((left, right) => left - right)[0];
    const segment = cleanCarePlanText(
      startIndex >= 0
        ? bodyText.slice(startIndex, nextTitleIndex === undefined ? undefined : nextTitleIndex)
        : bodyText,
    );
    const goal = extractBetween(segment, /\bGoal(?:\(s\))?\b\s*:?\s*/i, /\b(?:Target Completion|Intervention\s*\/\s*Treatment|Date\s+Accomplished|Add Intervention)\b/i);
    const domGoal = await extractCarePlanGoalFromHeaderDom(header);
    const intervention = extractBetween(
      segment,
      /\bIntervention\s*\/\s*Treatment\s*#?\d*\b/i,
      /\b(?:Date\s+Accomplished|Education,\s*Teaching|Discontinue Date|Assigned to Staff Type|Add Progress|No Progress Yet)\b/i,
    );
    const usableGoal = domGoal || (isCarePlanMetadataOnly(goal) ? "" : goal);
    const usableIntervention = isCarePlanMetadataOnly(intervention) ? "" : intervention;
    const targetCompletion = extractBetween(segment, /\bTarget Completion:\s*/i, /\b(?:Term:|Status:|Unmet on:|Intervention\s*\/\s*Treatment)\b/i);
    const term = extractBetween(segment, /\bTerm:\s*/i, /\b(?:Status:|Unmet on:|Intervention\s*\/\s*Treatment)\b/i);
    const status = extractBetween(segment, /\bStatus:\s*/i, /\b(?:Unmet on:|Intervention\s*\/\s*Treatment|Date\s+Accomplished)\b/i);
    const onset = extractBetween(segment, /\bOnset:\s*/i, /\bSource:\s*/i);
    const source = extractBetween(segment, /\bSource:\s*/i, /\b(?:\d+\/\d+\s+Met Goal|Goal\b|Target Completion|Add Goal|Delete Problem|$)\b/i);

    rows.push([
      String(index + 1),
      title,
      usableGoal,
      usableIntervention,
      targetCompletion,
      term,
      status,
      onset,
      source,
    ]);

    const baseKey = `care_plan_problem_${index + 1}`;
    fields.push({
      section: input.label,
      label: "Care Plan Problem",
      key: `${baseKey}_title`,
      value: title,
      sourceKind: "visibleText",
      confidence: "high",
      evidenceText: segment.slice(0, 500),
    });
    if (usableGoal) {
      fields.push({
        section: input.label,
        label: "Care Plan Goal",
        key: `${baseKey}_goal`,
        value: usableGoal,
        sourceKind: "visibleText",
        confidence: "high",
        evidenceText: segment.slice(0, 500),
      });
    }
    if (usableIntervention) {
      fields.push({
        section: input.label,
        label: "Care Plan Intervention",
        key: `${baseKey}_intervention`,
        value: usableIntervention,
        sourceKind: "visibleText",
        confidence: "high",
        evidenceText: segment.slice(0, 500),
      });
    }
    if (targetCompletion || term || status || onset || source) {
      fields.push({
        section: input.label,
        label: "Care Plan Metadata",
        key: `${baseKey}_metadata`,
        value: [
          targetCompletion ? `Target: ${targetCompletion}` : "",
          term ? `Term: ${term}` : "",
          status ? `Status: ${status}` : "",
          onset ? `Onset: ${onset}` : "",
          source ? `Source: ${source}` : "",
        ].filter(Boolean).join(" | "),
        sourceKind: "visibleText",
        confidence: "medium",
        evidenceText: segment.slice(0, 500),
      });
    }
    digestChunks.push(segment);
  }

  return {
    title: input.label,
    status: fields.length > 0 ? "success" : "degraded",
    fields,
    tables: [{
      section: input.label,
      title: "Care Plan Problems, Goals, and Interventions",
      headers: ["#", "Problem", "Goal", "Intervention", "Target Completion", "Term", "Status", "Onset", "Source"],
      rows,
    }],
    visibleTextDigest: digestChunks.join("\n\n").slice(0, 12_000),
    fallbackReasons: fields.length > 0 ? [] : ["care_plan_rows_not_structured"],
  };
}

function sanitizeRoutePattern(value: string | null | undefined): string | undefined {
  if (!value || value === "about:blank") {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname
      .replace(/\/provider\/[^/?#]+/i, "/provider/<provider-id>")
      .replace(/\/client\/[^/?#]+/i, "/client/<client-id>")
      .replace(/\/patient\/[^/?#]+/i, "/patient/<patient-id>")
      .replace(/\/intake\/[^/?#]+/i, "/intake/<intake-id>")
      .replace(/\/documents\/note\/[^/?#]+\/[^/?#]+/i, "/documents/note/<document-type>/<note-id>")
      .replace(/\/document\/[^/?#]+/i, "/document/<document-id>")}`;
  } catch {
    return undefined;
  }
}

async function locateOasisPageSelector(page: Page): Promise<Locator | null> {
  for (const selector of OASIS_PAGE_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0) === 0) {
      continue;
    }
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => undefined);
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function openOasisPageSelector(input: {
  page: Page;
  root: Locator;
  debugConfig?: PortalDebugConfig;
}): Promise<boolean> {
  if (await input.page.locator(OASIS_PAGE_OPTION_SELECTORS.join(", ")).first().isVisible().catch(() => false)) {
    return true;
  }

  for (const selector of OASIS_PAGE_TRIGGER_SELECTORS) {
    const trigger = input.root.locator(selector).first();
    if (!await trigger.isVisible().catch(() => false)) {
      continue;
    }
    await trigger.click({ timeout: 3_000 }).catch(async () => {
      await trigger.evaluate((element) => (element as any).click()).catch(() => undefined);
    });
    await waitForPortalPageSettled(input.page, input.debugConfig, 250);
    if (await input.page.locator(OASIS_PAGE_OPTION_SELECTORS.join(", ")).first().isVisible().catch(() => false)) {
      return true;
    }
  }

  await input.root.click({ timeout: 3_000 }).catch(() => undefined);
  await waitForPortalPageSettled(input.page, input.debugConfig, 250);
  return input.page.locator(OASIS_PAGE_OPTION_SELECTORS.join(", ")).first().isVisible().catch(() => false);
}

async function readOasisPageOptions(page: Page): Promise<OasisDomSectionOption[]> {
  const options: OasisDomSectionOption[] = [];
  for (const selector of OASIS_PAGE_OPTION_SELECTORS) {
    const locators = page.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 80);
    for (let index = 0; index < count; index += 1) {
      const option = locators.nth(index);
      if (!await option.isVisible().catch(() => false)) {
        continue;
      }
      const label = normalizeWhitespace(
        await option.locator(".ng-option-label").first().textContent({ timeout: 500 }).catch(() => null) ??
        await option.textContent({ timeout: 500 }).catch(() => null),
      );
      if (!label) {
        options.push({
          label: `blank-option-${index + 1}`,
          isSelected: false,
        });
        continue;
      }
      const ariaSelected = await option.getAttribute("aria-selected").catch(() => null);
      const className = await option.getAttribute("class").catch(() => null);
      options.push({
        label,
        isSelected: ariaSelected === "true" || /\bng-option-selected\b|\bselected\b/i.test(className ?? ""),
      });
    }
    if (options.length > 0) {
      break;
    }
  }

  const deduped = new Map<string, OasisDomSectionOption>();
  for (const option of options) {
    const key = optionKey(option.label);
    if (!deduped.has(key) || option.isSelected) {
      deduped.set(key, option);
    }
  }
  return [...deduped.values()];
}

async function selectOasisPageOption(input: {
  page: Page;
  label: string;
  debugConfig?: PortalDebugConfig;
}): Promise<boolean> {
  for (const selector of OASIS_PAGE_OPTION_SELECTORS) {
    const locators = input.page.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 80);
    for (let index = 0; index < count; index += 1) {
      const option = locators.nth(index);
      if (!await option.isVisible().catch(() => false)) {
        continue;
      }
      const label = normalizeWhitespace(
        await option.locator(".ng-option-label").first().textContent({ timeout: 500 }).catch(() => null) ??
        await option.textContent({ timeout: 500 }).catch(() => null),
      );
      if (optionKey(label || `blank-option-${index + 1}`) !== optionKey(input.label)) {
        continue;
      }
      await option.click({ timeout: 3_000 }).catch(async () => {
        await option.evaluate((element) => {
          const clickable = element.closest(".ng-option") ?? element;
          (clickable as any).click();
        }).catch(() => undefined);
      });
      await waitForPortalPageSettled(input.page, input.debugConfig, 500);
      return true;
    }
  }
  return false;
}

export async function extractOasisDomStateFromPage(input: {
  page: Page;
  thresholds?: Partial<PortalDomExtractionThresholds>;
  debugConfig?: PortalDebugConfig;
  maxSections?: number;
}): Promise<OasisDomExtractionResult> {
  const sectionResults: OasisDomSectionResult[] = [];
  const sections: PortalDomExtractedSection[] = [];
  const fallbackReasons: string[] = [];
  const root = await locateOasisPageSelector(input.page);

  if (!root) {
    fallbackReasons.push("oasis_page_selector_not_found");
    const state = buildPortalDomExtractedState({
      sourceArea: "oasis",
      sections: [],
      routePattern: sanitizeRoutePattern(input.page.url()),
      thresholds: input.thresholds,
      fallbackReasons,
    });
    return { state, sectionResults, optionLabels: [], skippedDeferredSections: [] };
  }

  const opened = await openOasisPageSelector({
    page: input.page,
    root,
    debugConfig: input.debugConfig,
  });
  if (!opened) {
    fallbackReasons.push("oasis_page_selector_could_not_open");
  }

  const options = opened ? await readOasisPageOptions(input.page) : [];
  if (options.length === 0) {
    fallbackReasons.push("oasis_page_options_not_readable");
    const current = await extractPortalDomStateFromPage(input.page, {
      sourceArea: "oasis",
      sectionTitle: "Current OASIS Page",
      ...input.thresholds,
    });
    return {
      state: buildPortalDomExtractedState({
        sourceArea: "oasis",
        sections: current.sections.map((section) => ({
          ...section,
          status: section.status === "success" ? "degraded" : section.status,
          fallbackReasons: [...(section.fallbackReasons ?? []), ...fallbackReasons],
        })),
        routePattern: sanitizeRoutePattern(input.page.url()),
        thresholds: input.thresholds,
        fallbackReasons,
      }),
      sectionResults: [{
        label: "Current OASIS Page",
        status: "degraded",
        fallbackReasons,
      }],
      optionLabels: [],
      skippedDeferredSections: [],
    };
  }

  const seen = new Set<string>();
  const skippedDeferredSections: string[] = [];
  const maxSections = Math.min(input.maxSections ?? 80, 80);
  for (const option of options.slice(0, maxSections)) {
    const key = optionKey(option.label);
    if (seen.has(key)) {
      sectionResults.push({ label: option.label, status: "skipped_duplicate", fallbackReasons: ["duplicate_oasis_page_option"] });
      continue;
    }
    seen.add(key);

    const reopenedRoot = await locateOasisPageSelector(input.page);
    const optionFallbackReasons: string[] = [];
    if (!reopenedRoot) {
      optionFallbackReasons.push("oasis_page_selector_lost_during_iteration");
      sectionResults.push({ label: option.label, status: "failed", fallbackReasons: optionFallbackReasons });
      sections.push({
        title: option.label,
        status: "failed",
        fields: [],
        tables: [],
        fallbackReasons: optionFallbackReasons,
      });
      continue;
    }
    const isOpen = await openOasisPageSelector({
      page: input.page,
      root: reopenedRoot,
      debugConfig: input.debugConfig,
    });
    if (!isOpen) {
      optionFallbackReasons.push("oasis_page_selector_reopen_failed");
      sectionResults.push({ label: option.label, status: "failed", fallbackReasons: optionFallbackReasons });
      sections.push({
        title: option.label,
        status: "failed",
        fields: [],
        tables: [],
        fallbackReasons: optionFallbackReasons,
      });
      continue;
    }

    const selected = await selectOasisPageOption({
      page: input.page,
      label: option.label,
      debugConfig: input.debugConfig,
    });
    if (!selected) {
      optionFallbackReasons.push("oasis_page_option_selection_failed");
      sectionResults.push({ label: option.label, status: "failed", fallbackReasons: optionFallbackReasons });
      sections.push({
        title: option.label,
        status: "failed",
        fields: [],
        tables: [],
        fallbackReasons: optionFallbackReasons,
      });
      continue;
    }

    const carePlanSection = isCarePlanProblemSection(option.label)
      ? await extractCarePlanSectionFromPage({
          page: input.page,
          label: option.label,
          debugConfig: input.debugConfig,
        }).catch(() => null)
      : null;
    const sectionState = carePlanSection
      ? null
      : await extractPortalDomStateFromPage(input.page, {
          sourceArea: "oasis",
          sectionTitle: option.label,
          ...input.thresholds,
        });
    const section = carePlanSection ?? sectionState?.sections[0];
    const status: PortalDomSectionStatus = section && (section.fields.length > 0 || section.tables.length > 0)
      ? "success"
      : "degraded";
    if (status === "degraded") {
      optionFallbackReasons.push("oasis_page_low_structured_dom_coverage");
    }
    sections.push({
      title: option.label,
      fields: section?.fields ?? [],
      tables: section?.tables ?? [],
      visibleTextDigest: section?.visibleTextDigest,
      status,
      fallbackReasons: optionFallbackReasons,
    });
    sectionResults.push({
      label: option.label,
      status,
      fallbackReasons: optionFallbackReasons,
    });
  }

  if (options.length > maxSections) {
    fallbackReasons.push(`oasis_page_option_limit_reached:${maxSections}`);
  }

  const state = buildPortalDomExtractedState({
      sourceArea: "oasis",
      sections,
      routePattern: sanitizeRoutePattern(input.page.url()),
      thresholds: input.thresholds,
      fallbackReasons,
    });

  return {
    state: {
      ...state,
      diagnostics: {
        ...state.diagnostics,
        sectionOptionLabels: options.map((option) => option.label),
        skippedDeferredSections,
      },
    },
    sectionResults,
    optionLabels: options.map((option) => option.label),
    skippedDeferredSections,
  };
}
