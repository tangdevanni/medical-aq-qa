import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  BedrockRuntimeClient,
  type ContentBlock,
  type ConverseCommandOutput,
  type DocumentFormat,
  type ImageFormat,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { FinaleBatchEnv } from "../config/env";
import {
  resolveBedrockConfig,
  sendBedrockConverseWithProfileFallback,
} from "../config/bedrock";
import { REFERRAL_FIELD_CONTRACT } from "./fieldContract";

export const REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION = "referral-direct-document-extraction.v3";

const SYSTEM_PROMPT = [
  "You extract referral/admission-order facts from the original clinical document.",
  "Return only valid JSON. Do not include Markdown.",
  "Never infer facts that are not visibly supported by the document.",
  "Every promoted fact must include an exact source_quote copied from the document.",
  "If a field is not visibly present, use null and add a review reason.",
].join(" ");

const FIELD_KEY_GUIDE = REFERRAL_FIELD_CONTRACT
  .filter((field) => !field.reference_only || field.llm_fill_candidate)
  .map((field) => `- ${field.key}: ${field.label}`)
  .join("\n");

const USER_PROMPT = [
  "Read the attached referral/admission-order document directly.",
  "Extract diagnoses, medications, allergies, dates, living situation, caregiver/emergency support, safety/risk, functional/therapy, body-system review, Plan of Care, and goals only when the document supports them.",
  "For diagnoses, preserve exact ICD code, exact diagnosis wording, laterality terms, and body-site terms.",
  "For medications, preserve name, dose, route, frequency, and start_date when present.",
  "For allergies, preserve allergen/name, reaction, and start_date only when the allergy row or allergy statement itself says that date is allergy-specific.",
  "Do not use reviewed/printed dates as medication or allergy start dates unless the medication/allergy row itself says that is the start date.",
  "For field_proposals, use OASIS QA field keys when possible, normalize the proposed_value for that field, and copy the shortest exact source_quote that proves it.",
  "Allowed field_proposals field_key values:",
  FIELD_KEY_GUIDE,
  "Return this JSON shape exactly:",
  "{",
  '  "patient_context": { "patient_name": string|null, "dob": string|null, "soc_date": string|null, "referral_date": string|null },',
  '  "diagnoses": [{ "description": string, "icd10_code": string|null, "is_primary_candidate": boolean, "confidence": number, "source_quote": string|null, "page": number|null, "laterality_terms": string[], "body_site_terms": string[], "requires_human_review": boolean, "review_reasons": string[] }],',
  '  "medications": [{ "name": string, "dose": string|null, "route": string|null, "frequency": string|null, "start_date": string|null, "confidence": number, "source_quote": string|null, "page": number|null, "requires_human_review": boolean, "review_reasons": string[] }],',
  '  "field_proposals": [{ "field_key": string, "proposed_value": string|number|boolean|object|array|null, "confidence": number, "source_quote": string|null, "page": number|null, "requires_human_review": boolean, "review_reasons": string[] }],',
  '  "unsupported_or_missing_fields": string[],',
  '  "warnings": string[]',
  "}",
].join("\n");

const INVALID_JSON_RETRY_PREFIX = [
  "Return only one valid JSON object for the schema below.",
  "Do not include Markdown, analysis, citations, XML, or prose outside the JSON object.",
  "Use empty arrays when facts are not visibly supported.",
].join("\n");

const COMPACT_JSON_RETRY_PROMPT = [
  "Read the attached referral/admission-order document directly.",
  "Return exactly one valid JSON object. No Markdown. No prose. No citations outside JSON.",
  "Use this compact schema:",
  '{"patient_context":{"patient_name":null,"dob":null,"soc_date":null,"referral_date":null},"diagnoses":[],"medications":[],"field_proposals":[],"unsupported_or_missing_fields":[],"warnings":[]}',
  "diagnoses items: description, icd10_code, is_primary_candidate, confidence, source_quote, page, laterality_terms, body_site_terms, requires_human_review, review_reasons.",
  "medications items: name, dose, route, frequency, start_date, confidence, source_quote, page, requires_human_review, review_reasons.",
  "field_proposals items: field_key, proposed_value, confidence, source_quote, page, requires_human_review, review_reasons.",
  "Only include facts visibly supported by the document. Every included diagnosis, medication, and field proposal must include an exact source_quote.",
  "Use empty arrays when facts are not visibly supported.",
].join("\n");

const directPatientContextSchema = z.object({
  patient_name: z.string().nullable().optional().default(null),
  dob: z.string().nullable().optional().default(null),
  soc_date: z.string().nullable().optional().default(null),
  referral_date: z.string().nullable().optional().default(null),
}).passthrough();

const directDiagnosisSchema = z.object({
  description: z.string().min(1),
  icd10_code: z.string().min(1).nullable().optional().default(null),
  is_primary_candidate: z.boolean().optional().default(false),
  confidence: z.coerce.number().min(0).max(1).catch(0.5).optional().default(0.5),
  source_quote: z.string().nullable().optional().default(null),
  page: z.coerce.number().int().positive().nullable().catch(null).optional().default(null),
  laterality_terms: z.array(z.string()).optional().default([]),
  body_site_terms: z.array(z.string()).optional().default([]),
  requires_human_review: z.boolean().optional().default(true),
  review_reasons: z.array(z.string()).optional().default([]),
}).passthrough();

const directMedicationSchema = z.object({
  name: z.string().min(1),
  dose: z.string().nullable().optional().default(null),
  route: z.string().nullable().optional().default(null),
  frequency: z.string().nullable().optional().default(null),
  start_date: z.string().nullable().optional().default(null),
  confidence: z.coerce.number().min(0).max(1).catch(0.5).optional().default(0.5),
  source_quote: z.string().nullable().optional().default(null),
  page: z.coerce.number().int().positive().nullable().catch(null).optional().default(null),
  requires_human_review: z.boolean().optional().default(true),
  review_reasons: z.array(z.string()).optional().default([]),
}).passthrough();

const directFieldProposalSchema = z.object({
  field_key: z.string().min(1),
  proposed_value: z.unknown().nullable(),
  confidence: z.coerce.number().min(0).max(1).catch(0.5).optional().default(0.5),
  source_quote: z.string().nullable().optional().default(null),
  page: z.coerce.number().int().positive().nullable().catch(null).optional().default(null),
  requires_human_review: z.boolean().optional().default(true),
  review_reasons: z.array(z.string()).optional().default([]),
}).passthrough();

const directDocumentPayloadSchema = z.object({
  patient_context: directPatientContextSchema.optional().default({}).catch({
    patient_name: null,
    dob: null,
    soc_date: null,
    referral_date: null,
  }),
  diagnoses: z.array(directDiagnosisSchema).optional().default([]).catch([]),
  medications: z.array(directMedicationSchema).optional().default([]).catch([]),
  field_proposals: z.array(directFieldProposalSchema).default([]).catch([]),
  unsupported_or_missing_fields: z.array(z.string()).optional().default([]).catch([]),
  warnings: z.array(z.string()).optional().default([]).catch([]),
}).passthrough();

export type ReferralDirectDocumentPayload = z.infer<typeof directDocumentPayloadSchema>;
export type ReferralDirectDocumentDiagnosis = z.infer<typeof directDiagnosisSchema>;
export type ReferralDirectDocumentMedication = z.infer<typeof directMedicationSchema>;
export type ReferralDirectDocumentFieldProposal = z.infer<typeof directFieldProposalSchema>;

export interface ReferralDirectDocumentExtractionResult {
  schemaVersion: typeof REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION;
  generatedAt: string;
  patientName: string | null;
  sourceDocument: {
    filePath: string;
    fileName: string;
    fileType: "pdf" | "jpg" | "jpeg" | "png";
    fileSizeBytes: number;
    sha256: string;
    sourceLabel: string | null;
  };
  invocation: {
    provider: "bedrock";
    configuredModelId: string;
    invocationModelId: string;
    region: string;
    autoResolvedInferenceProfile: boolean;
    citationMode: "enabled" | "disabled_unsupported_retry" | "disabled_invalid_json_retry" | "not_applicable";
    latencyMs: number;
    inputTokenCount: number | null;
    outputTokenCount: number | null;
    totalTokenCount: number | null;
  };
  payload: ReferralDirectDocumentPayload;
  accepted: {
    diagnoses: ReferralDirectDocumentDiagnosis[];
    medications: ReferralDirectDocumentMedication[];
    fieldProposals: ReferralDirectDocumentFieldProposal[];
  };
  rejected: {
    diagnoses: ReferralDirectDocumentDiagnosis[];
    medications: ReferralDirectDocumentMedication[];
    fieldProposals: ReferralDirectDocumentFieldProposal[];
  };
  citations: unknown[];
  rawResponseText: string;
  warnings: string[];
}

export type ReferralDirectDocumentRetryMode =
  | "initial"
  | "citation_disabled_unsupported"
  | "citation_disabled_invalid_json"
  | "compact_json";

export interface ReferralDirectDocumentFailureDiagnostic {
  schemaVersion: "referral-direct-document-failure-diagnostic.v1";
  generatedAt: string;
  failureReason: string;
  configuredModelId: string;
  invocationModelId: string | null;
  region: string;
  retryMode: ReferralDirectDocumentRetryMode;
  citationMode: ReferralDirectDocumentExtractionResult["invocation"]["citationMode"];
  rawResponseExcerpt: string | null;
}

export class ReferralDirectDocumentInvalidJsonError extends Error {
  readonly diagnostic: ReferralDirectDocumentFailureDiagnostic;

  constructor(diagnostic: ReferralDirectDocumentFailureDiagnostic) {
    super(diagnostic.failureReason);
    this.name = "ReferralDirectDocumentInvalidJsonError";
    this.diagnostic = diagnostic;
  }
}

const bedrockClientByRegion = new Map<string, BedrockRuntimeClient>();

function getBedrockClient(region: string): BedrockRuntimeClient {
  const existing = bedrockClientByRegion.get(region);
  if (existing) {
    return existing;
  }
  const client = new BedrockRuntimeClient({ region });
  bedrockClientByRegion.set(region, client);
  return client;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function parseJsonCandidate(candidate: string): ReferralDirectDocumentPayload | null {
  try {
    return directDocumentPayloadSchema.parse(JSON.parse(candidate));
  } catch {
    return null;
  }
}

export function parseReferralDirectDocumentPayload(text: string): ReferralDirectDocumentPayload | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const direct = parseJsonCandidate(normalized);
  if (direct) {
    return direct;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  return parseJsonCandidate(normalized.slice(firstBrace, lastBrace + 1));
}

function fileTypeForPath(filePath: string): "pdf" | "jpg" | "jpeg" | "png" | null {
  const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (extension === "pdf" || extension === "jpg" || extension === "jpeg" || extension === "png") {
    return extension;
  }
  return null;
}

function buildDocumentName(patientName: string | null | undefined): string {
  const normalized = normalizeWhitespace(patientName).replace(/[^A-Za-z0-9 ()[\]-]/g, " ");
  const suffix = normalizeWhitespace(normalized).slice(0, 40);
  return suffix ? `Referral Document ${suffix}` : "Referral Document";
}

function buildSourceContentBlock(input: {
  fileType: "pdf" | "jpg" | "jpeg" | "png";
  documentName: string;
  bytes: Uint8Array;
  enableCitations: boolean;
}): ContentBlock {
  if (input.fileType === "pdf") {
    return {
      document: {
        format: "pdf" as DocumentFormat,
        name: input.documentName,
        source: {
          bytes: input.bytes,
        },
        ...(input.enableCitations
          ? {
              citations: {
                enabled: true,
              },
            }
          : {}),
      },
    };
  }

  return {
    image: {
      format: (input.fileType === "jpg" ? "jpeg" : input.fileType) as ImageFormat,
      source: {
        bytes: input.bytes,
      },
    },
  };
}

function isUnsupportedCitationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /doesn.t support citations|citations?.*not supported|unsupported.*citations?/i.test(message);
}

function extractGeneratedTextFromCitationsContent(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }
  const texts: string[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const text = (entry as { text?: unknown }).text;
    if (typeof text === "string" && normalizeWhitespace(text)) {
      texts.push(text);
    }
  }
  return texts;
}

function extractConverseTextAndCitations(response: ConverseCommandOutput): {
  text: string;
  citations: unknown[];
} {
  const blocks = response.output?.message?.content ?? [];
  const texts: string[] = [];
  const citations: unknown[] = [];

  for (const block of blocks) {
    if ("text" in block && typeof block.text === "string") {
      texts.push(block.text);
      continue;
    }
    if ("citationsContent" in block && block.citationsContent) {
      texts.push(...extractGeneratedTextFromCitationsContent(block.citationsContent));
      const blockCitations = (block.citationsContent as { citations?: unknown }).citations;
      if (Array.isArray(blockCitations)) {
        citations.push(...blockCitations);
      }
    }
  }

  return {
    text: normalizeWhitespace(texts.join("\n")),
    citations,
  };
}

function hasUsableSourceQuote(value: { source_quote: string | null; confidence: number }): boolean {
  return normalizeWhitespace(value.source_quote).length >= 8 && value.confidence > 0;
}

function withSourceQuoteReview<T extends { source_quote: string | null; requires_human_review: boolean; review_reasons: string[] }>(
  value: T,
): T {
  if (normalizeWhitespace(value.source_quote).length >= 8) {
    return value;
  }
  return {
    ...value,
    requires_human_review: true,
    review_reasons: Array.from(new Set([
      ...value.review_reasons,
      "missing_source_quote",
    ])),
  };
}

export async function extractReferralDirectDocument(input: {
  env: FinaleBatchEnv;
  filePath: string;
  patientName?: string | null;
  sourceLabel?: string | null;
}): Promise<ReferralDirectDocumentExtractionResult> {
  if (!input.env.CODE_LLM_ENABLED || input.env.LLM_PROVIDER !== "bedrock") {
    throw new Error("Direct-document referral comparison requires CODE_LLM_ENABLED=true and LLM_PROVIDER=bedrock.");
  }

  const fileType = fileTypeForPath(input.filePath);
  if (!fileType) {
    throw new Error(`Unsupported direct-document referral file type: ${input.filePath}`);
  }

  const bytes = await readFile(input.filePath);
  const fileStats = await stat(input.filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const config = resolveBedrockConfig(input.env);
  const client = getBedrockClient(config.region);
  const startedAt = Date.now();
  const sendRequest = (
    enableCitations: boolean,
    promptMode: "standard" | "invalid_json" | "compact_json" = "standard",
  ) =>
    sendBedrockConverseWithProfileFallback({
      client,
      config,
      command: {
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{
          role: "user",
          content: [
            {
              text: promptMode === "compact_json"
                ? COMPACT_JSON_RETRY_PROMPT
                : promptMode === "invalid_json"
                  ? `${INVALID_JSON_RETRY_PREFIX}\n\n${USER_PROMPT}`
                  : USER_PROMPT,
            },
            buildSourceContentBlock({
              fileType,
              documentName: buildDocumentName(input.patientName),
              bytes,
              enableCitations,
            }),
          ],
        }],
        inferenceConfig: {
          maxTokens: 6_000,
          temperature: 0,
        },
      },
    });

  let citationMode: ReferralDirectDocumentExtractionResult["invocation"]["citationMode"] =
    fileType === "pdf" ? "enabled" : "not_applicable";
  let response: ConverseCommandOutput;
  let invocationModelId: string;
  let autoResolvedInferenceProfile: boolean;
  let retryMode: ReferralDirectDocumentRetryMode = "initial";
  try {
    const result = await sendRequest(fileType === "pdf");
    response = result.response;
    invocationModelId = result.invocationModelId;
    autoResolvedInferenceProfile = result.autoResolvedInferenceProfile;
  } catch (error) {
    if (fileType !== "pdf" || !isUnsupportedCitationError(error)) {
      throw error;
    }
    citationMode = "disabled_unsupported_retry";
    retryMode = "citation_disabled_unsupported";
    const result = await sendRequest(false);
    response = result.response;
    invocationModelId = result.invocationModelId;
    autoResolvedInferenceProfile = result.autoResolvedInferenceProfile;
  }
  let { text, citations } = extractConverseTextAndCitations(response);
  let parsed = parseReferralDirectDocumentPayload(text);
  if (!parsed && fileType === "pdf" && citationMode === "enabled") {
    citationMode = "disabled_invalid_json_retry";
    retryMode = "citation_disabled_invalid_json";
    const retryResult = await sendRequest(false, "invalid_json");
    response = retryResult.response;
    invocationModelId = retryResult.invocationModelId;
    autoResolvedInferenceProfile = retryResult.autoResolvedInferenceProfile;
    ({ text, citations } = extractConverseTextAndCitations(response));
    parsed = parseReferralDirectDocumentPayload(text);
  }
  if (!parsed) {
    retryMode = "compact_json";
    const retryResult = await sendRequest(false, "compact_json");
    response = retryResult.response;
    invocationModelId = retryResult.invocationModelId;
    autoResolvedInferenceProfile = retryResult.autoResolvedInferenceProfile;
    ({ text, citations } = extractConverseTextAndCitations(response));
    parsed = parseReferralDirectDocumentPayload(text);
  }
  if (!parsed) {
    throw new ReferralDirectDocumentInvalidJsonError({
      schemaVersion: "referral-direct-document-failure-diagnostic.v1",
      generatedAt: new Date().toISOString(),
      failureReason: "Bedrock returned invalid or non-JSON direct-document referral output.",
      configuredModelId: config.configuredModelId,
      invocationModelId,
      region: config.region,
      retryMode,
      citationMode,
      rawResponseExcerpt: normalizeWhitespace(text).slice(0, 2_000) || null,
    });
  }
  const latencyMs = Date.now() - startedAt;

  const diagnoses = parsed.diagnoses.map(withSourceQuoteReview);
  const medications = parsed.medications.map(withSourceQuoteReview);
  const fieldProposals = parsed.field_proposals.map(withSourceQuoteReview);
  const acceptedDiagnoses = diagnoses.filter(hasUsableSourceQuote);
  const acceptedMedications = medications.filter(hasUsableSourceQuote);
  const acceptedFieldProposals = fieldProposals.filter(hasUsableSourceQuote);
  const warnings = [
    ...parsed.warnings,
    ...(acceptedDiagnoses.length < diagnoses.length
      ? [`Rejected ${diagnoses.length - acceptedDiagnoses.length} diagnosis candidate(s) without source quotes.`]
      : []),
    ...(acceptedMedications.length < medications.length
      ? [`Rejected ${medications.length - acceptedMedications.length} medication candidate(s) without source quotes.`]
      : []),
    ...(acceptedFieldProposals.length < fieldProposals.length
      ? [`Rejected ${fieldProposals.length - acceptedFieldProposals.length} field proposal(s) without source quotes.`]
      : []),
    ...(fileType === "pdf" && citations.length === 0
      ? ["Bedrock did not return document citation metadata; source_quote requirements were still enforced."]
      : []),
    ...(citationMode === "disabled_unsupported_retry"
      ? ["Configured Bedrock model rejected citation metadata, so the request was retried without citations."]
      : []),
    ...(citationMode === "disabled_invalid_json_retry"
      ? ["Configured Bedrock model returned invalid JSON with citation metadata, so the request was retried without citations."]
      : []),
    ...(retryMode === "compact_json"
      ? ["Configured Bedrock model required compact JSON retry before returning parseable direct-document referral output."]
      : []),
  ];

  return {
    schemaVersion: REFERRAL_DIRECT_DOCUMENT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    patientName: normalizeWhitespace(input.patientName) || null,
    sourceDocument: {
      filePath: input.filePath,
      fileName: path.basename(input.filePath),
      fileType,
      fileSizeBytes: fileStats.size,
      sha256,
      sourceLabel: normalizeWhitespace(input.sourceLabel) || null,
    },
    invocation: {
      provider: "bedrock",
      configuredModelId: config.configuredModelId,
      invocationModelId,
      region: config.region,
      autoResolvedInferenceProfile,
      citationMode,
      latencyMs,
      inputTokenCount: response.usage?.inputTokens ?? null,
      outputTokenCount: response.usage?.outputTokens ?? null,
      totalTokenCount: response.usage?.totalTokens ?? null,
    },
    payload: {
      ...parsed,
      diagnoses,
      medications,
      field_proposals: fieldProposals,
      warnings,
    },
    accepted: {
      diagnoses: acceptedDiagnoses,
      medications: acceptedMedications,
      fieldProposals: acceptedFieldProposals,
    },
    rejected: {
      diagnoses: diagnoses.filter((diagnosis) => !hasUsableSourceQuote(diagnosis)),
      medications: medications.filter((medication) => !hasUsableSourceQuote(medication)),
      fieldProposals: fieldProposals.filter((proposal) => !hasUsableSourceQuote(proposal)),
    },
    citations,
    rawResponseText: text,
    warnings,
  };
}
