import { z } from "zod";

export const portalSafetyModeSchema = z.enum([
  "READ_ONLY",
  "DRY_RUN_WRITE",
  "CONTROLLED_WRITE",
]);

export type PortalSafetyMode = z.infer<typeof portalSafetyModeSchema>;

export const portalActionSafetyClassSchema = z.enum([
  "AUTH_ONLY",
  "READ_NAV",
  "READ_FILTER",
  "READ_OPEN_DOC",
  "READ_TRANSFER",
  "WRITE_MUTATION",
  "UNKNOWN",
]);

export type PortalActionSafetyClass = z.infer<typeof portalActionSafetyClassSchema>;

export const portalSafetyConfigSchema = z.object({
  safetyMode: portalSafetyModeSchema.default("READ_ONLY"),
  allowAuthSubmit: z.boolean().default(true),
  allowSearchAndFilterInput: z.boolean().default(true),
  allowArtifactDownloads: z.boolean().default(true),
  enforceDangerousControlDetection: z.boolean().default(true),
});

export type PortalSafetyConfig = z.infer<typeof portalSafetyConfigSchema>;

export const defaultPortalSafetyConfig: PortalSafetyConfig = {
  safetyMode: "READ_ONLY",
  allowAuthSubmit: true,
  allowSearchAndFilterInput: true,
  allowArtifactDownloads: true,
  enforceDangerousControlDetection: true,
};
