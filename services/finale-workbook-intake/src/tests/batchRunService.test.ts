import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type {
  ArtifactRecord,
  AutomationStepLog,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
  PatientMatchResult,
} from "@medical-ai-qa/shared-types";
import { runBatchQA, runFinaleBatch, runQAForPatient } from "../services/batchRunService";
import type { OasisExecutionActionPerformed } from "../services/oasisDiagnosisExecutionService";
import type { OasisInputActionPlan } from "../services/oasisInputActionPlanService";
import { intakeWorkbook } from "../services/workbookIntakeService";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";
import type { OasisDiagnosisPageSnapshot } from "../portal/utils/oasisDiagnosisInspector";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";

class FakePortalClient implements BatchPortalAutomationClient {
  async initialize(): Promise<void> {}

  async resolvePatient(workItem: PatientEpisodeWorkItem): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
    return {
      matchResult: {
        status: "EXACT",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: "PT-1",
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs: [],
    };
  }

  async discoverArtifacts(_workItem: PatientEpisodeWorkItem, evidenceDir: string): Promise<{
    artifacts: ArtifactRecord[];
    documentInventory: DocumentInventoryItem[];
    stepLogs: AutomationStepLog[];
  }> {
    mkdirSync(evidenceDir, { recursive: true });
    const oasisPath = path.join(evidenceDir, "oasis.txt");
    const pocPath = path.join(evidenceDir, "poc.txt");
    const visitNotePath = path.join(evidenceDir, "visit-note.txt");

    writeFileSync(
      oasisPath,
      "Medical necessity established. Patient is homebound. Comprehensive assessment completed. Skilled interventions performed by skilled nursing.",
      "utf8",
    );
    writeFileSync(
      pocPath,
      "Diagnosis list updated. Goals and interventions reviewed. Plan of care includes exacerbation monitoring.",
      "utf8",
    );
    writeFileSync(
      visitNotePath,
      "Skilled nursing visit performed. Skilled need requires skilled nursing for wound care. Interventions performed: wound care and teaching provided. Patient response tolerated well. Progress toward goals noted. Changes in condition addressed with improvement documented. Vitals: blood pressure and heart rate documented. Medications reviewed with no changes. Documentation supports billed services and remains consistent with OASIS diagnoses and plan of care.",
      "utf8",
    );

    return {
      artifacts: [
      {
        artifactType: "OASIS",
        status: "FOUND",
        portalLabel: "OASIS",
        locatorUsed: "text=OASIS",
        discoveredAt: new Date().toISOString(),
        downloadPath: oasisPath,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "PLAN_OF_CARE",
        status: "FOUND",
        portalLabel: "POC",
        locatorUsed: "text=POC",
        discoveredAt: new Date().toISOString(),
        downloadPath: pocPath,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "VISIT_NOTES",
        status: "FOUND",
        portalLabel: "Visit Notes",
        locatorUsed: "text=Visit Notes",
        discoveredAt: new Date().toISOString(),
        downloadPath: visitNotePath,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "PHYSICIAN_ORDERS",
        status: "FOUND",
        portalLabel: "Orders",
        locatorUsed: "text=Orders",
        discoveredAt: new Date().toISOString(),
        downloadPath: pocPath,
        extractedFields: {},
        notes: [],
      },
      {
        artifactType: "COMMUNICATION_NOTES",
        status: "FOUND",
        portalLabel: "Communication Notes",
        locatorUsed: "text=Communication Notes",
        discoveredAt: new Date().toISOString(),
        downloadPath: visitNotePath,
        extractedFields: {},
        notes: [],
      },
      ],
      documentInventory: [
        {
          sourceLabel: "OASIS",
          normalizedType: "OASIS",
          discipline: "SN",
          confidence: 0.98,
          evidence: ["Fixture OASIS document."],
          sourceUrl: null,
          sourcePath: oasisPath,
          discoveredAt: new Date().toISOString(),
          openBehavior: "DOWNLOAD",
        },
      ],
      stepLogs: [],
    };
  }

  async executeOasisDiagnosisActionPlan(
    _workItem: PatientEpisodeWorkItem,
    _evidenceDir: string,
    _options: {
      actionPlan: OasisInputActionPlan;
      lockState: OasisLockStateSnapshot | null;
      writeEnabled: boolean;
      initialSnapshot?: OasisDiagnosisPageSnapshot | null;
    },
  ): Promise<{
    diagnosisPageSnapshot: OasisDiagnosisPageSnapshot | null;
    actionsPerformed: OasisExecutionActionPerformed[];
    insertClicksPerformed: number;
    fieldsUpdatedCount: number;
    executed: boolean;
    warnings: string[];
    stepLogs: AutomationStepLog[];
  }> {
    return {
      diagnosisPageSnapshot: null,
      actionsPerformed: [],
      insertClicksPerformed: 0,
      fieldsUpdatedCount: 0,
      executed: false,
      warnings: ["test_stub_execution_not_run"],
      stepLogs: [],
    };
  }

  async captureFailureArtifacts() {
    return {
      tracePath: null,
      screenshotPaths: [],
      downloadPaths: [],
    };
  }

  async dispose(): Promise<void> {}
}

class MixedPortalClient extends FakePortalClient {
  private resolveCount = 0;

  override async resolvePatient(workItem: PatientEpisodeWorkItem): Promise<{
    matchResult: PatientMatchResult;
    stepLogs: AutomationStepLog[];
  }> {
    this.resolveCount += 1;

    if (this.resolveCount === 1) {
      return {
        matchResult: {
          status: "NOT_FOUND",
          searchQuery: workItem.patientIdentity.displayName,
          portalPatientId: null,
          portalDisplayName: null,
          candidateNames: [],
          note: "Patient search completed, but the patient is not currently available in portal results.",
        },
        stepLogs: [],
      };
    }

    return {
      matchResult: {
        status: "EXACT",
        searchQuery: workItem.patientIdentity.displayName,
        portalPatientId: `PT-${this.resolveCount}`,
        portalDisplayName: workItem.patientIdentity.displayName,
        candidateNames: [workItem.patientIdentity.displayName],
        note: null,
      },
      stepLogs: [],
    };
  }
}

function writeWorkbookFixture(): { workbookPath: string; outputDir: string; cleanup: () => void } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "finale-batch-"));
  const workbookPath = path.join(tempDir, "fixture.xlsx");
  const outputDir = path.join(tempDir, "output");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["PATIENT NAME", "EPISODE DATE", "ASSIGNED STAFF", "PAYER", "RFA", "30 Days Tracking", "CODING", "OASIS QA REMARKS", "POC QA REMARKS"],
      ["DOE, JANE", "03/01/2026", "Alice", "Medicare", "SOC", "5", "QA done", "Locked", "Exported"],
    ]),
    "OASIS SOC-ROC-REC & POC",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Title"],
      ["PATIENT NAME", "Medicare No.", "PAYER", "SOC Date", "episode period", "billing period", "status", "OASIS QA", "OASIS STATUS", "QA", "SN", "PT/OT/ST", "HHA/MSW", "BILLING STATUS"],
      ["Jane Doe", "12345", "Medicare", "03/01/2026", "03/01/2026 - 04/29/2026", "03/01/2026 - 03/31/2026", "Done and Reviewed", "Locked", "Locked", "Done and Reviewed", "Done and Reviewed", "", "", "Done and Reviewed"],
    ]),
    "VISIT NOTES",
  );

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DIZ"]]), "DIZ");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DC"]]), "OASIS DC-TXR-DEATH");
  XLSX.writeFile(workbook, workbookPath);

  return {
    workbookPath,
    outputDir,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe("runFinaleBatch", () => {
  it("processes every automation-eligible work item and writes patient result bundles", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const result = await runFinaleBatch({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
        portalClient: new FakePortalClient(),
      });

      expect(result.manifest.totalWorkItems).toBe(1);
      expect(result.patientRuns).toHaveLength(1);
      expect(result.patientRuns[0]?.processingStatus).toBe("COMPLETE");
      expect(result.patientRuns[0]?.qaOutcome).toBe("READY_FOR_BILLING_PREP");
      expect(result.patientRuns[0]?.oasisQaSummary.overallStatus).toBe("READY_FOR_BILLING");
      expect(result.patientRuns[0]?.documentInventory.length).toBeGreaterThan(0);
      expect(result.patientRuns[0]?.automationStepLogs.length).toBeGreaterThan(0);
      expect(result.batchSummary.complete).toBe(1);
      expect(result.batchSummary.qaOutcomes.READY_FOR_BILLING_PREP).toBe(1);
      expect(result.patientRuns[0]?.resultBundlePath).toMatch(/patient-results/);
      expect(result.patientRuns[0]?.logPath).toMatch(/logs/);
      expect(result.patientRuns[0]?.logAvailable).toBe(true);
    } finally {
      fixture.cleanup();
    }
  }, 20_000);

  it("exposes runQAForPatient and writes a structured patient log", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const patientRun = await runQAForPatient({
        batchId: intake.manifest.batchId,
        patient: intake.workItems[0]!,
        outputDir: fixture.outputDir,
        portalClient: new FakePortalClient(),
      });

      expect(patientRun.processingStatus).toBe("COMPLETE");
      expect(patientRun.logAvailable).toBe(true);
      expect(patientRun.oasisQaSummary.blockers).toHaveLength(0);
      expect(patientRun.documentInventory.length).toBeGreaterThan(0);
      expect(patientRun.logPath).toBeTruthy();
      expect(existsSync(patientRun.logPath!)).toBe(true);

      const logPayload = JSON.parse(readFileSync(patientRun.logPath!, "utf8")) as {
        workItemId: string;
        processingStatus: string;
      };

      expect(logPayload.workItemId).toBe(patientRun.workItemId);
      expect(logPayload.processingStatus).toBe("COMPLETE");
    } finally {
      fixture.cleanup();
    }
  });

  it("runs batch QA directly from normalized patients", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });

      const result = await runBatchQA({
        batchId: `${intake.manifest.batchId}-rerun`,
        patients: intake.workItems,
        parserExceptions: intake.parserExceptions,
        workbookPath: fixture.workbookPath,
        outputDir: path.join(fixture.outputDir, "rerun"),
        portalClient: new FakePortalClient(),
      });

      expect(result.manifest.totalWorkItems).toBe(1);
      expect(result.patientRuns).toHaveLength(1);
      expect(result.batchSummary.totalReadyForBillingPrep).toBe(1);
      expect(result.patientRuns[0]?.oasisQaSummary.overallStatus).toBe("READY_FOR_BILLING");
      expect(existsSync(result.workItemsPath)).toBe(true);
      expect(existsSync(result.batchSummaryPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("marks patients not currently in portal without failing the batch and emits canonical logs", async () => {
    const fixture = writeWorkbookFixture();

    try {
      const intake = await intakeWorkbook({
        workbookPath: fixture.workbookPath,
        outputDir: fixture.outputDir,
      });
      const firstPatient = intake.workItems[0]!;
      const secondPatient: PatientEpisodeWorkItem = {
        ...firstPatient,
        id: "patient-2",
        patientIdentity: {
          ...firstPatient.patientIdentity,
          displayName: "Jane Roe",
          normalizedName: "JANE ROE",
        },
      };

      const result = await runBatchQA({
        batchId: `${intake.manifest.batchId}-mixed`,
        patients: [firstPatient, secondPatient],
        parserExceptions: intake.parserExceptions,
        workbookPath: fixture.workbookPath,
        outputDir: path.join(fixture.outputDir, "mixed"),
        portalClient: new MixedPortalClient(),
      });

      expect(result.patientRuns).toHaveLength(2);
      expect(result.patientRuns[0]?.matchResult.status).toBe("NOT_FOUND");
      expect(result.patientRuns[0]?.qaOutcome).toBe("PORTAL_NOT_FOUND");
      expect(result.patientRuns[0]?.processingStatus).toBe("BLOCKED");
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "login")).toBe(true);
      expect(result.patientRuns[0]?.automationStepLogs.some((log) => log.step === "patient_search")).toBe(true);
      expect(result.patientRuns[1]?.processingStatus).toBe("COMPLETE");
      expect(result.patientRuns[1]?.qaOutcome).toBe("READY_FOR_BILLING_PREP");
      expect(result.batchSummary.qaOutcomes.PORTAL_NOT_FOUND).toBe(1);
      expect(result.batchSummary.qaOutcomes.READY_FOR_BILLING_PREP).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });
});
