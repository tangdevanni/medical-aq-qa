import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type QueueQaRunReport } from "../types/queueQaPipeline";
import { sanitizeDocumentText } from "../extractors/shared/sanitizeText";

export async function exportJsonReport(
  report: QueueQaRunReport,
  outputPath: string,
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const sanitized = sanitizeQueueQaReportForExport(report);
  await writeFile(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return outputPath;
}

export function sanitizeQueueQaReportForExport(report: QueueQaRunReport): QueueQaRunReport {
  return {
    ...report,
    results: report.results.map((result) => sanitizeResultForExport(result)),
  };
}

function sanitizeResultForExport(result: QueueQaRunReport["results"][number]): QueueQaRunReport["results"][number] {
  if (result.status !== "PROCESSED") {
    return {
      ...result,
      documentExtraction: result.documentExtraction
        ? {
            ...result.documentExtraction,
            sections: result.documentExtraction.sections.map((section) => ({
              ...section,
              sample: null,
            })),
          }
        : undefined,
      writeExecutionResult: result.writeExecutionResult
        ? sanitizeWriteExecutionResult(result.writeExecutionResult)
        : undefined,
    };
  }

  return {
    ...result,
    documentExtraction: {
      ...result.documentExtraction,
      sections: result.documentExtraction.sections.map((section) => ({
        ...section,
        sample: null,
      })),
    },
    qaResult: result.qaResult
      ? {
          ...result.qaResult,
          sections: result.qaResult.sections.map((section) => ({
            ...section,
            sample: null,
          })),
        }
      : null,
    writeExecutionResult: sanitizeWriteExecutionResult(result.writeExecutionResult),
  };
}

function sanitizeWriteExecutionResult(
  result: NonNullable<QueueQaRunReport["results"][number]["writeExecutionResult"]>,
): NonNullable<QueueQaRunReport["results"][number]["writeExecutionResult"]> {
  return {
    ...result,
    results: result.results.map((attempt) => ({
      ...attempt,
      previousValue: sanitizeDocumentText(attempt.previousValue, 48),
      proposedValue: sanitizeDocumentText(attempt.proposedValue, 48),
      finalValue: sanitizeDocumentText(attempt.finalValue, 48),
    })),
  };
}
