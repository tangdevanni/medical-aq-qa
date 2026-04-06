import { describe, expect, it } from "vitest";
import type { ArtifactRecord, PatientEpisodeWorkItem, PatientMatchResult } from "@medical-ai-qa/shared-types";
import { evaluateOasisQa } from "../services/oasisQaEvaluator";

function createWorkItem(): PatientEpisodeWorkItem {
  return {
    id: "patient-1",
    patientIdentity: {
      displayName: "Jane Doe",
      normalizedName: "JANE DOE",
      medicareNumber: "12345",
    },
    episodeContext: {
      episodeDate: "2026-03-01",
      socDate: "2026-03-01",
      episodePeriod: "2026-03-01 to 2026-04-29",
      billingPeriod: "2026-03-01 to 2026-03-31",
      payer: "Medicare",
      assignedStaff: "Alice",
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    workflowTypes: ["SOC", "VISIT_NOTES", "BILLING_PREP"],
    sourceSheets: ["OASIS SOC-ROC-REC & POC", "VISIT NOTES"],
    timingMetadata: {
      trackingDays: 4,
      daysInPeriod: 30,
      daysLeft: 4,
      rawTrackingValues: ["4"],
      rawDaysInPeriodValues: ["30"],
      rawDaysLeftValues: ["4"],
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

describe("evaluateOasisQa", () => {
  it("blocks patients when extracted OASIS and visit-note content miss required fields", () => {
    const artifacts: ArtifactRecord[] = [
      {
        artifactType: "OASIS",
        status: "FOUND",
        portalLabel: "OASIS",
        locatorUsed: "text=OASIS",
        discoveredAt: new Date().toISOString(),
        downloadPath: null,
        extractedFields: {
          text: "Medical necessity confirmed. Comprehensive assessment completed.",
        },
        notes: [],
      },
      {
        artifactType: "PLAN_OF_CARE",
        status: "FOUND",
        portalLabel: "POC",
        locatorUsed: "text=POC",
        discoveredAt: new Date().toISOString(),
        downloadPath: null,
        extractedFields: {
          text: "Diagnosis list updated. Goals and interventions reviewed.",
        },
        notes: [],
      },
      {
        artifactType: "VISIT_NOTES",
        status: "FOUND",
        portalLabel: "Visit Notes",
        locatorUsed: "text=Visit Notes",
        discoveredAt: new Date().toISOString(),
        downloadPath: null,
        extractedFields: {
          text: "Skilled nursing visit. Interventions performed. No vitals documented.",
        },
        notes: [],
      },
    ];

    const matchResult: PatientMatchResult = {
      status: "EXACT",
      searchQuery: "Jane Doe",
      portalPatientId: "PT-1",
      portalDisplayName: "Jane Doe",
      candidateNames: ["Jane Doe"],
      note: null,
    };

    const result = evaluateOasisQa({
      workItem: createWorkItem(),
      matchResult,
      artifacts,
      processingStatus: "COMPLETE",
      extractedDocuments: [
        {
          type: "OASIS",
          text: "Medical necessity confirmed. Comprehensive assessment completed.",
          metadata: {},
        },
        {
          type: "POC",
          text: "Diagnosis list updated. Goals and interventions reviewed.",
          metadata: {},
        },
        {
          type: "VISIT_NOTE",
          text: "Skilled nursing visit. Interventions performed. No vitals documented.",
          metadata: {},
        },
      ],
    });

    expect(result.oasisQaSummary.overallStatus).toBe("BLOCKED");
    expect(result.oasisQaSummary.blockers).toContain("Homebound reason is stated");
    expect(result.oasisQaSummary.blockers).toContain("Patient response to interventions is documented");
  });

  it("maps a completed portal search with no available patient result to PORTAL_NOT_FOUND", () => {
    const matchResult: PatientMatchResult = {
      status: "NOT_FOUND",
      searchQuery: "Jane Doe",
      portalPatientId: null,
      portalDisplayName: null,
      candidateNames: [],
      note: "Patient search completed, but the patient is not currently available in portal results.",
    };

    const result = evaluateOasisQa({
      workItem: createWorkItem(),
      matchResult,
      artifacts: [],
      processingStatus: "BLOCKED",
      extractedDocuments: [],
    });

    expect(result.qaOutcome).toBe("PORTAL_NOT_FOUND");
    expect(result.findings.some((finding) => finding.outcome === "PORTAL_NOT_FOUND")).toBe(true);
  });
});
