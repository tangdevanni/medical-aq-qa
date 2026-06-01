import type {
  VisitNoteCaptureEligibility,
  VisitNoteNormalizedStatus,
  VisitNoteServiceType,
} from "@medical-ai-qa/shared-types";

export const VISIT_NOTE_SERVICE_TYPES: VisitNoteServiceType[] = [
  "physical_therapy",
  "home_health_aide",
  "skilled_nursing",
  "others",
  "medical_social_worker",
  "occupational_therapy",
  "registered_dietitian",
  "respiratory_therapy",
  "speech_therapy",
];

export function normalizeVisitNoteText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function normalizeVisitNoteType(input: {
  rawDocumentType?: string | null;
  assignedStaffRaw?: string | null;
}): {
  normalizedVisitType: VisitNoteServiceType;
  normalizedVisitTypeConfidence: number;
  normalizationReason: string;
} {
  const rawDocumentType = normalizeVisitNoteText(input.rawDocumentType);
  const assignedStaffRaw = normalizeVisitNoteText(input.assignedStaffRaw);
  const rawDocumentTypeLower = rawDocumentType.toLowerCase();
  const combined = `${rawDocumentType} ${assignedStaffRaw}`.toLowerCase();

  if (hasPattern(rawDocumentTypeLower, [/admin pay/, /\badmin\b/, /payroll/, /mileage/, /misc/])) {
    return {
      normalizedVisitType: "others",
      normalizedVisitTypeConfidence: 0.9,
      normalizationReason: "Document type appears administrative or non-clinical.",
    };
  }

  if (hasPattern(combined, [/\bpta\b/, /\bpt\b/, /physical therap/])) {
    return {
      normalizedVisitType: "physical_therapy",
      normalizedVisitTypeConfidence: 0.94,
      normalizationReason: "Document/staff text contains PT/PTA or physical therapy.",
    };
  }

  if (hasPattern(combined, [/\brn\b/, /\bsn\b/, /skilled nurs/, /regular visit/, /mgt\s*&\s*eval/])) {
    return {
      normalizedVisitType: "skilled_nursing",
      normalizedVisitTypeConfidence: 0.92,
      normalizationReason: "Document/staff text contains RN/SN/skilled nursing visit wording.",
    };
  }

  if (hasPattern(combined, [/\bhha\b/, /home health aide/, /\baide\b/])) {
    return {
      normalizedVisitType: "home_health_aide",
      normalizedVisitTypeConfidence: 0.92,
      normalizationReason: "Document/staff text contains HHA/home health aide wording.",
    };
  }

  if (hasPattern(combined, [/\bmsw\b/, /medical social worker/, /social work/])) {
    return {
      normalizedVisitType: "medical_social_worker",
      normalizedVisitTypeConfidence: 0.9,
      normalizationReason: "Document/staff text contains MSW/social work wording.",
    };
  }

  if (hasPattern(combined, [/\bot\b/, /occupational therap/])) {
    return {
      normalizedVisitType: "occupational_therapy",
      normalizedVisitTypeConfidence: 0.9,
      normalizationReason: "Document/staff text contains OT/occupational therapy wording.",
    };
  }

  if (hasPattern(combined, [/\bst\b/, /\bslp\b/, /speech therap/, /speech language/])) {
    return {
      normalizedVisitType: "speech_therapy",
      normalizedVisitTypeConfidence: 0.9,
      normalizationReason: "Document/staff text contains ST/SLP/speech therapy wording.",
    };
  }

  if (hasPattern(combined, [/\brd\b/, /registered dietitian/, /dietitian/, /nutrition/])) {
    return {
      normalizedVisitType: "registered_dietitian",
      normalizedVisitTypeConfidence: 0.86,
      normalizationReason: "Document/staff text contains RD/dietitian/nutrition wording.",
    };
  }

  if (hasPattern(combined, [/\brt\b/, /respiratory therap/])) {
    return {
      normalizedVisitType: "respiratory_therapy",
      normalizedVisitTypeConfidence: 0.86,
      normalizationReason: "Document/staff text contains RT/respiratory therapy wording.",
    };
  }

  const adminConfidence = hasPattern(combined, [/admin pay/, /payroll/, /mileage/, /misc/]) ? 0.86 : 0.45;
  return {
    normalizedVisitType: "others",
    normalizedVisitTypeConfidence: adminConfidence,
    normalizationReason: adminConfidence >= 0.8
      ? "Document text appears administrative or non-clinical."
      : "No known clinical discipline signal was found.",
  };
}

export function normalizeVisitNoteStatus(statusRaw: string | null | undefined): VisitNoteNormalizedStatus {
  const normalized = normalizeVisitNoteText(statusRaw).toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (/qa\s*(completed|complete)\b/.test(normalized)) {
    return "qa_completed";
  }
  if (/\bqa\s*(pending|review)\b|\bpending\s*qa\b|\breview\s*pending\b/.test(normalized)) {
    return /review/.test(normalized) ? "qa_review" : "qa_pending";
  }
  if (/missed\s*visit|missed/.test(normalized)) {
    return "missed_visit";
  }
  if (/not\s*started/.test(normalized)) {
    return "not_started";
  }
  if (/e-?\s*signed|esign/.test(normalized)) {
    return "e_signed";
  }
  if (/\bsigned\b/.test(normalized)) {
    return "signed";
  }
  if (/cancel(?:led|ed)|void/.test(normalized)) {
    return "cancelled";
  }
  if (/in\s*progress/.test(normalized)) {
    return "in_progress";
  }
  if (/submitted/.test(normalized)) {
    return "submitted";
  }
  return "unknown";
}

export function isClinicallyRelevantVisitType(visitType: VisitNoteServiceType): boolean {
  return visitType !== "others";
}

export function determineVisitNoteCaptureEligibility(input: {
  normalizedVisitType: VisitNoteServiceType;
  normalizedStatus?: VisitNoteNormalizedStatus | null;
  rawDocumentType?: string | null;
}): {
  captureEligibility: VisitNoteCaptureEligibility;
  lifecycleStatus: VisitNoteCaptureEligibility;
  skipReason?: string;
} {
  const rawDocumentType = normalizeVisitNoteText(input.rawDocumentType).toLowerCase();
  const status = input.normalizedStatus ?? "unknown";
  const isAdminLike = input.normalizedVisitType === "others" &&
    /\b(admin|pay|payroll|mileage|misc|non[-\s]?clinical)\b/.test(rawDocumentType);

  if (isAdminLike) {
    return {
      captureEligibility: "ineligible",
      lifecycleStatus: "ineligible",
      skipReason: "non_clinical_or_admin_visit_note",
    };
  }
  if (status === "missed_visit" || status === "cancelled") {
    return {
      captureEligibility: "count_only",
      lifecycleStatus: "count_only",
      skipReason: `${status}_status_only`,
    };
  }
  if (!isClinicallyRelevantVisitType(input.normalizedVisitType)) {
    return {
      captureEligibility: "ineligible",
      lifecycleStatus: "ineligible",
      skipReason: "unknown_or_non_clinical_visit_type",
    };
  }
  if (status === "qa_completed") {
    return {
      captureEligibility: "finalized_no_active_monitoring",
      lifecycleStatus: "finalized_no_active_monitoring",
      skipReason: "qa_completed_finalized",
    };
  }
  if (["e_signed", "signed", "submitted", "in_progress", "qa_pending", "qa_review", "not_started"].includes(status)) {
    return {
      captureEligibility: "active_monitoring",
      lifecycleStatus: "active_monitoring",
    };
  }
  return {
    captureEligibility: "review_needed_unknown",
    lifecycleStatus: "review_needed_unknown",
    skipReason: "unknown_status_review_needed",
  };
}
