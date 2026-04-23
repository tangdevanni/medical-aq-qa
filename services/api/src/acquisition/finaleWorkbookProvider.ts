import { exportAgencyWorkbookFromFinale } from "@medical-ai-qa/finale-workbook-intake";
import type { Logger } from "pino";
import type { SubsidiaryConfigService } from "../services/subsidiaryConfigService";
import type {
  WorkbookAcquisitionContext,
  WorkbookAcquisitionProvider,
  WorkbookAcquisitionResult,
} from "./workbookAcquisitionProvider";

export interface FinaleWorkbookRequest {
  exportName?: string | null;
}

export class FinaleWorkbookProvider
  implements WorkbookAcquisitionProvider<FinaleWorkbookRequest>
{
  readonly providerId = "FINALE" as const;

  constructor(
    private readonly subsidiaryConfigService: SubsidiaryConfigService,
    private readonly logger: Logger,
    private readonly exportWorkbook = exportAgencyWorkbookFromFinale,
  ) {}

  async acquire(
    input: FinaleWorkbookRequest,
    context: WorkbookAcquisitionContext,
  ): Promise<WorkbookAcquisitionResult> {
    const runtimeConfig = await this.subsidiaryConfigService.resolveRuntimeConfig(
      context.subsidiaryId,
    );

    context.logger.info(
      {
        batchId: context.batchId,
        subsidiaryId: context.subsidiaryId,
        subsidiarySlug: context.subsidiarySlug,
        subsidiaryName: context.subsidiaryName,
        billingPeriod: context.billingPeriod,
        exportName: input.exportName ?? null,
      },
      "starting Finale workbook acquisition",
    );

    const result = await this.exportWorkbook({
      runtimeConfig,
      destinationPath: context.destinationPath,
      outputDir: context.outputRoot,
      exportName:
        input.exportName ??
        `${context.subsidiarySlug}-oasis-30-days.xlsx`,
      logger: this.logger.child({
        batchId: context.batchId,
        subsidiaryId: context.subsidiaryId,
      }),
    });

    return {
      providerId: this.providerId,
      originalFileName: result.originalFileName,
      storedPath: result.storedPath,
      acquiredAt: result.acquiredAt,
      acquisitionReference: result.acquisitionReference,
      notes: result.notes,
      acquisitionMetadata: result.acquisitionMetadata,
      verification: result.verification,
    };
  }
}
