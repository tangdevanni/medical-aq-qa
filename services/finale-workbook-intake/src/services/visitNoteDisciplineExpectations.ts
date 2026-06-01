import type { VisitNoteType } from "@medical-ai-qa/shared-types";

export type VisitNoteDisciplineExpectation = {
  visitType: VisitNoteType;
  expectations: string[];
  warningTriggers: string[];
};

export const VISIT_NOTE_DISCIPLINE_EXPECTATIONS: Record<VisitNoteType, VisitNoteDisciplineExpectation> = {
  skilled_nursing: {
    visitType: "skilled_nursing",
    expectations: [
      "vitals when appropriate",
      "medication review or teaching",
      "skilled intervention performed",
      "relevant problem addressed",
      "patient response",
      "plan for next visit, status, or signature",
    ],
    warningTriggers: ["missing vitals", "missing medication review", "missing patient response"],
  },
  physical_therapy: {
    visitType: "physical_therapy",
    expectations: [
      "gait or ambulation",
      "transfers",
      "balance",
      "strength",
      "exercises performed",
      "fall risk or safety",
      "progress toward mobility goal",
      "patient response",
    ],
    warningTriggers: ["missing mobility treatment", "missing progress", "missing patient response"],
  },
  occupational_therapy: {
    visitType: "occupational_therapy",
    expectations: [
      "ADLs or IADLs",
      "upper extremity function",
      "safety or adaptive equipment",
      "transfers as relevant",
      "patient response or progress",
    ],
    warningTriggers: ["missing ADL focus", "missing safety training", "missing patient response"],
  },
  speech_therapy: {
    visitType: "speech_therapy",
    expectations: [
      "swallowing or dysphagia",
      "aspiration precautions",
      "diet tolerance",
      "communication or cognition",
      "exercises or education",
      "patient response",
    ],
    warningTriggers: ["missing swallow or communication focus", "missing diet tolerance", "missing patient response"],
  },
  home_health_aide: {
    visitType: "home_health_aide",
    expectations: [
      "ADL support",
      "bathing, grooming, or personal care",
      "safety observations",
      "patient tolerance",
      "abnormal findings reported",
    ],
    warningTriggers: ["missing personal care detail", "missing patient tolerance"],
  },
  medical_social_worker: {
    visitType: "medical_social_worker",
    expectations: [
      "psychosocial support",
      "caregiver or support system",
      "resources or community needs",
      "safety or social barriers",
      "follow-up plan",
    ],
    warningTriggers: ["missing resource assessment", "missing follow-up plan"],
  },
  registered_dietitian: {
    visitType: "registered_dietitian",
    expectations: [
      "nutrition assessment",
      "diet education",
      "weight or intake",
      "swallowing or diet consistency if relevant",
      "patient response",
    ],
    warningTriggers: ["missing intake or weight", "missing diet education", "missing patient response"],
  },
  respiratory_therapy: {
    visitType: "respiratory_therapy",
    expectations: [
      "respiratory assessment",
      "oxygen use or safety",
      "breathing treatments",
      "dyspnea or cough",
      "patient response",
    ],
    warningTriggers: ["missing respiratory assessment", "missing oxygen safety", "missing patient response"],
  },
  others: {
    visitType: "others",
    expectations: [
      "infer documentation expectations from document text",
      "lower confidence for unknown disciplines",
      "flag missing core documentation only when clear",
    ],
    warningTriggers: ["unknown discipline", "non-clinical or administrative note"],
  },
};

export function getVisitNoteDisciplineExpectations(visitType: VisitNoteType): VisitNoteDisciplineExpectation {
  return VISIT_NOTE_DISCIPLINE_EXPECTATIONS[visitType] ?? VISIT_NOTE_DISCIPLINE_EXPECTATIONS.others;
}
