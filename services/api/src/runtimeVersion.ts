import { execFileSync } from "node:child_process";
import { loadEnv } from "./config/env";

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

export function getApiRuntimeVersion() {
  const env = loadEnv();
  return {
    service: "api",
    generatedAt: new Date().toISOString(),
    gitSha: readGitSha(),
    buildId: process.env.BUILD_ID?.trim() || null,
    imageTag: process.env.IMAGE_TAG?.trim() || process.env.ECS_IMAGE_TAG?.trim() || null,
    artifactRoot: env.API_STORAGE_ROOT,
    autonomousMode: env.API_AUTONOMOUS_MODE,
    featureFlags: {
      patientMemoryWriteEnabled: env.PATIENT_MEMORY_WRITE_ENABLED,
      deltaReuseEnabled: env.DELTA_REUSE_ENABLED,
      subsidiaryConfigMode: env.SUBSIDIARY_CONFIG_MODE,
      defaultSubsidiaryRerunEnabled: env.DEFAULT_SUBSIDIARY_RERUN_ENABLED,
      portalCredentialsConfigured: Boolean(env.PORTAL_USERNAME && env.PORTAL_PASSWORD),
    },
  };
}
