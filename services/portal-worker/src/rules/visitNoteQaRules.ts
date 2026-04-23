import {
  type VisitNoteQaReport,
  type VisitNoteQaRule,
  type VisitNoteQaSection,
  type VisitNoteQaSectionId,
  type VisitNoteQaStatus,
  visitNoteQaReportSchema,
  visitNoteQaRuleSchema,
} from "@medical-ai-qa/shared-types";
import { type VisitNoteExtractionSnapshot } from "../types/visitNoteQa";

const REQUIRED_SECTION_RULES: Array<{
  ruleId: string;
  sectionId: VisitNoteQaSectionId;
  label: string;
}> = [
  { ruleId: "missing_subjective", sectionId: "subjective-info", label: "Subjective Info" },
  { ruleId: "missing_diagnosis", sectionId: "diagnosis-history", label: "Diagnosis History" },
  { ruleId: "missing_visit_summary", sectionId: "visit-summary", label: "Visit Summary" },
  { ruleId: "missing_safety_issues", sectionId: "safety-issues", label: "Safety Issues" },
  { ruleId: "missing_functional_mobility", sectionId: "functional-mobility", label: "Functional Mobility" },
] as const;

const SPARSE_NOTE_MEANINGFUL_SECTION_THRESHOLD = 3;
const SPARSE_NOTE_TEXT_THRESHOLD = 120;

export function buildVisitNoteQaReport(
  snapshot: VisitNoteExtractionSnapshot,
): VisitNoteQaReport {
  const rules = evaluateVisitNoteQaRules(snapshot);
  const summary = buildVisitNoteQaSummary(snapshot.sections, rules);

  return visitNoteQaReportSchema.parse({
    pageType: snapshot.pageType,
    url: snapshot.url,
    extractedAt: snapshot.extractedAt,
    sections: snapshot.sections,
    metadata: snapshot.metadata,
    rules,
    summary,
    warnings: snapshot.warnings,
  });
}

export function evaluateVisitNoteQaRules(
  snapshot: Pick<VisitNoteExtractionSnapshot, "sections" | "metadata">,
): VisitNoteQaRule[] {
  const sectionMap = new Map(snapshot.sections.map((section) => [section.id, section]));
  const rules: VisitNoteQaRule[] = REQUIRED_SECTION_RULES.map((definition) =>
    buildMissingSectionRule(sectionMap.get(definition.sectionId), definition),
  );

  rules.push(buildPossiblyUnsignedRule(snapshot.metadata.signatureState));
  rules.push(buildSparseNoteRule(snapshot.sections));

  return rules;
}

export function deriveVisitNoteOverallStatus(
  rules: Pick<VisitNoteQaRule, "status">[],
): VisitNoteQaStatus {
  if (rules.some((rule) => rule.status === "FAIL")) {
    return "FAIL";
  }

  if (rules.some((rule) => rule.status === "NEEDS_REVIEW")) {
    return "NEEDS_REVIEW";
  }

  return "PASS";
}

function buildVisitNoteQaSummary(
  sections: VisitNoteQaSection[],
  rules: VisitNoteQaRule[],
): VisitNoteQaReport["summary"] {
  const meaningfulSections = sections.filter((section) => section.hasMeaningfulContent);
  const missingSections = rules
    .filter((rule) => rule.status === "FAIL" && typeof rule.evidence.sectionId === "string")
    .map((rule) => rule.evidence.sectionId as VisitNoteQaSectionId);

  return {
    overallStatus: deriveVisitNoteOverallStatus(rules),
    missingSections,
    reviewFlags: rules.filter((rule) => rule.status !== "PASS").map((rule) => rule.id),
    meaningfulSectionCount: meaningfulSections.length,
    totalMeaningfulTextLength: meaningfulSections.reduce((total, section) => total + section.textLength, 0),
  };
}

function buildMissingSectionRule(
  section: VisitNoteQaSection | undefined,
  definition: {
    ruleId: string;
    sectionId: VisitNoteQaSectionId;
    label: string;
  },
): VisitNoteQaRule {
  const present = section?.present ?? false;
  const visible = section?.visible ?? false;
  const textLength = section?.textLength ?? 0;
  const hasMeaningfulContent = section?.hasMeaningfulContent ?? false;

  if (!present) {
    return visitNoteQaRuleSchema.parse({
      id: definition.ruleId,
      status: "FAIL",
      reason: `${definition.label} section was not detected on the visit note page.`,
      evidence: {
        sectionId: definition.sectionId,
        present,
        visible,
        textLength,
      },
    });
  }

  if (!hasMeaningfulContent) {
    return visitNoteQaRuleSchema.parse({
      id: definition.ruleId,
      status: "FAIL",
      reason: `${definition.label} section was detected but did not contain meaningful content.`,
      evidence: {
        sectionId: definition.sectionId,
        present,
        visible,
        textLength,
      },
    });
  }

  return visitNoteQaRuleSchema.parse({
    id: definition.ruleId,
    status: "PASS",
    reason: `${definition.label} section was detected with meaningful content.`,
    evidence: {
      sectionId: definition.sectionId,
      present,
      visible,
      textLength,
    },
  });
}

function buildPossiblyUnsignedRule(
  signatureState: VisitNoteExtractionSnapshot["metadata"]["signatureState"],
): VisitNoteQaRule {
  if (signatureState === "unsigned") {
    return visitNoteQaRuleSchema.parse({
      id: "possibly_unsigned",
      status: "NEEDS_REVIEW",
      reason: "An explicit unsigned or pending-signature indicator was detected.",
      evidence: {
        signatureState,
      },
    });
  }

  if (signatureState === "signed") {
    return visitNoteQaRuleSchema.parse({
      id: "possibly_unsigned",
      status: "PASS",
      reason: "An explicit signed indicator was detected.",
      evidence: {
        signatureState,
      },
    });
  }

  return visitNoteQaRuleSchema.parse({
    id: "possibly_unsigned",
    status: "PASS",
    reason: "No explicit unsigned indicator was detected.",
    evidence: {
      signatureState: null,
    },
  });
}

function buildSparseNoteRule(sections: VisitNoteQaSection[]): VisitNoteQaRule {
  const meaningfulSections = sections.filter((section) => section.hasMeaningfulContent);
  const totalMeaningfulTextLength = meaningfulSections.reduce(
    (total, section) => total + section.textLength,
    0,
  );

  if (
    meaningfulSections.length < SPARSE_NOTE_MEANINGFUL_SECTION_THRESHOLD ||
    totalMeaningfulTextLength < SPARSE_NOTE_TEXT_THRESHOLD
  ) {
    return visitNoteQaRuleSchema.parse({
      id: "sparse_note",
      status: "NEEDS_REVIEW",
      reason: "Tracked visit-note sections contained limited overall content and should be reviewed.",
      evidence: {
        meaningfulSectionCount: meaningfulSections.length,
        totalMeaningfulTextLength,
      },
    });
  }

  return visitNoteQaRuleSchema.parse({
    id: "sparse_note",
    status: "PASS",
    reason: "Tracked visit-note sections contained enough overall content for structural QA.",
    evidence: {
      meaningfulSectionCount: meaningfulSections.length,
      totalMeaningfulTextLength,
    },
  });
}
