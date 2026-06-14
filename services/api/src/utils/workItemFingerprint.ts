import { createHash } from "node:crypto";
import type { PatientEpisodeWorkItem } from "@medical-ai-qa/shared-types";

export const WORK_ITEM_FINGERPRINT_SCHEMA_VERSION = "work-item-fingerprint.v1";

export type WorkItemFingerprint = {
  schemaVersion: typeof WORK_ITEM_FINGERPRINT_SCHEMA_VERSION;
  hash: string;
  componentHashes: {
    identity: string;
    referral: string;
    oasis: string;
    planOfCare: string;
  };
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) =>
          ![
            "id",
            "sourceRowNumber",
            "sourceRowNumbers",
            "workbookPath",
            "outputDirectory",
            "batchId",
            "runId",
            "createdAt",
            "updatedAt",
            "generatedAt",
          ].includes(key),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  if (typeof value === "string") {
    return value.trim().replace(/\s+/g, " ").toUpperCase();
  }
  return value ?? null;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}

export function buildWorkItemFingerprint(workItem: PatientEpisodeWorkItem): WorkItemFingerprint {
  const identityInput = {
    subsidiaryId: workItem.subsidiaryId,
    patientIdentity: workItem.patientIdentity,
    episodeDate: workItem.episodeContext.episodeDate,
    socDate: workItem.episodeContext.socDate,
    episodePeriod: workItem.episodeContext.episodePeriod,
    billingPeriod: workItem.episodeContext.billingPeriod,
  };
  const referralInput = {
    identity: identityInput,
    payer: workItem.episodeContext.payer,
    assignedStaff: workItem.episodeContext.assignedStaff,
    clinician: workItem.episodeContext.clinician,
    qaSpecialist: workItem.episodeContext.qaSpecialist,
    codingReviewStatus: workItem.codingReviewStatus,
    billingPrepStatus: workItem.billingPrepStatus,
    workflowTypes: workItem.workflowTypes,
    sourceRemarks: workItem.sourceRemarks,
    sourceValues: workItem.sourceValues.map((sourceValue) => sourceValue.values),
  };
  const oasisInput = {
    identity: identityInput,
    rfa: workItem.episodeContext.rfa,
    workflowTypes: workItem.workflowTypes,
    oasisQaStatus: workItem.oasisQaStatus,
    timingMetadata: workItem.timingMetadata ?? null,
    sourceSheets: workItem.sourceSheets,
    sourceRemarks: workItem.sourceRemarks.filter((remark) =>
      remark.workflowTypes.some((workflowType) =>
        ["SOC", "ROC", "RECERT", "DC", "TRANSFER", "DEATH"].includes(workflowType),
      ),
    ),
    sourceValues: workItem.sourceValues.map((sourceValue) => sourceValue.values),
  };
  const planOfCareInput = {
    identity: identityInput,
    workflowTypes: workItem.workflowTypes.filter((workflowType) =>
      ["SOC", "ROC", "RECERT", "VISIT_NOTES"].includes(workflowType),
    ),
    pocQaStatus: workItem.pocQaStatus,
    visitNotesQaStatus: workItem.visitNotesQaStatus,
    sourceRemarks: workItem.sourceRemarks.filter((remark) =>
      remark.workflowTypes.some((workflowType) =>
        ["SOC", "ROC", "RECERT", "VISIT_NOTES"].includes(workflowType),
      ),
    ),
    sourceValues: workItem.sourceValues.map((sourceValue) => sourceValue.values),
  };
  const componentHashes = {
    identity: hash(identityInput),
    referral: hash(referralInput),
    oasis: hash(oasisInput),
    planOfCare: hash(planOfCareInput),
  };
  return {
    schemaVersion: WORK_ITEM_FINGERPRINT_SCHEMA_VERSION,
    hash: hash(componentHashes),
    componentHashes,
  };
}
