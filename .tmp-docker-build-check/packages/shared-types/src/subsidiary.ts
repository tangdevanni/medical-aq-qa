import { z } from "zod";

export const subsidiaryStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export type SubsidiaryStatus = z.infer<typeof subsidiaryStatusSchema>;

export const subsidiaryCredentialSourceSchema = z.enum([
  "aws_secrets_manager_env",
  "local_env_fallback",
]);

export type SubsidiaryCredentialSource = z.infer<typeof subsidiaryCredentialSourceSchema>;

export const portalCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type SubsidiaryPortalCredentials = z.infer<typeof portalCredentialsSchema>;

export const subsidiaryRecordSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  status: subsidiaryStatusSchema,
  portalBaseUrl: z.string().url(),
  portalDashboardUrl: z.string().url().nullable().default(null),
  portalCredentialsSecretArn: z.string().min(1).nullable().default(null),
  portalCredentialsEnvVarName: z.string().min(1).nullable().default(null),
  rerunEnabled: z.boolean().default(true),
  rerunIntervalHours: z.number().int().positive().default(24),
  timezone: z.string().min(1).default("America/Los_Angeles"),
  isDefault: z.boolean().default(false),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type SubsidiaryRecord = z.infer<typeof subsidiaryRecordSchema>;

export const subsidiaryRuntimeConfigSchema = z.object({
  subsidiaryId: z.string().min(1),
  subsidiarySlug: z.string().min(1),
  subsidiaryName: z.string().min(1),
  portalBaseUrl: z.string().url(),
  portalDashboardUrl: z.string().url().nullable().default(null),
  credentials: portalCredentialsSchema,
  rerunEnabled: z.boolean(),
  rerunIntervalHours: z.number().int().positive(),
  timezone: z.string().min(1),
  credentialSource: subsidiaryCredentialSourceSchema,
  portalCredentialsSecretArn: z.string().min(1).nullable().default(null),
});

export type SubsidiaryRuntimeConfig = z.infer<typeof subsidiaryRuntimeConfigSchema>;
