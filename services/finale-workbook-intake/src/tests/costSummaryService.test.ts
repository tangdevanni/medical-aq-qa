import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPreWorkerRunPlan,
  writePatientCostSummary,
  writeRunCostSummary,
} from "../services/costSummaryService";

describe("costSummaryService", () => {
  it("writes patient and run cost summaries from existing artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "cost-summary-"));
    const patientId = "ALLEN_COLEMAN__cost";
    const patientDir = path.join(tempDir, "patients", patientId);

    try {
      await mkdir(path.join(patientDir, "referral-document-processing"), { recursive: true });
      await writeFile(
        path.join(patientDir, "referral-document-processing", "direct-document.json"),
        JSON.stringify({
          invocation: {
            provider: "bedrock",
            inputTokenCount: 100,
            outputTokenCount: 25,
            totalTokenCount: 125,
          },
          extractionPolicyDecision: { mode: "html_text" },
        }),
        "utf8",
      );
      await writeFile(
        path.join(patientDir, "oasis-dom-section-outputs.json"),
        JSON.stringify({
          source: "print_preview_dom",
          summary: {
            reusedSections: 3,
            processedSections: 2,
          },
        }),
        "utf8",
      );
      await writeFile(
        path.join(patientDir, "visit-note-processing-manifest.json"),
        JSON.stringify({
          visitNoteInputs: [
            { extractionSource: "cache", llmAnalysisSource: "cache" },
            { extractionSource: "text_export", llmAnalysisSource: "new_llm" },
          ],
        }),
        "utf8",
      );

      const plan = buildPreWorkerRunPlan({
        batchId: "batch-cost",
        mode: "delta",
        deltaReuseEnabled: true,
        patients: [
          {
            workItemId: patientId,
            patientName: "Allen Coleman",
            decision: "needs_portal_acquisition",
            reason: "test patient requires portal acquisition",
            priorRunId: null,
            willOpenPortalWorker: true,
          },
          {
            workItemId: "UNCHANGED__reuse",
            patientName: "Unchanged Patient",
            decision: "reuse_complete",
            reason: "fingerprint matched",
            priorRunId: "prior-run",
            willOpenPortalWorker: false,
          },
        ],
      });
      expect(plan.decisionCounts.needs_portal_acquisition).toBe(1);
      expect(plan.decisionCounts.reuse_complete).toBe(1);
      await writeFile(path.join(tempDir, "pre-worker-run-plan.json"), JSON.stringify(plan), "utf8");

      const { summary } = await writePatientCostSummary({
        patientArtifactsDirectory: patientDir,
        run: {
          batchId: "batch-cost",
          runId: "run-cost",
          workItemId: patientId,
          patientName: "Allen Coleman",
          startedAt: "2026-06-14T00:00:00.000Z",
          completedAt: "2026-06-14T00:01:00.000Z",
          retryEligible: false,
          errorSummary: null,
          automationStepLogs: [
            {
              timestamp: "2026-06-14T00:00:10.000Z",
              step: "oasis_print_preview_dom",
              message: "print_preview_dom accepted",
              patientName: "Allen Coleman",
              urlBefore: null,
              urlAfter: null,
              selectorUsed: null,
              found: [],
              missing: [],
              openedDocumentLabel: null,
              openedDocumentUrl: null,
              evidence: [],
              retryCount: 0,
              safeReadConfirmed: true,
            },
          ],
        },
        stageTimings: [
          {
            stage: "portal_shared_evidence",
            startedAt: "2026-06-14T00:00:00.000Z",
            completedAt: "2026-06-14T00:00:30.000Z",
            durationMs: 30_000,
          },
        ],
        planningDecision: "needs_portal_acquisition",
        planningReason: "test patient requires portal acquisition",
      });

      expect(summary.totalRuntimeMs).toBe(60_000);
      expect(summary.portal.browserActiveMs).toBe(30_000);
      expect(summary.oasis.printPreviewAccepted).toBe(true);
      expect(summary.llm.callCount).toBe(1);
      expect(summary.llm.totalTokens).toBe(125);
      expect(summary.textract.ocrAvoidedByHtml).toBe(1);
      expect(summary.cache.reusedOasisSections).toBe(3);
      expect(summary.cache.processedOasisSections).toBe(2);
      expect(summary.cache.reusedVisitNotes).toBe(1);
      expect(summary.cache.processedVisitNotes).toBe(1);

      const { filePath, summary: runSummary } = await writeRunCostSummary({
        outputDirectory: tempDir,
        batchId: "batch-cost",
        patientIds: [patientId],
      });
      expect(runSummary.patientCount).toBe(1);
      expect(runSummary.llmCallCount).toBe(1);
      expect(runSummary.planning?.decisionCounts.needs_portal_acquisition).toBe(1);
      expect(JSON.parse(await readFile(filePath, "utf8")).schemaVersion).toBe("run-cost-summary.v1");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
