export type AuditLevel = "info" | "warn" | "error";

export interface AuditEvent {
  event: string;
  level: AuditLevel;
  timestamp: string;
  payload?: Record<string, unknown>;
}
