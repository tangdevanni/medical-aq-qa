import path from "node:path";
import { runOasisDemoHarness } from "./oasisDemoHarness";

function parseArgs(argv: string[]): {
  outputDir: string;
  workbookPath?: string;
  patient?: string;
  limit?: number;
  all: boolean;
  live: boolean;
} {
  let outputDir: string | null = null;
  let workbookPath: string | undefined;
  let patient: string | undefined;
  let limit: number | undefined;
  let all = false;
  let live = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output-dir") {
      outputDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--workbook") {
      workbookPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--patient") {
      patient = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--limit") {
      const rawLimit = argv[index + 1];
      index += 1;
      if (!rawLimit) {
        throw new Error("Missing value for --limit.");
      }

      const parsedLimit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new Error(`Invalid --limit value '${rawLimit}'. Expected a positive integer.`);
      }

      limit = parsedLimit;
      continue;
    }

    if (value === "--all") {
      all = true;
      continue;
    }

    if (value === "--live") {
      live = true;
      continue;
    }
  }

  const defaultOutputDir = path.resolve(
    process.cwd(),
    "artifacts",
    "demo",
    `oasis-qa-demo-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );

  return {
    outputDir: path.resolve(outputDir ?? defaultOutputDir),
    workbookPath: workbookPath ? path.resolve(workbookPath) : undefined,
    patient: patient?.trim() ? patient.trim() : undefined,
    limit,
    all,
    live,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runOasisDemoHarness({
    outputDir: args.outputDir,
    workbookPath: args.workbookPath,
    patient: args.patient,
    limit: args.limit,
    all: args.all,
    live: args.live,
  });

  console.log(
    JSON.stringify(
      {
        outputDir: result.outputDir,
        workbookPath: result.workbookPath,
        demoSummaryJsonPath: result.demoSummaryJsonPath,
        demoSummaryMarkdownPath: result.demoSummaryMarkdownPath,
        liveMode: result.liveMode,
        selectionReason: result.selectionReason,
        selectedPatientCount: result.selectedPatientCount,
        availablePatientCount: result.availablePatientCount,
        eligiblePatientCount: result.eligiblePatientCount,
        parserExceptionCount: result.parserExceptionCount,
        patientName: result.demoSummary.patientName,
        urgency: result.demoSummary.urgency,
        overallStatus: result.demoSummary.overallStatus,
        blockerCount: result.demoSummary.blockerCount,
        safetyMode: result.demoSummary.safety.safetyMode,
        dangerousWriteAttemptBlocked: result.demoSummary.safety.dangerousWriteAttemptBlocked,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown oasis demo harness error.");
  process.exitCode = 1;
});
