import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PatientRun } from "@medical-ai-qa/shared-types";
import { writePatientDashboardState } from "../services/patientDashboardStateWriter";

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function buildRun(outputDirectory: string): PatientRun {
  return {
    runId: "run-1",
    batchId: "batch-1",
    subsidiaryId: "default",
    workItemId: "patient-1",
    patientName: "Christine Young",
    processingStatus: "COMPLETE",
    executionStep: "COMPLETE",
    progressPercent: 100,
    startedAt: "2026-05-05T00:00:00.000Z",
    completedAt: "2026-05-05T00:01:00.000Z",
    lastUpdatedAt: "2026-05-05T00:01:00.000Z",
    matchResult: {
      status: "EXACT",
      searchQuery: "Christine Young",
      portalPatientId: "PT-1",
      portalDisplayName: "Christine Young",
      candidateNames: [],
      note: null,
    },
    qaOutcome: "READY_FOR_BILLING_PREP",
    oasisQaSummary: {
      overallStatus: "READY_FOR_BILLING",
      urgency: "ON_TRACK",
      daysInPeriod: 30,
      daysLeft: 3,
      sections: [],
      blockers: [],
    },
    artifactCount: 1,
    hasFindings: false,
    bundleAvailable: true,
    resultBundlePath: path.join(outputDirectory, "patients", "patient-1", "result.json"),
    logPath: null,
    logAvailable: false,
    retryEligible: false,
    errorSummary: null,
    artifacts: [],
    findings: [],
    documentInventory: [],
    auditArtifacts: { tracePath: null, screenshotPaths: [], downloadPaths: [] },
    workflowRuns: [],
    attemptCount: 1,
    automationStepLogs: [],
    notes: [],
    workItemSnapshot: {
      id: "patient-1",
      subsidiaryId: "default",
      patientIdentity: {
        displayName: "Christine Young",
        normalizedName: "CHRISTINE YOUNG",
      },
      episodeContext: {
        socDate: null,
        episodeDate: null,
        billingPeriod: "2026-05",
        episodePeriod: null,
        payer: null,
        assignedStaff: null,
        clinician: null,
        qaSpecialist: null,
        rfa: null,
      },
      codingReviewStatus: "NOT_STARTED",
      oasisQaStatus: "NOT_STARTED",
      pocQaStatus: "NOT_STARTED",
      visitNotesQaStatus: "NOT_STARTED",
      billingPrepStatus: "NOT_STARTED",
      workflowTypes: ["SOC"],
      sourceSheets: [],
      sourceRemarks: [],
      sourceRowReferences: [],
      sourceValues: [],
      importWarnings: [],
    },
  } as PatientRun;
}

describe("writePatientDashboardState Visit Notes runtime wiring", () => {
  it("writes Visit Notes review and embeds per-note POC mapping in dashboard state", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "visit-notes-dashboard-state-"));
    const patientDirectory = path.join(outputDirectory, "patients", "patient-1");
    const activeVisitNoteKey = "active-pt-note";
    const finalizedVisitNoteKey = "qa-complete-note";

    await writeJson(path.join(patientDirectory, "visit-notes-discovery.json"), {
      schemaVersion: "visit-notes-discovery.v1",
      generatedAt: "2026-05-07T00:00:00.000Z",
      patientKeyHash: "patient-1",
      episode: {},
      rows: [
        {
          visitNoteKey: activeVisitNoteKey,
          portalDocumentId: "active-pt-note",
          rawDocumentType: "Visit Note-PT",
          normalizedVisitType: "physical_therapy",
          normalizedVisitTypeConfidence: 0.95,
          normalizationReason: "test",
          visitDate: "2026-05-07",
          statusRaw: "In Progress",
          normalizedStatus: "in_progress",
          rowTextHash: "row-active",
          hasSafeOpenAction: true,
          actionHints: ["Visit Note-PT - Visit"],
          lifecycleStatus: "active_monitoring",
          captureEligibility: "active_monitoring",
          captureStatus: "captured",
        },
        {
          visitNoteKey: finalizedVisitNoteKey,
          portalDocumentId: "qa-complete-note",
          rawDocumentType: "Visit Note-PT",
          normalizedVisitType: "physical_therapy",
          normalizedVisitTypeConfidence: 0.95,
          normalizationReason: "test",
          visitDate: "2026-05-06",
          statusRaw: "QA Completed",
          normalizedStatus: "qa_completed",
          rowTextHash: "row-finalized",
          hasSafeOpenAction: true,
          actionHints: ["Visit Note-PT - Visit"],
          lifecycleStatus: "finalized_no_active_monitoring",
          captureEligibility: "finalized_no_active_monitoring",
          captureStatus: "skipped",
          skipReason: "qa_complete_finalized_no_active_monitoring",
        },
      ],
      counts: {
        total: 2,
        byVisitType: { physical_therapy: 2, home_health_aide: 0, skilled_nursing: 0, occupational_therapy: 0, speech_therapy: 0, social_work: 0, other_clinical: 0, non_clinical: 0, unknown: 0 },
        byStatus: { in_progress: 1, qa_completed: 1 },
        byVisitTypeAndStatus: { physical_therapy: { in_progress: 1, qa_completed: 1 }, home_health_aide: {}, skilled_nursing: {}, occupational_therapy: {}, speech_therapy: {}, social_work: {}, other_clinical: {}, non_clinical: {}, unknown: {} },
        signedOrESigned: 0,
        eligibleForCapture: 1,
        activeMonitoring: 1,
        finalizedNoActiveMonitoring: 1,
      },
      warnings: [],
    });
    await mkdir(path.join(patientDirectory, "documents", "visit-notes", activeVisitNoteKey), { recursive: true });
    await writeFile(
      path.join(patientDirectory, "documents", "visit-notes", activeVisitNoteKey, "extracted-text.txt"),
      "Skilled PT provided gait training and transfer training. Patient tolerated well and made goal progress.",
      "utf8",
    );
    await writeJson(path.join(patientDirectory, "documents", "visit-notes", activeVisitNoteKey, "extraction-result.json"), {
      extractionQualityStatus: "usable",
    });

    const { state } = await writePatientDashboardState({
      outputDirectory,
      run: buildRun(outputDirectory),
    });

    const visitNoteReview = state.artifactContents.visitNoteQaReview as {
      summary: {
        activeMonitoringCount: number;
        qaCompleteFinalizedCount: number;
      };
      noteSummaries: Array<{
        visitNoteKey: string;
        lifecycleStatus?: string;
        pocMappingResult?: {
          mappingStatus?: string;
          mappingSource?: string;
        };
      }>;
    };

    expect(visitNoteReview.summary.activeMonitoringCount).toBe(1);
    expect(visitNoteReview.summary.qaCompleteFinalizedCount).toBe(1);
    const activeSummary = visitNoteReview.noteSummaries.find((note) => note.visitNoteKey === activeVisitNoteKey);
    const finalizedSummary = visitNoteReview.noteSummaries.find((note) => note.visitNoteKey === finalizedVisitNoteKey);
    expect(activeSummary?.pocMappingResult?.mappingStatus).toBe("deterministic_only");
    expect(activeSummary?.pocMappingResult?.mappingSource).toBe("deterministic");
    expect(finalizedSummary?.lifecycleStatus).toBe("finalized_no_active_monitoring");
    expect(finalizedSummary?.pocMappingResult?.mappingStatus).toBe("skipped");

    const persistedReview = JSON.parse(
      await readFile(path.join(patientDirectory, "visit-note-qa-review.json"), "utf8"),
    ) as typeof visitNoteReview;
    expect(persistedReview.noteSummaries[0]?.pocMappingResult).toBeTruthy();
  });
});
