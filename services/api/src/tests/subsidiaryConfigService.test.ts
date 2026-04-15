import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { loadEnv } from "../config/env";
import { FilesystemSubsidiaryRepository } from "../repositories/filesystemSubsidiaryRepository";
import { PortalCredentialProvider } from "../services/portalCredentialProvider";
import { SubsidiaryConfigService } from "../services/subsidiaryConfigService";

function createFixture(source: NodeJS.ProcessEnv) {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), "medical-ai-qa-subsidiary-"));
  const logger = pino({ enabled: false });
  const env = loadEnv(source);
  const repository = new FilesystemSubsidiaryRepository(storageRoot);
  const credentialProvider = new PortalCredentialProvider(env, logger, source);
  const service = new SubsidiaryConfigService(repository, credentialProvider, env, logger);

  return {
    env,
    repository,
    service,
    cleanup: () => rmSync(storageRoot, { recursive: true, force: true }),
  };
}

describe("SubsidiaryConfigService", () => {
  it("seeds and resolves the default active subsidiary", async () => {
    const fixture = createFixture({
      DEFAULT_SUBSIDIARY_ID: "home-health-west",
      DEFAULT_SUBSIDIARY_SLUG: "home-health-west",
      DEFAULT_SUBSIDIARY_NAME: "Home Health West",
      DEFAULT_SUBSIDIARY_PORTAL_BASE_URL: "https://app.finalehealth.com/provider/demo",
      PORTAL_USERNAME: "portal-user",
      PORTAL_PASSWORD: "portal-pass",
    });

    try {
      await fixture.service.initialize();
      const subsidiary = await fixture.service.getDefaultActiveSubsidiary();

      assert.equal(subsidiary.id, "home-health-west");
      assert.equal(subsidiary.slug, "home-health-west");
      assert.equal(subsidiary.name, "Home Health West");
      assert.equal(subsidiary.isDefault, true);
    } finally {
      fixture.cleanup();
    }
  });

  it("resolves injected AWS secret credentials through the subsidiary config layer", async () => {
    const fixture = createFixture({
      SUBSIDIARY_CONFIG_MODE: "aws_secrets_manager",
      DEFAULT_SUBSIDIARY_PORTAL_BASE_URL: "https://app.finalehealth.com/provider/demo",
      DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_ENV_VAR: "DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_JSON",
      DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_JSON: JSON.stringify({
        username: "aws-user",
        password: "aws-pass",
      }),
    });

    try {
      await fixture.service.initialize();
      const runtime = await fixture.service.resolveRuntimeConfig();

      assert.equal(runtime.credentialSource, "aws_secrets_manager_env");
      assert.equal(runtime.credentials.username, "aws-user");
      assert.equal(runtime.credentials.password, "aws-pass");
    } finally {
      fixture.cleanup();
    }
  });

  it("supports explicit local env fallback for one-subsidiary development", async () => {
    const fixture = createFixture({
      SUBSIDIARY_CONFIG_MODE: "local_env",
      DEFAULT_SUBSIDIARY_PORTAL_BASE_URL: "https://app.finalehealth.com/provider/demo",
      PORTAL_USERNAME: "local-user",
      PORTAL_PASSWORD: "local-pass",
    });

    try {
      await fixture.service.initialize();
      const runtime = await fixture.service.resolveRuntimeConfig();

      assert.equal(runtime.credentialSource, "local_env_fallback");
      assert.equal(runtime.credentials.username, "local-user");
      assert.equal(runtime.credentials.password, "local-pass");
    } finally {
      fixture.cleanup();
    }
  });

  it("seeds the known Finale agency choices for dashboard selection", async () => {
    const fixture = createFixture({
      DEFAULT_SUBSIDIARY_PORTAL_BASE_URL: "https://app.finalehealth.com/provider/demo",
      DEFAULT_SUBSIDIARY_PORTAL_DASHBOARD_URL: "https://app.finalehealth.com/provider/default/dashboard",
      AUTONOMOUS_AGENCY_IDS: "default,aplus-home-health,active-home-health",
      STAR_HOME_HEALTH_PORTAL_DASHBOARD_URL: "https://app.finalehealth.com/provider/68adab62cdffc4e98756c3d0/dashboard",
      APLUS_HOME_HEALTH_PORTAL_DASHBOARD_URL: "https://app.finalehealth.com/provider/63d76c41b32acffc9eb5d29d/dashboard",
      ACTIVE_HOME_HEALTH_PORTAL_DASHBOARD_URL: "https://app.finalehealth.com/provider/671a3d44a34d4e0dfe1340e7/dashboard",
      AVERY_HOME_HEALTH_PORTAL_DASHBOARD_URL: "https://app.finalehealth.com/provider/62f398913768d30fbdddc08b/dashboard",
      MEADOWS_HOME_HEALTH_PORTAL_DASHBOARD_URL: "https://app.finalehealth.com/provider/691de9e967052347d890e991/dashboard",
      PORTAL_USERNAME: "local-user",
      PORTAL_PASSWORD: "local-pass",
    });

    try {
      await fixture.service.initialize();
      const subsidiaries = await fixture.service.listSubsidiaries();

      assert.deepEqual(
        subsidiaries.map((subsidiary) => subsidiary.name),
        [
          "Active Home Health",
          "APlus Home Health",
          "Avery Home Health",
          "Meadows Home Health",
          "Star Home Health",
        ],
      );
      assert.equal(
        subsidiaries.filter((subsidiary) => subsidiary.status === "ACTIVE").map((subsidiary) => subsidiary.name).join(","),
        "Active Home Health,APlus Home Health,Star Home Health",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "APlus Home Health")?.portalAgencyName,
        "A Plus Home Health Systems LLC",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "Active Home Health")?.portalAgencyName,
        "Active Home Healthcare LLC",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "Avery Home Health")?.portalAgencyName,
        "Avery Home Health LLC",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "APlus Home Health")?.portalDashboardUrl,
        "https://app.finalehealth.com/provider/63d76c41b32acffc9eb5d29d/dashboard",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "Active Home Health")?.portalDashboardUrl,
        "https://app.finalehealth.com/provider/671a3d44a34d4e0dfe1340e7/dashboard",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "Avery Home Health")?.portalDashboardUrl,
        "https://app.finalehealth.com/provider/62f398913768d30fbdddc08b/dashboard",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "Meadows Home Health")?.portalDashboardUrl,
        "https://app.finalehealth.com/provider/691de9e967052347d890e991/dashboard",
      );
      assert.equal(
        subsidiaries.find((subsidiary) => subsidiary.name === "Star Home Health")?.portalDashboardUrl,
        "https://app.finalehealth.com/provider/68adab62cdffc4e98756c3d0/dashboard",
      );
    } finally {
      fixture.cleanup();
    }
  });
});
