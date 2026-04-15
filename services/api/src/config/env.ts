import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_STORAGE_ROOT: z.string().min(1).default("./data/control-plane"),
  API_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  API_CORS_ORIGIN: z.string().min(1).default("*"),
  SUBSIDIARY_CONFIG_MODE: z
    .enum(["local_env", "aws_secrets_manager"])
    .default("local_env"),
  DEFAULT_SUBSIDIARY_ID: z.string().min(1).default("default"),
  DEFAULT_SUBSIDIARY_SLUG: z.string().min(1).default("star-home-health-care-inc"),
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
  AUTONOMOUS_AGENCY_IDS: z.string().default("default"),
  DEFAULT_SUBSIDIARY_RERUN_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
  PORTAL_BASE_URL: z.string().url().optional(),
  PORTAL_DASHBOARD_URL: z.string().url().optional(),
  PORTAL_USERNAME: z.string().min(1).optional(),
  PORTAL_PASSWORD: z.string().min(1).optional(),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const env = envSchema.parse(source);
  return {
    ...env,
    API_STORAGE_ROOT: path.resolve(env.API_STORAGE_ROOT),
  };
}
