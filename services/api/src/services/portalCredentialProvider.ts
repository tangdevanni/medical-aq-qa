import type {
  SubsidiaryPortalCredentials,
  SubsidiaryCredentialSource,
  SubsidiaryRecord,
} from "@medical-ai-qa/shared-types";
import { portalCredentialsSchema } from "../../../../packages/shared-types/src/subsidiary";
import type { Logger } from "pino";
import type { ApiEnv } from "../config/env";

type ResolvedPortalCredentials = {
  credentials: SubsidiaryPortalCredentials;
  source: SubsidiaryCredentialSource;
};

function parseSecretPayload(rawValue: string, sourceLabel: string): SubsidiaryPortalCredentials {
  try {
    return portalCredentialsSchema.parse(JSON.parse(rawValue) as unknown);
  } catch (error) {
    throw new Error(
      `Portal credentials for ${sourceLabel} are not valid JSON with username/password fields: ${
        error instanceof Error ? error.message : "Unknown parse error."
      }`,
    );
  }
}

export class PortalCredentialProvider {
  constructor(
    private readonly env: ApiEnv,
    private readonly logger: Logger,
    private readonly envSource: NodeJS.ProcessEnv = process.env,
  ) {}

  async resolvePortalCredentials(subsidiary: SubsidiaryRecord): Promise<ResolvedPortalCredentials> {
    const injectedSecretEnvVar =
      subsidiary.portalCredentialsEnvVarName ?? this.env.DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_ENV_VAR;
    const injectedSecretValue = injectedSecretEnvVar
      ? this.envSource[injectedSecretEnvVar]
      : undefined;

    if (this.env.SUBSIDIARY_CONFIG_MODE === "aws_secrets_manager") {
      if (!injectedSecretEnvVar || !injectedSecretValue) {
        throw new Error(
          `AWS Secrets Manager mode requires the portal credentials secret to be injected into ${injectedSecretEnvVar ?? "an environment variable"}.`,
        );
      }

      const credentials = parseSecretPayload(injectedSecretValue, injectedSecretEnvVar);
      this.logger.debug(
        {
          subsidiaryId: subsidiary.id,
          credentialSource: "aws_secrets_manager_env",
          credentialsEnvVar: injectedSecretEnvVar,
          portalCredentialsSecretArn: subsidiary.portalCredentialsSecretArn,
        },
        "resolved subsidiary portal credentials from injected AWS secret",
      );
      return {
        credentials,
        source: "aws_secrets_manager_env",
      };
    }

    if (injectedSecretEnvVar && injectedSecretValue) {
      const credentials = parseSecretPayload(injectedSecretValue, injectedSecretEnvVar);
      this.logger.debug(
        {
          subsidiaryId: subsidiary.id,
          credentialSource: "aws_secrets_manager_env",
          credentialsEnvVar: injectedSecretEnvVar,
          portalCredentialsSecretArn: subsidiary.portalCredentialsSecretArn,
        },
        "resolved subsidiary portal credentials from injected secret in local mode",
      );
      return {
        credentials,
        source: "aws_secrets_manager_env",
      };
    }

    if (this.env.PORTAL_USERNAME && this.env.PORTAL_PASSWORD) {
      this.logger.warn(
        {
          subsidiaryId: subsidiary.id,
          credentialSource: "local_env_fallback",
        },
        "resolved subsidiary portal credentials from legacy local environment fallback",
      );
      return {
        credentials: {
          username: this.env.PORTAL_USERNAME,
          password: this.env.PORTAL_PASSWORD,
        },
        source: "local_env_fallback",
      };
    }

    throw new Error(
      `Portal credentials are not configured for subsidiary ${subsidiary.id}. Provide an injected secret JSON payload or local fallback credentials.`,
    );
  }
}
