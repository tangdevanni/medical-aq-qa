import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type QueueQaRunReport } from "../types/queueQaPipeline";
import { sanitizeQueueQaReportForExport } from "./exportJsonReport";

const CSV_HEADERS = [
  "pageNumber",
  "rowIndex",
  "rowFingerprint",
  "status",
  "isTarget",
  "confidence",
  "classificationReason",
  "documentDesc",
  "type",
  "date",
  "documentType",
  "openedUrl",
  "openedInNewTab",
  "documentKind",
  "documentPageType",
  "crossDocMismatchCount",
  "crossDocAlignmentCount",
  "crossDocWarningCount",
  "decisionCount",
  "actionableDecisionCount",
  "reviewOnlyDecisionCount",
  "safeAutofixCandidateCount",
  "writeAttemptCount",
  "writeVerifiedCount",
  "writeBlockedCount",
  "writeFailureCount",
  "qaOverallStatus",
  "skipReason",
  "errorCode",
  "errorRecoverable",
  "errorMessage",
] as const;

export async function exportCsvReport(
  report: QueueQaRunReport,
  outputPath: string,
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const sanitized = sanitizeQueueQaReportForExport(report);
  const lines = [
    CSV_HEADERS.join(","),
    ...sanitized.results.map((result) => {
      const values = [
        String(result.queueContext.pageNumber),
        String(result.rowIndex),
        result.rowFingerprint,
        result.status,
        String(result.classification.isTarget),
        result.classification.confidence,
        result.classification.reason,
        result.queueContext.documentDesc ?? "",
        result.queueContext.type ?? "",
        result.queueContext.date ?? "",
        result.queueContext.documentType,
        result.openResult?.openedUrl ?? "",
        String(result.openResult?.openedInNewTab ?? false),
        result.documentExtraction?.documentKind ?? "",
        result.documentExtraction?.pageType ?? "",
        String(result.crossDocumentQa?.mismatches.length ?? 0),
        String(result.crossDocumentQa?.alignments.length ?? 0),
        String(result.crossDocumentQa?.warnings.length ?? 0),
        String(result.decisionResult?.decisions.length ?? 0),
        String(result.decisionResult?.summary.actionableCount ?? 0),
        String(result.decisionResult?.summary.reviewOnlyCount ?? 0),
        String(result.decisionResult?.summary.safeAutofixCandidateCount ?? 0),
        String(result.writeExecutionResult?.summary.writeAttempts ?? 0),
        String(result.writeExecutionResult?.summary.writesVerified ?? 0),
        String(result.writeExecutionResult?.summary.writesBlocked ?? 0),
        String(result.writeExecutionResult?.summary.writeFailures ?? 0),
        result.status === "PROCESSED" && result.qaResult ? result.qaResult.summary.overallStatus : "",
        result.status === "SKIPPED" ? result.skipReason : "",
        result.status === "ERROR" ? result.error.code : "",
        result.status === "ERROR" ? String(result.error.recoverable) : "",
        result.status === "ERROR" ? result.error.message : "",
      ];

      return values.map(escapeCsvValue).join(",");
    }),
  ];

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  return outputPath;
}

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}
