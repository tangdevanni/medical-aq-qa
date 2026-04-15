import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import type { SubsidiaryRuntimeConfig } from "@medical-ai-qa/shared-types";
import { FinaleWorkbookProvider } from "../acquisition/finaleWorkbookProvider";

describe("FinaleWorkbookProvider", () => {
  it("passes agency runtime context into the Finale workbook export flow", async () => {
    const runtimeConfig: SubsidiaryRuntimeConfig = {
      subsidiaryId: "default",
      subsidiarySlug: "star-home-health-care-inc",
      subsidiaryName: "Star Home Health Care Inc",
      portalAgencyName: "Star Home Health",
      portalAgencyAliases: ["Star Home Health Care Inc"],
      portalBaseUrl: "https://app.finalehealth.com",
      portalDashboardUrl: "https://app.finalehealth.com/provider/star-home-health-care-inc/dashboard",
      credentials: {
        username: "qa-user",
        password: "qa-pass",
      },
      rerunEnabled: true,
      rerunIntervalHours: 24,
      timezone: "Asia/Manila",
      credentialSource: "local_env_fallback",
      portalCredentialsSecretArn: null,
    };

    let capturedDestinationPath = "";
    let capturedSubsidiaryName = "";
    const provider = new FinaleWorkbookProvider(
      {
        resolveRuntimeConfig: async () => runtimeConfig,
      } as any,
      pino({ enabled: false }),
      async (input) => {
        capturedDestinationPath = input.destinationPath;
        capturedSubsidiaryName = input.runtimeConfig.subsidiaryName;
        return {
          originalFileName: "star-home-health-care-inc-oasis-30-days.xlsx",
          storedPath: input.destinationPath,
          acquiredAt: "2026-04-14T00:00:00.000Z",
          acquisitionReference: "C:/tmp/finale-workbook-export.json",
          notes: ["Workbook acquired from Finale dashboard OASIS 30 Day's export."],
          acquisitionMetadata: {
            providerId: "FINALE",
            acquisitionReference: "C:/tmp/finale-workbook-export.json",
            metadataPath: "C:/tmp/finale-workbook-export.json",
            selectedAgencyName: "Star Home Health",
            selectedAgencyUrl: "https://app.finalehealth.com/users/user-agencies",
            dashboardUrl: "https://app.finalehealth.com/provider/star-home-health-care-inc/dashboard",
            notes: ["Workbook acquired from Finale dashboard OASIS 30 Day's export."],
          },
          verification: {
            usable: true,
            verifiedAt: "2026-04-14T00:00:01.000Z",
            fileSizeBytes: 4096,
            fileExtension: ".xlsx",
            sheetNames: ["OASIS Tracking Report"],
            detectedSourceTypes: ["trackingReport"],
            warningCount: 0,
          },
          selectedAgencyName: input.runtimeConfig.subsidiaryName,
          selectedAgencyUrl: "https://app.finalehealth.com/provider/star-home-health-care-inc/dashboard",
          dashboardUrl: "https://app.finalehealth.com/provider/star-home-health-care-inc/dashboard",
          metadataPath: "C:/tmp/finale-workbook-export.json",
          stepLogs: [],
        };
      },
    );

    const result = await provider.acquire(
      {
        exportName: "star-home-health-care-inc-oasis-30-days.xlsx",
      },
      {
        batchId: "batch-1",
        subsidiaryId: "default",
        subsidiarySlug: "star-home-health-care-inc",
        subsidiaryName: "Star Home Health Care Inc",
        billingPeriod: "2026-04",
        destinationPath: "C:/tmp/workbook.xlsx",
        batchRoot: "C:/tmp/batch-1",
        outputRoot: "C:/tmp/batch-1/outputs",
        logger: pino({ enabled: false }),
      },
    );

    assert.equal(capturedDestinationPath, "C:/tmp/workbook.xlsx");
    assert.equal(capturedSubsidiaryName, "Star Home Health Care Inc");
    assert.equal(result.originalFileName, "star-home-health-care-inc-oasis-30-days.xlsx");
    assert.equal(result.acquisitionReference, "C:/tmp/finale-workbook-export.json");
    assert.equal(result.acquisitionMetadata?.selectedAgencyName, "Star Home Health");
    assert.equal(result.verification?.fileSizeBytes, 4096);
  });
});
