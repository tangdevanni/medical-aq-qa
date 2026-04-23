const SECRET_KEYS = new Set(["password", "token", "secret"]);

export function redactAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        return [key, "[REDACTED]"];
      }

      return [key, value];
    }),
  );
}
