import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PatientRun } from "@medical-ai-qa/shared-types";

export async function writePatientResultBundle(
  outputDirectory: string,
  patientRun: PatientRun,
): Promise<string> {
  const bundleDirectory = path.join(outputDirectory, "patient-results");
  await mkdir(bundleDirectory, { recursive: true });

  const bundlePath = path.join(bundleDirectory, `${patientRun.workItemId}.json`);
  patientRun.resultBundlePath = bundlePath;
  patientRun.bundleAvailable = true;
  await writeFile(bundlePath, JSON.stringify(patientRun, null, 2), "utf8");
  return bundlePath;
}
