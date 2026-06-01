import path from "node:path";
import { readFile } from "node:fs/promises";

export type DocumentExtractionCacheManifest = Record<string, unknown> & {
  schemaVersion?: number | string;
  generatedAt?: string;
  entries?: unknown[];
};

export type ComparisonInputManifest = Record<string, unknown> & {
  schemaVersion?: number | string;
  generatedAt?: string;
  inputs?: unknown[];
};

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function getDocumentExtractionCachePath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "document-extraction-cache.json");
}

export function getComparisonInputManifestPath(patientArtifactsDirectory: string): string {
  return path.join(patientArtifactsDirectory, "comparison-input-manifest.json");
}

export async function readDocumentExtractionCacheManifest(
  filePath: string,
): Promise<DocumentExtractionCacheManifest | null> {
  return readJsonIfExists<DocumentExtractionCacheManifest>(filePath);
}

export async function readComparisonInputManifest(
  filePath: string,
): Promise<ComparisonInputManifest | null> {
  return readJsonIfExists<ComparisonInputManifest>(filePath);
}
