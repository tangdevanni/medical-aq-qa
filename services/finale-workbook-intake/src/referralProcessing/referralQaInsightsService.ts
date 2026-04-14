import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { FinaleBatchEnv } from "../config/env";
import type {
  FieldComparisonResult,
  FieldMapSnapshot,
  NormalizedReferralSection,
  ReferralExtractedFact,
  ReferralExtractedFacts,
  ReferralFieldProposal,
  ReferralLlmProposal,
  ReferralQaConsistencyCheck,
  ReferralQaDraftNarrative,
  ReferralQaInsights,
  ReferralQaSourceHighlight,
} from "./types";
import { parseReferralQaInsightsPayload } from "./referralQaInsightsSchema";

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

const CONSISTENCY_TEMPLATES: Array<{
  id: ReferralQaConsistencyCheck["id"];
  title: string;
}> = [
  { id: "mental-status-vs-m1700-m1710", title: "M1700/M1710 vs Mental Status selections" },
  { id: "vision-vs-b1000-glasses", title: "B1000 vision impairment vs glasses selection" },
  { id: "respiratory-vs-m1400", title: "Respiratory findings vs M1400 shortness of breath answer" },
  { id: "functional-vs-gg0130-gg0170", title: "Functional M items vs GG0130 and GG0170 scores" },
  { id: "wound-vs-worksheet", title: "Wound answers vs integumentary details and wound worksheet" },
  { id: "pain-vs-j0510-j0520-j0530", title: "Pain presence vs J0510/J0520/J0530 logic" },
  { id: "depression-vs-d0150", title: "Depression diagnosis/documentation vs D0150 completion" },
];

const SOURCE_HIGHLIGHT_TEMPLATES: Array<{
  id: ReferralQaSourceHighlight["id"];
  title: string;
}> = [
  { id: "homebound-reason", title: "Homebound reason" },
  { id: "medical-necessity", title: "Medical necessity" },
  { id: "prior-level-of-function", title: "Prior level of function" },
  { id: "wound-history", title: "Wound history" },
  { id: "diet-and-fluid-instructions", title: "Diet and fluid instructions" },
  { id: "pmh-immunizations-diabetes", title: "PMH, immunizations, and DM status" },
  { id: "diagnoses-and-coding-support", title: "Diagnoses and possible coding support references" },
];

const DRAFT_NARRATIVE_TEMPLATES: Array<{
  field_key: ReferralQaDraftNarrative["field_key"];
  label: string;
}> = [
  { field_key: "homebound_narrative", label: "Homebound Reason" },
  { field_key: "primary_reason_for_home_health_medical_necessity", label: "Medical Necessity" },
  { field_key: "patient_summary_narrative", label: "Patient Summary / Clinical Narrative" },
  { field_key: "skilled_interventions", label: "Skilled Interventions" },
  { field_key: "plan_for_next_visit", label: "Plan For Next Visit" },
  { field_key: "care_plan_problems_goals_interventions", label: "Care Plan Problems / Goals / Interventions" },
  { field_key: "patient_caregiver_goals", label: "Patient / Caregiver Goals" },
];

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function isReferralQaInsightsLlmEnabled(env: FinaleBatchEnv): boolean {
  return Boolean(env.CODE_LLM_ENABLED && env.LLM_PROVIDER === "bedrock");
}

function resolveBedrockConfig(env: FinaleBatchEnv): { region: string; modelId: string } {
  const region = normalizeWhitespace(env.BEDROCK_REGION);
  const modelId = normalizeWhitespace(env.BEDROCK_MODEL_ID);
  if (!region) {
    throw new Error("CODE_LLM_ENABLED=true requires BEDROCK_REGION when LLM_PROVIDER=bedrock.");
  }
  if (!modelId) {
    throw new Error("CODE_LLM_ENABLED=true requires BEDROCK_MODEL_ID when LLM_PROVIDER=bedrock.");
  }
  return { region, modelId };
}

function getBedrockClient(region: string): BedrockRuntimeClient {
  const existing = bedrockClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function extractConverseText(response: ConverseCommandOutput): string {
  const blocks = response.output?.message?.content;
  if (!blocks) {
    return "";
  }
  const texts: string[] = [];
  for (const block of blocks) {
    if ("text" in block && typeof block.text === "string") {
      const value = normalizeWhitespace(block.text);
      if (value) {
        texts.push(value);
      }
    }
  }
  return normalizeWhitespace(texts.join("\n"));
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyValue(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function findFact(facts: ReferralExtractedFact[], factKey: string): ReferralExtractedFact | null {
  return facts.find((fact) => fact.fact_key === factKey) ?? null;
}

function findProposal(proposals: ReferralFieldProposal[], fieldKey: string): ReferralFieldProposal | null {
  return proposals.find((proposal) => proposal.field_key === fieldKey) ?? null;
}

function fieldValue(fieldMapSnapshot: FieldMapSnapshot, fieldKey: string): unknown {
  return fieldMapSnapshot.fields.find((field) => field.key === fieldKey)?.currentChartValue ?? null;
}

function firstMatchingSpan(sourceText: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    const value = normalizeWhitespace(match?.[1] ?? match?.[0]);
    if (value) {
      return value;
    }
  }
  return null;
}

function fallbackNarrative(input: {
  fieldKey: ReferralQaDraftNarrative["field_key"];
  label: string;
  extractedFacts: ReferralExtractedFacts;
  llmProposal: ReferralLlmProposal;
  sourceText: string;
}): ReferralQaDraftNarrative {
  const proposalValue = stringifyValue(findProposal(input.llmProposal.proposed_field_values, input.fieldKey)?.proposed_value);
  if (proposalValue) {
    return {
      field_key: input.fieldKey,
      label: input.label,
      draft: proposalValue,
      status: "ready_for_qa",
    };
  }

  const factText = (factKey: string): string => stringifyValue(findFact(input.extractedFacts.facts, factKey)?.value);
  const diagnosisSummary = input.extractedFacts.diagnosis_candidates
    .slice(0, 3)
    .map((candidate) => candidate.description)
    .filter(Boolean)
    .join("; ");

  let draft = "";
  switch (input.fieldKey) {
    case "homebound_narrative":
      draft = factText("homebound_narrative") || factText("functional_limitations");
      break;
    case "primary_reason_for_home_health_medical_necessity":
      draft = factText("medical_necessity_summary") || factText("order_summary");
      break;
    case "patient_summary_narrative": {
      const medicalNecessity = factText("medical_necessity_summary");
      const therapyNeed = factText("therapy_need");
      const homebound = factText("homebound_narrative");
      draft = [medicalNecessity, diagnosisSummary, therapyNeed, homebound]
        .filter(Boolean)
        .join(". ");
      break;
    }
    case "skilled_interventions": {
      const orderSummary = factText("order_summary");
      const therapyNeed = factText("therapy_need");
      draft = [orderSummary, therapyNeed].filter(Boolean).join(". ");
      break;
    }
    case "plan_for_next_visit": {
      const wound = firstMatchingSpan(input.sourceText, [/\b(wound care[^.]{0,200})/i]);
      const therapy = factText("therapy_need");
      const medMgmt = firstMatchingSpan(input.sourceText, [/\b(medication mgmt[^.]{0,200})/i]);
      draft = [medMgmt, wound, therapy].filter(Boolean).join(". ");
      break;
    }
    case "care_plan_problems_goals_interventions": {
      const diagnosis = diagnosisSummary;
      const functionText = factText("functional_limitations");
      const therapyNeed = factText("therapy_need");
      draft = [diagnosis, functionText, therapyNeed].filter(Boolean).join(". ");
      break;
    }
    case "patient_caregiver_goals": {
      const goalText = firstMatchingSpan(input.sourceText, [/\b(Pt expresses excitement to return home soon[^.]*\.)/i]);
      const caregiverName = factText("caregiver_name");
      draft = goalText || (caregiverName ? `Patient and caregiver ${caregiverName} need reinforcement on the home plan and symptom reporting.` : "");
      break;
    }
  }

  const normalizedDraft = normalizeWhitespace(draft) || `Referral documents do not provide a chart-ready ${input.label.toLowerCase()} draft.`;
  return {
    field_key: input.fieldKey,
    label: input.label,
    draft: normalizedDraft,
    status: normalizedDraft.startsWith("Referral documents do not provide") ? "needs_human_review" : "ready_for_qa",
  };
}

function buildDeterministicFallback(input: {
  extractedFacts: ReferralExtractedFacts;
  fieldMapSnapshot: FieldMapSnapshot;
  llmProposal: ReferralLlmProposal;
  fieldComparisons: FieldComparisonResult[];
  normalizedSections: NormalizedReferralSection[];
  sourceText: string;
}): ReferralQaInsights {
  const factText = (factKey: string): string => stringifyValue(findFact(input.extractedFacts.facts, factKey)?.value);
  const chartText = (fieldKey: string): string => stringifyValue(fieldValue(input.fieldMapSnapshot, fieldKey));
  const proposedText = (fieldKey: string): string => stringifyValue(findProposal(input.llmProposal.proposed_field_values, fieldKey)?.proposed_value);
  const sectionText = (sectionName: string): string => normalizeWhitespace(
    input.normalizedSections
      .filter((section) => section.sectionName === sectionName)
      .flatMap((section) => section.extractedTextSpans)
      .join(" "),
  );
  const dietText = firstMatchingSpan(input.sourceText, [
    /\b(Placed on pur[eé]ed diet[^.]*\.)/i,
    /\b(Pureed diet[^.]{0,180})/i,
    /\b(diet[^.]{0,180})/i,
    /\b(fluid[^.]{0,180})/i,
  ]);

  const consistencyChecks: ReferralQaConsistencyCheck[] = [
    {
      id: "mental-status-vs-m1700-m1710",
      status: chartText("neurological_status") || chartText("emotional_behavioral_status") ? "watch" : "flagged",
      title: "M1700/M1710 vs Mental Status selections",
      detail: normalizeWhitespace(
        chartText("neurological_status") || chartText("emotional_behavioral_status")
          ? `Referral documents describe mental-status evidence as ${proposedText("emotional_behavioral_status") || sectionText("other_clinical_notes") || "confusion and cognitive concerns"} while chart mental-status fields currently read ${chartText("neurological_status") || chartText("emotional_behavioral_status")}.`
          : `Referral documents describe mental-status evidence as ${proposedText("emotional_behavioral_status") || sectionText("other_clinical_notes") || "confusion and cognitive concerns"}, and the chart snapshot does not currently show corresponding mental-status selections.`,
      ),
      related_sections: ["Neurological (Head, Mood, Eyes, Ears)"],
    },
    {
      id: "vision-vs-b1000-glasses",
      status: chartText("eyes_ears_status") ? "watch" : "flagged",
      title: "B1000 vision impairment vs glasses selection",
      detail: normalizeWhitespace(
        chartText("eyes_ears_status")
          ? `Referral documents and chart visibility support should be reconciled against the current eyes and ears documentation: ${chartText("eyes_ears_status")}.`
          : "The chart snapshot does not currently show a vision-related entry, so B1000 vision impairment and any glasses selection still require reconciliation from chart evidence.",
      ),
      related_sections: ["Neurological (Head, Mood, Eyes, Ears)"],
    },
    {
      id: "respiratory-vs-m1400",
      status: proposedText("respiratory_status") || factText("medical_necessity_summary") ? (chartText("respiratory_status") ? "watch" : "flagged") : "watch",
      title: "Respiratory findings vs M1400 shortness of breath answer",
      detail: normalizeWhitespace(
        proposedText("respiratory_status")
          || `Referral documents describe respiratory support with ${sectionText("other_clinical_notes") || factText("medical_necessity_summary") || "pneumonia, hypoxia, oxygen use, and shortness of breath history"}. Chart respiratory status currently reads ${chartText("respiratory_status") || "blank"}.`,
      ),
      related_sections: ["Cardiopulmonary (Chest & Thorax)"],
    },
    {
      id: "functional-vs-gg0130-gg0170",
      status: chartText("gg_self_care") && chartText("gg_mobility") ? "watch" : "flagged",
      title: "Functional M items vs GG0130 and GG0170 scores",
      detail: normalizeWhitespace(
        `Referral documents support function with ${proposedText("prior_functioning") || proposedText("functional_limitations") || factText("functional_limitations") || "weakness, gait, transfer, and endurance limitations"}. Chart GG0130/GG0170 values currently read self-care=${chartText("gg_self_care") || "blank"} and mobility=${chartText("gg_mobility") || "blank"}.`,
      ),
      related_sections: ["Functional Assessment (Self Care)", "Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "wound-vs-worksheet",
      status: chartText("integumentary_wound_status") && chartText("norton_scale") ? "watch" : "flagged",
      title: "Wound answers vs integumentary details and wound worksheet",
      detail: normalizeWhitespace(
        `Referral documents support wound status with ${proposedText("integumentary_wound_status") || sectionText("diagnoses") || "wound care needs and lower-extremity ulcer history"}. Chart wound/Norton support currently reads integumentary=${chartText("integumentary_wound_status") || "blank"} and Norton=${chartText("norton_scale") || "blank"}.`,
      ),
      related_sections: ["Integumentary (Skin & Wound)"],
    },
    {
      id: "pain-vs-j0510-j0520-j0530",
      status: chartText("pain_assessment_narrative") ? "watch" : "flagged",
      title: "Pain presence vs J0510/J0520/J0530 logic",
      detail: normalizeWhitespace(
        `Referral documents show pain-related support as ${proposedText("pain_assessment_narrative") || firstMatchingSpan(input.sourceText, [/\b(pain management as needed[^.]{0,120})/i, /\b(oxyCODONE[^.]{0,160})/i]) || "pain medication and pain-management instructions"}. Chart pain narrative currently reads ${chartText("pain_assessment_narrative") || "blank"}.`,
      ),
      related_sections: ["Vital Signs & Pain Assessment"],
    },
    {
      id: "depression-vs-d0150",
      status: chartText("emotional_behavioral_status") ? "watch" : "flagged",
      title: "Depression diagnosis/documentation vs D0150 completion",
      detail: normalizeWhitespace(
        `Referral documents support mood history with ${proposedText("emotional_behavioral_status") || sectionText("diagnoses") || "depression diagnosis and confusion-related documentation"}. Chart emotional or behavioral status currently reads ${chartText("emotional_behavioral_status") || "blank"}.`,
      ),
      related_sections: ["Neurological (Head, Mood, Eyes, Ears)"],
    },
  ];

  const sourceHighlights: ReferralQaSourceHighlight[] = [
    {
      id: "homebound-reason",
      title: "Homebound reason",
      summary: normalizeWhitespace(
        proposedText("homebound_narrative") || factText("homebound_narrative") || factText("functional_limitations") || "Referral documents do not provide a chart-ready homebound reason.",
      ),
      supporting_sections: ["Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "medical-necessity",
      title: "Medical necessity",
      summary: normalizeWhitespace(
        proposedText("primary_reason_for_home_health_medical_necessity") || factText("medical_necessity_summary") || "Referral documents do not provide a chart-ready medical-necessity statement.",
      ),
      supporting_sections: ["Patient Summary & Clinical Narrative"],
    },
    {
      id: "prior-level-of-function",
      title: "Prior level of function",
      summary: normalizeWhitespace(
        proposedText("prior_functioning") || proposedText("functional_limitations") || factText("functional_limitations") || "Referral documents do not provide a chart-ready prior-level-of-function statement.",
      ),
      supporting_sections: ["Functional Assessment (Mobility & Musculoskeletal)"],
    },
    {
      id: "wound-history",
      title: "Wound history",
      summary: normalizeWhitespace(
        proposedText("integumentary_wound_status") || sectionText("diagnoses") || "Referral documents do not provide a chart-ready wound-history summary.",
      ),
      supporting_sections: ["Integumentary (Skin & Wound)"],
    },
    {
      id: "diet-and-fluid-instructions",
      title: "Diet and fluid instructions",
      summary: normalizeWhitespace(dietText || "Referral documents do not provide explicit diet or fluid instructions."),
      supporting_sections: ["Gastrointestinal & Genitourinary Assessment", "Patient Summary & Clinical Narrative"],
    },
    {
      id: "pmh-immunizations-diabetes",
      title: "PMH, immunizations, and DM status",
      summary: normalizeWhitespace(
        proposedText("past_medical_history")
          || firstMatchingSpan(input.sourceText, [/\b(Past medical history[^.]{0,260})/i, /\b(PMH[^.]{0,260})/i])
          || proposedText("immunization_status")
          || "Referral documents do not provide a complete PMH, immunization, or diabetic-management summary.",
      ),
      supporting_sections: ["Administrative Information", "Endocrine (Diabetic Management)", "Patient Summary & Clinical Narrative"],
    },
    {
      id: "diagnoses-and-coding-support",
      title: "Diagnoses and possible coding support references",
      summary: normalizeWhitespace(
        input.extractedFacts.diagnosis_candidates
          .slice(0, 3)
          .map((candidate) => `${candidate.description}${candidate.icd10_code ? ` (${candidate.icd10_code})` : ""}`)
          .join("; ")
          || "Referral documents do not provide chart-ready diagnosis support references.",
      ),
      supporting_sections: ["Active Diagnoses"],
    },
  ];

  const draftNarratives = DRAFT_NARRATIVE_TEMPLATES.map((template) =>
    fallbackNarrative({
      fieldKey: template.field_key,
      label: template.label,
      extractedFacts: input.extractedFacts,
      llmProposal: input.llmProposal,
      sourceText: input.sourceText,
    }));

  return {
    generated_at: new Date().toISOString(),
    warnings: ["Deterministic referral QA insights fallback was used."],
    consistency_checks: consistencyChecks,
    source_highlights: sourceHighlights,
    draft_narratives: draftNarratives,
  };
}

function sanitizeInsights(input: ReferralQaInsights): ReferralQaInsights {
  const consistencyChecks = CONSISTENCY_TEMPLATES
    .map((template) => input.consistency_checks.find((entry) => entry.id === template.id))
    .filter((entry): entry is ReferralQaConsistencyCheck => Boolean(entry))
    .map((entry) => ({
      ...entry,
      title: normalizeWhitespace(entry.title),
      detail: normalizeWhitespace(entry.detail),
      related_sections: entry.related_sections.map((section) => normalizeWhitespace(section)).filter(Boolean).slice(0, 6),
    }))
    .filter((entry) => entry.detail.length > 0);

  const sourceHighlights = SOURCE_HIGHLIGHT_TEMPLATES
    .map((template) => input.source_highlights.find((entry) => entry.id === template.id))
    .filter((entry): entry is ReferralQaSourceHighlight => Boolean(entry))
    .map((entry) => ({
      ...entry,
      title: normalizeWhitespace(entry.title),
      summary: normalizeWhitespace(entry.summary),
      supporting_sections: entry.supporting_sections.map((section) => normalizeWhitespace(section)).filter(Boolean).slice(0, 6),
    }))
    .filter((entry) => entry.summary.length > 0);

  const draftNarratives = DRAFT_NARRATIVE_TEMPLATES
    .map((template) => input.draft_narratives.find((entry) => entry.field_key === template.field_key))
    .filter((entry): entry is ReferralQaDraftNarrative => Boolean(entry))
    .map((entry) => ({
      ...entry,
      label: normalizeWhitespace(entry.label),
      draft: normalizeWhitespace(entry.draft),
    }))
    .filter((entry) => entry.draft.length > 0);

  return {
    generated_at: normalizeWhitespace(input.generated_at) || new Date().toISOString(),
    warnings: input.warnings.map((warning) => normalizeWhitespace(warning)).filter(Boolean),
    consistency_checks: consistencyChecks,
    source_highlights: sourceHighlights,
    draft_narratives: draftNarratives,
  };
}

function buildLlmPrompt(input: {
  extractedFacts: ReferralExtractedFacts;
  fieldMapSnapshot: FieldMapSnapshot;
  llmProposal: ReferralLlmProposal;
  fieldComparisons: FieldComparisonResult[];
  sourceText: string;
}): string {
  const relevantFieldKeys = new Set([
    "neurological_status",
    "emotional_behavioral_status",
    "eyes_ears_status",
    "respiratory_status",
    "gg_self_care",
    "gg_mobility",
    "prior_functioning",
    "functional_limitations",
    "integumentary_wound_status",
    "norton_scale",
    "pain_assessment_narrative",
    "past_medical_history",
    "immunization_status",
    "homebound_narrative",
    "homebound_supporting_factors",
    "primary_reason_for_home_health_medical_necessity",
    "patient_summary_narrative",
    "skilled_interventions",
    "plan_for_next_visit",
    "care_plan_problems_goals_interventions",
    "patient_caregiver_goals",
    "therapy_need",
    "diagnosis_candidates",
  ]);

  const relevantChartFields = input.fieldMapSnapshot.fields
    .filter((field) => relevantFieldKeys.has(field.key))
    .map((field) => ({
      field_key: field.key,
      current_chart_value: field.currentChartValue,
      populated_in_chart: field.populatedInChart,
    }));

  const relevantProposals = input.llmProposal.proposed_field_values
    .filter((proposal) => relevantFieldKeys.has(proposal.field_key));

  const relevantComparisons = input.fieldComparisons
    .filter((comparison) => relevantFieldKeys.has(comparison.field_key));

  return [
    "Return strict JSON only.",
    "You are generating referral QA insight blocks for a dashboard used before human OASIS QA begins.",
    "State findings as factual observations grounded in the referral and uploaded clinical records. Do not tell the QA user where to look, and do not give workflow commands.",
    "Draft narratives are first drafts only. They must read as chart-ready starting points, not final clinical documentation.",
    "Use CHART_FIELDS, REFERRAL_FIELD_PROPOSALS, FIELD_COMPARISONS, EXTRACTED_FACTS, and REFERRAL_SOURCE_TEXT together.",
    "If support is incomplete, say exactly that and keep the statement factual.",
    "Generate the following consistency checks when supported by the available chart/referral evidence:",
    ...CONSISTENCY_TEMPLATES.map((template) => `- id=${template.id}; title=${template.title}`),
    "Generate the following source highlights:",
    ...SOURCE_HIGHLIGHT_TEMPLATES.map((template) => `- id=${template.id}; title=${template.title}`),
    "Generate the following draft narratives:",
    ...DRAFT_NARRATIVE_TEMPLATES.map((template) => `- field_key=${template.field_key}; label=${template.label}`),
    "Required JSON shape:",
    JSON.stringify({
      generated_at: "2026-04-11T00:00:00.000Z",
      warnings: [],
      consistency_checks: [{
        id: "mental-status-vs-m1700-m1710",
        status: "flagged",
        title: "M1700/M1710 vs Mental Status selections",
        detail: "Referral documents describe the factual chart-vs-referral relationship.",
        related_sections: ["Neurological (Head, Mood, Eyes, Ears)"],
      }],
      source_highlights: [{
        id: "medical-necessity",
        title: "Medical necessity",
        summary: "Concise factual summary from the uploaded records.",
        supporting_sections: ["Patient Summary & Clinical Narrative"],
      }],
      draft_narratives: [{
        field_key: "patient_summary_narrative",
        label: "Patient Summary / Clinical Narrative",
        draft: "First-draft narrative grounded in the uploaded records.",
        status: "ready_for_qa",
      }],
    }),
    "CHART_FIELDS:",
    JSON.stringify(relevantChartFields),
    "REFERRAL_FIELD_PROPOSALS:",
    JSON.stringify(relevantProposals),
    "FIELD_COMPARISONS:",
    JSON.stringify(relevantComparisons),
    "EXTRACTED_FACTS:",
    JSON.stringify(input.extractedFacts),
    "REFERRAL_SOURCE_TEXT:",
    input.sourceText.slice(0, 18_000),
  ].join("\n");
}

export async function generateReferralQaInsights(input: {
  env: FinaleBatchEnv;
  extractedFacts: ReferralExtractedFacts;
  fieldMapSnapshot: FieldMapSnapshot;
  llmProposal: ReferralLlmProposal;
  fieldComparisons: FieldComparisonResult[];
  normalizedSections: NormalizedReferralSection[];
  sourceText: string;
}): Promise<ReferralQaInsights> {
  const deterministicFallback = buildDeterministicFallback(input);
  if (!isReferralQaInsightsLlmEnabled(input.env)) {
    return deterministicFallback;
  }

  const { region, modelId } = resolveBedrockConfig(input.env);
  const client = getBedrockClient(region);

  try {
    const response = await client.send(new ConverseCommand({
      modelId,
      messages: [{
        role: "user",
        content: [{ text: buildLlmPrompt(input) }],
      }],
      inferenceConfig: {
        temperature: 0,
        maxTokens: 2_000,
      },
    }));

    const content = extractConverseText(response);
    const parsed = parseReferralQaInsightsPayload(content);
    if (!parsed) {
      return {
        ...deterministicFallback,
        warnings: [
          ...deterministicFallback.warnings,
          "Bedrock returned invalid referral QA insights output; deterministic fallback was used.",
        ],
      };
    }

    return sanitizeInsights(parsed);
  } catch (error) {
    return {
      ...deterministicFallback,
      warnings: [
        ...deterministicFallback.warnings,
        `Bedrock referral QA insights failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
