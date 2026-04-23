import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OasisReadyDiagnosisDocument } from "./codingInputExportService";

export type OasisReadyDiagnosisExportResult = {
  filePath: string;
  document: OasisReadyDiagnosisDocument;
};

export async function writeOasisReadyDiagnosisFile(input: {
  outputDirectory: string;
  patientId: string;
  batchId: string;
  document: OasisReadyDiagnosisDocument;
}): Promise<OasisReadyDiagnosisExportResult> {
  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "oasis-ready-diagnosis.json");
  await writeFile(filePath, JSON.stringify(input.document, null, 2), "utf8");

  return {
    filePath,
    document: input.document,
  };
}
