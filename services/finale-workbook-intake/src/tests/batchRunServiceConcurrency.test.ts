import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
  PatientMatchResult,
} from "@medical-ai-qa/shared-types";
import type { ResolvedPatientPortalAccess } from "../portal/context/patientPortalContext";

const workerEvents: string[] = [];
let nextWorkerId = 0;

function createWorkItem(id: string, displayName: string): PatientEpisodeWorkItem {
  return {
    id,
    subsidiaryId: "test-agency",
    patientIdentity: {
      displayName,
      normalizedName: displayName.toUpperCase(),
      medicareNumber: null,
    },
    episodeContext: {
      episodeDate: "03/01/2026",
      socDate: "03/01/2026",
      episodePeriod: "03/01/2026 - 04/29/2026",
      billingPeriod: "03/01/2026 - 03/31/2026",
      payer: "Medicare",
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS SOC-ROC-REC & POC"],
    timingMetadata: {
      trackingDays: 5,
      daysInPeriod: 60,
      daysLeft: 10,
      daysLeftBeforeOasisDueDate: 10,
      rawTrackingValues: ["5"],
      rawDaysInPeriodValues: ["60"],
      rawDaysLeftValues: ["10"],
    },
    codingReviewStatus: "DONE",
    oasisQaStatus: "DONE",
    pocQaStatus: "DONE",
    visitNotesQaStatus: "DONE",
    billingPrepStatus: "DONE",
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
  };
}

class MockPlaywrightBatchQaWorker {
  private readonly workerId = ++nextWorkerId;

  async initialize(): Promise<void> {
    workerEvents.push(`initialize:${this.workerId}`);
  }

  async dispose(): Promise<void> {
    workerEvents.push(`dispose:${this.workerId}`);
  }

  async resolvePatientPortalAccess(input: {
    batchId: string;
    patientRunId: string;
    workItem: PatientEpisodeWorkItem;
    evidenceDir?: string;
  }): Promise<ResolvedPatientPortalAccess> {
    workerEvents.push(`resolve:${this.workerId}:${input.workItem.id}`);
    const matchResult: PatientMatchResult = {
      status: "EXACT",
      searchQuery: input.workItem.patientIdentity.displayName,
      portalPatientId: `portal-${input.workItem.id}`,
      portalDisplayName: input.workItem.patientIdentity.displayName,
      candidateNames: [input.workItem.patientIdentity.displayName],
      note: null,
    };

    return {
      patientName: input.workItem.patientIdentity.displayName,
      patientId: `portal-${input.workItem.id}`,
      chartUrl: `https://demo.portal/client/${input.workItem.id}/intake`,
      dashboardUrl: "https://demo.portal/dashboard",
      resolvedAt: new Date().toISOString(),
      portalAdmissionStatus: null,
      traceId: `${input.batchId}:${input.patientRunId}`,
      matchResult,
      stepLogs: [],
    };
  }

  async discoverArtifacts(
    workItem: PatientEpisodeWorkItem,
    evidenceDir: string,
  ): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
  }> {
    workerEvents.push(`discover:${this.workerId}:${workItem.id}`);
    mkdirSync(evidenceDir, { recursive: true });
    return {
      artifacts: [],
      documentInventory: [],
      stepLogs: [],
    };
  }

  async captureFailureArtifacts(): Promise<{
    tracePath: string | null;
    screenshotPaths: string[];
    downloadPaths: string[];
  }> {
    return {
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
    };
  }
}

describe("executePatientWorkItems portal worker concurrency", () => {
  afterEach(() => {
    vi.doUnmock("../workers/playwrightBatchQaWorker");
    vi.resetModules();
    vi.unstubAllEnvs();
    workerEvents.length = 0;
    nextWorkerId = 0;
  });

  it("uses multiple isolated portal workers when configured and preserves result order", async () => {
    vi.stubEnv("FINALE_PATIENT_CONCURRENCY", "2");
    vi.doMock("../workers/playwrightBatchQaWorker", () => ({
      PlaywrightBatchQaWorker: MockPlaywrightBatchQaWorker,
    }));

    const { executePatientWorkItems } = await import("../services/batchRunService");
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-worker-pool-"));

    try {
      const workItems = [
        createWorkItem("patient-1", "Patient One"),
        createWorkItem("patient-2", "Patient Two"),
        createWorkItem("patient-3", "Patient Three"),
        createWorkItem("patient-4", "Patient Four"),
      ];

      const runs = await executePatientWorkItems({
        batchId: "batch-worker-pool",
        workItems,
        outputDir: tempDir,
        stopAfterSharedEvidence: true,
        subsidiaryRuntimeConfig: {
          subsidiaryId: "test-agency",
          subsidiarySlug: "test-agency",
          subsidiaryName: "Test Agency",
          lookupAliases: [],
          portalAgencyName: "Test Agency",
          portalAgencyAliases: [],
          portalBaseUrl: "https://demo.portal",
          portalDashboardUrl: "https://demo.portal/dashboard",
          credentials: {
            username: "test-user",
            password: "test-password",
          },
          rerunEnabled: true,
          rerunIntervalHours: 24,
          timezone: "America/Los_Angeles",
          credentialSource: "local_env_fallback",
          portalCredentialsSecretArn: null,
        },
      });

      expect(runs.map((run) => run.workItemId)).toEqual(workItems.map((workItem) => workItem.id));
      expect(workerEvents.filter((event) => event.startsWith("initialize:"))).toHaveLength(2);
      expect(workerEvents.filter((event) => event.startsWith("dispose:"))).toHaveLength(2);
      expect(new Set(
        workerEvents
          .filter((event) => event.startsWith("discover:"))
          .map((event) => event.split(":")[1]),
      )).toEqual(new Set(["1", "2"]));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
