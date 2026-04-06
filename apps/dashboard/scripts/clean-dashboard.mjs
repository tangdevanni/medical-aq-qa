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

for (const targetPath of removablePaths) {
  fs.rmSync(targetPath, {
    force: true,
    recursive: true,
  });
}

console.log("dashboard artifacts cleaned");
