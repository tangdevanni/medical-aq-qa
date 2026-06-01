import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { loadEnv } from "../config/env";
import { runReferralDocumentProcessingPipeline } from "../referralProcessing/pipeline";
import type { ExtractedDocument } from "../services/documentExtractionService";

describe("runReferralDocumentProcessingPipeline", () => {
  it("processes an acquired referral PDF into QA artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-pipeline-"));

    try {
      const pdfPath = path.join(tempDir, "christine-young-referral.pdf");
      const pdfText = [
        "Patient Name: Christine Young",
        "DOB: 05/30/1944",
        "Order Date: 02/20/2026",
        "Primary Reason for Home Health / Medical Necessity",
        "Patient requires skilled nursing for medication management and PT/OT for mobility.",
        "Homebound Status",
        "Uses walker and leaving home is exhausting.",
        "Primary Caregiver: Emily Young",
        "Relationship: Daughter",
        "Preferred Language: English",
        "Interpreter Needed: No",
        "M1005 - Discharge Date: 02/20/2026",
        "Diagnosis Information",
        "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
      ].join(" ");

      await writeFile(pdfPath, `%PDF-1.4 BT (${pdfText}) Tj ET`, "latin1");

      const extractedDocuments: ExtractedDocument[] = [{
        type: "ORDER",
        text: pdfText,
        metadata: {
          source: "download",
          sourcePath: pdfPath,
          portalLabel: "Christine Young Referral",
          effectiveTextSource: "digital_pdf_text",
          textLength: pdfText.length,
        },
      }];

      const result = await runReferralDocumentProcessingPipeline({
        workItem: {
          id: "CHRISTINE_YOUNG__test",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Christine Young",
            normalizedName: "CHRISTINE YOUNG",
            medicareNumber: "8A75MN2VE79",
            mrn: null,
          },
          episodeContext: {
            socDate: "02/27/2026",
            episodeDate: "02/27/2026",
            billingPeriod: "02/27/2026 - 03/31/2026",
            episodePeriod: "02/27/2026 - 04/27/2026",
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
        } as any,
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
        }),
        logger: pino({ level: "silent" }),
        extractedDocuments,
        currentChartValues: {
          preferred_language: "English",
        },
      });

      expect(result.result).not.toBeNull();
      expect(result.stepLogs.some((log) => log.step === "source_document_identified")).toBe(true);
      expect(result.stepLogs.some((log) => log.step === "qa_document_summary_persisted")).toBe(true);
      expect(result.result?.extractionResult.extractionSuccess).toBe(true);
      expect(result.result?.normalizedSections.some((section) => section.sectionName === "medical_necessity")).toBe(true);
      expect(result.result?.fieldMapSnapshot.candidate_fields_for_llm_inference_from_referral).toContain("homebound_narrative");
      expect(result.result?.fieldComparisons.length).toBeGreaterThan(0);
      expect(result.result?.patientQaReference.fieldGroups).toHaveLength(9);
      expect(result.result?.patientQaReference.referralDashboardSections.some((section) =>
        section.sectionKey === "plan_of_care_and_physical_therapy_evaluation")).toBe(true);
      expect(result.result?.patientQaReference.comparisonResults.primary_reason_for_home_health_medical_necessity.workflowState)
        .toBe("needs_qa_readback");
      expect(result.result?.patientQaReference.qaReviewQueue.length).toBeGreaterThan(0);

      const persistedSummary = JSON.parse(
        await readFile(result.result!.artifacts.qaDocumentSummaryPath, "utf8"),
      ) as { normalizedSectionCount: number; llmProposalCount: number };
      const persistedFacts = JSON.parse(
        await readFile(result.result!.artifacts.extractedFactsPath, "utf8"),
      ) as { facts: Array<{ fact_key: string }>; patient_context: { referral_date: string | null } };
      const persistedQaReference = JSON.parse(
        await readFile(result.result!.artifacts.patientQaReferencePath, "utf8"),
      ) as { fieldGroups: unknown[]; qaReviewQueue: unknown[]; referralDashboardSections: Array<{ sectionKey: string }> };

      expect(persistedSummary.normalizedSectionCount).toBeGreaterThan(0);
      expect(persistedSummary.llmProposalCount).toBeGreaterThan(0);
      expect(persistedFacts.facts.length).toBeGreaterThan(0);
      expect(persistedFacts.patient_context.referral_date).toBe("02/20/2026");
      expect(persistedFacts.facts.some((fact) => fact.fact_key === "medical_necessity_summary")).toBe(true);
      expect(persistedQaReference.fieldGroups).toHaveLength(9);
      expect(persistedQaReference.referralDashboardSections.some((section) => section.sectionKey === "administrative_information")).toBe(true);
      expect(persistedQaReference.qaReviewQueue.length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves line structure for in-memory fallback referral text", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-pipeline-lines-"));

    try {
      const fallbackText = [
        "Resident: YOUNG, CHRISTINE E (41707)",
        "DOB: 05/30/1944",
        "Order Date: 02/17/2026 18:03",
        "Order Summary: Pt to discharge home on 2/20/26.",
        "Homebound Status",
        "Uses walker and leaving home is exhausting.",
        "CONTACTS",
        "YOUNG, EMILY Daughter Cell:4807035881",
        "DIAGNOSIS INFORMATION",
        "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM 12/23/2025 Primary",
      ].join("\n");

      const extractedDocuments: ExtractedDocument[] = [{
        type: "ORDER",
        text: fallbackText,
        metadata: {
          source: "artifact_fallback",
          portalLabel: "Christine Young Referral",
          effectiveTextSource: "viewer_text_fallback",
          textLength: fallbackText.length,
        },
      }];

      const result = await runReferralDocumentProcessingPipeline({
        workItem: {
          id: "CHRISTINE_YOUNG__fallback",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Christine Young",
            normalizedName: "CHRISTINE YOUNG",
            medicareNumber: "8A75MN2VE79",
            mrn: null,
          },
          episodeContext: {
            socDate: "02/27/2026",
            episodeDate: "02/27/2026",
            billingPeriod: "02/27/2026 - 03/31/2026",
            episodePeriod: "02/27/2026 - 04/27/2026",
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
        } as any,
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
        }),
        logger: pino({ level: "silent" }),
        extractedDocuments,
      });

      expect(result.result).not.toBeNull();

      const persistedExtractedText = await readFile(result.result!.artifacts.extractedTextPath, "utf8");
      expect(persistedExtractedText).toContain("Order Summary: Pt to discharge home on 2/20/26.\nHomebound Status");
      expect(result.result?.extractionResult.extractionQuality.lineCount).toBeGreaterThan(1);
      expect(result.result?.normalizedSections.some((section) => section.sectionName === "homebound_evidence")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("combines all usable referral source PDFs while keeping richer batch source content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-pipeline-source-selection-"));
    const outputDir = path.join(tempDir, "outputs");
    const sourceDir = path.join(tempDir, "source");

    try {
      await mkdir(outputDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(outputDir, "work-items.json"), JSON.stringify([{ id: "CHRISTINE_YOUNG__test" }]), "utf8");

      const livePdfPath = path.join(outputDir, "christine-young-live-referral.pdf");
      const livePdfText = [
        "Patient Name: Christine Young",
        "DOB: 05/30/1944",
        "Order Date: 02/20/2026",
        "Order Summary: SN for medication management.",
        "Diagnosis Information",
        "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
      ].join(" ");
      await writeFile(livePdfPath, `%PDF-1.4 BT (${livePdfText}) Tj ET`, "latin1");

      const richerPdfPath = path.join(sourceDir, "christine-young-complete-referral.pdf");
      const richerPdfText = [
        "Patient Name: Christine Young",
        "DOB: 05/30/1944",
        "Order Date: 02/20/2026",
        "Primary Reason for Home Health / Medical Necessity",
        "Patient requires skilled nursing for medication management and PT and OT due to pneumonia, weakness, and deconditioning after hospitalization.",
        "Homebound Status",
        "Uses walker, needs assistance for transfers, and leaving home is medically contraindicated except for essential medical care.",
        "Caregiver Info",
        "Primary Caregiver: Emily Young",
        "Relationship: Daughter",
        "Phone: 4807035881",
        "Diagnosis Information",
        "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
        "R53.1 WEAKNESS",
        "Care Plan",
        "PT Frequency 1w1 2w4",
      ].join("\n");
      await writeFile(richerPdfPath, `%PDF-1.4 BT (${richerPdfText}) Tj ET`, "latin1");

      const extractedDocuments: ExtractedDocument[] = [{
        type: "ORDER",
        text: livePdfText,
        metadata: {
          source: "printed_pdf",
          sourcePath: livePdfPath,
          portalLabel: "Christine Young Referral",
          effectiveTextSource: "digital_pdf_text",
          textLength: livePdfText.length,
        },
      }];

      const result = await runReferralDocumentProcessingPipeline({
        workItem: {
          id: "CHRISTINE_YOUNG__test",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Christine Young",
            normalizedName: "CHRISTINE YOUNG",
            medicareNumber: "8A75MN2VE79",
            mrn: null,
          },
          episodeContext: {
            socDate: "02/27/2026",
            episodeDate: "02/27/2026",
            billingPeriod: "02/27/2026 - 03/31/2026",
            episodePeriod: "02/27/2026 - 04/27/2026",
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
        } as any,
        outputDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
        }),
        logger: pino({ level: "silent" }),
        extractedDocuments,
      });

      expect(result.result).not.toBeNull();
      expect(result.result?.sourceMeta.selectedDocumentId).toContain("manual-source");
      expect(result.result?.extractionResult.localFilePath).toBe(richerPdfPath);
      expect(result.result?.extractionResult.extractionQuality.containsSectionLikeHeadings).toBe(true);
      expect(result.result?.normalizedSections.some((section) => section.sectionName === "homebound_evidence")).toBe(true);

      const persistedExtractedText = await readFile(result.result!.artifacts.extractedTextPath, "utf8");
      expect(persistedExtractedText).toContain("Caregiver Info");
      expect(persistedExtractedText).toContain("PT Frequency 1w1 2w4");
      expect(persistedExtractedText).toContain("SN for medication management.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not persist rejected referral text as usable extracted text", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-pipeline-rejected-text-"));

    try {
      const gibberishReferralText = [
        "Z69 lm UUgkk A--M nomcOP 4HKr 3pQ 9 w051UW auUcm ZDbJHd vmgcisme Z u2",
        "E23 q WWG N68 U AsYj0 R75 M 1faIsicRC fFZpP s-8 CHrJ6 dflhU",
      ].join("\n");

      const extractedDocuments: ExtractedDocument[] = [{
        type: "ORDER",
        text: gibberishReferralText,
        metadata: {
          source: "artifact_fallback",
          portalLabel: "Jean Thompson Referral",
          effectiveTextSource: "viewer_text_fallback",
          textLength: gibberishReferralText.length,
        },
      }];

      const result = await runReferralDocumentProcessingPipeline({
        workItem: {
          id: "JEAN_THOMPSON__test",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Jean Thompson",
            normalizedName: "JEAN THOMPSON",
            medicareNumber: null,
            mrn: null,
          },
          episodeContext: {
            socDate: "01/24/2026",
            episodeDate: "01/24/2026",
            billingPeriod: "01/24/2026 - 02/22/2026",
            episodePeriod: "01/24/2026 - 03/24/2026",
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
        } as any,
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
        }),
        logger: pino({ level: "silent" }),
        extractedDocuments,
      });

      expect(result.result).not.toBeNull();
      expect(result.result?.extractionResult.extractionSuccess).toBe(false);
      expect(result.result?.extractionResult.extractionQuality.usabilityStatus).toBe("rejected");

      const persistedExtractedText = await readFile(result.result!.artifacts.extractedTextPath, "utf8");
      expect(persistedExtractedText.trim()).toBe("");
      expect(persistedExtractedText).not.toContain("UUgkk");
      expect(result.result?.extractedFacts.facts).toHaveLength(0);
      expect(result.result?.llmProposal.diagnosis_candidates).toHaveLength(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses unchanged referral facts instead of regenerating downstream artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "referral-pipeline-reuse-"));

    try {
      const referralText = [
        "Patient Name: Christine Young",
        "DOB: 05/30/1944",
        "Order Date: 02/20/2026",
        "Primary Reason for Home Health / Medical Necessity",
        "Patient requires skilled nursing for medication management and PT/OT for mobility.",
        "Diagnosis Information",
        "J18.9 PNEUMONIA, UNSPECIFIED ORGANISM",
      ].join("\n");

      const workItem = {
        id: "CHRISTINE_YOUNG__reuse",
        subsidiaryId: "default",
        patientIdentity: {
          displayName: "Christine Young",
          normalizedName: "CHRISTINE YOUNG",
          medicareNumber: "8A75MN2VE79",
          mrn: null,
        },
        episodeContext: {
          socDate: "02/27/2026",
          episodeDate: "02/27/2026",
          billingPeriod: "02/27/2026 - 03/31/2026",
          episodePeriod: "02/27/2026 - 04/27/2026",
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
      const extractedDocuments: ExtractedDocument[] = [{
        type: "ORDER",
        text: referralText,
        metadata: {
          source: "artifact_fallback",
          portalLabel: "Christine Young Referral",
          effectiveTextSource: "viewer_text_fallback",
          textLength: referralText.length,
        },
      }];
      const baseParams = {
        workItem,
        outputDir: tempDir,
        env: loadEnv({
          ...process.env,
          CODE_LLM_ENABLED: "false",
        }),
        logger: pino({ level: "silent" }),
        extractedDocuments,
      };

      const first = await runReferralDocumentProcessingPipeline(baseParams);
      const second = await runReferralDocumentProcessingPipeline(baseParams);

      expect(first.result).not.toBeNull();
      expect(second.result).not.toBeNull();
      expect(second.stepLogs.some((log) => log.step === "referral_processing_reused")).toBe(true);

      const reuseMetadata = JSON.parse(
        await readFile(
          path.join(tempDir, "patients", workItem.id, "referral-document-processing", "referral-reuse-metadata.json"),
          "utf8",
        ),
      ) as { reusedFromPreviousRun: boolean; processingInputFingerprint: string };

      expect(reuseMetadata.reusedFromPreviousRun).toBe(true);
      expect(reuseMetadata.processingInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(second.result?.extractedFacts.facts.length).toBe(first.result?.extractedFacts.facts.length);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
