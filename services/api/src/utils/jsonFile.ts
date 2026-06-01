import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, filePath);
}
