import { createHash } from "node:crypto";
import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { resolveBedrockConfig, sendBedrockConverseWithProfileFallback } from "../config/bedrock";
import type { FinaleBatchEnv } from "../config/env";
import type {
  OasisDomDashboardSectionKey,
  OasisDomSectionOutputsArtifact,
  OasisDomSectionOutputRow,
} from "./oasisDomSectionProcessingService";
import type {
  OasisMggFieldSnapshotArtifact,
  OasisMggFieldSnapshotField,
} from "./oasisMggFieldSnapshotService";

export const OASIS_INTERNAL_MISMATCH_PROMPT_VERSION = "oasis-internal-mismatch-review.v2";

export type OasisCheckResultStatus = "clean" | "discrepancies_found" | "unavailable" | "failed";
export type OasisCheckSectionStatus = "clean" | "discrepancies_found" | "not_available";
export type OasisCheckConfidence = "high" | "medium" | "low";
export type OasisDischargeComparisonStatus = "available" | "unavailable";
export type OasisDischargeComparisonOutcome =
  | "improved"
  | "not_improved"
  | "worsened"
  | "mixed"
  | "unavailable";
export type OasisDischargeFindingResult =
  | "not_improved"
  | "worsened"
  | "goal_not_met"
  | "needs_review";
export type OasisDischargeFieldGroup = "M fields" | "GG fields";

export type OasisInternalMismatchFinding = {
  itemCode: string | null;
  itemLabel: string | null;
  primarySection: string;
  contradictingSections: string[];
  valuesInConflict: string[];
  reasoning: string;
  confidence: OasisCheckConfidence;
  reviewerAction: string;
};

export type OasisInternalMismatchSectionReport = {
  sectionKey: OasisDomDashboardSectionKey;
  sectionLabel: string;
  status: OasisCheckSectionStatus;
  discrepancies: OasisInternalMismatchFinding[];
};

export type OasisDischargeFinding = {
  fieldGroup: OasisDischargeFieldGroup;
  itemCode: string | null;
  itemLabel: string | null;
  baselineValue: string;
  dischargeValue: string;
  scoringInterpretation: string;
  result: OasisDischargeFindingResult;
  reasoning: string;
  confidence: OasisCheckConfidence;
  reviewerAction: string;
};

export type OasisDischargeComparisonReport = {
  status: OasisDischargeComparisonStatus;
  outcome: OasisDischargeComparisonOutcome;
  summary: string;
  baselineAssessment: {
    assessmentId: string | null;
    assessmentType: string | null;
    title: string | null;
    date: string | null;
    selectionReason: string | null;
  } | null;
  dischargeAssessment: {
    assessmentId: string;
    assessmentType: string | null;
    title: string | null;
    date: string | null;
  };
  reviewedItemCount: number;
  findings: OasisDischargeFinding[];
  warnings: string[];
};

export type OasisInternalMismatchReviewResult = {
  schemaVersion: "oasis-check-result.v1";
  assessmentId: string;
  assessmentType: string | null;
  title: string | null;
  date: string | null;
  status: OasisCheckResultStatus;
  summary: string;
  checkedAt: string;
  sections: OasisInternalMismatchSectionReport[];
  dischargeComparison: OasisDischargeComparisonReport | null;
  diagnostics: {
    modelId: string | null;
    promptVersion: string;
    inputHash: string;
    sourceArtifactPaths: string[];
    rawLlmParseStatus: "not_invoked" | "parsed" | "invalid_json" | "invocation_failed";
    warnings: string[];
    rawResponseExcerpt?: string | null;
    inputMode?: "dom_sections" | "pdf_direct";
    sourcePdfPath?: string | null;
    sourcePdfSha256?: string | null;
    sourcePdfSizeBytes?: number | null;
    baselinePdfPath?: string | null;
    baselinePdfSha256?: string | null;
    baselinePdfSizeBytes?: number | null;
    inputTokenCount?: number | null;
    outputTokenCount?: number | null;
    totalTokenCount?: number | null;
  };
};

export type OasisInternalMismatchReviewInvoke = (input: {
  prompt: string;
  inputHash: string;
}) => Promise<string | { content: string; modelId?: string | null }>;

const SECTION_LABELS: Record<OasisDomDashboardSectionKey, string> = {
  diagnoses: "Diagnoses",
  medications_allergies: "Medications & Allergies",
  safety_social_support: "Safety / Social Support",
  functional_therapy: "Functional / Therapy",
  body_systems: "Body Systems",
  dates_admin: "Dates / Admin",
  plan_of_care: "Plan of Care",
};

const SECTION_KEYS = Object.keys(SECTION_LABELS) as OasisDomDashboardSectionKey[];

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function getBedrockClient(region: string): BedrockRuntimeClient {
  const cached = bedrockClientByRegion.get(region);
  if (cached) {
    return cached;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function sanitizeText(value: unknown, maxLength = 700): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }
  const text = normalizeWhitespace(String(value));
  return text ? text.slice(0, maxLength) : null;
}

function sanitizeStringArray(value: unknown, maxItems: number, maxLength = 260): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => sanitizeText(entry, maxLength))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rowForPrompt(row: OasisDomSectionOutputRow) {
  return {
    label: row.label,
    value: row.value,
    meta: row.meta,
    sourceKind: row.sourceKind,
    sourceSectionTitle: row.sourceSectionTitle,
    sourceItemCode: row.sourceItemCode,
  };
}

function isDischargeAssessment(input: {
  assessmentType?: string | null;
  title?: string | null;
}): boolean {
  const type = normalizeWhitespace(input.assessmentType).toUpperCase();
  const title = normalizeWhitespace(input.title).toLowerCase();
  return type === "DC" || /\b(?:dc|d\/c|discharge|discharged)\b/.test(title);
}

function snapshotFieldForPrompt(field: OasisMggFieldSnapshotField) {
  return {
    fieldGroup: field.fieldGroup,
    itemCode: field.itemCode,
    itemLabel: field.itemLabel,
    sectionTitle: field.sectionTitle,
    selectedValue: field.selectedValue,
    selectedOptionText: field.selectedOptionText,
    optionTexts: field.optionTexts.slice(0, 20),
    confidence: field.confidence,
  };
}

function createUnavailableDischargeComparison(input: {
  assessmentId: string;
  assessmentType?: string | null;
  title?: string | null;
  date?: string | null;
  reason: string;
  baselineAssessment?: {
    assessmentId: string;
    assessmentType?: string | null;
    title?: string | null;
    date?: string | null;
    selectionReason?: string | null;
  } | null;
}): OasisDischargeComparisonReport {
  return {
    status: "unavailable",
    outcome: "unavailable",
    summary: input.reason,
    baselineAssessment: input.baselineAssessment
      ? {
          assessmentId: input.baselineAssessment.assessmentId,
          assessmentType: input.baselineAssessment.assessmentType ?? null,
          title: input.baselineAssessment.title ?? null,
          date: input.baselineAssessment.date ?? null,
          selectionReason: input.baselineAssessment.selectionReason ?? null,
        }
      : null,
    dischargeAssessment: {
      assessmentId: input.assessmentId,
      assessmentType: input.assessmentType ?? null,
      title: input.title ?? null,
      date: input.date ?? null,
    },
    reviewedItemCount: 0,
    findings: [],
    warnings: [input.reason],
  };
}

function buildReviewInput(input: {
  assessmentId: string;
  assessmentType?: string | null;
  title?: string | null;
  date?: string | null;
  sectionOutputs: OasisDomSectionOutputsArtifact;
  mggSnapshot?: OasisMggFieldSnapshotArtifact | null;
  baselineAssessment?: {
    assessmentId: string;
    assessmentType?: string | null;
    title?: string | null;
    date?: string | null;
    selectionReason?: string | null;
    mggSnapshot?: OasisMggFieldSnapshotArtifact | null;
    unavailableReason?: string | null;
  } | null;
}) {
  const dischargeMode = isDischargeAssessment(input);
  return {
    assessment: {
      id: input.assessmentId,
      assessmentType: input.assessmentType ?? null,
      title: input.title ?? null,
      date: input.date ?? null,
      isDischarge: dischargeMode,
    },
    dischargeComparison: dischargeMode
      ? {
          baselineAssessment: input.baselineAssessment
            ? {
                id: input.baselineAssessment.assessmentId,
                assessmentType: input.baselineAssessment.assessmentType ?? null,
                title: input.baselineAssessment.title ?? null,
                date: input.baselineAssessment.date ?? null,
                selectionReason: input.baselineAssessment.selectionReason ?? null,
                unavailableReason: input.baselineAssessment.unavailableReason ?? null,
                fieldCount: input.baselineAssessment.mggSnapshot?.fieldCount ?? 0,
                fields: (input.baselineAssessment.mggSnapshot?.fields ?? [])
                  .map(snapshotFieldForPrompt)
                  .slice(0, 220),
              }
            : null,
          fieldCount: input.mggSnapshot?.fieldCount ?? 0,
          fields: (input.mggSnapshot?.fields ?? [])
            .map(snapshotFieldForPrompt)
            .slice(0, 220),
        }
      : null,
    sections: SECTION_KEYS.map((sectionKey) => {
      const section = input.sectionOutputs.sections.find((entry) => entry.sectionKey === sectionKey);
      return {
        sectionKey,
        sectionLabel: SECTION_LABELS[sectionKey],
        sourceSectionTitles: section?.sourceSectionTitles ?? [],
        rows: (section?.rows ?? []).slice(0, 90).map(rowForPrompt),
        warnings: section?.warnings ?? [],
      };
    }),
  };
}

function dischargeBaselineForReport(
  baselineAssessment: NonNullable<NonNullable<ReturnType<typeof buildReviewInput>["dischargeComparison"]>["baselineAssessment"]>,
) {
  return {
    assessmentId: baselineAssessment.id,
    assessmentType: baselineAssessment.assessmentType,
    title: baselineAssessment.title,
    date: baselineAssessment.date,
    selectionReason: baselineAssessment.selectionReason,
  };
}

function createInputUnavailableDischargeComparison(
  reviewInput: ReturnType<typeof buildReviewInput>,
): OasisDischargeComparisonReport | null {
  const dischargeComparison = reviewInput.dischargeComparison;
  if (!dischargeComparison) {
    return null;
  }

  if (!dischargeComparison.baselineAssessment) {
    return createUnavailableDischargeComparison({
      assessmentId: reviewInput.assessment.id,
      assessmentType: reviewInput.assessment.assessmentType,
      title: reviewInput.assessment.title,
      date: reviewInput.assessment.date,
      reason: "No SOC or earlier non-discharge OASIS baseline was available for discharge comparison.",
    });
  }

  if (dischargeComparison.baselineAssessment.fields.length === 0) {
    return createUnavailableDischargeComparison({
      assessmentId: reviewInput.assessment.id,
      assessmentType: reviewInput.assessment.assessmentType,
      title: reviewInput.assessment.title,
      date: reviewInput.assessment.date,
      baselineAssessment: dischargeBaselineForReport(dischargeComparison.baselineAssessment),
      reason: dischargeComparison.baselineAssessment.unavailableReason ??
        "Baseline OASIS was found, but its M/GG field snapshot was unavailable.",
    });
  }

  if (dischargeComparison.fields.length === 0) {
    return createUnavailableDischargeComparison({
      assessmentId: reviewInput.assessment.id,
      assessmentType: reviewInput.assessment.assessmentType,
      title: reviewInput.assessment.title,
      date: reviewInput.assessment.date,
      baselineAssessment: dischargeBaselineForReport(dischargeComparison.baselineAssessment),
      reason: "Discharge OASIS M/GG field snapshot did not contain comparable selected fields.",
    });
  }

  return null;
}

function createFallbackUnavailableDischargeComparison(
  reviewInput: ReturnType<typeof buildReviewInput>,
  reason: string,
): OasisDischargeComparisonReport | null {
  const dischargeComparison = reviewInput.dischargeComparison;
  if (!dischargeComparison) {
    return null;
  }

  const inputUnavailable = createInputUnavailableDischargeComparison(reviewInput);
  if (inputUnavailable) {
    return inputUnavailable;
  }

  return createUnavailableDischargeComparison({
    assessmentId: reviewInput.assessment.id,
    assessmentType: reviewInput.assessment.assessmentType,
    title: reviewInput.assessment.title,
    date: reviewInput.assessment.date,
    baselineAssessment: dischargeComparison.baselineAssessment
      ? dischargeBaselineForReport(dischargeComparison.baselineAssessment)
      : null,
    reason,
  });
}

type OasisMggPromptField = NonNullable<ReturnType<typeof buildReviewInput>["dischargeComparison"]>["fields"][number];

function parseSelectedScore(field: OasisMggPromptField): number | null {
  const text = normalizeWhitespace([
    field.selectedValue,
    field.selectedOptionText,
  ].filter(Boolean).join(" "));
  const match = text.match(/^\s*\(?(\d{1,2}|88)\)?\.?/);
  if (!match) {
    return null;
  }
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : null;
}

function hasClearGgDirection(field: OasisMggPromptField): boolean {
  const options = field.optionTexts.join(" ").toLowerCase();
  return /\b01\.?\s+dependent\b/.test(options) &&
    /\b06\.?\s+independent\b/.test(options);
}

function comparisonDirection(field: OasisMggPromptField): "lower_is_better" | "higher_is_better" | null {
  if (field.fieldGroup === "M fields") {
    return "lower_is_better";
  }
  return hasClearGgDirection(field) ? "higher_is_better" : null;
}

function scoreIsSpecialReviewCode(field: OasisMggPromptField, score: number): boolean {
  if (field.fieldGroup !== "GG fields") {
    return false;
  }
  return score === 7 || score === 9 || score === 10 || score === 88;
}

function comparisonValue(field: OasisMggPromptField): string {
  return normalizeWhitespace([
    field.selectedValue,
    field.selectedOptionText,
  ].filter(Boolean).join(" - ")) || "No selected value captured";
}

function scoringInterpretationFor(direction: "lower_is_better" | "higher_is_better" | null): string {
  if (direction === "lower_is_better") {
    return "Lower score indicates better function for this captured scale.";
  }
  if (direction === "higher_is_better") {
    return "Higher score indicates better function for this captured GG scale.";
  }
  return "Scoring direction was not clear from the captured option text.";
}

function dischargeFindingForPair(input: {
  baselineField: OasisMggPromptField;
  dischargeField: OasisMggPromptField;
}): OasisDischargeFinding | null {
  const baselineScore = parseSelectedScore(input.baselineField);
  const dischargeScore = parseSelectedScore(input.dischargeField);
  const direction = comparisonDirection(input.dischargeField);
  const itemCode = input.dischargeField.itemCode || input.baselineField.itemCode || null;
  const itemLabel = input.dischargeField.itemLabel ?? input.baselineField.itemLabel ?? null;
  const baselineValue = comparisonValue(input.baselineField);
  const dischargeValue = comparisonValue(input.dischargeField);

  if (baselineScore === null || dischargeScore === null || !direction ||
    scoreIsSpecialReviewCode(input.dischargeField, dischargeScore) ||
    scoreIsSpecialReviewCode(input.baselineField, baselineScore)) {
    return {
      fieldGroup: input.dischargeField.fieldGroup,
      itemCode,
      itemLabel,
      baselineValue,
      dischargeValue,
      scoringInterpretation: scoringInterpretationFor(direction),
      result: "needs_review",
      reasoning: "Captured values need reviewer confirmation before improvement can be scored.",
      confidence: "low",
      reviewerAction: "Verify the baseline and discharge selections and confirm the item scoring direction.",
    };
  }

  const delta = dischargeScore - baselineScore;
  const improved = direction === "lower_is_better" ? delta < 0 : delta > 0;
  if (improved) {
    return null;
  }

  const worsened = direction === "lower_is_better" ? delta > 0 : delta < 0;
  return {
    fieldGroup: input.dischargeField.fieldGroup,
    itemCode,
    itemLabel,
    baselineValue,
    dischargeValue,
    scoringInterpretation: scoringInterpretationFor(direction),
    result: worsened ? "worsened" : "not_improved",
    reasoning: worsened
      ? "Discharge score is worse than the baseline score for the same OASIS item."
      : "Discharge score did not improve from the baseline score for the same OASIS item.",
    confidence: "high",
    reviewerAction: "Review the discharge response against the baseline OASIS and update or justify the selected value.",
  };
}

function dischargeOutcomeFor(findings: OasisDischargeFinding[]): OasisDischargeComparisonOutcome {
  if (findings.length === 0) {
    return "improved";
  }
  const results = new Set(findings.map((finding) => finding.result));
  if (results.size === 1 && results.has("worsened")) {
    return "worsened";
  }
  if (results.size === 1 && results.has("not_improved")) {
    return "not_improved";
  }
  return "mixed";
}

function buildDeterministicDischargeComparison(
  reviewInput: ReturnType<typeof buildReviewInput>,
): OasisDischargeComparisonReport | null {
  const unavailable = createInputUnavailableDischargeComparison(reviewInput);
  if (unavailable || !reviewInput.dischargeComparison?.baselineAssessment) {
    return unavailable;
  }

  const baselineFieldsByCode = new Map<string, OasisMggPromptField>();
  for (const field of reviewInput.dischargeComparison.baselineAssessment.fields) {
    baselineFieldsByCode.set(field.itemCode.toUpperCase(), field);
  }

  const findings: OasisDischargeFinding[] = [];
  let reviewedItemCount = 0;
  for (const dischargeField of reviewInput.dischargeComparison.fields) {
    const baselineField = baselineFieldsByCode.get(dischargeField.itemCode.toUpperCase());
    if (!baselineField) {
      continue;
    }
    reviewedItemCount += 1;
    const finding = dischargeFindingForPair({ baselineField, dischargeField });
    if (finding) {
      findings.push(finding);
    }
  }

  const outcome = dischargeOutcomeFor(findings);
  const baselineAssessment = reviewInput.dischargeComparison.baselineAssessment;
  return {
    status: reviewedItemCount === 0 ? "unavailable" : "available",
    outcome: reviewedItemCount === 0 ? "unavailable" : outcome,
    summary: reviewedItemCount === 0
      ? "No matching M/GG items were available between baseline and discharge snapshots."
      : findings.length > 0
        ? `${findings.length} M/GG discharge comparison item${findings.length === 1 ? "" : "s"} need review.`
        : "Discharge M/GG values improved on all comparable captured items.",
    baselineAssessment: dischargeBaselineForReport(baselineAssessment),
    dischargeAssessment: {
      assessmentId: reviewInput.assessment.id,
      assessmentType: reviewInput.assessment.assessmentType,
      title: reviewInput.assessment.title,
      date: reviewInput.assessment.date,
    },
    reviewedItemCount,
    findings: findings.slice(0, 40),
    warnings: reviewedItemCount === 0
      ? ["No matching M/GG item codes were found between baseline and discharge snapshots."]
      : [],
  };
}

function buildPrompt(input: ReturnType<typeof buildReviewInput>): string {
  return [
    "You are reviewing one OASIS assessment for internal documentation discrepancies.",
    "Use only the supplied OASIS section rows. Do not use referral documents, Plan of Care, Visit Notes, outside clinical knowledge, or assumptions.",
    "Find direct contradictions within a section and across sections. Example: a diagnosis/condition implies the patient cannot ambulate, while Functional / Therapy states independent ambulation.",
    "Do not perform discharge improvement comparison. M/GG discharge comparison is handled by a separate deterministic snapshot comparison.",
    "Group each finding under the most relevant primary OASIS category, and name every contradicting section involved.",
    "Keep findings concise, specific, source-grounded, and clinically actionable. Do not include generic quality advice.",
    "Return strict JSON only. Do not include markdown, commentary, or code fences.",
    "Required JSON shape:",
    JSON.stringify({
      summary: "One concise sentence.",
      sections: [{
        sectionKey: "diagnoses",
        sectionLabel: "Diagnoses",
        discrepancies: [{
          itemCode: "M1021 or null",
          itemLabel: "short item label or null",
          primarySection: "Diagnoses",
          contradictingSections: ["Functional / Therapy"],
          valuesInConflict: ["Diagnosis says ...", "Functional / Therapy says ..."],
          reasoning: "One concise sentence explaining the contradiction.",
          confidence: "high|medium|low",
          reviewerAction: "Specific verification action.",
        }],
      }],
    }),
    "Allowed sectionKey values:",
    SECTION_KEYS.join(", "),
    "OASIS input:",
    JSON.stringify(input),
  ].join("\n");
}

function extractConverseText(response: ConverseCommandOutput): string {
  const parts = response.output?.message?.content ?? [];
  return parts
    .map((part) => "text" in part && typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trim();
}

async function invokeBedrock(input: {
  env: FinaleBatchEnv;
  prompt: string;
}): Promise<{ content: string; modelId: string }> {
  const config = resolveBedrockConfig({
    ...input.env,
    CODE_LLM_ENABLED: true,
    BEDROCK_MODEL_ID:
      input.env.OASIS_CHECK_LLM_MODEL_ID ??
      input.env.OASIS_SECTION_LLM_MODEL_ID ??
      input.env.BEDROCK_MODEL_ID,
  });
  const client = getBedrockClient(config.region);
  const { response, invocationModelId } = await sendBedrockConverseWithProfileFallback({
    client,
    config,
    command: {
      messages: [{
        role: "user",
        content: [{ text: input.prompt }],
      }],
      inferenceConfig: {
        maxTokens: input.env.OASIS_CHECK_LLM_MAX_TOKENS,
        temperature: 0,
      },
    },
  });
  return {
    content: extractConverseText(response),
    modelId: invocationModelId,
  };
}

function isOasisCheckLlmEnabled(env: FinaleBatchEnv, invokeText?: OasisInternalMismatchReviewInvoke): boolean {
  if (invokeText) {
    return true;
  }
  return Boolean(env.CODE_LLM_ENABLED && env.LLM_PROVIDER === "bedrock");
}

function configuredModelId(env: FinaleBatchEnv, enabled: boolean): string | null {
  if (!enabled) {
    return null;
  }
  return env.OASIS_CHECK_LLM_MODEL_ID ??
    env.OASIS_SECTION_LLM_MODEL_ID ??
    env.BEDROCK_INFERENCE_PROFILE_ID ??
    env.BEDROCK_MODEL_ID ??
    "bedrock";
}

function emptySections(status: OasisCheckSectionStatus = "clean"): OasisInternalMismatchSectionReport[] {
  return SECTION_KEYS.map((sectionKey) => ({
    sectionKey,
    sectionLabel: SECTION_LABELS[sectionKey],
    status,
    discrepancies: [],
  }));
}

function parseLlmJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("OASIS check LLM output was not strict JSON.");
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OASIS check LLM output must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function normalizeConfidence(value: unknown): OasisCheckConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function normalizeFinding(value: unknown, fallbackSectionLabel: string): OasisInternalMismatchFinding | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!record) {
    return null;
  }
  const reasoning = sanitizeText(record.reasoning, 360);
  const reviewerAction = sanitizeText(record.reviewerAction, 260);
  const valuesInConflict = sanitizeStringArray(record.valuesInConflict, 4, 260);
  if (!reasoning || !reviewerAction || valuesInConflict.length < 2) {
    return null;
  }
  const primarySection = sanitizeText(record.primarySection, 100) ?? fallbackSectionLabel;
  return {
    itemCode: sanitizeText(record.itemCode, 80),
    itemLabel: sanitizeText(record.itemLabel, 160),
    primarySection,
    contradictingSections: sanitizeStringArray(record.contradictingSections, 5, 100),
    valuesInConflict,
    reasoning,
    confidence: normalizeConfidence(record.confidence),
    reviewerAction,
  };
}

function asRecordLike(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseLlmReview(
  content: string,
  reviewInput: ReturnType<typeof buildReviewInput>,
): Pick<OasisInternalMismatchReviewResult, "status" | "summary" | "sections" | "dischargeComparison"> {
  const parsed = parseLlmJson(content);
  const sectionsByKey = new Map<OasisDomDashboardSectionKey, OasisInternalMismatchSectionReport>();

  for (const rawSection of Array.isArray(parsed.sections) ? parsed.sections : []) {
    const sectionRecord = rawSection && typeof rawSection === "object" && !Array.isArray(rawSection)
      ? rawSection as Record<string, unknown>
      : null;
    if (!sectionRecord) {
      continue;
    }
    const sectionKey = sanitizeText(sectionRecord.sectionKey, 80) as OasisDomDashboardSectionKey | null;
    if (!sectionKey || !SECTION_KEYS.includes(sectionKey)) {
      continue;
    }
    const sectionLabel = sanitizeText(sectionRecord.sectionLabel, 120) ?? SECTION_LABELS[sectionKey];
    const discrepancies = (Array.isArray(sectionRecord.discrepancies) ? sectionRecord.discrepancies : [])
      .map((entry) => normalizeFinding(entry, sectionLabel))
      .filter((entry): entry is OasisInternalMismatchFinding => Boolean(entry))
      .slice(0, 12);
    sectionsByKey.set(sectionKey, {
      sectionKey,
      sectionLabel,
      status: discrepancies.length > 0 ? "discrepancies_found" : "clean",
      discrepancies,
    });
  }

  const sections = SECTION_KEYS.map((sectionKey) =>
    sectionsByKey.get(sectionKey) ?? {
      sectionKey,
      sectionLabel: SECTION_LABELS[sectionKey],
      status: "clean" as const,
      discrepancies: [],
    }
  );
  const discrepancyCount = sections.reduce((total, section) => total + section.discrepancies.length, 0);
  const dischargeComparison = buildDeterministicDischargeComparison(reviewInput);
  const dischargeFindingCount = dischargeComparison?.findings.length ?? 0;
  return {
    status: discrepancyCount > 0 || dischargeFindingCount > 0 ? "discrepancies_found" : "clean",
    summary: sanitizeText(parsed.summary, 220) ??
      (discrepancyCount > 0 || dischargeFindingCount > 0
        ? `${discrepancyCount + dischargeFindingCount} OASIS check finding${discrepancyCount + dischargeFindingCount === 1 ? "" : "s"} found.`
        : "No internal OASIS discrepancies found."),
    sections,
    dischargeComparison,
  };
}

export async function buildOasisInternalMismatchReview(input: {
  assessmentId: string;
  assessmentType?: string | null;
  title?: string | null;
  date?: string | null;
  sectionOutputs: OasisDomSectionOutputsArtifact;
  mggSnapshot?: OasisMggFieldSnapshotArtifact | null;
  baselineAssessment?: {
    assessmentId: string;
    assessmentType?: string | null;
    title?: string | null;
    date?: string | null;
    selectionReason?: string | null;
    mggSnapshot?: OasisMggFieldSnapshotArtifact | null;
    unavailableReason?: string | null;
  } | null;
  sourceArtifactPaths?: string[];
  env: FinaleBatchEnv;
  invokeText?: OasisInternalMismatchReviewInvoke;
  checkedAt?: string;
}): Promise<OasisInternalMismatchReviewResult> {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const reviewInput = buildReviewInput(input);
  const inputHash = sha256(stableJson(reviewInput));
  const llmEnabled = isOasisCheckLlmEnabled(input.env, input.invokeText);
  const modelId = configuredModelId(input.env, llmEnabled);
  const sourceArtifactPaths = input.sourceArtifactPaths ?? [];

  if (!llmEnabled) {
    const dischargeComparison = buildDeterministicDischargeComparison(reviewInput);
    const dischargeFindingCount = dischargeComparison?.findings.length ?? 0;
    return {
      schemaVersion: "oasis-check-result.v1",
      assessmentId: input.assessmentId,
      assessmentType: input.assessmentType ?? null,
      title: input.title ?? null,
      date: input.date ?? null,
      status: dischargeFindingCount > 0 ? "discrepancies_found" : "unavailable",
      summary: dischargeFindingCount > 0
        ? dischargeComparison?.summary ?? "Discharge M/GG comparison found items needing review."
        : "OASIS check LLM is not enabled.",
      checkedAt,
      sections: emptySections("not_available"),
      dischargeComparison,
      diagnostics: {
        modelId,
        promptVersion: OASIS_INTERNAL_MISMATCH_PROMPT_VERSION,
        inputHash,
        sourceArtifactPaths,
        rawLlmParseStatus: "not_invoked",
        warnings: ["OASIS check skipped because CODE_LLM_ENABLED is not true or LLM_PROVIDER is not bedrock."],
      },
    };
  }

  const prompt = buildPrompt(reviewInput);
  try {
    const invoked = input.invokeText
      ? await input.invokeText({ prompt, inputHash })
      : await invokeBedrock({ env: input.env, prompt });
    const content = typeof invoked === "string" ? invoked : invoked.content;
    const invokedModelId = typeof invoked === "string" ? modelId : invoked.modelId ?? modelId;
    const parsed = parseLlmReview(content, reviewInput);
    return {
      schemaVersion: "oasis-check-result.v1",
      assessmentId: input.assessmentId,
      assessmentType: input.assessmentType ?? null,
      title: input.title ?? null,
      date: input.date ?? null,
      ...parsed,
      checkedAt,
      diagnostics: {
        modelId: invokedModelId,
        promptVersion: OASIS_INTERNAL_MISMATCH_PROMPT_VERSION,
        inputHash,
        sourceArtifactPaths,
        rawLlmParseStatus: "parsed",
        warnings: [],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      schemaVersion: "oasis-check-result.v1",
      assessmentId: input.assessmentId,
      assessmentType: input.assessmentType ?? null,
      title: input.title ?? null,
      date: input.date ?? null,
      status: /JSON|strict|object/i.test(message) ? "failed" : "unavailable",
      summary: "OASIS mismatch review could not produce a usable report.",
      checkedAt,
      sections: emptySections("not_available"),
      dischargeComparison: createFallbackUnavailableDischargeComparison(
        reviewInput,
        "OASIS mismatch review could not produce a usable report.",
      ),
      diagnostics: {
        modelId,
        promptVersion: OASIS_INTERNAL_MISMATCH_PROMPT_VERSION,
        inputHash,
        sourceArtifactPaths,
        rawLlmParseStatus: /JSON|strict|object/i.test(message) ? "invalid_json" : "invocation_failed",
        warnings: [message.slice(0, 300)],
        rawResponseExcerpt: null,
      },
    };
  }
}
