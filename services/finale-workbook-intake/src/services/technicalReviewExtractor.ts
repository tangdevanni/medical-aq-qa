import type { ArtifactRecord, DocumentInventoryItem } from "@medical-ai-qa/shared-types";
import type { ExtractedDocument } from "./documentExtractionService";
import { extractVisitNoteFields } from "./visitNoteExtractor";

export type TechnicalReviewExtract = {
  snVisitCount: number;
  disciplines: Array<"PT" | "OT" | "ST" | "HHA" | "RD" | "MSW">;
  physicianOrders: boolean;
  summaries: boolean;
  supervisoryVisits: boolean;
  communicationNotes: boolean;
  missedVisits: boolean;
  infectionOrFallReports: boolean;
  orderCount: number;
  summaryCount: number;
  supervisoryCount: number;
  communicationCount: number;
  missedVisitCount: number;
  evidence: Record<
    | "snVisitCount"
    | "disciplines"
    | "physicianOrders"
    | "summaries"
    | "supervisoryVisits"
    | "communicationNotes"
    | "missedVisits"
    | "infectionOrFallReports"
    | "orderCount"
    | "summaryCount"
    | "supervisoryCount"
    | "communicationCount"
    | "missedVisitCount",
    string[]
  >;
};

function hasArtifact(artifacts: ArtifactRecord[], artifactType: ArtifactRecord["artifactType"]): boolean {
  return artifacts.some(
    (artifact) =>
      artifact.artifactType === artifactType &&
      (artifact.status === "FOUND" || artifact.status === "DOWNLOADED"),
  );
}

function countInventoryByType(
  inventory: DocumentInventoryItem[],
  normalizedTypes: readonly DocumentInventoryItem["normalizedType"][],
): number {
  return inventory.filter((item) => normalizedTypes.includes(item.normalizedType)).length;
}

export function extractTechnicalReview(
  artifacts: ArtifactRecord[],
  documents: ExtractedDocument[],
  inventory: DocumentInventoryItem[] = [],
): TechnicalReviewExtract {
  const visitNoteExtract = extractVisitNoteFields(documents);
  const orderCount = countInventoryByType(inventory, ["ORDER"]);
  const summaryCount = countInventoryByType(inventory, ["SUMMARY_30", "SUMMARY_60", "DC_SUMMARY"]);
  const supervisoryCount = countInventoryByType(inventory, ["SUPERVISORY"]);
  const communicationCount = countInventoryByType(inventory, ["COMMUNICATION"]);
  const missedVisitCount = countInventoryByType(inventory, ["MISSED_VISIT"]);

  return {
    snVisitCount: visitNoteExtract.snVisitCount,
    disciplines: visitNoteExtract.disciplines,
    physicianOrders: hasArtifact(artifacts, "PHYSICIAN_ORDERS"),
    summaries: hasArtifact(artifacts, "THIRTY_SIXTY_DAY_SUMMARIES") || hasArtifact(artifacts, "DISCHARGE_SUMMARY"),
    supervisoryVisits: hasArtifact(artifacts, "SUPERVISORY_VISITS"),
    communicationNotes: hasArtifact(artifacts, "COMMUNICATION_NOTES"),
    missedVisits: hasArtifact(artifacts, "MISSED_VISITS"),
    infectionOrFallReports: hasArtifact(artifacts, "INFECTION_AND_FALL_REPORTS"),
    orderCount,
    summaryCount,
    supervisoryCount,
    communicationCount,
    missedVisitCount,
    evidence: {
      snVisitCount:
        visitNoteExtract.snVisitCount > 0
          ? [`Detected ${visitNoteExtract.snVisitCount} SN visit reference(s) in visit notes.`]
          : [],
      disciplines:
        visitNoteExtract.disciplines.length > 0
          ? visitNoteExtract.disciplines.map((discipline) => `Detected ${discipline} in visit-note content.`)
          : [],
      physicianOrders: hasArtifact(artifacts, "PHYSICIAN_ORDERS") ? ["Physician orders artifact discovered."] : [],
      summaries:
        hasArtifact(artifacts, "THIRTY_SIXTY_DAY_SUMMARIES") || hasArtifact(artifacts, "DISCHARGE_SUMMARY")
          ? ["Summary artifact discovered."]
          : [],
      supervisoryVisits: hasArtifact(artifacts, "SUPERVISORY_VISITS") ? ["Supervisory visit artifact discovered."] : [],
      communicationNotes: hasArtifact(artifacts, "COMMUNICATION_NOTES") ? ["Communication notes artifact discovered."] : [],
      missedVisits: hasArtifact(artifacts, "MISSED_VISITS") ? ["Missed visits artifact discovered."] : [],
      infectionOrFallReports:
        hasArtifact(artifacts, "INFECTION_AND_FALL_REPORTS") ? ["Infection or fall report artifact discovered."] : [],
      orderCount: orderCount > 0 ? [`Detected ${orderCount} order document candidate(s).`] : [],
      summaryCount: summaryCount > 0 ? [`Detected ${summaryCount} summary document candidate(s).`] : [],
      supervisoryCount: supervisoryCount > 0 ? [`Detected ${supervisoryCount} supervisory document candidate(s).`] : [],
      communicationCount: communicationCount > 0 ? [`Detected ${communicationCount} communication document candidate(s).`] : [],
      missedVisitCount: missedVisitCount > 0 ? [`Detected ${missedVisitCount} missed-visit document candidate(s).`] : [],
    },
  };
}
