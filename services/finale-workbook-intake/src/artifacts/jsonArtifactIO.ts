import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function readJsonArtifact<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function readJsonArtifactIfExists<T = unknown>(
  filePath: string | null | undefined,
): Promise<T | null> {
  if (!filePath) {
    return null;
  }

  try {
    return await readJsonArtifact<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeJsonArtifact(filePath: string, payload: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function fileExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      const error = new Error(`Path exists but is not a file: ${filePath}`) as NodeJS.ErrnoException;
      error.code = "EISDIR";
      throw error;
    }
    await access(filePath, constants.R_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
