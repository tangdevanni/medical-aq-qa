import path from "node:path";
import { stat } from "node:fs/promises";
import type { WorkbookVerification } from "@medical-ai-qa/shared-types";
import { parseWorkbook } from "../parsers/workbookParser";

export interface VerifyWorkbookFileParams {
  workbookPath: string;
  verifiedAt?: string;
  minimumFileSizeBytes?: number;
}

export async function verifyWorkbookFile(
  params: VerifyWorkbookFileParams,
): Promise<WorkbookVerification> {
  const fileStat = await stat(params.workbookPath);
  const minimumFileSizeBytes = params.minimumFileSizeBytes ?? 1_024;
  if (fileStat.size < minimumFileSizeBytes) {
    throw new Error(
      `Downloaded workbook is too small to trust (${fileStat.size} bytes, expected at least ${minimumFileSizeBytes}).`,
    );
  }

  const parsedWorkbook = parseWorkbook(params.workbookPath);
  if (parsedWorkbook.sheetNames.length === 0) {
    throw new Error("Downloaded workbook did not contain any visible worksheets.");
  }

  const detectedSourceTypes = parsedWorkbook.diagnostics.sourceDetections
    .filter((detection) => detection.detectionStatus === "detected")
    .map((detection) => detection.sourceType);

  if (detectedSourceTypes.length === 0) {
    throw new Error(
      `Downloaded workbook did not contain any recognized QA worksheets. Sheets: ${parsedWorkbook.sheetNames.join(", ")}`,
    );
  }

  return {
    usable: true,
    verifiedAt: params.verifiedAt ?? new Date().toISOString(),
    fileSizeBytes: fileStat.size,
    fileExtension: path.extname(params.workbookPath).toLowerCase() || ".xlsx",
    sheetNames: parsedWorkbook.sheetNames,
    detectedSourceTypes,
    warningCount: parsedWorkbook.warnings.length,
  };
}
