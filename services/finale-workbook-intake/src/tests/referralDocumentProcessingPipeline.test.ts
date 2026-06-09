import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { loadEnv } from "../config/env";
import {
  runReferralDocumentProcessingPipeline,
  type ReferralSourceDocumentInput,
} from "../referralProcessing/pipeline";
import {
  ReferralDirectDocumentInvalidJsonError,
  type ReferralDirectDocumentExtractionResult,
} from "../referralProcessing/directDocumentExtractor";
import * as documentExtractionService from "../services/documentExtractionService";

function buildWorkItem(id = "SAMPLE_PATIENT__test") {
  return {
    id,
    subsidiaryId: "default",
    patientIdentity: {
      displayName: "Sample Patient",
      normalizedName: "SAMPLE PATIENT",
      medicareNumber: null,
      mrn: null,
    },
    episodeContext: {
      socDate: "05/09/2026",
      episodeDate: "05/09/2026",
      billingPeriod: "05/09/2026 - 06/07/2026",
      episodePeriod: "05/09/2026 - 07/08/2026",
    },
    codingReviewStatus: "NOT_STARTED",
    oasisQaStatus: "IN_PROGRESS",
    pocQaStatus: "NOT_STARTED",
    visitNotesQaStatus: "NOT_STARTED",
    billingPrepStatus: "NOT_STARTED",
    sourceSheets: ["OASIS Tracking Report"],
    assignedStaff: null,
    payer: null,
    rfa: "SOC",
  } as any;
}

function directResult(input: {
  filePath: string;
  acceptedDiagnoses?: ReferralDirectDocumentExtractionResult["accepted"]["diagnoses"];
  acceptedMedications?: ReferralDirectDocumentExtractionResult["accepted"]["medications"];
  acceptedFieldProposals?: ReferralDirectDocumentExtractionResult["accepted"]["fieldProposals"];
  rejectedDiagnoses?: ReferralDirectDocumentExtractionResult["rejected"]["diagnoses"];
  rejectedMedications?: ReferralDirectDocumentExtractionResult["rejected"]["medications"];
  rejectedFieldProposals?: ReferralDirectDocumentExtractionResult["rejected"]["fieldProposals"];
  warnings?: string[];
}): ReferralDirectDocumentExtractionResult {
  const acceptedDiagnoses = input.acceptedDiagnoses ?? [{
    description: "Encounter for other orthopedic aftercare",
    icd10_code: "Z47.89",
    is_primary_candidate: true,
    confidence: 0.94,
    source_quote: "Encounter for other orthopedic aftercare (Z47.89) located on the right shoulder.",
    page: 1,
    laterality_terms: ["right"],
    body_site_terms: ["shoulder"],
    requires_human_review: true,
    review_reasons: ["coding_sensitive"],
  }];
  const acceptedMedications = input.acceptedMedications ?? [{
    name: "oxycodone",
    dose: "5 mg",
    route: "oral",
    frequency: "every 4 hours as needed",
    start_date: "04/28/2026",
    confidence: 0.88,
    source_quote: "oxycodone 5 mg Oral - tablet start date 04/28/2026 every 4 hours as needed",
    page: 1,
    requires_human_review: true,
    review_reasons: [],
  }];
  const rejectedDiagnoses = input.rejectedDiagnoses ?? [];
  const rejectedMedications = input.rejectedMedications ?? [];
  const acceptedFieldProposals = input.acceptedFieldProposals ?? [{
    field_key: "living_situation",
    proposed_value: "Lives with caregiver support",
    confidence: 0.84,
    source_quote: "Patient lives with caregiver support and requires assistance for safety.",
    page: 1,
    requires_human_review: true,
    review_reasons: [],
  }];
  const rejectedFieldProposals = input.rejectedFieldProposals ?? [];
  const warnings = input.warnings ?? [];

  return {
    schemaVersion: "referral-direct-document-extraction.v3",
    generatedAt: "2026-06-02T00:00:00.000Z",
    patientName: "Sample Patient",
    sourceDocument: {
      filePath: input.filePath,
      fileName: path.basename(input.filePath),
      fileType: "pdf",
      fileSizeBytes: 1200,
      sha256: "0".repeat(64),
      sourceLabel: "Sample Patient Referral",
    },
    invocation: {
      provider: "bedrock",
      configuredModelId: "test-model",
      invocationModelId: "test-model",
      region: "us-west-2",
      autoResolvedInferenceProfile: false,
      citationMode: "disabled_unsupported_retry",
      latencyMs: 25,
      inputTokenCount: 100,
      outputTokenCount: 50,
      totalTokenCount: 150,
    },
    payload: {
      patient_context: {
        patient_name: "Sample Patient",
        dob: null,
        soc_date: null,
        referral_date: null,
      },
      diagnoses: [...acceptedDiagnoses, ...rejectedDiagnoses],
      medications: [...acceptedMedications, ...rejectedMedications],
      field_proposals: [...acceptedFieldProposals, ...rejectedFieldProposals],
      unsupported_or_missing_fields: [],
      warnings,
    },
    accepted: {
      diagnoses: acceptedDiagnoses,
      medications: acceptedMedications,
      fieldProposals: acceptedFieldProposals,
    },
    rejected: {
      diagnoses: rejectedDiagnoses,
      medications: rejectedMedications,
      fieldProposals: rejectedFieldProposals,
    },
    citations: [],
    rawResponseText: "{}",
    warnings,
  };
}

async function createReferralSource(tempDir: string): Promise<{
  pdfPath: string;
  sourceDocuments: ReferralSourceDocumentInput[];
}> {
  const pdfPath = path.join(tempDir, "sample-patient-referral.pdf");
  await writeFile(pdfPath, "%PDF-1.4\nsource bytes for direct document test", "latin1");
  return {
    pdfPath,
    sourceDocuments: [{
      sourceLabel: "Sample Patient Referral",
      sourcePath: pdfPath,
      portalLabel: "Sample Patient Referral",
      acquisitionMethod: "download",
    }],
  };
}

describe("runReferralDocumentProcessingPipeline", () => {
  it("uses direct-document LLM output for referral diagnosis and medication start dates without OCR", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-direct-pipeline-"));
    const ocrSpy = vi.spyOn(documentExtractionService, "extractTextFromLocalFile");

    try {
      const { pdfPath, sourceDocuments } = await createReferralSource(tempDir);
      const result = await runReferralDocumentProcessingPipeline({
        workItem: buildWorkItem(),
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          REFERRAL_EXTRACTION_MODE: "direct_document_llm_only",
        }),
        logger: pino({ level: "silent" }),
        sourceDocuments,
        directDocumentExtractor: async () => directResult({ filePath: pdfPath }),
      });

      expect(ocrSpy).not.toHaveBeenCalled();
      expect(result.result).not.toBeNull();
      expect(result.result?.extractionResult.extractionMethod).toBe("direct_document_llm");
      expect(result.result?.extractionResult.ocrUsed).toBe(false);
      expect(result.result?.llmProposal.diagnosis_candidates[0]).toMatchObject({
        icd10_code: "Z47.89",
        description: "Encounter for other orthopedic aftercare",
      });
      expect(result.result?.llmProposal.diagnosis_candidates[0]?.source_spans[0]).toContain("right shoulder");

      const medicationList = result.result?.llmProposal.proposed_field_values
        .find((proposal) => proposal.field_key === "medication_list")?.proposed_value as Array<Record<string, unknown>>;
      expect(medicationList[0]).toMatchObject({
        name: "oxycodone",
        start_date: "04/28/2026",
      });

      const persistedDirectDocument = JSON.parse(
        await readFile(result.result!.artifacts.directDocumentResultPath!, "utf8"),
      ) as ReferralDirectDocumentExtractionResult;
      expect(persistedDirectDocument.accepted.medications[0]?.source_quote).toContain("start date 04/28/2026");
      expect(result.stepLogs.some((log) => log.step === "direct_document_referral_extraction_completed")).toBe(true);
    } finally {
      ocrSpy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("turns direct-document extractor failure into review artifacts instead of OCR fallback", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-direct-failure-"));
    const ocrSpy = vi.spyOn(documentExtractionService, "extractTextFromLocalFile");

    try {
      const { sourceDocuments } = await createReferralSource(tempDir);
      const result = await runReferralDocumentProcessingPipeline({
        workItem: buildWorkItem("SAMPLE_PATIENT__failure"),
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          REFERRAL_EXTRACTION_MODE: "direct_document_llm_only",
        }),
        logger: pino({ level: "silent" }),
        sourceDocuments,
        directDocumentExtractor: async () => {
          throw new ReferralDirectDocumentInvalidJsonError({
            schemaVersion: "referral-direct-document-failure-diagnostic.v1",
            generatedAt: "2026-05-01T00:00:00.000Z",
            failureReason: "Bedrock returned invalid JSON",
            configuredModelId: "test-model",
            invocationModelId: "test-model",
            region: "us-east-2",
            retryMode: "compact_json",
            citationMode: "disabled_invalid_json_retry",
            rawResponseExcerpt: "invalid response",
          });
        },
      });

      expect(ocrSpy).not.toHaveBeenCalled();
      expect(result.result?.extractionResult.extractionMethod).toBe("failed");
      expect(result.result?.extractionResult.ocrUsed).toBe(false);
      expect(result.result?.qaDocumentSummary.extractionUsabilityStatus).toBe("rejected");
      expect(result.result?.qaDocumentSummary.warnings.join(" ")).toContain("Bedrock returned invalid JSON");
      expect(result.result?.llmProposal.diagnosis_candidates).toHaveLength(0);
      expect(result.result?.artifacts.directDocumentFailureDiagnosticPath).toBeTruthy();
      const diagnostic = JSON.parse(
        await readFile(result.result!.artifacts.directDocumentFailureDiagnosticPath!, "utf8"),
      ) as Record<string, unknown>;
      expect(diagnostic.retryMode).toBe("compact_json");
    } finally {
      ocrSpy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not promote uncited direct-document facts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-direct-uncited-"));

    try {
      const { pdfPath, sourceDocuments } = await createReferralSource(tempDir);
      const result = await runReferralDocumentProcessingPipeline({
        workItem: buildWorkItem("SAMPLE_PATIENT__uncited"),
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          REFERRAL_EXTRACTION_MODE: "direct_document_llm_only",
        }),
        logger: pino({ level: "silent" }),
        sourceDocuments,
        directDocumentExtractor: async () => directResult({
          filePath: pdfPath,
          acceptedDiagnoses: [],
          acceptedMedications: [],
          acceptedFieldProposals: [],
          rejectedDiagnoses: [{
            description: "History of arthroplasty of left knee",
            icd10_code: "Z47.89",
            is_primary_candidate: true,
            confidence: 0.3,
            source_quote: null,
            page: null,
            laterality_terms: ["left"],
            body_site_terms: ["knee"],
            requires_human_review: true,
            review_reasons: ["missing_source_quote", "laterality_conflict"],
          }],
          rejectedMedications: [],
          warnings: ["Rejected uncited diagnosis candidate."],
        }),
      });

      expect(result.result?.extractionResult.extractionSuccess).toBe(false);
      expect(result.result?.llmProposal.diagnosis_candidates).toHaveLength(0);
      expect(result.result?.extractedFacts.warnings.join(" ")).toContain("uncited diagnosis");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not reuse rejected direct-document artifacts as a cache hit", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-direct-rejected-reuse-"));

    try {
      const { pdfPath, sourceDocuments } = await createReferralSource(tempDir);
      const firstExtractor = vi.fn(async () => directResult({
        filePath: pdfPath,
        acceptedDiagnoses: [],
        acceptedMedications: [],
        acceptedFieldProposals: [],
        rejectedDiagnoses: [{
          description: "History of arthroplasty of left knee",
          icd10_code: "Z47.89",
          is_primary_candidate: true,
          confidence: 0.3,
          source_quote: null,
          page: 1,
          laterality_terms: ["left"],
          body_site_terms: ["knee"],
          requires_human_review: true,
          review_reasons: ["missing_source_quote"],
        }],
      }));

      const first = await runReferralDocumentProcessingPipeline({
        workItem: buildWorkItem("SAMPLE_PATIENT__rejected_reuse"),
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          REFERRAL_EXTRACTION_MODE: "direct_document_llm_only",
        }),
        logger: pino({ level: "silent" }),
        sourceDocuments,
        directDocumentExtractor: firstExtractor,
      });
      expect(first.result?.extractionResult.extractionSuccess).toBe(false);

      const secondExtractor = vi.fn(async () => directResult({ filePath: pdfPath }));
      const second = await runReferralDocumentProcessingPipeline({
        workItem: buildWorkItem("SAMPLE_PATIENT__rejected_reuse"),
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          REFERRAL_EXTRACTION_MODE: "direct_document_llm_only",
        }),
        logger: pino({ level: "silent" }),
        sourceDocuments,
        directDocumentExtractor: secondExtractor,
      });

      expect(firstExtractor).toHaveBeenCalledTimes(1);
      expect(secondExtractor).toHaveBeenCalledTimes(1);
      expect(second.stepLogs.some((log) => log.step === "referral_processing_reused")).toBe(false);
      expect(second.result?.extractionResult.extractionSuccess).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses unchanged direct-document referral artifacts without another direct LLM call", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-direct-reuse-"));

    try {
      await mkdir(path.join(tempDir, "patients"), { recursive: true });
      const { pdfPath, sourceDocuments } = await createReferralSource(tempDir);
      const extractor = vi.fn(async () => directResult({ filePath: pdfPath }));
      const baseParams = {
        workItem: buildWorkItem("SAMPLE_PATIENT__reuse"),
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
          REFERRAL_EXTRACTION_MODE: "direct_document_llm_only",
          BEDROCK_MODEL_ID: "test-model",
        }),
        logger: pino({ level: "silent" }),
        sourceDocuments,
        directDocumentExtractor: extractor,
      };

      const first = await runReferralDocumentProcessingPipeline(baseParams);
      const second = await runReferralDocumentProcessingPipeline(baseParams);

      expect(first.result).not.toBeNull();
      expect(second.result).not.toBeNull();
      expect(extractor).toHaveBeenCalledTimes(1);
      expect(second.stepLogs.some((log) => log.step === "referral_processing_reused")).toBe(true);

      const reuseMetadata = JSON.parse(
        await readFile(
          path.join(tempDir, "patients", "SAMPLE_PATIENT__reuse", "referral-document-processing", "referral-reuse-metadata.json"),
          "utf8",
        ),
      ) as { reusedFromPreviousRun: boolean; processingInputFingerprint: string };

      expect(reuseMetadata.reusedFromPreviousRun).toBe(true);
      expect(reuseMetadata.processingInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
