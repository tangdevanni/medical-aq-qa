import type { Logger } from "pino";
import type {
  WorkbookAcquisitionMetadata,
  WorkbookVerification,
} from "@medical-ai-qa/shared-types";

export type WorkbookAcquisitionProviderId = "MANUAL_UPLOAD" | "FINALE";

export interface WorkbookAcquisitionContext {
  batchId: string;
  subsidiaryId: string;
  subsidiarySlug: string;
  subsidiaryName: string;
  billingPeriod?: string | null;
  destinationPath: string;
  batchRoot: string;
  outputRoot: string;
  logger: Logger;
}

export interface WorkbookAcquisitionResult {
  providerId: WorkbookAcquisitionProviderId;
  originalFileName: string;
  storedPath: string;
  acquiredAt: string;
  acquisitionReference: string | null;
  notes: string[];
  acquisitionMetadata?: WorkbookAcquisitionMetadata | null;
  verification?: WorkbookVerification | null;
}

export interface WorkbookAcquisitionProvider<TInput> {
  readonly providerId: WorkbookAcquisitionProviderId;
  acquire(
    input: TInput,
    context: WorkbookAcquisitionContext,
  ): Promise<WorkbookAcquisitionResult>;
}
