import type {
  ArtifactRecord,
  DocumentInventoryItem,
  OasisQaOverallStatus,
  OasisQaSection,
  OasisQaSummary,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientProcessingStatus,
  QaChecklistItem,
  QaChecklistStatus,
  QaFinding,
  QaOutcome,
  StageStatus,
} from "@medical-ai-qa/shared-types";
import type { ExtractedDocument } from "./documentExtractionService";
import { extractOasisFields } from "./oasisFieldExtractor";
import { extractPocFields } from "./pocExtractor";
import { extractTechnicalReview } from "./technicalReviewExtractor";
import { extractVisitNoteFields } from "./visitNoteExtractor";

const terminalPatientStatuses: PatientProcessingStatus[] = [
  "COMPLETE",
  "BLOCKED",
  "FAILED",
  "NEEDS_HUMAN_REVIEW",
];

function createChecklistItem(input: {
  key: string;
  label: string;
  status: QaChecklistStatus;
  notes?: string | null;
  evidence?: string[];
}): QaChecklistItem {
  return {
    key: input.key,
    label: input.label,
    status: input.status,
    notes: input.notes ?? null,
    evidence: input.evidence ?? [],
  };
}

function deriveSectionStatus(items: QaChecklistItem[]): OasisQaSection["status"] {
  if (items.some((item) => item.status === "FAIL")) {
    return "FAIL";
  }

  if (items.some((item) => item.status === "MISSING")) {
    return "MISSING";
  }

  return items.some((item) => item.status === "NEEDS_REVIEW") ? "NEEDS_REVIEW" : "PASS";
}

function createSection(
  key: OasisQaSection["key"],
  label: string,
  items: QaChecklistItem[],
): OasisQaSection {
  return {
    key,
    label,
    status: deriveSectionStatus(items),
    items,
  };
}

function mapStageStatusToChecklistStatus(status: StageStatus): QaChecklistStatus {
  switch (status) {
    case "DONE":
      return "PASS";
    case "REVIEW_REQUIRED":
      return "FAIL";
    case "IN_PROGRESS":
      return "NEEDS_REVIEW";
    default:
      return "MISSING";
  }
}

function getDocumentsByType(
  documents: ExtractedDocument[],
  type: ExtractedDocument["type"],
): ExtractedDocument[] {
  return documents.filter((document) => document.type === type);
}

function deriveUrgency(daysLeft: number | null): OasisQaSummary["urgency"] {
  if (daysLeft !== null && daysLeft <= 0) {
    return "OVERDUE";
  }

  if (daysLeft !== null && daysLeft <= 7) {
    return "DUE_SOON";
  }

  return "ON_TRACK";
}

function deriveCurrentOverallStatus(
  processingStatus: PatientProcessingStatus,
  sections: OasisQaSection[],
  blockers: string[],
): OasisQaOverallStatus {
  if (!terminalPatientStatuses.includes(processingStatus)) {
    return "IN_PROGRESS";
  }

  if (blockers.length > 0) {
    return "BLOCKED";
  }

  if (sections.some((section) => section.status === "NEEDS_REVIEW")) {
    return "NEEDS_QA";
  }

  return "READY_FOR_BILLING";
}

function deriveBlockers(sections: OasisQaSection[]): string[] {
  return Array.from(
    new Set(
      sections
        .filter((section) => section.key !== "final_check")
        .flatMap((section) =>
          section.items
            .filter((item) => item.status === "FAIL" || item.status === "MISSING")
            .map((item) => item.label),
        ),
    ),
  );
}

function mapOverallStatusToQaOutcome(
  overallStatus: OasisQaOverallStatus,
  matchResult: PatientMatchResult,
): QaOutcome {
  if (matchResult.status === "AMBIGUOUS") {
    return "AMBIGUOUS_PATIENT";
  }

  if (matchResult.status === "NOT_FOUND") {
    return "PORTAL_NOT_FOUND";
  }

  if (matchResult.status === "ERROR") {
    return "PORTAL_MISMATCH";
  }

  switch (overallStatus) {
    case "READY_FOR_BILLING":
      return "READY_FOR_BILLING_PREP";
    case "BLOCKED":
      return "MISSING_DOCUMENTS";
    case "IN_PROGRESS":
      return "INCOMPLETE";
    default:
      return "NEEDS_MANUAL_QA";
  }
}

function buildFindings(summary: OasisQaSummary, matchResult: PatientMatchResult): QaFinding[] {
  const findings: QaFinding[] = [];

  if (matchResult.status === "AMBIGUOUS") {
    findings.push({
      ruleId: "patient.match.ambiguous",
      stage: "TECHNICAL_REVIEW",
      outcome: "AMBIGUOUS_PATIENT",
      message: "Portal patient search returned ambiguous matches.",
      evidence: matchResult.candidateNames,
    });
  } else if (matchResult.status === "NOT_FOUND") {
    findings.push({
      ruleId: "patient.match.not-found",
      stage: "TECHNICAL_REVIEW",
      outcome: "PORTAL_NOT_FOUND",
      message: "Portal patient search completed, but the patient is not currently available in portal results.",
      evidence: [matchResult.searchQuery, ...(matchResult.note ? [matchResult.note] : [])],
    });
  } else if (matchResult.status === "ERROR") {
    findings.push({
      ruleId: "patient.match.portal-mismatch",
      stage: "TECHNICAL_REVIEW",
      outcome: "PORTAL_MISMATCH",
      message: "Patient search could not complete cleanly in the portal automation flow.",
      evidence: [matchResult.searchQuery, ...(matchResult.note ? [matchResult.note] : [])],
    });
  }

  for (const section of summary.sections) {
    if (section.status === "PASS") {
      continue;
    }

    const stage =
      section.key === "coding"
        ? "CODING_REVIEW"
        : section.key === "oasis"
          ? "OASIS_QA"
          : section.key === "poc"
            ? "POC_QA"
            : section.key === "visit_notes"
              ? "VISIT_NOTES_REVIEW"
              : section.key === "technical_review"
                ? "TECHNICAL_REVIEW"
                : "FINAL_BILLING_PREP_READINESS";

    findings.push({
      ruleId: `oasis-qa.${section.key}.${section.status.toLowerCase()}`,
      stage,
      outcome: mapOverallStatusToQaOutcome(summary.overallStatus, matchResult),
      message: `${section.label} is ${section.status.toLowerCase().replace(/_/g, " ")}.`,
      evidence: section.items
        .filter((item) => item.status === "FAIL" || item.status === "MISSING")
        .map((item) => item.label),
    });
  }

  if (findings.length === 0) {
    findings.push({
      ruleId: "oasis-qa.ready-for-billing",
      stage: "FINAL_BILLING_PREP_READINESS",
      outcome: "READY_FOR_BILLING_PREP",
      message: "Critical OASIS QA sections are complete and ready for billing prep.",
      evidence: summary.sections.map((section) => section.label),
    });
  }

  return findings;
}

function artifactOrDocumentItem(input: {
  key: string;
  label: string;
  documents: ExtractedDocument[];
  notesWhenMissing: string;
}): QaChecklistItem {
  return createChecklistItem({
    key: input.key,
    label: input.label,
    status: input.documents.length > 0 ? "PASS" : "MISSING",
    notes:
      input.documents.length > 0
        ? `${input.documents.length} supporting document(s) extracted.`
        : input.notesWhenMissing,
    evidence: input.documents.slice(0, 3).map((document) =>
      `${document.type} ${document.metadata.sourcePath ?? document.metadata.portalLabel ?? "content"}`
        .trim(),
    ),
  });
}

function booleanExtractionItem(input: {
  key: string;
  label: string;
  present: boolean;
  documentsAvailable: boolean;
  evidence: string[];
  failNote: string;
}): QaChecklistItem {
  return createChecklistItem({
    key: input.key,
    label: input.label,
    status: input.present ? "PASS" : input.documentsAvailable ? "FAIL" : "MISSING",
    notes: input.present
      ? "Requirement confirmed from extracted document content."
      : input.documentsAvailable
        ? input.failNote
        : "Supporting document content is not available.",
    evidence: input.evidence,
  });
}

export function buildOasisQaSummary(input: {
  workItem: PatientEpisodeWorkItem;
  matchResult: PatientMatchResult;
  artifacts: ArtifactRecord[];
  processingStatus: PatientProcessingStatus;
  extractedDocuments?: ExtractedDocument[];
  documentInventory?: DocumentInventoryItem[];
}): OasisQaSummary {
  const { workItem, matchResult, processingStatus } = input;
  const extractedDocuments = input.extractedDocuments ?? [];
  const documentInventory = input.documentInventory ?? [];
  const oasisDocuments = getDocumentsByType(extractedDocuments, "OASIS");
  const pocDocuments = getDocumentsByType(extractedDocuments, "POC");
  const visitNoteDocuments = getDocumentsByType(extractedDocuments, "VISIT_NOTE");
  const orderDocuments = getDocumentsByType(extractedDocuments, "ORDER");
  const daysLeft =
    workItem.timingMetadata?.daysLeftBeforeOasisDueDate ??
    workItem.timingMetadata?.daysLeft ??
    workItem.timingMetadata?.trackingDays ??
    null;
  const daysInPeriod = workItem.timingMetadata?.daysInPeriod ?? (daysLeft !== null ? 30 : null);
  const urgency = deriveUrgency(daysLeft);
  const oasisExtract = extractOasisFields(extractedDocuments);
  const pocExtract = extractPocFields(extractedDocuments);
  const visitNoteExtract = extractVisitNoteFields(extractedDocuments);
  const technicalExtract = extractTechnicalReview(input.artifacts, extractedDocuments, documentInventory);

  const timingSection = createSection("timing", "Timing / OASIS Due", [
    createChecklistItem({
      key: "days_in_period",
      label: "Days in the 30-day period captured",
      status: daysInPeriod !== null ? "PASS" : "FAIL",
      notes:
        daysInPeriod !== null
          ? `Workbook shows ${daysInPeriod} days in period.`
          : "Column H was not captured for this patient.",
      evidence: daysInPeriod !== null ? [`Workbook days in period: ${daysInPeriod}`] : [],
    }),
    createChecklistItem({
      key: "days_left",
      label: "Days left before OASIS due date verified",
      status:
        daysLeft === null ? "FAIL" : daysLeft <= 0 ? "FAIL" : "PASS",
      notes:
        daysLeft === null
          ? "Column I or equivalent days-left value was not captured."
          : daysLeft <= 0
            ? `OASIS due date is overdue by ${Math.abs(daysLeft)} day(s).`
            : `${daysLeft} day(s) remain before OASIS is due.`,
      evidence: daysLeft !== null ? [`Workbook days left: ${daysLeft}`] : [],
    }),
    createChecklistItem({
      key: "urgency_bucket",
      label: "Urgency bucket",
      status: daysLeft !== null && daysLeft > 0 ? "PASS" : "FAIL",
      notes: urgency.replace(/_/g, " "),
      evidence: daysLeft !== null ? [`Derived urgency from ${daysLeft} day(s) left.`] : [],
    }),
  ]);

  const codingSection = createSection("coding", "Coding Review", [
    createChecklistItem({
      key: "coding_review_complete",
      label: "Coding review completed in workbook",
      status: mapStageStatusToChecklistStatus(workItem.codingReviewStatus),
      notes: `Workbook status: ${workItem.codingReviewStatus}`,
      evidence: [workItem.codingReviewStatus],
    }),
    createChecklistItem({
      key: "coding_supported_by_oasis",
      label: "OASIS content is available to support coding review",
      status: oasisDocuments.length > 0 ? "PASS" : "MISSING",
      notes:
        oasisDocuments.length > 0
          ? "OASIS content extracted for coding review support."
          : "No OASIS content was extracted for coding validation.",
      evidence: oasisDocuments.map((document) =>
        `${document.type} ${document.metadata.sourcePath ?? document.metadata.portalLabel ?? "content"}`.trim(),
      ),
    }),
  ]);

  const oasisSection = createSection("oasis", "OASIS QA", [
    artifactOrDocumentItem({
      key: "oasis_document",
      label: "OASIS document content extracted",
      documents: oasisDocuments,
      notesWhenMissing: "No OASIS document content was available for extraction.",
    }),
    createChecklistItem({
      key: "oasis_workbook_status",
      label: "OASIS QA completed in workbook",
      status: mapStageStatusToChecklistStatus(workItem.oasisQaStatus),
      notes: `Workbook status: ${workItem.oasisQaStatus}`,
      evidence: [workItem.oasisQaStatus],
    }),
    booleanExtractionItem({
      key: "medical_necessity",
      label: "Medical necessity is stated",
      present: oasisExtract.medicalNecessity,
      documentsAvailable: oasisDocuments.length > 0,
      evidence: oasisExtract.evidence.medicalNecessity.map((entry) =>
        `Found medical-necessity evidence: ${entry}`,
      ),
      failNote: "OASIS text did not show medical necessity language.",
    }),
    booleanExtractionItem({
      key: "homebound_reason",
      label: "Homebound reason is stated",
      present: oasisExtract.homeboundReason,
      documentsAvailable: oasisDocuments.length > 0,
      evidence: oasisExtract.evidence.homeboundReason.map((entry) =>
        `Found homebound evidence: ${entry}`,
      ),
      failNote: "OASIS text did not show a homebound reason.",
    }),
    booleanExtractionItem({
      key: "health_assessment",
      label: "Health assessment is documented",
      present: oasisExtract.healthAssessment,
      documentsAvailable: oasisDocuments.length > 0,
      evidence: oasisExtract.evidence.healthAssessment.map((entry) =>
        `Found assessment evidence: ${entry}`,
      ),
      failNote: "OASIS text did not show a health assessment section or phrase.",
    }),
    booleanExtractionItem({
      key: "skilled_interventions",
      label: "Skilled interventions during the OASIS visit are documented",
      present: oasisExtract.skilledInterventions,
      documentsAvailable: oasisDocuments.length > 0,
      evidence: oasisExtract.evidence.skilledInterventions.map((entry) =>
        `Found skilled-intervention evidence: ${entry}`,
      ),
      failNote: "OASIS text did not show skilled interventions performed during the visit.",
    }),
  ]);

  const pocSection = createSection("poc", "Plan Of Care QA", [
    artifactOrDocumentItem({
      key: "poc_document",
      label: "Plan of care content extracted",
      documents: pocDocuments,
      notesWhenMissing: "No plan-of-care content was available for extraction.",
    }),
    createChecklistItem({
      key: "poc_workbook_status",
      label: "POC QA completed in workbook",
      status: mapStageStatusToChecklistStatus(workItem.pocQaStatus),
      notes: `Workbook status: ${workItem.pocQaStatus}`,
      evidence: [workItem.pocQaStatus],
    }),
    booleanExtractionItem({
      key: "poc_diagnoses_codes",
      label: "Diagnoses or codes are present in the plan of care",
      present: pocExtract.diagnosesOrCodesPresent,
      documentsAvailable: pocDocuments.length > 0,
      evidence: pocExtract.evidence.diagnosesOrCodesPresent.map((entry) =>
        `Found diagnosis/code evidence: ${entry}`,
      ),
      failNote: "POC text did not clearly show diagnoses or codes.",
    }),
    booleanExtractionItem({
      key: "poc_interventions_goals_frequency",
      label: "Interventions, goals, and frequency are present in the plan of care",
      present: pocExtract.interventionsGoalsFrequencyPresent,
      documentsAvailable: pocDocuments.length > 0,
      evidence: pocExtract.evidence.interventionsGoalsFrequencyPresent.map((entry) =>
        `Found intervention/goal/frequency evidence: ${entry}`,
      ),
      failNote: "POC text did not clearly show interventions, goals, and frequency.",
    }),
    booleanExtractionItem({
      key: "poc_conditions_exacerbations",
      label: "Conditions or exacerbations are reflected in the plan of care",
      present: pocExtract.exacerbationsConditionsPresent,
      documentsAvailable: pocDocuments.length > 0,
      evidence: pocExtract.evidence.exacerbationsConditionsPresent.map((entry) =>
        `Found conditions/exacerbations evidence: ${entry}`,
      ),
      failNote: "POC text did not clearly show conditions or exacerbations.",
    }),
  ]);

  const visitNotesSection = createSection("visit_notes", "Visit Notes Review", [
    artifactOrDocumentItem({
      key: "visit_notes_document",
      label: "Visit note content extracted",
      documents: visitNoteDocuments,
      notesWhenMissing: "No visit-note content was available for extraction.",
    }),
    createChecklistItem({
      key: "visit_notes_workbook_status",
      label: "Visit notes review completed in workbook",
      status: mapStageStatusToChecklistStatus(workItem.visitNotesQaStatus),
      notes: `Workbook status: ${workItem.visitNotesQaStatus}`,
      evidence: [workItem.visitNotesQaStatus],
    }),
    booleanExtractionItem({
      key: "visit_notes_skilled_need",
      label: "Skilled need is clearly documented",
      present: visitNoteExtract.skilledNeed,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.skilledNeed.map((entry) =>
        `Found skilled-need evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not show skilled-need language.",
    }),
    booleanExtractionItem({
      key: "visit_notes_intervention_detail",
      label: "Interventions performed are specific and detailed",
      present: visitNoteExtract.interventionDetail,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.interventionDetail.map((entry) =>
        `Found intervention evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not show intervention detail.",
    }),
    booleanExtractionItem({
      key: "visit_notes_patient_response",
      label: "Patient response to interventions is documented",
      present: visitNoteExtract.patientResponse,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.patientResponse.map((entry) =>
        `Found patient-response evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not show patient response.",
    }),
    booleanExtractionItem({
      key: "visit_notes_progress",
      label: "Progress toward goals is noted",
      present: visitNoteExtract.progressTowardGoals,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.progressTowardGoals.map((entry) =>
        `Found progress evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not show progress toward goals.",
    }),
    booleanExtractionItem({
      key: "visit_notes_vitals",
      label: "Vitals and focused assessment are documented",
      present: visitNoteExtract.vitals,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.vitals.map((entry) =>
        `Found vitals evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not show vitals or focused assessment language.",
    }),
    booleanExtractionItem({
      key: "visit_notes_medication_review",
      label: "Medication review is documented",
      present: visitNoteExtract.medicationReview,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.medicationReview.map((entry) =>
        `Found medication-review evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not show medication review or changes.",
    }),
    booleanExtractionItem({
      key: "visit_notes_condition_changes",
      label: "Changes in condition are clearly reported and addressed",
      present: visitNoteExtract.conditionChanges,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.conditionChanges.map((entry) =>
        `Found condition-change evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not clearly show changes in condition.",
    }),
    booleanExtractionItem({
      key: "visit_notes_billed_services_support",
      label: "Documentation supports billed services",
      present: visitNoteExtract.billedServicesSupport,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.billedServicesSupport.map((entry) =>
        `Found billed-services support evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not clearly support billed services.",
    }),
    booleanExtractionItem({
      key: "visit_notes_consistency",
      label: "Documentation remains consistent with OASIS and diagnoses",
      present: visitNoteExtract.consistencyWithDiagnoses,
      documentsAvailable: visitNoteDocuments.length > 0,
      evidence: visitNoteExtract.evidence.consistencyWithDiagnoses.map((entry) =>
        `Found consistency evidence: ${entry}`,
      ),
      failNote: "Visit-note text did not clearly show consistency with OASIS or diagnoses.",
    }),
  ]);

  const technicalSection = createSection("technical_review", "Technical Review", [
    createChecklistItem({
      key: "portal_patient_match",
      label: "Portal patient match resolved",
      status:
        matchResult.status === "EXACT"
          ? "PASS"
          : matchResult.status === "AMBIGUOUS"
            ? "FAIL"
            : "MISSING",
      notes: matchResult.note ?? `Portal match status: ${matchResult.status}`,
      evidence: [
        matchResult.searchQuery,
        ...matchResult.candidateNames,
        ...(matchResult.portalPatientId ? [matchResult.portalPatientId] : []),
      ],
    }),
    createChecklistItem({
      key: "sn_visit_count",
      label: "SN visits were identified from visit-note content",
      status: technicalExtract.snVisitCount > 0 ? "PASS" : visitNoteDocuments.length > 0 ? "FAIL" : "MISSING",
      notes:
        technicalExtract.snVisitCount > 0
          ? `Detected ${technicalExtract.snVisitCount} SN visit reference(s).`
          : visitNoteDocuments.length > 0
            ? "No SN visit references were detected in visit-note content."
            : "Visit-note content is not available.",
      evidence: technicalExtract.evidence.snVisitCount,
    }),
    createChecklistItem({
      key: "discipline_detection",
      label: "Applicable disciplines were detected",
      status: visitNoteDocuments.length > 0 ? "PASS" : "MISSING",
      notes:
        technicalExtract.disciplines.length > 0
          ? `Detected disciplines: ${technicalExtract.disciplines.join(", ")}`
          : visitNoteDocuments.length > 0
            ? "No additional PT/OT/ST/HHA/RD/MSW disciplines were detected in extracted visit-note content."
            : "Visit-note content is not available for discipline detection.",
      evidence: technicalExtract.evidence.disciplines,
    }),
    createChecklistItem({
      key: "physician_orders",
      label: "Physician orders were checked",
      status: technicalExtract.physicianOrders ? "PASS" : orderDocuments.length > 0 || technicalExtract.orderCount > 0 ? "NEEDS_REVIEW" : "NOT_APPLICABLE",
      notes:
        technicalExtract.physicianOrders || orderDocuments.length > 0 || technicalExtract.orderCount > 0
          ? `Orders evidence was discovered (${Math.max(orderDocuments.length, technicalExtract.orderCount)} candidate(s)).`
          : "No additional physician orders were discovered for this patient.",
      evidence: [...technicalExtract.evidence.physicianOrders, ...technicalExtract.evidence.orderCount],
    }),
    createChecklistItem({
      key: "supporting_notes",
      label: "Supporting note categories were reviewed",
      status:
        technicalExtract.summaries ||
        technicalExtract.supervisoryVisits ||
        technicalExtract.communicationNotes ||
        technicalExtract.missedVisits ||
        technicalExtract.infectionOrFallReports
          ? "PASS"
          : "NOT_APPLICABLE",
      notes:
        technicalExtract.summaries ||
        technicalExtract.supervisoryVisits ||
        technicalExtract.communicationNotes ||
        technicalExtract.missedVisits ||
        technicalExtract.infectionOrFallReports
          ? "One or more supporting note categories were discovered."
          : "No additional supporting note categories were discovered for this patient.",
      evidence: [
        ...technicalExtract.evidence.summaries,
        ...technicalExtract.evidence.summaryCount,
        ...technicalExtract.evidence.supervisoryVisits,
        ...technicalExtract.evidence.supervisoryCount,
        ...technicalExtract.evidence.communicationNotes,
        ...technicalExtract.evidence.communicationCount,
        ...technicalExtract.evidence.missedVisits,
        ...technicalExtract.evidence.missedVisitCount,
        ...technicalExtract.evidence.infectionOrFallReports,
      ],
    }),
  ]);

  const sectionsBeforeFinal = [
    timingSection,
    codingSection,
    oasisSection,
    pocSection,
    visitNotesSection,
    technicalSection,
  ];
  const blockers = deriveBlockers(sectionsBeforeFinal);

  const finalCheckSection = createSection("final_check", "Final Check", [
    createChecklistItem({
      key: "critical_sections_clear",
      label: "Critical QA sections are complete before billing prep",
      status: blockers.length === 0 ? "PASS" : "FAIL",
      notes:
        blockers.length === 0
          ? "No critical QA blockers remain."
          : `Blocking sections: ${blockers.join(", ")}`,
      evidence: sectionsBeforeFinal.map((section) => `${section.label}: ${section.status}`),
    }),
    createChecklistItem({
      key: "billing_prep_status",
      label: "Billing prep status in workbook",
      status: mapStageStatusToChecklistStatus(workItem.billingPrepStatus),
      notes: `Workbook status: ${workItem.billingPrepStatus}`,
      evidence: [workItem.billingPrepStatus],
    }),
  ]);

  const sections = [...sectionsBeforeFinal, finalCheckSection];
  const allBlockers = deriveBlockers(sections);

  return {
    overallStatus: deriveCurrentOverallStatus(processingStatus, sections, allBlockers),
    urgency,
    daysInPeriod,
    daysLeft,
    sections,
    blockers: allBlockers,
  };
}

export function evaluateOasisQa(input: {
  workItem: PatientEpisodeWorkItem;
  matchResult: PatientMatchResult;
  artifacts: ArtifactRecord[];
  processingStatus: PatientProcessingStatus;
  extractedDocuments?: ExtractedDocument[];
  documentInventory?: DocumentInventoryItem[];
}) {
  const oasisQaSummary = buildOasisQaSummary(input);
  const qaOutcome = mapOverallStatusToQaOutcome(oasisQaSummary.overallStatus, input.matchResult);
  const findings = buildFindings(oasisQaSummary, input.matchResult);

  return {
    findings,
    qaOutcome,
    oasisQaSummary,
  };
}
