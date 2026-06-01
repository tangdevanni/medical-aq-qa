import path from "node:path";
import { readFile } from "node:fs/promises";

export type DocumentCatalogEntry = Record<string, unknown> & {
  documentKey?: string;
  displayName?: string;
  normalizedType?: string;
  sourceUrl?: string;
};

export type DocumentCatalogFile = Record<string, unknown> & {
  schemaVersion?: number;
  generatedAt?: string;
  patientId?: string;
  documentCount?: number;
  clinicallyRelevantDocumentCount?: number;
  documents?: DocumentCatalogEntry[];
};

export function getDocumentCatalogPath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "document-catalog.json");
}

export async function readDocumentCatalogFileIfExists(
  filePath: string,
): Promise<DocumentCatalogFile | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as DocumentCatalogFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
