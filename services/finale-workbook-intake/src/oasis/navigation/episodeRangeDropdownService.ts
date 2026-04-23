import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Locator, Page } from "@playwright/test";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import {
  resolveFirstVisibleLocator,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../../portal/utils/locatorResolution";

export interface EpisodeRangeOption {
  rawLabel: string;
  startDate: string | null;
  endDate: string | null;
  isSelected: boolean;
}

export interface EpisodeRangeDiscoveryResult {
  currentSelection: EpisodeRangeOption | null;
  availableOptions: EpisodeRangeOption[];
  warnings: string[];
}

export interface EpisodeRangeContext {
  selectedRange: {
    rawLabel: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
  availableRanges: EpisodeRangeOption[];
  warnings: string[];
}

export interface EpisodeRangeSelectionTarget {
  rawLabel?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  required?: boolean;
}

export interface ResolvedEpisodeSelection {
  selectedOption: EpisodeRangeOption | null;
  availableOptions: EpisodeRangeOption[];
  changedSelection: boolean;
  warnings: string[];
  selectionMethod: "parsed_date_match" | "label_match" | "current_selection_fallback" | "unresolved";
}

interface EpisodeRangeSelectionPlan {
  option: EpisodeRangeOption | null;
  changedSelection: boolean;
  warnings: string[];
  selectionMethod: ResolvedEpisodeSelection["selectionMethod"];
}

interface EpisodeRangeAdapterOption {
  label: string;
  isSelected: boolean;
}

interface EpisodeRangeDropdownAdapter {
  locateDropdown(): Promise<{
    root: unknown;
    selectorUsed: string;
    currentLabel: string | null;
  } | null>;
  openDropdown(root: unknown): Promise<boolean>;
  readCurrentLabel(root: unknown): Promise<string | null>;
  readOptions(): Promise<EpisodeRangeAdapterOption[]>;
  selectOption(root: unknown, optionLabel: string): Promise<boolean>;
  currentUrl(): string;
}

export interface EpisodeRangeDropdownServiceParams {
  page: Page;
  logger: Logger;
  context: PatientPortalContext;
  workflowRunId?: string;
  debugConfig?: PortalDebugConfig;
}

const EPISODE_RANGE_REGEX =
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/;

const EPISODE_DROPDOWN_SELECTORS = [
  {
    selector: "app-header-info header-container ng-select:has(input[role='combobox'])",
    description: "app-header-info header-container ng-select with combobox",
  },
  {
    selector: "app-header-info ng-select:has(input[role='combobox'])",
    description: "app-header-info ng-select with combobox",
  },
  {
    selector: "header-container ng-select:has(input[role='combobox'])",
    description: "header-container ng-select with combobox",
  },
  {
    selector: "ng-select:has(input[role='combobox'])",
    description: "generic ng-select with combobox",
  },
];

const EPISODE_DROPDOWN_VALUE_SELECTORS = [
  ".ng-value-label",
  ".ng-value",
  ".ng-select-container",
  "div[role='combobox']",
  "input[role='combobox']",
];

const EPISODE_DROPDOWN_TRIGGER_SELECTORS = [
  ".ng-select-container",
  "div[role='combobox']",
  ".ng-arrow-wrapper",
  "input[role='combobox']",
];

const EPISODE_DROPDOWN_OPTION_SELECTORS = [
  "ng-dropdown-panel .ng-option",
  "ng-dropdown-panel [role='option']",
];

export function parseEpisodeRangeLabel(
  label: string,
  options?: { isSelected?: boolean },
): EpisodeRangeOption {
  const rawLabel = normalizeWhitespace(label);
  const match = rawLabel.match(EPISODE_RANGE_REGEX);
  return {
    rawLabel,
    startDate: normalizeDateText(match?.[1] ?? null),
    endDate: normalizeDateText(match?.[2] ?? null),
    isSelected: options?.isSelected ?? false,
  };
}

export function createEpisodeRangeContext(
  discovery: EpisodeRangeDiscoveryResult,
): EpisodeRangeContext {
  return {
    selectedRange: discovery.currentSelection
      ? {
          rawLabel: discovery.currentSelection.rawLabel,
          startDate: discovery.currentSelection.startDate,
          endDate: discovery.currentSelection.endDate,
        }
      : null,
    availableRanges: discovery.availableOptions,
    warnings: discovery.warnings,
  };
}

export function planEpisodeRangeSelection(input: {
  discovery: EpisodeRangeDiscoveryResult;
  target?: EpisodeRangeSelectionTarget | null;
}): EpisodeRangeSelectionPlan {
  const warnings = [...input.discovery.warnings];
  const target = input.target;

  if (!target || (!target.rawLabel && !target.startDate && !target.endDate)) {
    return {
      option: input.discovery.currentSelection,
      changedSelection: false,
      warnings,
      selectionMethod: input.discovery.currentSelection ? "current_selection_fallback" : "unresolved",
    };
  }

  const normalizedTargetLabel = normalizeEpisodeRangeLabel(target.rawLabel ?? null);
  const parsedMatch = input.discovery.availableOptions.find((option) =>
    option.startDate &&
    option.endDate &&
    option.startDate === normalizeDateText(target.startDate ?? null) &&
    option.endDate === normalizeDateText(target.endDate ?? null),
  );
  if (parsedMatch) {
    return {
      option: parsedMatch,
      changedSelection: !parsedMatch.isSelected,
      warnings,
      selectionMethod: "parsed_date_match",
    };
  }

  const labelMatch = input.discovery.availableOptions.find((option) =>
    normalizeEpisodeRangeLabel(option.rawLabel) === normalizedTargetLabel);
  if (labelMatch) {
    return {
      option: labelMatch,
      changedSelection: !labelMatch.isSelected,
      warnings,
      selectionMethod: "label_match",
    };
  }

  if (input.discovery.currentSelection) {
    warnings.push(
      `Requested episode range ${target.rawLabel ?? `${target.startDate ?? "unknown"} - ${target.endDate ?? "unknown"}`} was not found; keeping the current Episode of selection.`,
    );
    return {
      option: input.discovery.currentSelection,
      changedSelection: false,
      warnings,
      selectionMethod: "current_selection_fallback",
    };
  }

  warnings.push("Episode of selection could not be resolved because no matching option was found.");
  if (target.required) {
    warnings.push("A required Episode of selection target was requested but could not be applied.");
  }
  return {
    option: null,
    changedSelection: false,
    warnings,
    selectionMethod: "unresolved",
  };
}

export async function discoverEpisodeRangeOptions(
  params: EpisodeRangeDropdownServiceParams,
): Promise<{
  discovery: EpisodeRangeDiscoveryResult;
  stepLogs: AutomationStepLog[];
}> {
  return discoverEpisodeRangeOptionsWithAdapter({
    adapter: createPlaywrightEpisodeRangeDropdownAdapter(params.page, params.debugConfig),
    logger: params.logger,
    context: params.context,
    workflowRunId: params.workflowRunId,
  });
}

export async function selectEpisodeRange(
  params: EpisodeRangeDropdownServiceParams & {
    target?: EpisodeRangeSelectionTarget | null;
  },
): Promise<{
  result: ResolvedEpisodeSelection;
  stepLogs: AutomationStepLog[];
}> {
  return selectEpisodeRangeWithAdapter({
    adapter: createPlaywrightEpisodeRangeDropdownAdapter(params.page, params.debugConfig),
    target: params.target,
    logger: params.logger,
    context: params.context,
    workflowRunId: params.workflowRunId,
  });
}

export async function discoverEpisodeRangeOptionsWithAdapter(input: {
  adapter: EpisodeRangeDropdownAdapter;
  logger: Logger;
  context: PatientPortalContext;
  workflowRunId?: string;
}): Promise<{
  discovery: EpisodeRangeDiscoveryResult;
  stepLogs: AutomationStepLog[];
}> {
  const warnings: string[] = [];
  const stepLogs: AutomationStepLog[] = [];
  const located = await input.adapter.locateDropdown();

  if (!located) {
    const warning = "Episode of dropdown with a valid date range could not be located on the patient dashboard.";
    warnings.push(warning);
    logEpisodeEvent(input, "episode_option_selection_failed", "blocked", {
      warnings,
    }, "failed to locate episode range dropdown");
    stepLogs.push(
      createEpisodeStepLog(input.context, {
        step: "episode_option_selection_failed",
        message: warning,
        urlBefore: input.context.chartUrl,
        urlAfter: input.adapter.currentUrl(),
        missing: ["Episode of dropdown"],
        evidence: warnings,
      }),
    );
    return {
      discovery: {
        currentSelection: null,
        availableOptions: [],
        warnings,
      },
      stepLogs,
    };
  }

  stepLogs.push(
    createEpisodeStepLog(input.context, {
      step: "episode_dropdown_located",
      message: "Located the Episode of dropdown on the patient dashboard.",
      urlBefore: input.context.chartUrl,
      urlAfter: input.adapter.currentUrl(),
      found: [`selectorUsed=${located.selectorUsed}`],
      evidence: [`currentSelection=${located.currentLabel ?? "none"}`],
    }),
  );
  logEpisodeEvent(input, "episode_dropdown_located", "completed", {
    selectorUsed: located.selectorUsed,
    currentUrl: input.adapter.currentUrl(),
    rawLabels: located.currentLabel ? [located.currentLabel] : [],
  }, "located episode range dropdown");

  const currentLabel = located.currentLabel ?? await input.adapter.readCurrentLabel(located.root);
  const currentSelection = currentLabel
    ? parseEpisodeRangeLabel(currentLabel, { isSelected: true })
    : null;
  if (currentLabel && !currentSelection?.startDate) {
    warnings.push(`Current Episode of label could not be parsed into dates: ${currentLabel}`);
  }

  stepLogs.push(
    createEpisodeStepLog(input.context, {
      step: "episode_current_range_read",
      message: currentSelection
        ? "Read the current Episode of selection from the dashboard dropdown."
        : "Episode of dropdown was located, but the current selection label was not readable.",
      urlBefore: input.context.chartUrl,
      urlAfter: input.adapter.currentUrl(),
      found: currentSelection ? [`currentSelection=${currentSelection.rawLabel}`] : [],
      missing: currentSelection ? [] : ["current Episode of label"],
      evidence: currentSelection
        ? [
            `startDate=${currentSelection.startDate ?? "none"}`,
            `endDate=${currentSelection.endDate ?? "none"}`,
          ]
        : [],
    }),
  );
  logEpisodeEvent(input, "episode_current_range_read", currentSelection ? "completed" : "warning", {
    currentUrl: input.adapter.currentUrl(),
    rawLabels: currentSelection ? [currentSelection.rawLabel] : [],
    selectedRange: currentSelection,
    warnings,
  }, "read current episode range");

  const opened = await input.adapter.openDropdown(located.root);
  if (!opened) {
    warnings.push("Episode of dropdown could not be opened to enumerate available ranges.");
  } else {
    stepLogs.push(
      createEpisodeStepLog(input.context, {
        step: "episode_dropdown_opened",
        message: "Opened the Episode of dropdown to inspect available ranges.",
        urlBefore: input.context.chartUrl,
        urlAfter: input.adapter.currentUrl(),
        found: ["dropdownOpened=true"],
      }),
    );
    logEpisodeEvent(input, "episode_dropdown_opened", "completed", {
      currentUrl: input.adapter.currentUrl(),
    }, "opened episode range dropdown");
  }

  const adapterOptions = opened ? await input.adapter.readOptions() : [];
  const availableOptions = dedupeEpisodeOptions(
    adapterOptions.map((option) => parseEpisodeRangeLabel(option.label, {
      isSelected: option.isSelected || normalizeEpisodeRangeLabel(option.label) === normalizeEpisodeRangeLabel(currentSelection?.rawLabel ?? null),
    })),
  );
  if (availableOptions.length === 0 && currentSelection) {
    availableOptions.push(currentSelection);
  }

  for (const option of availableOptions) {
    if (!option.startDate) {
      warnings.push(`Episode of option could not be parsed into dates: ${option.rawLabel}`);
    }
  }

  stepLogs.push(
    createEpisodeStepLog(input.context, {
      step: "episode_options_discovered",
      message: `Discovered ${availableOptions.length} Episode of range option(s).`,
      urlBefore: input.context.chartUrl,
      urlAfter: input.adapter.currentUrl(),
      found: availableOptions.map((option) => option.rawLabel),
      missing: availableOptions.length > 0 ? [] : ["Episode of options"],
      evidence: availableOptions.map((option) =>
        `${option.rawLabel} => ${option.startDate ?? "none"} -> ${option.endDate ?? "none"}${option.isSelected ? " [selected]" : ""}`),
    }),
  );
  logEpisodeEvent(input, "episode_options_discovered", availableOptions.length > 0 ? "completed" : "warning", {
    currentUrl: input.adapter.currentUrl(),
    rawLabels: availableOptions.map((option) => option.rawLabel),
    availableRanges: availableOptions,
    warnings,
  }, "discovered episode range options");

  return {
    discovery: {
      currentSelection,
      availableOptions,
      warnings,
    },
    stepLogs,
  };
}

export async function selectEpisodeRangeWithAdapter(input: {
  adapter: EpisodeRangeDropdownAdapter;
  target?: EpisodeRangeSelectionTarget | null;
  logger: Logger;
  context: PatientPortalContext;
  workflowRunId?: string;
}): Promise<{
  result: ResolvedEpisodeSelection;
  stepLogs: AutomationStepLog[];
}> {
  const discoveryResult = await discoverEpisodeRangeOptionsWithAdapter(input);
  const selectionPlan = planEpisodeRangeSelection({
    discovery: discoveryResult.discovery,
    target: input.target,
  });

  let selectedOption = selectionPlan.option;
  let changedSelection = false;
  const stepLogs = [...discoveryResult.stepLogs];
  const warnings = [...selectionPlan.warnings];

  if (selectionPlan.option && selectionPlan.changedSelection) {
    const located = await input.adapter.locateDropdown();
    if (located) {
      const selected = await input.adapter.selectOption(located.root, selectionPlan.option.rawLabel);
      if (selected) {
        changedSelection = true;
        const rediscovery = await discoverEpisodeRangeOptionsWithAdapter(input);
        selectedOption = rediscovery.discovery.currentSelection ?? selectionPlan.option;
        stepLogs.push(...rediscovery.stepLogs);
        stepLogs.push(
          createEpisodeStepLog(input.context, {
            step: "episode_option_selected",
            message: `Selected Episode of range ${selectionPlan.option.rawLabel}.`,
            urlBefore: input.context.chartUrl,
            urlAfter: input.adapter.currentUrl(),
            found: [selectionPlan.option.rawLabel],
            evidence: [
              `selectionMethod=${selectionPlan.selectionMethod}`,
              `startDate=${selectionPlan.option.startDate ?? "none"}`,
              `endDate=${selectionPlan.option.endDate ?? "none"}`,
            ],
          }),
        );
        logEpisodeEvent(input, "episode_option_selected", "completed", {
          currentUrl: input.adapter.currentUrl(),
          rawLabels: [selectionPlan.option.rawLabel],
          selectedRange: selectedOption,
        }, "selected requested episode range");
      } else {
        warnings.push(`Episode of option ${selectionPlan.option.rawLabel} was planned but could not be selected.`);
      }
    }
  } else if (selectionPlan.selectionMethod === "unresolved") {
    stepLogs.push(
      createEpisodeStepLog(input.context, {
        step: "episode_option_selection_failed",
        message: "Episode of selection could not be resolved to a concrete dropdown option.",
        urlBefore: input.context.chartUrl,
        urlAfter: input.adapter.currentUrl(),
        missing: ["matching Episode of option"],
        evidence: warnings,
      }),
    );
    logEpisodeEvent(input, "episode_option_selection_failed", "blocked", {
      currentUrl: input.adapter.currentUrl(),
      warnings,
      rawLabels: discoveryResult.discovery.availableOptions.map((option) => option.rawLabel),
    }, "failed to resolve episode range selection");
  }

  return {
    result: {
      selectedOption,
      availableOptions: discoveryResult.discovery.availableOptions,
      changedSelection,
      warnings,
      selectionMethod: selectionPlan.selectionMethod,
    },
    stepLogs,
  };
}

function createPlaywrightEpisodeRangeDropdownAdapter(
  page: Page,
  debugConfig?: PortalDebugConfig,
): EpisodeRangeDropdownAdapter {
  return {
    async locateDropdown() {
      const resolution = await resolveFirstVisibleLocator({
        page,
        candidates: EPISODE_DROPDOWN_SELECTORS.map((candidate) => ({
          strategy: "css" as const,
          selector: candidate.selector,
          description: candidate.description,
        })),
        step: "episode_dropdown",
        debugConfig,
        settle: async () => waitForPortalPageSettled(page, debugConfig),
      });
      if (!resolution.locator) {
        return null;
      }
      const currentLabel = await readCurrentLabelFromDropdownRoot(resolution.locator);
      if (!findEpisodeRangeText(currentLabel)) {
        return null;
      }
      return {
        root: resolution.locator,
        selectorUsed: resolution.matchedCandidate?.description ?? "ng-select",
        currentLabel,
      };
    },
    async openDropdown(root) {
      for (const selector of EPISODE_DROPDOWN_OPTION_SELECTORS) {
        const optionLocator = page.locator(selector).first();
        if (await optionLocator.isVisible().catch(() => false)) {
          return true;
        }
      }
      const locator = root as Locator;
      const trigger = await resolveTrigger(locator);
      await trigger.click().catch(async () => {
        await locator.click().catch(() => undefined);
      });
      await waitForPortalPageSettled(page, debugConfig);
      for (const selector of EPISODE_DROPDOWN_OPTION_SELECTORS) {
        const optionLocator = page.locator(selector).first();
        if (await optionLocator.isVisible().catch(() => false)) {
          return true;
        }
      }
      return false;
    },
    async readCurrentLabel(root) {
      return readCurrentLabelFromDropdownRoot(root as Locator);
    },
    async readOptions() {
      const options: EpisodeRangeAdapterOption[] = [];
      for (const selector of EPISODE_DROPDOWN_OPTION_SELECTORS) {
        const locators = page.locator(selector);
        const count = await locators.count().catch(() => 0);
        if (count === 0) {
          continue;
        }
        for (let index = 0; index < count; index += 1) {
          const locator = locators.nth(index);
          const label = normalizeWhitespace(await locator.textContent().catch(() => null));
          if (!findEpisodeRangeText(label)) {
            continue;
          }
          const ariaSelected = await locator.getAttribute("aria-selected").catch(() => null);
          const selectedClass = await locator.getAttribute("class").catch(() => null);
          options.push({
            label: findEpisodeRangeText(label) ?? label,
            isSelected: ariaSelected === "true" || /\bselected\b/i.test(selectedClass ?? ""),
          });
        }
        if (options.length > 0) {
          break;
        }
      }
      return options;
    },
    async selectOption(_root, optionLabel) {
      for (const selector of EPISODE_DROPDOWN_OPTION_SELECTORS) {
        const locators = page.locator(selector);
        const count = await locators.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const locator = locators.nth(index);
          const label = normalizeWhitespace(await locator.textContent().catch(() => null));
          if (normalizeEpisodeRangeLabel(label) !== normalizeEpisodeRangeLabel(optionLabel)) {
            continue;
          }
          await locator.click().catch(() => undefined);
          await waitForPortalPageSettled(page, debugConfig);
          return true;
        }
      }
      return false;
    },
    currentUrl() {
      return page.url();
    },
  };
}

async function readCurrentLabelFromDropdownRoot(root: Locator): Promise<string | null> {
  for (const selector of EPISODE_DROPDOWN_VALUE_SELECTORS) {
    const locator = root.locator(selector).first();
    if (!await locator.isVisible().catch(() => false)) {
      continue;
    }
    if (selector === "input[role='combobox']") {
      const inputValue = normalizeWhitespace(await locator.inputValue().catch(() => null));
      const matchedValue = findEpisodeRangeText(inputValue);
      if (matchedValue) {
        return matchedValue;
      }
    }
    const text = normalizeWhitespace(await locator.textContent().catch(() => null));
    const matchedText = findEpisodeRangeText(text);
    if (matchedText) {
      return matchedText;
    }
  }

  const rootText = normalizeWhitespace(await root.textContent().catch(() => null));
  return findEpisodeRangeText(rootText);
}

async function resolveTrigger(root: Locator): Promise<Locator> {
  for (const selector of EPISODE_DROPDOWN_TRIGGER_SELECTORS) {
    const locator = root.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return root;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function findEpisodeRangeText(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(EPISODE_RANGE_REGEX);
  return match ? `${match[1]} - ${match[2]}` : null;
}

function normalizeDateText(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized) ? normalized : null;
}

function normalizeEpisodeRangeLabel(value: string | null | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

function dedupeEpisodeOptions(options: EpisodeRangeOption[]): EpisodeRangeOption[] {
  const deduped = new Map<string, EpisodeRangeOption>();
  for (const option of options) {
    if (!option.rawLabel) {
      continue;
    }
    const key = normalizeEpisodeRangeLabel(option.rawLabel);
    const existing = deduped.get(key);
    if (!existing || option.isSelected) {
      deduped.set(key, option);
    }
  }
  return [...deduped.values()];
}

function createEpisodeStepLog(
  context: PatientPortalContext,
  input: {
    step: string;
    message: string;
    urlBefore: string;
    urlAfter: string;
    found?: string[];
    missing?: string[];
    evidence?: string[];
  },
): AutomationStepLog {
  return createAutomationStepLog({
    step: input.step,
    message: input.message,
    patientName: context.patientName,
    urlBefore: input.urlBefore,
    urlAfter: input.urlAfter,
    found: [`workflowDomain=${context.workflowDomain}`, `patientRunId=${context.patientRunId}`, ...(input.found ?? [])],
    missing: input.missing,
    evidence: input.evidence,
    safeReadConfirmed: true,
  });
}

function logEpisodeEvent(
  input: {
    logger: Logger;
    context: PatientPortalContext;
    workflowRunId?: string;
  },
  stepName: string,
  outcome: string,
  extra: {
    currentUrl?: string;
    rawLabels?: string[];
    selectedRange?: EpisodeRangeOption | null;
    availableRanges?: EpisodeRangeOption[];
    warnings?: string[];
    selectorUsed?: string | null;
  },
  message: string,
): void {
  input.logger.info(
    {
      workflowDomain: input.context.workflowDomain,
      patientRunId: input.context.patientRunId,
      workflowRunId: input.workflowRunId ?? `${input.context.patientRunId}:${input.context.workflowDomain}`,
      stepName,
      outcome,
      currentUrl: extra.currentUrl ?? input.context.chartUrl,
      chartUrl: input.context.chartUrl,
      rawLabels: extra.rawLabels ?? [],
      selectedRange: extra.selectedRange
        ? {
            rawLabel: extra.selectedRange.rawLabel,
            startDate: extra.selectedRange.startDate,
            endDate: extra.selectedRange.endDate,
            isSelected: extra.selectedRange.isSelected,
          }
        : null,
      availableRanges: extra.availableRanges?.map((option) => ({
        rawLabel: option.rawLabel,
        startDate: option.startDate,
        endDate: option.endDate,
        isSelected: option.isSelected,
      })),
      selectorUsed: extra.selectorUsed ?? null,
      warnings: extra.warnings ?? [],
    },
    message,
  );
}
