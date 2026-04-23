import type {
  WorkbookAcquisitionContext,
  WorkbookAcquisitionProvider,
  WorkbookAcquisitionResult,
} from "./workbookAcquisitionProvider";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ManualUploadWorkbookInput {
  fileName: string;
  fileBuffer: Buffer;
}

export class ManualUploadWorkbookProvider
  implements WorkbookAcquisitionProvider<ManualUploadWorkbookInput>
{
  readonly providerId = "MANUAL_UPLOAD" as const;

  async acquire(
    input: ManualUploadWorkbookInput,
    context: WorkbookAcquisitionContext,
  ): Promise<WorkbookAcquisitionResult> {
    await mkdir(path.dirname(context.destinationPath), { recursive: true });
    await writeFile(context.destinationPath, input.fileBuffer);

    return {
      providerId: this.providerId,
      originalFileName: path.basename(input.fileName),
      storedPath: context.destinationPath,
      acquiredAt: new Date().toISOString(),
      acquisitionReference: null,
      notes: ["Workbook acquired from manual upload."],
    };
  }
}
