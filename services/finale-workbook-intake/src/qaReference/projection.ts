import type {
  PatientEpisodeWorkItem,
  PatientQaReference,
  QaDashboardFieldReference,
  QaFieldComparisonStatus,
  QaFieldRecommendedAction,
  QaFieldRegistryEntry,
  QaReferralDashboardSection,
  QaReferralDashboardTextSpan,
  QaFieldSourceEvidence,
  QaReviewQueueEntry,
  QaReviewWorkflowState,
  QaWorkflowSectionKey,
} from "@medical-ai-qa/shared-types";
import {
  QA_FIELD_GROUPS,
  QA_REFERENCE_FIELD_REGISTRY,
  QA_SECTION_METADATA,
} from "./registry";
import type {
  FieldComparisonResult,
  FieldMapSnapshot,
  NormalizedReferralSection,
  ReferralDiagnosisCandidate,
  ReferralFieldProposal,
  ReferralLlmProposal,
  ReferralQaInsights,
  SourceDocumentArtifact,
} from "../referralProcessing/types";
import { segmentReferralText } from "../referralProcessing/sectionNormalization";

function valueIsPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function normalizeComparableText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

type DashboardSectionRule = {
  sectionKey: QaWorkflowSectionKey;
  patterns: RegExp[];
};

const DASHBOARD_SECTION_RULES: DashboardSectionRule[] = [
  {
    sectionKey: "footer_non_print_preview",
    patterns: [
      /\bfax server\b/i,
      /\bpage\s+\d+\/\d+\b/i,
      /\bpage \d+ of \d+\b/i,
      /\bprinted date\b/i,
      /\boriginal signature\b/i,
      /\belectronically signed\b/i,
      /\b\[e-signed\]\b/i,
      /\bfacility code\b/i,
    ],
  },
  {
    sectionKey: "administrative_information",
    patterns: [
      /\bresident\b/i,
      /\bpatient\b/i,
      /\bdob\b/i,
      /\border(?:ed)? by\b/i,
      /\border date\b/i,
      /\breferral date\b/i,
      /\breferring\b/i,
      /\bprovider\b/i,
      /\bcare providers?\b/i,
      /\bcontacts?\b/i,
      /\bpreferred lang(?:uage)?\b/i,
      /\binterpreter\b/i,
      /\binsurance\b/i,
      /\baddress\b/i,
      /\bphone\b/i,
      /\badmitted from\b/i,
      /\bacute care hospital\b/i,
    ],
  },
  {
    sectionKey: "active_diagnoses",
    patterns: [
      /\bdiagnos(?:is|es)\b/i,
      /\bicd-?10\b/i,
      /\bcode description\b/i,
      /\b[a-tv-z][0-9][0-9a-z.]{2,}\b/i,
    ],
  },
  {
    sectionKey: "vital_signs_and_pain_assessment",
    patterns: [
      /\bvitals?\b/i,
      /\bblood pressure\b/i,
      /\bheart rate\b/i,
      /\bpulse\b/i,
      /\bresp(?:iratory)? rate\b/i,
      /\btemp(?:erature)?\b/i,
      /\bpain\b/i,
      /\b650mg\b/i,
    ],
  },
  {
    sectionKey: "medication_allergies_and_injectables",
    patterns: [
      /\bmedication\b/i,
      /\ballerg(?:y|ies)\b/i,
      /\bpharmacy\b/i,
      /\binject(?:ion|able)\b/i,
      /\bnaloxone\b/i,
      /\btablet\b/i,
      /\bcapsule\b/i,
      /\bsuppository\b/i,
      /\benema\b/i,
    ],
  },
  {
    sectionKey: "neurological_head_mood_eyes_ears",
    patterns: [
      /\bencephalopathy\b/i,
      /\bcognitive\b/i,
      /\bconfusion\b/i,
      /\boriented\b/i,
      /\bdepression\b/i,
      /\bmood\b/i,
      /\bbehavior(?:al)?\b/i,
      /\bhead\b/i,
      /\beyes?\b/i,
      /\bears?\b/i,
    ],
  },
  {
    sectionKey: "cardiopulmonary_chest_thorax",
    patterns: [
      /\bpneumonia\b/i,
      /\brespiratory\b/i,
      /\bhypoxia\b/i,
      /\bshortness of breath\b/i,
      /\bsob\b/i,
      /\bo2\b/i,
      /\boxygen\b/i,
      /\bchf\b/i,
      /\ba-fib\b/i,
      /\batrial fibrillation\b/i,
      /\bcvs\b/i,
      /\blungs?\b/i,
      /\bchest\b/i,
      /\bthorax\b/i,
      /\bcardio/i,
    ],
  },
  {
    sectionKey: "gastrointestinal_and_genitourinary_assessment",
    patterns: [
      /\bdysphagia\b/i,
      /\bmelena\b/i,
      /\bstools?\b/i,
      /\bgastro/i,
      /\bbowel\b/i,
      /\btoilet(?:ing)?\b/i,
      /\bgenitourinary\b/i,
      /\bbladder\b/i,
      /\burin/i,
      /\bkidney\b/i,
      /\brenal\b/i,
    ],
  },
  {
    sectionKey: "integumentary_skin_and_wound",
    patterns: [
      /\bwound\b/i,
      /\bskin\b/i,
      /\bulcer\b/i,
      /\bdressing\b/i,
      /\bpressure\b/i,
      /\bvenous\b/i,
    ],
  },
  {
    sectionKey: "safety_and_risk_assessment",
    patterns: [
      /\bfall(?:s)?\b/i,
      /\brisk\b/i,
      /\bsafety\b/i,
      /\bprecautions?\b/i,
      /\bcontraindications?\b/i,
      /\bfull code\b/i,
      /\bdnr\b/i,
      /\badvance directive\b/i,
      /\bcode status\b/i,
    ],
  },
  {
    sectionKey: "functional_assessment_self_care",
    patterns: [
      /\badl\b/i,
      /\btoileting\b/i,
      /\bhygiene\b/i,
      /\bdressing\b/i,
      /\bgrooming\b/i,
      /\bfootwear\b/i,
      /\bbed mobility\b/i,
      /\boral hygiene\b/i,
    ],
  },
  {
    sectionKey: "functional_assessment_mobility_and_musculoskeletal",
    patterns: [
      /\bweakness\b/i,
      /\bwalking\b/i,
      /\bgait\b/i,
      /\bambulat/i,
      /\bwheelchair\b/i,
      /\bwc\b/i,
      /\bwalker\b/i,
      /\bsit<>stand\b/i,
      /\btransfer/i,
      /\bmusculoskeletal\b/i,
      /\brom\b/i,
      /\bendurance\b/i,
      /\bactivity tolerance\b/i,
      /\bwbat\b/i,
    ],
  },
  {
    sectionKey: "endocrine_diabetic_management",
    patterns: [
      /\bdiabet/i,
      /\binsulin\b/i,
      /\bglucose\b/i,
      /\ba1c\b/i,
      /\bendocrine\b/i,
    ],
  },
  {
    sectionKey: "plan_of_care_and_physical_therapy_evaluation",
    patterns: [
      /\border summary\b/i,
      /\bpt\/ot\b/i,
      /\bphysical therapy\b/i,
      /\boccupational therapy\b/i,
      /\beval and treat\b/i,
      /\bskilled services?\b/i,
      /\bmed mgmt\b/i,
      /\bwound care\b/i,
      /\btherapy need\b/i,
    ],
  },
  {
    sectionKey: "patient_summary_and_clinical_narrative",
    patterns: [
      /\bprogress notes?\b/i,
      /\bphysician progress note\b/i,
      /\bnote text\b/i,
      /\bassessment\b/i,
      /\bclinical narrative\b/i,
      /\bpast medical history\b/i,
      /\bmedical necessity\b/i,
      /\breason for home health\b/i,
      /\badmitted to us for rehab\b/i,
      /\bsummary\b/i,
    ],
  },
  {
    sectionKey: "care_plan_problems_goals_interventions",
    patterns: [
      /\bcare plan\b/i,
      /\bgoals?\b/i,
      /\binterventions?\b/i,
      /\bplan for next visit\b/i,
      /\bskilled intervention/i,
      /\bproblems?\b/i,
    ],
  },
];

const NORMALIZED_SECTION_TO_DASHBOARD_SECTION = new Map<string, QaWorkflowSectionKey[]>([
  ["patient_identity", ["administrative_information"]],
  ["referral_metadata", ["administrative_information"]],
  ["referring_provider", ["administrative_information"]],
  ["hospitalization_history", ["administrative_information"]],
  ["primary_reason_for_home_health", ["patient_summary_and_clinical_narrative"]],
  ["medical_necessity", ["patient_summary_and_clinical_narrative"]],
  ["homebound_evidence", ["functional_assessment_mobility_and_musculoskeletal"]],
  ["diagnoses", ["active_diagnoses"]],
  ["medications", ["medication_allergies_and_injectables"]],
  ["caregiver_support", ["administrative_information"]],
  ["living_situation", ["administrative_information"]],
  ["functional_limitations", ["functional_assessment_mobility_and_musculoskeletal"]],
  ["therapy_need", ["plan_of_care_and_physical_therapy_evaluation"]],
  ["risk_factors", ["safety_and_risk_assessment"]],
  ["advance_directives", ["safety_and_risk_assessment"]],
  ["code_status", ["safety_and_risk_assessment"]],
  ["other_clinical_notes", ["patient_summary_and_clinical_narrative"]],
]);

function normalizedSectionKeys(sectionName: string): QaWorkflowSectionKey[] {
  return NORMALIZED_SECTION_TO_DASHBOARD_SECTION.get(sectionName) ?? [];
}

function inferSectionKeyFromSegment(segment: string): QaWorkflowSectionKey {
  for (const rule of DASHBOARD_SECTION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(segment))) {
      return rule.sectionKey;
    }
  }
  return "patient_summary_and_clinical_narrative";
}

function evidenceMatchesTextSpan(left: string, right: string): boolean {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (Math.min(normalizedLeft.length, normalizedRight.length) < 8) {
    return normalizedLeft === normalizedRight;
  }

  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function buildReferralDashboardSections(input: {
  extractedText: string;
  normalizedSections: NormalizedReferralSection[];
  dashboardFields: QaDashboardFieldReference[];
}): QaReferralDashboardSection[] {
  const fieldKeysBySection = new Map<QaWorkflowSectionKey, string[]>();
  for (const field of QA_REFERENCE_FIELD_REGISTRY) {
    const existing = fieldKeysBySection.get(field.sectionKey) ?? [];
    existing.push(field.fieldKey);
    fieldKeysBySection.set(field.sectionKey, existing);
  }

  const sections: QaReferralDashboardSection[] = QA_SECTION_METADATA.map((metadata, index) => ({
    sectionKey: metadata.sectionKey,
    label: metadata.label,
    dashboardOrder: index + 1,
    printVisibility: metadata.sectionKey === "footer_non_print_preview" ? "hidden_in_print" : "visible",
    fieldKeys: fieldKeysBySection.get(metadata.sectionKey) ?? [],
    textSpans: [],
  }));

  const sectionByKey = new Map(sections.map((section) => [section.sectionKey, section]));
  const textIndexBySection = new Map<QaWorkflowSectionKey, Map<string, QaReferralDashboardTextSpan>>();
  for (const section of sections) {
    textIndexBySection.set(section.sectionKey, new Map());
  }

  const addTextSpan = (sectionKey: QaWorkflowSectionKey, span: QaReferralDashboardTextSpan): void => {
    const section = sectionByKey.get(sectionKey);
    const index = textIndexBySection.get(sectionKey);
    if (!section || !index) {
      return;
    }

    const normalizedText = normalizeComparableText(span.text);
    if (!normalizedText) {
      return;
    }

    const existing = index.get(normalizedText);
    if (existing) {
      existing.sourceSectionNames = unique([...existing.sourceSectionNames, ...span.sourceSectionNames]);
      existing.relatedFieldKeys = unique([...existing.relatedFieldKeys, ...span.relatedFieldKeys]);
      existing.lineReferences = existing.lineReferences.length > 0 ? existing.lineReferences : span.lineReferences;
      return;
    }

    index.set(normalizedText, span);
    section.textSpans.push(span);
  };

  const segments = segmentReferralText(input.extractedText);

  for (const segment of segments) {
    const matchedSections = input.normalizedSections.filter((section) =>
      section.extractedTextSpans.some((span) => evidenceMatchesTextSpan(span, segment)));
    const inferredSectionKeys = unique(
      matchedSections.flatMap((section) => normalizedSectionKeys(section.sectionName)),
    );
    const sectionKey = inferredSectionKeys[0] ?? inferSectionKeyFromSegment(segment);
    const relatedFieldKeys = unique(input.dashboardFields
      .filter((field) => field.sourceEvidence.some((evidence) =>
        evidence.textSpan ? evidenceMatchesTextSpan(evidence.textSpan, segment) : false))
      .map((field) => field.fieldKey));

    addTextSpan(sectionKey, {
      text: segment,
      sourceSectionNames: unique(matchedSections.map((section) => section.sectionName)),
      relatedFieldKeys,
      lineReferences: matchedSections.flatMap((section) => section.lineReferences),
    });
  }

  for (const field of input.dashboardFields) {
    const registryEntry = QA_REFERENCE_FIELD_REGISTRY.find((entry) => entry.fieldKey === field.fieldKey);
    if (!registryEntry) {
      continue;
    }

    for (const evidence of field.sourceEvidence) {
      if (!evidence.textSpan?.trim()) {
        continue;
      }

      addTextSpan(registryEntry.sectionKey, {
        text: evidence.textSpan,
        sourceSectionNames: [],
        relatedFieldKeys: [field.fieldKey],
        lineReferences: [],
      });
    }
  }

  return sections;
}

function selectedSource(input: SourceDocumentArtifact | null): {
  sourceType: string;
  sourceLabel: string;
} {
  const selected = input?.sourceDocuments.find((document) => document.selectionStatus === "selected")
    ?? input?.sourceDocuments[0]
    ?? null;

  return {
    sourceType: selected?.sourceType ?? "referral_document",
    sourceLabel: selected?.sourceLabel ?? "referral document",
  };
}

function evidenceFromProposal(input: {
  proposal: Pick<ReferralFieldProposal, "source_spans" | "confidence">;
  sourceType: string;
  sourceLabel: string;
}): QaFieldSourceEvidence[] {
  return input.proposal.source_spans
    .filter((span) => span.trim().length > 0)
    .slice(0, 6)
    .map((span) => ({
      sourceType: input.sourceType,
      sourceLabel: input.sourceLabel,
      textSpan: span,
      confidence: input.proposal.confidence,
    }));
}

function evidenceFromContext(input: {
  value: unknown;
  sourceType: string;
  sourceLabel: string;
  confidence?: number;
}): QaFieldSourceEvidence[] {
  return valueIsPresent(input.value)
    ? [{
        sourceType: input.sourceType,
        sourceLabel: input.sourceLabel,
        textSpan: String(input.value),
        confidence: input.confidence ?? 0.85,
      }]
    : [];
}

function diagnosisValue(candidate: ReferralDiagnosisCandidate): Record<string, unknown> {
  return {
    description: candidate.description,
    icd10_code: candidate.icd10_code,
    is_primary_candidate: candidate.is_primary_candidate,
    requires_human_review: candidate.requires_human_review,
  };
}

function buildDocumentSupportedValues(input: {
  llmProposal: ReferralLlmProposal;
  sourceMeta: SourceDocumentArtifact | null;
}): {
  proposedValues: PatientQaReference["proposedReferenceValues"];
  evidenceByField: PatientQaReference["documentEvidence"];
} {
  const source = selectedSource(input.sourceMeta);
  const proposedValues: PatientQaReference["proposedReferenceValues"] = {};
  const evidenceByField: PatientQaReference["documentEvidence"] = {};

  const put = (fieldKey: string, value: unknown, evidence: QaFieldSourceEvidence[], confidence: number | null, rationale: string | null, requiresHumanReview: boolean): void => {
    if (!valueIsPresent(value)) {
      return;
    }
    proposedValues[fieldKey] = {
      value,
      confidence,
      rationale,
      requiresHumanReview,
    };
    evidenceByField[fieldKey] = evidence;
  };

  const contextMappings: Array<[string, unknown]> = [
    ["patient_name", input.llmProposal.patient_context.patient_name],
    ["dob", input.llmProposal.patient_context.dob],
    ["soc_date", input.llmProposal.patient_context.soc_date],
    ["referral_date", input.llmProposal.patient_context.referral_date],
  ];
  for (const [fieldKey, value] of contextMappings) {
    put(
      fieldKey,
      value,
      evidenceFromContext({ value, ...source, confidence: 0.86 }),
      0.86,
      "Extracted from referral patient context.",
      false,
    );
  }

  for (const proposal of input.llmProposal.proposed_field_values) {
    put(
      proposal.field_key,
      proposal.proposed_value,
      evidenceFromProposal({ proposal, ...source }),
      proposal.confidence,
      proposal.rationale,
      proposal.requires_human_review,
    );
  }

  const diagnosisCandidates = input.llmProposal.diagnosis_candidates.map(diagnosisValue);
  if (diagnosisCandidates.length > 0) {
    const confidence = Math.max(...input.llmProposal.diagnosis_candidates.map((candidate) => candidate.confidence));
    const diagnosisEvidence = input.llmProposal.diagnosis_candidates
      .flatMap((candidate) => evidenceFromProposal({ proposal: candidate, ...source }))
      .slice(0, 8);
    put("diagnosis_candidates", diagnosisCandidates, diagnosisEvidence, confidence, "Diagnosis candidates extracted from referral evidence.", true);
    put("primary_diagnosis", diagnosisCandidates[0], diagnosisEvidence.slice(0, 3), confidence, "Primary diagnosis candidate extracted from referral evidence.", true);
    put("secondary_diagnoses", diagnosisCandidates.slice(1), diagnosisEvidence.slice(0, 6), confidence, "Secondary diagnosis candidates extracted from referral evidence.", true);
  }

  for (const caregiver of input.llmProposal.caregiver_candidates) {
    const caregiverName = caregiver.caregiver_name ?? caregiver.name;
    const caregiverRelationship = caregiver.caregiver_relationship ?? caregiver.relationship;
    const caregiverPhone = caregiver.caregiver_phone ?? caregiver.phone;
    put("caregiver_name", caregiverName, evidenceFromContext({ value: caregiverName, ...source }), 0.75, "Caregiver candidate extracted from referral evidence.", false);
    put("caregiver_relationship", caregiverRelationship, evidenceFromContext({ value: caregiverRelationship, ...source }), 0.75, "Caregiver relationship extracted from referral evidence.", false);
    put("caregiver_phone", caregiverPhone, evidenceFromContext({ value: caregiverPhone, ...source }), 0.75, "Caregiver phone extracted from referral evidence.", true);
  }

  return { proposedValues, evidenceByField };
}

function buildChartSnapshot(input: {
  fieldMapSnapshot: FieldMapSnapshot;
  workItem: PatientEpisodeWorkItem;
}): Record<string, unknown> {
  const chartSnapshot: Record<string, unknown> = {};
  for (const field of input.fieldMapSnapshot.fields) {
    chartSnapshot[field.key] = field.currentChartValue;
  }
  chartSnapshot.patient_name ??= input.workItem.patientIdentity.displayName || null;
  chartSnapshot.soc_date ??= input.workItem.episodeContext.socDate || null;
  return chartSnapshot;
}

function mapComparisonStatus(comparison: FieldComparisonResult | null): "match" | "possible_conflict" | null {
  if (!comparison) {
    return null;
  }
  if (comparison.comparison_status === "match") {
    return "match";
  }
  if (comparison.comparison_status === "possible_conflict") {
    return "possible_conflict";
  }
  return null;
}

function deriveFieldState(input: {
  field: QaFieldRegistryEntry;
  currentChartValue: unknown;
  documentSupportedValue: unknown;
  comparison: FieldComparisonResult | null;
  proposalRequiresHumanReview: boolean;
}): {
  comparisonStatus: QaFieldComparisonStatus;
  workflowState: QaReviewWorkflowState;
  recommendedAction: QaFieldRecommendedAction;
} {
  if (input.field.reviewMode === "reference_only" || input.field.lowValueAdminField || input.field.dashboardVisibility === "hidden") {
    return {
      comparisonStatus: "not_relevant_for_dashboard",
      workflowState: "not_relevant_for_dashboard",
      recommendedAction: "reference_only",
    };
  }

  const hasCurrent = valueIsPresent(input.currentChartValue);
  const hasDocument = valueIsPresent(input.documentSupportedValue);
  const mappedComparison = mapComparisonStatus(input.comparison);

  if (input.field.requiresCodingTeamReview) {
    return hasCurrent || hasDocument
      ? {
          comparisonStatus: "needs_coding_review",
          workflowState: "needs_coding_review",
          recommendedAction: "escalate_to_coding",
        }
      : {
          comparisonStatus: "missing_in_chart",
          workflowState: "missing_in_chart",
          recommendedAction: "review_in_chart",
        };
  }

  if (mappedComparison === "possible_conflict") {
    return {
      comparisonStatus: "possible_conflict",
      workflowState: "possible_conflict",
      recommendedAction: "review_in_chart",
    };
  }

  if (mappedComparison === "match" && !input.field.narrativeField) {
    return {
      comparisonStatus: "match",
      workflowState: "already_satisfactory",
      recommendedAction: "none",
    };
  }

  if (hasDocument && !hasCurrent) {
    return input.field.requiresHumanReview || input.proposalRequiresHumanReview || input.field.narrativeField
      ? {
          comparisonStatus: "supported_by_referral",
          workflowState: "needs_qa_readback",
          recommendedAction: "qa_readback_and_confirm",
        }
      : {
          comparisonStatus: "supported_by_referral",
          workflowState: "supported_by_referral",
          recommendedAction: "add_if_supported",
        };
  }

  if (hasCurrent && hasDocument) {
    return input.field.requiresHumanReview || input.proposalRequiresHumanReview || input.field.narrativeField
      ? {
          comparisonStatus: "needs_qa_readback",
          workflowState: "needs_qa_readback",
          recommendedAction: "qa_readback_and_confirm",
        }
      : {
          comparisonStatus: "match",
          workflowState: "already_satisfactory",
          recommendedAction: "none",
        };
  }

  if (!hasCurrent && !hasDocument) {
    return input.field.reviewMode === "chart_completeness_check" || input.field.qaPriority === "critical"
      ? {
          comparisonStatus: "missing_in_chart",
          workflowState: "missing_in_chart",
          recommendedAction: "review_in_chart",
        }
      : {
          comparisonStatus: "not_relevant_for_dashboard",
          workflowState: "not_relevant_for_dashboard",
          recommendedAction: "reference_only",
        };
  }

  return input.field.requiresHumanReview || input.field.narrativeField
    ? {
        comparisonStatus: "needs_qa_readback",
        workflowState: "needs_qa_readback",
        recommendedAction: "qa_readback_and_confirm",
      }
    : {
        comparisonStatus: "match",
        workflowState: "already_satisfactory",
        recommendedAction: "none",
      };
}

const PRIORITY_ORDER = new Map([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

const WORKFLOW_ORDER = new Map([
  ["needs_coding_review", 0],
  ["possible_conflict", 1],
  ["needs_qa_readback", 2],
  ["supported_by_referral", 3],
  ["missing_in_chart", 4],
  ["already_satisfactory", 5],
  ["not_relevant_for_dashboard", 6],
]);

function buildReviewQueue(fields: QaDashboardFieldReference[]): QaReviewQueueEntry[] {
  return fields
    .filter((field) => field.workflowState !== "already_satisfactory" && field.workflowState !== "not_relevant_for_dashboard")
    .map((field) => {
      const registryEntry = QA_REFERENCE_FIELD_REGISTRY.find((entry) => entry.fieldKey === field.fieldKey);
      return {
        fieldKey: field.fieldKey,
        groupKey: field.groupKey,
        sectionKey: registryEntry?.sectionKey ?? "administrative_information",
        qaPriority: field.qaPriority,
        comparisonStatus: field.comparisonStatus,
        workflowState: field.workflowState,
        recommendedAction: field.recommendedAction,
      };
    })
    .sort((left, right) =>
      (WORKFLOW_ORDER.get(left.workflowState) ?? 99) - (WORKFLOW_ORDER.get(right.workflowState) ?? 99) ||
      (PRIORITY_ORDER.get(left.qaPriority) ?? 99) - (PRIORITY_ORDER.get(right.qaPriority) ?? 99),
    );
}

export function buildPatientQaReference(input: {
  workItem: PatientEpisodeWorkItem;
  sourceMeta: SourceDocumentArtifact | null;
  extractedText: string;
  normalizedSections: NormalizedReferralSection[];
  fieldMapSnapshot: FieldMapSnapshot;
  llmProposal: ReferralLlmProposal;
  fieldComparisons: FieldComparisonResult[];
  referralQaInsights?: ReferralQaInsights | null;
}): PatientQaReference {
  const chartSnapshot = buildChartSnapshot({
    fieldMapSnapshot: input.fieldMapSnapshot,
    workItem: input.workItem,
  });
  const { proposedValues, evidenceByField } = buildDocumentSupportedValues({
    llmProposal: input.llmProposal,
    sourceMeta: input.sourceMeta,
  });
  const comparisonByKey = new Map(input.fieldComparisons.map((comparison) => [comparison.field_key, comparison]));

  const dashboardFields = QA_REFERENCE_FIELD_REGISTRY.map((field): QaDashboardFieldReference => {
    const proposedReference = proposedValues[field.fieldKey] ?? null;
    const comparison = comparisonByKey.get(field.fieldKey)
      ?? (field.fieldKey === "primary_diagnosis" || field.fieldKey === "secondary_diagnoses"
        ? comparisonByKey.get("diagnosis_candidates")
        : undefined)
      ?? null;
    const state = deriveFieldState({
      field,
      currentChartValue: chartSnapshot[field.fieldKey] ?? null,
      documentSupportedValue: proposedReference?.value ?? null,
      comparison,
      proposalRequiresHumanReview: proposedReference?.requiresHumanReview ?? false,
    });

    return {
      fieldKey: field.fieldKey,
      label: field.label,
      groupKey: field.groupKey,
      qaPriority: field.qaPriority,
      currentChartValue: chartSnapshot[field.fieldKey] ?? null,
      documentSupportedValue: proposedReference?.value ?? null,
      comparisonStatus: state.comparisonStatus,
      workflowState: state.workflowState,
      recommendedAction: state.recommendedAction,
      sourceEvidence: evidenceByField[field.fieldKey] ?? [],
      requiresHumanReview: field.requiresHumanReview || proposedReference?.requiresHumanReview === true,
    };
  });
  const referralDashboardSections = buildReferralDashboardSections({
    extractedText: input.extractedText,
    normalizedSections: input.normalizedSections,
    dashboardFields,
  });

  return {
    patientContext: {
      patientId: input.workItem.id,
      patientName: input.workItem.patientIdentity.displayName || input.llmProposal.patient_context.patient_name,
      dob: input.llmProposal.patient_context.dob,
      socDate: input.workItem.episodeContext.socDate || input.llmProposal.patient_context.soc_date,
      referralDate: input.llmProposal.patient_context.referral_date,
    },
    fieldRegistry: QA_REFERENCE_FIELD_REGISTRY,
    fieldGroups: QA_FIELD_GROUPS,
    sectionMetadata: QA_SECTION_METADATA,
    referralDashboardSections,
    referralQaInsights: input.referralQaInsights
      ? {
          generatedAt: input.referralQaInsights.generated_at,
          warnings: input.referralQaInsights.warnings,
          consistencyChecks: input.referralQaInsights.consistency_checks.map((entry) => ({
            id: entry.id,
            status: entry.status,
            title: entry.title,
            detail: entry.detail,
            relatedSections: entry.related_sections,
          })),
          sourceHighlights: input.referralQaInsights.source_highlights.map((entry) => ({
            id: entry.id,
            title: entry.title,
            summary: entry.summary,
            supportingSections: entry.supporting_sections,
          })),
          draftNarratives: input.referralQaInsights.draft_narratives.map((entry) => ({
            fieldKey: entry.field_key,
            label: entry.label,
            draft: entry.draft,
            status: entry.status,
          })),
        }
      : null,
    chartSnapshot,
    documentEvidence: evidenceByField,
    proposedReferenceValues: proposedValues,
    comparisonResults: Object.fromEntries(dashboardFields.map((field) => [field.fieldKey, field])),
    qaReviewQueue: buildReviewQueue(dashboardFields),
  };
}
