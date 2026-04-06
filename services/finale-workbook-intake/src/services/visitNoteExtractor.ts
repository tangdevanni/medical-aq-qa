import type { ExtractedDocument } from "./documentExtractionService";

export type VisitNoteExtract = {
  skilledNeed: boolean;
  interventionDetail: boolean;
  patientResponse: boolean;
  progressTowardGoals: boolean;
  conditionChanges: boolean;
  vitals: boolean;
  medicationReview: boolean;
  billedServicesSupport: boolean;
  consistencyWithDiagnoses: boolean;
};

export type VisitNoteExtractionResult = VisitNoteExtract & {
  evidence: Record<keyof VisitNoteExtract, string[]>;
  snVisitCount: number;
  disciplines: Array<"PT" | "OT" | "ST" | "HHA" | "RD" | "MSW">;
};

function collectEvidence(text: string, patterns: RegExp[]): string[] {
  const evidence = new Set<string>();

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }

    const snippetStart = Math.max(0, match.index - 40);
    const snippetEnd = Math.min(text.length, match.index + 120);
    evidence.add(text.slice(snippetStart, snippetEnd).trim());
  }

  return [...evidence];
}

function countSnVisits(text: string): number {
  const matches = text.match(/\bSN\b|\bskilled nursing visit\b/gi) ?? [];
  return matches.length;
}

export function extractVisitNoteFields(
  documents: ExtractedDocument[],
): VisitNoteExtractionResult {
  const visitText = documents
    .filter((document) => document.type === "VISIT_NOTE")
    .map((document) => document.text)
    .join("\n");

  const rules: Record<keyof VisitNoteExtract, RegExp[]> = {
    skilledNeed: [
      /\bskilled need\b/i,
      /\bskilled nursing\b/i,
      /\brequires skilled\b/i,
    ],
    interventionDetail: [
      /\bintervention(?:s)? performed\b/i,
      /\bteaching provided\b/i,
      /\bwound care\b/i,
      /\bmedication management\b/i,
    ],
    patientResponse: [
      /\bpatient response\b/i,
      /\btolerated (?:well|poorly)\b/i,
      /\bresponded (?:well|poorly)\b/i,
    ],
    progressTowardGoals: [
      /\bprogress toward goals?\b/i,
      /\bgoals? (?:met|progressing)\b/i,
      /\bprogress noted\b/i,
    ],
    conditionChanges: [
      /\bchange(?:s)? in condition\b/i,
      /\bcondition changed\b/i,
      /\bdecline\b/i,
      /\bimprovement\b/i,
      /\bworsening\b/i,
    ],
    vitals: [
      /\bvitals?\b/i,
      /\bblood pressure\b/i,
      /\bheart rate\b/i,
      /\btemperature\b/i,
      /\bpulse ox\b/i,
    ],
    medicationReview: [
      /\bmedication(?:s)? reviewed\b/i,
      /\bmedication changes?\b/i,
      /\bmedication reconciliation\b/i,
    ],
    billedServicesSupport: [
      /\bdocumentation supports billed services\b/i,
      /\bskilled nursing visit\b/i,
      /\bvisit performed\b/i,
    ],
    consistencyWithDiagnoses: [
      /\bdiagnos(?:is|es)\b/i,
      /\bconsistent with\b/i,
      /\boasis\b/i,
      /\bplan of care\b/i,
    ],
  };

  const evidence = {
    skilledNeed: collectEvidence(visitText, rules.skilledNeed),
    interventionDetail: collectEvidence(visitText, rules.interventionDetail),
    patientResponse: collectEvidence(visitText, rules.patientResponse),
    progressTowardGoals: collectEvidence(visitText, rules.progressTowardGoals),
    conditionChanges: collectEvidence(visitText, rules.conditionChanges),
    vitals: collectEvidence(visitText, rules.vitals),
    medicationReview: collectEvidence(visitText, rules.medicationReview),
    billedServicesSupport: collectEvidence(visitText, rules.billedServicesSupport),
    consistencyWithDiagnoses: collectEvidence(visitText, rules.consistencyWithDiagnoses),
  };

  const disciplines = new Set<"PT" | "OT" | "ST" | "HHA" | "RD" | "MSW">();
  const disciplineRules: Array<["PT" | "OT" | "ST" | "HHA" | "RD" | "MSW", RegExp]> = [
    ["PT", /\bPT\b|\bphysical therapy\b/i],
    ["OT", /\bOT\b|\boccupational therapy\b/i],
    ["ST", /\bST\b|\bspeech therapy\b/i],
    ["HHA", /\bHHA\b|\bhome health aide\b/i],
    ["RD", /\bRD\b|\bdietitian\b/i],
    ["MSW", /\bMSW\b|\bmedical social worker\b/i],
  ];

  for (const [discipline, pattern] of disciplineRules) {
    if (pattern.test(visitText)) {
      disciplines.add(discipline);
    }
  }

  return {
    skilledNeed: evidence.skilledNeed.length > 0,
    interventionDetail: evidence.interventionDetail.length > 0,
    patientResponse: evidence.patientResponse.length > 0,
    progressTowardGoals: evidence.progressTowardGoals.length > 0,
    conditionChanges: evidence.conditionChanges.length > 0,
    vitals: evidence.vitals.length > 0,
    medicationReview: evidence.medicationReview.length > 0,
    billedServicesSupport: evidence.billedServicesSupport.length > 0,
    consistencyWithDiagnoses: evidence.consistencyWithDiagnoses.length > 0,
    evidence,
    snVisitCount: countSnVisits(visitText),
    disciplines: [...disciplines],
  };
}
