import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPatientRunTimingTracker,
  writePatientRunCacheSummary,
} from "../services/patientRunReuseSummaryService";

describe("patientRunReuseSummaryService", () => {
  it("writes fingerprints, reuse counts, and saved-time comparison", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "patient-run-cache-summary-"));
    const patientId = "CHRISTINE_YOUNG__reuse";
    const patientDir = path.join(tempDir, "patients", patientId);

    try {
      await mkdir(path.join(patientDir, "referral-document-processing"), { recursive: true });
      await writeFile(
        path.join(patientDir, "patient-run-cache-summary.json"),
        JSON.stringify({
          schemaVersion: "patient-run-cache-summary.v1",
          generatedAt: "2026-05-30T00:00:00.000Z",
          patientId,
          patientName: "Christine Young",
          runId: "prior-run",
          batchId: "prior-batch",
          lastCompletedAt: "2026-05-30T00:01:00.000Z",
          totalRuntimeMs: 120_000,
          stageTimings: [],
          fingerprints: {
            referralUploadFingerprint: "upload",
            referralProcessingFingerprint: "processing",
            referralFactsFingerprint: "facts",
            oasisDomContentHash: "oasis-hash",
            oasisQaHash: "qa",
            planOfCareSourceHash: "poc-hash",
            visitNotesDiscoveryHash: "notes",
          },
          visitNotes: {
            total: 0,
            reused: 0,
            processed: 0,
            skipped: 0,
            failed: 0,
            noteHashes: [],
          },
          reuseSummary: {
            referral: "processed",
            oasis: "rerun",
            planOfCare: "rerun",
            visitNotes: "not_available",
          },
          warnings: [],
        }, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(patientDir, "referral-document-processing", "referral-reuse-metadata.json"),
        JSON.stringify({
          schemaVersion: "referral-reuse-metadata.v1",
          generatedAt: "2026-05-30T00:02:00.000Z",
          referralUploadFingerprint: "upload",
          processingInputFingerprint: "processing",
          reusedFromPreviousRun: true,
        }, null, 2),
        "utf8",
      );
      await writeFile(path.join(patientDir, "referral-document-processing", "extracted-facts.json"), "facts", "utf8");
      await writeFile(
        path.join(patientDir, "oasis-dom-extracted-state.json"),
        JSON.stringify({ contentHash: "oasis-hash" }),
        "utf8",
      );
      await writeFile(path.join(patientDir, "oasis-dom-vs-existing-extraction-comparison.json"), "qa", "utf8");
      await writeFile(
        path.join(patientDir, "plan-of-care-review-draft.json"),
        JSON.stringify({ pocSource: { sourceHash: "poc-hash" } }),
        "utf8",
      );
      await writeFile(
        path.join(patientDir, "visit-note-processing-manifest.json"),
        JSON.stringify({
          schemaVersion: "visit-note-processing-manifest.v1",
          generatedAt: "2026-05-30T00:02:00.000Z",
          visitNotesDiscoveryHash: "notes",
          planOfCareHash: "poc-hash",
          oasisFactPackHash: "oasis-hash",
          visitNoteInputs: [{
            visitNoteKey: "note-1",
            contentHash: "content",
            textHash: "text",
            analysisInputHash: "analysis",
            extractionSource: "cache",
            llmAnalysisSource: "cache",
            extractionStatus: "usable",
            analysisStatus: "ready",
          }],
        }, null, 2),
        "utf8",
      );

      const timing = createPatientRunTimingTracker();
      await timing.time("portal_lookup", async () => undefined);
      const { filePath, summary } = await writePatientRunCacheSummary({
        outputDirectory: tempDir,
        run: {
          workItemId: patientId,
          patientName: "Christine Young",
          runId: "run-2",
          batchId: "batch-2",
          completedAt: new Date().toISOString(),
          automationStepLogs: [{
            step: "oasis_qa_skipped_dom_acquisition_unchanged",
            message: "OASIS DOM acquisition is unchanged from prior QA input.",
          }],
        } as any,
        stageTimings: timing.stageTimings,
        startedAtMs: Date.now() - 10_000,
      });

      expect(filePath).toBe(path.join(patientDir, "patient-run-cache-summary.json"));
      expect(summary.reuseSummary).toMatchObject({
        referral: "reused",
        oasis: "reused",
        planOfCare: "reused",
        visitNotes: "reused",
      });
      expect(summary.visitNotes.reused).toBe(1);
      expect(summary.previousTotalRuntimeMs).toBe(120_000);
      expect(summary.estimatedSavedTimeMs).toBeGreaterThan(0);

      const persisted = JSON.parse(await readFile(filePath, "utf8"));
      expect(persisted.fingerprints.referralProcessingFingerprint).toBe("processing");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
