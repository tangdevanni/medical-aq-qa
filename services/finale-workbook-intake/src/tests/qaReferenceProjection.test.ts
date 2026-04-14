import { describe, expect, it } from "vitest";
import { buildPatientQaReference } from "../qaReference/projection";
import { buildFieldMapSnapshot, createInitialChartSnapshotValues } from "../referralProcessing/fieldContract";
import type {
  FieldComparisonResult,
  NormalizedReferralSection,
  ReferralLlmProposal,
  ReferralQaInsights,
  SourceDocumentArtifact,
} from "../referralProcessing/types";
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

describe("buildPatientQaReference", () => {
  it("projects chart snapshot and referral support into dashboard-ready QA reference fields", () => {
    const workItem = buildWorkItem();
    const fieldMapSnapshot = buildFieldMapSnapshot({
      chartSnapshotValues: createInitialChartSnapshotValues({
        workItem,
        currentChartValues: {
          preferred_language: "English",
        },
      }),
    });
    const llmProposal: ReferralLlmProposal = {
      patient_context: {
        patient_name: "YOUNG, CHRISTINE E",
        dob: "05/30/1944",
        soc_date: "02/27/2026",
        referral_date: "02/17/2026",
      },
      proposed_field_values: [
        {
          field_key: "primary_reason_for_home_health_medical_necessity",
          proposed_value: "Skilled nursing for medication management and PT/OT for mobility after discharge.",
          confidence: 0.87,
          source_spans: ["HH Nursing services for medication mgmt and vitals. HH PT/OT eval and treat."],
          rationale: "Referral order supports skilled home health need.",
          requires_human_review: true,
        },
        {
          field_key: "preferred_language",
          proposed_value: "English",
          confidence: 0.95,
          source_spans: ["Primary Lang. English"],
          rationale: "Explicitly stated in referral demographics.",
          requires_human_review: false,
        },
      ],
      diagnosis_candidates: [
        {
          description: "Pneumonia, unspecified organism",
          icd10_code: "J18.9",
          confidence: 0.82,
          source_spans: ["J18.9 PNEUMONIA, UNSPECIFIED ORGANISM"],
          is_primary_candidate: true,
          requires_human_review: true,
        },
      ],
      caregiver_candidates: [],
      unsupported_or_missing_fields: [],
      warnings: [],
    };
    const fieldComparisons: FieldComparisonResult[] = [
      {
        field_key: "preferred_language",
        current_chart_value: "English",
        proposed_value: "English",
        comparison_status: "match",
        confidence: 0.95,
        rationale: "Values match.",
        source_spans: ["Primary Lang. English"],
        reviewer_priority: "low",
      },
    ];
    const sourceMeta: SourceDocumentArtifact = {
      patientId: workItem.id,
      selectedDocumentId: "referral-1",
      sourceDocuments: [{
        documentId: "referral-1",
        sourceIndex: 0,
        sourceLabel: "Christine Young Referral",
        normalizedSourceLabel: "christine-young-referral",
        sourceType: "REFERRAL_ORDER",
        acquisitionMethod: "network_pdf_response",
        selectionStatus: "selected",
        portalLabel: "Christine Young Referral",
        localFilePath: "C:/tmp/referral.pdf",
        effectiveTextSource: "digital_pdf_text",
        fileType: "pdf",
        fileSizeBytes: 1000,
        extractedTextLength: 5000,
        selectedReason: "test",
        rejectedReasons: [],
      }],
      warnings: [],
      generatedAt: "2026-04-10T00:00:00.000Z",
    };
    const normalizedSections: NormalizedReferralSection[] = [
      {
        sectionName: "medical_necessity",
        extractedTextSpans: ["HH Nursing services for medication mgmt and vitals. HH PT/OT eval and treat."],
        normalizedSummary: "HH Nursing services for medication mgmt and vitals. HH PT/OT eval and treat.",
        confidence: 0.8,
        lineReferences: [{ lineStart: 1, lineEnd: 1, charStart: 0, charEnd: 70 }],
      },
      {
        sectionName: "code_status",
        extractedTextSpans: ["Code status: full_code"],
        normalizedSummary: "Code status: full_code",
        confidence: 0.8,
        lineReferences: [{ lineStart: 2, lineEnd: 2, charStart: 71, charEnd: 93 }],
      },
    ];
    const extractedText = [
      "Order Summary: HH Nursing services for medication mgmt and vitals. HH PT/OT eval and treat.",
      "Code status: full_code",
    ].join("\n");
    const referralQaInsights: ReferralQaInsights = {
      generated_at: "2026-04-11T00:00:00.000Z",
      warnings: [],
      consistency_checks: [{
        id: "respiratory-vs-m1400",
        status: "watch",
        title: "Respiratory findings vs M1400 shortness of breath answer",
        detail: "Referral documents support respiratory involvement while the current respiratory chart field still requires reconciliation.",
        related_sections: ["Cardiopulmonary (Chest & Thorax)"],
      }],
      source_highlights: [{
        id: "medical-necessity",
        title: "Medical necessity",
        summary: "Skilled nursing for medication management and PT/OT for mobility after discharge.",
        supporting_sections: ["Patient Summary & Clinical Narrative"],
      }],
      draft_narratives: [{
        field_key: "patient_summary_narrative",
        label: "Patient Summary / Clinical Narrative",
        draft: "Patient discharged home with skilled nursing and therapy needs after hospitalization for pneumonia.",
        status: "ready_for_qa",
      }],
    };

    const reference = buildPatientQaReference({
      workItem,
      sourceMeta,
      extractedText,
      normalizedSections,
      fieldMapSnapshot,
      llmProposal,
      fieldComparisons,
      referralQaInsights,
    });

    expect(reference.fieldGroups).toHaveLength(9);
    expect(reference.patientContext.patientName).toBe("Christine Young");
    expect(reference.proposedReferenceValues.referral_date.value).toBe("02/17/2026");

    const medicalNecessity = reference.comparisonResults.primary_reason_for_home_health_medical_necessity;
    expect(medicalNecessity.groupKey).toBe("medical_necessity_and_homebound");
    expect(medicalNecessity.workflowState).toBe("needs_qa_readback");
    expect(medicalNecessity.recommendedAction).toBe("qa_readback_and_confirm");
    expect(medicalNecessity.sourceEvidence[0]?.sourceLabel).toBe("Christine Young Referral");

    const diagnosisCandidates = reference.comparisonResults.diagnosis_candidates;
    expect(diagnosisCandidates.workflowState).toBe("needs_coding_review");
    expect(diagnosisCandidates.recommendedAction).toBe("escalate_to_coding");

    const preferredLanguage = reference.comparisonResults.preferred_language;
    expect(preferredLanguage.comparisonStatus).toBe("match");
    expect(preferredLanguage.workflowState).toBe("already_satisfactory");

    const patientName = reference.comparisonResults.patient_name;
    expect(patientName.comparisonStatus).toBe("not_relevant_for_dashboard");
    expect(patientName.recommendedAction).toBe("reference_only");

    const adminSection = reference.referralDashboardSections.find((section) =>
      section.sectionKey === "administrative_information");
    expect(adminSection?.fieldKeys).toContain("preferred_language");

    const narrativeSection = reference.referralDashboardSections.find((section) =>
      section.sectionKey === "patient_summary_and_clinical_narrative");
    expect(narrativeSection?.textSpans.some((span) =>
      span.text.includes("HH Nursing services for medication mgmt"))).toBe(true);

    expect(reference.qaReviewQueue[0]?.workflowState).toBe("needs_coding_review");
    expect(reference.qaReviewQueue.some((entry) =>
      entry.fieldKey === "primary_reason_for_home_health_medical_necessity")).toBe(true);
    expect(reference.qaReviewQueue.some((entry) => entry.fieldKey === "patient_name")).toBe(false);
    expect(reference.referralQaInsights?.consistencyChecks[0]?.id).toBe("respiratory-vs-m1400");
    expect(reference.referralQaInsights?.draftNarratives[0]?.fieldKey).toBe("patient_summary_narrative");
  });
});
