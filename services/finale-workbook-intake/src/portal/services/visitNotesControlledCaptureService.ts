import { createHash } from "node:crypto";
import type {
  VisitNoteDiscoveryRow,
  VisitNoteProcessingManifest,
  VisitNotesDiscoveryArtifact,
} from "@medical-ai-qa/shared-types";
import { determineVisitNoteCaptureEligibility } from "../../services/visitNoteNormalizationService";

export type VisitNoteCapturePlan = {
  rows: VisitNoteDiscoveryRow[];
  eligibleForCapture: number;
  skippedAdminCount: number;
  boundedCaptureCount: number;
  alreadySatisfiedCount: number;
  pendingDueToConfigLimitCount: number;
  warnings: string[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildVisitNoteCacheKey(row: Pick<VisitNoteDiscoveryRow, "portalDocumentId" | "visitNoteKey" | "sourceUrlHash" | "rowTextHash">): string {
  return sha256(row.portalDocumentId ?? row.sourceUrlHash ?? row.visitNoteKey ?? row.rowTextHash);
}

function previousEntryAllowsSkip(input: {
  row: VisitNoteDiscoveryRow;
  previousManifest?: VisitNoteProcessingManifest | null;
  previousEntry?: VisitNoteProcessingManifest["visitNoteInputs"][number];
  currentPlanOfCareHash?: string;
  currentOasisFactPackHash?: string;
  force?: boolean;
}): boolean {
  const previous = input.previousEntry;
  if (!previous || input.force) {
    return false;
  }
  if (previous.rowTextHash && previous.rowTextHash !== input.row.rowTextHash) {
    return false;
  }
  if (input.currentPlanOfCareHash && input.previousManifest?.planOfCareHash !== input.currentPlanOfCareHash) {
    return false;
  }
  if (input.currentOasisFactPackHash && input.previousManifest?.oasisFactPackHash !== input.currentOasisFactPackHash) {
    return false;
  }
  if (previous.captureStatus !== "captured") {
    return false;
  }
  if (!["usable", "partial"].includes(previous.extractionStatus ?? "")) {
    return false;
  }
  if (!["ready", "cache"].includes(previous.analysisStatus ?? "")) {
    return false;
  }
  if (["unconfirmed", "retryable"].includes(previous.reviewStatus ?? "")) {
    return false;
  }
  if (!previous.contentHash && !previous.textHash) {
    return false;
  }
  return true;
}

function shouldCaptureVisitNote(row: { captureEligibility?: string | null }): boolean {
  return row.captureEligibility === "active_monitoring" || row.captureEligibility === "finalized_no_active_monitoring";
}

export function planControlledVisitNoteCapture(input: {
  discovery: VisitNotesDiscoveryArtifact;
  captureVisitNotesLimit?: number;
  previousManifest?: VisitNoteProcessingManifest | null;
  currentPlanOfCareHash?: string;
  currentOasisFactPackHash?: string;
  forceRerunVisitNotes?: boolean;
}): VisitNoteCapturePlan {
  const limit = input.captureVisitNotesLimit;
  const previousByKey = new Map((input.previousManifest?.visitNoteInputs ?? []).map((entry) => [entry.visitNoteKey, entry]));
  let capturedSoFar = 0;
  let eligibleForCapture = 0;
  let skippedAdminCount = 0;
  let alreadySatisfiedCount = 0;
  let pendingDueToConfigLimitCount = 0;
  const rows = input.discovery.rows.map((row) => {
    const eligibility = row.captureEligibility
      ? { captureEligibility: row.captureEligibility, lifecycleStatus: row.lifecycleStatus ?? row.captureEligibility, skipReason: row.skipReason }
      : determineVisitNoteCaptureEligibility({
        normalizedVisitType: row.normalizedVisitType,
        normalizedStatus: row.normalizedStatus,
        rawDocumentType: row.rawDocumentType,
      });

    if (eligibility.captureEligibility === "ineligible") {
      skippedAdminCount += 1;
      return {
        ...row,
        lifecycleStatus: eligibility.lifecycleStatus,
        captureEligibility: eligibility.captureEligibility,
        captureStatus: "skipped" as const,
        skipReason: row.skipReason ?? eligibility.skipReason ?? "non_clinical_or_admin_visit_note",
      };
    }

    if (!shouldCaptureVisitNote(eligibility)) {
      return {
        ...row,
        lifecycleStatus: eligibility.lifecycleStatus,
        captureEligibility: eligibility.captureEligibility,
        captureStatus: "skipped" as const,
        skipReason: row.skipReason ?? eligibility.skipReason ?? "not_active_monitoring_visit_note",
      };
    }

    eligibleForCapture += 1;
    if (previousEntryAllowsSkip({
      row,
      previousManifest: input.previousManifest,
      previousEntry: previousByKey.get(row.visitNoteKey),
      currentPlanOfCareHash: input.currentPlanOfCareHash,
      currentOasisFactPackHash: input.currentOasisFactPackHash,
      force: input.forceRerunVisitNotes,
    })) {
      alreadySatisfiedCount += 1;
      return {
        ...row,
        lifecycleStatus: eligibility.lifecycleStatus,
        captureEligibility: eligibility.captureEligibility,
        captureStatus: "captured" as const,
        skipReason: "manifest_indicates_capture_extraction_analysis_current",
      };
    }

    if (!row.hasSafeOpenAction && !row.canOpenSafely) {
      return {
        ...row,
        lifecycleStatus: eligibility.lifecycleStatus,
        captureEligibility: eligibility.captureEligibility,
        captureStatus: "failed" as const,
        skipReason: row.skipReason ?? "no_safe_open_action_discovered",
      };
    }

    if (typeof limit === "number" && capturedSoFar >= limit) {
      pendingDueToConfigLimitCount += 1;
      return {
        ...row,
        lifecycleStatus: eligibility.lifecycleStatus,
        captureEligibility: eligibility.captureEligibility,
        captureStatus: "capture_pending_due_to_config_limit" as const,
        skipReason: row.skipReason ?? "VISIT_NOTE_CAPTURE_MAX_NOTES reached",
      };
    }

    capturedSoFar += 1;
    return {
      ...row,
      lifecycleStatus: eligibility.lifecycleStatus,
      captureEligibility: eligibility.captureEligibility,
      captureStatus: "not_attempted" as const,
    };
  });

  return {
    rows,
    eligibleForCapture,
    skippedAdminCount,
    boundedCaptureCount: capturedSoFar,
    alreadySatisfiedCount,
    pendingDueToConfigLimitCount,
    warnings: [
      ...(capturedSoFar > 0
        ? ["Visit-note capture planning is enabled; live document opening is guarded by row-level safe actions."]
        : []),
      ...(pendingDueToConfigLimitCount > 0
        ? [`${pendingDueToConfigLimitCount} eligible visit note(s) remain pending because VISIT_NOTE_CAPTURE_MAX_NOTES was reached.`]
        : []),
    ],
  };
}
