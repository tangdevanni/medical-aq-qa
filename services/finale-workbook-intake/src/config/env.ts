import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

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

function loadFinaleEnvFiles(): void {
  const workspaceRoot = findWorkspaceRoot(__dirname) ?? findWorkspaceRoot(process.cwd());
  const candidatePaths = [
    workspaceRoot ? path.join(workspaceRoot, ".env") : null,
    workspaceRoot ? path.join(workspaceRoot, ".env.local") : null,
    workspaceRoot ? path.join(workspaceRoot, "services", "finale-workbook-intake", ".env") : null,
    workspaceRoot ? path.join(workspaceRoot, "services", "finale-workbook-intake", ".env.local") : null,
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

loadFinaleEnvFiles();

const envSchema = z.object({
  FINALE_BATCH_OUTPUT_DIR: z.string().min(1).optional(),
  FINALE_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PORTAL_BASE_URL: z.string().url().optional(),
  PORTAL_DASHBOARD_URL: z.string().url().optional(),
  PORTAL_USERNAME: z.string().min(1).optional(),
  PORTAL_PASSWORD: z.string().min(1).optional(),
  PORTAL_AUTH_STATE_PATH: z.string().min(1).optional(),
  PORTAL_HEADLESS: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  PLAYWRIGHT_HEADLESS: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  PLAYWRIGHT_SLOW_MO_MS: z.coerce.number().int().min(0).optional(),
  PORTAL_DEBUG_SELECTORS: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  PORTAL_SAVE_DEBUG_HTML: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  PORTAL_PAUSE_ON_FAILURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  PORTAL_DEBUG_SCREENSHOTS: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  PORTAL_STEP_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(6_000),
  PORTAL_WORKBOOK_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
  PORTAL_WORKBOOK_MIN_BYTES: z.coerce.number().int().positive().optional().default(1_024),
  PORTAL_SELECTOR_RETRY_COUNT: z.coerce.number().int().min(1).max(5).optional().default(2),
  PORTAL_TRACE_ON_FAILURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  OASIS_WRITE_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  CODE_LLM_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  LLM_PROVIDER: z.enum(["bedrock"]).optional().default("bedrock"),
  BEDROCK_REGION: z.string().min(1).optional(),
  BEDROCK_MODEL_ID: z.string().min(1).optional(),
  BEDROCK_INFERENCE_PROFILE_ID: z.string().min(1).optional(),
  TEXTRACT_S3_BUCKET: z.string().min(1).optional(),
  TEXTRACT_S3_REGION: z.string().min(1).optional(),
  TEXTRACT_S3_PREFIX: z.string().min(1).optional(),
  TEXTRACT_POLL_INTERVAL_MS: z.coerce.number().int().min(250).optional().default(2_000),
  TEXTRACT_JOB_TIMEOUT_MS: z.coerce.number().int().min(5_000).optional().default(120_000),
});

export type FinaleBatchEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): FinaleBatchEnv {
  return envSchema.parse(source);
}
