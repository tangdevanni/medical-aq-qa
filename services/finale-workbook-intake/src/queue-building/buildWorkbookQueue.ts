import path from "node:path";
import type {
  WorkbookAcquisitionMetadata,
  PatientEligibilityDecision,
  PatientEpisodeWorkItem,
  PatientQueueArtifact,
  QueueEntry,
  QueueEntryStatus,
  ReviewWindow,
  WorkbookSource,
  WorkbookSourceKind,
  WorkbookVerification,
} from "@medical-ai-qa/shared-types";
import { shouldEvaluatePatient } from "../patient-vetting/shouldEvaluatePatient";

function toQueueEntryStatus(decision: PatientEligibilityDecision): QueueEntryStatus {
  if (decision.eligible) {
    return "eligible";
  }

  if (decision.reason === "non_admit") {
    return "skipped_non_admit";
  }

  if (decision.reason === "pending") {
    return "skipped_pending";
  }

  return "excluded_other";
}

export function createWorkbookSource(input: {
  agencyId: string;
  batchId: string;
  workbookPath: string;
  originalFileName?: string | null;
  acquiredAt: string;
  ingestedAt: string;
  kind?: WorkbookSourceKind;
  acquisition?: WorkbookAcquisitionMetadata | null;
  verification?: WorkbookVerification | null;
}): WorkbookSource {
  const originalFileName = input.originalFileName?.trim() || path.basename(input.workbookPath);
  return {
    agencyId: input.agencyId,
    batchId: input.batchId,
    kind: input.kind ?? "unknown",
    path: input.workbookPath,
    originalFileName,
    sourceLabel: originalFileName,
    acquiredAt: input.acquiredAt,
    ingestedAt: input.ingestedAt,
    acquisition: input.acquisition ?? {
      providerId: null,
      acquisitionReference: null,
      metadataPath: null,
      selectedAgencyName: null,
      selectedAgencyUrl: null,
      dashboardUrl: null,
      notes: [],
    },
    verification: input.verification ?? null,
  };
}

export function buildWorkbookQueue(input: {
  batchId: string;
  agencyId: string;
  generatedAt: string;
  workItems: PatientEpisodeWorkItem[];
  reviewWindow: ReviewWindow;
}): PatientQueueArtifact {
  const entries: QueueEntry[] = input.workItems.map((workItem) => {
    const eligibility = shouldEvaluatePatient(workItem);
    const status = toQueueEntryStatus(eligibility);
    return {
      id: `${input.reviewWindow.id}:${workItem.id}`,
      agencyId: input.agencyId,
      batchId: input.batchId,
      workItemId: workItem.id,
      patientName: workItem.patientIdentity.displayName,
      reviewWindowId: input.reviewWindow.id,
      workflowTypes: workItem.workflowTypes,
      status,
      eligibility,
      episodeDate: workItem.episodeContext.episodeDate,
      socDate: workItem.episodeContext.socDate,
      billingPeriod: workItem.episodeContext.billingPeriod,
      sourceSheets: workItem.sourceSheets,
      sourceRowNumbers: workItem.sourceRowReferences.map((reference) => reference.sourceRowNumber),
      notes: [...workItem.importWarnings],
      createdAt: input.generatedAt,
    };
  });

  return {
    generatedAt: input.generatedAt,
    agencyId: input.agencyId,
    batchId: input.batchId,
    reviewWindowId: input.reviewWindow.id,
    summary: {
      total: entries.length,
      eligible: entries.filter((entry) => entry.status === "eligible").length,
      skippedNonAdmit: entries.filter((entry) => entry.status === "skipped_non_admit").length,
      skippedPending: entries.filter((entry) => entry.status === "skipped_pending").length,
      excludedOther: entries.filter((entry) => entry.status === "excluded_other").length,
    },
    entries,
  };
}
