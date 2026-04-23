import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OasisLockStateSnapshot } from "../portal/utils/oasisLockStateDetector";

export type OasisLockStateExportResult = {
  filePath: string;
  document: OasisLockStateSnapshot;
};

export async function writeOasisLockStateFile(input: {
  outputDirectory: string;
  patientId: string;
  lockState: OasisLockStateSnapshot;
}): Promise<OasisLockStateExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-lock-state.json");
  await writeFile(filePath, JSON.stringify(input.lockState, null, 2), "utf8");

  return {
    filePath,
    document: input.lockState,
  };
}
