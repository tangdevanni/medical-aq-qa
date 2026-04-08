import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentInventoryItem } from "@medical-ai-qa/shared-types";

export type DocumentInventoryExportFile = {
  schemaVersion: "1";
  generatedAt: string;
  patientId: string;
  batchId: string;
  documentCount: number;
  documents: DocumentInventoryItem[];
};

export type DocumentInventoryExportResult = {
  filePath: string;
  document: DocumentInventoryExportFile;
};

export async function writeDocumentInventoryFile(input: {
  outputDirectory: string;
  patientId: string;
  batchId: string;
  documentInventory: DocumentInventoryItem[];
}): Promise<DocumentInventoryExportResult> {
  const document: DocumentInventoryExportFile = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    patientId: input.patientId,
    batchId: input.batchId,
    documentCount: input.documentInventory.length,
    documents: input.documentInventory,
  };

  const patientDirectory = path.join(input.outputDirectory, "patients", input.patientId);
  await mkdir(patientDirectory, { recursive: true });
  const filePath = path.join(patientDirectory, "document-inventory.json");
  await writeFile(filePath, JSON.stringify(document, null, 2), "utf8");

  return {
    filePath,
    document,
  };
}
