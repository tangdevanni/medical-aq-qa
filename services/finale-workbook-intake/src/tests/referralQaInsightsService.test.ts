import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "../referralProcessing/fieldContract";
import { extractReferralFacts } from "../referralProcessing/factsExtractionService";
import { generateReferralFieldProposals } from "../referralProcessing/llmProposalService";
import { generateReferralQaInsights } from "../referralProcessing/referralQaInsightsService";
import { normalizeReferralSections } from "../referralProcessing/sectionNormalization";
import { compareProposedFieldsAgainstChart } from "../referralProcessing/comparisonEngine";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";

function buildWorkItem(): PatientEpisodeWorkItem {
  return {
    id: "CHRISTINE_YOUNG__test",
    subsidiaryId: "default",
    patientIdentity: {
      displayName: "Christine Young",
      normalizedName: "CHRISTINE YOUNG",
      medicareNumber: "8A75MN2VE79",
    },
    episodeContext: {
      socDate: "02/27/2026",
      episodeDate: "02/27/2026",
      billingPeriod: "02/27/2026 - 03/31/2026",
      episodePeriod: "02/27/2026 - 04/27/2026",
      payer: null,
      assignedStaff: null,
      clinician: null,
      qaSpecialist: null,
      rfa: "SOC",
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "IN_PROGRESS",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    workflowTypes: ["SOC"],
    sourceSheets: ["OASIS Tracking Report"],
    sourceRemarks: [],
    sourceRowReferences: [],
    sourceValues: [],
    importWarnings: [],
  };
}

describe("generateReferralQaInsights", () => {
  it("produces deterministic comparison, source, and draft blocks when LLM is disabled", async () => {
    const sourceText = [
      "Resident: YOUNG, CHRISTINE E (41707) DOB: 05/30/1944",
      "Order Summary: Pt to discharge home on 2/20/26. HH Nursing services for medication mgmt and vitals and wound care. HH PT/OT eval and treat as indicated.",
      "ADVANCE DIRECTIVE CPR / Full Code",
      "Diagnoses: PNEUMONIA, UNSPECIFIED ORGANISM(J18.9), DEPRESSION, UNSPECIFIED(F32.A), CHRONIC VENOUS HYPERTENSION (IDIOPATHIC) WITH ULCER OF BILATERAL LOWER EXTREMITY(187.313)",
      "Note Text: Dysphagia, did not clear speech therapy. Placed on pureed diet. Encephalopathy improved. Generalized weakness, improving. Pain management as needed. WBAT, PT OT.",
      "Precautions Details: Falls, s/p Acute resp failure, PNA C O2, SOB, Confusion; G: 2WW 100', WC 150'",
    ].join(" ");

    const workItem = buildWorkItem();
    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({
        workItem,
        currentChartValues: {
          gg_self_care: null,
          gg_mobility: null,
          respiratory_status: null,
          pain_assessment_narrative: null,
        },
      }),
    });
    const sections = normalizeReferralSections(sourceText);
    const extractedFacts = extractReferralFacts({
      fieldMapSnapshot,
      sections,
      sourceText,
    });
    const llmProposal = await generateReferralFieldProposals({
      env: loadEnv({
        ...process.env,
        CODE_LLM_ENABLED: "false",
      }),
      fieldMapSnapshot,
      extractedFacts,
      sourceText,
    });
    const fieldComparisons = compareProposedFieldsAgainstChart({
      fieldMapSnapshot,
      proposals: llmProposal.proposed_field_values,
      diagnosisCandidates: llmProposal.diagnosis_candidates,
    });

    const insights = await generateReferralQaInsights({
      env: loadEnv({
        ...process.env,
        CODE_LLM_ENABLED: "false",
      }),
      extractedFacts,
      fieldMapSnapshot,
      llmProposal,
      fieldComparisons,
      normalizedSections: sections,
      sourceText,
    });

    expect(insights.consistency_checks).toHaveLength(7);
    expect(insights.source_highlights).toHaveLength(7);
    expect(insights.draft_narratives).toHaveLength(7);
    expect(insights.warnings[0]).toContain("Deterministic referral QA insights fallback");
    expect(insights.consistency_checks.find((entry) => entry.id === "functional-vs-gg0130-gg0170")?.status).toBe("flagged");
    expect(insights.source_highlights.find((entry) => entry.id === "diet-and-fluid-instructions")?.summary.toLowerCase()).toContain("pureed diet");
    expect(insights.draft_narratives.find((entry) => entry.field_key === "primary_reason_for_home_health_medical_necessity")?.draft.length).toBeGreaterThan(20);
  });
});
