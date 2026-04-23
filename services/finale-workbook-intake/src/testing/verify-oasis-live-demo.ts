import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv: string[]): { outputDir: string } {
  const positionalArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output-dir") {
      const outputDir = argv[index + 1];
      if (!outputDir) {
        throw new Error("Missing value for --output-dir.");
      }

      return {
        outputDir: path.resolve(outputDir),
      };
    }

    positionalArgs.push(value);
  }

  if (!positionalArgs[0]) {
    throw new Error(
      "Usage: pnpm verify:oasis-demo-live -- <output-dir> or pnpm verify:oasis-demo-live -- --output-dir <dir>",
    );
  }

  return {
    outputDir: path.resolve(positionalArgs[0]),
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const demoSummaryPath = path.join(args.outputDir, "demo-summary.json");
  const demoSummary = await readJson<any>(demoSummaryPath);
  const patientResultPath = path.join(args.outputDir, "run", "patient-results", `${demoSummary.workItemId}.json`);
  const patientResult = await readJson<any>(patientResultPath);

  assert.equal(demoSummary.liveMode, true, "demo-summary.json must indicate liveMode=true.");
  assert.ok(
    String(demoSummary.workbookPath).endsWith(path.join("services", "finale-workbook-intake", "finale-export.xlsx")),
    "Live demo must use services/finale-workbook-intake/finale-export.xlsx.",
  );
  assert.equal(demoSummary.safety.safetyMode, "READ_ONLY", "Safety mode must remain READ_ONLY.");
  assert.equal(
    demoSummary.safety.dangerousWriteAttemptBlocked,
    true,
    "Dangerous write enforcement must be confirmed.",
  );
  assert.ok(demoSummary.selectedPatientCount >= 1, "At least one patient must be selected.");
  assert.ok(
    ["SUCCESS", "FAILED"].includes(demoSummary.portal.loginStatus),
    "Live demo must attempt portal login.",
  );
  assert.ok(
    ["EXACT", "AMBIGUOUS", "NOT_FOUND", "ERROR"].includes(demoSummary.patientMatchStatus),
    "Patient match status must be captured.",
  );
  assert.ok(patientResult.automationStepLogs.length > 0, "Patient result must include step logs.");
  assert.ok(
    patientResult.automationStepLogs.some((log: any) => log.step === "patient_search"),
    "Patient result must include a patient_search step.",
  );
  assert.ok(
    patientResult.automationStepLogs.every((log: any) => log.safeReadConfirmed === true),
    "All automation steps must confirm safe read behavior.",
  );

  console.log(
    JSON.stringify(
      {
        verified: true,
        outputDir: args.outputDir,
        workbookPath: demoSummary.workbookPath,
        liveMode: demoSummary.liveMode,
        patientName: demoSummary.patientName,
        patientMatchStatus: demoSummary.patientMatchStatus,
        loginStatus: demoSummary.portal.loginStatus,
        chartOpened: demoSummary.portal.chartOpened,
        stepLogCount: patientResult.automationStepLogs.length,
        readOnlySafetyMode: demoSummary.safety.safetyMode,
        dangerousWriteAttemptBlocked: demoSummary.safety.dangerousWriteAttemptBlocked,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown live demo verification error.");
  process.exitCode = 1;
});
