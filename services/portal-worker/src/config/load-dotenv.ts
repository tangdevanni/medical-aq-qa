import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

export interface DotenvLoadResult {
  loadedEnvPaths: string[];
}

const portalWorkerRoot = resolve(__dirname, "../..");
const repositoryRoot = resolve(__dirname, "../../../..");

// Local env loading order:
// 1. Repo root .env provides shared defaults for the workspace.
// 2. services/portal-worker/.env overrides values loaded from the repo root.
// Existing process.env values from the shell are preserved.
const dotenvCandidates = [
  resolve(repositoryRoot, ".env"),
  resolve(portalWorkerRoot, ".env"),
];

export function loadPortalWorkerDotenv(): DotenvLoadResult {
  const loadedEnvPaths: string[] = [];
  const shellDefinedKeys = new Set(
    Object.entries(process.env)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
  );

  for (const envPath of dotenvCandidates) {
    if (!existsSync(envPath)) {
      continue;
    }

    const parsed = parse(readFileSync(envPath));

    for (const [key, value] of Object.entries(parsed)) {
      if (shellDefinedKeys.has(key)) {
        continue;
      }

      process.env[key] = value;
    }

    loadedEnvPaths.push(envPath);
  }

  return { loadedEnvPaths };
}
