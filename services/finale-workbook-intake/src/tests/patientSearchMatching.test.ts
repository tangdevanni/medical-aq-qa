import { describe, expect, it } from "vitest";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import {
  buildPatientSearchQueries,
  normalizePatientNameForGlobalSearch,
  normalizePatientNameForGlobalSearchResult,
  scorePatientSearchCandidate,
} from "../portal/utils/patientSearchMatching";

const workItem: PatientEpisodeWorkItem = {
  id: "JANE_DOE__1",
  patientIdentity: {
    displayName: "Doe, Jane",
    normalizedName: "JANE DOE",
    medicareNumber: "12345",
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
  workflowTypes: ["SOC", "VISIT_NOTES"],
  sourceSheets: ["OASIS SOC-ROC-REC & POC", "VISIT NOTES"],
  timingMetadata: {
    trackingDays: 5,
    daysInPeriod: 31,
    daysLeft: 10,
    rawTrackingValues: ["5"],
    rawDaysInPeriodValues: ["31"],
    rawDaysLeftValues: ["10"],
  },
  codingReviewStatus: "DONE",
  oasisQaStatus: "DONE",
  pocQaStatus: "IN_PROGRESS",
  visitNotesQaStatus: "NOT_STARTED",
  billingPrepStatus: "NOT_STARTED",
  sourceRemarks: [],
  sourceRowReferences: [],
  sourceValues: [],
  importWarnings: [],
};

describe("patientSearchMatching", () => {
  it("builds multiple normalized search query variants", () => {
    const queries = buildPatientSearchQueries(workItem);

    expect(queries).toEqual(
      expect.arrayContaining([
        "Doe, Jane",
        "JANE DOE",
        "DOE JANE",
        "Doe Jane",
      ]),
    );
  });

  it("scores an exact candidate higher than a partial match", () => {
    const exact = scorePatientSearchCandidate(workItem, "Jane Doe 12345");
    const partial = scorePatientSearchCandidate(workItem, "Jane Something Else");

    expect(exact.score).toBeGreaterThan(partial.score);
    expect(exact.reasons).toEqual(expect.arrayContaining(["all patient name tokens present", "medicare number matched"]));
  });

  it("normalizes workbook names into lower-case last, first for global search", () => {
    expect(normalizePatientNameForGlobalSearch("Christine Young")).toBe("young, christine");
    expect(normalizePatientNameForGlobalSearch("Jean Thompson")).toBe("thompson, jean");
    expect(normalizePatientNameForGlobalSearch("Eleanore Wein")).toBe("wein, eleanore");
    expect(normalizePatientNameForGlobalSearch(" Mary   Van  Dyke ")).toBe("van dyke, mary");
    expect(normalizePatientNameForGlobalSearch("Young, Christine")).toBe("young, christine");
  });

  it("normalizes workbook names into upper-case last, first for search result verification", () => {
    expect(normalizePatientNameForGlobalSearchResult("Christine Young")).toBe("YOUNG, CHRISTINE");
    expect(normalizePatientNameForGlobalSearchResult("Jean Thompson")).toBe("THOMPSON, JEAN");
    expect(normalizePatientNameForGlobalSearchResult("Eleanore Wein")).toBe("WEIN, ELEANORE");
    expect(normalizePatientNameForGlobalSearchResult(" Mary   Van  Dyke ")).toBe("VAN DYKE, MARY");
    expect(normalizePatientNameForGlobalSearchResult("Young, Christine")).toBe("YOUNG, CHRISTINE");
  });
});
