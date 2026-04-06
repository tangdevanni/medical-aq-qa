import type {
  ArtifactRecord,
  DocumentInventoryItem,
  PatientEpisodeWorkItem,
  PatientMatchResult,
  PatientProcessingStatus,
} from "@medical-ai-qa/shared-types";
import type { ExtractedDocument } from "../services/documentExtractionService";
import { evaluateOasisQa } from "../services/oasisQaEvaluator";

export function evaluateDeterministicQa(input: {
  workItem: PatientEpisodeWorkItem;
  matchResult: PatientMatchResult;
  artifacts: ArtifactRecord[];
  processingStatus: PatientProcessingStatus;
  extractedDocuments?: ExtractedDocument[];
  documentInventory?: DocumentInventoryItem[];
}) {
  return evaluateOasisQa(input);
}
