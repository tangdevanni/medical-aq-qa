import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { VisitNoteProcessingManifest } from "@medical-ai-qa/shared-types";
import { buildVisitNotesDiscoveryArtifactForTest } from "../portal/services/visitNotesDiscoveryService";
import { planControlledVisitNoteCapture } from "../portal/services/visitNotesControlledCaptureService";
import {
  buildVisitNoteSourceMeta,
  isSafeVisitNoteAction,
  isSafeVisitNoteOpenCandidate,
  isUnsafeVisitNoteAction,
  persistVisitNoteCaptureResult,
  writeVisitNoteTextCaptureFixture,
} from "../portal/services/visitNoteCaptureService";

describe("visit note controlled capture scaffold", () => {
  it("rejects unsafe actions and accepts read-only actions", () => {
    expect(isUnsafeVisitNoteAction("Edit")).toBe(true);
    expect(isUnsafeVisitNoteAction("Submit and Sign")).toBe(true);
    expect(isUnsafeVisitNoteAction("Add")).toBe(true);
    expect(isUnsafeVisitNoteAction("Update")).toBe(true);
    expect(isUnsafeVisitNoteAction("Create")).toBe(true);
    expect(isUnsafeVisitNoteAction("Mark Ready For Billing")).toBe(true);
    expect(isSafeVisitNoteAction("View PDF")).toBe(true);
    expect(isSafeVisitNoteAction("Open")).toBe(true);
    expect(isSafeVisitNoteAction("Approve")).toBe(false);
    expect(isSafeVisitNoteOpenCandidate("Visit Note-PT - Visit")).toBe(true);
    expect(isSafeVisitNoteOpenCandidate("Visit Note-OT Visit")).toBe(true);
    expect(isSafeVisitNoteOpenCandidate("Visit Note-PT - Visit Edit")).toBe(false);
  });

  it("plans capture only for eligible clinical notes", () => {
    const discovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { rawDocumentType: "Visit Note-PTA", statusRaw: "In Progress", hasSafeOpenAction: true, rowText: "Visit Note-PTA In Progress" },
        { rawDocumentType: "Visit Note-RN Regular Visit", statusRaw: "Not Started", hasSafeOpenAction: true, rowText: "Visit Note-RN Not Started" },
        { rawDocumentType: "Visit Note-Admin Pay $20", statusRaw: "QA Completed", hasSafeOpenAction: true, rowText: "Visit Note-Admin Pay QA Completed" },
      ],
    });
    const plan = planControlledVisitNoteCapture({ discovery, captureVisitNotesLimit: 1 });
    expect(plan.eligibleForCapture).toBe(1);
    expect(plan.skippedAdminCount).toBe(1);
    expect(plan.boundedCaptureCount).toBe(1);
    expect(plan.rows[0]?.captureStatus).toBe("not_attempted");
    expect(plan.rows[1]?.captureStatus).toBe("skipped");
    expect(plan.rows[2]?.skipReason).toBe("non_clinical_or_admin_visit_note");
  });

  it("captures all eligible clinical notes by default when no cap is configured", () => {
    const discovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { rawDocumentType: "Visit Note-PT", statusRaw: "Submitted", hasSafeOpenAction: true, rowText: "Visit Note-PT Submitted" },
        { rawDocumentType: "Visit Note-RN Regular Visit", statusRaw: "E-Signed", hasSafeOpenAction: true, rowText: "Visit Note-RN E-Signed" },
      ],
    });
    const plan = planControlledVisitNoteCapture({ discovery });

    expect(plan.eligibleForCapture).toBe(2);
    expect(plan.boundedCaptureCount).toBe(2);
    expect(plan.rows.map((row) => row.captureStatus)).toEqual(["not_attempted", "not_attempted"]);
  });

  it("marks cap overflow as capture_pending_due_to_config_limit", () => {
    const discovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { rawDocumentType: "Visit Note-PT", statusRaw: "In Progress", hasSafeOpenAction: true, rowText: "Visit Note-PT In Progress" },
        { rawDocumentType: "Visit Note-RN Regular Visit", statusRaw: "E-Signed", hasSafeOpenAction: true, rowText: "Visit Note-RN E-Signed" },
      ],
    });
    const plan = planControlledVisitNoteCapture({ discovery, captureVisitNotesLimit: 1 });

    expect(plan.boundedCaptureCount).toBe(1);
    expect(plan.pendingDueToConfigLimitCount).toBe(1);
    expect(plan.rows[1]?.captureStatus).toBe("capture_pending_due_to_config_limit");
    expect(plan.rows[1]?.skipReason).toBe("VISIT_NOTE_CAPTURE_MAX_NOTES reached");
  });

  it("uses manifest status as source of truth for skip and retry decisions", () => {
    const discovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { portalDocumentId: "note-1", rawDocumentType: "Visit Note-PT", statusRaw: "In Progress", hasSafeOpenAction: true, rowText: "Visit Note-PT In Progress" },
        { portalDocumentId: "note-2", rawDocumentType: "Visit Note-RN Regular Visit", statusRaw: "Submitted", hasSafeOpenAction: true, rowText: "Visit Note-RN Submitted" },
      ],
    });
    const previousManifest: VisitNoteProcessingManifest = {
      schemaVersion: "visit-note-processing-manifest.v1",
      generatedAt: "2026-05-07T00:00:00.000Z",
      patientRunId: "run-1",
      planOfCareHash: "poc-a",
      oasisFactPackHash: "oasis-a",
      visitNotesDiscoveryHash: "discovery-a",
      visitNoteInputs: [
        {
          visitNoteKey: discovery.rows[0]!.visitNoteKey,
          rowTextHash: discovery.rows[0]!.rowTextHash,
          contentHash: "content-a",
          textHash: "text-a",
          cacheKey: "cache-a",
          lifecycleStatus: "active_monitoring",
          captureEligibility: "active_monitoring",
          captureStatus: "captured",
          extractionStatus: "usable",
          analysisStatus: "ready",
          reviewStatus: "confirmed",
          extractionSource: "cache",
          llmAnalysisSource: "cache",
          analysisInputHash: "analysis-a",
        },
        {
          visitNoteKey: discovery.rows[1]!.visitNoteKey,
          rowTextHash: discovery.rows[1]!.rowTextHash,
          contentHash: "content-b",
          textHash: "text-b",
          cacheKey: "cache-b",
          lifecycleStatus: "active_monitoring",
          captureEligibility: "active_monitoring",
          captureStatus: "captured",
          extractionStatus: "degraded",
          analysisStatus: "failed",
          reviewStatus: "retryable",
          extractionSource: "text_export",
          llmAnalysisSource: "new_llm",
          analysisInputHash: "analysis-b",
        },
      ],
    };

    const plan = planControlledVisitNoteCapture({
      discovery,
      previousManifest,
      currentPlanOfCareHash: "poc-a",
      currentOasisFactPackHash: "oasis-a",
    });
    expect(plan.alreadySatisfiedCount).toBe(1);
    expect(plan.rows[0]?.skipReason).toBe("manifest_indicates_capture_extraction_analysis_current");
    expect(plan.rows[1]?.captureStatus).toBe("not_attempted");

    const pocChanged = planControlledVisitNoteCapture({
      discovery,
      previousManifest,
      currentPlanOfCareHash: "poc-b",
      currentOasisFactPackHash: "oasis-a",
    });
    expect(pocChanged.rows[0]?.captureStatus).toBe("not_attempted");

    const oasisChanged = planControlledVisitNoteCapture({
      discovery,
      previousManifest,
      currentPlanOfCareHash: "poc-a",
      currentOasisFactPackHash: "oasis-b",
    });
    expect(oasisChanged.rows[0]?.captureStatus).toBe("not_attempted");

    const rowChangedDiscovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { portalDocumentId: "note-1", rawDocumentType: "Visit Note-PT", statusRaw: "In Progress", hasSafeOpenAction: true, rowText: "Visit Note-PT In Progress updated vitals" },
      ],
    });
    const rowChanged = planControlledVisitNoteCapture({
      discovery: rowChangedDiscovery,
      previousManifest,
      currentPlanOfCareHash: "poc-a",
      currentOasisFactPackHash: "oasis-a",
    });
    expect(rowChanged.rows[0]?.captureStatus).toBe("not_attempted");

    const forced = planControlledVisitNoteCapture({
      discovery,
      previousManifest,
      currentPlanOfCareHash: "poc-a",
      currentOasisFactPackHash: "oasis-a",
      forceRerunVisitNotes: true,
    });
    expect(forced.rows[0]?.captureStatus).toBe("not_attempted");
  });

  it("finalizes QA Complete notes without active capture by default", () => {
    const discovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { rawDocumentType: "Visit Note-PT", statusRaw: "QA Completed", hasSafeOpenAction: true, rowText: "Visit Note-PT QA Completed" },
        { rawDocumentType: "Visit Note-OT", statusRaw: "Pending QA", hasSafeOpenAction: true, rowText: "Visit Note-OT Pending QA" },
      ],
    });
    const plan = planControlledVisitNoteCapture({ discovery });

    expect(plan.eligibleForCapture).toBe(1);
    expect(plan.rows[0]?.lifecycleStatus).toBe("finalized_no_active_monitoring");
    expect(plan.rows[0]?.captureStatus).toBe("skipped");
    expect(plan.rows[1]?.captureEligibility).toBe("active_monitoring");
    expect(plan.rows[1]?.captureStatus).toBe("not_attempted");
  });

  it("stops active monitoring when an unchanged active note becomes QA Complete", () => {
    const activeDiscovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { portalDocumentId: "note-1", rawDocumentType: "Visit Note-PT", statusRaw: "In Progress", hasSafeOpenAction: true, rowText: "Visit Note-PT In Progress" },
      ],
    });
    const finalizedDiscovery = buildVisitNotesDiscoveryArtifactForTest({
      rows: [
        { portalDocumentId: "note-1", rawDocumentType: "Visit Note-PT", statusRaw: "QA Completed", hasSafeOpenAction: true, rowText: "Visit Note-PT QA Completed" },
      ],
    });
    const previousManifest: VisitNoteProcessingManifest = {
      schemaVersion: "visit-note-processing-manifest.v1",
      generatedAt: "2026-05-07T00:00:00.000Z",
      patientRunId: "run-1",
      planOfCareHash: "poc-a",
      oasisFactPackHash: "oasis-a",
      visitNotesDiscoveryHash: "discovery-a",
      visitNoteInputs: [{
        visitNoteKey: activeDiscovery.rows[0]!.visitNoteKey,
        rowTextHash: activeDiscovery.rows[0]!.rowTextHash,
        contentHash: "content-a",
        textHash: "text-a",
        cacheKey: "cache-a",
        lifecycleStatus: "active_monitoring",
        captureEligibility: "active_monitoring",
        captureStatus: "captured",
        extractionStatus: "usable",
        analysisStatus: "ready",
        reviewStatus: "confirmed",
        extractionSource: "cache",
        llmAnalysisSource: "cache",
        analysisInputHash: "analysis-a",
      }],
    };

    const plan = planControlledVisitNoteCapture({
      discovery: finalizedDiscovery,
      previousManifest,
      currentPlanOfCareHash: "poc-a",
      currentOasisFactPackHash: "oasis-a",
    });

    expect(plan.eligibleForCapture).toBe(0);
    expect(plan.rows[0]?.lifecycleStatus).toBe("finalized_no_active_monitoring");
    expect(plan.rows[0]?.captureStatus).toBe("skipped");
  });

  it("writes fixture source metadata and extracted text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "visit-note-capture-"));
    try {
      const discovery = buildVisitNotesDiscoveryArtifactForTest({
        rows: [{ rawDocumentType: "Visit Note-PT", statusRaw: "QA Completed", rowText: "Visit Note-PT QA Completed" }],
      });
      const row = discovery.rows[0]!;
      const meta = buildVisitNoteSourceMeta({
        row,
        extractedText: "Patient tolerated gait training.",
        sourceContent: "Patient tolerated gait training.",
        captureStrategy: "fixture_text",
      });
      expect(meta.textHash).toHaveLength(64);
      expect(meta.captureStatus).toBe("captured");
      const written = await writeVisitNoteTextCaptureFixture({
        patientArtifactsDirectory: directory,
        row,
        text: "Patient tolerated gait training.",
        capturedAt: "2026-05-07T00:00:00.000Z",
      });
      expect(await readFile(written.extractedTextPath, "utf8")).toContain("gait training");
      expect(await readFile(written.sourceMetaPath, "utf8")).toContain("fixture_text");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists HTML capture source, extracted text, and usable extraction result", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "visit-note-capture-"));
    try {
      const discovery = buildVisitNotesDiscoveryArtifactForTest({
        rows: [{ rawDocumentType: "Visit Note-RN Regular Visit", statusRaw: "E-Signed", rowText: "Visit Note-RN E-Signed" }],
      });
      const row = discovery.rows[0]!;
      const written = await persistVisitNoteCaptureResult({
        patientArtifactsDirectory: directory,
        row,
        sourceHtml: "<html><body><p>Skilled nurse performed wound care and medication teaching. Patient tolerated well.</p></body></html>",
        captureStrategy: "html_text",
        capturedAt: "2026-05-07T00:00:00.000Z",
      });

      expect(await readFile(path.join(written.noteDirectory, "source.html"), "utf8")).toContain("wound care");
      expect(await readFile(written.extractedTextPath, "utf8")).toContain("Patient tolerated well");
      expect(written.extractionResult.extractionSource).toBe("html_text");
      expect(written.extractionResult.extractionQualityStatus).toBe("usable");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks degraded capture text without producing a usable extraction", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "visit-note-capture-"));
    try {
      const discovery = buildVisitNotesDiscoveryArtifactForTest({
        rows: [{ rawDocumentType: "Visit Note-PT", statusRaw: "QA Completed", rowText: "Visit Note-PT QA Completed" }],
      });
      const written = await persistVisitNoteCaptureResult({
        patientArtifactsDirectory: directory,
        row: discovery.rows[0]!,
        sourceText: "%PDF-1.4 1 0 obj Title (Finale Health) endobj",
        captureStrategy: "source_text",
      });

      expect(written.sourceMeta.extractionQualityStatus).toBe("degraded");
      expect(written.extractionResult.qualityReason).toBe("pdf_binary_or_metadata_text");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
