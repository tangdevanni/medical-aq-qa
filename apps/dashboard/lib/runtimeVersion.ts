import { execFileSync } from "node:child_process";
import { loadDashboardEnv } from "./env";

function readGitSha(): string | null {
  if (process.env.GIT_SHA?.trim()) {
    return process.env.GIT_SHA.trim();
  }
  if (process.env.SOURCE_VERSION?.trim()) {
    return process.env.SOURCE_VERSION.trim();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function getDashboardRuntimeVersion() {
  const env = loadDashboardEnv();
  return {
    service: "dashboard",
    generatedAt: new Date().toISOString(),
    gitSha: readGitSha(),
    buildId: process.env.BUILD_ID?.trim() || process.env.NEXT_BUILD_ID?.trim() || null,
    imageTag: process.env.IMAGE_TAG?.trim() || process.env.ECS_IMAGE_TAG?.trim() || null,
    nextPublicApiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    featureFlags: {
      cookieSecure: env.cookieSecure,
      authAuditEnabled: env.authAuditEnabled,
      backendFetchTimeoutMs: env.backendFetchTimeoutMs,
    },
  };
}
