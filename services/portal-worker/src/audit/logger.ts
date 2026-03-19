import { type Logger } from "@medical-ai-qa/shared-logging";
import { redactAuditPayload } from "./redact";

export interface AuditLogger {
  record(event: string, payload?: Record<string, unknown>): void;
}

export function createAuditLogger(logger: Logger): AuditLogger {
  return {
    record(event: string, payload?: Record<string, unknown>): void {
      logger.info(`audit:${event}`, redactAuditPayload(payload ?? {}));
    },
  };
}
