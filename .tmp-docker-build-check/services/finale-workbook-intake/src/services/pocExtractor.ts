import type { ExtractedDocument } from "./documentExtractionService";

export type PocExtractionResult = {
  diagnosesOrCodesPresent: boolean;
  interventionsGoalsFrequencyPresent: boolean;
  exacerbationsConditionsPresent: boolean;
  evidence: {
    diagnosesOrCodesPresent: string[];
    interventionsGoalsFrequencyPresent: string[];
    exacerbationsConditionsPresent: string[];
  };
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

export function extractPocFields(documents: ExtractedDocument[]): PocExtractionResult {
  const pocText = documents
    .filter((document) => document.type === "POC")
    .map((document) => document.text)
    .join("\n");

  const diagnosesEvidence = collectEvidence(pocText, [
    /\bdiagnos(?:is|es)\b/i,
    /\bDX\b/i,
    /\bcode(?:s)?\b/i,
    /\bicd-?10\b/i,
  ]);
  const interventionEvidence = collectEvidence(pocText, [
    /\bintervention(?:s)?\b/i,
    /\bgoal(?:s)?\b/i,
    /\bfrequency\b/i,
    /\bvisit frequency\b/i,
  ]);
  const exacerbationEvidence = collectEvidence(pocText, [
    /\bcondition(?:s)?\b/i,
    /\bexacerbation(?:s)?\b/i,
    /\bco-morbid\b/i,
    /\bcomorbid\b/i,
  ]);

  return {
    diagnosesOrCodesPresent: diagnosesEvidence.length > 0,
    interventionsGoalsFrequencyPresent: interventionEvidence.length > 0,
    exacerbationsConditionsPresent: exacerbationEvidence.length > 0,
    evidence: {
      diagnosesOrCodesPresent: diagnosesEvidence,
      interventionsGoalsFrequencyPresent: interventionEvidence,
      exacerbationsConditionsPresent: exacerbationEvidence,
    },
  };
}
