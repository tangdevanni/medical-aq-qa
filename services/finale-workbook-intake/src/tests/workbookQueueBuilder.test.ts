import { describe, expect, it } from "vitest";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import { buildWorkbookQueue } from "../queue-building/buildWorkbookQueue";
import { createReviewWindow } from "../workbook-intake/reviewWindow";

function createWorkItem(input: {
  id: string;
  patientName: string;
  status?: string | null;
}): PatientEpisodeWorkItem {
  return {
    id: input.id,
    subsidiaryId: "default",
    patientIdentity: {
      displayName: input.patientName,
      normalizedName: input.patientName.toUpperCase(),
      medicareNumber: null,
    },
    episodeContext: {
      episodeDate: "2026-04-01",
      socDate: "2026-04-01",
      episodePeriod: null,
      billingPeriod: "2026-04-01 - 2026-04-15",
      payer: "Medicare",
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    timingMetadata: {
      trackingDays: 10,
      daysInPeriod: 15,
      daysLeft: 10,
      daysLeftBeforeOasisDueDate: 10,
      rawTrackingValues: ["10"],
      rawDaysInPeriodValues: ["15"],
      rawDaysLeftValues: ["10"],
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "NOT_STARTED",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    sourceRemarks: [],
    sourceRowReferences: [{
      workflowTypes: ["SOC"],
      sourceSheet: "OASIS Tracking Report",
      sourceRowNumber: 8,
    }],
    sourceValues: [{
      sourceSheet: "OASIS Tracking Report",
      sourceRowNumber: 8,
      values: {
        patientName: input.patientName,
        status: input.status ?? null,
      },
    }],
    importWarnings: [],
  };
}

describe("buildWorkbookQueue", () => {
  it("summarizes eligible and skipped patients", () => {
    const reviewWindow = createReviewWindow({
      agencyId: "default",
      startsAt: "2026-04-01T00:00:00.000Z",
      timezone: "Asia/Manila",
    });

    const queue = buildWorkbookQueue({
      batchId: "batch-1",
      agencyId: "default",
      generatedAt: "2026-04-01T00:00:00.000Z",
      reviewWindow,
      workItems: [
        createWorkItem({ id: "eligible-1", patientName: "Eligible Patient" }),
        createWorkItem({ id: "pending-1", patientName: "Pending Patient", status: "Pending" }),
        createWorkItem({ id: "non-admit-1", patientName: "Non Admit Patient", status: "Non-Admit" }),
      ],
    });

    expect(queue.summary.total).toBe(3);
    expect(queue.summary.eligible).toBe(1);
    expect(queue.summary.skippedPending).toBe(1);
    expect(queue.summary.skippedNonAdmit).toBe(1);
  });
});
