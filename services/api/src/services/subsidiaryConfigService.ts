import type { SubsidiaryRecord, SubsidiaryRuntimeConfig } from "@medical-ai-qa/shared-types";
import { subsidiaryRuntimeConfigSchema } from "../../../../packages/shared-types/src/subsidiary";
import type { Logger } from "pino";
import type { ApiEnv } from "../config/env";
import type { FilesystemSubsidiaryRepository } from "../repositories/filesystemSubsidiaryRepository";
import type { PortalCredentialProvider } from "./portalCredentialProvider";

const KNOWN_AGENCY_OPTIONS: ReadonlyArray<{
  id: string;
  slug: string;
  name: string;
  portalAgencyName?: string;
  portalAgencyAliases?: string[];
  dashboardUrlEnvKey?: keyof ApiEnv;
}> = [
  {
    id: "aplus-home-health",
    slug: "aplus-home-health",
    name: "APlus Home Health",
    portalAgencyName: "A Plus Home Health Systems LLC",
    portalAgencyAliases: ["APlus Home Health", "A Plus Home Health"],
    dashboardUrlEnvKey: "APLUS_HOME_HEALTH_PORTAL_DASHBOARD_URL",
  },
  {
    id: "active-home-health",
    slug: "active-home-health",
    name: "Active Home Health",
    portalAgencyName: "Active Home Healthcare LLC",
    portalAgencyAliases: ["Active Home Health", "Active Home Healthcare"],
    dashboardUrlEnvKey: "ACTIVE_HOME_HEALTH_PORTAL_DASHBOARD_URL",
  },
  {
    id: "avery-home-health",
    slug: "avery-home-health",
    name: "Avery Home Health",
    portalAgencyName: "Avery Home Health LLC",
    portalAgencyAliases: ["Avery Home Health"],
    dashboardUrlEnvKey: "AVERY_HOME_HEALTH_PORTAL_DASHBOARD_URL",
  },
  {
    id: "meadows-home-health",
    slug: "meadows-home-health",
    name: "Meadows Home Health",
    portalAgencyName: "Meadows Home Health",
    portalAgencyAliases: ["Meadows Home Health"],
    dashboardUrlEnvKey: "MEADOWS_HOME_HEALTH_PORTAL_DASHBOARD_URL",
  },
];

function parseAutonomousAgencyIds(env: ApiEnv): Set<string> {
  return new Set(
    env.AUTONOMOUS_AGENCY_IDS
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function resolveAgencyDashboardUrl(
  env: ApiEnv,
  dashboardUrlEnvKey?: keyof ApiEnv,
): string | null {
  if (dashboardUrlEnvKey) {
    const configuredValue = env[dashboardUrlEnvKey];
    if (typeof configuredValue === "string" && configuredValue.trim()) {
      return configuredValue;
    }
  }

  if (env.DEFAULT_SUBSIDIARY_NAME === "Star Home Health" && env.STAR_HOME_HEALTH_PORTAL_DASHBOARD_URL) {
    return env.STAR_HOME_HEALTH_PORTAL_DASHBOARD_URL;
  }

  return env.DEFAULT_SUBSIDIARY_PORTAL_DASHBOARD_URL ?? env.PORTAL_DASHBOARD_URL ?? null;
}

function buildDefaultSubsidiaryRecord(env: ApiEnv, existing: SubsidiaryRecord | null): SubsidiaryRecord {
  const now = new Date().toISOString();
  const defaultAliases = env.DEFAULT_SUBSIDIARY_NAME === "Star Home Health"
    ? ["Star Home Health Care Inc"]
    : [];
  return {
    id: env.DEFAULT_SUBSIDIARY_ID,
    slug: env.DEFAULT_SUBSIDIARY_SLUG,
    name: env.DEFAULT_SUBSIDIARY_NAME,
    portalAgencyName: env.DEFAULT_SUBSIDIARY_NAME,
    portalAgencyAliases: existing?.portalAgencyAliases ?? defaultAliases,
    status: "ACTIVE",
    portalBaseUrl:
      env.DEFAULT_SUBSIDIARY_PORTAL_BASE_URL ??
      env.PORTAL_BASE_URL ??
      "https://app.finalehealth.com",
    portalDashboardUrl: resolveAgencyDashboardUrl(env),
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

function buildKnownSubsidiaryRecord(
  env: ApiEnv,
  agency: (typeof KNOWN_AGENCY_OPTIONS)[number],
  existing: SubsidiaryRecord | null,
): SubsidiaryRecord {
  const now = new Date().toISOString();
  const autonomousAgencyIds = parseAutonomousAgencyIds(env);
  const isActive = autonomousAgencyIds.has(agency.id) || autonomousAgencyIds.has(agency.slug);
  return {
    id: agency.id,
    slug: agency.slug,
    name: agency.name,
    portalAgencyName: agency.portalAgencyName ?? agency.name,
    portalAgencyAliases: agency.portalAgencyAliases ?? existing?.portalAgencyAliases ?? [],
    status: isActive ? "ACTIVE" : "INACTIVE",
    portalBaseUrl:
      env.DEFAULT_SUBSIDIARY_PORTAL_BASE_URL ??
      env.PORTAL_BASE_URL ??
      "https://app.finalehealth.com",
    portalDashboardUrl: resolveAgencyDashboardUrl(env, agency.dashboardUrlEnvKey),
    portalCredentialsSecretArn: env.DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_SECRET_ARN ?? null,
    portalCredentialsEnvVarName: env.DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_ENV_VAR,
    rerunEnabled: isActive ? env.DEFAULT_SUBSIDIARY_RERUN_ENABLED : false,
    rerunIntervalHours: env.DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS,
    timezone: env.DEFAULT_SUBSIDIARY_TIMEZONE,
    isDefault: false,
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
    await this.ensureKnownSubsidiaries();
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

  async ensureKnownSubsidiaries(): Promise<SubsidiaryRecord[]> {
    const records: SubsidiaryRecord[] = [await this.ensureDefaultActiveSubsidiary()];
    for (const agency of KNOWN_AGENCY_OPTIONS) {
      const existing = await this.repository.getSubsidiary(agency.id);
      const record = buildKnownSubsidiaryRecord(this.env, agency, existing);
      await this.repository.saveSubsidiary(record);
      records.push(record);
    }

    this.logger.info(
      {
        subsidiaries: records.map((record) => ({
          subsidiaryId: record.id,
          subsidiarySlug: record.slug,
          status: record.status,
          rerunEnabled: record.rerunEnabled,
        })),
      },
      "known subsidiary configurations are ready",
    );

    return records;
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
      portalAgencyName: subsidiary.portalAgencyName,
      portalAgencyAliases: subsidiary.portalAgencyAliases,
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
