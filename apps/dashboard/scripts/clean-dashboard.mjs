import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(scriptDirectory, "..");

const removablePaths = [
  ".next",
  ".next-dev",
  "tsconfig.tsbuildinfo",
].map((relativePath) => path.join(dashboardRoot, relativePath));

const transientWindowsErrorCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 200,
    });
    return;
  } catch (error) {
    const isDevArtifactsDirectory = path.basename(targetPath) === ".next-dev";
    const isTransientWindowsLock =
      error instanceof Error &&
      "code" in error &&
      transientWindowsErrorCodes.has(error.code);

    if (isDevArtifactsDirectory && isTransientWindowsLock) {
      console.warn(
        `Skipping cleanup for ${targetPath} because a Windows file lock is still active. Continuing with the existing dev artifact directory.`,
      );
      return;
    }

    throw error;
  }
}

export function cleanDashboardArtifacts() {
  for (const targetPath of removablePaths) {
    removePath(targetPath);
  }

  console.log("dashboard artifacts cleaned");
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  cleanDashboardArtifacts();
}
