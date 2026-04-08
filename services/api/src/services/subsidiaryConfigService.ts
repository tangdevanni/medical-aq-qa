import type { SubsidiaryRecord, SubsidiaryRuntimeConfig } from "@medical-ai-qa/shared-types";
import { subsidiaryRuntimeConfigSchema } from "../../../../packages/shared-types/src/subsidiary";
import type { Logger } from "pino";
import type { ApiEnv } from "../config/env";
import type { FilesystemSubsidiaryRepository } from "../repositories/filesystemSubsidiaryRepository";
import type { PortalCredentialProvider } from "./portalCredentialProvider";

function buildDefaultSubsidiaryRecord(env: ApiEnv, existing: SubsidiaryRecord | null): SubsidiaryRecord {
  const now = new Date().toISOString();
  return {
    id: env.DEFAULT_SUBSIDIARY_ID,
    slug: env.DEFAULT_SUBSIDIARY_SLUG,
    name: env.DEFAULT_SUBSIDIARY_NAME,
    status: "ACTIVE",
    portalBaseUrl:
      env.DEFAULT_SUBSIDIARY_PORTAL_BASE_URL ??
      env.PORTAL_BASE_URL ??
      "https://app.finalehealth.com",
    portalDashboardUrl:
      env.DEFAULT_SUBSIDIARY_PORTAL_DASHBOARD_URL ??
      env.PORTAL_DASHBOARD_URL ??
      null,
    portalCredentialsSecretArn: env.DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_SECRET_ARN ?? null,
    portalCredentialsEnvVarName: env.DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_ENV_VAR,
    rerunEnabled: env.DEFAULT_SUBSIDIARY_RERUN_ENABLED,
    rerunIntervalHours: env.DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS,
    timezone: env.DEFAULT_SUBSIDIARY_TIMEZONE,
    isDefault: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export class SubsidiaryConfigService {
  constructor(
    private readonly repository: FilesystemSubsidiaryRepository,
    private readonly credentialProvider: PortalCredentialProvider,
    private readonly env: ApiEnv,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    await this.repository.ensureReady();
    await this.ensureDefaultActiveSubsidiary();
  }

  async ensureDefaultActiveSubsidiary(): Promise<SubsidiaryRecord> {
    const existing = await this.repository.getSubsidiary(this.env.DEFAULT_SUBSIDIARY_ID);
    const defaultRecord = buildDefaultSubsidiaryRecord(this.env, existing);
    await this.repository.saveSubsidiary(defaultRecord);
    this.logger.info(
      {
        subsidiaryId: defaultRecord.id,
        subsidiarySlug: defaultRecord.slug,
        rerunEnabled: defaultRecord.rerunEnabled,
        rerunIntervalHours: defaultRecord.rerunIntervalHours,
      },
      "default active subsidiary configuration is ready",
    );
    return defaultRecord;
  }

  async listSubsidiaries(): Promise<SubsidiaryRecord[]> {
    return this.repository.listSubsidiaries();
  }

  async getDefaultActiveSubsidiary(): Promise<SubsidiaryRecord> {
    const subsidiaries = await this.repository.listSubsidiaries();
    const subsidiary =
      subsidiaries.find((candidate) => candidate.isDefault && candidate.status === "ACTIVE") ??
      subsidiaries.find((candidate) => candidate.status === "ACTIVE");

    if (!subsidiary) {
      throw new Error("No active subsidiary configuration is available.");
    }

    return subsidiary;
  }

  async getSubsidiaryConfig(subsidiaryIdOrSlug: string): Promise<SubsidiaryRecord> {
    const subsidiaries = await this.repository.listSubsidiaries();
    const subsidiary = subsidiaries.find((candidate) =>
      candidate.id === subsidiaryIdOrSlug || candidate.slug === subsidiaryIdOrSlug,
    );

    if (!subsidiary) {
      throw new Error(`Subsidiary configuration not found: ${subsidiaryIdOrSlug}`);
    }

    return subsidiary;
  }

  async resolveRuntimeConfig(subsidiaryId?: string | null): Promise<SubsidiaryRuntimeConfig> {
    const subsidiary = subsidiaryId
      ? await this.getSubsidiaryConfig(subsidiaryId)
      : await this.getDefaultActiveSubsidiary();
    const credentialResolution = await this.credentialProvider.resolvePortalCredentials(subsidiary);

    return subsidiaryRuntimeConfigSchema.parse({
      subsidiaryId: subsidiary.id,
      subsidiarySlug: subsidiary.slug,
      subsidiaryName: subsidiary.name,
      portalBaseUrl: subsidiary.portalBaseUrl,
      portalDashboardUrl: subsidiary.portalDashboardUrl,
      credentials: credentialResolution.credentials,
      rerunEnabled: subsidiary.rerunEnabled,
      rerunIntervalHours: subsidiary.rerunIntervalHours,
      timezone: subsidiary.timezone,
      credentialSource: credentialResolution.source,
      portalCredentialsSecretArn: subsidiary.portalCredentialsSecretArn,
    });
  }
}
