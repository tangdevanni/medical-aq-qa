import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanDashboardArtifacts } from "./clean-dashboard.mjs";

const port = 3001;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(scriptDirectory, "..");
const nextBinPath = path.join(dashboardRoot, "node_modules", ".bin", "next.CMD");

function assertPortAvailable(targetPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        reject(new Error(`Dashboard dev server port ${targetPort} is already in use. Stop the existing process or reuse the running server.`));
        return;
      }

      reject(error);
    });

    server.listen(targetPort, () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });
  });
}

async function main() {
  await assertPortAvailable(port);
  cleanDashboardArtifacts();

  const child = spawn("cmd.exe", ["/c", nextBinPath, "dev", "--port", String(port)], {
    cwd: dashboardRoot,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
