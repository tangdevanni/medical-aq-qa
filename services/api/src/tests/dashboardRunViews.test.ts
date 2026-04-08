import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchRecord } from "../types/batchControlPlane";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { toDashboardPatientDetail, toDashboardPatientSummary } from "../mappers/dashboardRunViews";

const batch: BatchRecord = {
  id: "batch-1",
  subsidiary: {
    id: "default",
    slug: "default",
    name: "Default Subsidiary",
  },
  createdAt: "2026-04-06T20:00:00.000Z",
  updatedAt: "2026-04-06T20:05:00.000Z",
  runMode: "read_only",
  billingPeriod: "2026-04",
  status: "COMPLETED",
  schedule: {
    scheduledRunId: "schedule-batch-1",
    active: true,
    rerunEnabled: true,
    intervalHours: 24,
    lastRunAt: "2026-04-06T20:05:00.000Z",
    nextScheduledRunAt: "2026-04-07T20:05:00.000Z",
  },
  sourceWorkbook: {
    subsidiaryId: "default",
    acquisitionProvider: "MANUAL_UPLOAD",
    acquisitionStatus: "ACQUIRED",
    acquisitionReference: null,
    acquisitionNotes: [],
    originalFileName: "reference.xlsx",
    storedPath: "C:\\temp\\reference.xlsx",
    uploadedAt: "2026-04-06T20:00:00.000Z",
  },
  storage: {
    batchRoot: "C:\\temp\\batch-1",
    outputRoot: "C:\\temp\\batch-1\\outputs",
    manifestPath: null,
    workItemsPath: null,
    parserExceptionsPath: null,
    batchSummaryPath: null,
    patientResultsDirectory: "C:\\temp\\batch-1\\outputs\\patient-results",
    evidenceDirectory: "C:\\temp\\batch-1\\outputs\\evidence",
  },
  parse: {
    requestedAt: null,
    completedAt: null,
    workItemCount: 1,
    eligibleWorkItemCount: 1,
    parserExceptionCount: 0,
    sourceDetections: [],
    sheetSummaries: [],
    lastError: null,
  },
  run: {
    requestedAt: "2026-04-06T20:00:00.000Z",
    completedAt: "2026-04-06T20:05:00.000Z",
    patientRunCount: 1,
    lastError: null,
  },
  patientRuns: [{
    runId: "batch-1-patient-1",
    subsidiaryId: "default",
    workItemId: "patient-1",
    patientName: "Christine Young",
    processingStatus: "COMPLETE",
    executionStep: "COMPLETE",
    progressPercent: 100,
    startedAt: "2026-04-06T20:00:00.000Z",
    completedAt: "2026-04-06T20:05:00.000Z",
    lastUpdatedAt: "2026-04-06T20:05:00.000Z",
    matchResult: {
      status: "EXACT",
      searchQuery: "Christine Young",
      portalPatientId: "PT-1",
      portalDisplayName: "Christine Young",
      candidateNames: ["Christine Young"],
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
    logPath: null,
    logAvailable: false,
    retryEligible: false,
    errorSummary: null,
    resultBundlePath: "C:\\temp\\batch-1\\outputs\\patient-results\\patient-1.json",
    evidenceDirectory: "C:\\temp\\batch-1\\outputs\\evidence\\patient-1",
    tracePath: null,
    screenshotPaths: [],
    downloadPaths: [],
    lastAttemptAt: "2026-04-06T20:05:00.000Z",
    attemptCount: 1,
  }],
};

const workItem: PatientEpisodeWorkItem = {
  id: "patient-1",
  subsidiaryId: "default",
  patientIdentity: {
    displayName: "Christine Young",
    normalizedName: "CHRISTINE YOUNG",
  },
  episodeContext: {
    episodeDate: "2026-04-01",
    socDate: "2026-04-01",
    episodePeriod: "2026-04-01 - 2026-04-30",
    billingPeriod: "2026-04",
    payer: "Medicare",
    assignedStaff: null,
    clinician: null,
    qaSpecialist: null,
    rfa: "SOC",
  },
  workflowTypes: ["SOC"],
  sourceSheets: ["OASIS SOC-ROC-REC & POC"],
  timingMetadata: {
    trackingDays: 3,
    daysInPeriod: 30,
    daysLeft: 3,
    daysLeftBeforeOasisDueDate: 3,
    rawTrackingValues: ["3"],
    rawDaysInPeriodValues: ["30"],
    rawDaysLeftValues: ["3"],
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

const patientViewInput = {
  batch,
  summary: batch.patientRuns[0]!,
  workItem,
  artifactContents: {
    codingInput: {
      primaryDiagnosis: {
        code: "J18.9",
        description: "PNEUMONIA, UNSPECIFIED ORGANISM",
        confidence: "high",
      },
      otherDiagnoses: [
        {
          code: "J96.01",
          description: "ACUTE RESPIRATORY FAILURE WITH HYPOXIA",
          confidence: "high",
        },
      ],
    },
    documentText: null,
  },
};

describe("dashboardRunViews", () => {
  it("omits lock and write-era fields from dashboard patient summary", () => {
    const summary = toDashboardPatientSummary(patientViewInput);

    assert.equal("lockState" in summary, false);
    assert.equal("lockStateSimple" in summary, false);
    assert.equal("verificationOnly" in summary, false);
    assert.equal("inputEligible" in summary, false);
    assert.equal("comparisonSummary" in summary, false);
    assert.equal("executionSummary" in summary, false);
    assert.deepEqual(summary.primaryDiagnosis, {
      code: "J18.9",
      description: "PNEUMONIA, UNSPECIFIED ORGANISM",
      confidence: "high",
    });
    assert.equal(summary.subsidiaryId, "default");
    assert.equal(summary.subsidiaryName, "Default Subsidiary");
    assert.equal(summary.otherDiagnoses.length, 1);
  });

  it("returns patient detail as diagnosis reference data plus minimal workbook context", () => {
    const detail = toDashboardPatientDetail(patientViewInput);

    assert.equal("artifactPaths" in detail, false);
    assert.equal("artifactContents" in detail, false);
    assert.equal("automationStepLogs" in detail, false);
    assert.equal("workItemSnapshot" in detail, false);
    assert.deepEqual(detail.workbookContext, {
      billingPeriod: "2026-04",
      workflowTypes: ["SOC"],
      rawDaysLeftValues: ["3"],
    });
  });
});
