import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import {
  DEFAULT_DELTA_RUN_WEEKDAYS,
  DEFAULT_WORKBOOK_INTAKE_DAY,
  DEFAULT_WORKBOOK_INTAKE_LOCAL_TIME,
  parseWeekdayList,
  parseWeekdayName,
} from "../utils/workbookSchedule";

function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function loadApiEnvFiles(): void {
  const apiPackageRoot = path.resolve(__dirname, "../..");
  const workspaceRoot = findWorkspaceRoot(apiPackageRoot) ?? findWorkspaceRoot(process.cwd());
  const candidatePaths = [
    process.env.MEDICAL_AQ_QA_ENV_FILE ?? null,
    process.env.API_ENV_FILE ?? null,
    workspaceRoot ? path.join(workspaceRoot, ".env") : null,
    workspaceRoot ? path.join(workspaceRoot, ".env.local") : null,
    path.join(apiPackageRoot, ".env"),
    path.join(apiPackageRoot, ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), ".env.local"),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    loadDotenv({
      path: envPath,
      override: false,
    });
  }
}

loadApiEnvFiles();

function parseLocalTimes(value: string): string[] {
  const localTimes = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (localTimes.length === 0) {
    throw new Error("DEFAULT_SUBSIDIARY_RERUN_LOCAL_TIMES must include at least one HH:mm value.");
  }
  for (const localTime of localTimes) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
      throw new Error(`Invalid rerun local time: ${localTime}. Expected HH:mm.`);
    }
  }
  return localTimes;
}

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_STORAGE_ROOT: z.string().min(1).default("./data/control-plane"),
  API_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  API_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  API_CORS_ORIGIN: z.string().min(1).default("*"),
  API_AUTONOMOUS_MODE: z.enum(["full", "manual_only"]).default("full"),
  PATIENT_MEMORY_WRITE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DELTA_REUSE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SUBSIDIARY_CONFIG_MODE: z
    .enum(["local_env", "aws_secrets_manager"])
    .default("local_env"),
  DEFAULT_SUBSIDIARY_ID: z.string().min(1).default("star-home-health"),
  DEFAULT_SUBSIDIARY_SLUG: z.string().min(1).default("star-home-health"),
  DEFAULT_SUBSIDIARY_NAME: z.string().min(1).default("Star Home Health"),
  DEFAULT_SUBSIDIARY_TIMEZONE: z.string().min(1).default("Asia/Manila"),
  DEFAULT_SUBSIDIARY_PORTAL_BASE_URL: z.string().url().optional(),
  DEFAULT_SUBSIDIARY_PORTAL_DASHBOARD_URL: z.string().url().optional(),
  APLUS_HOME_HEALTH_PORTAL_DASHBOARD_URL: z.string().url().optional(),
  ACTIVE_HOME_HEALTH_PORTAL_DASHBOARD_URL: z.string().url().optional(),
  AVERY_HOME_HEALTH_PORTAL_DASHBOARD_URL: z.string().url().optional(),
  MEADOWS_HOME_HEALTH_PORTAL_DASHBOARD_URL: z.string().url().optional(),
  STAR_HOME_HEALTH_PORTAL_DASHBOARD_URL: z.string().url().optional(),
  DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_SECRET_ARN: z.string().min(1).optional(),
  DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_ENV_VAR: z
    .string()
    .min(1)
    .default("DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_JSON"),
  AUTONOMOUS_AGENCY_IDS: z.string().default("star-home-health"),
  DEFAULT_SUBSIDIARY_RERUN_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
  DEFAULT_SUBSIDIARY_RERUN_LOCAL_TIMES: z.string().default("20:30").transform(parseLocalTimes),
  DEFAULT_SUBSIDIARY_WORKBOOK_INTAKE_DAY: z
    .string()
    .default(DEFAULT_WORKBOOK_INTAKE_DAY)
    .transform(parseWeekdayName),
  DEFAULT_SUBSIDIARY_WORKBOOK_INTAKE_LOCAL_TIME: z
    .string()
    .default(DEFAULT_WORKBOOK_INTAKE_LOCAL_TIME)
    .refine((value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), "Expected HH:mm."),
  DEFAULT_SUBSIDIARY_DELTA_RUN_WEEKDAYS: z
    .string()
    .default(DEFAULT_DELTA_RUN_WEEKDAYS.join(","))
    .transform(parseWeekdayList),
  PORTAL_BASE_URL: z.string().url().optional(),
  PORTAL_DASHBOARD_URL: z.string().url().optional(),
  PORTAL_USERNAME: z.string().min(1).optional(),
  PORTAL_PASSWORD: z.string().min(1).optional(),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const env = envSchema.parse(source);
  const apiPackageRoot = path.resolve(__dirname, "../..");
  return {
    ...env,
    API_STORAGE_ROOT: path.isAbsolute(env.API_STORAGE_ROOT)
      ? env.API_STORAGE_ROOT
      : path.resolve(apiPackageRoot, env.API_STORAGE_ROOT),
  };
}
