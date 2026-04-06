import type { Logger } from "pino";
import type { FilesystemBatchRepository } from "../repositories/filesystemBatchRepository";
import type { BatchRecord } from "../types/batchControlPlane";
import type {
  WorkbookAcquisitionProvider,
  WorkbookAcquisitionProviderId,
  WorkbookAcquisitionResult,
} from "./workbookAcquisitionProvider";
import type { ManualUploadWorkbookInput } from "./manualUploadWorkbookProvider";
import type { FinaleWorkbookRequest } from "./finaleWorkbookProvider";

export interface AcquireWorkbookParams {
  batch: BatchRecord;
  billingPeriod?: string | null;
  providerId: WorkbookAcquisitionProviderId;
  input: ManualUploadWorkbookInput | FinaleWorkbookRequest;
}

export class WorkbookAcquisitionService {
  private readonly providers: Map<
    WorkbookAcquisitionProviderId,
    WorkbookAcquisitionProvider<unknown>
  >;

  constructor(
    providers: WorkbookAcquisitionProvider<unknown>[],
    private readonly repository: FilesystemBatchRepository,
    private readonly logger: Logger,
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.providerId, provider]),
    );
  }

  async acquireWorkbook(params: AcquireWorkbookParams): Promise<WorkbookAcquisitionResult> {
    const provider = this.providers.get(params.providerId);
    if (!provider) {
      throw new Error(`Workbook acquisition provider not found: ${params.providerId}`);
    }

    const result = await provider.acquire(params.input, {
      batchId: params.batch.id,
      billingPeriod: params.billingPeriod ?? params.batch.billingPeriod,
      destinationPath: params.batch.sourceWorkbook.storedPath,
      logger: this.logger,
    });

    if (!(await this.repository.fileExists(result.storedPath))) {
      throw new Error(
        `Workbook acquisition provider did not persist a workbook file: ${params.providerId}`,
      );
    }

    return result;
  }
}
