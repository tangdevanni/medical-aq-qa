import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchRecord } from "../types/batchControlPlane";
import type {
  ClinicalComparisonRow,
  PatientEpisodeWorkItem,
  PatientQaReference,
} from "@medical-ai-qa/shared-types";
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
    localTimes: ["20:30"],
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
    documentFactPack: {
      factPack: {
        diagnoses: [
          {
            code: "J18.9",
            description: "PNEUMONIA, UNSPECIFIED ORGANISM",
          },
          {
            code: "J96.01",
            description: "ACUTE RESPIRATORY FAILURE WITH HYPOXIA",
          },
        ],
      },
    },
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
      oasisAssessmentStatus: {
        detectedStatuses: ["SIGNED", "VALIDATED"],
        primaryStatus: "VALIDATED",
        decision: "PROCESS",
        processingEligible: true,
        reason: "Continue downstream OASIS capture because no skip-only status was detected. Observed signed, validated.",
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
            workbookColumns: {
              sn: "SN - 1",
              ptOtSt: "NA",
              hhaMsw: "NA",
            },
          },
          second30Days: {
            totalCards: 2,
            countsByType: {
              pt_visit: 1,
              communication_note: 1,
            },
            workbookColumns: {
              sn: "NA",
              ptOtSt: "PT - 1",
              hhaMsw: "NA",
            },
          },
          outsideRange: {
            totalCards: 1,
            countsByType: {
              other: 1,
            },
            workbookColumns: {
              sn: "NA",
              ptOtSt: "NA",
              hhaMsw: "NA",
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
            evidence: ["Administrative Information: SOC 03/01/2026."],
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
          evidence: [
            "Primary Reason for Home Health/Medical Necessity (POC Element): Skilled nursing for medication management and wound care.",
          ],
        },
      ],
    },
    llmUsageAudit: {
      configuredModelId: "amazon.nova-pro-v1:0",
      stages: [
        {
          stage: "diagnosis_coding_extraction",
          status: "passed",
          llmAttempted: true,
          llmSucceeded: true,
          invocationModelId: "amazon.nova-pro-v1:0",
          summary: "Diagnosis extraction succeeded.",
        },
        {
          stage: "printed_note_chart_value_extraction",
          status: "passed",
          llmAttempted: true,
          llmSucceeded: true,
          invocationModelId: "amazon.nova-pro-v1:0",
          summary: "Printed-note extraction succeeded.",
        },
        {
          stage: "referral_field_proposals",
          status: "fallback",
          llmAttempted: true,
          llmSucceeded: false,
          summary: "Referral proposal used deterministic fallback.",
          warnings: ["Deterministic referral facts extraction was used."],
        },
        {
          stage: "referral_qa_insights",
          status: "fallback",
          llmAttempted: true,
          llmSucceeded: false,
          summary: "Referral QA insights used deterministic fallback.",
          warnings: ["Deterministic referral QA insights fallback was used."],
        },
        {
          stage: "plan_of_care_generation",
          status: "fallback",
          llmAttempted: true,
          llmSucceeded: true,
          invocationModelId: "amazon.nova-pro-v1:0",
          summary: "POC generation finished with status limited_preview.",
        },
      ],
    },
    oasisValidation: {
      status: "validated_with_gaps",
      validatedAt: "2026-04-11T00:05:00.000Z",
      validateSelectorUsed: "button:has-text('Validate - ALL')",
      currentUrl: "https://demo.portal/provider/branch/client/PT-1/oasis",
      missingFieldCount: 2,
      missingFields: [
        {
          fieldId: "m1730",
          label: "Depression Screening",
          section: "Cognitive / Emotional Status",
          mItem: "M1730",
          message: "Required before validation can complete.",
          selectorUsed: "#m1730",
        },
        {
          fieldId: "m1033",
          label: "Risk For Hospitalization",
          section: "Risk Factors",
          mItem: "M1033",
          message: "Please complete this field.",
          selectorUsed: "#m1033",
        },
      ],
      rawMessages: ["Please complete required OASIS fields before validating."],
      warnings: [],
    },
    referralOasisConsistency: {
      status: "contradictions_found",
      generatedAt: "2026-04-11T00:04:00.000Z",
      findingCount: 1,
      blockingFindingCount: 1,
      findings: [
        {
          id: "cognition-1",
          category: "cognition",
          label: "Referral cognitive concerns are not reflected consistently in OASIS.",
          confidence: "high",
          referralEvidence: "Referral notes Alzheimer’s disease with memory decline.",
          oasisEvidence: "OASIS documents the patient as alert and oriented without cognitive concern.",
          reviewerExplanation:
            "Referral documents indicate Alzheimer’s disease, but the captured OASIS evidence presents a materially inconsistent mental-status picture.",
          blocksPlanOfCare: true,
        },
      ],
      warnings: [],
    },
    oasisGate: {
      evaluatedAt: "2026-04-11T00:06:00.000Z",
      status: "failed_both",
      blockedFromPlanOfCare: true,
      missingFieldCount: 2,
      contradictionCount: 1,
      topReasons: [
        "M1730 Depression Screening",
        "M1033 Risk For Hospitalization",
        "Referral cognitive concerns are not reflected consistently in OASIS.",
      ],
      planOfCareAttempted: false,
      planOfCareAttemptSkippedReason:
        "OASIS gate failed, so Plan of Care review was not attempted.",
    },
    generatedPlanOfCare: {
      status: "skipped_oasis_gate",
      generatedAt: "2026-04-11T00:06:30.000Z",
      questionBankVersion: null,
      reviewRequired: true,
      generationMode: "generate_once_then_freeze",
      sourceSummary: {
        oasisValidationTimestamp: "2026-04-11T00:05:00.000Z",
        oasisGateTimestamp: "2026-04-11T00:06:00.000Z",
        keyClinicalSignals: [],
      },
      problems: [],
      warnings: [
        "OASIS gate failed, so Plan of Care review was not attempted.",
      ],
      diagnostics: {
        llmUsed: false,
        modelId: null,
        retrievedProblemCount: 0,
        promptCharacterEstimate: 0,
      },
    },
    clinicalContradictionAnalysis: null,
    artifactLineage: null,
  },
};

const actionableClinicalContradictionAnalysis = {
  schemaVersion: "clinical-contradiction-analysis.v1",
  generatedAt: "2026-04-11T00:07:00.000Z",
  sourceFactPackHash: "source-hash",
  oasisFactPackHash: "oasis-hash",
  llmStatus: "disabled",
  deterministicFindingCount: 1,
  llmFindingCount: 0,
  findingCount: 2,
  highSeverityCount: 1,
  needsReviewCount: 1,
  reviewerVisibleCount: 1,
  suppressedCount: 1,
  priorityCounts: {
    critical: 0,
    high: 1,
    medium: 0,
    low: 1,
    informational: 0,
  },
  categoryCounts: {
    cognitive_status: 1,
    medication: 1,
  },
  verdictCounts: {
    match: 0,
    contradiction: 1,
    missing_in_oasis: 1,
    missing_in_source: 0,
    newer_source_conflict: 0,
    newer_oasis_conflict: 0,
    resolved_condition: 0,
    uncertain: 0,
  },
  reviewerQueueInterpretation: "actionable_discrepancies_detected",
  summary: {
    totalFindings: 2,
    reviewerVisibleCount: 1,
    suppressedCount: 1,
    highPriorityCount: 1,
    mediumPriorityCount: 0,
    informationalCount: 0,
    topCategories: ["cognitive_status"],
    topVerdicts: ["contradiction"],
    llmStatus: "disabled",
  },
  reviewerQueue: [{
    findingId: "finding-cognition",
    category: "cognitive_status",
    title: "Cognitive status conflicts with OASIS orientation",
    verdict: "contradiction",
    severity: "high",
    confidence: 0.88,
    needsHumanReview: true,
    reviewerVisible: true,
    priority: "high",
    evidenceStrength: "strong",
    comparisonStrictness: "strict",
    suppressionReason: "none",
    sourceFacts: [{
      factId: "src-cog",
      category: "cognitive_status",
      label: "Cognitive status",
      normalizedValue: "dementia with confusion",
      polarity: "present",
      clinicalStatus: "active",
      confidence: 0.9,
      sourceType: "referral",
    }],
    oasisFacts: [{
      factId: "oas-alert",
      category: "orientation",
      label: "Orientation",
      normalizedValue: "alert and oriented",
      polarity: "present",
      clinicalStatus: "active",
      confidence: 0.9,
      sourceType: "oasis",
    }],
    sourceSummary: "Source indicates cognitive impairment.",
    oasisSummary: "OASIS indicates alert and oriented status.",
    rationale: "The normalized facts directly conflict.",
    dateAssessment: {
      sourceDate: "2026-04-10",
      oasisDate: "2026-04-09",
      newerSide: "source",
      recencyImpact: "medium",
    },
    evidence: [{
      factId: "src-cog",
      artifactPath: "source-clinical-fact-pack.json",
      snippet: "Cognitive impairment documented.",
    }],
    llmUsed: false,
    deterministicRuleIds: ["deterministic.cognition_impairment_vs_oasis_intact"],
  }],
  findings: [
    {
      findingId: "finding-cognition",
      category: "cognitive_status",
      title: "Cognitive status conflicts with OASIS orientation",
      verdict: "contradiction",
      severity: "high",
      confidence: 0.88,
      needsHumanReview: true,
      reviewerVisible: true,
      priority: "high",
      evidenceStrength: "strong",
      comparisonStrictness: "strict",
      suppressionReason: "none",
      sourceFacts: [],
      oasisFacts: [],
      sourceSummary: "Source indicates cognitive impairment.",
      oasisSummary: "OASIS indicates alert and oriented status.",
      rationale: "The normalized facts directly conflict.",
      evidence: [],
      llmUsed: false,
      deterministicRuleIds: [],
    },
    {
      findingId: "finding-suppressed",
      category: "medication",
      title: "Weak medication mention suppressed",
      verdict: "missing_in_oasis",
      severity: "low",
      confidence: 0.56,
      needsHumanReview: false,
      reviewerVisible: false,
      priority: "low",
      evidenceStrength: "weak",
      comparisonStrictness: "balanced",
      suppressionReason: "low_confidence_source_fact",
      sourceFacts: [],
      oasisFacts: [],
      sourceSummary: "Weak medication mention.",
      oasisSummary: "No matching OASIS medication.",
      rationale: "Weak source fact.",
      evidence: [],
      llmUsed: false,
      deterministicRuleIds: [],
    },
  ],
  warnings: [],
};

const clinicalLineage = {
  sourceFactCount: 177,
  oasisFactCount: 72,
  clinicalContradictionAnalysisHash: "eb3122dc0000",
  sourceFactPackHash: "source-hash",
  oasisFactPackHash: "oasis-hash",
  contradictionSuppressionReasonCounts: {
    low_confidence_source_fact: 1,
    none: 1,
  },
};

const planOfCareReviewDraft = {
  schemaVersion: "plan-of-care-review-draft.v1",
  generatedAt: "2026-04-11T00:08:00.000Z",
  llmStatus: "disabled",
  llmErrorCategory: null,
  promptDiagnosisCount: 0,
  promptTokenEstimate: 0,
  llmTailoredDiagnosisCount: 0,
  diagnosisSourcePath: "plan-of-care-diagnosis-source.json",
  candidatesPath: "plan-of-care-candidates.json",
  summary: {
    diagnosisCount: 1,
    draftedDiagnosisCount: 1,
    needsReviewCount: 0,
    lowConfidenceCount: 0,
    missingCandidateCount: 0,
    sourcePriorityUsed: "oasis_fact_pack",
    warnings: [],
    llmErrorCategory: null,
    promptDiagnosisCount: 0,
    promptTokenEstimate: 0,
    llmTailoredDiagnosisCount: 0,
  },
  diagnosisDrafts: [{
    diagnosisKey: "diagnosis:pneumonia:j18.9",
    diagnosisLabel: "Pneumonia",
    icdCode: "J18.9",
    problem: {
      selectedText: "Respiratory status requires skilled assessment and monitoring.",
      bankEntryId: "problem-respiratory-monitoring",
      rationale: "Selected from the care-plan bank based on the OASIS diagnosis.",
      confidence: 0.84,
      evidenceFactIds: ["oasis-dx-1"],
    },
    goal: {
      selectedText: "Patient will maintain stable respiratory status during the episode.",
      bankEntryId: "goal-respiratory-stability",
      measurableTarget: "No acute respiratory decline through the review period.",
      rationale: "Selected from the care-plan bank based on documented OASIS evidence.",
      confidence: 0.82,
      evidenceFactIds: ["oasis-dx-1"],
    },
    interventions: [{
      selectedText: "Assess respiratory status and report worsening symptoms.",
      bankEntryId: "intervention-respiratory-assess",
      tailoredInstruction: "Review-only suggestion grounded in OASIS facts.",
      rationale: "Selected from the retrieved care-plan candidates.",
      confidence: 0.8,
      evidenceFactIds: ["oasis-dx-1", "oasis-resp-1"],
    }],
    needsHumanReview: false,
    warnings: [],
  }],
  warnings: [],
};

const oasisDomAcquisitionQaCompleted = {
  artifactType: "oasis_dom_acquisition_state",
  acquisitionStatus: "qa_completed",
  missingRequiredSections: [],
  missingRequiredFields: [],
  readinessReasons: ["ready_for_qa"],
};

const nonBlockingOasisGate = {
  ...patientViewInput.artifactContents.oasisGate,
  status: "passed",
  blockedFromPlanOfCare: false,
  missingFieldCount: 0,
  contradictionCount: 0,
  topReasons: [],
  planOfCareAttempted: true,
  planOfCareAttemptSkippedReason: null,
};

describe("dashboardRunViews", () => {
  it("exposes running referral intake state for the patient dashboard button", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        referralIntakeState: {
          schemaVersion: "referral-intake-state.v1",
          batchId: "batch-1",
          patientId: "patient-1",
          status: "running",
          acceptedAt: "2026-04-06T20:06:00.000Z",
          startedAt: "2026-04-06T20:06:05.000Z",
          completedAt: null,
          lastCheckedAt: "2026-04-06T20:06:05.000Z",
          lastError: null,
          processedCount: 0,
          reusedCount: 0,
          newOrChangedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          documentCount: 0,
          sourceDocumentCount: 0,
          statusUrl: "/api/runs/batch-1/patients/patient-1/referral-intake/status",
          message: "Referral intake queued after the OASIS batch completed.",
        },
      },
    });

    assert.equal(detail.dashboardState.referralIntakeStatus?.status, "running");
    assert.equal(detail.dashboardState.referralIntakeStatus?.message, "Referral intake queued after the OASIS batch completed.");
    assert.equal(detail.dashboardState.referralIntakeStatus?.statusUrl, "/api/runs/batch-1/patients/patient-1/referral-intake/status");
  });

  it("loads Plan of Care review draft into patient detail payload", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomAcquisitionState: oasisDomAcquisitionQaCompleted,
        oasisGate: nonBlockingOasisGate,
        planOfCareReviewDraft,
      },
    });

    assert.equal(detail.oasisValidatedForPlanOfCare, true);
    assert.equal(detail.planOfCareReview.available, true);
    assert.equal(detail.planOfCareReview.status, "deterministic_candidate_draft");
    assert.equal(detail.planOfCareReview.sourcePriorityUsed, "oasis_fact_pack");
    assert.equal(detail.planOfCareReview.sourceType, "generated_suggestion");
    assert.equal(detail.planOfCareReview.sourceLabel, "Suggested");
    assert.equal(detail.planOfCareReview.diagnosisCount, 1);
    assert.equal(detail.planOfCareReview.draftedDiagnosisCount, 1);
    assert.equal(detail.planOfCareReview.needsReviewCount, 0);
    assert.equal(detail.planOfCareReview.llmStatus, "disabled");
    assert.equal(detail.planOfCareReview.llmTailoredDiagnosisCount, 0);
    assert.equal(detail.planOfCareReview.promptDiagnosisCount, 0);
    assert.equal(detail.planOfCareReview.draftItems[0]?.diagnosisLabel, "Pneumonia");
    assert.equal(detail.planOfCareReview.draftItems[0]?.icdCode, "J18.9");
    assert.equal(detail.planOfCareReview.draftItems[0]?.sourceLabel, "Suggested");
    assert.equal(detail.planOfCareReview.draftItems[0]?.evidenceFactCount, 2);
  });

  it("prefers portal OASIS Plan of Care groups over generated source labeling", () => {
    const portalPlanOfCareReviewDraft = {
      ...planOfCareReviewDraft,
      sourcePriorityUsed: "oasis_snapshot",
      pocSource: {
        sourceType: "oasis_portal",
        sourceLabel: "From OASIS",
        sourceHash: "portal-poc-hash",
        capturedAt: "2026-05-30T00:00:00.000Z",
      },
      diagnosisDrafts: [],
      carePlanProblemGroups: [{
        groupKey: "pt-balance-training-1",
        sourceType: "oasis_portal",
        sourceLabel: "From OASIS",
        sourceHash: "portal-poc-hash",
        capturedAt: "2026-05-30T00:00:00.000Z",
        problemTitle: "PT Balance Training",
        problemStatement: "High fall risk with functional mobility.",
        relatedDiagnoses: [],
        goals: [{
          text: "Improve TUG score to 12 seconds or better.",
          evidenceFactIds: ["portal-care-plan:1"],
          confidence: 0.92,
          needsHumanReview: false,
        }],
        interventions: [{
          text: "Standing balance exercises with narrow and wide BOS.",
          rationale: "Existing portal OASIS Plan of Care intervention.",
          evidenceFactIds: ["portal-care-plan:1"],
          confidence: 0.92,
          needsHumanReview: false,
          llmGenerated: false,
        }],
        evidenceFactIds: ["portal-care-plan:1"],
        confidence: 0.92,
        needsHumanReview: false,
        warnings: [],
      }],
      summary: {
        ...planOfCareReviewDraft.summary,
        diagnosisCount: 0,
        draftedDiagnosisCount: 1,
        carePlanProblemGroupCount: 1,
        sourcePriorityUsed: "oasis_snapshot",
      },
    };
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        planOfCareReviewDraft: portalPlanOfCareReviewDraft,
      },
    });

    assert.equal(detail.planOfCareReview.available, true);
    assert.equal(detail.planOfCareReview.sourceType, "oasis_portal");
    assert.equal(detail.planOfCareReview.sourceLabel, "From OASIS");
    assert.equal(detail.planOfCareReview.sourceHash, "portal-poc-hash");
    assert.equal(detail.planOfCareReview.draftItems.length, 0);
    assert.equal(detail.planOfCareReview.carePlanProblemGroups[0]?.sourceLabel, "From OASIS");
  });

  it("derives OASIS validation for Plan of Care from completed DOM QA when the gate is open", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomAcquisitionState: oasisDomAcquisitionQaCompleted,
        oasisGate: nonBlockingOasisGate,
      },
    });

    assert.equal(detail.oasisValidatedForPlanOfCare, true);
  });

  it("shows Plan of Care review draft before OASIS is validated", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        planOfCareReviewDraft,
      },
    });

    assert.equal(detail.oasisValidatedForPlanOfCare, false);
    assert.equal(detail.planOfCareReview.available, true);
    assert.equal(detail.planOfCareReview.status, "deterministic_candidate_draft");
    assert.equal(detail.planOfCareReview.draftItems[0]?.diagnosisLabel, "Pneumonia");
  });

  it("reports Plan of Care review unavailable when no Plan of Care artifact exists", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomAcquisitionState: oasisDomAcquisitionQaCompleted,
        oasisGate: nonBlockingOasisGate,
      },
    });

    assert.equal(detail.oasisValidatedForPlanOfCare, true);
    assert.equal(detail.planOfCareReview.available, false);
    assert.match(detail.planOfCareReview.warnings.join(" "), /not been generated yet/);
  });

  it("shows Visit Notes discovery when Plan of Care review exists before OASIS validation", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        planOfCareReviewDraft,
        visitNotesDiscovery: {
          schemaVersion: "visit-notes-discovery.v1",
          rows: [
            {
              visitNoteKey: "sn-note-1",
              visitType: "skilled_nursing",
              lifecycleStatus: "active_monitoring",
              captureStatus: "captured",
            },
            {
              visitNoteKey: "pt-note-1",
              visitType: "physical_therapy",
              lifecycleStatus: "finalized_no_active_monitoring",
              captureStatus: "pending",
            },
          ],
          counts: {
            total: 2,
            byVisitType: { skilled_nursing: 1, physical_therapy: 1 },
            byStatus: { in_progress: 1, qa_pending: 1 },
          },
        },
      },
    });

    assert.equal(detail.oasisValidatedForPlanOfCare, false);
    assert.equal(detail.planOfCareReview.available, true);
    assert.equal(detail.visitNotesReview.available, true);
    assert.equal(detail.visitNotesReview.status, "pending");
    assert.equal(detail.visitNotesReview.totalVisitNotes, 2);
    assert.equal(detail.visitNotesReview.capturedVisitNotes, 1);
    assert.equal(detail.visitNotesReview.activeMonitoringCount, 1);
    assert.equal(detail.visitNotesReview.byVisitType.skilled_nursing, 1);
    assert.doesNotMatch(detail.visitNotesReview.warnings.join(" "), /Plan of Care/);
  });

  it("shows Visit Notes QA review when Plan of Care review exists before OASIS validation", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        planOfCareReviewDraft,
        visitNoteQaReview: {
          schemaVersion: "visit-note-qa-review.v1",
          generatedAt: "2026-05-07T00:00:00.000Z",
          status: "ready",
          summary: {
            totalVisitNotes: 1,
            eligibleVisitNotes: 1,
            analyzedVisitNotes: 1,
            skippedVisitNotes: 0,
            byVisitType: { skilled_nursing: 1 },
            byStatus: { qa_completed: 1 },
            actionableFindingCount: 1,
            contradictionCount: 0,
            pocAlignmentIssueCount: 0,
            incompleteNoteCount: 0,
          },
          visitTypeCounts: [
            { visitType: "skilled_nursing", count: 1, statuses: { qa_completed: 1 } },
          ],
          findings: [{
            findingId: "finding-1",
            visitNoteKey: "sn-note-1",
            visitType: "skilled_nursing",
            visitDate: "2026-05-02",
            severity: "medium",
            category: "documentation_quality",
            title: "Visit note needs reviewer confirmation",
            description: "The note has captured QA evidence.",
            visitNoteEvidence: ["visit-note-fact-1"],
            pocEvidence: [],
            oasisEvidence: ["oasis-fact-1"],
            suggestedReviewerAction: "Confirm the documented status.",
            needsHumanReview: true,
            confidence: 0.82,
          }],
          noteSummaries: [{
            visitNoteKey: "sn-note-1",
            visitType: "skilled_nursing",
            visitDate: "2026-05-02",
            status: "qa_completed",
            lifecycleStatus: "active_monitoring",
            captureStatus: "captured",
            analyzed: true,
            analysisStatus: "ready",
            summary: "SN note documents wound assessment.",
            missingFields: [],
            alignedPocGoals: [],
            pocProblemMatches: [],
            possibleContradictions: [],
          }],
          warnings: [],
        },
      },
    });

    assert.equal(detail.oasisValidatedForPlanOfCare, false);
    assert.equal(detail.planOfCareReview.available, true);
    assert.equal(detail.visitNotesReview.available, true);
    assert.equal(detail.visitNotesReview.status, "ready");
    assert.equal(detail.visitNotesReview.totalVisitNotes, 1);
    assert.equal(detail.visitNotesReview.analyzedVisitNotes, 1);
    assert.equal(detail.visitNotesReview.findings[0]?.evidenceCount, 2);
    assert.equal(detail.visitNotesReview.noteSummaries[0]?.visitNoteKey, "sn-note-1");
  });

  it("gates Visit Notes review until Plan of Care review is available", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        visitNotesDiscovery: {
          schemaVersion: "visit-notes-discovery.v1",
          rows: [
            {
              visitNoteKey: "sn-note-1",
              visitType: "skilled_nursing",
              lifecycleStatus: "active_monitoring",
              captureStatus: "captured",
            },
          ],
          counts: {
            total: 1,
            byVisitType: { skilled_nursing: 1 },
            byStatus: { in_progress: 1 },
          },
        },
      },
    });

    assert.equal(detail.planOfCareReview.available, false);
    assert.equal(detail.visitNotesReview.available, false);
    assert.equal(detail.visitNotesReview.status, "discovery_not_run");
    assert.match(detail.visitNotesReview.warnings.join(" "), /Plan of Care review is available/);
  });

  it("suppresses non-clinical Plan of Care diagnosis draft items in patient detail payload", () => {
    const pollutedDraft = {
      ...planOfCareReviewDraft,
      summary: {
        ...planOfCareReviewDraft.summary,
        diagnosisCount: 3,
        draftedDiagnosisCount: 3,
        needsReviewCount: 2,
        missingCandidateCount: 2,
      },
      diagnosisDrafts: [
        {
          ...planOfCareReviewDraft.diagnosisDrafts[0],
          diagnosisKey: "debug-row-heuristics",
          diagnosisLabel: "Fallback to row text heuristics only when direct control selectors are absent.",
          icdCode: null,
        },
        {
          ...planOfCareReviewDraft.diagnosisDrafts[0],
          diagnosisKey: "debug-row-classification",
          diagnosisLabel: "Rows are classified as existing diagnoses vs empty editable slots vs empty readonly slots before action planning.",
          icdCode: null,
        },
        {
          ...planOfCareReviewDraft.diagnosisDrafts[0],
          diagnosisKey: "valid-pneumonia",
          diagnosisLabel: "Pneumonia",
          icdCode: "J18.9",
        },
      ],
      warnings: [
        "Skipped suspicious diagnosis candidate: Fallback to row text heuristics only when direct control selectors are absent.",
        "Diagnosis label exists without ICD code: true",
        "Filtered diagnosis-like noise: Active Diagnoses",
        "Diagnosis 7a030a98a98ca9f6 has no selected intervention.",
        "No candidate bank entries found for diagnosis 7a030a98a98ca9f6.",
        "Reviewer should confirm OASIS diagnosis source completeness.",
      ],
    };
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomAcquisitionState: oasisDomAcquisitionQaCompleted,
        oasisGate: nonBlockingOasisGate,
        planOfCareReviewDraft: pollutedDraft,
      },
    });

    assert.equal(detail.planOfCareReview.diagnosisCount, 1);
    assert.equal(detail.planOfCareReview.draftedDiagnosisCount, 1);
    assert.equal(detail.planOfCareReview.draftItems.length, 1);
    assert.equal(detail.planOfCareReview.draftItems[0]?.diagnosisLabel, "Pneumonia");
    assert.match(detail.planOfCareReview.warnings.join(" "), /Suppressed 2 non-clinical/);
    assert.match(detail.planOfCareReview.warnings.join(" "), /confirm OASIS diagnosis source completeness/);
    assert.doesNotMatch(
      JSON.stringify(detail.planOfCareReview),
      /Fallback to row text heuristics|Rows are classified|empty editable slots|without ICD code: true|Active Diagnoses|7a030a98a98ca9f6/,
    );
  });

  it("loads Visit Notes review into patient detail payload", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomAcquisitionState: oasisDomAcquisitionQaCompleted,
        oasisGate: nonBlockingOasisGate,
        planOfCareReviewDraft,
        visitNoteQaReview: {
          schemaVersion: "visit-note-qa-review.v1",
          generatedAt: "2026-05-07T00:00:00.000Z",
          status: "ready",
          summary: {
            totalVisitNotes: 3,
            eligibleVisitNotes: 1,
            analyzedVisitNotes: 2,
            skippedVisitNotes: 1,
            missedVisitNotes: 0,
            notStartedVisitNotes: 1,
            activeMonitoringCount: 1,
            qaCompleteFinalizedCount: 1,
            inProgressCount: 1,
            submittedCount: 0,
            qaPendingCount: 0,
            signedCount: 0,
            capturedVisitNotes: 1,
            reusedVisitNotes: 1,
            failedVisitNotes: 0,
            degradedVisitNotes: 0,
            cappedVisitNotes: 0,
            byVisitType: { skilled_nursing: 1, physical_therapy: 2 },
            byStatus: { qa_completed: 2, not_started: 1 },
            actionableFindingCount: 1,
            contradictionCount: 1,
            pocAlignmentIssueCount: 0,
            incompleteNoteCount: 0,
          },
          visitTypeCounts: [
            { visitType: "skilled_nursing", count: 1, statuses: { qa_completed: 1 } },
            { visitType: "physical_therapy", count: 2, statuses: { qa_completed: 1, not_started: 1 } },
          ],
          findings: [{
            findingId: "finding-1",
            visitNoteKey: "note-1",
            visitType: "physical_therapy",
            visitDate: "2026-05-02",
            severity: "high",
            category: "contradiction",
            title: "Visit note mobility conflicts with OASIS/POC mobility limitation",
            description: "Visit note suggests independent ambulation while OASIS limits mobility.",
            visitNoteEvidence: ["visit-note-fact-1"],
            pocEvidence: ["poc-goal-1"],
            oasisEvidence: ["oasis-mobility-1"],
            suggestedReviewerAction: "Confirm interval improvement before accepting the note.",
            needsHumanReview: true,
            confidence: 0.88,
          }],
          noteSummaries: [{
            visitNoteKey: "note-1",
            visitType: "physical_therapy",
            visitDate: "2026-05-02",
            status: "in_progress",
            lifecycleStatus: "active_monitoring",
            captureStatus: "captured",
            analyzed: true,
            analysisStatus: "ready",
            summary: "PT note documents gait training.",
            missingFields: [],
            alignedPocGoals: ["Improve safe transfers"],
            pocMappingResult: {
              mappingStatus: "deterministic_only",
              mappingSource: "deterministic",
              alignmentStatus: "aligned",
              matchStrength: 0.82,
              matchedPocItems: [{
                problemKey: "mobility",
                problemTitle: "Mobility limitation",
                goalTexts: ["Improve safe transfers"],
                interventionTexts: ["Skilled PT gait training"],
                evidenceIds: ["poc-goal-1"],
              }],
              visitNoteEvidence: ["visit-note-fact-1"],
              rationale: "Visit-note facts support the mobility POC intervention.",
              missingDocumentation: [],
              contradictions: [],
              pocUpdateSignals: [],
            },
            pocProblemMatches: [],
            possibleContradictions: [],
          }],
          warnings: [],
        },
      },
    });

    assert.equal(detail.visitNotesReview.available, true);
    assert.equal(detail.visitNotesReview.totalVisitNotes, 3);
    assert.equal(detail.visitNotesReview.activeMonitoringCount, 1);
    assert.equal(detail.visitNotesReview.qaCompleteFinalizedCount, 1);
    assert.equal(detail.visitNotesReview.capturedVisitNotes, 1);
    assert.equal(detail.visitNotesReview.contradictionCount, 1);
    assert.equal(detail.visitNotesReview.noteSummaries[0]?.mappingStatus, "deterministic_only");
    assert.equal(detail.visitNotesReview.noteSummaries[0]?.pocMappingResult?.matchedPocItems[0]?.problemKey, "mobility");
    assert.equal(detail.visitNotesReview.visitTypeCounts[0]?.visitType, "skilled_nursing");
    assert.equal(detail.visitNotesReview.findings[0]?.evidenceCount, 3);
  });

  it("distinguishes missing Visit Notes discovery from ordinary pending zero-count QA", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomAcquisitionState: oasisDomAcquisitionQaCompleted,
        oasisGate: nonBlockingOasisGate,
        planOfCareReviewDraft,
        visitNotesDiscovery: null,
        visitNoteQaReview: {
          schemaVersion: "visit-note-qa-review.v1",
          generatedAt: "2026-05-07T00:00:00.000Z",
          status: "pending",
          summary: {
            totalVisitNotes: 0,
            analyzedVisitNotes: 0,
            skippedVisitNotes: 0,
            byVisitType: {},
            byStatus: {},
            actionableFindingCount: 0,
            contradictionCount: 0,
            pocAlignmentIssueCount: 0,
            incompleteNoteCount: 0,
          },
          visitTypeCounts: [],
          findings: [],
          noteSummaries: [],
          warnings: [],
        },
      },
    });

    assert.equal(detail.visitNotesReview.status, "discovery_missing");
    assert.match(detail.visitNotesReview.warnings.join(" "), /discovery artifact is missing/);
  });

  it("does not render fact-pack metadata strings as diagnosis names", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        codingInput: null,
        documentFactPack: null,
        printedNoteChartValues: null,
        qaPrefetch: null,
        referralDiagnosisExtraction: null,
        oasisDiagnosisExtraction: null,
        sourceClinicalFactPack: {
          schemaVersion: "clinical-fact-pack.v1",
          facts: [
            {
              factId: "source-noise-1",
              category: "diagnosis",
              label: "Diagnosis Candidates",
              normalizedValue: "active_diagnoses; diagnosis_candidates; needs_coding_review; high; low",
              sourceType: "referral",
              evidence: [{ artifactPath: "source-clinical-fact-pack.json" }],
              confidence: 0.86,
            },
          ],
        },
        oasisClinicalFactPack: {
          schemaVersion: "clinical-fact-pack.v1",
          facts: [
            {
              factId: "oasis-noise-1",
              category: "diagnosis",
              label: "Diagnosis Supporting Evidence",
              normalizedValue: "diagnosis_supporting_evidence",
              sourceType: "oasis",
              evidence: [{ artifactPath: "oasis-clinical-fact-pack.json" }],
              confidence: 0.86,
            },
          ],
        },
      },
    });

    assert.equal(detail.referralDiagnosisSummary.diagnosisSource, "no_usable_referral_diagnosis_fact");
    assert.equal(detail.oasisDiagnosisSummary.diagnosisSource, "no_usable_oasis_diagnosis_fact");
    assert.equal(detail.referralDiagnosisSummary.primaryDiagnosis, null);
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis, null);
    assert.doesNotMatch(JSON.stringify(detail), /active_diagnoses|diagnosis_candidates|needs_coding_review/);
  });

  it("loads OASIS and referral documentation review summaries into patient detail payload", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        documentCatalog: {
          schemaVersion: "document-catalog.v1",
          documentCount: 2,
          documents: [{ documentKey: "doc-referral" }, { documentKey: "doc-upload" }],
        },
        documentText: {
          schemaVersion: "document-text.v1",
          documents: [{ documentKey: "doc-referral" }],
        },
        oasisClinicalFactPack: {
          schemaVersion: "clinical-fact-pack.v1",
          facts: [
            {
              factId: "oasis-dx-1",
              category: "diagnosis",
              label: "Primary diagnosis",
              normalizedValue: "pneumonia unspecified organism",
              sourceType: "oasis",
              evidence: [{ artifactPath: "oasis-clinical-fact-pack.json" }],
              confidence: 0.9,
            },
            {
              factId: "oasis-icd-1",
              category: "icd_code",
              label: "Primary diagnosis ICD",
              normalizedValue: "J18.9",
              sourceType: "oasis",
              evidence: [{ artifactPath: "oasis-clinical-fact-pack.json" }],
              confidence: 0.9,
            },
            {
              factId: "oasis-resp-1",
              category: "respiratory",
              label: "Respiratory status",
              normalizedValue: "respiratory monitoring indicated",
              sourceType: "oasis",
              evidence: [{ artifactPath: "oasis-printed-note-review.json" }],
              confidence: 0.78,
            },
          ],
        },
        oasisDiagnosisExtraction: {
          schemaVersion: "oasis-diagnosis-extraction.v1",
          diagnosisCount: 2,
          primaryDiagnosisCount: 1,
          secondaryDiagnosisCount: 1,
          diagnoses: [
            {
              label: "Pneumonia, unspecified organism",
              icdCode: "J18.9",
              rank: 1,
              isPrimary: true,
              sourceArtifactPath: "oasis-diagnosis-extraction.json",
              sourceSection: "oasis_pdf_diagnosis_table",
              confidence: 0.9,
            },
            {
              label: "Heart failure, unspecified",
              icdCode: "I50.9",
              rank: 2,
              isPrimary: false,
              sourceArtifactPath: "oasis-diagnosis-extraction.json",
              sourceSection: "oasis_pdf_diagnosis_table",
              confidence: 0.9,
            },
          ],
        },
        sourceClinicalFactPack: {
          schemaVersion: "clinical-fact-pack.v1",
          facts: [
            {
              factId: "source-dx-1",
              category: "diagnosis",
              label: "Source diagnosis",
              normalizedValue: "pneumonia unspecified organism",
              sourceType: "referral",
              evidence: [{ artifactPath: "referral-document-processing/extracted-facts.json" }],
              confidence: 0.84,
            },
            {
              factId: "source-skill-1",
              category: "skilled_need",
              label: "Skilled need",
              normalizedValue: "skilled nursing monitoring",
              sourceType: "referral",
              evidence: [{ artifactPath: "source-clinical-fact-pack.json" }],
              confidence: 0.8,
            },
          ],
        },
        referralDiagnosisExtraction: {
          schemaVersion: "referral-diagnosis-extraction.v1",
          diagnosisCount: 2,
          primaryDiagnosisCount: 1,
          secondaryDiagnosisCount: 1,
          diagnoses: [
            {
              label: "Pneumonia, unspecified organism",
              icdCode: "J18.9",
              rank: 1,
              isPrimary: true,
              sourceArtifactPath: "referral-diagnosis-extraction.json",
              sourceSection: "referral_diagnosis_table",
              confidence: 0.9,
            },
            {
              label: "Difficulty walking",
              icdCode: "R26.2",
              rank: 2,
              isPrimary: false,
              sourceArtifactPath: "referral-diagnosis-extraction.json",
              sourceSection: "referral_diagnosis_table",
              confidence: 0.9,
            },
          ],
        },
        diagnosisReconciliation: {
          schemaVersion: "diagnosis-reconciliation.v1",
          referralDiagnosisCount: 2,
          oasisDiagnosisCount: 2,
          matchedCount: 1,
          missingInOasisCount: 1,
          missingInReferralCount: 1,
          codeMismatchCount: 0,
          labelMismatchCount: 0,
          rankMismatchCount: 0,
          rows: [],
          warnings: [],
        },
        oasisExtractionCoverageReport: {
          schemaVersion: "oasis-extraction-coverage-report.v1",
          summary: {
            coveredCount: 2,
            partialCount: 1,
            missingCount: 0,
            unknownCount: 0,
          },
        },
      },
    });

    assert.equal(detail.oasisDocumentationReview.available, true);
    assert.equal(detail.oasisDocumentationReview.factCount, 3);
    assert.equal(detail.oasisDocumentationReview.diagnosisCount, 2);
    assert.equal(detail.oasisDocumentationReview.icdCodeCount, 2);
    assert.equal(detail.oasisDocumentationReview.factCategories.includes("respiratory"), true);
    assert.equal(
      detail.oasisDocumentationReview.artifactPaths.includes("oasis-clinical-fact-pack.json"),
      true,
    );
    assert.equal(
      detail.oasisDocumentationReview.artifactPaths.includes("oasis-extraction-coverage-report.json"),
      true,
    );
    assert.equal(
      detail.oasisDocumentationReview.artifactPaths.includes("oasis-diagnosis-extraction.json"),
      true,
    );
    assert.equal(detail.oasisDocumentationReview.note, null);
    assert.equal(detail.referralDocumentationReview.available, true);
    assert.equal(detail.referralDocumentationReview.factCount, 2);
    assert.equal(detail.referralDocumentationReview.diagnosisCount, 2);
    assert.equal(detail.referralDocumentationReview.icdCodeCount, 2);
    assert.equal(
      detail.referralDocumentationReview.artifactPaths.includes("source-clinical-fact-pack.json"),
      true,
    );
    assert.equal(
      detail.referralDocumentationReview.artifactPaths.includes("document-catalog.json"),
      true,
    );
    assert.equal(
      detail.referralDocumentationReview.artifactPaths.includes("referral-diagnosis-extraction.json"),
      true,
    );
    assert.equal(detail.diagnosisReconciliationReview.available, true);
    assert.equal(detail.diagnosisReconciliationReview.oasisDiagnosisCount, 2);
    assert.equal(detail.diagnosisReconciliationReview.referralDiagnosisCount, 2);
    assert.equal(detail.diagnosisReconciliationReview.matchedCount, 1);
    assert.equal(detail.diagnosisReconciliationReview.missingInOasisCount, 1);
    assert.equal(detail.diagnosisReconciliationReview.missingInReferralCount, 1);
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[0]?.code, "I50.9");
    assert.equal(detail.referralDiagnosisSummary.otherDiagnoses[0]?.code, "R26.2");
  });

  it("exposes all OASIS diagnosis extraction entries in patient detail payload", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDiagnosisExtraction: {
          schemaVersion: "oasis-diagnosis-extraction.v1",
          diagnosisCount: 4,
          primaryDiagnosisCount: 1,
          secondaryDiagnosisCount: 3,
          diagnoses: [
            {
              label: "Encounter for other orthopedic aftercare",
              icdCode: "Z47.89",
              normalizedIcd10Code: "Z47.89",
              rank: 1,
              role: "primary",
              slotLabel: "PRIMARY DIAGNOSIS",
              onsetDate: "05/12/2026",
              group: "MS_REHAB",
              isPrimary: true,
              sourceSection: "oasis_pdf_diagnosis_table",
              confidence: 0.9,
            },
            {
              label: "Lumbago with sciatica, right side",
              icdCode: "M54.41",
              normalizedIcd10Code: "M54.41",
              rank: 2,
              role: "secondary",
              slotLabel: "OTHER DIAGNOSIS - 1",
              onsetDate: "05/12/2026",
              group: "No_group",
              isPrimary: false,
              sourceSection: "oasis_pdf_diagnosis_table",
              confidence: 0.9,
            },
            {
              label: "Essential (primary) hypertension",
              icdCode: "I10",
              normalizedIcd10Code: "I10",
              rank: 3,
              role: "secondary",
              slotLabel: "OTHER DIAGNOSIS - 2",
              onsetDate: "05/12/2026",
              group: "No_group",
              isPrimary: false,
              sourceSection: "oasis_pdf_diagnosis_table",
              confidence: 0.9,
            },
            {
              label: "Anxiety disorder, unspecified",
              icdCode: "F41.9",
              normalizedIcd10Code: "F41.9",
              rank: 4,
              role: "secondary",
              slotLabel: "OTHER DIAGNOSIS - 3",
              onsetDate: "05/12/2026",
              group: "Behavioral_5",
              isPrimary: false,
              sourceSection: "oasis_pdf_diagnosis_table",
              confidence: 0.9,
            },
          ],
        },
      },
    });

    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.code, "Z47.89");
    assert.deepEqual(
      detail.oasisDiagnosisSummary.otherDiagnoses.map((diagnosis) => diagnosis.code),
      ["M54.41", "I10", "F41.9"],
    );
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[0]?.group, "No_group");
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[1]?.onsetDate, "05/12/2026");
  });

  it("keeps Visit Notes and OASIS document text out of referral documentation review counts", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        documentCatalog: {
          documentCount: 3,
          documents: [
            { normalizedType: "referral", displayName: "Referral Packet.pdf" },
            { normalizedType: "visit_note", displayName: "SN Visit Note" },
            { normalizedType: "oasis", displayName: "OASIS Assessment" },
          ],
        },
        documentText: {
          documents: [
            {
              type: "ORDER",
              portalLabel: "Referral Packet.pdf",
              sourcePath: "patient/documents/uploads/referral/source.pdf",
              text: "Patient requires skilled nursing.",
            },
            {
              type: "VISIT_NOTE",
              portalLabel: "SN Visit Note",
              sourcePath: "patient/documents/visit-notes/sn/source.txt",
              text: "Visit note documents wound care.",
            },
            {
              type: "OASIS",
              portalLabel: "OASIS Assessment",
              sourcePath: "patient/documents/uploads/oasis/source.pdf",
              text: "OASIS documents page false false false.",
            },
          ],
        },
        sourceClinicalFactPack: {
          schemaVersion: "clinical-fact-pack.v1",
          facts: [
            {
              factId: "source-skill-1",
              category: "skilled_need",
              label: "Skilled need",
              normalizedValue: "skilled nursing",
              sourceType: "referral",
              evidence: [{ artifactPath: "source-clinical-fact-pack.json" }],
              confidence: 0.8,
            },
            {
              factId: "visit-note-1",
              category: "wound",
              label: "Wound",
              normalizedValue: "visit note wound care",
              sourceType: "visit_note",
              evidence: [{ artifactPath: "visit-note-fact-pack.json" }],
              confidence: 0.8,
            },
            {
              factId: "oasis-1",
              category: "fall_risk",
              label: "Fall risk",
              normalizedValue: "oasis fall risk",
              sourceType: "oasis",
              evidence: [{ artifactPath: "oasis-clinical-fact-pack.json" }],
              confidence: 0.8,
            },
          ],
        },
      },
    });

    const summaryByLabel = new Map(detail.referralDocumentationReview.summaryItems.map((item) => [item.label, item.value]));
    assert.equal(summaryByLabel.get("Catalog Documents"), "1");
    assert.equal(summaryByLabel.get("Document Text Entries"), "1");
    assert.equal(detail.referralDocumentationReview.factCount, 1);
    assert.deepEqual(detail.referralDocumentationReview.factCategories, ["skilled_need"]);
  });

  it("falls back to clinical fact packs for diagnosis summaries when extraction artifacts are unavailable", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        codingInput: {},
        documentFactPack: null,
        printedNoteChartValues: { currentChartValues: {} },
        qaPrefetch: {
          ...patientViewInput.artifactContents.qaPrefetch,
          diagnosisRoute: { found: true, visibleDiagnoses: [] },
        },
        referralDiagnosisExtraction: null,
        oasisDiagnosisExtraction: null,
        sourceClinicalFactPack: {
          facts: [
            {
              category: "diagnosis",
              normalizedValue: "Pneumonia, unspecified organism",
              sourceType: "referral",
              confidence: 0.91,
            },
            {
              category: "icd_code",
              normalizedValue: "J18.9",
              sourceType: "referral",
              confidence: 0.91,
            },
          ],
        },
        oasisClinicalFactPack: {
          facts: [
            {
              category: "diagnosis",
              normalizedValue: "Heart failure, unspecified",
              sourceType: "oasis",
              confidence: 0.84,
            },
            {
              category: "icd_code",
              normalizedValue: "I50.9",
              sourceType: "oasis",
              confidence: 0.84,
            },
          ],
        },
      },
    });

    assert.equal(detail.referralDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(detail.referralDiagnosisSummary.primaryDiagnosis?.description, "Pneumonia, unspecified organism");
    assert.equal(detail.referralDiagnosisSummary.diagnosisSource, "source_clinical_fact_pack");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.code, "I50.9");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.description, "Heart failure, unspecified");
    assert.equal(detail.oasisDiagnosisSummary.diagnosisSource, "oasis_clinical_fact_pack");
    assert.equal(detail.diagnosisComparisonStatus, "conflict");
  });

  it("enriches code-only OASIS diagnoses from OASIS printed-note evidence", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDiagnosisExtraction: {
          diagnoses: [
            { code: "R13.10", onsetDate: "2026-02-27" },
            { code: "I11.0", onsetDate: "2026-02-27" },
            { code: "I50.9", onsetDate: "2026-02-27" },
          ],
        },
        printedNoteChartValues: {
          currentChartValues: {
            primary_diagnosis: "R13.10 - Dysphagia, unspecified",
            secondary_diagnoses: [
              "I11.0 - Hypertensive heart disease with heart",
              "I50.9 - Heart failure, unspecified",
            ],
          },
        },
        oasisClinicalFactPack: {
          facts: [
            {
              category: "diagnosis",
              rawValue: "R13.10 Dysphagia, unspecified",
              normalizedValue: "Dysphagia, unspecified",
              sourceType: "oasis",
              evidence: [{ snippet: "R13.10 Dysphagia, unspecified" }],
            },
          ],
        },
      },
    });

    assert.equal(detail.oasisDiagnosisSummary.diagnosisSource, "qa_visible_diagnoses");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.code, "R13.10");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.description, "Dysphagia, unspecified");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.onsetDate, "2026-02-27");
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[0]?.code, "I11.0");
    assert.equal(
      detail.oasisDiagnosisSummary.otherDiagnoses[0]?.description,
      "Hypertensive heart disease with heart",
    );
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[1]?.code, "I50.9");
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[1]?.description, "Heart failure, unspecified");
  });

  it("enriches code-only OASIS diagnoses from active diagnosis DOM description rows", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        printedNoteChartValues: null,
        oasisClinicalFactPack: null,
        oasisDiagnosisExtraction: {
          diagnoses: [
            { code: "R13.10", onsetDate: "2026-02-27" },
            { code: "I11.0", onsetDate: "2026-02-27" },
          ],
        },
        oasisDomSectionOutputs: {
          schemaVersion: "oasis-dom-section-outputs.v1",
          sections: [{
            sectionKey: "active_diagnoses",
            label: "Active Diagnoses",
            rows: [
              { label: "(M1021) ICD-10 Code", value: "R13.10" },
              { label: "(M1021/1023) Diagnoses and Symptom Control", value: "Dysphagia, unspecified" },
              { label: "(M1023) ICD-10 Code", value: "I11.0" },
              { label: "(M1021/1023) Diagnoses and Symptom Control", value: "Hypertensive heart disease with heart failure" },
            ],
          }],
        },
      },
    });

    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.code, "R13.10");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.description, "Dysphagia, unspecified");
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[0]?.code, "I11.0");
    assert.equal(
      detail.oasisDiagnosisSummary.otherDiagnoses[0]?.description,
      "Hypertensive heart disease with heart failure",
    );
  });

  it("does not render portal page-state diagnostics as referral clinical evidence", () => {
    const badPortalText = "OASIS documents page false false false false false false 0 none 0 high:0 medium:0 low:0 false false true false true https://app.finalehealth.com/patient/documents /data/control-plane/batches/x";
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalComparisonRows: [{
          fieldKey: "allergy_list",
          category: "Medication & Allergies",
          referralValue: badPortalText,
          oasisValue: null,
          verdict: "missing_in_oasis",
          confidence: 0.82,
          severity: "medium",
          rationale: badPortalText,
          referralEvidence: [{
            artifact: "source-clinical-fact-pack.json",
            sourceType: "SOURCE_FACT_PACK",
            sourceLabel: "medication fact-pack evidence",
            snippet: badPortalText,
            confidence: 0.78,
          }],
          oasisEvidence: [],
          needsReview: true,
          sources: {
            referralArtifacts: ["source-clinical-fact-pack.json"],
            oasisArtifacts: [],
          },
        }],
        comparisonRowsStatus: "ready",
      },
    });

    const row = detail.dashboardState.rows[0];
    assert.ok(row);
    assert.equal(row.displayReferralValue, "No reliable referral value extracted");
    assert.equal(row.referralSnippet, null);
    assert.equal(row.evidence.length, 0);
    assert.equal(row.shortReason, "Comparison row requires reviewer confirmation.");
  });

  it("loads clinical contradiction analysis into patient detail review payload", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalContradictionAnalysis: actionableClinicalContradictionAnalysis,
        artifactLineage: clinicalLineage,
      },
    });

    assert.equal(detail.clinicalDiscrepancyReview.available, true);
    assert.equal(
      detail.clinicalDiscrepancyReview.reviewerQueueInterpretation,
      "actionable_discrepancies_detected",
    );
    assert.equal(detail.clinicalDiscrepancyReview.totalFindings, 2);
    assert.equal(detail.clinicalDiscrepancyReview.reviewerVisibleCount, 1);
    assert.equal(detail.clinicalDiscrepancyReview.suppressedCount, 1);
    assert.equal(detail.clinicalDiscrepancyReview.reviewerQueueCount, 1);
    assert.equal(detail.clinicalDiscrepancyReview.highPriorityCount, 1);
    assert.equal(detail.clinicalDiscrepancyReview.sourceFactCount, 177);
    assert.equal(detail.clinicalDiscrepancyReview.oasisFactCount, 72);
    assert.equal(detail.clinicalDiscrepancyReview.clinicalContradictionAnalysisHash, "eb3122dc0000");
    assert.equal(detail.clinicalDiscrepancyReview.reviewerQueue[0]?.priority, "high");
    assert.equal(detail.clinicalDiscrepancyReview.reviewerQueue[0]?.sourceFactIds[0], "src-cog");
  });

  it("handles missing clinical contradiction artifact for older runs", () => {
    const detail = toDashboardPatientDetail(patientViewInput);

    assert.equal(detail.clinicalDiscrepancyReview.available, false);
    assert.equal(detail.clinicalDiscrepancyReview.reviewerQueueInterpretation, "not_available");
    assert.deepEqual(detail.clinicalDiscrepancyReview.reviewerQueue, []);
  });

  it("preserves empty reviewer queue as no-actionable clinical discrepancy state", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalContradictionAnalysis: {
          ...actionableClinicalContradictionAnalysis,
          findingCount: 67,
          reviewerVisibleCount: 0,
          suppressedCount: 67,
          reviewerQueueInterpretation: "no_actionable_discrepancies_detected",
          reviewerQueue: [],
          summary: {
            ...actionableClinicalContradictionAnalysis.summary,
            totalFindings: 67,
            reviewerVisibleCount: 0,
            suppressedCount: 67,
            highPriorityCount: 0,
          },
        },
        artifactLineage: clinicalLineage,
      },
    });

    assert.equal(
      detail.clinicalDiscrepancyReview.reviewerQueueInterpretation,
      "no_actionable_discrepancies_detected",
    );
    assert.equal(detail.clinicalDiscrepancyReview.reviewerQueueCount, 0);
    assert.equal(detail.clinicalDiscrepancyReview.totalFindings, 67);
    assert.equal(detail.clinicalDiscrepancyReview.suppressedCount, 67);
  });

  it("does not include suppressed contradiction findings in reviewer queue", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalContradictionAnalysis: actionableClinicalContradictionAnalysis,
        artifactLineage: clinicalLineage,
      },
    });

    assert.equal(detail.clinicalDiscrepancyReview.reviewerQueue.length, 1);
    assert.equal(
      detail.clinicalDiscrepancyReview.reviewerQueue.some((finding) =>
        finding.findingId === "finding-suppressed"),
      false,
    );
    assert.deepEqual(detail.clinicalDiscrepancyReview.topSuppressionReasons, [
      "low_confidence_source_fact",
      "none",
    ]);
  });

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
    assert.equal(summary.diagnosisSource, "coding_input");
    assert.equal(summary.diagnosisComparisonStatus, "partial_overlap");
    assert.equal(summary.referralDiagnosisSummary.diagnosisSource, "coding_input");
    assert.equal(summary.referralDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.oasisDiagnosisSummary.diagnosisSource, "qa_visible_diagnoses");
    assert.equal(summary.oasisDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.subsidiaryId, "default");
    assert.equal(summary.subsidiaryName, "Default Subsidiary");
    assert.equal(summary.otherDiagnoses.length, 1);
    assert.equal(summary.codingWorkflow?.status, "COMPLETED");
    assert.equal(summary.qaWorkflow?.status, "COMPLETED");
    assert.equal(summary.qaPrefetch?.lockStatus, "locked");
    assert.equal(summary.qaPrefetch?.oasisAssessmentPrimaryStatus, "VALIDATED");
    assert.deepEqual(summary.qaPrefetch?.oasisAssessmentStatuses, ["SIGNED", "VALIDATED"]);
    assert.equal(summary.qaPrefetch?.oasisAssessmentDecision, "PROCESS");
    assert.equal(summary.qaPrefetch?.oasisAssessmentProcessingEligible, true);
    assert.equal(summary.qaPrefetch?.oasisFound, true);
    assert.equal(summary.qaPrefetch?.diagnosisFound, true);
    assert.equal(summary.qaPrefetch?.selectedEpisodeRange, "03/01/2026 - 04/29/2026");
    assert.equal(summary.qaPrefetch?.first30TotalCards, 3);
    assert.equal(summary.qaPrefetch?.second30TotalCards, 2);
    assert.equal(summary.qaPrefetch?.first30WorkbookColumns.sn, "SN - 1");
    assert.equal(summary.qaPrefetch?.second30WorkbookColumns.ptOtSt, "PT - 1");
    assert.equal(summary.qaPrefetch?.printedNoteStatus, null);
    assert.equal(summary.qaPrefetch?.printedNoteAssessmentType, null);
    assert.equal(summary.qaPrefetch?.printedNoteCompletedSectionCount, 0);
    assert.equal(summary.qaPrefetch?.printedNoteIncompleteSectionCount, 0);
    assert.equal(summary.qaPrefetch?.printedNotePrintButtonDetected, false);
    assert.equal(summary.qaPrefetch?.printedNoteTextLength, 0);
    assert.equal(summary.oasisValidation?.status, "validated_with_gaps");
    assert.equal(summary.oasisValidation?.missingFieldCount, 2);
    assert.equal(summary.referralOasisConsistency?.blockingFindingCount, 1);
    assert.equal(summary.oasisGate?.status, "failed_both");
    assert.equal(summary.oasisGate?.blockedFromPlanOfCare, true);
    assert.equal(summary.generatedPlanOfCare?.status, "skipped_oasis_gate");
    assert.equal(summary.generatedPlanOfCareStatus, "skipped_oasis_gate");
    assert.equal(summary.reviewerDiagnostics?.diagnosisExtraction.status, "llm_succeeded");
    assert.equal(summary.reviewerDiagnostics?.diagnosisExtraction.modelId, "amazon.nova-pro-v1:0");
    assert.equal(summary.reviewerDiagnostics?.referralProposal.status, "fallback_used");
    assert.equal(summary.reviewerDiagnostics?.referralQaInsights.status, "fallback_used");
    assert.equal(summary.reviewerDiagnostics?.planOfCareGeneration.status, "llm_succeeded");
    assert.equal(summary.referralQa.referralDataAvailable, true);
    assert.equal(summary.referralQa.extractionUsabilityStatus, "usable");
    assert.equal(summary.referralQa.discrepancyRating, "yellow");
    assert.equal(summary.referralQa.discrepancyCounts.total, 1);
    assert.equal(summary.dashboardReview.severity, "red");
    assert.equal(summary.dashboardReview.openRowCount, 1);
    assert.equal(summary.dashboardReview.highPriorityOpenCount, 1);
    assert.equal(summary.dashboardReview.resolvedCount, 0);
    assert.equal(summary.referralQa.sections.length, 1);
    assert.equal(summary.referralQa.preAuditFindings.length, 1);
    assert.equal(summary.referralQa.sourceHighlights.length > 0, true);
    assert.equal(summary.referralQa.draftNarratives.length > 0, true);
    assert.equal(summary.referralQa.consistencyChecks[0]?.id, "respiratory-vs-m1400");
  });

  it("does not display Plan of Care narrative text as a referral diagnosis", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        codingInput: null,
        documentFactPack: {
          factPack: {
            diagnoses: [
              {
                description:
                  "Plan of care diagnosis list includes and . Goals and interventions reviewed. Visit frequency is SN 2W4.",
                source: "document_fact_pack",
              },
              {
                code: "J18.9",
                description: "PNEUMONIA, UNSPECIFIED ORGANISM",
              },
            ],
          },
        },
      },
    });

    assert.equal(summary.referralDiagnosisSummary.diagnosisSource, "document_fact_pack");
    assert.equal(summary.referralDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.doesNotMatch(
      summary.referralDiagnosisSummary.primaryDiagnosis?.description ?? "",
      /plan of care diagnosis list|visit frequency/i,
    );
  });

  it("suppresses referral diagnosis and medication facts when referral extraction is rejected", () => {
    const rejectedPatientQaReference: PatientQaReference = {
      ...patientQaReference,
      fieldRegistry: [
        ...patientQaReference.fieldRegistry,
        {
          fieldKey: "primary_diagnosis",
          label: "Primary Diagnosis",
          groupKey: "diagnosis_and_coding",
          sectionKey: "active_diagnoses",
          oasisItemId: "M1021",
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
          fieldKeys: ["primary_diagnosis"],
          textSpans: [],
        },
      ],
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        primary_diagnosis: {
          fieldKey: "primary_diagnosis",
          label: "Primary Diagnosis",
          groupKey: "diagnosis_and_coding",
          qaPriority: "critical",
          currentChartValue: null,
          documentSupportedValue: "Z69 lm UUgkk( A--M nomcOP 4HKr/ 3pQ,9 w051UW auUcm ZDbJHd",
          comparisonStatus: "missing_in_chart",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
          sourceEvidence: [],
          requiresHumanReview: true,
        },
      },
      qaReviewQueue: [
        ...patientQaReference.qaReviewQueue,
        {
          fieldKey: "primary_diagnosis",
          groupKey: "diagnosis_and_coding",
          sectionKey: "active_diagnoses",
          qaPriority: "critical",
          comparisonStatus: "missing_in_chart",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
        },
      ],
    };

    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        qaDocumentSummary: {
          extractionUsabilityStatus: "rejected",
          warnings: ["Extraction quality rejected: pdf_structure_text, ocr_retry_recommended"],
        },
        referralExtractedFacts: {
          diagnosis_candidates: [
            {
              code: "Z69",
              description: "lm UUgkk( A--M nomcOP 4HKr/ 3pQ,9 w051UW auUcm ZDbJHd",
              is_primary_candidate: true,
            },
          ],
        },
        codingInput: {
          primaryDiagnosis: {
            code: "Z69",
            description: "lm UUgkk( A--M nomcOP 4HKr/ 3pQ,9 w051UW auUcm ZDbJHd",
          },
        },
        documentFactPack: {
          factPack: {
            diagnoses: [
              {
                code: "Z69",
                description: "lm UUgkk( A--M nomcOP 4HKr/ 3pQ,9 w051UW auUcm ZDbJHd",
              },
            ],
            medications: [
              {
                name: "Tzvndtttl Pgtl Vw Ry Z0 Oltuuuvv Raa1Jc11Q Paqal Zaiaai",
                dose: "3g",
              },
            ],
          },
        },
        sourceClinicalFactPack: {
          facts: [
            { category: "diagnosis", normalizedValue: "lm UUgkk( A--M nomcOP" },
          ],
        },
        patientQaReference: rejectedPatientQaReference,
      },
    });
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        qaDocumentSummary: {
          extractionUsabilityStatus: "rejected",
          warnings: ["Extraction quality rejected: pdf_structure_text, ocr_retry_recommended"],
        },
        patientQaReference: rejectedPatientQaReference,
      },
    });

    assert.equal(summary.referralDiagnosisSummary.primaryDiagnosis, null);
    assert.equal(summary.referralDiagnosisSummary.otherDiagnoses.length, 0);
    assert.equal(summary.referralDiagnosisSummary.diagnosisSource, null);
    assert.equal(summary.referralMedicationSummary, null);
    assert.notEqual(summary.oasisDiagnosisSummary.primaryDiagnosis, null);
    assert.equal(
      detail.dashboardState.rows.find((row) => row.fieldKey === "primary_diagnosis")?.displayReferralValue,
      "No reliable referral value extracted",
    );
  });

  it("keeps OASIS medication table values aligned when optional cells are blank", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomExtractedState: {
          sections: [{
            title: "Medication & Allergies (Injectable Medications)",
            fields: [],
            tables: [{
              headers: ["Medication Name", "Strength / Dose", "Route", "Classification", "Start Date", "Status"],
              rows: [
                ["Medication Name", "Strength / Dose", "Route", "Classification", "Start Date", "Status"],
                ["Metformin", "500 mg", "", "Antidiabetic", "05/01/2026", "Active"],
                ["Furosemide", "", "Oral", "Diuretic", "", "Active"],
              ],
            }],
          }],
        },
      },
    });

    assert.deepEqual(summary.oasisMedicationSummary?.medications.map((entry) => ({
      name: entry.name,
      dose: entry.dose,
      route: entry.route,
      classification: entry.classification,
      startDate: entry.startDate,
      status: entry.status,
    })), [
      {
        name: "Metformin",
        dose: "500 mg",
        route: null,
        classification: "Antidiabetic",
        startDate: "05/01/2026",
        status: "Active",
      },
      {
        name: "Furosemide",
        dose: null,
        route: "Oral",
        classification: "Diuretic",
        startDate: null,
        status: "Active",
      },
    ]);
  });

  it("realigns OASIS medication rows with a leading blank cell before parsing medications", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomExtractedState: {
          sections: [{
            title: "Medication & Allergies (Injectable Medications)",
            fields: [],
            tables: [{
              headers: [
                "Start Date",
                "Medication",
                "Strength / Dosage / Frequency",
                "Route",
                "Classification/Indication",
                "Status",
              ],
              rows: [
                ["", "Start Date", "Medication", "Strength / Dosage / Frequency", "Route", "Classification/Indication", "Status"],
                ["", "05/09/2026", "Tamsulosin (Oral Pill)", "0.4 mg 2 Cap Once a day", "By mouth", "ALPHA BLOCKERS/RELATED /", "New"],
                ["", "05/09/2026", "oxyCODONE (Oral Pill)", "10 mg 1 Tab Q4-6 H PRN", "By mouth", "OPIOID ANALGESICS /", "New"],
              ],
            }],
          }],
        },
      },
    });

    assert.deepEqual(summary.oasisMedicationSummary?.medications.map((entry) => ({
      name: entry.name,
      dose: entry.dose,
      route: entry.route,
      classification: entry.classification,
      startDate: entry.startDate,
      status: entry.status,
    })), [
      {
        name: "Tamsulosin (Oral Pill)",
        dose: "0.4 mg 2 Cap once a day",
        route: "By mouth",
        classification: "ALPHA BLOCKERS/RELATED /",
        startDate: "05/09/2026",
        status: "New",
      },
      {
        name: "Oxycodone (Oral Pill)",
        dose: "10 mg 1 Tab Q4-6 H PRN",
        route: "By mouth",
        classification: "OPIOID ANALGESICS /",
        startDate: "05/09/2026",
        status: "New",
      },
    ]);
  });

  it("attaches current OASIS summaries to the synthesized current-oasis source", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomExtractedState: {
          sections: [{
            title: "Medication & Allergies (Injectable Medications)",
            fields: [],
            tables: [{
              headers: ["Medication Name", "Strength / Dose", "Route", "Classification", "Start Date", "Status"],
              rows: [
                ["Medication Name", "Strength / Dose", "Route", "Classification", "Start Date", "Status"],
                ["Metformin", "500 mg", "Oral", "Antidiabetic", "05/01/2026", "Active"],
              ],
            }],
          }],
        },
      },
    });

    const currentOasis = detail.dashboardState.referralOasisSources?.oasisAssessments.find(
      (assessment) => assessment.id === "current-oasis",
    );
    assert.equal(currentOasis?.medicationSummary?.medications[0]?.name, "Metformin");
    assert.equal(currentOasis?.medicationSummary?.medications[0]?.dose, "500 mg");
  });

  it("uses OASIS DOM section outputs for comparison fallback rows without leaking Plan of Care", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          generatedAt: "2026-04-11T00:00:00.000Z",
          fields: [],
        },
        oasisDomExtractedState: {
          sections: [{
            title: "Safety Risk Assessment",
            status: "success",
            fields: [{
              label: "Living Situation",
              key: "living_situation",
              value: "Raw DOM value that should be secondary",
              sourceKind: "input",
              confidence: "high",
            }],
            tables: [],
          }],
          coverage: {
            sectionCount: 1,
            fieldCount: 1,
            nonEmptyFieldCount: 1,
            tableCount: 0,
            confidence: "high",
            fallbackRecommended: false,
            fallbackReasons: [],
          },
          diagnostics: {
            inputSource: "dom_state_primary",
            ocrUsed: false,
            pdfCaptureUsed: false,
          },
          contentHash: "dom-hash",
        },
        oasisDomSectionOutputs: {
          schemaVersion: "oasis-dom-section-outputs.v1",
          sections: [
            {
              sectionKey: "safety_social_support",
              label: "Safety / Social Support",
              rows: [{
                label: "Living Situation",
                value: "Lives alone",
                meta: null,
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Safety Risk Assessment",
                sourceItemCode: null,
              }],
            },
            {
              sectionKey: "plan_of_care",
              label: "Plan of Care",
              rows: [{
                label: "Goal",
                value: "Improve TUG score to 12 seconds.",
                meta: null,
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Plan of Care",
                sourceItemCode: null,
              }],
            },
          ],
          summary: {
            totalSections: 2,
            processedSections: 1,
            reusedSections: 1,
          },
        },
      },
    });

    const rowValues = detail.dashboardState.rows.map((row) => row.displayPortalValue);
    assert.ok(rowValues.includes("Lives alone"));
    assert.ok(!rowValues.includes("Raw DOM value that should be secondary"));
    assert.ok(!rowValues.includes("Improve TUG score to 12 seconds."));
    assert.ok(
      detail.dashboardState.rows.some((row) => row.sourceArtifacts.includes("oasis-dom-section-outputs.json")),
    );
  });

  it("derives OASIS diagnosis summaries from processed diagnoses section outputs", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDiagnosisExtraction: null,
        oasisClinicalFactPack: null,
        qaPrefetch: {
          ...patientViewInput.artifactContents.qaPrefetch,
          diagnosisRoute: null,
        },
        oasisDomSectionOutputs: {
          schemaVersion: "oasis-dom-section-outputs.v1",
          sections: [{
            sectionKey: "diagnoses",
            label: "Diagnoses",
            rows: [
              {
                label: "ICD-10 Code",
                value: "Z47.89",
                meta: "Encounter for other orthopedic aftercare",
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Diagnoses",
                sourceItemCode: "M1021",
              },
              {
                label: "Onset Date",
                value: "2026-05-09",
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Diagnoses",
                sourceItemCode: "M1021",
              },
              {
                label: "Symptom Control",
                value: "Exacerbate",
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Diagnoses",
                sourceItemCode: "M1021",
              },
              {
                label: "ICD-10 Code",
                value: "M75.121",
                meta: "Complete rotator-cuff tear/rupture of right shoulder, not trauma",
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Diagnoses",
                sourceItemCode: "M1023",
              },
              {
                label: "Risk Factor",
                value: "None of the above",
                sourceKind: "structured_value",
                confidence: 0.94,
                sourceSectionTitle: "Diagnoses",
                sourceItemCode: "M1033",
              },
            ],
          }],
        },
      },
    });

    assert.equal(detail.oasisDiagnosisSummary.diagnosisSource, "portal_dom_state");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.code, "Z47.89");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.description, "Encounter for other orthopedic aftercare");
    assert.equal(detail.oasisDiagnosisSummary.primaryDiagnosis?.onsetDate, "2026-05-09");
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[0]?.code, "M75.121");
    assert.equal(
      detail.oasisDiagnosisSummary.otherDiagnoses[0]?.description,
      "Complete rotator-cuff tear/rupture of right shoulder, not trauma",
    );
    assert.equal(detail.oasisDiagnosisSummary.otherDiagnoses[0]?.onsetDate, "2026-05-09");
    assert.deepEqual(
      [
        detail.oasisDiagnosisSummary.primaryDiagnosis,
        ...detail.oasisDiagnosisSummary.otherDiagnoses,
      ].map((diagnosis) => diagnosis?.description),
      [
        "Encounter for other orthopedic aftercare",
        "Complete rotator-cuff tear/rupture of right shoulder, not trauma",
      ],
    );
  });

  it("builds selectable OASIS assessment sources and deterministic change flags from portal preflight metadata", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        patientPortalStatusSnapshot: {
          schemaVersion: "patient-portal-status-snapshot.v1",
          status: "fresh",
          currentOasisAssessmentId: "recert-20260519-oasis-oasis-e2-rec",
          oasisAssessments: [
            {
              id: "soc-20260322-oasis-oasis-e1-soc",
              assessmentType: "SOC",
              title: "OASIS-OASIS E1 - SOC",
              date: "2026-03-22",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
            {
              id: "recert-20260519-oasis-oasis-e2-rec",
              assessmentType: "RECERT",
              title: "OASIS-OASIS E2 - REC",
              date: "2026-05-19",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
          ],
          referralFileArea: { available: true, labels: ["Referral Files"] },
          documentTableSignals: [],
        },
        oasisDomExtractedState: {
          assessmentType: "RECERT",
          assessmentDate: "2026-05-19",
          contentHash: "recert-dom-hash",
        },
        oasisDomAcquisitionState: {
          changedFields: ["active_diagnoses.primary_diagnosis"],
          regressedFields: ["medications_allergies.medication_list"],
        },
      },
    });

    assert.deepEqual(
      detail.dashboardState.referralOasisSources?.oasisAssessments.map((assessment) => ({
        id: assessment.id,
        title: assessment.title,
        current: assessment.isCurrent,
        monitored: assessment.isMonitored,
      })),
      [
        {
          id: "recert-20260519-oasis-oasis-e2-rec",
          title: "OASIS-OASIS E2 - REC",
          current: true,
          monitored: true,
        },
        {
          id: "soc-20260322-oasis-oasis-e1-soc",
          title: "OASIS-OASIS E1 - SOC",
          current: false,
          monitored: false,
        },
      ],
    );
    assert.equal(
      detail.dashboardState.referralOasisSources?.defaultOasisAssessmentId,
      "recert-20260519-oasis-oasis-e2-rec",
    );
    assert.equal(
      detail.dashboardState.referralOasisSources?.baselineOasisAssessmentId,
      "soc-20260322-oasis-oasis-e1-soc",
    );
    assert.deepEqual(
      detail.dashboardState.referralOasisSources?.oasisChangeFlags.map((flag) => ({
        kind: flag.kind,
        fieldKey: flag.fieldKey,
        assessmentId: flag.assessmentId,
        baselineAssessmentId: flag.baselineAssessmentId,
      })),
      [
        {
          kind: "changed",
          fieldKey: "active_diagnoses.primary_diagnosis",
          assessmentId: "recert-20260519-oasis-oasis-e2-rec",
          baselineAssessmentId: "soc-20260322-oasis-oasis-e1-soc",
        },
        {
          kind: "regressed",
          fieldKey: "medications_allergies.medication_list",
          assessmentId: "recert-20260519-oasis-oasis-e2-rec",
          baselineAssessmentId: "soc-20260322-oasis-oasis-e1-soc",
        },
      ],
    );
  });

  it("tags dashboard rows with selected referral document ids", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        referralDocumentResultsManifest: {
          schemaVersion: "referral-document-results-manifest.v1",
          defaultReferralDocumentId: "referral-doc-1",
          documents: [{
            documentId: "referral-doc-1",
            title: "Referral Order",
            status: "processed",
            artifactDirectory: "C:\\temp\\referral-doc-1",
          }],
        },
        referralDocumentArtifacts: [{
          documentId: "referral-doc-1",
          patientQaReference: patientViewInput.artifactContents.patientQaReference,
          qaDocumentSummary: patientViewInput.artifactContents.qaDocumentSummary,
          fieldMapSnapshot: patientViewInput.artifactContents.fieldMapSnapshot,
        }],
      },
    });

    assert.ok(detail.dashboardState.rows.length > 0);
    assert.ok(
      detail.dashboardState.rows.some((row) =>
        ((row.referralDocumentIds ?? []) as string[]).includes("referral-doc-1")
      ),
    );
  });

  it("uses the default usable referral document for the main referral documentation review", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        qaDocumentSummary: {
          extractionUsabilityStatus: "rejected",
          warnings: ["stale rejected root artifact"],
        },
        referralDocumentResultsManifest: {
          schemaVersion: "referral-document-results-manifest.v1",
          defaultReferralDocumentId: "referral-doc-good",
          documents: [
            {
              documentId: "referral-doc-bad",
              title: "Referral Bad",
              status: "failed",
              artifactDirectory: "C:\\temp\\referral-doc-bad",
              error: "Bedrock returned invalid or non-JSON direct-document referral output.",
            },
            {
              documentId: "referral-doc-good",
              title: "Referral Good",
              status: "processed",
              artifactDirectory: "C:\\temp\\referral-doc-good",
            },
          ],
        },
        referralDocumentArtifacts: [
          {
            documentId: "referral-doc-bad",
            status: "failed",
            qaDocumentSummary: {
              extractionUsabilityStatus: "rejected",
              warnings: ["Bedrock returned invalid or non-JSON direct-document referral output."],
            },
          },
          {
            documentId: "referral-doc-good",
            status: "processed",
            patientQaReference: patientViewInput.artifactContents.patientQaReference,
            qaDocumentSummary: {
              extractionUsabilityStatus: "usable",
              warnings: ["usable direct-document referral"],
            },
            fieldMapSnapshot: patientViewInput.artifactContents.fieldMapSnapshot,
            referralExtractedFacts: {
              facts: [{
                fact_key: "primary_diagnosis",
                category: "diagnosis",
                value: "Traumatic wound",
              }],
            },
          },
        ],
      },
    });

    assert.equal(detail.referralDocumentationReview.status, "usable");
    assert.equal(detail.referralDocumentationReview.factCount, 1);
    assert.deepEqual(detail.referralDocumentationReview.warnings, ["usable direct-document referral"]);
    assert.equal(detail.dashboardState.referralOasisSources?.defaultReferralDocumentId, "referral-doc-good");
  });

  it("does not choose a failed referral document as the default source", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        qaDocumentSummary: {
          extractionUsabilityStatus: "usable",
          warnings: ["stale usable root artifact"],
        },
        referralDocumentResultsManifest: {
          schemaVersion: "referral-document-results-manifest.v1",
          defaultReferralDocumentId: null,
          documents: [
            {
              documentId: "referral-doc-a",
              title: "Referral A",
              status: "failed",
              artifactDirectory: "C:\\temp\\referral-doc-a",
              error: "Bedrock returned invalid or non-JSON direct-document referral output.",
            },
            {
              documentId: "referral-doc-b",
              title: "Referral B",
              status: "failed",
              artifactDirectory: "C:\\temp\\referral-doc-b",
              error: "Direct-document referral extraction did not produce usable source-backed facts.",
            },
          ],
        },
        referralDocumentArtifacts: [
          {
            documentId: "referral-doc-a",
            status: "failed",
            qaDocumentSummary: { extractionUsabilityStatus: "rejected" },
          },
          {
            documentId: "referral-doc-b",
            status: "failed",
            qaDocumentSummary: { extractionUsabilityStatus: "rejected" },
          },
        ],
      },
    });

    assert.equal(detail.referralDocumentationReview.status, "rejected");
    assert.equal(detail.referralDocumentationReview.factCount, 0);
    assert.equal(detail.referralDocumentationReview.summaryItems.find((item) => item.label === "Failed Documents")?.value, "2");
    assert.equal(detail.dashboardState.referralOasisSources?.defaultReferralDocumentId, null);
    assert.deepEqual(
      detail.dashboardState.referralOasisSources?.referralDocuments.map((document) => document.status),
      ["failed", "failed"],
    );
  });

  it("attaches source-scoped referral diagnosis and medication summaries to each referral document", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        referralDocumentResultsManifest: {
          schemaVersion: "referral-document-results-manifest.v1",
          defaultReferralDocumentId: "referral-doc-a",
          documents: [
            {
              documentId: "referral-doc-a",
              title: "Referral A",
              status: "processed",
              artifactDirectory: "C:\\temp\\referral-doc-a",
            },
            {
              documentId: "referral-doc-b",
              title: "Referral B",
              status: "processed",
              artifactDirectory: "C:\\temp\\referral-doc-b",
            },
          ],
        },
        referralDocumentArtifacts: [
          {
            documentId: "referral-doc-a",
            qaDocumentSummary: { extractionUsabilityStatus: "usable" },
            referralExtractedFacts: {
              diagnosis_candidates: [{
                code: "S81.801A",
                description: "Right leg wound",
                is_primary_candidate: true,
                confidence: 0.91,
              }],
              facts: [
                {
                  fact_key: "medication_list",
                  value: [{ name: "Doc A Medication", dose: "5 mg", route: "Oral" }],
                },
                {
                  fact_key: "allergy_list",
                  value: [{ name: "Doc A Allergy", reaction: "Rash" }],
                },
              ],
            },
          },
          {
            documentId: "referral-doc-b",
            qaDocumentSummary: { extractionUsabilityStatus: "usable" },
            referralExtractedFacts: {
              diagnosis_candidates: [{
                code: "I10",
                description: "Hypertension",
                is_primary_candidate: true,
                confidence: 0.9,
              }],
              facts: [
                {
                  fact_key: "medication_list",
                  value: [{ name: "Doc B Medication", dose: "10 mg", route: "Oral" }],
                },
              ],
            },
          },
        ],
      },
    });

    const documents = detail.dashboardState.referralOasisSources?.referralDocuments ?? [];
    const docA = documents.find((document) => document.id === "referral-doc-a");
    const docB = documents.find((document) => document.id === "referral-doc-b");

    assert.equal(docA?.diagnosisSummary?.primaryDiagnosis?.code, "S81.801A");
    assert.equal(docA?.diagnosisSummary?.primaryDiagnosis?.description, "Right leg wound");
    assert.equal(docA?.medicationSummary?.medications[0]?.name, "Doc A Medication");
    assert.equal(docA?.medicationSummary?.allergies[0]?.name, "Doc A Allergy");
    assert.equal(docB?.diagnosisSummary?.primaryDiagnosis?.code, "I10");
    assert.equal(docB?.diagnosisSummary?.primaryDiagnosis?.description, "Hypertension");
    assert.equal(docB?.medicationSummary?.medications[0]?.name, "Doc B Medication");
    assert.equal(docB?.medicationSummary?.allergies.length, 0);
  });

  it("creates a selectable legacy referral source when current referral artifacts predate manifests", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        referralDocumentResultsManifest: null,
        referralSourceDocumentsManifest: null,
        referralDocumentArtifacts: null,
        documentText: {
          documents: [{
            type: "OASIS",
            portalLabel: "OASIS documents page",
            sourcePath: null,
            text: "OASIS documents page https://demo.portal/file-uploads New Referral Christine Young 04012026.pdf true dom viewer text",
          }],
        },
      },
    });

    const documents = detail.dashboardState.referralOasisSources?.referralDocuments ?? [];
    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.title, "New Referral Christine Young 04012026.pdf");
    assert.equal(documents[0]?.diagnosisSummary?.primaryDiagnosis?.code, "J18.9");
  });

  it("builds scoped historical OASIS rows from assessment artifacts", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        patientPortalStatusSnapshot: {
          schemaVersion: "patient-portal-status-snapshot.v1",
          status: "fresh",
          currentOasisAssessmentId: "recert-20260519",
          oasisAssessments: [
            {
              id: "soc-20260322",
              assessmentType: "SOC",
              title: "OASIS-OASIS E1 - SOC",
              date: "2026-03-22",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
            {
              id: "recert-20260519",
              assessmentType: "RECERT",
              title: "OASIS-OASIS E2 - REC",
              date: "2026-05-19",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
          ],
          referralFileArea: { available: true, labels: ["Referral Files"] },
          documentTableSignals: [],
        },
        oasisAssessmentProcessingManifest: {
          schemaVersion: "oasis-assessment-processing-manifest.v1",
          assessments: [{
            assessmentId: "soc-20260322",
            assessmentType: "SOC",
            processingStatus: "processed_scoped",
            domStatePath: "C:\\temp\\soc\\oasis-dom-extracted-state.json",
            sectionOutputsPath: "C:\\temp\\soc\\oasis-dom-section-outputs.json",
          }],
        },
        oasisAssessmentArtifacts: [{
          assessmentId: "soc-20260322",
          assessmentType: "SOC",
          isCurrent: false,
          sectionOutputsPath: "C:\\temp\\soc\\oasis-dom-section-outputs.json",
          oasisDomSectionOutputs: {
            schemaVersion: "oasis-dom-section-outputs.v1",
            sections: [{
              sectionKey: "safety_social_support",
              title: "Safety / Social Support",
              status: "processed",
              rows: [{
                label: "Caregiver availability",
                value: "Lives with family support",
                sourceKind: "structured_value",
                confidence: 0.92,
                sourceSectionTitle: "Safety / Social Support",
                sourceItemCode: "M1100",
              }],
            }],
          },
        }],
      },
    });

    const historicalRow = detail.dashboardState.rows.find((row) => row.oasisAssessmentId === "soc-20260322");
    assert.ok(historicalRow);
    assert.equal(historicalRow.displayPortalValue, "Lives with family support");
    assert.ok(historicalRow.sourceArtifacts.includes("C:\\temp\\soc\\oasis-dom-section-outputs.json"));
    assert.equal(
      detail.dashboardState.referralOasisSources?.oasisAssessments.find((assessment) => assessment.id === "soc-20260322")?.status,
      "processed_scoped",
    );
  });

  it("maps independent per-assessment OASIS check results", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisGate: {
          evaluatedAt: "2026-06-08T08:00:00.000Z",
          status: "failed_referral_mismatch",
          blockedFromPlanOfCare: true,
          missingFieldCount: 0,
          contradictionCount: 99,
          topReasons: ["legacy global gate should not populate Oasis check tab"],
          planOfCareAttempted: false,
          planOfCareAttemptSkippedReason: null,
        },
        patientPortalStatusSnapshot: {
          schemaVersion: "patient-portal-status-snapshot.v1",
          status: "fresh",
          currentOasisAssessmentId: "recert-20260519",
          oasisAssessments: [
            {
              id: "soc-20260322",
              assessmentType: "SOC",
              title: "OASIS-OASIS E1 - SOC",
              date: "2026-03-22",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
            {
              id: "recert-20260519",
              assessmentType: "RECERT",
              title: "OASIS-OASIS E2 - REC",
              date: "2026-05-19",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
          ],
          referralFileArea: { available: true, labels: ["Referral Files"] },
          documentTableSignals: [],
        },
        oasisCheckState: {
          schemaVersion: "oasis-check-state.v1",
          batchId: "batch-1",
          patientId: "patient-1",
          updatedAt: "2026-06-08T09:00:00.000Z",
          checks: {
            "soc-20260322": {
              assessmentId: "soc-20260322",
              status: "completed",
              acceptedAt: "2026-06-08T08:58:00.000Z",
              startedAt: "2026-06-08T08:59:00.000Z",
              completedAt: "2026-06-08T09:00:00.000Z",
              lastCheckedAt: "2026-06-08T09:00:00.000Z",
              lastError: null,
              resultPath: "C:\\temp\\soc\\oasis-check-result.json",
              statusUrl: "/status",
              message: "One diagnosis-to-function contradiction needs review.",
              result: {
                schemaVersion: "oasis-check-result.v1",
                assessmentId: "soc-20260322",
                assessmentType: "SOC",
                title: "OASIS-OASIS E1 - SOC",
                date: "2026-03-22",
                status: "discrepancies_found",
                summary: "One diagnosis-to-function contradiction needs review.",
                checkedAt: "2026-06-08T09:00:00.000Z",
                sections: [{
                  sectionKey: "diagnoses",
                  sectionLabel: "Diagnoses",
                  status: "discrepancies_found",
                  discrepancies: [{
                    itemCode: "M1021",
                    itemLabel: "Primary diagnosis",
                    primarySection: "Diagnoses",
                    contradictingSections: ["Functional / Therapy"],
                    valuesInConflict: ["Cannot ambulate", "Ambulates 150 feet"],
                    reasoning: "Diagnosis conflicts with function.",
                    confidence: "high",
                    reviewerAction: "Verify current ambulation response.",
                  }],
                }],
                diagnostics: {
                  modelId: "test-model",
                  promptVersion: "oasis-internal-mismatch-review.v1",
                  inputHash: "hash",
                  sourceArtifactPaths: [],
                  rawLlmParseStatus: "parsed",
                  warnings: [],
                },
              },
            },
          },
        },
      },
    });

    const assessments = detail.dashboardState.referralOasisSources?.oasisAssessments ?? [];
    const soc = assessments.find((assessment) => assessment.id === "soc-20260322");
    const recert = assessments.find((assessment) => assessment.id === "recert-20260519");
    assert.equal(soc?.oasisCheck?.result?.discrepancyCount, 1);
    assert.equal(soc?.oasisCheck?.result?.sections[0]?.discrepancies[0]?.contradictingSections[0], "Functional / Therapy");
    assert.equal(recert?.oasisCheck ?? null, null);
  });

  it("maps discharged OASIS status and discharge comparison results", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisGate: {
          evaluatedAt: "2026-06-08T08:00:00.000Z",
          status: "failed_referral_mismatch",
          blockedFromPlanOfCare: true,
          missingFieldCount: 0,
          contradictionCount: 99,
          topReasons: ["legacy global gate should not populate Oasis check tab"],
          planOfCareAttempted: false,
          planOfCareAttemptSkippedReason: null,
        },
        patientPortalStatusSnapshot: {
          schemaVersion: "patient-portal-status-snapshot.v1",
          status: "fresh",
          currentOasisAssessmentId: "recert-20260519",
          oasisAssessments: [
            {
              id: "recert-20260519",
              assessmentType: "RECERT",
              title: "OASIS-OASIS E2 - REC",
              date: "2026-05-19",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
            {
              id: "dc-20260608",
              assessmentType: "UNKNOWN",
              title: "OASIS DC",
              date: "2026-06-08",
              sourceRowText: "OASIS DC completed",
              primaryStatus: "VALIDATED",
              decision: "PROCESS",
              processingEligible: true,
            },
          ],
          referralFileArea: { available: true, labels: ["Referral Files"] },
          documentTableSignals: [],
        },
        oasisCheckState: {
          schemaVersion: "oasis-check-state.v1",
          batchId: "batch-1",
          patientId: "patient-1",
          updatedAt: "2026-06-08T09:00:00.000Z",
          checks: {
            "dc-20260608": {
              assessmentId: "dc-20260608",
              status: "completed",
              acceptedAt: "2026-06-08T08:58:00.000Z",
              startedAt: "2026-06-08T08:59:00.000Z",
              completedAt: "2026-06-08T09:00:00.000Z",
              lastCheckedAt: "2026-06-08T09:00:00.000Z",
              lastError: null,
              resultPath: "C:\\temp\\dc\\oasis-check-result.json",
              statusUrl: "/status",
              message: "M1850 worsened from baseline.",
              result: {
                schemaVersion: "oasis-check-result.v1",
                assessmentId: "dc-20260608",
                assessmentType: "DC",
                title: "OASIS DC",
                date: "2026-06-08",
                status: "discrepancies_found",
                summary: "M1850 worsened from baseline.",
                checkedAt: "2026-06-08T09:00:00.000Z",
                sections: [],
                dischargeComparison: {
                  status: "available",
                  outcome: "worsened",
                  summary: "M1850 worsened from SOC.",
                  baselineAssessment: {
                    assessmentId: "soc-20260401",
                    assessmentType: "SOC",
                    title: "OASIS SOC",
                    date: "2026-04-01",
                    selectionReason: "soc_assessment_type",
                  },
                  dischargeAssessment: {
                    assessmentId: "dc-20260608",
                    assessmentType: "DC",
                    title: "OASIS DC",
                    date: "2026-06-08",
                  },
                  reviewedItemCount: 1,
                  findings: [{
                    fieldGroup: "M fields",
                    itemCode: "M1850",
                    itemLabel: "Transferring",
                    baselineValue: "SOC: 1 - minimal assistance",
                    dischargeValue: "DC: 3 - unable to transfer self",
                    scoringInterpretation: "Higher M1850 scores are worse in the supplied scale.",
                    result: "worsened",
                    reasoning: "The discharge score is higher than baseline.",
                    confidence: "high",
                    reviewerAction: "Verify the DC transferring response.",
                  }],
                  warnings: [],
                },
                diagnostics: {
                  modelId: "test-model",
                  promptVersion: "oasis-internal-mismatch-review.v2",
                  inputHash: "hash",
                  sourceArtifactPaths: [],
                  rawLlmParseStatus: "parsed",
                  warnings: [],
                },
              },
            },
          },
        },
      },
    });

    const assessments = detail.dashboardState.referralOasisSources?.oasisAssessments ?? [];
    const dc = assessments.find((assessment) => assessment.id === "dc-20260608");
    assert.equal(dc?.isDischarged, true);
    assert.equal(dc?.oasisCheck?.result?.discrepancyCount, 1);
    assert.equal(dc?.oasisCheck?.result?.dischargeComparison?.baselineAssessment?.assessmentId, "soc-20260401");
    assert.equal(dc?.oasisCheck?.result?.dischargeComparison?.findings[0]?.itemCode, "M1850");
  });

  it("renders OASIS allergy status and explicit start dates from DOM allergy tables", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        oasisDomExtractedState: {
          sections: [{
            title: "Medication & Allergies",
            fields: [],
            tables: [{
              headers: ["Name", "Reaction", "Start Date", "Status"],
              rows: [
                ["Name", "Reaction", "Start Date", "Status"],
                ["Penicillin", "Rash", "05/01/2026", "Active"],
              ],
            }],
          }],
        },
      },
    });

    assert.deepEqual(summary.oasisMedicationSummary?.allergies, [{
      name: "Penicillin",
      reaction: "Rash",
      startDate: "05/01/2026",
      status: "Active",
      source: "OASIS DOM allergy table",
    }]);
  });

  it("does not render referral medication extraction fragments as medication names", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        documentFactPack: {
          factPack: {
            medications: [
              { name: "Left", dose: "40 mg" },
              { name: "Tendon And Trochanteric Bursa Kenalog", dose: "40 mg" },
              { name: "Tablet" },
              { name: "mg Capsule" },
              { name: "Capsule By" },
              { name: "Oxycodone -", dose: "10 mg" },
              { name: "Ondansetron HCI 09/19/2021", dose: "4 mg" },
            ],
            allergies: ["No known drug"],
          },
        },
      },
    });

    assert.deepEqual(summary.referralMedicationSummary?.medications.map((entry) => ({
      name: entry.name,
      dose: entry.dose,
    })), [
      { name: "Kenalog", dose: "40 mg" },
      { name: "Oxycodone", dose: "10 mg" },
      { name: "Ondansetron HCl", dose: "4 mg" },
    ]);
    assert.deepEqual(summary.referralMedicationSummary?.allergies, [{
      name: "No known drug",
      reaction: null,
      startDate: null,
      status: null,
      source: "Referral document",
    }]);
  });

  it("prefers direct-document referral medication and allergy facts over legacy document fact packs", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        referralExtractedFacts: {
          facts: [
            {
              fact_key: "medication_list",
              value: [{
                name: "Acetaminophen",
                dose: "500 mg",
                route: "PO",
                start_date: "05/02/2026",
                status: "Active",
              }],
              evidence_spans: ["Acetaminophen 500 mg PO start date 05/02/2026"],
            },
            {
              fact_key: "allergy_list",
              value: [{
                name: "No known allergies",
                status: "Active",
              }],
              evidence_spans: ["Allergies: No known allergies"],
            },
          ],
        },
        documentFactPack: {
          factPack: {
            medications: [{ name: "Legacy OCR Med", dose: "1 mg" }],
            allergies: ["Legacy OCR Allergy"],
          },
        },
      },
    });

    assert.equal(summary.referralMedicationSummary?.medicationSource, "direct_document_referral");
    assert.deepEqual(summary.referralMedicationSummary?.medications.map((entry) => ({
      name: entry.name,
      dose: entry.dose,
      route: entry.route,
      startDate: entry.startDate,
      status: entry.status,
      source: entry.source,
    })), [{
      name: "Acetaminophen",
      dose: "500 mg",
      route: "PO",
      startDate: "05/02/2026",
      status: "Active",
      source: "Direct-document referral",
    }]);
    assert.deepEqual(summary.referralMedicationSummary?.allergies, [{
      name: "No known allergies",
      reaction: null,
      startDate: null,
      status: "Active",
      source: "Direct-document referral",
    }]);
  });

  it("renders referral medication and allergy start dates from document fact packs", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        documentFactPack: {
          factPack: {
            medications: [
              {
                name: "Eliquis",
                dose: "2.5 mg",
                route: "PO",
                frequency: "twice daily",
                startDate: "01/24/2026",
              },
            ],
            allergies: [{
              name: "Penicillin",
              reaction: "Rash",
              startDate: "01/20/2026",
              status: "Active",
            }],
          },
        },
      },
    });

    assert.deepEqual(summary.referralMedicationSummary?.medications.map((entry) => ({
      name: entry.name,
      dose: entry.dose,
      route: entry.route,
      startDate: entry.startDate,
    })), [
      {
        name: "Eliquis",
        dose: "2.5 mg",
        route: "PO",
        startDate: "01/24/2026",
      },
    ]);
    assert.deepEqual(summary.referralMedicationSummary?.allergies, [{
      name: "Penicillin",
      reaction: "Rash",
      startDate: "01/20/2026",
      status: "Active",
      source: "Referral document",
    }]);
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
    assert.equal(detail.qaPrefetch?.oasisAssessmentPrimaryStatus, "VALIDATED");
    assert.equal(detail.qaPrefetch?.visibleDiagnosisCount, 1);
    assert.equal(detail.qaPrefetch?.selectedEpisodeRange, "03/01/2026 - 04/29/2026");
    assert.equal(detail.qaPrefetch?.outsideRangeTotalCards, 1);
    assert.equal(detail.qaPrefetch?.first30WorkbookColumns.sn, "SN - 1");
    assert.equal(detail.qaPrefetch?.second30WorkbookColumns.ptOtSt, "PT - 1");
    assert.equal(detail.qaPrefetch?.printedNoteReviewSource, null);
    assert.equal(detail.qaPrefetch?.printedNoteSections.length, 0);
    assert.equal(detail.oasisValidation?.missingFields[0]?.mItem, "M1730");
    assert.equal(detail.referralOasisConsistency?.findings[0]?.category, "cognition");
    assert.equal(detail.oasisGate?.planOfCareAttempted, false);
    assert.equal(detail.referralPatientContext?.referralDate, "02/17/2026");
    assert.equal(detail.referralSections.length, 1);
    assert.equal(detail.referralSections[0]?.fields[0]?.comparisonStatus, "supported_by_referral");
    assert.equal(detail.referralSections[0]?.fields[0]?.currentChartValueSource, "unavailable");
    assert.equal(detail.referralSections[0]?.fields[0]?.populatedInChart, false);
    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "missing_in_portal");
    assert.equal(detail.dashboardState.rows[0]?.backendComparisonStatus, "supported_by_referral");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSource, "unavailable");
    assert.equal(detail.dashboardState.rows[0]?.oasisEvidenceMode, "unavailable");
    assert.equal(detail.dashboardState.rows[0]?.oasisEvidenceLabel, "Not captured");
    assert.equal(detail.dashboardState.rows[0]?.qaResultLabel, "OASIS not captured");
    assert.equal(detail.dashboardState.rows[0]?.qaActionLabel, "Check OASIS source");
    assert.equal(detail.dashboardState.rows[0]?.referralComparisonOrigin, "referral_qa_fallback");
    assert.equal(
      detail.dashboardState.rows[0]?.valuePresence.hasPrintedNoteChartValue,
      false,
    );
    assert.equal(detail.dashboardState.visibilitySummary.hiddenRows, 0);
    assert.equal(detail.dashboardState.sourceCoverage.fieldLevelValueCount, 0);
    assert.equal(detail.dashboardState.sourceCoverage.sectionEvidenceFallbackRowCount, 0);
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

  it("ignores printed-note diagnoses when coding input is missing", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        codingInput: null,
        printedNoteChartValues: {
          currentChartValues: {
            primary_diagnosis: "R13.10 - Dysphagia, unspecified",
            secondary_diagnoses: [
              "I50.9 - Heart failure, unspecified",
              "E03.9 - Hypothyroidism, unspecified",
            ],
          },
        },
      },
    });

    assert.equal(summary.diagnosisSource, "document_fact_pack");
    assert.equal(summary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.referralDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.oasisDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.notEqual(summary.oasisDiagnosisSummary.primaryDiagnosis?.code, "R13.10");
    assert.equal(summary.diagnosisComparisonStatus, "partial_overlap");
  });

  it("falls back to document fact pack diagnoses when coding and printed-note diagnoses are missing", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        codingInput: null,
        printedNoteChartValues: {
          currentChartValues: {},
        },
        documentFactPack: {
          factPack: {
            diagnoses: [
              {
                code: "G93.41",
                description: "METABOLIC ENCEPHALOPATHY",
              },
              {
                code: "R26.2",
                description: "DIFFICULTY WALKING",
              },
            ],
          },
        },
      },
    });

    assert.equal(summary.diagnosisSource, "document_fact_pack");
    assert.equal(summary.primaryDiagnosis?.code, "G93.41");
    assert.equal(summary.otherDiagnoses[0]?.code, "R26.2");
    assert.equal(summary.referralDiagnosisSummary.primaryDiagnosis?.code, "G93.41");
    assert.equal(summary.oasisDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.diagnosisComparisonStatus, "conflict");
  });

  it("filters obvious non-diagnosis printed-note values and keeps referral diagnoses primary", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        codingInput: null,
        printedNoteChartValues: {
          currentChartValues: {
            primary_diagnosis: "Patient lives in congregate situation",
          },
        },
        documentFactPack: {
          factPack: {
            diagnoses: [
              {
                code: "J18.9",
                description: "PNEUMONIA, UNSPECIFIED ORGANISM",
              },
            ],
          },
        },
      },
    });

    assert.equal(summary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.referralDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.oasisDiagnosisSummary.primaryDiagnosis?.code, "J18.9");
    assert.equal(summary.diagnosisComparisonStatus, "aligned");
  });

  it("ignores noisy printed-note primary diagnosis values in the comparison workspace", () => {
    const diagnosisReference: PatientQaReference = {
      ...patientQaReference,
      fieldRegistry: [
        ...patientQaReference.fieldRegistry,
        {
          fieldKey: "primary_diagnosis",
          label: "Primary Diagnosis",
          groupKey: "diagnosis_and_coding",
          sectionKey: "active_diagnoses",
          oasisItemId: "M1021",
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
          fieldKeys: ["primary_diagnosis"],
          textSpans: [
            {
              text: "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
              sourceSectionNames: ["Diagnosis"],
              relatedFieldKeys: ["primary_diagnosis"],
              lineReferences: [],
            },
          ],
        },
      ],
      comparisonResults: {
        ...patientQaReference.comparisonResults,
        primary_diagnosis: {
          fieldKey: "primary_diagnosis",
          label: "Primary Diagnosis",
          groupKey: "diagnosis_and_coding",
          qaPriority: "critical",
          currentChartValue: "Patient lives in congregate situation",
          documentSupportedValue: null,
          comparisonStatus: "supported_by_referral",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
          sourceEvidence: [
            {
              sourceType: "REFERRAL_DIAGNOSIS",
              sourceLabel: "Referral diagnosis list",
              textSpan: "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
              confidence: 0.96,
            },
          ],
          requiresHumanReview: true,
        },
      },
      qaReviewQueue: [
        ...patientQaReference.qaReviewQueue,
        {
          fieldKey: "primary_diagnosis",
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
        codingInput: null,
        printedNoteChartValues: {
          currentChartValues: {
            primary_diagnosis: "Patient lives in congregate situation",
          },
        },
        printedNoteReview: {
          reviewSource: "printed_note_ocr",
          sections: [
            {
              key: "diagnosis",
              label: "Diagnosis",
              status: "COMPLETED",
              filledFieldCount: 5,
              missingFieldCount: 0,
              evidence: [
                "Primary Diagnosis J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
              ],
            },
          ],
        },
        documentFactPack: {
          factPack: {
            diagnoses: [
              {
                code: "J18.9",
                description: "PNEUMONIA, UNSPECIFIED ORGANISM",
              },
            ],
          },
        },
      },
    });

    const primaryDiagnosisRow = detail.dashboardState.rows.find(
      (row) => row.fieldKey === "primary_diagnosis",
    );

    assert.ok(primaryDiagnosisRow);
    assert.match(primaryDiagnosisRow.displayReferralValue, /J18\.9/i);
    assert.equal(primaryDiagnosisRow.displayPortalValue, "No chart data captured");
    assert.equal(primaryDiagnosisRow.oasisEvidenceMode, "unavailable");
    assert.equal(primaryDiagnosisRow.currentChartValue, null);
  });

  it("returns clinician-friendly referral summary fields while preserving technical warnings", () => {
    const summary = toDashboardPatientSummary({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        qaDocumentSummary: {
          extractionUsabilityStatus: "incomplete",
          normalizedSectionCount: 1,
          llmProposalCount: 6,
          warnings: [
            "Deterministic referral facts extraction was used.",
            "LLM disabled or unavailable; deterministic referral proposal fallback was used.",
          ],
        },
      },
    });

    assert.equal(summary.referralQa.summaryHeadline, "Referral extraction incomplete");
    assert.match(summary.referralQa.summaryDetail, /structured extraction is incomplete or unreliable/i);
    assert.deepEqual(summary.referralQa.displayWarnings, [
      "Review referral follow-up items before treating the comparison as complete.",
    ]);
    assert.equal(summary.referralQa.warnings.length, 2);
  });

  it("ignores refreshed printed-note values and stale printed-note snapshot values", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: "Stale chart snapshot value",
              currentChartValueSource: "printed_note_ocr",
              populatedInChart: true,
            },
          ],
        },
        printedNoteChartValues: {
          currentChartValues: {
            primary_reason_for_home_health_medical_necessity:
              "Refreshed printed-note value from the latest OCR artifact.",
          },
        },
      },
    });

    assert.equal(
      detail.referralSections[0]?.fields[0]?.currentChartValue,
      null,
    );
    assert.equal(detail.referralSections[0]?.fields[0]?.currentChartValueSource, "unavailable");
    assert.equal(
      detail.dashboardState.rows[0]?.currentChartValue,
      null,
    );
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSource, "unavailable");
    assert.equal(detail.dashboardState.rows[0]?.valuePresence.hasPrintedNoteChartValue, false);
  });

  it("does not override a real chart read with printed-note recovery values", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: "Live chart value",
              currentChartValueSource: "chart_read",
              populatedInChart: true,
            },
          ],
        },
        printedNoteChartValues: {
          currentChartValues: {
            primary_reason_for_home_health_medical_necessity:
              "Refreshed printed-note value from the latest OCR artifact.",
          },
        },
      },
    });

    assert.equal(detail.referralSections[0]?.fields[0]?.currentChartValue, "Live chart value");
    assert.equal(detail.referralSections[0]?.fields[0]?.currentChartValueSource, "chart_read");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValue, "Live chart value");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSource, "chart_read");
  });

  it("ignores printed-note review evidence when structured chart values are missing", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: null,
              currentChartValueSource: "unavailable",
              populatedInChart: false,
            },
          ],
        },
        printedNoteChartValues: {
          currentChartValues: {},
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
              evidence: [
                "Primary Reason for Home Health/Medical Necessity (POC Element): Skilled nursing for medication management and wound care.",
              ],
            },
          ],
        },
      },
    });

    assert.equal(
      detail.dashboardState.rows[0]?.displayPortalValue,
      "No chart data captured",
    );
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSourceLabel, "Not captured");
    assert.equal(
      detail.dashboardState.rows[0]?.oasisEvidenceMode,
      "unavailable",
    );
    assert.equal(detail.dashboardState.rows[0]?.oasisEvidenceLabel, "Not captured");
    assert.equal(
      detail.dashboardState.rows[0]?.portalSnippet,
      null,
    );
    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "missing_in_portal");
    assert.equal(detail.dashboardState.rows[0]?.reviewStatus, "Missing in Chart Snapshot");
    assert.equal(detail.dashboardState.rows[0]?.qaResultLabel, "OASIS not captured");
  });

  it("surfaces OASIS capture skip reasons instead of generic missing-chart messaging", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        fieldMapSnapshot: {
          ...patientViewInput.artifactContents.fieldMapSnapshot,
          fields: [
            {
              ...patientViewInput.artifactContents.fieldMapSnapshot.fields[0]!,
              currentChartValue: null,
              currentChartValueSource: "unavailable",
              populatedInChart: false,
            },
          ],
        },
        qaPrefetch: {
          ...patientViewInput.artifactContents.qaPrefetch,
          oasisAssessmentStatus: {
            detectedStatuses: ["LOCKED"],
            primaryStatus: "LOCKED",
            decision: "SKIP",
            processingEligible: false,
            reason: "Skip downstream OASIS capture because the assessment page shows locked.",
          },
          printedNoteReview: null,
        },
        printedNoteChartValues: {
          currentChartValues: {},
        },
        printedNoteReview: null,
      },
    });

    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "uncertain");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSource, "oasis_capture_skipped");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValueSourceLabel, "OASIS not captured");
    assert.equal(
      detail.dashboardState.rows[0]?.displayPortalValue,
      "Skip subsequent OASIS capture because the assessment page shows locked.",
    );
    assert.equal(
      detail.dashboardState.rows[0]?.shortReason,
      "Skip subsequent OASIS capture because the assessment page shows locked.",
    );
    assert.deepEqual(detail.dashboardState.rows[0]?.sourceArtifacts.includes("qa-prefetch-result.json"), true);
    assert.deepEqual(
      detail.dashboardState.rows[0]?.strictnessFlags.includes("oasis_capture_skipped_by_assessment_status"),
      true,
    );
    assert.equal(detail.dashboardState.rows[0]?.qaResultLabel, "Check source documents");
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
    assert.equal(detail.dashboardState.rows[0]?.qaResultLabel, "Referral support missing");
    assert.equal(detail.dashboardState.rows[0]?.qaActionLabel, "Request referral support");
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

  it("uses clinical-comparison-rows.json as the only dashboard row source", () => {
    const clinicalComparisonRows: ClinicalComparisonRow[] = [{
      fieldKey: "primary_reason_for_home_health_medical_necessity",
      category: "Patient Summary & Clinical Narrative",
      referralValue: "Canonical referral value",
      oasisValue: "Canonical OASIS value",
      verdict: "mismatch",
      confidence: 0.91,
      severity: "high",
      rationale: "Canonical row should win over referral sections and field-map values.",
      referralEvidence: [{
        artifact: "patient-qa-reference.json",
        sourceType: "REFERRAL_ORDER",
        sourceLabel: "Referral Order",
        snippet: "Canonical referral value",
        confidence: 0.91,
      }],
      oasisEvidence: [{
        artifact: "oasis-dom-extracted-state.json",
        sourceType: "OASIS_DOM_STATE",
        sourceLabel: "OASIS DOM state",
        snippet: "Canonical OASIS value",
        confidence: null,
      }],
      needsReview: true,
      sources: {
        referralArtifacts: ["patient-qa-reference.json"],
        oasisArtifacts: ["oasis-dom-extracted-state.json"],
      },
    }];

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalComparisonRows,
        fieldMapSnapshot: {
          fields: [{
            key: "primary_reason_for_home_health_medical_necessity",
            currentChartValue: "Field map value that must not drive the row",
            currentChartValueSource: "chart_read",
            populatedInChart: true,
          }],
        },
        printedNoteChartValues: {
          currentChartValues: {
            primary_reason_for_home_health_medical_necessity:
              "Printed note value that must not be re-derived by the API",
          },
        },
      },
    });

    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.displayReferralValue, "Canonical referral value");
    assert.equal(detail.dashboardState.rows[0]?.displayPortalValue, "Canonical OASIS value");
    assert.equal(detail.dashboardState.rows[0]?.comparisonResult, "mismatch");
    assert.deepEqual(detail.dashboardState.rows[0]?.sourceArtifacts, [
      "patient-qa-reference.json",
      "oasis-dom-extracted-state.json",
    ]);
    assert.equal(detail.dashboardState.rows[0]?.oasisEvidenceMode, "portal_dom_state");
    assert.equal(detail.dashboardState.comparisonRowsStatus, "ready");
    assert.equal(detail.dashboardState.comparisonRowsRowCount, 1);
  });

  it("ignores OCR-only canonical OASIS comparison row values", () => {
    const clinicalComparisonRows: ClinicalComparisonRow[] = [{
      fieldKey: "primary_reason_for_home_health_medical_necessity",
      category: "Patient Summary & Clinical Narrative",
      referralValue: "Canonical referral value",
      oasisValue: "Historical OCR OASIS value",
      verdict: "mismatch",
      confidence: 0.91,
      severity: "high",
      rationale: "Historical printed-note values must not power current dashboard output.",
      referralEvidence: [{
        artifact: "patient-qa-reference.json",
        sourceType: "REFERRAL_ORDER",
        sourceLabel: "Referral Order",
        snippet: "Canonical referral value",
        confidence: 0.91,
      }],
      oasisEvidence: [{
        artifact: "printed-note-chart-values.json",
        sourceType: "PRINTED_NOTE_OCR",
        sourceLabel: "Printed note chart values",
        snippet: "Historical OCR OASIS value",
        confidence: null,
      }],
      needsReview: true,
      sources: {
        referralArtifacts: ["patient-qa-reference.json"],
        oasisArtifacts: ["printed-note-chart-values.json"],
      },
    }];

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalComparisonRows,
      },
    });

    assert.equal(detail.dashboardState.rows.length, 1);
    assert.equal(detail.dashboardState.rows[0]?.displayReferralValue, "Canonical referral value");
    assert.equal(detail.dashboardState.rows[0]?.displayPortalValue, "No chart data captured");
    assert.equal(detail.dashboardState.rows[0]?.currentChartValue, null);
    assert.equal(detail.dashboardState.rows[0]?.oasisEvidenceMode, "unavailable");
    assert.deepEqual(detail.dashboardState.rows[0]?.sourceArtifacts, ["patient-qa-reference.json"]);
  });

  it("uses canonical row evidence as display fallback when explicit values are absent", () => {
    const clinicalComparisonRows: ClinicalComparisonRow[] = [{
      fieldKey: "primary_reason_for_home_health_medical_necessity",
      category: "Patient Summary & Clinical Narrative",
      referralValue: null,
      oasisValue: null,
      verdict: "mismatch",
      confidence: 0.88,
      severity: "high",
      rationale: "Evidence exists even though row values were not promoted.",
      referralEvidence: [{
        artifact: "source-clinical-fact-pack.json",
        sourceType: "REFERRAL_FACT_PACK",
        sourceLabel: "Referral fact pack",
        snippet: "Referral documents skilled nursing for medication management.",
        confidence: 0.88,
      }],
      oasisEvidence: [{
        artifact: "oasis-clinical-fact-pack.json",
        sourceType: "OASIS_FACT_PACK",
        sourceLabel: "OASIS fact pack",
        snippet: "OASIS documents skilled need for medication education.",
        confidence: 0.82,
      }],
      needsReview: true,
      sources: {
        referralArtifacts: ["source-clinical-fact-pack.json"],
        oasisArtifacts: ["oasis-clinical-fact-pack.json"],
      },
    }];

    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalComparisonRows,
      },
    });

    assert.equal(
      detail.dashboardState.rows[0]?.displayReferralValue,
      "Referral documents skilled nursing for medication management.",
    );
    assert.equal(
      detail.dashboardState.rows[0]?.displayPortalValue,
      "OASIS documents skilled need for medication education.",
    );
    assert.equal(detail.dashboardState.rows[0]?.valuePresence.hasDocumentValue, true);
    assert.equal(detail.dashboardState.rows[0]?.valuePresence.hasChartValue, true);
    assert.equal(detail.dashboardState.rows[0]?.oasisEvidenceMode, "oasis_fact_pack");
  });

  it("does not treat pending empty canonical rows as final comparison data", () => {
    const detail = toDashboardPatientDetail({
      ...patientViewInput,
      artifactContents: {
        ...patientViewInput.artifactContents,
        clinicalComparisonRows: [],
        comparisonRowsStatus: "pending",
        comparisonRowsReason: "referral artifacts not finalized",
        comparisonRowsRowCount: 0,
      },
    });

    assert.equal(detail.dashboardState.comparisonRowsStatus, "pending");
    assert.equal(detail.dashboardState.comparisonRowsReason, "referral artifacts not finalized");
    assert.equal(detail.dashboardState.comparisonRowsRowCount, 0);
    assert.equal(detail.dashboardState.rows.length, 0);
  });
});
