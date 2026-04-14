import type { NormalizedReferralSection, SectionSpanReference } from "./types";

type SectionRule = {
  sectionName: NormalizedReferralSection["sectionName"];
  patterns: RegExp[];
};

const SECTION_RULES: SectionRule[] = [
  { sectionName: "patient_identity", patterns: [/\bpatient name\b/i, /\bdob\b/i, /\bresident\b/i] },
  { sectionName: "referral_metadata", patterns: [/\breferral\b/i, /\border date\b/i, /\bstart of care\b/i] },
  { sectionName: "referring_provider", patterns: [/\bordered by\b/i, /\battending physician\b/i, /\bnpi\b/i] },
  { sectionName: "hospitalization_history", patterns: [/\bhospital\b/i, /\bdischarge\b/i, /\binpatient\b/i, /\bacute care\b/i] },
  { sectionName: "primary_reason_for_home_health", patterns: [/\bprimary reason\b/i, /\breason for home health\b/i, /\badmit(?:ted)? .* home/i] },
  { sectionName: "medical_necessity", patterns: [/\bmedical necessity\b/i, /\bskilled nursing\b/i, /\bskilled need\b/i] },
  { sectionName: "homebound_evidence", patterns: [/\bhomebound\b/i, /\bleaving home\b/i, /\brequires assistance\b/i, /\bwalker\b/i] },
  { sectionName: "diagnoses", patterns: [/\bdiagnos(?:is|es)\b/i, /\bicd-?10\b/i, /\bprimary\b.*\bdiagnosis\b/i] },
  { sectionName: "medications", patterns: [/\bmedication\b/i, /\ballerg(?:y|ies)\b/i, /\bpharmacy\b/i] },
  { sectionName: "caregiver_support", patterns: [/\bcaregiver\b/i, /\bdaughter\b/i, /\bson\b/i, /\brelationship\b/i] },
  {
    sectionName: "living_situation",
    patterns: [
      /\blives with\b/i,
      /\bliving situation\b/i,
      /\bcurrent living arrangement\b/i,
      /\bdischarge(?:d)? to\s+(?:home|alf|ilf|assisted living(?: facility)?|independent living(?: facility)?|family|daughter|son|spouse)\b/i,
    ],
  },
  { sectionName: "functional_limitations", patterns: [/\bweakness\b/i, /\bdifficulty(?:\s+in)?\s+walking\b/i, /\bambulation\b/i, /\bendurance\b/i] },
  { sectionName: "therapy_need", patterns: [/\bpt\/ot\b/i, /\bphysical therapy\b/i, /\boccupational therapy\b/i, /\beval and treat\b/i] },
  { sectionName: "risk_factors", patterns: [/\bfall\b/i, /\brisk\b/i, /\bunsteady gait\b/i, /\bsafety\b/i] },
  { sectionName: "advance_directives", patterns: [/\badvance directive\b/i, /\bsurrogate\b/i] },
  { sectionName: "code_status", patterns: [/\bfull code\b/i, /\bdnr\b/i, /\bcode status\b/i] },
  { sectionName: "other_clinical_notes", patterns: [/\bclinical narrative\b/i, /\bnotes?\b/i, /\bplan\b/i] },
];

const SEGMENT_HEADINGS = [
  "Patient Name",
  "Resident Name",
  "DOB",
  "Birth Date",
  "Birthdate",
  "Order Date",
  "Referral Date",
  "Start of Care",
  "SOC Date",
  "Order Summary",
  "Primary Reason for Home Health / Medical Necessity",
  "Primary Reason for Home Health",
  "Reason for Home Health",
  "Medical Necessity",
  "Homebound Status",
  "Primary Caregiver",
  "Relationship",
  "Caregiver Phone",
  "Preferred Language",
  "Primary Lang.",
  "Interpreter Needed",
  "Diagnosis Information",
  "DIAGNOSIS INFORMATION",
  "Diagnoses",
  "ADVANCE DIRECTIVE",
  "Code Status",
  "Precautions Details",
  "Physical Therapy",
  "Occupational Therapy",
  "CONTACTS",
  "PHARMACY",
  "Admitted From",
  "Acute care hospital",
  "Most Recent Hospital Stay",
  "Lives with",
  "Living Situation",
  "Current Living Arrangement",
  "Discharge Date",
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function segmentReferralText(text: string): string[] {
  const headingPattern = SEGMENT_HEADINGS
    .sort((left, right) => right.length - left.length)
    .map((heading) => escapeRegExp(heading))
    .join("|");

  let segmented = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");

  segmented = segmented.replace(
    new RegExp(`\\s+(?=(?:${headingPattern})(?:\\b|\\s*[:/-]))`, "gi"),
    "\n",
  );
  segmented = segmented.replace(/\s+(?=Fax Server\b)/gi, "\n");
  segmented = segmented.replace(/\s+(?=PAGE\s+\d+\/\d+\b)/gi, "\n");
  segmented = segmented.replace(/([.!?])\s+(?=[A-Z])/g, "$1\n");
  segmented = segmented.replace(/;\s+(?=[A-Z])/g, ";\n");

  return segmented
    .split(/\n+/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);
}

function sliceSummary(spans: string[]): string | null {
  if (spans.length === 0) {
    return null;
  }
  return normalizeWhitespace(spans.slice(0, 3).join(" ")).slice(0, 420);
}

function buildLineOffsets(lines: string[]): Array<{ text: string; start: number; end: number; lineNumber: number }> {
  const offsets: Array<{ text: string; start: number; end: number; lineNumber: number }> = [];
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    offsets.push({
      text,
      start: cursor,
      end: cursor + text.length,
      lineNumber: index + 1,
    });
    cursor += text.length + 1;
  }
  return offsets;
}

export function normalizeReferralSections(text: string): NormalizedReferralSection[] {
  const segments = segmentReferralText(text);
  const lineOffsets = buildLineOffsets(segments);

  return SECTION_RULES.map((rule) => {
    const matchingLines = lineOffsets.filter(({ text: line }) =>
      rule.patterns.some((pattern) => pattern.test(line)));
    const lineReferences: SectionSpanReference[] = matchingLines.map((match) => ({
      lineStart: match.lineNumber,
      lineEnd: match.lineNumber,
      charStart: match.start,
      charEnd: match.end,
    }));
    const extractedTextSpans = matchingLines.map((match) => match.text);
    const confidence = matchingLines.length === 0
      ? 0
      : Math.min(1, Number((0.35 + matchingLines.length * 0.2).toFixed(2)));

    return {
      sectionName: rule.sectionName,
      extractedTextSpans,
      normalizedSummary: sliceSummary(extractedTextSpans),
      confidence,
      lineReferences,
    };
  }).filter((section) => section.extractedTextSpans.length > 0);
}
