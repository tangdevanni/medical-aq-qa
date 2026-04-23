import {
  defaultPortalSafetyConfig,
  portalSafetyConfigSchema,
  type PortalActionSafetyClass,
  type PortalJob,
  type PortalSafetyConfig,
} from "@medical-ai-qa/shared-types";

export function resolvePortalSafetyConfig(job: PortalJob): PortalSafetyConfig {
  const payload = job.payload as Record<string, unknown> | undefined;
  const legacyReadOnly =
    payload?.readOnly === true ||
    payload?.permissions === "read_only_navigation";
  const safetyInput = typeof job.safety === "object" && job.safety !== null
    ? job.safety
    : {
        ...defaultPortalSafetyConfig,
        safetyMode: legacyReadOnly ? "READ_ONLY" : defaultPortalSafetyConfig.safetyMode,
      };

  return portalSafetyConfigSchema.parse(safetyInput);
}

export function classifyDangerousControlLabel(label: string | null | undefined): PortalActionSafetyClass {
  const normalized = label?.trim() ?? "";
  if (!normalized) {
    return "UNKNOWN";
  }

  if (/\blog(?:\s+)?in\b|\bsign(?:\s+)?in\b/i.test(normalized)) {
    return "AUTH_ONLY";
  }

  if (/\b(search|find|filter|sort|next|previous|back|close|cancel|open|view)\b/i.test(normalized)) {
    return "READ_NAV";
  }

  if (/\b(download|view document|open document|preview)\b/i.test(normalized)) {
    return "READ_TRANSFER";
  }

  if (/\b(save|submit|validate|approve|sign|complete|update|assign|create|add|upload|delete|archive|send)\b/i.test(normalized)) {
    return "WRITE_MUTATION";
  }

  return "UNKNOWN";
}
