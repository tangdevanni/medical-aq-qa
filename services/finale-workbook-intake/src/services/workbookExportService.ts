import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino, { type Logger } from "pino";
import type {
  AutomationStepLog,
  SubsidiaryRuntimeConfig,
  WorkbookAcquisitionMetadata,
  WorkbookVerification,
} from "@medical-ai-qa/shared-types";
import { createPortalSession } from "../browser/context";
import { loadEnv, type FinaleBatchEnv } from "../config/env";
import { LoginPage } from "../portal/pages/LoginPage";
import { FinaleDashboardPage } from "../portal/pages/FinaleDashboardPage";
import { OasisThirtyDaysPage } from "../portal/pages/OasisThirtyDaysPage";
import { UserAgenciesPage } from "../portal/pages/UserAgenciesPage";
import type { PortalDebugConfig } from "../portal/utils/locatorResolution";
import { capturePageDebugArtifacts } from "../portal/utils/pageDiagnostics";
import { verifyWorkbookFile } from "./workbookVerificationService";

export interface FinaleWorkbookExportParams {
  runtimeConfig: SubsidiaryRuntimeConfig;
  destinationPath: string;
  outputDir?: string | null;
  exportName?: string | null;
  env?: FinaleBatchEnv;
  logger?: Logger;
}

export interface FinaleWorkbookExportResult {
  originalFileName: string;
  storedPath: string;
  acquiredAt: string;
  acquisitionReference: string | null;
  notes: string[];
  selectedAgencyName: string;
  selectedAgencyUrl: string;
  dashboardUrl: string;
  metadataPath: string | null;
  acquisitionMetadata: WorkbookAcquisitionMetadata;
  verification: WorkbookVerification;
  stepLogs: AutomationStepLog[];
}

interface ExportMetadataRecord {
  capturedAt: string;
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  selectedAgencyName: string;
  selectedAgencyUrl: string;
  dashboardUrl: string;
  destinationPath: string;
  originalFileName: string;
  portalBaseUrl: string;
  portalDashboardUrl: string | null;
  verification: WorkbookVerification;
  stepLogs: AutomationStepLog[];
}

function createLogger(): Logger {
  const env = loadEnv();
  return pino({
    name: "finale-workbook-intake",
    level: env.FINALE_LOG_LEVEL,
  });
}

function buildPortalDebugConfig(env: FinaleBatchEnv): PortalDebugConfig {
  return {
    debugSelectors: env.PORTAL_DEBUG_SELECTORS ?? false,
    saveDebugHtml: env.PORTAL_SAVE_DEBUG_HTML ?? false,
    pauseOnFailure: env.PORTAL_PAUSE_ON_FAILURE ?? false,
    stepTimeoutMs: env.PORTAL_STEP_TIMEOUT_MS,
    debugScreenshots: env.PORTAL_DEBUG_SCREENSHOTS ?? true,
    selectorRetryCount: env.PORTAL_SELECTOR_RETRY_COUNT,
  };
}

function resolveMetadataPath(destinationPath: string): string {
  return path.join(path.dirname(destinationPath), "finale-workbook-export.json");
}

export async function exportAgencyWorkbookFromFinale(
  params: FinaleWorkbookExportParams,
): Promise<FinaleWorkbookExportResult> {
  const env = params.env ?? loadEnv();
  const logger = params.logger ?? createLogger();
  const debugConfig = buildPortalDebugConfig(env);
  const debugDir = params.outputDir
    ? path.join(params.outputDir, "debug", "workbook-export")
    : path.join(path.dirname(params.destinationPath), "debug");
  const metadataPath = resolveMetadataPath(params.destinationPath);
  const session = await createPortalSession(env);
  const stepLogs: AutomationStepLog[] = [];

  try {
    await mkdir(path.dirname(params.destinationPath), { recursive: true });

    const loginPage = new LoginPage(session.page, {
      logger,
      debugConfig,
      debugDir,
    });
    stepLogs.push(
      ...(await loginPage.ensureLoggedIn({
        baseUrl: params.runtimeConfig.portalBaseUrl,
        username: params.runtimeConfig.credentials.username,
        password: params.runtimeConfig.credentials.password,
      })),
    );
    logger.info(
      {
        subsidiaryId: params.runtimeConfig.subsidiaryId,
        subsidiaryName: params.runtimeConfig.subsidiaryName,
      },
      "portal login succeeded for workbook export",
    );

    const userAgenciesPage = new UserAgenciesPage(session.page, {
      logger,
      debugConfig,
      debugDir,
    });
    const agencySelection = await userAgenciesPage.selectAgency({
      baseUrl: params.runtimeConfig.portalBaseUrl,
      agencyNames: [
        params.runtimeConfig.portalAgencyName ?? params.runtimeConfig.subsidiaryName,
        ...params.runtimeConfig.portalAgencyAliases,
        params.runtimeConfig.subsidiaryName,
      ],
    });
    stepLogs.push(...agencySelection.stepLogs);

    const dashboardPage = new FinaleDashboardPage(session.page, {
      logger,
      debugConfig,
      debugDir,
    });
    const dashboardHome = await dashboardPage.ensureDashboardHome({
      dashboardUrl: params.runtimeConfig.portalDashboardUrl ?? agencySelection.selectedAgencyUrl,
    });
    stepLogs.push(...dashboardHome.stepLogs);

    const oasisPanel = await dashboardPage.openOasisThirtyDaysPanel();
    stepLogs.push(...oasisPanel.stepLogs);

    const oasisThirtyDaysPage = new OasisThirtyDaysPage(session.page, {
      logger,
      debugConfig,
      debugDir,
    });
    const exportResult = await oasisThirtyDaysPage.exportWorkbook({
      destinationPath: params.destinationPath,
      fallbackFileName: params.exportName,
      downloadTimeoutMs: env.PORTAL_WORKBOOK_DOWNLOAD_TIMEOUT_MS,
    });
    stepLogs.push(...exportResult.stepLogs);

    const acquiredAt = new Date().toISOString();
    const verification = await verifyWorkbookFile({
      workbookPath: exportResult.storedPath,
      verifiedAt: acquiredAt,
      minimumFileSizeBytes: env.PORTAL_WORKBOOK_MIN_BYTES,
    });
    const acquisitionMetadata: WorkbookAcquisitionMetadata = {
      providerId: "FINALE",
      acquisitionReference: metadataPath,
      metadataPath,
      selectedAgencyName: agencySelection.selectedAgencyName,
      selectedAgencyUrl: agencySelection.selectedAgencyUrl,
      dashboardUrl: dashboardHome.dashboardUrl,
      notes: [
        "Workbook acquired from Finale dashboard OASIS 30 Day's export.",
        `Selected agency: ${agencySelection.selectedAgencyName}`,
        `Dashboard URL: ${dashboardHome.dashboardUrl}`,
        `Workbook verification detected sheets: ${verification.detectedSourceTypes.join(", ")}`,
      ],
    };
    const metadata: ExportMetadataRecord = {
      capturedAt: acquiredAt,
      agencyId: params.runtimeConfig.subsidiaryId,
      agencySlug: params.runtimeConfig.subsidiarySlug,
      agencyName: params.runtimeConfig.subsidiaryName,
      selectedAgencyName: agencySelection.selectedAgencyName,
      selectedAgencyUrl: agencySelection.selectedAgencyUrl,
      dashboardUrl: dashboardHome.dashboardUrl,
      destinationPath: exportResult.storedPath,
      originalFileName: exportResult.originalFileName,
      portalBaseUrl: params.runtimeConfig.portalBaseUrl,
      portalDashboardUrl: params.runtimeConfig.portalDashboardUrl,
      verification,
      stepLogs,
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    if (env.PORTAL_AUTH_STATE_PATH) {
      await mkdir(path.dirname(path.resolve(env.PORTAL_AUTH_STATE_PATH)), { recursive: true });
      await session.context.storageState({ path: path.resolve(env.PORTAL_AUTH_STATE_PATH) });
    }

    logger.info(
      {
        subsidiaryId: params.runtimeConfig.subsidiaryId,
        selectedAgency: agencySelection.selectedAgencyName,
        workbookPath: exportResult.storedPath,
        workbookFileName: exportResult.originalFileName,
        workbookSizeBytes: verification.fileSizeBytes,
        detectedSourceTypes: verification.detectedSourceTypes,
        metadataPath,
      },
      "persisted Finale OASIS 30 Day's workbook export",
    );

    return {
      originalFileName: exportResult.originalFileName,
      storedPath: exportResult.storedPath,
      acquiredAt,
      acquisitionReference: metadataPath,
      notes: [...acquisitionMetadata.notes, `Metadata path: ${metadataPath}`],
      selectedAgencyName: agencySelection.selectedAgencyName,
      selectedAgencyUrl: agencySelection.selectedAgencyUrl,
      dashboardUrl: dashboardHome.dashboardUrl,
      metadataPath,
      acquisitionMetadata,
      verification,
      stepLogs,
    };
  } catch (error) {
    logger.error(
      {
        subsidiaryId: params.runtimeConfig.subsidiaryId,
        destinationPath: params.destinationPath,
        errorMessage: error instanceof Error ? error.message : "Unknown workbook export error.",
      },
      "Finale workbook export failed",
    );
    await capturePageDebugArtifacts({
      page: session.page,
      outputDir: debugDir,
      step: "finale-workbook-export",
      reason: "workflow-failed",
      debugConfig,
      textHints: [
        params.runtimeConfig.subsidiaryName,
        "OASIS 30 Day's",
        "Export to Excel",
      ],
    }).catch(() => undefined);
    throw error;
  } finally {
    await session.browser.close().catch(() => undefined);
  }
}
