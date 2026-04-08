import path from "node:path";
import { runFinaleBatch } from "../services/batchRunService";

function parseArgs(argv: string[]): {
  workbookPath: string;
  outputDir?: string;
  parseOnly: boolean;
} {
  const positionalArgs: string[] = [];
  let outputDir: string | undefined;
  let parseOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output-dir") {
      outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--parse-only") {
      parseOnly = true;
      continue;
    }

    positionalArgs.push(value);
  }

  const workbookPath = positionalArgs[0];
  if (!workbookPath) {
    throw new Error(
      "Usage: pnpm --filter @medical-ai-qa/finale-workbook-intake dev <workbook.xlsx> [--output-dir <dir>] [--parse-only]",
    );
  }

  return {
    workbookPath: path.resolve(workbookPath),
    outputDir: outputDir ? path.resolve(outputDir) : undefined,
    parseOnly,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runFinaleBatch(args);

  console.log(
    JSON.stringify(
      {
        batchId: result.manifest.batchId,
        manifestPath: result.manifestPath,
        workItemsPath: result.workItemsPath,
        parserExceptionsPath: result.parserExceptionsPath,
        batchSummaryPath: result.batchSummaryPath,
        processedPatients: result.patientRuns.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown batch execution error.");
  process.exitCode = 1;
});
