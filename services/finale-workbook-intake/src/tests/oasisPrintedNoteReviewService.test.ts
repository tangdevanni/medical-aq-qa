import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { capturePrintedOasisNoteReview } from "../oasis/print/oasisPrintedNoteReviewService";
import type { BatchPortalAutomationClient } from "../workers/playwrightBatchQaWorker";

describe("capturePrintedOasisNoteReview", () => {
  it("persists a read-only printed-note review artifact with section summaries", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "oasis-printed-review-"));
    const evidenceDir = path.join(tempDir, "evidence");
    const printedDir = path.join(evidenceDir, "oasis-printed-note");
    mkdirSync(printedDir, { recursive: true });
    const extractedTextPath = path.join(printedDir, "extracted-text.txt");
    writeFileSync(
      extractedTextPath,
      [
        "Administrative Information",
        "M0018 - Attending Physician (NPI): 1720004393",
        "M0030 - Start of Care Date: 03/01/2026",
        "M0040 - Patient Name: Jane Doe",
        "M0063 - Medicare Number: A123456789",
      ].join("\n"),
      "utf8",
    );

    const portalClient = {
      captureOasisPrintedNoteForReview: async () => ({
        result: {
          assessmentType: "SOC",
          printProfileKey: "soc_administrative_information_v1",
          printProfileLabel: "Administrative Information only",
          printButtonDetected: true,
          printButtonVisible: true,
          printButtonSelectorUsed: "fin-button[title='Print']",
          printClickSucceeded: true,
          printModalDetected: true,
          printModalSelectorUsed: "ngb-modal-window[role='dialog']",
          printModalConfirmSelectorUsed: "button:has-text('Print')",
          printModalConfirmSucceeded: true,
          selectedSectionLabels: [
            "Administrative Information",
          ],
          currentUrl: "https://demo.portal/provider/x/client/y/oasis/soc",
          printedPdfPath: null,
          sourcePdfPath: null,
          extractedTextPath,
          extractionResultPath: path.join(printedDir, "extraction-result.json"),
          ocrResultPath: null,
          textLength: 0,
          extractionMethod: "visible_text_fallback" as const,
          warnings: [],
        },
        stepLogs: [],
      }),
    } as unknown as BatchPortalAutomationClient;

    try {
      const result = await capturePrintedOasisNoteReview({
        context: {
          workflowDomain: "qa",
          batchId: "batch-1",
          patientRunId: "run-1",
          patientName: "Jane Doe",
          patientId: "PT-1",
          chartUrl: "https://demo.portal/provider/x/client/y/chart",
          dashboardUrl: "https://demo.portal/provider/x/dashboard",
          resolvedAt: new Date().toISOString(),
          traceId: "trace-1",
        },
        workItem: {
          id: "patient-1",
          subsidiaryId: "default",
          patientIdentity: {
            displayName: "Jane Doe",
            normalizedName: "JANE DOE",
            medicareNumber: null,
            mrn: null,
          },
          episodeContext: {
            socDate: "03/01/2026",
            episodeDate: "03/01/2026",
            billingPeriod: "03/01/2026 - 03/31/2026",
            episodePeriod: "03/01/2026 - 04/29/2026",
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
        evidenceDir,
        outputDir: tempDir,
        logger: pino({ level: "silent" }),
        portalClient,
        sharedEvidence: {
          patientName: "Jane Doe",
          chartUrl: "https://demo.portal/provider/x/client/y/chart",
          artifacts: [],
          documentInventory: [],
          discoveredDocuments: [],
          extractedDocuments: [
            {
              type: "ORDER",
              text: "Resident: JANE DOE (84) DOB: 03/14/1944 Medicare Beneficiary ID A123456789 Ordered By: Smith, John National Provider ID #1720004393",
              metadata: {},
            },
          ],
          extractedArtifactPaths: [],
          diagnosisCodingContext: {
            sourceDocumentCount: 0,
            sourceCharacterCount: 0,
            llmInputSource: "raw_text_fallback",
            diagnosisMentions: ["Pneumonia"],
            icd10Codes: ["J18.9"],
            codeCategories: ["J18.9:Diseases of the respiratory system"],
            canonical: {
              reason_for_admission: "Pneumonia",
              diagnosis_phrases: ["Pneumonia"],
              diagnosis_code_pairs: [{ diagnosis: "Pneumonia", code: "J18.9", code_source: "explicit" }],
              icd10_codes_found_verbatim: ["J18.9"],
              ordered_services: [],
              clinical_summary: null,
              source_quotes: [],
              uncertain_items: [],
              document_type: "Referral",
              extraction_confidence: "medium",
            },
            llmUsed: false,
            llmModel: null,
            llmError: null,
            evidence: ["Pneumonia evidence"],
          },
          diagnosisSourceEvidence: {
            primaryDiagnosisText: "Pneumonia",
            otherDiagnosisText: [],
            supportingReferences: ["Referral: pneumonia diagnosis"],
          },
          documentInventoryExportPath: null,
          documentInventoryExportError: null,
          documentTextExportPath: null,
          documentTextExportError: null,
          referralDocumentProcessing: null,
          referralDocumentSummaryPath: null,
          warnings: [],
        },
        assessmentNote: {
          assessmentOpened: true,
          matchedAssessmentLabel: "SOC OASIS",
          matchedRequestedAssessment: true,
          currentUrl: "https://demo.portal/provider/x/client/y/oasis/soc",
          diagnosisSectionOpened: true,
          diagnosisListFound: true,
          diagnosisListSamples: ["Active Diagnoses"],
          visibleDiagnoses: [],
          lockStatus: "locked",
          warnings: [],
        },
        assessmentType: "SOC",
        printProfileKey: "soc_administrative_information_v1",
      });

      expect(result.result.capture.printButtonDetected).toBe(true);
      expect(result.result.capture.printProfileKey).toBe("soc_administrative_information_v1");
      expect(result.result.capture.extractedTextPath).toBe(extractedTextPath);
      expect(result.result.sections.some((section) => section.key === "administrative_information")).toBe(true);
      expect(result.result.sections.every((section) => section.key === "administrative_information")).toBe(true);
      const administrative = result.result.sections.find((section) => section.key === "administrative_information");
      expect(administrative?.missingFields).toContain("M0010 Agency Medicare Provider #");
      expect(administrative?.suggestions.some((suggestion) => suggestion.includes("Recommend M0066 = 03/14/1944"))).toBe(true);
      expect(result.reviewPath).toMatch(/oasis-printed-note-review\.json$/);
      expect(result.stepLogs.some((log) => log.step === "oasis_printed_note_review")).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
