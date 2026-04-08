import type { ExtractedDocument } from "./documentExtractionService";

export type OasisExtract = {
  medicalNecessity: boolean;
  homeboundReason: boolean;
  healthAssessment: boolean;
  skilledInterventions: boolean;
};

export type OasisExtractionResult = OasisExtract & {
  evidence: Record<keyof OasisExtract, string[]>;
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

export function extractOasisFields(documents: ExtractedDocument[]): OasisExtractionResult {
  const oasisText = documents
    .filter((document) => document.type === "OASIS")
    .map((document) => document.text)
    .join("\n");

  const rules: Record<keyof OasisExtract, RegExp[]> = {
    medicalNecessity: [
      /\bmedical necessity\b/i,
      /\bmedically necessary\b/i,
      /\bnecessity for home health\b/i,
    ],
    homeboundReason: [
      /\bhomebound\b/i,
      /\bconfined to (?:the )?home\b/i,
      /\bleaving home requires\b/i,
    ],
    healthAssessment: [
      /\bhealth assessment\b/i,
      /\bcomprehensive assessment\b/i,
      /\bassessment (?:performed|completed|revealed)\b/i,
      /\bfocused assessment\b/i,
    ],
    skilledInterventions: [
      /\bskilled intervention(?:s)?\b/i,
      /\bskilled nursing\b/i,
      /\brequires skilled\b/i,
      /\binterventions performed\b/i,
    ],
  };

  const evidence = {
    medicalNecessity: collectEvidence(oasisText, rules.medicalNecessity),
    homeboundReason: collectEvidence(oasisText, rules.homeboundReason),
    healthAssessment: collectEvidence(oasisText, rules.healthAssessment),
    skilledInterventions: collectEvidence(oasisText, rules.skilledInterventions),
  };

  return {
    medicalNecessity: evidence.medicalNecessity.length > 0,
    homeboundReason: evidence.homeboundReason.length > 0,
    healthAssessment: evidence.healthAssessment.length > 0,
    skilledInterventions: evidence.skilledInterventions.length > 0,
    evidence,
  };
}
