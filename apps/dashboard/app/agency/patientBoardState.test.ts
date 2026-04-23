import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardPatientRecord } from "@medical-ai-qa/shared-types";
import { getQaReadiness, getSourceCoverage } from "./patientBoardState";

function createRecord(overrides: Partial<DashboardPatientRecord> = {}): DashboardPatientRecord {
  return {
    queueEntry: {
      id: "queue-1",
      agencyId: "active-home-health",
      batchId: "batch-1",
      reviewWindowId: "review-window-1",
      workItemId: "patient-1",
      patientName: "Antonia Manzo",
      workflowTypes: ["SOC"],
      episodeDate: "2026-04-20",
      socDate: null,
      billingPeriod: null,
      status: "eligible",
      eligibility: {
        eligible: true,
        reason: null,
        rationale: "Eligible for autonomous QA evaluation.",
        matchedSignals: [],
      },
      sourceSheets: [],
      sourceRowNumbers: [],
      notes: [],
      createdAt: "2026-04-22T23:00:00.000Z",
    },
    runId: "batch-1",
    patientId: "patient-1",
    processingStatus: "BLOCKED",
    lastUpdatedAt: "2026-04-22T23:08:00.000Z",
    errorSummary: null,
    qaOutcome: "MISSING_DOCUMENTS",
    missingReferralDocumentation: false,
    missingReferralFieldCount: 0,
    ...overrides,
  };
}

test("marks missing referral documentation as oasis only", () => {
  const record = createRecord({
    missingReferralDocumentation: true,
  });

  assert.equal(getQaReadiness(record).label, "Referral Needed");
  assert.equal(getSourceCoverage(record).label, "OASIS only");
});

test("shows limited docs when referral capture exists but the packet is incomplete", () => {
  const record = createRecord();

  assert.equal(getQaReadiness(record).label, "Missing Supporting Docs");
  assert.equal(getSourceCoverage(record).label, "OASIS + limited docs");
});

test("shows oasis plus referral only when the patient detail is fully captured", () => {
  const record = createRecord({
    qaOutcome: "READY_FOR_BILLING_PREP",
    processingStatus: "COMPLETE",
  });

  assert.equal(getQaReadiness(record).label, "Ready for QA");
  assert.equal(getSourceCoverage(record).label, "OASIS + Referral");
});
