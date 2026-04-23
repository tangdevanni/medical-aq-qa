import { createHash } from "node:crypto";
import type {
  ParserException,
  PatientEpisodeWorkItem,
  SourceValueSnapshot,
} from "@medical-ai-qa/shared-types";
import { mergeStageStatus } from "../domain/stageStatus";
import type {
  AggregationResult,
  MappedEpisodeFragment,
} from "../types/patientEpisodeWorkItem";
import { createEpisodeKey } from "../utils/dateMath";

function normalizeToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function mergeNullableString(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  return left ?? right ?? null;
}

function mergeSourceValues(
  left: SourceValueSnapshot[],
  right: SourceValueSnapshot[],
): SourceValueSnapshot[] {
  return [...left, ...right];
}

function mergeImportWarnings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function mergeWorkflowTypes(
  left: PatientEpisodeWorkItem["workflowTypes"],
  right: MappedEpisodeFragment["workflowTypes"],
): PatientEpisodeWorkItem["workflowTypes"] {
  return Array.from(new Set([...left, ...right]));
}

function mergeSourceSheets(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).sort((a, b) => a.localeCompare(b));
}

function createStableWorkItemId(item: PatientEpisodeWorkItem): string {
  const compositeKey = [
    item.patientIdentity.normalizedName,
    createEpisodeKey(item.episodeContext),
    normalizeToken(item.episodeContext.payer) ?? "NO_PAYER",
    normalizeToken(item.patientIdentity.medicareNumber) ?? "NO_MEDICARE",
    normalizeToken(item.episodeContext.rfa) ?? "NO_RFA",
  ].join("|");

  const displayKey = item.patientIdentity.normalizedName.replace(/[^A-Z0-9]+/g, "_");
  const hash = createHash("sha1").update(compositeKey).digest("hex").slice(0, 16);
  return `${displayKey}__${hash}`;
}

function createParserException(
  code: string,
  message: string,
  fragment: MappedEpisodeFragment,
): ParserException {
  const firstSource = fragment.sourceValues[0] ?? {
    sourceSheet: fragment.sourceRowReferences[0]?.sourceSheet ?? "UNKNOWN",
    sourceRowNumber: fragment.sourceRowReferences[0]?.sourceRowNumber ?? 1,
    values: {},
  };

  const identityKey = [
    fragment.patientDisplayName,
    firstSource.sourceSheet,
    firstSource.sourceRowNumber,
    code,
  ].join("|");

  return {
    id: createHash("sha1").update(identityKey).digest("hex").slice(0, 16),
    code,
    message,
    sourceSheet: firstSource.sourceSheet,
    sourceRowNumber: firstSource.sourceRowNumber,
    patientDisplayName: fragment.patientDisplayName ?? null,
    rawValues: firstSource.values,
    createdAt: new Date().toISOString(),
  };
}

function hasMissingIdentity(fragment: MappedEpisodeFragment): boolean {
  return fragment.patientNormalizedName === "UNKNOWN PATIENT";
}

function hasMissingEpisodeContext(fragment: MappedEpisodeFragment): boolean {
  return fragment.episodeKey === "UNSPECIFIED_EPISODE";
}

function isSameBaseEpisode(
  item: PatientEpisodeWorkItem,
  fragment: MappedEpisodeFragment,
): boolean {
  return (
    item.patientIdentity.normalizedName === fragment.patientNormalizedName &&
    createEpisodeKey(item.episodeContext) === fragment.episodeKey
  );
}

function isIdentityCompatible(
  item: PatientEpisodeWorkItem,
  fragment: MappedEpisodeFragment,
): boolean {
  const itemMedicare = normalizeToken(item.patientIdentity.medicareNumber);
  const fragmentMedicare = normalizeToken(fragment.medicareNumber);
  if (itemMedicare && fragmentMedicare && itemMedicare !== fragmentMedicare) {
    return false;
  }

  const itemPayer = normalizeToken(item.episodeContext.payer);
  const fragmentPayer = normalizeToken(fragment.episodeContext.payer);
  if (itemPayer && fragmentPayer && itemPayer !== fragmentPayer) {
    return false;
  }

  return true;
}

function createWorkItem(fragment: MappedEpisodeFragment): PatientEpisodeWorkItem {
  const item: PatientEpisodeWorkItem = {
    id: "pending",
    subsidiaryId: "default",
    patientIdentity: {
      displayName: fragment.patientDisplayName,
      normalizedName: fragment.patientNormalizedName,
      medicareNumber: fragment.medicareNumber,
    },
    episodeContext: {
      episodeDate: fragment.episodeContext.episodeDate ?? null,
      socDate: fragment.episodeContext.socDate ?? null,
      episodePeriod: fragment.episodeContext.episodePeriod ?? null,
      billingPeriod: fragment.episodeContext.billingPeriod ?? null,
      payer: fragment.episodeContext.payer ?? null,
      assignedStaff: fragment.episodeContext.assignedStaff ?? null,
      clinician: fragment.episodeContext.clinician ?? null,
      qaSpecialist: fragment.episodeContext.qaSpecialist ?? null,
      rfa: fragment.episodeContext.rfa ?? null,
    },
    workflowTypes: [...fragment.workflowTypes],
    sourceSheets: fragment.sourceValues.map((snapshot) => snapshot.sourceSheet),
    timingMetadata: fragment.timingMetadata
      ? {
          trackingDays: fragment.timingMetadata.trackingDays,
          daysInPeriod: fragment.timingMetadata.daysInPeriod,
          daysLeft: fragment.timingMetadata.daysLeft,
          daysLeftBeforeOasisDueDate: fragment.timingMetadata.daysLeftBeforeOasisDueDate,
          rawTrackingValues: [...fragment.timingMetadata.rawTrackingValues],
          rawDaysInPeriodValues: [...fragment.timingMetadata.rawDaysInPeriodValues],
          rawDaysLeftValues: [...fragment.timingMetadata.rawDaysLeftValues],
        }
      : undefined,
    codingReviewStatus: fragment.stageStatuses.codingReviewStatus ?? "NOT_STARTED",
    oasisQaStatus: fragment.stageStatuses.oasisQaStatus ?? "NOT_STARTED",
    pocQaStatus: fragment.stageStatuses.pocQaStatus ?? "NOT_STARTED",
    visitNotesQaStatus: fragment.stageStatuses.visitNotesQaStatus ?? "NOT_STARTED",
    billingPrepStatus: fragment.stageStatuses.billingPrepStatus ?? "NOT_STARTED",
    sourceRemarks: [...fragment.sourceRemarks],
    sourceRowReferences: [...fragment.sourceRowReferences],
    sourceValues: [...fragment.sourceValues],
    importWarnings: [...fragment.importWarnings],
  };

  item.id = createStableWorkItemId(item);
  item.sourceSheets = mergeSourceSheets([], item.sourceSheets);
  return item;
}

function applyFragment(
  target: PatientEpisodeWorkItem,
  fragment: MappedEpisodeFragment,
): void {
  target.patientIdentity = {
    displayName: target.patientIdentity.displayName || fragment.patientDisplayName,
    normalizedName: target.patientIdentity.normalizedName || fragment.patientNormalizedName,
    medicareNumber: mergeNullableString(
      target.patientIdentity.medicareNumber,
      fragment.medicareNumber,
    ),
  };

  target.episodeContext = {
    episodeDate: mergeNullableString(
      target.episodeContext.episodeDate,
      fragment.episodeContext.episodeDate,
    ),
    socDate: mergeNullableString(
      target.episodeContext.socDate,
      fragment.episodeContext.socDate,
    ),
    episodePeriod: mergeNullableString(
      target.episodeContext.episodePeriod,
      fragment.episodeContext.episodePeriod,
    ),
    billingPeriod: mergeNullableString(
      target.episodeContext.billingPeriod,
      fragment.episodeContext.billingPeriod,
    ),
    payer: mergeNullableString(target.episodeContext.payer, fragment.episodeContext.payer),
    assignedStaff: mergeNullableString(
      target.episodeContext.assignedStaff,
      fragment.episodeContext.assignedStaff,
    ),
    clinician: mergeNullableString(
      target.episodeContext.clinician,
      fragment.episodeContext.clinician,
    ),
    qaSpecialist: mergeNullableString(
      target.episodeContext.qaSpecialist,
      fragment.episodeContext.qaSpecialist,
    ),
    rfa: mergeNullableString(target.episodeContext.rfa, fragment.episodeContext.rfa),
  };

  target.workflowTypes = mergeWorkflowTypes(target.workflowTypes, fragment.workflowTypes);
  target.sourceSheets = mergeSourceSheets(
    target.sourceSheets,
    fragment.sourceValues.map((snapshot) => snapshot.sourceSheet),
  );
  target.timingMetadata = {
    trackingDays:
      target.timingMetadata?.trackingDays ?? fragment.timingMetadata?.trackingDays ?? null,
    daysInPeriod:
      target.timingMetadata?.daysInPeriod ?? fragment.timingMetadata?.daysInPeriod ?? null,
    daysLeft:
      target.timingMetadata?.daysLeft ?? fragment.timingMetadata?.daysLeft ?? null,
    daysLeftBeforeOasisDueDate:
      target.timingMetadata?.daysLeftBeforeOasisDueDate ??
      fragment.timingMetadata?.daysLeftBeforeOasisDueDate ??
      fragment.timingMetadata?.daysLeft ??
      null,
    rawTrackingValues: Array.from(
      new Set([
        ...(target.timingMetadata?.rawTrackingValues ?? []),
        ...(fragment.timingMetadata?.rawTrackingValues ?? []),
      ]),
    ),
    rawDaysInPeriodValues: Array.from(
      new Set([
        ...(target.timingMetadata?.rawDaysInPeriodValues ?? []),
        ...(fragment.timingMetadata?.rawDaysInPeriodValues ?? []),
      ]),
    ),
    rawDaysLeftValues: Array.from(
      new Set([
        ...(target.timingMetadata?.rawDaysLeftValues ?? []),
        ...(fragment.timingMetadata?.rawDaysLeftValues ?? []),
      ]),
    ),
  };
  target.codingReviewStatus = fragment.stageStatuses.codingReviewStatus
    ? mergeStageStatus(target.codingReviewStatus, fragment.stageStatuses.codingReviewStatus)
    : target.codingReviewStatus;
  target.oasisQaStatus = fragment.stageStatuses.oasisQaStatus
    ? mergeStageStatus(target.oasisQaStatus, fragment.stageStatuses.oasisQaStatus)
    : target.oasisQaStatus;
  target.pocQaStatus = fragment.stageStatuses.pocQaStatus
    ? mergeStageStatus(target.pocQaStatus, fragment.stageStatuses.pocQaStatus)
    : target.pocQaStatus;
  target.visitNotesQaStatus = fragment.stageStatuses.visitNotesQaStatus
    ? mergeStageStatus(target.visitNotesQaStatus, fragment.stageStatuses.visitNotesQaStatus)
    : target.visitNotesQaStatus;
  target.billingPrepStatus = fragment.stageStatuses.billingPrepStatus
    ? mergeStageStatus(target.billingPrepStatus, fragment.stageStatuses.billingPrepStatus)
    : target.billingPrepStatus;
  target.sourceRemarks = [...target.sourceRemarks, ...fragment.sourceRemarks];
  target.sourceRowReferences = [...target.sourceRowReferences, ...fragment.sourceRowReferences];
  target.sourceValues = mergeSourceValues(target.sourceValues, fragment.sourceValues);
  target.importWarnings = mergeImportWarnings(target.importWarnings, fragment.importWarnings);
  target.id = createStableWorkItemId(target);
}

export function aggregatePatientEpisodes(
  fragments: MappedEpisodeFragment[],
): AggregationResult {
  const workItems: PatientEpisodeWorkItem[] = [];
  const parserExceptions: ParserException[] = [];

  fragments.forEach((fragment) => {
    if (hasMissingIdentity(fragment)) {
      parserExceptions.push(
        createParserException(
          "MISSING_PATIENT_NAME",
          "Row did not contain a valid patient name and was excluded from the batch.",
          fragment,
        ),
      );
      return;
    }

    if (hasMissingEpisodeContext(fragment)) {
      parserExceptions.push(
        createParserException(
          "MISSING_EPISODE_CONTEXT",
          "Row did not contain sufficient episode or billing context and was excluded from the batch.",
          fragment,
        ),
      );
      return;
    }

    const baseMatch = workItems.find((item) => isSameBaseEpisode(item, fragment));
    if (baseMatch && !isIdentityCompatible(baseMatch, fragment)) {
      parserExceptions.push(
        createParserException(
          "AMBIGUOUS_PATIENT_IDENTITY",
          "Rows for the same normalized patient/episode disagreed on payer or Medicare identity and were not merged.",
          fragment,
        ),
      );
      return;
    }

    if (!baseMatch) {
      workItems.push(createWorkItem(fragment));
      return;
    }

    applyFragment(baseMatch, fragment);
  });

  return {
    workItems: workItems.sort((left, right) =>
      left.patientIdentity.displayName.localeCompare(right.patientIdentity.displayName),
    ),
    parserExceptions,
  };
}
