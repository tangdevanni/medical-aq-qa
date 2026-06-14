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
    process.env.MEDICAL_AQ_QA_ENV_FILE ?? null,
    process.env.FINALE_ENV_FILE ?? null,
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
  FINALE_PATIENT_CONCURRENCY: z.coerce.number().int().min(1).max(8).optional().default(1),
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
  PORTAL_ACTION_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
  PORTAL_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(45_000),
  PORTAL_NAVIGATION_RETRIES: z.coerce.number().int().min(1).max(5).optional().default(3),
  PORTAL_WORKBOOK_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
  PORTAL_WORKBOOK_MIN_BYTES: z.coerce.number().int().positive().optional().default(1_024),
  PORTAL_PATIENT_WORKER_COUNT: z.coerce.number().int().min(1).max(8).optional().default(1),
  PORTAL_SELECTOR_RETRY_COUNT: z.coerce.number().int().min(1).max(5).optional().default(2),
  PORTAL_TRACE_ON_FAILURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  PORTAL_DOM_EXTRACTION_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value === "true"),
  OASIS_DOM_EXTRACTION_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value === "true"),
  OASIS_ACQUISITION_SOURCE: z
    .enum(["legacy_dom", "print_preview_dom", "print_preview_dom_first"])
    .optional()
    .default("legacy_dom"),
  VISIT_NOTES_DOM_EXTRACTION_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value === "true"),
  OCR_FALLBACK_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value !== "false"),
  OCR_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  DOM_EXTRACTION_MIN_FIELD_COUNT: z.coerce.number().int().min(0).optional().default(10),
  DOM_EXTRACTION_MIN_NONEMPTY_FIELD_COUNT: z.coerce.number().int().min(0).optional().default(3),
  VISIT_NOTE_CAPTURE_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
  VISIT_NOTE_CAPTURE_MAX_NOTES: z.coerce.number().int().positive().optional().default(10),
  VISIT_NOTE_POC_MAPPING_LLM_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === undefined ? undefined : value === "true"),
  VISIT_NOTE_POC_MAPPING_MODEL_ID: z.string().min(1).optional(),
  VISIT_NOTE_POC_MAPPING_MAX_TOKENS: z.coerce.number().int().min(512).max(8_000).optional().default(2_500),
  OASIS_SECTION_LLM_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === undefined ? undefined : value === "true"),
  OASIS_SECTION_LLM_MODEL_ID: z.string().min(1).optional(),
  OASIS_SECTION_LLM_MAX_TOKENS: z.coerce.number().int().min(512).max(8_000).optional().default(1_800),
  OASIS_SECTION_LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).optional().default(2),
  OASIS_CHECK_LLM_MODEL_ID: z.string().min(1).optional(),
  OASIS_CHECK_LLM_MAX_TOKENS: z.coerce.number().int().min(512).max(8_000).optional().default(2_500),
  OASIS_WRITE_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  CODE_LLM_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  REFERRAL_EXTRACTION_MODE: z
    .enum(["direct_document_llm_only"])
    .optional()
    .default("direct_document_llm_only"),
  LLM_PROVIDER: z.enum(["bedrock"]).optional().default("bedrock"),
  BEDROCK_REGION: z.string().min(1).optional(),
  BEDROCK_MODEL_ID: z.string().min(1).optional(),
  BEDROCK_INFERENCE_PROFILE_ID: z.string().min(1).optional(),
  BEDROCK_CONVERSE_TIMEOUT_MS: z.coerce.number().int().min(5_000).optional().default(120_000),
  TEXTRACT_S3_BUCKET: z.string().min(1).optional(),
  TEXTRACT_S3_REGION: z.string().min(1).optional(),
  TEXTRACT_S3_PREFIX: z.string().min(1).optional(),
  TEXTRACT_POLL_INTERVAL_MS: z.coerce.number().int().min(250).optional().default(2_000),
  TEXTRACT_JOB_TIMEOUT_MS: z.coerce.number().int().min(5_000).optional().default(120_000),
});

export type FinaleBatchEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): FinaleBatchEnv {
  const parsed = envSchema.parse(source);
  return {
    ...parsed,
    OCR_FALLBACK_ENABLED: parsed.OCR_ENABLED && parsed.OCR_FALLBACK_ENABLED,
  };
}
