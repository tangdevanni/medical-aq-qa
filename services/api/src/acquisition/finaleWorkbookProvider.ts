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

  async acquire(
    input: FinaleWorkbookRequest,
    context: WorkbookAcquisitionContext,
  ): Promise<WorkbookAcquisitionResult> {
    context.logger.warn(
      {
        batchId: context.batchId,
        billingPeriod: context.billingPeriod,
        exportName: input.exportName ?? null,
      },
      "finale workbook provider scaffold invoked",
    );

    throw new Error(
      "Finale workbook download provider is scaffolded but not implemented for this demo.",
    );
  }
}
