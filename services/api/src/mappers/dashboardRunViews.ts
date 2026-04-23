import type {
  PatientQaReference,
  PatientEpisodeWorkItem,
} from "@medical-ai-qa/shared-types";
import type { BatchRecord } from "../types/batchControlPlane";
import {
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
} from "./controlPlaneViews";

type KnownArtifactContents = {
  codingInput: unknown | null;
  documentText: unknown | null;
  qaPrefetch: unknown | null;
  patientQaReference: unknown | null;
  qaDocumentSummary: unknown | null;
  fieldMapSnapshot: unknown | null;
  printedNoteChartValues: unknown | null;
  printedNoteReview: unknown | null;
};

type DashboardDiscrepancyRating = "green" | "yellow" | "red";
type DashboardComparisonResult =
  | "match"
  | "equivalent_match"
  | "mismatch"
  | "missing_in_portal"
  | "missing_in_referral"
  | "uncertain"
  | "coding_review";
type DashboardVisibilityDecision =
  | "show"
  | "hidden_match"
  | "hidden_resolved"
  | "hidden_missing_chart_value"
  | "hidden_missing_document_value"
  | "hidden_filtered_by_default";

type PatientViewInput = {
  batch: BatchRecord;
  summary: BatchRecord["patientRuns"][number];
  workItem: PatientEpisodeWorkItem | null;
  artifactContents: KnownArtifactContents;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPatientQaReference(value: unknown): value is PatientQaReference {
  const record = asRecord(value);
  return Boolean(
    record &&
      Array.isArray(record.fieldRegistry) &&
      Array.isArray(record.referralDashboardSections) &&
      Array.isArray(record.qaReviewQueue) &&
      asRecord(record.comparisonResults),
  );
}

function countPatientsByStatus(batch: BatchRecord) {
  const totalWorkItems = batch.parse.workItemCount || batch.patientRuns.length;
  const totalCompleted = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "COMPLETE").length;
  const totalBlocked = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "BLOCKED").length;
  const totalFailed = batch.patientRuns.filter((patientRun) => patientRun.processingStatus === "FAILED").length;
  const totalNeedsHumanReview = batch.patientRuns.filter(
    (patientRun) => patientRun.processingStatus === "NEEDS_HUMAN_REVIEW",
  ).length;
  const currentlyRunningCount = batch.patientRuns.filter((patientRun) =>
    ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      patientRun.processingStatus,
    ),
  ).length;
  const processedCount = totalCompleted + totalBlocked + totalFailed + totalNeedsHumanReview;

  return {
    totalWorkItems,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalNeedsHumanReview,
    currentlyRunningCount,
    percentComplete:
      totalWorkItems === 0 ? 0 : Math.round((processedCount / totalWorkItems) * 100),
  };
}

function countPatientSummariesByStatus(
  batch: BatchRecord,
  patients: Array<{ status: string }>,
) {
  const totalWorkItems = batch.parse.workItemCount || patients.length;
  const totalCompleted = patients.filter((patient) => patient.status === "COMPLETE").length;
  const totalBlocked = patients.filter((patient) => patient.status === "BLOCKED").length;
  const totalFailed = patients.filter((patient) => patient.status === "FAILED").length;
  const totalNeedsHumanReview = patients.filter(
    (patient) => patient.status === "NEEDS_HUMAN_REVIEW",
  ).length;
  const currentlyRunningCount = patients.filter((patient) =>
    ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
      patient.status,
    ),
  ).length;
  const processedCount = totalCompleted + totalBlocked + totalFailed + totalNeedsHumanReview;

  return {
    totalWorkItems,
    totalCompleted,
    totalBlocked,
    totalFailed,
    totalNeedsHumanReview,
    currentlyRunningCount,
    percentComplete:
      totalWorkItems === 0 ? 0 : Math.round((processedCount / totalWorkItems) * 100),
  };
}

function toSubsidiarySummary(batch: BatchRecord) {
  return {
    subsidiaryId: batch.subsidiary.id,
    subsidiarySlug: batch.subsidiary.slug,
    subsidiaryName: batch.subsidiary.name,
  };
}

function deriveCurrentExecutionStep(batch: BatchRecord): string {
  if (batch.status === "PARSING") {
    return "PARSING_WORKBOOK";
  }

  if (batch.status === "RUNNING") {
    const activeRun = [...batch.patientRuns]
      .filter((patientRun) =>
        ["MATCHING_PATIENT", "DISCOVERING_CHART", "COLLECTING_EVIDENCE", "RUNNING_QA"].includes(
          patientRun.processingStatus,
        ),
      )
      .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))[0];
    return activeRun?.executionStep ?? "RUNNING_BATCH";
  }

  if (batch.status === "READY") {
    return "READY_TO_RUN";
  }

  if (batch.status === "FAILED") {
    return "FAILED";
  }

  if (batch.status === "COMPLETED" || batch.status === "COMPLETED_WITH_EXCEPTIONS") {
    return "COMPLETE";
  }

  return "CREATED";
}

function deriveBatchErrorSummary(
  batch: BatchRecord,
  patientSummaries?: Array<{ errorSummary: string | null }>,
): string | null {
  return (
    batch.run.lastError ??
    batch.parse.lastError ??
    patientSummaries?.find((patient) => patient.errorSummary)?.errorSummary ??
    batch.patientRuns.find((patientRun) => patientRun.errorSummary)?.errorSummary ??
    null
  );
}

function deriveDaysLeftBeforeOasisDueDate(input: PatientViewInput): number | null {
  return (
    input.workItem?.timingMetadata?.daysLeftBeforeOasisDueDate ??
    input.workItem?.timingMetadata?.daysLeft ??
    null
  );
}

function normalizeDiagnosisEntry(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const code = asString(record.code);
  const description = asString(record.description);
  const confidence = asString(record.confidence);
  if (!code && !description) {
    return null;
  }

  return {
    code,
    description,
    confidence,
  };
}

function deriveDiagnosisSummary(input: PatientViewInput) {
  const codingInput = asRecord(input.artifactContents.codingInput);
  const primaryDiagnosis = normalizeDiagnosisEntry(codingInput?.primaryDiagnosis);
  const otherDiagnoses = asArray(codingInput?.otherDiagnoses)
    .map((diagnosis) => normalizeDiagnosisEntry(diagnosis))
    .filter((diagnosis): diagnosis is NonNullable<typeof diagnosis> => diagnosis !== null);

  return {
    primaryDiagnosis,
    otherDiagnoses,
  };
}

function deriveQaPrefetchSummary(input: PatientViewInput) {
  const qaPrefetch = asRecord(input.artifactContents.qaPrefetch);
  if (!qaPrefetch) {
    return null;
  }

  const routeDiscovery = asRecord(qaPrefetch.routeDiscovery);
  const oasisRoute = asRecord(qaPrefetch.oasisRoute);
  const diagnosisRoute = asRecord(qaPrefetch.diagnosisRoute);
  const lockStatus = asRecord(qaPrefetch.lockStatus);
  const oasisAssessmentStatus = asRecord(qaPrefetch.oasisAssessmentStatus);
  const billingCalendarSummary = asRecord(qaPrefetch.billingCalendarSummary);
  const selectedEpisode = asRecord(billingCalendarSummary?.selectedEpisode);
  const periods = asRecord(billingCalendarSummary?.periods);
  const first30Days = asRecord(periods?.first30Days);
  const second30Days = asRecord(periods?.second30Days);
  const outsideRange = asRecord(periods?.outsideRange);
  const first30WorkbookColumns = asRecord(first30Days?.workbookColumns);
  const second30WorkbookColumns = asRecord(second30Days?.workbookColumns);
  const printedNoteReview = asRecord(qaPrefetch.printedNoteReview);
  const printedNoteCapture = asRecord(printedNoteReview?.capture);
  const printedNoteSections = asArray(printedNoteReview?.sections)
    .map((sectionValue) => {
      const section = asRecord(sectionValue);
      if (!section) {
        return null;
      }

      const key = asString(section.key);
      const label = asString(section.label);
      const status = asString(section.status);
      if (!key || !label || !status) {
        return null;
      }

      return {
        key,
        label,
        status,
        filledFieldCount:
          typeof section.filledFieldCount === "number" ? section.filledFieldCount : 0,
        missingFieldCount:
          typeof section.missingFieldCount === "number" ? section.missingFieldCount : 0,
      };
    })
    .filter((section): section is NonNullable<typeof section> => section !== null);
  const printedNoteCompletedSectionCount = printedNoteSections.filter((section) => section.status === "COMPLETED").length;
  const printedNoteIncompleteSectionCount = printedNoteSections.filter((section) => section.status !== "COMPLETED").length;

  return {
    status: asString(qaPrefetch.status) ?? "UNKNOWN",
    selectedRouteSummary: asString(qaPrefetch.selectedRouteSummary),
    lockStatus: asString(lockStatus?.status),
    oasisAssessmentPrimaryStatus: asString(oasisAssessmentStatus?.primaryStatus),
    oasisAssessmentStatuses: asArray(oasisAssessmentStatus?.detectedStatuses)
      .map((value) => asString(value))
      .filter((value): value is string => value !== null),
    oasisAssessmentDecision: asString(oasisAssessmentStatus?.decision),
    oasisAssessmentProcessingEligible:
      typeof oasisAssessmentStatus?.processingEligible === "boolean"
        ? oasisAssessmentStatus.processingEligible
        : null,
    oasisAssessmentReason: asString(oasisAssessmentStatus?.reason),
    oasisFound: Boolean(oasisRoute?.found),
    diagnosisFound: Boolean(diagnosisRoute?.found),
    visibleDiagnosisCount: asArray(diagnosisRoute?.visibleDiagnoses).length,
    warningCount:
      typeof qaPrefetch.warningCount === "number"
        ? qaPrefetch.warningCount
        : asArray(qaPrefetch.warnings).length,
    topWarning:
      asString(qaPrefetch.topWarning) ??
      asString(routeDiscovery?.topWarning) ??
      null,
    selectedEpisodeRange: asString(selectedEpisode?.rawLabel),
    first30TotalCards: typeof first30Days?.totalCards === "number" ? first30Days.totalCards : 0,
    second30TotalCards: typeof second30Days?.totalCards === "number" ? second30Days.totalCards : 0,
    outsideRangeTotalCards: typeof outsideRange?.totalCards === "number" ? outsideRange.totalCards : 0,
    first30CountsByType: asRecord(first30Days?.countsByType) ?? {},
    second30CountsByType: asRecord(second30Days?.countsByType) ?? {},
    first30WorkbookColumns: {
      sn: asString(first30WorkbookColumns?.sn) ?? "NA",
      ptOtSt: asString(first30WorkbookColumns?.ptOtSt) ?? "NA",
      hhaMsw: asString(first30WorkbookColumns?.hhaMsw) ?? "NA",
    },
    second30WorkbookColumns: {
      sn: asString(second30WorkbookColumns?.sn) ?? "NA",
      ptOtSt: asString(second30WorkbookColumns?.ptOtSt) ?? "NA",
      hhaMsw: asString(second30WorkbookColumns?.hhaMsw) ?? "NA",
    },
    printedNoteStatus: asString(printedNoteReview?.overallStatus),
    printedNoteAssessmentType: asString(printedNoteReview?.assessmentType),
    printedNoteReviewSource: asString(printedNoteReview?.reviewSource),
    printedNoteWarningCount:
      typeof printedNoteReview?.warningCount === "number"
        ? printedNoteReview.warningCount
        : asArray(printedNoteReview?.warnings).length,
    printedNoteTopWarning: asString(printedNoteReview?.topWarning),
    printedNoteCompletedSectionCount,
    printedNoteIncompleteSectionCount,
    printedNotePrintButtonDetected: Boolean(printedNoteCapture?.printButtonDetected),
    printedNotePrintClickSucceeded: Boolean(printedNoteCapture?.printClickSucceeded),
    printedNoteExtractionMethod: asString(printedNoteCapture?.extractionMethod),
    printedNoteTextLength:
      typeof printedNoteCapture?.textLength === "number" ? printedNoteCapture.textLength : 0,
    printedNoteSections,
  };
}

function deriveWorkflowTrack(
  input: PatientViewInput,
  workflowDomain: "coding" | "qa",
) {
  const workflowRun = input.summary.workflowRuns.find((candidate) => candidate.workflowDomain === workflowDomain);
  if (!workflowRun) {
    return null;
  }

  return {
    workflowRunId: workflowRun.workflowRunId,
    workflowDomain: workflowRun.workflowDomain,
    status: workflowRun.status,
    stepName: workflowRun.stepName,
    message: workflowRun.message ?? null,
    chartUrl: workflowRun.chartUrl ?? null,
    workflowResultPath: workflowRun.workflowResultPath ?? null,
    workflowLogPath: workflowRun.workflowLogPath ?? null,
    lastUpdatedAt: workflowRun.lastUpdatedAt,
  };
}

function deriveFieldDiscrepancyRating(comparisonStatus: string, workflowState: string): DashboardDiscrepancyRating {
  if (
    workflowState === "needs_coding_review" ||
    workflowState === "possible_conflict" ||
    workflowState === "missing_in_chart" ||
    comparisonStatus === "possible_conflict" ||
    comparisonStatus === "missing_in_chart"
  ) {
    return "red";
  }

  if (
    workflowState === "needs_qa_readback" ||
    workflowState === "supported_by_referral" ||
    comparisonStatus === "needs_qa_readback" ||
    comparisonStatus === "supported_by_referral"
  ) {
    return "yellow";
  }

  return "green";
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return false;
}

function humanizeCodeLikeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(trimmed)) {
    return trimmed.replace(/[_-]+/g, " ").toLowerCase();
  }

  return trimmed;
}

function parseStructuredString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("{") && (trimmed.includes("},{") || trimmed.includes("}, {"))) {
    try {
      return JSON.parse(`[${trimmed}]`);
    } catch {
      return null;
    }
  }

  return null;
}

function formatSerializedDiagnosisString(value: string): string | null {
  const matches = Array.from(
    value.matchAll(/"description"\s*:\s*"([^"]+)"[\s\S]*?"icd10_code"\s*:\s*"([^"]+)"/g),
  );
  if (matches.length === 0) {
    return null;
  }

  return matches
    .map((match) => `${humanizeCodeLikeToken(match[1] ?? "")} (${match[2] ?? ""})`)
    .join("; ");
}

function formatReadableString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsedStructuredValue = parseStructuredString(trimmed);
  if (parsedStructuredValue !== null) {
    return formatDashboardValue(parsedStructuredValue);
  }

  const serializedDiagnosisSummary = formatSerializedDiagnosisString(trimmed);
  if (serializedDiagnosisSummary) {
    return serializedDiagnosisSummary;
  }

  if (trimmed.includes("\n")) {
    return trimmed
      .split("\n")
      .map((line) => formatReadableString(line))
      .filter((line) => line.length > 0)
      .join("\n");
  }

  if (!trimmed.includes(",")) {
    return humanizeCodeLikeToken(trimmed);
  }

  return trimmed
    .split(",")
    .map((segment) => humanizeCodeLikeToken(segment))
    .filter((segment) => segment.length > 0)
    .join(", ");
}

function formatDiagnosisLikeRecord(record: Record<string, unknown>): string | null {
  const description = asString(record.description) ?? asString(record.label) ?? asString(record.name);
  const code = asString(record.icd10_code) ?? asString(record.code);
  if (!description && !code) {
    return null;
  }

  if (description && code) {
    return `${formatReadableString(description)} (${code})`;
  }

  return formatReadableString(description ?? code ?? "");
}

function formatDashboardValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return formatReadableString(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => formatDashboardValue(entry))
      .filter((entry) => entry.length > 0)
      .join("; ");
  }

  const record = asRecord(value);
  if (!record) {
    return String(value);
  }

  const diagnosisSummary = formatDiagnosisLikeRecord(record);
  if (diagnosisSummary) {
    return diagnosisSummary;
  }

  const genericEntries = Object.entries(record)
    .map(([key, entryValue]) => {
      const formattedEntryValue = formatDashboardValue(entryValue);
      if (!formattedEntryValue) {
        return null;
      }

      return `${toTitleCaseFromKey(key)}: ${formattedEntryValue}`;
    })
    .filter((entry): entry is string => entry !== null);

  return genericEntries.join("; ");
}

function stringifyDashboardValue(value: unknown): string {
  return formatDashboardValue(value);
}

function toTitleCaseFromKey(value: string): string {
  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

const SECTION_GUIDANCE_BY_KEY: Record<string, {
  mustCheck: string[];
  requiredLogic: string[];
  saveReminder: string;
  escalationGuidance: string[];
}> = {
  administrative_information: {
    mustCheck: [
      "Confirm referral date, hospitalization details, caregiver support, language, and contact information.",
      "Verify low-value demographics only when they affect routing or required OASIS items.",
    ],
    requiredLogic: [
      "Do not let administrative fields block clinical QA unless they affect workflow timing, hospitalization context, or caregiver contact.",
    ],
    saveReminder: "Save after confirming referral demographics and caregiver details before moving into clinical sections.",
    escalationGuidance: [
      "Escalate missing hospitalization or referral timing only if the chart cannot be reconciled from uploaded records.",
    ],
  },
  active_diagnoses: {
    mustCheck: [
      "Review primary and secondary diagnosis support, coding-sensitive evidence, and escalation flags.",
      "Confirm diagnosis support aligns with hospital and referral documentation before completing diagnosis review.",
    ],
    requiredLogic: [
      "Diagnosis additions, removals, or sequencing changes belong with coding, not QA direct editing.",
    ],
    saveReminder: "Do not finalize diagnosis changes here. Save notes and route coding-sensitive items before proceeding.",
    escalationGuidance: [
      "Route diagnosis conflicts or unsupported diagnosis recommendations to coding.",
    ],
  },
  vital_signs_and_pain_assessment: {
    mustCheck: [
      "Verify vitals, pain presence, pain tool use, and pain narrative are documented before QA sign-off.",
      "Check bowel movement date and other required visit-support details when this section is sparse.",
    ],
    requiredLogic: [
      "Pain documentation should support the downstream J0510/J0520/J0530 logic and not contradict the clinical narrative.",
    ],
    saveReminder: "Save once required vitals and pain documentation are confirmed or escalated.",
    escalationGuidance: [
      "Escalate missing vitals or pain scoring that require clinician verification.",
    ],
  },
  medication_allergies_and_injectables: {
    mustCheck: [
      "Confirm medication list, allergies, injectables, special treatments, and high-risk medication notes.",
      "Review whether referral medications should be suggested into the chart but not finalized without review.",
    ],
    requiredLogic: [
      "Medication additions can be suggested from referral records, but they still require clinical review before finalization.",
    ],
    saveReminder: "Save after documenting medication discrepancies and forwarding unresolved medication issues for review.",
    escalationGuidance: [
      "Escalate medication additions or unsafe discrepancies for clinician review rather than direct QA finalization.",
    ],
  },
  neurological_head_mood_eyes_ears: {
    mustCheck: [
      "Review mental, neurological, mood, vision, hearing, and emotional documentation for completeness.",
      "Confirm depression or mood-related documentation is reflected when diagnoses or history suggest it should be present.",
    ],
    requiredLogic: [
      "Mental-status, mood, and related OASIS items should not contradict each other across sections.",
    ],
    saveReminder: "Save after cross-checking mental, vision, hearing, and mood findings.",
    escalationGuidance: [
      "Escalate uncertain clinical interpretation of mental-status findings for human review.",
    ],
  },
  cardiopulmonary_chest_thorax: {
    mustCheck: [
      "Check cardiopulmonary findings, shortness of breath logic, oxygen references, and respiratory detail completeness.",
    ],
    requiredLogic: [
      "Respiratory findings should support M1400-related shortness-of-breath selections and not conflict with the narrative.",
    ],
    saveReminder: "Save after cardiopulmonary and respiratory consistency is reviewed.",
    escalationGuidance: [
      "Escalate missing or clinically uncertain respiratory findings for clinician verification.",
    ],
  },
  gastrointestinal_and_genitourinary_assessment: {
    mustCheck: [
      "Review GI/GU findings, bowel documentation, bladder status, and diet or fluid instructions when available.",
    ],
    requiredLogic: [
      "GI/GU documentation should align with current symptoms, bowel details, and nutritional instructions from source records.",
    ],
    saveReminder: "Save after GI/GU completeness is checked and missing bowel documentation is noted.",
    escalationGuidance: [
      "Escalate missing bowel or GU documentation when it requires clinician confirmation.",
    ],
  },
  integumentary_skin_and_wound: {
    mustCheck: [
      "Verify wound status, skin findings, wound worksheet support, and Norton Scale documentation.",
      "Confirm wound details align with the wound worksheet and supporting clinical documents.",
    ],
    requiredLogic: [
      "Wound answers should be consistent across integumentary details, wound worksheet content, and risk tools.",
    ],
    saveReminder: "Save after wound details and skin-risk tools are checked together.",
    escalationGuidance: [
      "Escalate unclear wound staging or missing wound worksheet documentation for clinician review.",
    ],
  },
  safety_and_risk_assessment: {
    mustCheck: [
      "Review MAHC-10, fall risk narrative, hospitalization risk, code status, and other safety tools.",
    ],
    requiredLogic: [
      "Risk scores and safety narratives should align with fall history, hospitalization risk, and code-status documentation.",
    ],
    saveReminder: "Save after fall-risk tools and safety narratives are reconciled.",
    escalationGuidance: [
      "Escalate missing risk scores that require clinician verification.",
    ],
  },
  functional_assessment_self_care: {
    mustCheck: [
      "Confirm self-care scoring and ADL support evidence before leaving the section.",
    ],
    requiredLogic: [
      "Functional scoring should align with therapy notes and other functional limitations documented elsewhere.",
    ],
    saveReminder: "Save after self-care scoring is reconciled with source therapy documentation.",
    escalationGuidance: [
      "Escalate unclear functional scoring when the referral evidence is ambiguous.",
    ],
  },
  functional_assessment_mobility_and_musculoskeletal: {
    mustCheck: [
      "Review mobility scoring, functional limitations, prior level of function, and homebound support.",
    ],
    requiredLogic: [
      "Functional M-items should align with GG0130/GG0170 scoring, prior functioning, and homebound rationale.",
    ],
    saveReminder: "Save after mobility scoring and homebound-related content are aligned.",
    escalationGuidance: [
      "Escalate clinician-dependent functional interpretation when referral support is incomplete.",
    ],
  },
  endocrine_diabetic_management: {
    mustCheck: [
      "Check diabetic management, PMH references, immunizations, and disease-management support when present.",
    ],
    requiredLogic: [
      "Diabetic status should align with PMH, medication profile, and plan-of-care instructions when documented.",
    ],
    saveReminder: "Save after endocrine and diabetic management details are either confirmed or clearly marked missing.",
    escalationGuidance: [
      "Escalate uncertain diabetic management interpretation for human review.",
    ],
  },
  plan_of_care_and_physical_therapy_evaluation: {
    mustCheck: [
      "Verify plan-of-care components, discipline frequencies, therapy need, skilled interventions, and care coordination orders.",
    ],
    requiredLogic: [
      "Plan-of-care recommendations should be supported by referral orders and therapy evaluation content.",
    ],
    saveReminder: "Save after frequencies, interventions, and therapy guidance are reviewed together.",
    escalationGuidance: [
      "Escalate missing physician-order or discipline-frequency detail that cannot be supported from uploaded records.",
    ],
  },
  patient_summary_and_clinical_narrative: {
    mustCheck: [
      "Review medical necessity, admit reason, patient summary narrative, PMH, and supporting hospitalization context.",
    ],
    requiredLogic: [
      "The patient summary and medical necessity draft should be consistent with diagnoses, respiratory findings, and hospitalization history.",
    ],
    saveReminder: "Save after the narrative draft is reviewed and obvious unsupported language is removed.",
    escalationGuidance: [
      "Escalate diagnosis-driven narrative conflicts to coding instead of editing diagnosis content in QA.",
    ],
  },
  care_plan_problems_goals_interventions: {
    mustCheck: [
      "Confirm care plan problems, goals, interventions, plan for next visit, and patient/caregiver goals.",
    ],
    requiredLogic: [
      "Care-plan goals and next-visit plans should logically follow the documented needs and skilled interventions.",
    ],
    saveReminder: "Save after goals, interventions, and next-visit planning are reviewed as a set.",
    escalationGuidance: [
      "Escalate care-plan content only when the recommendation depends on unsupported clinical interpretation.",
    ],
  },
  footer_non_print_preview: {
    mustCheck: [
      "Ignore fax-server chrome, signatures, and non-print elements unless they contain required source details.",
    ],
    requiredLogic: [
      "Do not let footer or fax-server metadata drive clinical recommendations.",
    ],
    saveReminder: "No save action is usually needed for footer-only content.",
    escalationGuidance: [
      "No escalation is usually needed unless footer text is the only source for a required identifier or date.",
    ],
  },
};

function deriveRecommendationOwner(field: {
  reviewMode: string;
  workflowState: string;
  fieldKey: string;
  sectionKey: string;
}): string {
  if (field.reviewMode === "coding_review_required" || field.workflowState === "needs_coding_review") {
    return "Coding";
  }

  if (
    field.workflowState === "missing_in_chart" &&
    [
      "vital_signs_and_pain_assessment",
      "cardiopulmonary_chest_thorax",
      "integumentary_skin_and_wound",
      "safety_and_risk_assessment",
      "gastrointestinal_and_genitourinary_assessment",
    ].includes(field.sectionKey)
  ) {
    return "Clinician Verification";
  }

  if (
    ["medication_list", "allergy_list", "injectable_medications", "special_treatments_o0110"].includes(field.fieldKey)
  ) {
    return "Clinical Review";
  }

  if (field.workflowState === "possible_conflict") {
    return "Human Review";
  }

  return "QA";
}

function deriveRecommendationLabel(field: {
  label: string;
  sectionLabel: string;
  reviewMode: string;
  workflowState: string;
  recommendedAction: string;
}): string {
  if (field.reviewMode === "coding_review_required" || field.workflowState === "needs_coding_review") {
    return `Referral documents contain coding-relevant support for ${field.label}.`;
  }

  if (field.workflowState === "possible_conflict") {
    return `Referral and chart data do not currently agree for ${field.label}.`;
  }

  if (field.workflowState === "missing_in_chart" && field.reviewMode === "chart_completeness_check") {
    return `The chart is currently missing required ${field.label} documentation for ${field.sectionLabel}.`;
  }

  if (field.workflowState === "missing_in_chart") {
    return `The referral documents support ${field.label}, but the chart does not currently show a completed value.`;
  }

  if (field.workflowState === "needs_qa_readback") {
    return `The referral documents provide a chart-ready answer for ${field.label}.`;
  }

  if (field.workflowState === "supported_by_referral") {
    return `The referral documents clearly support ${field.label}.`;
  }

  if (field.recommendedAction === "reference_only") {
    return `${field.label} is being shown as referral reference data only.`;
  }

  return `Referral evidence was organized for ${field.label} in ${field.sectionLabel}.`;
}

function deriveRecommendationValue(field: {
  label: string;
  documentSupportedValue: unknown;
  currentChartValue: unknown;
  workflowState: string;
}): string {
  if (hasMeaningfulValue(field.documentSupportedValue)) {
    return stringifyDashboardValue(field.documentSupportedValue);
  }

  if (hasMeaningfulValue(field.currentChartValue) && field.workflowState !== "missing_in_chart") {
    return `No stronger referral recommendation found. Current chart value: ${stringifyDashboardValue(field.currentChartValue)}`;
  }

  return `No clear referral-supported recommendation for ${field.label}. Human review is still required.`;
}

function deriveRecommendationRationale(field: {
  reviewMode: string;
  workflowState: string;
  sourceEvidence: Array<{ textSpan?: string | null; sourceLabel: string }>;
  sectionLabel: string;
}): string {
  const firstEvidence = field.sourceEvidence.find((entry) => asString(entry.textSpan) !== null);
  if (firstEvidence?.textSpan) {
    return firstEvidence.textSpan;
  }

  if (field.sourceEvidence[0]?.sourceLabel) {
    return `Supported by ${field.sourceEvidence[0].sourceLabel}.`;
  }

  if (field.workflowState === "missing_in_chart") {
    return `No chart value is currently visible for this field in ${field.sectionLabel}.`;
  }

  if (field.reviewMode === "chart_completeness_check") {
    return `This item is part of the required completeness logic for ${field.sectionLabel}.`;
  }

  return `Statement derived from uploaded referral evidence organized under ${field.sectionLabel}.`;
}

function deriveRecommendationConfidenceLabel(sourceEvidence: Array<{ confidence?: number | null }>): string {
  const confidences = sourceEvidence
    .map((entry) => (typeof entry.confidence === "number" ? entry.confidence : null))
    .filter((confidence): confidence is number => confidence !== null);
  if (confidences.length === 0) {
    return "Needs review";
  }

  const maxConfidence = Math.max(...confidences);
  if (maxConfidence >= 0.9) {
    return "High confidence";
  }

  if (maxConfidence >= 0.75) {
    return "Moderate confidence";
  }

  return "Low confidence";
}

function deriveFieldSnapshotLookup(input: PatientViewInput) {
  const fieldMapSnapshot = asRecord(input.artifactContents.fieldMapSnapshot);
  const snapshotFields = asArray(fieldMapSnapshot?.fields);
  const printedNoteChartValuesRecord = asRecord(input.artifactContents.printedNoteChartValues);
  const printedNoteChartValues = asRecord(printedNoteChartValuesRecord?.currentChartValues) ?? {};
  const snapshotByFieldKey = new Map<
    string,
    {
      currentChartValue: unknown;
      currentChartValueSource: string;
      populatedInChart: boolean;
    }
  >();

  for (const snapshotFieldValue of snapshotFields) {
    const snapshotField = asRecord(snapshotFieldValue);
    const fieldKey = asString(snapshotField?.key);
    if (!fieldKey) {
      continue;
    }

    snapshotByFieldKey.set(fieldKey, {
      currentChartValue: snapshotField?.currentChartValue ?? null,
      currentChartValueSource: asString(snapshotField?.currentChartValueSource) ?? "unavailable",
      populatedInChart:
        typeof snapshotField?.populatedInChart === "boolean" ? snapshotField.populatedInChart : false,
    });
  }

  for (const [fieldKey, recoveredChartValue] of Object.entries(printedNoteChartValues)) {
    if (!hasMeaningfulValue(recoveredChartValue)) {
      continue;
    }

    const existingSnapshot = snapshotByFieldKey.get(fieldKey);
    if (existingSnapshot?.currentChartValueSource === "chart_read") {
      continue;
    }

    snapshotByFieldKey.set(fieldKey, {
      currentChartValue: recoveredChartValue,
      currentChartValueSource: "printed_note_ocr",
      populatedInChart: true,
    });
  }

  return snapshotByFieldKey;
}

function deriveReferralQaSummary(input: PatientViewInput) {
  const patientQaReference = isPatientQaReference(input.artifactContents.patientQaReference)
    ? input.artifactContents.patientQaReference
    : null;
  const qaDocumentSummary = asRecord(input.artifactContents.qaDocumentSummary);
  const fieldSnapshotLookup = deriveFieldSnapshotLookup(input);
  const extractionUsabilityStatus =
    asString(qaDocumentSummary?.extractionUsabilityStatus) ??
    (patientQaReference ? "usable" : "missing");
  const warnings = asArray(qaDocumentSummary?.warnings)
    .map((warning) => asString(warning))
    .filter((warning): warning is string => warning !== null);
  const reviewQueue = patientQaReference?.qaReviewQueue ?? [];
  const availableSectionCount = patientQaReference
    ? patientQaReference.referralDashboardSections.filter((section) => section.textSpans.length > 0).length
    : 0;
  const totalSectionCount =
    patientQaReference?.referralDashboardSections.length ??
    asNumber(qaDocumentSummary?.normalizedSectionCount) ??
    0;
  const llmProposalCount = asNumber(qaDocumentSummary?.llmProposalCount);
  const referralDataAvailable =
    extractionUsabilityStatus === "usable" ||
    patientQaReference !== null ||
    asString(qaDocumentSummary?.selectedDocumentId) !== null;
  const possibleConflictCount = reviewQueue.filter((entry) => entry.workflowState === "possible_conflict").length;
  const codingReviewCount = reviewQueue.filter((entry) => entry.workflowState === "needs_coding_review").length;
  const missingInChartCount = reviewQueue.filter((entry) => entry.workflowState === "missing_in_chart").length;
  const qaReadbackCount = reviewQueue.filter((entry) => entry.workflowState === "needs_qa_readback").length;
  const supportedByReferralCount = reviewQueue.filter((entry) => entry.workflowState === "supported_by_referral").length;
  const criticalCount = reviewQueue.filter((entry) => {
    if (entry.qaPriority !== "critical") {
      return false;
    }

    return ["missing_in_chart", "possible_conflict", "needs_coding_review"].includes(entry.workflowState);
  }).length;
  const warningCount = reviewQueue.length - criticalCount;

  let discrepancyRating: DashboardDiscrepancyRating = "green";
  if (
    !referralDataAvailable ||
    extractionUsabilityStatus !== "usable" ||
    codingReviewCount > 0 ||
    possibleConflictCount > 0 ||
    criticalCount > 0
  ) {
    discrepancyRating = "red";
  } else if (reviewQueue.length > 0 || warnings.length > 0) {
    discrepancyRating = "yellow";
  }

  const qaStatus = !referralDataAvailable
    ? "Referral data missing"
    : extractionUsabilityStatus !== "usable"
      ? "Referral extraction blocked"
      : discrepancyRating === "red"
        ? "Needs QA attention"
        : discrepancyRating === "yellow"
          ? "QA review in progress"
          : "Ready for QA sign-off";
  const sections = patientQaReference?.referralDashboardSections.map((section) => {
    const fields = section.fieldKeys
      .map((fieldKey) => {
        const registryEntry =
          patientQaReference.fieldRegistry.find((candidate) => candidate.fieldKey === fieldKey) ?? null;
        const comparisonResult = patientQaReference.comparisonResults[fieldKey] ?? null;
        if (!registryEntry || !comparisonResult) {
          return null;
        }

        const fieldSnapshot = fieldSnapshotLookup.get(fieldKey);
        const currentChartValue = fieldSnapshot?.currentChartValue ?? comparisonResult.currentChartValue;
        const currentChartValueSource = fieldSnapshot?.currentChartValueSource ?? "unavailable";
        const populatedInChart = fieldSnapshot?.populatedInChart ?? hasMeaningfulValue(currentChartValue);

        const recommendation = {
          label: deriveRecommendationLabel({
            label: registryEntry.label,
            sectionLabel: section.label,
            reviewMode: registryEntry.reviewMode,
            workflowState: comparisonResult.workflowState,
            recommendedAction: comparisonResult.recommendedAction,
          }),
          recommendedValue: deriveRecommendationValue({
            label: registryEntry.label,
            documentSupportedValue: comparisonResult.documentSupportedValue,
            currentChartValue,
            workflowState: comparisonResult.workflowState,
          }),
          rationale: deriveRecommendationRationale({
            reviewMode: registryEntry.reviewMode,
            workflowState: comparisonResult.workflowState,
            sourceEvidence: comparisonResult.sourceEvidence,
            sectionLabel: section.label,
          }),
          owner: deriveRecommendationOwner({
            reviewMode: registryEntry.reviewMode,
            workflowState: comparisonResult.workflowState,
            fieldKey,
            sectionKey: section.sectionKey,
          }),
          confidenceLabel: deriveRecommendationConfidenceLabel(comparisonResult.sourceEvidence),
        };

        return {
          fieldKey,
          label: registryEntry.label,
          sectionKey: section.sectionKey,
          sectionLabel: section.label,
          groupKey: registryEntry.groupKey,
          qaPriority: registryEntry.qaPriority,
          oasisItemId: registryEntry.oasisItemId ?? null,
          fieldType: registryEntry.fieldType,
          controlType: registryEntry.controlType,
          reviewMode: registryEntry.reviewMode,
          notes: registryEntry.notes ?? null,
          currentChartValue,
          currentChartValueSource,
          populatedInChart,
          documentSupportedValue: comparisonResult.documentSupportedValue,
          comparisonStatus: comparisonResult.comparisonStatus,
          workflowState: comparisonResult.workflowState,
          recommendedAction: comparisonResult.recommendedAction,
          requiresHumanReview: comparisonResult.requiresHumanReview,
          sourceEvidence: comparisonResult.sourceEvidence,
          discrepancyRating: deriveFieldDiscrepancyRating(
            comparisonResult.comparisonStatus,
            comparisonResult.workflowState,
          ),
          recommendation,
        };
      })
      .filter((field): field is NonNullable<typeof field> => field !== null)
      .sort((left, right) => {
        const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
        const leftRank = priorityRank[left.qaPriority];
        const rightRank = priorityRank[right.qaPriority];
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.label.localeCompare(right.label);
      });

    const populatedFieldCount = fields.filter((field) =>
      hasMeaningfulValue(field.documentSupportedValue) || hasMeaningfulValue(field.currentChartValue),
    ).length;

    const sectionDiscrepancyRating = fields.some((field) => field.discrepancyRating === "red")
      ? "red"
      : fields.some((field) => field.discrepancyRating === "yellow")
        ? "yellow"
        : "green";
    const likelyMissing = fields
      .filter((field) => !hasMeaningfulValue(field.currentChartValue))
      .slice(0, 6)
      .map((field) => field.label);
    const sectionGuidance = SECTION_GUIDANCE_BY_KEY[section.sectionKey] ?? {
      mustCheck: ["Review all required answers in this section before proceeding."],
      requiredLogic: ["Confirm values are supported by the chart and referral evidence."],
      saveReminder: "Save after reviewing this section.",
      escalationGuidance: ["Escalate unsupported clinical interpretation for human review."],
    };

    return {
      sectionKey: section.sectionKey,
      label: section.label,
      dashboardOrder: section.dashboardOrder,
      printVisibility: section.printVisibility,
      fieldCount: fields.length,
      populatedFieldCount,
      discrepancyRating: sectionDiscrepancyRating,
      textSpans: section.textSpans,
      fields,
      guidance: {
        mustCheck: sectionGuidance.mustCheck,
        requiredLogic: sectionGuidance.requiredLogic,
        likelyMissing,
        saveReminder: sectionGuidance.saveReminder,
        escalationGuidance: sectionGuidance.escalationGuidance,
      },
    };
  }) ?? [];

  const allFields = sections.flatMap((section) => section.fields);
  const getField = (fieldKey: string) => allFields.find((field) => field.fieldKey === fieldKey) ?? null;
  const getSection = (sectionKey: string) => sections.find((section) => section.sectionKey === sectionKey) ?? null;
  const artifactInsights = patientQaReference?.referralQaInsights ?? null;

  const preAuditFindings = [
    ...allFields
      .filter((field) =>
        ["critical", "high"].includes(field.qaPriority) &&
        !hasMeaningfulValue(field.currentChartValue) &&
        field.workflowState !== "not_relevant_for_dashboard",
      )
      .slice(0, 12)
      .map((field) => ({
        id: `field-missing:${field.fieldKey}`,
        severity: field.qaPriority === "critical" ? "critical" as const : "warning" as const,
        category: field.sectionLabel,
        title: `Unanswered ${field.oasisItemId ?? "QA"} item: ${field.label}`,
        detail: field.recommendation.label,
      })),
    ...sections
      .filter((section) => section.fieldCount > 0 && section.populatedFieldCount < section.fieldCount)
      .slice(0, 8)
      .map((section) => ({
        id: `section-incomplete:${section.sectionKey}`,
        severity: section.discrepancyRating === "red" ? "critical" as const : "warning" as const,
        category: section.label,
        title: `Section has incomplete required fields`,
        detail: `${section.label} has ${section.fieldCount - section.populatedFieldCount} field(s) still needing QA attention.`,
      })),
  ];

  const documentationDefinitions = [
    {
      id: "docs-vitals-pain",
      title: "Vitals, bowel, and pain support",
      detail:
        "Verify vitals, bowel movement date, pain tool, and related visit-support documentation before human QA completes the assessment.",
      category: "Vital Signs & Pain Assessment",
      sectionKeys: ["vital_signs_and_pain_assessment"],
      fieldKeys: ["pain_assessment_narrative"],
    },
    {
      id: "docs-wound",
      title: "Wound worksheet and Norton Scale",
      detail:
        "Wound details, wound worksheet support, and Norton Scale documentation should be available together.",
      category: "Integumentary (Skin & Wound)",
      sectionKeys: ["integumentary_skin_and_wound"],
      fieldKeys: ["integumentary_wound_status", "norton_scale", "wound_risk_review"],
    },
    {
      id: "docs-mahc10",
      title: "MAHC-10 fall-risk documentation",
      detail:
        "MAHC-10 and related fall-risk narrative should be documented before QA sign-off.",
      category: "Safety & Risk Assessment",
      sectionKeys: ["safety_and_risk_assessment"],
      fieldKeys: ["mahc10_fall_risk", "fall_risk_narrative"],
    },
    {
      id: "docs-poc",
      title: "Plan of care, discipline frequencies, and goals",
      detail:
        "Plan of Care components, discipline frequencies, and patient/caregiver goals should be reviewed together.",
      category: "Plan of Care and Physical Therapy Evaluation",
      sectionKeys: ["plan_of_care_and_physical_therapy_evaluation", "care_plan_problems_goals_interventions"],
      fieldKeys: ["discipline_frequencies", "patient_caregiver_goals", "care_plan_problems_goals_interventions", "plan_for_next_visit"],
    },
  ];

  for (const definition of documentationDefinitions) {
    const relevantFields = definition.fieldKeys.map((fieldKey) => getField(fieldKey)).filter((field): field is NonNullable<typeof field> => field !== null);
    const sectionHasText = definition.sectionKeys.some((sectionKey) => (getSection(sectionKey)?.textSpans.length ?? 0) > 0);
    const sectionHasChartValues = relevantFields.some((field) => hasMeaningfulValue(field.currentChartValue));
    if (sectionHasText && !sectionHasChartValues) {
      preAuditFindings.push({
        id: definition.id,
        severity: "warning",
        category: definition.category,
        title: definition.title,
        detail: definition.detail,
      });
    }
  }

  function formatList(items: string[]): string {
    if (items.length === 0) {
      return "";
    }

    if (items.length === 1) {
      return items[0]!;
    }

    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }

    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  function diagnosisDescriptions(): string[] {
    const candidates = getField("diagnosis_candidates")?.documentSupportedValue;
    if (Array.isArray(candidates)) {
      return candidates
        .map((candidate) => asRecord(candidate))
        .map((candidate) => asString(candidate?.description))
        .filter((candidate): candidate is string => candidate !== null);
    }

    const formatted = stringifyDashboardValue(candidates);
    if (!formatted) {
      return [];
    }

    return formatted
      .split("; ")
      .map((entry) => entry.replace(/\s*\([^)]+\)$/, "").trim())
      .filter((entry) => entry.length > 0);
  }

  function matchingDiagnoses(pattern: RegExp): string[] {
    return diagnosisDescriptions().filter((diagnosis) => pattern.test(diagnosis)).slice(0, 4);
  }

  function chartValueSummary(fieldKey: string): string {
    const value = getField(fieldKey)?.currentChartValue;
    return hasMeaningfulValue(value) ? stringifyDashboardValue(value) : "blank";
  }

  function referralValueSummary(fieldKey: string): string {
    const field = getField(fieldKey);
    if (!field) {
      return "";
    }

    const value = hasMeaningfulValue(field.documentSupportedValue)
      ? stringifyDashboardValue(field.documentSupportedValue)
      : hasMeaningfulValue(field.currentChartValue)
        ? stringifyDashboardValue(field.currentChartValue)
        : "";

    if (!value) {
      return "";
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= 120) {
      return normalized;
    }

    const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
    return sentence.length <= 120 ? sentence : `${sentence.slice(0, 117).trimEnd()}...`;
  }

  function conciseConsistencyDetail(id: string, fallback: string): string {
    switch (id) {
      case "mental-status-vs-m1700-m1710": {
        const mentalDiagnoses = matchingDiagnoses(/encephalopathy|cognitive|depression|dementia|delirium|confusion|anxiety|behavior/i);
        const diagnosisSummary = mentalDiagnoses.length > 0
          ? `Referral records document ${formatList(mentalDiagnoses)}, indicating mental or cognitive concerns.`
          : "Referral records indicate mental or cognitive concerns."
        return `${diagnosisSummary} Mental-status chart selections are ${chartValueSummary("neurological_status") === "blank" ? "blank or incomplete" : "present but need reconciliation"}.`;
      }
      case "vision-vs-b1000-glasses": {
        return `Vision-related chart entries are ${chartValueSummary("eyes_ears_status")}, so B1000 vision impairment and glasses selections still need reconciliation.`;
      }
      case "respiratory-vs-m1400": {
        const respiratoryDiagnoses = matchingDiagnoses(/pneumonia|respiratory|hypoxia|copd|oxygen|sob|shortness of breath/i);
        const diagnosisSummary = respiratoryDiagnoses.length > 0
          ? `Referral records document ${formatList(respiratoryDiagnoses)}, supporting respiratory impairment.`
          : "Referral records support respiratory impairment."
        return `${diagnosisSummary} Chart respiratory status is ${chartValueSummary("respiratory_status")}.`;
      }
      case "functional-vs-gg0130-gg0170":
      case "functional-vs-gg": {
        const functionalSupport = referralValueSummary("functional_limitations");
        const supportText = functionalSupport
          ? `Referral records document ${functionalSupport}.`
          : "Referral records support functional limitations."
        return `${supportText} GG0130 self-care is ${chartValueSummary("gg_self_care")} and GG0170 mobility is ${chartValueSummary("gg_mobility")}.`;
      }
      case "wound-vs-worksheet": {
        const woundDiagnoses = matchingDiagnoses(/ulcer|wound|pressure|venous|skin/i);
        const woundSupport = woundDiagnoses.length > 0
          ? `Referral records document ${formatList(woundDiagnoses)}.`
          : referralValueSummary("integumentary_wound_status")
            ? `Referral records document ${referralValueSummary("integumentary_wound_status")}.`
            : "Referral records indicate wound or skin concerns."
        return `${woundSupport} Integumentary status is ${chartValueSummary("integumentary_wound_status")} and Norton Scale is ${chartValueSummary("norton_scale")}.`;
      }
      case "pain-vs-j0510-j0520-j0530":
      case "pain-logic": {
        const painSupport = referralValueSummary("pain_assessment_narrative") || referralValueSummary("patient_summary_narrative");
        const supportText = painSupport
          ? `Referral records mention pain-related support: ${painSupport}.`
          : "Referral records mention pain-related support."
        return `${supportText} Chart pain narrative is ${chartValueSummary("pain_assessment_narrative")}.`;
      }
      case "depression-vs-d0150": {
        const moodDiagnoses = matchingDiagnoses(/depression|anxiety|mood|behavior/i);
        const diagnosisSummary = moodDiagnoses.length > 0
          ? `Referral records document ${formatList(moodDiagnoses)}.`
          : "Referral records document mood or behavioral history."
        return `${diagnosisSummary} Emotional or behavioral status is ${chartValueSummary("emotional_behavioral_status")}.`;
      }
      default:
        return fallback.replace(/\s+/g, " ").trim();
    }
  }

  function compactSummary(value: string, maxLength = 180): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
    if (sentence.length <= maxLength) {
      return sentence;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  function conciseSourceHighlightSummary(id: string, fallback: string): string {
    switch (id) {
      case "medical-necessity":
        return referralValueSummary("primary_reason_for_home_health_medical_necessity") || compactSummary(fallback, 150);
      case "homebound":
        return (
          referralValueSummary("homebound_narrative") ||
          referralValueSummary("homebound_supporting_factors") ||
          compactSummary(fallback, 140)
        );
      case "prior-level-of-function":
        return (
          referralValueSummary("prior_functioning") ||
          referralValueSummary("functional_limitations") ||
          compactSummary(fallback, 140)
        );
      case "wound-history": {
        const woundDiagnoses = matchingDiagnoses(/ulcer|wound|pressure|venous|skin/i);
        if (woundDiagnoses.length > 0) {
          return `Wound support includes ${formatList(woundDiagnoses)}.`;
        }

        return (
          referralValueSummary("integumentary_wound_status") ||
          referralValueSummary("wound_risk_review") ||
          compactSummary(fallback, 140)
        );
      }
      case "diet-fluid":
        return compactSummary(fallback, 140);
      case "pmh-immunizations-dm": {
        const relevantHistory = matchingDiagnoses(/depression|hypothyroidism|heart failure|atrial fibrillation|kidney failure|diabetes|hypertension/i);
        if (relevantHistory.length > 0) {
          return `Relevant history includes ${formatList(relevantHistory.slice(0, 4))}.`;
        }

        return (
          referralValueSummary("past_medical_history") ||
          referralValueSummary("immunization_status") ||
          compactSummary(fallback, 150)
        );
      }
      case "diagnosis-support": {
        const diagnoses = diagnosisDescriptions().slice(0, 4);
        if (diagnoses.length > 0) {
          return `Coding-relevant diagnoses include ${formatList(diagnoses)}.`;
        }

        return compactSummary(fallback, 150);
      }
      default:
        return compactSummary(fallback, 150);
    }
  }

  const consistencyChecks = artifactInsights?.consistencyChecks?.length
    ? artifactInsights.consistencyChecks.map((entry) => ({
        id: entry.id,
        status: entry.status,
        title: entry.title,
        detail: conciseConsistencyDetail(entry.id, entry.detail),
        relatedSections: entry.relatedSections,
      }))
    : [
    (() => {
      const functional = getField("functional_limitations");
      const selfCare = getField("gg_self_care");
      const mobility = getField("gg_mobility");
      if (
        (hasMeaningfulValue(functional?.documentSupportedValue) || hasMeaningfulValue(functional?.currentChartValue)) &&
        (!hasMeaningfulValue(selfCare?.currentChartValue) || !hasMeaningfulValue(mobility?.currentChartValue))
      ) {
        return {
          id: "functional-vs-gg",
          status: "flagged" as const,
          title: "Functional items vs GG0130 / GG0170",
          detail:
            "Functional limitations are supported by referral evidence, but GG self-care or mobility scoring is still incomplete in the chart.",
          relatedSections: [
            "Functional Assessment (Self Care)",
            "Functional Assessment (Mobility & Musculoskeletal)",
          ],
        };
      }
      return null;
    })(),
    (() => {
      const respiratory = getField("respiratory_status");
      const admitReason = getField("admit_reason_to_home_health");
      if (
        hasMeaningfulValue(respiratory?.documentSupportedValue) &&
        !hasMeaningfulValue(admitReason?.currentChartValue)
      ) {
        return {
          id: "respiratory-vs-m1400",
          status: "watch" as const,
          title: "Respiratory findings vs M1400 shortness-of-breath logic",
          detail:
            "Respiratory support exists in the referral evidence. Confirm the M1400-related answer and narrative stay aligned.",
          relatedSections: [
            "Cardiopulmonary (Chest & Thorax)",
            "Patient Summary & Clinical Narrative",
          ],
        };
      }
      return null;
    })(),
    (() => {
      const wound = getField("integumentary_wound_status");
      const norton = getField("norton_scale");
      if (
        hasMeaningfulValue(wound?.documentSupportedValue) &&
        !hasMeaningfulValue(norton?.currentChartValue)
      ) {
        return {
          id: "wound-vs-worksheet",
          status: "flagged" as const,
          title: "Wound answers vs integumentary details and wound worksheet",
          detail:
            "Wound-related referral evidence exists, but the chart is still missing Norton Scale or equivalent wound-risk support.",
          relatedSections: ["Integumentary (Skin & Wound)"],
        };
      }
      return null;
    })(),
    (() => {
      const pain = getField("pain_assessment_narrative");
      const summary = getField("patient_summary_narrative");
      if (
        (hasMeaningfulValue(summary?.documentSupportedValue) || hasMeaningfulValue(summary?.currentChartValue)) &&
        !hasMeaningfulValue(pain?.currentChartValue)
      ) {
        return {
          id: "pain-logic",
          status: "watch" as const,
          title: "Pain presence vs pain-tool logic",
          detail:
            "Confirm J0510/J0520/J0530-related pain logic is supported because the pain section still lacks charted detail.",
          relatedSections: ["Vital Signs & Pain Assessment", "Patient Summary & Clinical Narrative"],
        };
      }
      return null;
    })(),
    (() => {
      const pmh = getField("past_medical_history");
      const mood = getField("emotional_behavioral_status");
      if (
        hasMeaningfulValue(pmh?.documentSupportedValue) &&
        !hasMeaningfulValue(mood?.currentChartValue)
      ) {
        return {
          id: "depression-vs-d0150",
          status: "watch" as const,
          title: "Depression / mood history vs D0150 completion",
          detail:
            "History or diagnoses may support mood documentation. Confirm depression-related screening and emotional/behavioral completion.",
          relatedSections: ["Neurological (Head, Mood, Eyes, Ears)"],
        };
      }
      return null;
    })(),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const sourceHighlights = artifactInsights?.sourceHighlights?.length
    ? artifactInsights.sourceHighlights.map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: conciseSourceHighlightSummary(entry.id, entry.summary),
        supportingSections: entry.supportingSections,
      }))
    : [
    {
      id: "medical-necessity",
      title: "Medical necessity",
      summary: conciseSourceHighlightSummary(
        "medical-necessity",
        getField("primary_reason_for_home_health_medical_necessity")?.recommendation.recommendedValue ||
        "No clear medical-necessity recommendation found in the referral records.",
      ),
      supportingSections: ["Patient Summary & Clinical Narrative"],
    },
    {
      id: "homebound",
      title: "Homebound reason",
      summary: conciseSourceHighlightSummary(
        "homebound",
        getField("homebound_narrative")?.recommendation.recommendedValue ||
        getField("homebound_supporting_factors")?.recommendation.recommendedValue ||
        "No clear homebound recommendation found. Human review is still required.",
      ),
      supportingSections: ["Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "prior-level-of-function",
      title: "Prior level of function",
      summary: conciseSourceHighlightSummary(
        "prior-level-of-function",
        getField("prior_functioning")?.recommendation.recommendedValue ||
        getField("functional_limitations")?.recommendation.recommendedValue ||
        "No clear prior-level-of-function support found in the uploaded referral records.",
      ),
      supportingSections: ["Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "wound-history",
      title: "Wound history",
      summary: conciseSourceHighlightSummary(
        "wound-history",
        getField("integumentary_wound_status")?.recommendation.recommendedValue ||
        getField("wound_risk_review")?.recommendation.recommendedValue ||
        "No wound-history recommendation found from the available referral evidence.",
      ),
      supportingSections: ["Integumentary (Skin & Wound)"],
    },
    {
      id: "diet-fluid",
      title: "Diet and fluid instructions",
      summary: conciseSourceHighlightSummary(
        "diet-fluid",
        sections.find((section) => section.sectionKey === "patient_summary_and_clinical_narrative")
          ?.textSpans.find((span) => /diet|fluid|pur[eé]ed|thickened/i.test(span.text))
          ?.text || "No explicit diet or fluid recommendation found in the organized referral sections.",
      ),
      supportingSections: [
        "Patient Summary & Clinical Narrative",
        "Gastrointestinal & Genitourinary Assessment",
      ],
    },
    {
      id: "pmh-immunizations-dm",
      title: "PMH, immunizations, and diabetic status",
      summary: conciseSourceHighlightSummary(
        "pmh-immunizations-dm",
        getField("past_medical_history")?.recommendation.recommendedValue ||
        getField("immunization_status")?.recommendation.recommendedValue ||
        "No complete PMH / immunization / diabetic-management recommendation was found from the referral documents.",
      ),
      supportingSections: [
        "Patient Summary & Clinical Narrative",
        "Administrative Information",
        "Endocrine (Diabetic Management)",
      ],
    },
    {
      id: "diagnosis-support",
      title: "Diagnoses and coding support",
      summary: conciseSourceHighlightSummary(
        "diagnosis-support",
        getField("diagnosis_candidates")?.recommendation.recommendedValue ||
        getField("primary_diagnosis")?.recommendation.recommendedValue ||
        "Diagnosis support is incomplete and should be reviewed with coding.",
      ),
      supportingSections: ["Active Diagnoses"],
    },
  ];

  const draftNarratives = artifactInsights?.draftNarratives?.length
    ? artifactInsights.draftNarratives.map((entry) => ({
        fieldKey: entry.fieldKey,
        label: entry.label,
        draft: entry.draft,
        status: entry.status,
      }))
    : [
    "homebound_narrative",
    "primary_reason_for_home_health_medical_necessity",
    "patient_summary_narrative",
    "skilled_interventions",
    "plan_for_next_visit",
    "care_plan_problems_goals_interventions",
    "patient_caregiver_goals",
  ]
    .map((fieldKey) => getField(fieldKey))
    .filter((field): field is NonNullable<typeof field> => field !== null)
    .map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      draft: field.recommendation.recommendedValue,
      status: hasMeaningfulValue(field.documentSupportedValue) ? "ready_for_qa" as const : "needs_human_review" as const,
    }));

  const exceptionRoutes = allFields
    .filter((field) => field.discrepancyRating !== "green" || field.recommendation.owner !== "QA")
    .slice(0, 14)
    .map((field) => ({
      id: `route:${field.fieldKey}`,
      owner: field.recommendation.owner,
      title: field.recommendation.label,
      detail: field.recommendation.rationale,
    }));

  return {
    patientContext: patientQaReference?.patientContext ?? null,
    referralDataAvailable,
    extractionUsabilityStatus,
    qaStatus,
    discrepancyRating,
    discrepancyCounts: {
      total: reviewQueue.length,
      critical: criticalCount,
      warning: warningCount,
      possibleConflict: possibleConflictCount,
      codingReview: codingReviewCount,
      missingInChart: missingInChartCount,
      needsQaReadback: qaReadbackCount,
      supportedByReferral: supportedByReferralCount,
    },
    availableSectionCount,
    totalSectionCount,
    llmProposalCount,
    warningCount: warnings.length,
    topWarning: warnings[0] ?? null,
    warnings,
    preAuditFindings,
    consistencyChecks,
    sourceHighlights,
    draftNarratives,
    exceptionRoutes,
    sections,
  };
}

function normalizeDashboardComparisonText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

function normalizeDashboardSnippetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getDashboardPortalValueSourceLabel(source: string): string {
  if (source === "chart_read") {
    return "Portal read";
  }
  if (source === "printed_note_ocr") {
    return "Printed note OCR";
  }
  if (source === "printed_note_review") {
    return "Printed note review";
  }
  if (source === "oasis_capture_skipped") {
    return "OASIS capture skipped";
  }
  if (source === "workbook_context") {
    return "Workbook context";
  }
  if (source === "unavailable") {
    return "Portal capture unavailable";
  }

  return source
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getDashboardConfidence(input: {
  sourceEvidence: Array<{ confidence?: number | null }>;
  requiresHumanReview: boolean;
  hasDocumentValue: boolean;
}): "high" | "medium" | "low" | "uncertain" {
  const scoredConfidence = input.sourceEvidence
    .map((entry) => (typeof entry.confidence === "number" ? entry.confidence : null))
    .filter((entry): entry is number => entry !== null)
    .sort((left, right) => right - left)[0];

  if (typeof scoredConfidence === "number") {
    if (scoredConfidence >= 0.9) {
      return "high";
    }
    if (scoredConfidence >= 0.75) {
      return "medium";
    }
    return "low";
  }

  if (input.hasDocumentValue) {
    return input.requiresHumanReview ? "medium" : "high";
  }

  return "uncertain";
}

function getDashboardStrengthLabel(value: number): "strong" | "moderate" | "weak" | "none" {
  if (value >= 3) {
    return "strong";
  }
  if (value >= 1) {
    return "moderate";
  }
  if (value === 0) {
    return "weak";
  }
  return "none";
}

function getDashboardSourceSupportStrength(input: {
  hasDocumentValue: boolean;
  evidenceCount: number;
  confidence: "high" | "medium" | "low" | "uncertain";
}): "strong" | "moderate" | "weak" | "none" {
  if (!input.hasDocumentValue && input.evidenceCount === 0) {
    return "none";
  }

  let score = 0;
  if (input.hasDocumentValue) {
    score += 1;
  }
  if (input.evidenceCount >= 2) {
    score += 1;
  }
  if (input.confidence === "high") {
    score += 2;
  } else if (input.confidence === "medium") {
    score += 1;
  }

  return getDashboardStrengthLabel(score);
}

function getDashboardMappingStrength(input: {
  reviewMode: string;
  fieldType: string;
  groupKey: string;
  requiresHumanReview: boolean;
}): "strong" | "moderate" | "weak" {
  if (input.reviewMode === "reference_only") {
    return "weak";
  }
  if (
    input.fieldType.includes("diagnosis") ||
    input.fieldType === "date" ||
    input.fieldType === "phone" ||
    input.groupKey.includes("diagnosis")
  ) {
    return "strong";
  }
  if (input.requiresHumanReview) {
    return "moderate";
  }
  return "weak";
}

function getPrintedNoteSectionCandidates(fieldKey: string, sectionKey: string): string[] {
  const directMappings: Record<string, string[]> = {
    patient_name: ["administrative_information"],
    dob: ["administrative_information"],
    soc_date: ["administrative_information"],
    caregiver_name: ["administrative_information"],
    caregiver_relationship: ["administrative_information"],
    caregiver_phone: ["administrative_information"],
    primary_reason_for_home_health_medical_necessity: ["primary_reason_medical_necessity"],
    pain_assessment_narrative: ["pain_assessment"],
    code_status: ["other_supplementals", "care_plan"],
    mahc10_fall_risk: ["other_supplementals", "musculoskeletal_functional_status"],
    norton_scale: ["integumentary"],
    gg_self_care: ["musculoskeletal_functional_status"],
    gg_mobility: ["musculoskeletal_functional_status"],
    neurological_status: ["neurological"],
    eyes_ears_status: ["eyes_ears"],
    cardiovascular_status: ["cardiovascular"],
    respiratory_status: ["respiratory"],
    gastrointestinal_status: ["gastrointestinal"],
    genitourinary_status: ["genitourinary"],
  };

  if (directMappings[fieldKey]) {
    return directMappings[fieldKey]!;
  }

  switch (sectionKey) {
    case "administrative_information":
      return ["administrative_information"];
    case "patient_summary_and_clinical_narrative":
      return ["primary_reason_medical_necessity", "care_plan"];
    case "functional_assessment_self_care":
    case "functional_assessment_mobility_and_musculoskeletal":
    case "plan_of_care_and_physical_therapy_evaluation":
    case "care_plan_problems_goals_interventions":
      return ["musculoskeletal_functional_status", "care_plan"];
    case "neurological_head_mood_eyes_ears":
      return ["neurological", "eyes_ears", "emotional"];
    case "cardiopulmonary_chest_thorax":
      return ["cardiovascular", "respiratory"];
    case "gastrointestinal_and_genitourinary_assessment":
      return ["gastrointestinal", "genitourinary"];
    case "integumentary_skin_and_wound":
      return ["integumentary"];
    case "safety_and_risk_assessment":
      return ["other_supplementals", "integumentary", "musculoskeletal_functional_status"];
    case "active_diagnoses":
      return ["diagnosis"];
    default:
      return [];
  }
}

function hasPrintedNoteSectionEvidence(input: {
  status: string;
  filledFieldCount: number;
  evidence: string[];
}): boolean {
  return (
    input.status === "COMPLETED" ||
    input.filledFieldCount > 0 ||
    input.evidence.some((entry) => normalizeDashboardSnippetText(entry).length > 0)
  );
}

function buildPrintedNoteSectionPortalValue(input: {
  label: string;
  status: string;
  filledFieldCount: number;
  missingFieldCount: number;
}): string {
  const coverageSummary =
    input.filledFieldCount > 0 || input.missingFieldCount > 0
      ? `${input.filledFieldCount} captured, ${input.missingFieldCount} missing`
      : "section evidence captured";

  return `Printed OASIS review found ${input.label} (${input.status.toLowerCase()}; ${coverageSummary}).`;
}

function derivePatientDashboardState(input: {
  referralQa: ReturnType<typeof deriveReferralQaSummary>;
  qaPrefetch: ReturnType<typeof deriveQaPrefetchSummary>;
  artifactContents: KnownArtifactContents;
}) {
  const printedNoteReview =
    asRecord(input.artifactContents.printedNoteReview) ??
    asRecord(asRecord(input.artifactContents.qaPrefetch)?.printedNoteReview);
  const printedNoteSections = new Map(
    asArray(printedNoteReview?.sections)
      .map((value) => {
        const section = asRecord(value);
        const key = asString(section?.key);
        const label = asString(section?.label);
        const status = asString(section?.status);
        if (!key || !label || !status) {
          return null;
        }

        return [
          key,
          {
            key,
            label,
            status,
            filledFieldCount: typeof section?.filledFieldCount === "number" ? section.filledFieldCount : 0,
            missingFieldCount: typeof section?.missingFieldCount === "number" ? section.missingFieldCount : 0,
            evidence: asArray(section?.evidence)
              .map((value) => asString(value))
              .filter((value): value is string => value !== null),
          },
        ] as const;
      })
      .filter((entry): entry is readonly [string, {
        key: string;
        label: string;
        status: string;
        filledFieldCount: number;
        missingFieldCount: number;
        evidence: string[];
      }] => entry !== null),
  );
  const printedNoteChartValuesRecord = asRecord(input.artifactContents.printedNoteChartValues);
  const printedNoteChartValues = asRecord(printedNoteChartValuesRecord?.currentChartValues) ?? {};
  const printedNoteReviewSource =
    asString(printedNoteReview?.reviewSource) ?? input.qaPrefetch?.printedNoteReviewSource ?? null;
  const oasisCaptureSkippedReason =
    input.qaPrefetch?.oasisAssessmentDecision === "SKIP"
      ? input.qaPrefetch.oasisAssessmentReason ?? "Downstream OASIS capture was skipped because of the assessment page status."
      : null;

  const rows = input.referralQa.sections.flatMap((section) =>
    section.fields.map((field) => {
      const recoveredChartValue = printedNoteChartValues[field.fieldKey];
      const currentChartValue =
        hasMeaningfulValue(field.currentChartValue)
          ? field.currentChartValue
          : hasMeaningfulValue(recoveredChartValue)
            ? recoveredChartValue
            : field.currentChartValue;
      const currentChartValueSource =
        hasMeaningfulValue(field.currentChartValue)
          ? field.currentChartValueSource
          : hasMeaningfulValue(recoveredChartValue)
            ? "printed_note_ocr"
            : field.currentChartValueSource || "unavailable";
      const documentValue = field.documentSupportedValue;
      const documentValueText = stringifyDashboardValue(documentValue).trim() || null;
      const chartValueText = stringifyDashboardValue(currentChartValue).trim() || null;
      const normalizedDocumentValue = documentValueText
        ? normalizeDashboardComparisonText(documentValueText)
        : null;
      const normalizedChartValue = chartValueText
        ? normalizeDashboardComparisonText(chartValueText)
        : null;
      const hasDocumentValue = documentValueText !== null;
      const hasChartValue = chartValueText !== null;
      const printedNoteSectionCandidates = getPrintedNoteSectionCandidates(field.fieldKey, field.sectionKey);
      const matchedPrintedNoteSections = printedNoteSectionCandidates
        .map((sectionKey) => printedNoteSections.get(sectionKey) ?? null)
        .filter((sectionValue): sectionValue is NonNullable<typeof sectionValue> => sectionValue !== null);
      const bestPrintedNoteSection =
        matchedPrintedNoteSections.find((sectionValue) => sectionValue.status === "COMPLETED") ??
        matchedPrintedNoteSections[0] ??
        null;
      const printedNoteSectionEvidenceAvailable =
        bestPrintedNoteSection !== null && hasPrintedNoteSectionEvidence(bestPrintedNoteSection);
      const printedNoteSectionSnippet =
        bestPrintedNoteSection?.evidence.find((entry) => normalizeDashboardSnippetText(entry).length > 0) ??
        null;
      const printedNoteSectionPortalValue =
        !chartValueText && printedNoteSectionEvidenceAvailable && bestPrintedNoteSection
          ? buildPrintedNoteSectionPortalValue(bestPrintedNoteSection)
          : null;
      const hasPortalEvidence = hasChartValue || printedNoteSectionEvidenceAvailable;
      const assessmentCaptureSkipped = Boolean(oasisCaptureSkippedReason) && !hasPortalEvidence;
      const effectiveChartValueSource =
        hasChartValue
          ? currentChartValueSource
          : printedNoteSectionEvidenceAvailable
            ? "printed_note_review"
            : assessmentCaptureSkipped
              ? "oasis_capture_skipped"
            : currentChartValueSource;
      const sourceArtifacts = [
        "patient-qa-reference.json",
        ...(hasMeaningfulValue(field.currentChartValue) ? ["field-map-snapshot.json"] : []),
        ...(hasMeaningfulValue(recoveredChartValue) || currentChartValueSource === "printed_note_ocr"
          ? ["printed-note-chart-values.json"]
          : []),
        ...(bestPrintedNoteSection ? ["oasis-printed-note-review.json"] : []),
        ...(assessmentCaptureSkipped ? ["qa-prefetch-result.json"] : []),
      ];
      const confidence = getDashboardConfidence({
        sourceEvidence: field.sourceEvidence,
        requiresHumanReview: field.requiresHumanReview,
        hasDocumentValue,
      });
      const sourceSupportStrength = getDashboardSourceSupportStrength({
        hasDocumentValue,
        evidenceCount: field.sourceEvidence.length,
        confidence,
      });
      const mappingStrength = getDashboardMappingStrength({
        reviewMode: field.reviewMode,
        fieldType: field.fieldType,
        groupKey: field.groupKey,
        requiresHumanReview: field.requiresHumanReview,
      });
      const comparisonSignals = new Set(
        [field.comparisonStatus, field.workflowState, field.recommendedAction]
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      );

      let displayStatus: DashboardComparisonResult;
      if (
        comparisonSignals.has("needs_coding_review") ||
        comparisonSignals.has("send_to_coding") ||
        field.recommendation.owner.toLowerCase().includes("coding")
      ) {
        displayStatus = "coding_review";
      } else if (assessmentCaptureSkipped) {
        displayStatus = "uncertain";
      } else if (comparisonSignals.has("possible_conflict")) {
        displayStatus = "mismatch";
      } else if (!hasDocumentValue && hasPortalEvidence) {
        displayStatus = "missing_in_referral";
      } else if (
        comparisonSignals.has("missing_in_chart") ||
        (comparisonSignals.has("supported_by_referral") && !hasPortalEvidence)
      ) {
        displayStatus = "missing_in_portal";
      } else if (hasDocumentValue && !hasPortalEvidence) {
        displayStatus = "missing_in_portal";
      } else if (comparisonSignals.has("needs_qa_readback") || comparisonSignals.has("supported_by_referral")) {
        displayStatus = "uncertain";
      } else if (
        comparisonSignals.has("match") ||
        comparisonSignals.has("already_satisfactory") ||
        comparisonSignals.has("not_relevant_for_dashboard")
      ) {
        displayStatus = "match";
      } else if (hasDocumentValue && hasChartValue && normalizedDocumentValue === normalizedChartValue) {
        displayStatus = "match";
      } else {
        displayStatus = "uncertain";
      }

      let visibilityDecision: DashboardVisibilityDecision = "show";
      let visibilityReason = "Backend marked this field as requiring review.";
      if (comparisonSignals.has("not_relevant_for_dashboard") || field.reviewMode === "reference_only") {
        visibilityDecision = "hidden_resolved";
        visibilityReason = "Backend marked this field as non-actionable for the QA dashboard.";
      } else if (displayStatus === "match") {
        visibilityDecision = "hidden_match";
        visibilityReason = "Backend comparison is resolved and hidden by default.";
      } else if (!hasPortalEvidence && !hasDocumentValue) {
        visibilityDecision = "hidden_filtered_by_default";
        visibilityReason = "Neither the chart snapshot nor the referral produced a comparable value.";
      }

      const strictnessFlags = [
        ...(visibilityDecision !== "show" && (hasDocumentValue || hasChartValue)
          ? ["hidden_with_meaningful_value"]
          : []),
        ...(visibilityDecision === "hidden_match" ? ["hidden_match_by_default"] : []),
        ...(hasMeaningfulValue(recoveredChartValue) && !hasMeaningfulValue(field.currentChartValue)
          ? ["chart_value_recovered_from_printed_note_artifact"]
          : []),
        ...(bestPrintedNoteSection?.status === "COMPLETED" && !hasChartValue
          ? ["printed_note_review_completed_but_chart_value_missing"]
          : []),
        ...(comparisonSignals.has("supported_by_referral") && !hasChartValue
          ? ["referral_support_without_chart_snapshot"]
          : []),
        ...(assessmentCaptureSkipped ? ["oasis_capture_skipped_by_assessment_status"] : []),
      ];

      return {
        fieldKey: field.fieldKey,
        fieldLabel: field.label,
        sectionKey: field.sectionKey,
        sectionLabel: field.sectionLabel,
        sourceSectionLabel: section.label,
        reviewMode: field.reviewMode,
        qaPriority: field.qaPriority,
        oasisItemId: field.oasisItemId,
        backendComparisonStatus: field.comparisonStatus,
        backendWorkflowState: field.workflowState,
        displayStatus,
        documentSupportedValue: documentValue,
        currentChartValue,
        normalizedDocumentValue,
        normalizedChartValue,
        currentChartValueSource: assessmentCaptureSkipped
          ? "oasis_capture_skipped"
          : currentChartValueSource,
        currentChartValueSourceLabel: getDashboardPortalValueSourceLabel(effectiveChartValueSource),
        displayReferralValue: documentValueText ?? "No reliable referral value extracted",
        displayPortalValue:
          chartValueText ??
          printedNoteSectionPortalValue ??
          (assessmentCaptureSkipped
            ? oasisCaptureSkippedReason
            : null) ??
          (effectiveChartValueSource === "printed_note_ocr"
            ? "Printed note OCR did not capture a value"
            : field.populatedInChart
              ? "Chart value is blank"
              : "No chart data captured"),
        comparisonResult: displayStatus,
        shortReason:
          visibilityDecision === "show"
            ? assessmentCaptureSkipped
              ? oasisCaptureSkippedReason ?? "OASIS capture was skipped because of the assessment page status."
              : comparisonSignals.has("possible_conflict")
              ? "Backend marked this field as a possible conflict."
              : comparisonSignals.has("missing_in_chart")
                ? "Backend marked this field as missing in the chart snapshot."
                : comparisonSignals.has("needs_qa_readback")
                  ? "Backend requires QA readback before treating this field as resolved."
                  : comparisonSignals.has("supported_by_referral")
                    ? "Referral evidence supports this field, but backend did not treat it as fully resolved."
                    : "Backend surfaced this field for QA review."
            : visibilityReason,
        reviewStatus:
          displayStatus === "match"
            ? "Resolved"
            : displayStatus === "coding_review"
              ? "Review with Coding"
              : displayStatus === "missing_in_portal"
                ? "Missing in Chart Snapshot"
                : displayStatus === "missing_in_referral"
                  ? "Missing Referral Documentation"
                  : displayStatus === "mismatch"
                    ? "Needs Review"
                    : "Needs Source Review",
        confidence,
        sourceSupportStrength,
        mappingStrength,
        referralSnippet: asString(field.sourceEvidence[0]?.textSpan) ?? documentValueText,
        portalSnippet: chartValueText ?? printedNoteSectionSnippet ?? oasisCaptureSkippedReason,
        evidence: field.sourceEvidence.map((entry, index) => ({
          id: `${field.fieldKey}:${index}`,
          sourceType: entry.sourceType,
          sourceLabel: entry.sourceLabel,
          snippet: entry.textSpan ?? null,
          confidence:
            typeof entry.confidence === "number"
              ? entry.confidence >= 0.9
                ? "high"
                : entry.confidence >= 0.75
                  ? "medium"
                  : "low"
              : "uncertain",
          confidenceLabel:
            typeof entry.confidence === "number"
              ? `${Math.round(entry.confidence * 100)}% confidence`
              : "Confidence not scored",
          pageHint: null,
        })),
        shownByDefault: visibilityDecision === "show",
        visibilityDecision,
        visibilityReason,
        strictnessFlags,
        sourceArtifacts: Array.from(new Set(sourceArtifacts)),
        valuePresence: {
          hasDocumentValue,
          hasChartValue,
          hasPrintedNoteChartValue: hasMeaningfulValue(recoveredChartValue),
          printedNoteSectionKey: bestPrintedNoteSection?.key ?? null,
          printedNoteSectionStatus: bestPrintedNoteSection?.status ?? null,
          printedNoteReviewSource,
        },
      };
    }),
  );

  const hiddenByReason = rows.reduce<Record<string, number>>((accumulator, row) => {
    if (row.visibilityDecision === "show") {
      return accumulator;
    }

    accumulator[row.visibilityDecision] = (accumulator[row.visibilityDecision] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    rows,
    visibilitySummary: {
      totalRows: rows.length,
      shownRows: rows.filter((row) => row.shownByDefault).length,
      hiddenRows: rows.filter((row) => !row.shownByDefault).length,
      hiddenByReason,
      potentiallyTooStrictRows: rows
        .filter((row) => row.strictnessFlags.length > 0)
        .map((row) => row.fieldKey),
    },
    sourceCoverage: {
      printedNoteReviewSource,
      printedNoteCompletedSectionCount: Array.from(printedNoteSections.values()).filter(
        (sectionValue) => sectionValue.status === "COMPLETED",
      ).length,
      printedNoteChartValueCount: Object.keys(printedNoteChartValues).length,
    },
  };
}

function derivePatientDashboardReviewSummary(
  dashboardState: ReturnType<typeof derivePatientDashboardState>,
) {
  const shownRows = dashboardState.rows.filter((row) => row.shownByDefault);
  const mismatchCount = shownRows.filter((row) => row.comparisonResult === "mismatch").length;
  const missingInPortalCount = shownRows.filter((row) => row.comparisonResult === "missing_in_portal").length;
  const missingInReferralCount = shownRows.filter((row) => row.comparisonResult === "missing_in_referral").length;
  const uncertainCount = shownRows.filter((row) => row.comparisonResult === "uncertain").length;
  const codingReviewCount = shownRows.filter((row) => row.comparisonResult === "coding_review").length;
  const resolvedCount = dashboardState.rows.filter(
    (row) => row.comparisonResult === "match",
  ).length;
  const openRowCount =
    mismatchCount +
    missingInPortalCount +
    missingInReferralCount +
    uncertainCount +
    codingReviewCount;
  const highPriorityOpenCount = shownRows.filter(
    (row) => row.qaPriority === "critical" || row.qaPriority === "high",
  ).length;

  return {
    severity:
      mismatchCount > 0 || missingInPortalCount > 0 || codingReviewCount > 0
        ? ("red" as const)
        : openRowCount > 0
          ? ("yellow" as const)
          : ("green" as const),
    openRowCount,
    shownRowCount: dashboardState.visibilitySummary.shownRows,
    hiddenRowCount: dashboardState.visibilitySummary.hiddenRows,
    mismatchCount,
    missingInPortalCount,
    missingInReferralCount,
    uncertainCount,
    codingReviewCount,
    resolvedCount,
    highPriorityOpenCount,
    potentiallyTooStrictCount: dashboardState.visibilitySummary.potentiallyTooStrictRows.length,
  };
}

function derivePatientStatusSummary(
  input: PatientViewInput,
  referralQaSummary: ReturnType<typeof deriveReferralQaSummary>,
): string {
  switch (input.summary.processingStatus) {
    case "COMPLETE":
      return referralQaSummary.qaStatus;
    case "BLOCKED":
      return input.summary.errorSummary ?? input.summary.matchResult.note ?? "Blocked during read-only extraction";
    case "FAILED":
      return input.summary.errorSummary ?? "Read-only extraction failed";
    case "NEEDS_HUMAN_REVIEW":
      return input.summary.errorSummary ?? referralQaSummary.qaStatus;
    default:
      return "Referral QA extraction in progress";
  }
}

function sortPatientSummaries(patients: ReturnType<typeof toDashboardPatientSummary>[]) {
  return [...patients].sort((left, right) => {
    const leftDays = left.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
    const rightDays = right.daysLeftBeforeOasisDueDate ?? Number.MAX_SAFE_INTEGER;
    if (leftDays !== rightDays) {
      return leftDays - rightDays;
    }

    return left.patientName.localeCompare(right.patientName);
  });
}

export function toDashboardRunListItem(
  batch: BatchRecord,
  resolvedPatients?: Array<{ status: string; errorSummary: string | null }>,
) {
  const counts = resolvedPatients
    ? countPatientSummariesByStatus(batch, resolvedPatients)
    : countPatientsByStatus(batch);

  return {
    ...toSubsidiarySummary(batch),
    id: batch.id,
    billingPeriod: batch.billingPeriod,
    status: batch.status,
    currentExecutionStep: deriveCurrentExecutionStep(batch),
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    createdAt: batch.createdAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch, resolvedPatients),
    runMode: batch.runMode,
    rerunEnabled: batch.schedule.rerunEnabled && batch.schedule.active,
    lastRunAt: batch.schedule.lastRunAt,
    nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
  };
}

export function toDashboardPatientSummary(input: PatientViewInput) {
  const diagnosisSummary = deriveDiagnosisSummary(input);
  const codingWorkflow = deriveWorkflowTrack(input, "coding");
  const qaWorkflow = deriveWorkflowTrack(input, "qa");
  const qaPrefetch = deriveQaPrefetchSummary(input);
  const referralQa = deriveReferralQaSummary(input);
  const dashboardState = derivePatientDashboardState({
    referralQa,
    qaPrefetch,
    artifactContents: input.artifactContents,
  });
  const dashboardReview = derivePatientDashboardReviewSummary(dashboardState);

  return {
    ...toSubsidiarySummary(input.batch),
    runId: input.summary.runId,
    batchId: input.batch.id,
    subsidiaryId: input.summary.subsidiaryId ?? input.batch.subsidiary.id,
    workItemId: input.summary.workItemId,
    patientName: input.summary.patientName,
    status: input.summary.processingStatus,
    executionStep: input.summary.executionStep,
    percentComplete: input.summary.progressPercent,
    startedAt: input.summary.startedAt,
    completedAt: input.summary.completedAt,
    lastUpdatedAt: input.summary.lastUpdatedAt,
    errorSummary: input.summary.errorSummary,
    retryEligible: input.summary.retryEligible,
    attemptCount: input.summary.attemptCount,
    resultBundlePath: input.summary.resultBundlePath,
    logPath: input.summary.logPath,
    batchStatusSummary: derivePatientStatusSummary(input, referralQa),
    daysLeftBeforeOasisDueDate: deriveDaysLeftBeforeOasisDueDate(input),
    primaryDiagnosis: diagnosisSummary.primaryDiagnosis,
    otherDiagnoses: diagnosisSummary.otherDiagnoses,
    runMode: input.batch.runMode,
    rerunEnabled: input.batch.schedule.rerunEnabled && input.batch.schedule.active,
    lastRunAt: input.batch.schedule.lastRunAt,
    nextScheduledRunAt: input.batch.schedule.nextScheduledRunAt,
    codingWorkflow,
    qaWorkflow,
    qaPrefetch,
    referralQa,
    dashboardReview,
  };
}

export function toDashboardRunDetail(input: {
  batch: BatchRecord;
  patients: ReturnType<typeof toDashboardPatientSummary>[];
}) {
  const patients = sortPatientSummaries(input.patients);
  const counts = countPatientSummariesByStatus(input.batch, patients);

  return {
    ...toDashboardRunListItem(input.batch, patients),
    sourceWorkbookName: input.batch.sourceWorkbook.originalFileName,
    uploadedAt: input.batch.sourceWorkbook.uploadedAt,
    canRetryBlockedPatients: patients.some((patient) => patient.retryEligible),
    canDeactivate: input.batch.schedule.active,
    patientStatusSummary: {
      ready: counts.totalCompleted,
      blocked: counts.totalBlocked,
      failed: counts.totalFailed,
      needsManualReview: counts.totalNeedsHumanReview,
      inProgress: counts.currentlyRunningCount,
    },
    patients,
  };
}

export function toDashboardPatientDetail(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);
  const dashboardState = derivePatientDashboardState({
    referralQa: summary.referralQa,
    qaPrefetch: summary.qaPrefetch,
    artifactContents: input.artifactContents,
  });

  return {
    ...summary,
    workbookContext: {
      billingPeriod: input.workItem?.episodeContext.billingPeriod ?? null,
      workflowTypes: input.workItem?.workflowTypes ?? [],
      rawDaysLeftValues: input.workItem?.timingMetadata?.rawDaysLeftValues ?? [],
    },
    dashboardState,
    referralPatientContext: summary.referralQa.patientContext,
    referralSections: summary.referralQa.sections,
  };
}

export function toDashboardPatientStatus(input: PatientViewInput) {
  const summary = toDashboardPatientSummary(input);
  return {
    runId: summary.runId,
    batchId: summary.batchId,
    subsidiaryId: summary.subsidiaryId,
    subsidiarySlug: summary.subsidiarySlug,
    subsidiaryName: summary.subsidiaryName,
    patientId: summary.workItemId,
    patientName: summary.patientName,
    status: summary.status,
    executionStep: summary.executionStep,
    batchStatusSummary: summary.batchStatusSummary,
    primaryDiagnosis: summary.primaryDiagnosis,
    otherDiagnoses: summary.otherDiagnoses,
    runMode: summary.runMode,
    rerunEnabled: summary.rerunEnabled,
    lastRunAt: summary.lastRunAt,
    nextScheduledRunAt: summary.nextScheduledRunAt,
    lastUpdatedAt: summary.lastUpdatedAt,
    codingWorkflow: summary.codingWorkflow,
    qaWorkflow: summary.qaWorkflow,
    qaPrefetch: summary.qaPrefetch,
    referralQa: summary.referralQa,
  };
}

export function toBatchSummaryResponse(batch: BatchRecord) {
  const counts = countPatientsByStatus(batch);

  return {
    ...toSubsidiarySummary(batch),
    batchId: batch.id,
    currentBatchStatus: batch.status,
    currentExecutionStep: deriveCurrentExecutionStep(batch),
    totalWorkItems: counts.totalWorkItems,
    totalCompleted: counts.totalCompleted,
    totalBlocked: counts.totalBlocked,
    totalFailed: counts.totalFailed,
    totalNeedsHumanReview: counts.totalNeedsHumanReview,
    percentComplete: counts.percentComplete,
    currentlyRunningCount: counts.currentlyRunningCount,
    createdAt: batch.createdAt,
    startedAt: batch.run.requestedAt ?? batch.parse.requestedAt ?? batch.createdAt,
    completedAt: batch.run.completedAt,
    lastUpdatedAt: batch.updatedAt,
    errorSummary: deriveBatchErrorSummary(batch),
    runMode: batch.runMode,
    rerunEnabled: batch.schedule.rerunEnabled && batch.schedule.active,
    lastRunAt: batch.schedule.lastRunAt,
    nextScheduledRunAt: batch.schedule.nextScheduledRunAt,
  };
}

export {
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
};
