import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchRecord } from "../types/batchControlPlane";
import type { PatientEpisodeWorkItem, PatientQaReference } from "@medical-ai-qa/shared-types";
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
    timezone: "Asia/Manila",
    localTimes: ["15:00", "23:30"],
    lastRunAt: "2026-04-06T20:05:00.000Z",
    nextScheduledRunAt: "2026-04-07T20:05:00.000Z",
  },
  sourceWorkbook: {
    subsidiaryId: "default",
    acquisitionProvider: "MANUAL_UPLOAD",
    acquisitionStatus: "ACQUIRED",
    acquisitionReference: null,
    acquisitionNotes: [],
    acquisitionMetadata: null,
    originalFileName: "reference.xlsx",
    storedPath: "C:\\temp\\reference.xlsx",
    uploadedAt: "2026-04-06T20:00:00.000Z",
    verification: null,
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
    workflowRuns: [
      {
        workflowRunId: "batch-1-patient-1:coding",
        workflowDomain: "coding",
        status: "COMPLETED",
        stepName: "COMPLETE",
        message: "Coding workflow completed successfully.",
        chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
        startedAt: "2026-04-06T20:00:00.000Z",
        completedAt: "2026-04-06T20:05:00.000Z",
        lastUpdatedAt: "2026-04-06T20:05:00.000Z",
        workflowResultPath: "C:\\temp\\batch-1\\outputs\\patient-results\\patient-1.json",
        workflowLogPath: "C:\\temp\\batch-1\\outputs\\logs\\patient-1.json",
      },
      {
        workflowRunId: "batch-1-patient-1:qa",
        workflowDomain: "qa",
        status: "COMPLETED",
        stepName: "QA_PREFETCH_COMPLETE",
        message: "QA prefetch completed successfully.",
        chartUrl: "https://demo.portal/provider/branch/client/PT-1/intake",
        startedAt: "2026-04-06T20:00:00.000Z",
        completedAt: "2026-04-06T20:00:30.000Z",
        lastUpdatedAt: "2026-04-06T20:00:30.000Z",
        workflowResultPath: "C:\\temp\\batch-1\\outputs\\patients\\patient-1\\qa-prefetch-result.json",
        workflowLogPath: "C:\\temp\\batch-1\\outputs\\logs\\patient-1.json",
      },
    ],
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

const patientQaReference: PatientQaReference = {
  patientContext: {
    patientId: "patient-1",
    patientName: "Christine Young",
    dob: "05/30/1944",
    socDate: null,
    referralDate: "02/17/2026",
  },
  fieldRegistry: [
    {
      fieldKey: "primary_reason_for_home_health_medical_necessity",
      label: "Primary Reason For Home Health / Medical Necessity",
      groupKey: "medical_necessity_and_homebound",
      sectionKey: "patient_summary_and_clinical_narrative",
      oasisItemId: null,
      fieldType: "narrative",
      controlType: "ai_narrative",
      qaPriority: "critical",
      dashboardVisibility: "default",
      reviewMode: "qa_readback_and_confirm",
      canInferFromReferral: true,
      compareAgainstChart: true,
      requiresHumanReview: true,
      requiresCodingTeamReview: false,
      narrativeField: true,
      medicationField: false,
      diagnosisField: false,
      lowValueAdminField: false,
      supportedEvidenceSources: ["referral_document"],
      notes: null,
    },
  ],
  fieldGroups: [],
  sectionMetadata: [],
  referralDashboardSections: [
    {
      sectionKey: "patient_summary_and_clinical_narrative",
      label: "Patient Summary & Clinical Narrative",
      dashboardOrder: 13,
      printVisibility: "visible",
      fieldKeys: ["primary_reason_for_home_health_medical_necessity"],
      textSpans: [
        {
          text: "HH Nursing services for medication mgmt and wound care.",
          sourceSectionNames: ["Order Summary"],
          relatedFieldKeys: ["primary_reason_for_home_health_medical_necessity"],
          lineReferences: [],
        },
      ],
    },
  ],
  referralQaInsights: {
    generatedAt: "2026-04-11T00:00:00.000Z",
    warnings: [],
    consistencyChecks: [
      {
        id: "respiratory-vs-m1400",
        status: "flagged",
        title: "Respiratory findings vs M1400 shortness of breath answer",
        detail: "Referral documents support respiratory involvement while the chart respiratory answer is still blank.",
        relatedSections: ["Cardiopulmonary (Chest & Thorax)"],
      },
    ],
    sourceHighlights: [
      {
        id: "medical-necessity",
        title: "Medical necessity",
        summary: "Skilled nursing for medication management and wound care.",
        supportingSections: ["Patient Summary & Clinical Narrative"],
      },
    ],
    draftNarratives: [
      {
        fieldKey: "patient_summary_narrative",
        label: "Patient Summary / Clinical Narrative",
        draft: "Patient is being discharged home with skilled nursing and wound-care support.",
        status: "ready_for_qa",
      },
    ],
  },
  chartSnapshot: {},
  documentEvidence: {},
  proposedReferenceValues: {},
  comparisonResults: {
    primary_reason_for_home_health_medical_necessity: {
      fieldKey: "primary_reason_for_home_health_medical_necessity",
      label: "Primary Reason For Home Health / Medical Necessity",
      groupKey: "medical_necessity_and_homebound",
      qaPriority: "critical",
      currentChartValue: null,
      documentSupportedValue: "Skilled nursing for medication management and wound care.",
      comparisonStatus: "supported_by_referral",
      workflowState: "needs_qa_readback",
      recommendedAction: "qa_readback_and_confirm",
      sourceEvidence: [
        {
          sourceType: "REFERRAL_ORDER",
          sourceLabel: "Referral Order",
          textSpan: "HH Nursing services for medication mgmt and wound care.",
          confidence: 0.92,
        },
      ],
      requiresHumanReview: true,
    },
  },
  qaReviewQueue: [
    {
      fieldKey: "primary_reason_for_home_health_medical_necessity",
      groupKey: "medical_necessity_and_homebound",
      sectionKey: "patient_summary_and_clinical_narrative",
      qaPriority: "critical",
      comparisonStatus: "supported_by_referral",
      workflowState: "needs_qa_readback",
      recommendedAction: "qa_readback_and_confirm",
    },
  ],
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
    fieldMapSnapshot: {
      generatedAt: "2026-04-11T00:00:00.000Z",
      fields: [
        {
          key: "primary_reason_for_home_health_medical_necessity",
          label: "Primary Reason For Home Health / Medical Necessity",
          category: "medical_necessity_homebound",
          type: "textarea",
          control: "textarea",
          options: [],
          llm_fill_candidate: true,
          human_review_required: true,
          reference_only: false,
          compare_strategy: "narrative_support_compare",
          evidence_strategy: "section_summary",
          currentChartValue: null,
          currentChartValueSource: "printed_note_ocr",
          populatedInChart: false,
        },
      ],
    },
    qaPrefetch: {
      status: "COMPLETED",
      selectedRouteSummary: "patient documents via sidebar_label: File Uploads",
      routeDiscovery: {
        selectedRoute: {
          classification: "patient_documents",
        },
      },
      oasisRoute: {
        found: true,
      },
      diagnosisRoute: {
        found: true,
        visibleDiagnoses: [
          {
            text: "J18.9 Pneumonia, unspecified organism",
          },
        ],
      },
      lockStatus: {
        status: "locked",
      },
      warningCount: 1,
      topWarning: "Patient-specific route confirmed through sidebar labels.",
      billingCalendarSummary: {
        selectedEpisode: {
          rawLabel: "03/01/2026 - 04/29/2026",
        },
        periods: {
          first30Days: {
            totalCards: 3,
            countsByType: {
              oasis: 1,
              sn_visit: 1,
              physician_order: 1,
            },
          },
          second30Days: {
            totalCards: 2,
            countsByType: {
              pt_visit: 1,
              communication_note: 1,
            },
          },
          outsideRange: {
            totalCards: 1,
            countsByType: {
              other: 1,
            },
          },
        },
      },
      printedNoteReview: {
        assessmentType: "SOC",
        reviewSource: "printed_note_ocr",
        overallStatus: "PARTIAL",
        warningCount: 1,
        topWarning: "Printed note OCR fell back to visible text.",
        capture: {
          printButtonDetected: true,
          printClickSucceeded: true,
          extractionMethod: "visible_text_fallback",
          textLength: 8120,
        },
        sections: [
          {
            key: "administrative_information",
            label: "Administrative Information",
            status: "COMPLETED",
            filledFieldCount: 4,
            missingFieldCount: 0,
          },
          {
            key: "care_plan",
            label: "Care Plan",
            status: "PARTIAL",
            filledFieldCount: 1,
            missingFieldCount: 3,
          },
        ],
      },
    },
    patientQaReference,
    qaDocumentSummary: {
      extractionUsabilityStatus: "usable",
      normalizedSectionCount: 1,
      llmProposalCount: 12,
      warnings: ["Deterministic referral facts extraction was used."],
    },
    printedNoteChartValues: {
      currentChartValues: {
        primary_reason_for_home_health_medical_necessity:
          "Skilled nursing for medication management and wound care.",
      },
    },
    printedNoteReview: {
      reviewSource: "printed_note_ocr",
      sections: [
        {
          key: "primary_reason_medical_necessity",
          label: "Primary Reason / Medical Necessity",
          status: "COMPLETED",
          filledFieldCount: 4,
          missingFieldCount: 0,
        },
      ],
    },
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
    assert.equal(summary.codingWorkflow?.status, "COMPLETED");
    assert.equal(summary.qaWorkflow?.status, "COMPLETED");
    assert.equal(summary.qaPrefetch?.lockStatus, "locked");
    assert.equal(summary.qaPrefetch?.oasisFound, true);
    assert.equal(summary.qaPrefetch?.diagnosisFound, true);
    assert.equal(summary.qaPrefetch?.selectedEpisodeRange, "03/01/2026 - 04/29/2026");
    assert.equal(summary.qaPrefetch?.first30TotalCards, 3);
    assert.equal(summary.qaPrefetch?.second30TotalCards, 2);
    assert.equal(summary.qaPrefetch?.printedNoteStatus, "PARTIAL");
    assert.equal(summary.qaPrefetch?.printedNoteAssessmentType, "SOC");
    assert.equal(summary.qaPrefetch?.printedNoteCompletedSectionCount, 1);
    assert.equal(summary.qaPrefetch?.printedNoteIncompleteSectionCount, 1);
    assert.equal(summary.qaPrefetch?.printedNotePrintButtonDetected, true);
    assert.equal(summary.qaPrefetch?.printedNoteTextLength, 8120);
    assert.equal(summary.referralQa.referralDataAvailable, true);
    assert.equal(summary.referralQa.extractionUsabilityStatus, "usable");
    assert.equal(summary.referralQa.discrepancyRating, "yellow");
    assert.equal(summary.referralQa.discrepancyCounts.total, 1);
    assert.equal(summary.dashboardReview.severity, "yellow");
    assert.equal(summary.dashboardReview.openRowCount, 1);
    assert.equal(summary.dashboardReview.highPriorityOpenCount, 1);
    assert.equal(summary.dashboardReview.resolvedCount, 0);
    assert.equal(summary.referralQa.sections.length, 1);
    assert.equal(summary.referralQa.preAuditFindings.length > 0, true);
    assert.equal(summary.referralQa.sourceHighlights.length > 0, true);
    assert.equal(summary.referralQa.draftNarratives.length > 0, true);
    assert.equal(summary.referralQa.consistencyChecks[0]?.id, "respiratory-vs-m1400");
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
    assert.equal(detail.codingWorkflow?.workflowDomain, "coding");
    assert.equal(detail.qaWorkflow?.workflowDomain, "qa");
    assert.equal(detail.qaPrefetch?.selectedRouteSummary, "patient documents via sidebar_label: File Uploads");
    assert.equal(detail.qaPrefetch?.visibleDiagnosisCount, 1);
    assert.equal(detail.qaPrefetch?.selectedEpisodeRange, "03/01/2026 - 04/29/2026");
    assert.equal(detail.qaPrefetch?.outsideRangeTotalCards, 1);
    assert.equal(detail.qaPrefetch?.printedNoteReviewSource, "printed_note_ocr");
    assert.equal(detail.qaPrefetch?.printedNoteSections.length, 2);
    assert.equal(detail.qaPrefetch?.printedNoteSections[1]?.label, "Care Plan");
    assert.equal(detail.referralPatientContext?.referralDate, "02/17/2026");
    assert.equal(detail.referralSections.length, 1);
    assert.equal(detail.referralSections[0]?.fields[0]?.comparisonStatus, "supported_by_referral");
    assert.equal(detail.referralSections[0]?.fields[0]?.currentChartValueSource, "printed_note_ocr");
    assert.equal(detail.referralSections[0]?.fields[0]?.populatedInChart, false);
    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "uncertain");
    assert.equal(detail.dashboardState.rows[0]?.backendComparisonStatus, "supported_by_referral");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSource, "printed_note_ocr");
    assert.equal(
      detail.dashboardState.rows[0]?.valuePresence.hasPrintedNoteChartValue,
      true,
    );
    assert.equal(detail.dashboardState.visibilitySummary.hiddenRows, 0);
    assert.equal(detail.dashboardReview.openRowCount, 1);
    assert.equal(
      detail.referralSections[0]?.fields[0]?.recommendation.label,
      "The referral documents provide a chart-ready answer for Primary Reason For Home Health / Medical Necessity.",
    );
    assert.equal(
      detail.referralSections[0]?.guidance.mustCheck[0],
      "Review medical necessity, admit reason, patient summary narrative, PMH, and supporting hospitalization context.",
    );
  });

  it("formats serialized diagnosis recommendations into plain English", () => {
    const diagnosisReference: PatientQaReference = {
      ...patientQaReference,
      fieldRegistry: [
        ...patientQaReference.fieldRegistry,
        {
          fieldKey: "diagnosis_candidates",
          label: "Diagnosis Candidates",
          groupKey: "diagnosis_and_coding",
          sectionKey: "active_diagnoses",
          oasisItemId: null,
          fieldType: "diagnosis_row",
          controlType: "table",
          qaPriority: "critical",
          dashboardVisibility: "default",
          reviewMode: "coding_review_required",
          canInferFromReferral: true,
          compareAgainstChart: true,
          requiresHumanReview: true,
          requiresCodingTeamReview: true,
          narrativeField: false,
          medicationField: false,
          diagnosisField: true,
          lowValueAdminField: false,
          supportedEvidenceSources: ["referral_document"],
          notes: null,
        },
      ],
      referralDashboardSections: [
        ...patientQaReference.referralDashboardSections,
        {
          sectionKey: "active_diagnoses",
          label: "Active Diagnoses",
          dashboardOrder: 2,
          printVisibility: "visible",
          fieldKeys: ["diagnosis_candidates"],
          textSpans: [],
        },
      ],
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        diagnosis_candidates: {
          fieldKey: "diagnosis_candidates",
          label: "Diagnosis Candidates",
          groupKey: "diagnosis_and_coding",
          qaPriority: "critical",
          currentChartValue: null,
          documentSupportedValue:
            '{"description":"PNEUMONIA, UNSPECIFIED ORGANISM","icd10_code":"J18.9","is_primary_candidate":true,"requires_human_review":true},{"description":"ACUTE RESPIRATORY FAILURE WITH HYPOXIA","icd10_code":"J96.01","is_primary_candidate":false,"requires_human_review":true}',
          comparisonStatus: "needs_coding_review",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
          sourceEvidence: [],
          requiresHumanReview: true,
        },
      },
      qaReviewQueue: [
        ...patientQaReference.qaReviewQueue,
        {
          fieldKey: "diagnosis_candidates",
          groupKey: "diagnosis_and_coding",
          sectionKey: "active_diagnoses",
          qaPriority: "critical",
          comparisonStatus: "needs_coding_review",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
        },
      ],
    };

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        patientQaReference: diagnosisReference,
      },
    });

    const diagnosisField = detail.referralSections
      .flatMap((section) => section.fields)
      .find((field) => field.fieldKey === "diagnosis_candidates");

    assert.equal(
      diagnosisField?.recommendation.recommendedValue,
      "PNEUMONIA, UNSPECIFIED ORGANISM (J18.9); ACUTE RESPIRATORY FAILURE WITH HYPOXIA (J96.01)",
    );
  });

  it("replaces verbose artifact consistency text with concise summaries", () => {
    const conciseReference: PatientQaReference = {
      ...patientQaReference,
      fieldRegistry: [
        ...patientQaReference.fieldRegistry,
        {
          fieldKey: "diagnosis_candidates",
          label: "Diagnosis Candidates",
          groupKey: "diagnosis_and_coding",
          sectionKey: "active_diagnoses",
          oasisItemId: null,
          fieldType: "diagnosis_row",
          controlType: "table",
          qaPriority: "critical",
          dashboardVisibility: "default",
          reviewMode: "coding_review_required",
          canInferFromReferral: true,
          compareAgainstChart: true,
          requiresHumanReview: true,
          requiresCodingTeamReview: true,
          narrativeField: false,
          medicationField: false,
          diagnosisField: true,
          lowValueAdminField: false,
          supportedEvidenceSources: ["referral_document"],
          notes: null,
        },
        {
          fieldKey: "neurological_status",
          label: "Neurological Status",
          groupKey: "symptom_and_body_system_review",
          sectionKey: "neurological_head_mood_eyes_ears",
          oasisItemId: null,
          fieldType: "multi_select",
          controlType: "checkbox",
          qaPriority: "high",
          dashboardVisibility: "default",
          reviewMode: "chart_completeness_check",
          canInferFromReferral: true,
          compareAgainstChart: true,
          requiresHumanReview: true,
          requiresCodingTeamReview: false,
          narrativeField: false,
          medicationField: false,
          diagnosisField: false,
          lowValueAdminField: false,
          supportedEvidenceSources: ["referral_document"],
          notes: null,
        },
      ],
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        diagnosis_candidates: {
          fieldKey: "diagnosis_candidates",
          label: "Diagnosis Candidates",
          groupKey: "diagnosis_and_coding",
          qaPriority: "critical",
          currentChartValue: null,
          documentSupportedValue: [
            {
              description: "METABOLIC ENCEPHALOPATHY",
              icd10_code: "G93.41",
            },
            {
              description: "DEPRESSION, UNSPECIFIED",
              icd10_code: "F32.A",
            },
          ],
          comparisonStatus: "needs_coding_review",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
          sourceEvidence: [],
          requiresHumanReview: true,
        },
        neurological_status: {
          fieldKey: "neurological_status",
          label: "Neurological Status",
          groupKey: "symptom_and_body_system_review",
          qaPriority: "high",
          currentChartValue: null,
          documentSupportedValue: null,
          comparisonStatus: "missing_in_chart",
          workflowState: "missing_in_chart",
          recommendedAction: "qa_readback_and_confirm",
          sourceEvidence: [],
          requiresHumanReview: true,
        },
      },
      referralQaInsights: {
        ...patientQaReference.referralQaInsights!,
        consistencyChecks: [
          {
            id: "mental-status-vs-m1700-m1710",
            status: "flagged",
            title: "M1700/M1710 vs Mental Status selections",
            detail: "Referral documents describe mental-status evidence as Fax Server ... extremely long note dump ...",
            relatedSections: ["Neurological (Head, Mood, Eyes, Ears)"],
          },
        ],
      },
    };

    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        patientQaReference: conciseReference,
      },
    });

    assert.equal(
      summary.referralQa.consistencyChecks[0]?.detail,
      "Referral records indicate mental or cognitive concerns. Mental-status chart selections are blank or incomplete.",
    );
  });

  it("tracks meaningful rows that are hidden because the backend marked them resolved", () => {
    const resolvedReference: PatientQaReference = {
      ...patientQaReference,
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        primary_reason_for_home_health_medical_necessity: {
          ...patientQaReference.comparisonResults.primary_reason_for_home_health_medical_necessity,
          currentChartValue: "Skilled nursing for medication management and wound care.",
          comparisonStatus: "match",
          workflowState: "already_satisfactory",
          recommendedAction: "none",
        },
      },
      qaReviewQueue: [],
    };

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: "Skilled nursing for medication management and wound care.",
              currentChartValueSource: "chart_read",
              populatedInChart: true,
            },
          ],
        },
        patientQaReference: resolvedReference,
      },
    });

    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.shownByDefault, false);
    assert.equal(detail.dashboardState.rows[0]?.visibilityDecision, "hidden_match");
    assert.deepEqual(detail.dashboardState.rows[0]?.strictnessFlags, [
      "hidden_with_meaningful_value",
      "hidden_match_by_default",
    ]);
    assert.equal(detail.dashboardState.visibilitySummary.hiddenRows, 1);
    assert.deepEqual(detail.dashboardState.visibilitySummary.hiddenByReason, {
      hidden_match: 1,
    });
    assert.deepEqual(detail.dashboardState.visibilitySummary.potentiallyTooStrictRows, [
      "primary_reason_for_home_health_medical_necessity",
    ]);
  });

  it("shows missing referral documentation when the chart is filled but the referral value is absent", () => {
    const chartOnlyReference: PatientQaReference = {
      ...patientQaReference,
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        primary_reason_for_home_health_medical_necessity: {
          ...patientQaReference.comparisonResults.primary_reason_for_home_health_medical_necessity,
          currentChartValue: "Skilled nursing for medication management and wound care.",
          documentSupportedValue: null,
          comparisonStatus: "needs_qa_readback",
          workflowState: "needs_qa_readback",
          recommendedAction: "qa_readback_and_confirm",
          sourceEvidence: [],
        },
      },
      qaReviewQueue: [
        {
          fieldKey: "primary_reason_for_home_health_medical_necessity",
          groupKey: "medical_necessity_and_homebound",
          sectionKey: "patient_summary_and_clinical_narrative",
          qaPriority: "critical",
          comparisonStatus: "needs_qa_readback",
          workflowState: "needs_qa_readback",
          recommendedAction: "qa_readback_and_confirm",
        },
      ],
    };

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: "Skilled nursing for medication management and wound care.",
              currentChartValueSource: "chart_read",
              populatedInChart: true,
            },
          ],
        },
        patientQaReference: chartOnlyReference,
        printedNoteChartValues: {
          currentChartValues: {},
        },
      },
    });

    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "missing_in_referral");
    assert.equal(detail.dashboardState.rows[0]?.reviewStatus, "Missing Referral Documentation");
    assert.equal(detail.dashboardState.rows[0]?.shownByDefault, true);
    assert.equal(detail.dashboardReview.missingInReferralCount, 1);
    assert.equal(detail.dashboardReview.openRowCount, 1);
  });

  it("does not hide chart-only values as resolved when referral support is missing", () => {
    const resolvedButUnsupportedReference: PatientQaReference = {
      ...patientQaReference,
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        primary_reason_for_home_health_medical_necessity: {
          ...patientQaReference.comparisonResults.primary_reason_for_home_health_medical_necessity,
          currentChartValue: "Skilled nursing for medication management and wound care.",
          documentSupportedValue: null,
          comparisonStatus: "match",
          workflowState: "already_satisfactory",
          recommendedAction: "none",
          sourceEvidence: [],
        },
      },
      qaReviewQueue: [],
    };

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: "Skilled nursing for medication management and wound care.",
              currentChartValueSource: "chart_read",
              populatedInChart: true,
            },
          ],
        },
        patientQaReference: resolvedButUnsupportedReference,
        printedNoteChartValues: {
          currentChartValues: {},
        },
      },
    });

    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "missing_in_referral");
    assert.equal(detail.dashboardState.rows[0]?.shownByDefault, true);
    assert.equal(detail.dashboardState.rows[0]?.visibilityDecision, "show");
    assert.equal(detail.dashboardState.visibilitySummary.hiddenRows, 0);
    assert.equal(detail.dashboardReview.missingInReferralCount, 1);
  });
});
