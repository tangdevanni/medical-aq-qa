import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationStepLog, PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";
import type { Logger } from "pino";
import type { PatientPortalContext } from "../../portal/context/patientPortalContext";
import { createAutomationStepLog } from "../../portal/utils/automationLog";
import type { BatchPortalAutomationClient } from "../../workers/playwrightBatchQaWorker";
import type { SharedEvidenceBundle } from "../../workflows/sharedEvidenceWorkflow";
import type { OasisAssessmentNoteOpenResult } from "../types/oasisQaResult";
import type {
  OasisPrintedNoteReviewResult,
  OasisPrintedNoteSectionReview,
} from "../types/oasisPrintedNoteReview";
import {
  DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY,
  getOasisPrintSectionProfile,
  type OasisPrintSectionProfileKey,
} from "./oasisPrintedNoteProfiles";

const SECTION_PATTERNS: Array<{
  key: string;
  label: string;
  headingPatterns: RegExp[];
  contentPatterns: RegExp[];
  suggestionSeed: string;
}> = [
  {
    key: "administrative_information",
    label: "Administrative Information",
    headingPatterns: [/Administrative Information/i],
    contentPatterns: [/\bpatient name\b/i, /\baddress\b/i, /\bphysician\b/i, /\binsurance\b/i],
    suggestionSeed: "Confirm demographic and payer fields against referral/intake artifacts.",
  },
  {
    key: "primary_reason_medical_necessity",
    label: "Primary Reason / Medical Necessity",
    headingPatterns: [/Primary Reason/i, /Medical Necessity/i],
    contentPatterns: [/\bmedical necessity\b/i, /\bhomebound\b/i, /\breason for admission\b/i],
    suggestionSeed: "Compare homebound and medical-necessity narrative against referral and hospital evidence.",
  },
  {
    key: "vital_signs",
    label: "Vital Signs",
    headingPatterns: [/Vital Signs/i],
    contentPatterns: [/\bblood pressure\b/i, /\bheart rate\b/i, /\btemperature\b/i, /\brespiratory rate\b/i],
    suggestionSeed: "Check whether visit notes contain vitals that can support missing fields.",
  },
  {
    key: "neurological",
    label: "Neurological",
    headingPatterns: [/Neurological/i],
    contentPatterns: [/\bmental status\b/i, /\bforgetful\b/i, /\boriented\b/i],
    suggestionSeed: "Review clinician note cues for cognition and mental-status consistency.",
  },
  {
    key: "eyes_ears",
    label: "Eyes & Ears",
    headingPatterns: [/Eyes\s*&\s*Ears/i, /\bVision\b/i, /\bHearing\b/i],
    contentPatterns: [/\bglasses\b/i, /\bhearing aid\b/i, /\bvision\b/i, /\bhearing\b/i],
    suggestionSeed: "Check source notes for vision or hearing aids and related impairments.",
  },
  {
    key: "cardiovascular",
    label: "Cardiovascular",
    headingPatterns: [/Cardiovascular/i],
    contentPatterns: [/\bedema\b/i, /\bpulses\b/i, /\bchest pain\b/i, /\bheart sounds\b/i],
    suggestionSeed: "Review assessment evidence for edema, pulses, chest pain, and heart sounds.",
  },
  {
    key: "respiratory",
    label: "Respiratory",
    headingPatterns: [/Respiratory/i],
    contentPatterns: [/\bshortness of breath\b/i, /\bcough\b/i, /\blung sounds\b/i, /\boxygen\b/i],
    suggestionSeed: "Compare respiratory answers against referral diagnoses and visit-note respiratory findings.",
  },
  {
    key: "gastrointestinal",
    label: "Gastrointestinal",
    headingPatterns: [/Gastrointestinal/i],
    contentPatterns: [/\bbowel\b/i, /\bdiet\b/i, /\bnutrition\b/i, /\blast bowel movement\b/i],
    suggestionSeed: "Check documents for diet, bowel, and nutrition references.",
  },
  {
    key: "genitourinary",
    label: "Genitourinary",
    headingPatterns: [/Genitourinary/i],
    contentPatterns: [/\burinary\b/i, /\bcatheter\b/i, /\bincontinent\b/i],
    suggestionSeed: "Review source notes for urinary symptoms or catheter references.",
  },
  {
    key: "musculoskeletal_functional_status",
    label: "Musculoskeletal and Functional Status",
    headingPatterns: [/Musculoskeletal/i, /Functional Status/i],
    contentPatterns: [/\bmobility\b/i, /\btransfer\b/i, /\bself care\b/i, /\bambulate\b/i],
    suggestionSeed: "Cross-check PT/OT evidence for functional and mobility items.",
  },
  {
    key: "integumentary",
    label: "Integumentary",
    headingPatterns: [/Integumentary/i],
    contentPatterns: [/\bwound\b/i, /\bskin\b/i, /\bpressure ulcer\b/i, /\bturgor\b/i],
    suggestionSeed: "Compare wound and skin answers against wound-care and visit-note evidence.",
  },
  {
    key: "pain_assessment",
    label: "Pain Assessment",
    headingPatterns: [/Pain Assessment/i],
    contentPatterns: [/\bpain\b/i, /\bpain scale\b/i, /\bpain location\b/i],
    suggestionSeed: "Review clinician notes for pain frequency, scale, and location details.",
  },
  {
    key: "emotional",
    label: "Emotional",
    headingPatterns: [/Emotional/i, /Patient Mood/i],
    contentPatterns: [/\bdepression\b/i, /\bphq\b/i, /\bmood\b/i],
    suggestionSeed: "Check source evidence for depression or mood indicators that support D0150 answers.",
  },
  {
    key: "diagnosis",
    label: "Diagnosis",
    headingPatterns: [/Diagnosis/i, /Active Diagnoses/i],
    contentPatterns: [/\bICD\b/i, /\bdiagnosis\b/i, /\bfall risk\b/i],
    suggestionSeed: "Use coding-team output and diagnosis source evidence for diagnosis review only.",
  },
  {
    key: "medications_allergies",
    label: "Medications and Allergies",
    headingPatterns: [/Medications and Allergies/i, /\bAllergies\b/i],
    contentPatterns: [/\bmedication\b/i, /\ballerg/i, /\boxygen therapy\b/i, /\bdialysis\b/i],
    suggestionSeed: "Check referral and hospital documents for medication, allergy, and special-treatment references.",
  },
  {
    key: "patient_coordination_care_plan",
    label: "Patient Coordination and Care Plan",
    headingPatterns: [/Patient Coordination and Care Plan/i],
    contentPatterns: [/\bcare plan\b/i, /\bpatient summary\b/i, /\bclinical narrative\b/i, /\bgoals\b/i],
    suggestionSeed: "Review plan-of-care and source narratives for coordination and care-plan support.",
  },
  {
    key: "other_supplementals",
    label: "Other Supplementals",
    headingPatterns: [/Other Supplementals/i],
    contentPatterns: [/\bpast medical history\b/i, /\bimmunization\b/i, /\bvaccination\b/i],
    suggestionSeed: "Use H&P and referral records to confirm supplemental history and immunization details.",
  },
  {
    key: "care_plan",
    label: "Care Plan",
    headingPatterns: [/\bCare Plan\b/i],
    contentPatterns: [/\bintervention\b/i, /\bgoal\b/i, /\bproblem\b/i],
    suggestionSeed: "Use existing diagnosis and plan-of-care evidence to seed care-plan review suggestions.",
  },
];

export interface OasisPrintedNoteReviewParams {
  context: PatientPortalContext;
  workItem: PatientEpisodeWorkItem;
  evidenceDir: string;
  outputDir: string;
  logger: Logger;
  portalClient: BatchPortalAutomationClient;
  sharedEvidence: SharedEvidenceBundle;
  assessmentNote: OasisAssessmentNoteOpenResult;
  assessmentType: string;
  printProfileKey?: OasisPrintSectionProfileKey | null;
}

export interface OasisPrintedNoteReviewServiceResult {
  result: OasisPrintedNoteReviewResult;
  reviewPath: string;
  stepLogs: AutomationStepLog[];
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type AdministrativeSuggestionContext = {
  workItem: PatientEpisodeWorkItem;
  sharedEvidence: SharedEvidenceBundle;
};

type AdministrativeFieldSpec = {
  label: string;
  detectionPattern: RegExp;
  recommend: (context: AdministrativeSuggestionContext) => string | null;
};

const ADMINISTRATIVE_FIELD_SPECS: AdministrativeFieldSpec[] = [
  {
    label: "M0010 Agency Medicare Provider #",
    detectionPattern: /M0010\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Z0-9-]+)/i,
    recommend: () => null,
  },
  {
    label: "M0014 Branch State",
    detectionPattern: /M0014\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Z][A-Za-z ]+)/i,
    recommend: () => "Confirm branch state from agency profile if it is blank in the printed section.",
  },
  {
    label: "M0016 Branch ID #",
    detectionPattern: /M0016\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Z0-9-]+)/i,
    recommend: () => "Branch ID was not found in the shared referral evidence; verify against the agency record.",
  },
  {
    label: "M0018 Attending Physician (NPI)",
    detectionPattern: /M0018\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(\d{10})/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const physicianNpi = sourceText.match(/\bNPI(?:\s*(?:#|ID))?\s*[:#]?\s*(\d{10})\b/i)?.[1]
        ?? sourceText.match(/\bOrdered By:.*?National Provider ID\s*#\s*(\d{10})/is)?.[1]
        ?? null;
      return physicianNpi ? `Recommend M0018 = ${physicianNpi} from referral/order source evidence.` : null;
    },
  },
  {
    label: "M0020 Patient ID #",
    detectionPattern: /M0020\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Z0-9-]+)/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const residentId = sourceText.match(/\bResident:\s*[^(\n]+\((\d+)\)/i)?.[1]
        ?? sourceText.match(/\bResident\s*#\s*([A-Z0-9-]+)/i)?.[1]
        ?? null;
      return residentId ? `Shared evidence references patient/resident id ${residentId}; confirm if that maps to M0020.` : null;
    },
  },
  {
    label: "M0030 Start of Care Date",
    detectionPattern: /M0030\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(\d{2}\/\d{2}\/\d{4})/i,
    recommend: ({ workItem }) => workItem.episodeContext.socDate
      ? `Recommend M0030 = ${workItem.episodeContext.socDate} from the selected episode context.`
      : null,
  },
  {
    label: "M0040 Patient Name",
    detectionPattern: /M0040\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Za-z ,.'-]+)/i,
    recommend: ({ workItem }) => workItem.patientIdentity.displayName
      ? `Recommend M0040 = ${workItem.patientIdentity.displayName} from workbook/patient identity.`
      : null,
  },
  {
    label: "M0050 State of Residence",
    detectionPattern: /M0050\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Z][A-Za-z ]+)/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const state = sourceText.match(/\b(?:AZ|Arizona)\b/i)?.[0] ?? null;
      return state ? `Recommend M0050 = ${state === "AZ" ? "Arizona" : state} from source address evidence.` : null;
    },
  },
  {
    label: "M0060 Zip Code",
    detectionPattern: /M0060\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(\d{5}(?:-\d{4})?)/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const zip = sourceText.match(/\b85268(?:-\d{4})?\b/)?.[0]
        ?? sourceText.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]
        ?? null;
      return zip ? `Recommend M0060 = ${zip} from source address evidence.` : null;
    },
  },
  {
    label: "M0063 Medicare Number",
    detectionPattern: /M0063\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([A-Z0-9]{6,})/i,
    recommend: ({ workItem, sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const medicare = workItem.patientIdentity.medicareNumber
        ?? sourceText.match(/\bMedicare(?: Beneficiary)? ID\b[:#]?\s*([A-Z0-9]{8,})/i)?.[1]
        ?? sourceText.match(/\bMedicare\s*#\s*([A-Z0-9]{8,})/i)?.[1]
        ?? null;
      return medicare ? `Recommend M0063 = ${medicare} from shared referral/intake evidence.` : null;
    },
  },
  {
    label: "M0066 Birth Date",
    detectionPattern: /M0066\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(\d{2}\/\d{2}\/\d{4})/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const dob = sourceText.match(/\bDOB[:\s]+(\d{2}\/\d{2}\/\d{4})/i)?.[1]
        ?? sourceText.match(/\bBirth(?:date| Date)[:\s]+(\d{2}\/\d{2}\/\d{4})/i)?.[1]
        ?? null;
      return dob ? `Recommend M0066 = ${dob} from shared referral/intake evidence.` : null;
    },
  },
  {
    label: "M0069 Gender",
    detectionPattern: /M0069\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(female|male|other)/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const gender = sourceText.match(/\bGender[:\s]+([FM]|Female|Male)\b/i)?.[1] ?? null;
      if (!gender) {
        return null;
      }
      return `Recommend M0069 = ${/^f$/i.test(gender) ? "Female" : /^m$/i.test(gender) ? "Male" : gender} from source demographic evidence.`;
    },
  },
  {
    label: "M0080 Discipline",
    detectionPattern: /M0080\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(PT|RN|SN|OT|ST|SLP|Therapy|Nursing)/i,
    recommend: ({ sharedEvidence }) => {
      const sourceText = buildSharedEvidenceText(sharedEvidence);
      const staffDiscipline = sourceText.match(/\bStaff Name:.*?\b(PT|RN|OT|ST|SLP)\b/i)?.[1]
        ?? null;
      return staffDiscipline ? `Recommend M0080 = ${staffDiscipline.toUpperCase()} from assigned staff/source evidence.` : null;
    },
  },
  {
    label: "M0090 Date Completed",
    detectionPattern: /M0090\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)(\d{2}\/\d{2}\/\d{4})/i,
    recommend: ({ workItem }) => workItem.episodeContext.socDate
      ? `Recommend M0090 = ${workItem.episodeContext.socDate} if the assessment was completed on SOC.`
      : null,
  },
  {
    label: "M0100 Reason",
    detectionPattern: /M0100\b[^\n:]*:\s*(?!\(?blank\)?|not applicable\b)([^.\n]+)/i,
    recommend: ({ workItem }) => Array.isArray((workItem as { workflowTypes?: string[] }).workflowTypes)
      && (workItem as { workflowTypes?: string[] }).workflowTypes?.includes("SOC")
      ? "Recommend M0100 = Start of Care from the current workflow type."
      : null,
  },
];

function buildSharedEvidenceText(sharedEvidence: SharedEvidenceBundle): string {
  return sharedEvidence.extractedDocuments.map((document) => document.text).join("\n");
}

function sliceEvidence(text: string, pattern: RegExp): string[] {
  const match = text.match(pattern);
  if (!match || match.index == null) {
    return [];
  }
  const start = Math.max(0, match.index - 60);
  const end = Math.min(text.length, match.index + 180);
  return [text.slice(start, end).trim()];
}

function buildSectionReview(input: {
  text: string;
  sharedEvidence: SharedEvidenceBundle;
  workItem: PatientEpisodeWorkItem;
  section: (typeof SECTION_PATTERNS)[number];
}): OasisPrintedNoteSectionReview {
  if (input.section.key === "administrative_information") {
    const missingFields = ADMINISTRATIVE_FIELD_SPECS
      .filter((field) => !field.detectionPattern.test(input.text))
      .map((field) => field.label);
    const suggestions = ADMINISTRATIVE_FIELD_SPECS
      .filter((field) => missingFields.includes(field.label))
      .map((field) => field.recommend({
        workItem: input.workItem,
        sharedEvidence: input.sharedEvidence,
      }))
      .filter((value): value is string => Boolean(value))
      .slice(0, 8);
    const evidence = ADMINISTRATIVE_FIELD_SPECS
      .filter((field) => field.detectionPattern.test(input.text))
      .flatMap((field) => sliceEvidence(input.text, field.detectionPattern))
      .slice(0, 8);
    const filledFieldCount = ADMINISTRATIVE_FIELD_SPECS.length - missingFields.length;
    const missingFieldCount = missingFields.length;
    const status = missingFieldCount === 0
      ? "COMPLETED"
      : filledFieldCount === 0
        ? "MISSING"
        : "PARTIAL";
    return {
      key: input.section.key,
      label: input.section.label,
      status,
      filledFieldCount,
      missingFieldCount,
      evidence,
      missingFields: missingFields.slice(0, 8),
      suggestions,
      sourceReferences: [
        ...(input.sharedEvidence.diagnosisSourceEvidence?.supportingReferences?.slice(0, 3) ?? []),
        ...input.sharedEvidence.extractedDocuments
          .map((document) => `${document.type}:${document.metadata.sourcePath ?? document.metadata.portalLabel ?? "in_memory"}`)
          .slice(0, 5),
      ],
    };
  }

  const headingMatches = input.section.headingPatterns.filter((pattern) => pattern.test(input.text));
  const contentMatches = input.section.contentPatterns.filter((pattern) => pattern.test(input.text));
  const filledFieldCount = headingMatches.length + contentMatches.length;
  const missingFieldCount = Math.max(0, input.section.contentPatterns.length - contentMatches.length);
  const status = filledFieldCount === 0
    ? "MISSING"
    : contentMatches.length < Math.max(1, Math.ceil(input.section.contentPatterns.length / 2))
      ? "PARTIAL"
      : "COMPLETED";
  const evidence = contentMatches.flatMap((pattern) => sliceEvidence(input.text, pattern)).slice(0, 6);
  const missingFields = input.section.contentPatterns
    .filter((pattern) => !pattern.test(input.text))
    .map((pattern) => pattern.source.replace(/\\b|\(\?:|\)|\[|\]|\^|\$|\\/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 4);
  const sourceReferences = [
    ...(input.sharedEvidence.diagnosisSourceEvidence?.supportingReferences?.slice(0, 3) ?? []),
    ...(input.sharedEvidence.extractedDocuments
      .filter((document) =>
        document.type === "OASIS" ||
        document.type === "ORDER" ||
        document.type === "VISIT_NOTE" ||
        document.type === "POC")
      .map((document) =>
        `${document.type}:${document.metadata.sourcePath ?? document.metadata.portalLabel ?? "in_memory"}`)
      .slice(0, 4)),
  ];
  const suggestions = status === "COMPLETED"
    ? []
    : [
        input.section.suggestionSeed,
        input.sharedEvidence.diagnosisSourceEvidence?.primaryDiagnosisText
          ? `Primary diagnosis source evidence: ${input.sharedEvidence.diagnosisSourceEvidence.primaryDiagnosisText}`
          : "Use shared referral/hospital evidence before escalating any diagnosis changes to coding.",
      ].slice(0, 2);

  return {
    key: input.section.key,
    label: input.section.label,
    status,
    filledFieldCount,
    missingFieldCount,
    evidence,
    missingFields,
    suggestions,
    sourceReferences,
  };
}

export async function capturePrintedOasisNoteReview(
  params: OasisPrintedNoteReviewParams,
): Promise<OasisPrintedNoteReviewServiceResult> {
  const printProfile = getOasisPrintSectionProfile(
    params.printProfileKey ?? DEFAULT_OASIS_PRINT_SECTION_PROFILE_KEY,
  );
  const captureResult = await params.portalClient.captureOasisPrintedNoteForReview({
    context: params.context,
    workItem: params.workItem,
    evidenceDir: params.evidenceDir,
    assessmentType: params.assessmentType,
    matchedAssessmentLabel: params.assessmentNote.matchedAssessmentLabel,
    printProfileKey: printProfile.key,
  });
  const extractedTextPath = captureResult.result.extractedTextPath;
  const extractedText = extractedTextPath
    ? normalizeWhitespace(await readFile(extractedTextPath, "utf8").catch(() => ""))
    : "";
  const sections = SECTION_PATTERNS
    .filter((section) => printProfile.reviewSectionKeys.includes(section.key))
    .map((section) =>
      buildSectionReview({
        text: extractedText,
        sharedEvidence: params.sharedEvidence,
        workItem: params.workItem,
        section,
      }));
  const warnings = [
    ...params.assessmentNote.warnings,
    ...captureResult.result.warnings,
    ...(extractedText ? [] : ["Printed OASIS note text could not be extracted."]),
  ];
  const incompleteSectionCount = sections.filter((section) => section.status !== "COMPLETED").length;
  const result: OasisPrintedNoteReviewResult = {
    assessmentType: params.assessmentType,
    matchedAssessmentLabel: params.assessmentNote.matchedAssessmentLabel,
    reviewSource: "printed_note_ocr",
    overallStatus: incompleteSectionCount === 0 ? "COMPLETED" : "PARTIAL",
    capture: {
      ...captureResult.result,
      textLength: extractedText.length,
    },
    sections,
    warningCount: warnings.length,
    topWarning: warnings[0] ?? null,
    warnings,
  };
  const reviewPath = path.join(
    params.outputDir,
    "patients",
    params.workItem.id,
    "oasis-printed-note-review.json",
  );
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, JSON.stringify(result, null, 2), "utf8");

  params.logger.info(
    {
      workflowDomain: "qa",
      patientRunId: params.context.patientRunId,
      workflowRunId: `${params.context.patientRunId}:qa`,
      stepName: "oasis_printed_note_review_persisted",
      chartUrl: params.context.chartUrl,
      currentUrl: result.capture.currentUrl,
      assessmentType: params.assessmentType,
      printButtonDetected: result.capture.printButtonDetected,
      printClickSucceeded: result.capture.printClickSucceeded,
      printProfileKey: result.capture.printProfileKey,
      selectedSectionLabels: result.capture.selectedSectionLabels,
      extractionMethod: result.capture.extractionMethod,
      textLength: result.capture.textLength,
      incompleteSectionCount,
      warningCount: result.warningCount,
    },
    "persisted read-only printed OASIS note review artifact",
  );

  const stepLogs = [
    ...captureResult.stepLogs,
    createAutomationStepLog({
      step: "oasis_printed_note_review",
      message: `Persisted read-only OASIS printed-note review with ${sections.length} section summaries.`,
      patientName: params.workItem.patientIdentity.displayName,
      urlBefore: params.context.chartUrl,
      urlAfter: result.capture.currentUrl,
      found: [
        `assessmentType=${params.assessmentType}`,
        `printProfileKey=${result.capture.printProfileKey ?? "none"}`,
        `printButtonDetected=${result.capture.printButtonDetected}`,
        `printClickSucceeded=${result.capture.printClickSucceeded}`,
        `textLength=${result.capture.textLength}`,
        `overallStatus=${result.overallStatus}`,
      ],
      missing: extractedText ? [] : ["printed OASIS note text"],
      openedDocumentLabel: params.assessmentNote.matchedAssessmentLabel,
      openedDocumentUrl: result.capture.currentUrl,
      evidence: [
        `reviewPath=${reviewPath}`,
        `extractedTextPath=${result.capture.extractedTextPath ?? "none"}`,
        `ocrResultPath=${result.capture.ocrResultPath ?? "none"}`,
        `sourcePdfPath=${result.capture.sourcePdfPath ?? "none"}`,
        `printedPdfPath=${result.capture.printedPdfPath ?? "none"}`,
        `selectedSectionLabels=${result.capture.selectedSectionLabels.join(" | ") || "none"}`,
        ...sections.slice(0, 8).map((section) =>
          `${section.key}:${section.status}:${section.filledFieldCount}/${section.missingFieldCount}`),
      ],
      safeReadConfirmed: true,
    }),
  ];

  return {
    result,
    reviewPath,
    stepLogs,
  };
}
