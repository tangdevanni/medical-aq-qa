import type { Logger } from "pino";

export type WorkbookAcquisitionProviderId = "MANUAL_UPLOAD" | "FINALE";

export interface WorkbookAcquisitionContext {
  batchId: string;
  billingPeriod?: string | null;
  destinationPath: string;
  logger: Logger;
}

export interface WorkbookAcquisitionResult {
  providerId: WorkbookAcquisitionProviderId;
  originalFileName: string;
  storedPath: string;
  acquiredAt: string;
  acquisitionReference: string | null;
  notes: string[];
}

export interface WorkbookAcquisitionProvider<TInput> {
  readonly providerId: WorkbookAcquisitionProviderId;
  acquire(
    input: TInput,
    context: WorkbookAcquisitionContext,
  ): Promise<WorkbookAcquisitionResult>;
}
