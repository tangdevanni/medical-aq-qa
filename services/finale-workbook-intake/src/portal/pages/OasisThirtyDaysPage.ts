import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Download, Locator, Page } from "@playwright/test";
import type { AutomationStepLog } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import { selectorRegistry } from "../selectorRegistry";
import type { PortalSelectorCandidate } from "../selectors/types";
import { createAutomationStepLog } from "../utils/automationLog";
import {
  resolveVisibleLocatorList,
  selectorAttemptToEvidence,
  waitForPortalPageSettled,
  type PortalDebugConfig,
} from "../utils/locatorResolution";
import {
  capturePageDebugArtifacts,
  pauseOnFailureIfRequested,
} from "../utils/pageDiagnostics";

interface ControlCandidate {
  label: string;
  locator: Locator;
}

function normalizeVisibleText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function readControlLabel(locator: Locator): Promise<string> {
  return normalizeVisibleText(
    (await locator.getAttribute("aria-label").catch(() => null)) ??
      (await locator.getAttribute("title").catch(() => null)) ??
      (await locator.textContent().catch(() => null)),
  );
}

export function looksLikeExcelExportLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return /export\s+all|export(?:\s+to)?\s+excel|excel\s+export|\bexcel\b/i.test(normalized);
}

export function scoreExcelExportControl(label: string): number {
  const normalized = normalizeVisibleText(label).toLowerCase();
  if (!normalized) {
    return 0;
  }
  if (/export all/i.test(normalized)) {
    return 1_100;
  }
  if (/export to excel/i.test(normalized)) {
    return 1_000;
  }
  if (looksLikeExcelExportLabel(normalized)) {
    return 700;
  }

  let score = 0;
  if (normalized.includes("export")) {
    score += 200;
  }
  if (normalized.includes("excel")) {
    score += 150;
  }
  return score;
}

async function waitForDownloadAfterClick(
  page: Page,
  clickAction: () => Promise<void>,
  timeoutMs: number,
): Promise<Download | null> {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs }).catch(() => null);
  await clickAction();
  return downloadPromise;
}

export class OasisThirtyDaysPage {
  constructor(
    private readonly page: Page,
    private readonly options: {
      logger?: Logger;
      debugConfig?: PortalDebugConfig;
      debugDir?: string;
      downloadTimeoutMs?: number;
    } = {},
  ) {}

  async exportWorkbook(input: {
    destinationPath: string;
    fallbackFileName?: string | null;
    downloadTimeoutMs?: number;
  }): Promise<{
    originalFileName: string;
    storedPath: string;
    stepLogs: AutomationStepLog[];
  }> {
    const exportControls = await this.collectControls(
      selectorRegistry.finaleDashboard.exportControls,
      "oasis_export_controls",
    );
    const exportControl = exportControls
      .map((entry) => ({ ...entry, score: scoreExcelExportControl(entry.label) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0];

    if (!exportControl) {
      const failureArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "oasis-export",
        reason: "export-control-not-found",
        debugConfig: this.options.debugConfig,
        textHints: ["Export to Excel", "Export", "Excel"],
      });
      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      throw new Error(
        `The workbook export control was not found in the OASIS 30 Day's panel. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
      );
    }

    const downloadTimeoutMs = input.downloadTimeoutMs ?? this.options.downloadTimeoutMs ?? 20_000;
    const urlBefore = this.page.url();
    let download = await waitForDownloadAfterClick(
      this.page,
      async () => {
        await exportControl.locator.click();
        await waitForPortalPageSettled(this.page, this.options.debugConfig);
      },
      4_000,
    );

    let menuSelectionLabel: string | null = null;
    if (!download) {
      const menuControls = await this.collectControls(
        selectorRegistry.finaleDashboard.exportMenuItems,
        "oasis_export_menu_items",
      );
      const menuControl = menuControls
        .map((entry) => ({ ...entry, score: scoreExcelExportControl(entry.label) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)[0];

      if (!menuControl) {
        const failureArtifacts = await capturePageDebugArtifacts({
          page: this.page,
          outputDir: this.options.debugDir,
          step: "oasis-export",
          reason: "excel-menu-not-found",
          debugConfig: this.options.debugConfig,
          textHints: ["Export to Excel", "Excel"],
        });
        await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
        throw new Error(
          `The workbook export menu did not expose an Excel option after clicking '${exportControl.label}'. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
        );
      }

      menuSelectionLabel = menuControl.label;
      download = await waitForDownloadAfterClick(
        this.page,
        async () => {
          await menuControl.locator.click();
          await waitForPortalPageSettled(this.page, this.options.debugConfig);
        },
        downloadTimeoutMs,
      );
    }

    if (!download) {
      const failureArtifacts = await capturePageDebugArtifacts({
        page: this.page,
        outputDir: this.options.debugDir,
        step: "oasis-export",
        reason: "download-not-started",
        debugConfig: this.options.debugConfig,
        textHints: ["Export to Excel", "Excel", "download"],
      });
      await pauseOnFailureIfRequested(this.page, this.options.debugConfig);
      throw new Error(
        `The OASIS workbook export did not trigger a file download. Debug summary: ${failureArtifacts.summaryPath ?? "not captured"}.`,
      );
    }

    const suggestedFileName =
      download.suggestedFilename() ??
      input.fallbackFileName?.trim() ??
      path.basename(input.destinationPath);

    await mkdir(path.dirname(input.destinationPath), { recursive: true });
    await download.saveAs(input.destinationPath);

    this.options.logger?.info(
      {
        exportControlLabel: exportControl.label,
        exportMenuLabel: menuSelectionLabel,
        suggestedFileName,
        storedPath: input.destinationPath,
      },
      "downloaded OASIS 30 Day's workbook export",
    );

    return {
      originalFileName: suggestedFileName,
      storedPath: input.destinationPath,
      stepLogs: [
        createAutomationStepLog({
          step: "workbook_export",
          message: "Exported and persisted the OASIS 30 Day's workbook.",
          urlBefore,
          urlAfter: this.page.url(),
          selectorUsed: "finaleDashboard.exportControls",
          found: [
            `exportControl=${exportControl.label}`,
            menuSelectionLabel ? `exportMenu=${menuSelectionLabel}` : "exportMenu=direct-download",
            `downloadedFile=${suggestedFileName}`,
          ],
          evidence: [`storedPath=${input.destinationPath}`],
          safeReadConfirmed: true,
        }),
      ],
    };
  }

  private async collectControls(
    candidates: PortalSelectorCandidate[],
    step: string,
  ): Promise<ControlCandidate[]> {
    const resolution = await resolveVisibleLocatorList({
      page: this.page,
      candidates,
      step,
      logger: this.options.logger,
      debugConfig: this.options.debugConfig,
      maxItems: 30,
    });

    const controls: ControlCandidate[] = [];
    for (const item of resolution.items) {
      const label = await readControlLabel(item.locator);
      if (!label) {
        continue;
      }
      controls.push({
        label,
        locator: item.locator,
      });
    }

    this.options.logger?.info(
      {
        step,
        labels: controls.map((control) => control.label),
        selectorEvidence: resolution.attempts.map(selectorAttemptToEvidence),
      },
      "portal export controls discovered",
    );

    return controls;
  }
}
