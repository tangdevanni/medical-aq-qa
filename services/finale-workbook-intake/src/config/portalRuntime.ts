import type { SubsidiaryRuntimeConfig } from "@medical-ai-qa/shared-types";
import { subsidiaryRuntimeConfigSchema } from "../../../../packages/shared-types/src/subsidiary";
import type { FinaleBatchEnv } from "./env";

export function resolvePortalRuntimeConfig(input: {
  env: FinaleBatchEnv;
  providedRuntimeConfig?: SubsidiaryRuntimeConfig;
  fallbackSubsidiaryId?: string;
}): SubsidiaryRuntimeConfig {
  if (input.providedRuntimeConfig) {
    return subsidiaryRuntimeConfigSchema.parse(input.providedRuntimeConfig);
  }

  if (!input.env.PORTAL_BASE_URL || !input.env.PORTAL_USERNAME || !input.env.PORTAL_PASSWORD) {
    throw new Error(
      "Portal runtime config was not provided. Configure a default subsidiary in the API or use legacy PORTAL_BASE_URL, PORTAL_USERNAME, and PORTAL_PASSWORD only through local fallback.",
    );
  }

  return subsidiaryRuntimeConfigSchema.parse({
    subsidiaryId: input.fallbackSubsidiaryId ?? "default",
    subsidiarySlug: input.fallbackSubsidiaryId ?? "default",
    subsidiaryName: "Local Env Subsidiary",
    portalBaseUrl: input.env.PORTAL_BASE_URL,
    portalDashboardUrl: input.env.PORTAL_DASHBOARD_URL ?? null,
    credentials: {
      username: input.env.PORTAL_USERNAME,
      password: input.env.PORTAL_PASSWORD,
    },
    rerunEnabled: true,
    rerunIntervalHours: 24,
    timezone: "America/Los_Angeles",
    credentialSource: "local_env_fallback",
    portalCredentialsSecretArn: null,
  });
}
