import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { PatientPortalContext } from "../portal/context/patientPortalContext";
import {
  discoverEpisodeRangeOptionsWithAdapter,
  parseEpisodeRangeLabel,
  planEpisodeRangeSelection,
  selectEpisodeRangeWithAdapter,
  type EpisodeRangeSelectionTarget,
} from "../oasis/navigation/episodeRangeDropdownService";

const context: PatientPortalContext = {
  batchId: "batch-1",
  patientRunId: "run-1",
  workflowDomain: "qa",
  patientName: "Jane Doe",
  patientId: "PT-1",
  chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
  dashboardUrl: "https://demo.portal/provider/branch/dashboard",
  resolvedAt: "2026-04-08T10:00:00.000Z",
};

class FakeEpisodeRangeAdapter {
  public selectedLabel: string;
  public opened = false;

  constructor(private readonly options: string[], initialSelection: string) {
    this.selectedLabel = initialSelection;
  }

  async locateDropdown() {
    return {
      root: "episode-root",
      selectorUsed: "app-header-info ng-select",
      currentLabel: this.selectedLabel,
    };
  }

  async openDropdown() {
    this.opened = true;
    return true;
  }

  async readCurrentLabel() {
    return this.selectedLabel;
  }

  async readOptions() {
    return this.options.map((label) => ({
      label,
      isSelected: label === this.selectedLabel,
    }));
  }

  async selectOption(_root: unknown, optionLabel: string) {
    const matched = this.options.find((label) => label === optionLabel);
    if (!matched) {
      return false;
    }
    this.selectedLabel = matched;
    return true;
  }

  currentUrl() {
    return context.chartUrl;
  }
}

describe("episodeRangeDropdownService", () => {
  it("parses valid episode range labels and normalizes whitespace", () => {
    expect(parseEpisodeRangeLabel("02/27/2026 - 04/27/2026")).toEqual({
      rawLabel: "02/27/2026 - 04/27/2026",
      startDate: "02/27/2026",
      endDate: "04/27/2026",
      isSelected: false,
    });

    expect(parseEpisodeRangeLabel("  02/27/2026   -   04/27/2026  ", { isSelected: true })).toEqual({
      rawLabel: "02/27/2026 - 04/27/2026",
      startDate: "02/27/2026",
      endDate: "04/27/2026",
      isSelected: true,
    });
  });

  it("keeps malformed labels without crashing and returns null dates", () => {
    expect(parseEpisodeRangeLabel("Current Episode")).toEqual({
      rawLabel: "Current Episode",
      startDate: null,
      endDate: null,
      isSelected: false,
    });
  });

  it("discovers the current selection and available options from the dropdown adapter", async () => {
    const adapter = new FakeEpisodeRangeAdapter([
      "02/27/2026 - 04/27/2026",
      "04/28/2026 - 06/26/2026",
    ], "02/27/2026 - 04/27/2026");

    const result = await discoverEpisodeRangeOptionsWithAdapter({
      adapter,
      logger: pino({ level: "silent" }),
      context,
    });

    expect(result.discovery.currentSelection?.rawLabel).toBe("02/27/2026 - 04/27/2026");
    expect(result.discovery.availableOptions).toHaveLength(2);
    expect(result.discovery.availableOptions[1]?.startDate).toBe("04/28/2026");
    expect(result.stepLogs.some((log) => log.step === "episode_dropdown_located")).toBe(true);
    expect(result.stepLogs.some((log) => log.step === "episode_options_discovered")).toBe(true);
  });

  it("supports targeted selection by parsed dates and reports changedSelection", async () => {
    const adapter = new FakeEpisodeRangeAdapter([
      "02/27/2026 - 04/27/2026",
      "04/28/2026 - 06/26/2026",
    ], "02/27/2026 - 04/27/2026");

    const target: EpisodeRangeSelectionTarget = {
      startDate: "04/28/2026",
      endDate: "06/26/2026",
      required: true,
    };

    const result = await selectEpisodeRangeWithAdapter({
      adapter,
      target,
      logger: pino({ level: "silent" }),
      context,
    });

    expect(result.result.selectedOption?.rawLabel).toBe("04/28/2026 - 06/26/2026");
    expect(result.result.changedSelection).toBe(true);
    expect(result.result.selectionMethod).toBe("parsed_date_match");
    expect(result.stepLogs.some((log) => log.step === "episode_option_selected")).toBe(true);
  });

  it("falls back to the current selection and records a warning when the target is unavailable", async () => {
    const plan = planEpisodeRangeSelection({
      discovery: {
        currentSelection: parseEpisodeRangeLabel("02/27/2026 - 04/27/2026", { isSelected: true }),
        availableOptions: [
          parseEpisodeRangeLabel("02/27/2026 - 04/27/2026", { isSelected: true }),
        ],
        warnings: [],
      },
      target: {
        rawLabel: "05/01/2026 - 06/01/2026",
      },
    });

    expect(plan.option?.rawLabel).toBe("02/27/2026 - 04/27/2026");
    expect(plan.changedSelection).toBe(false);
    expect(plan.selectionMethod).toBe("current_selection_fallback");
    expect(plan.warnings[0]).toMatch(/not found/i);
  });
});
