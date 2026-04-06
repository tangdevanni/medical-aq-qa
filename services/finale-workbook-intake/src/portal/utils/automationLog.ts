import type { AutomationStepLog } from "@medical-ai-qa/shared-types";

export function createAutomationStepLog(input: {
  step: string;
  message: string;
  patientName?: string | null;
  urlBefore?: string | null;
  urlAfter?: string | null;
  selectorUsed?: string | null;
  found?: string[];
  missing?: string[];
  openedDocumentLabel?: string | null;
  openedDocumentUrl?: string | null;
  evidence?: string[];
  retryCount?: number;
  safeReadConfirmed?: boolean;
}): AutomationStepLog {
  return {
    timestamp: new Date().toISOString(),
    step: input.step,
    message: input.message,
    patientName: input.patientName ?? null,
    urlBefore: input.urlBefore ?? null,
    urlAfter: input.urlAfter ?? null,
    selectorUsed: input.selectorUsed ?? null,
    found: input.found ?? [],
    missing: input.missing ?? [],
    openedDocumentLabel: input.openedDocumentLabel ?? null,
    openedDocumentUrl: input.openedDocumentUrl ?? null,
    evidence: input.evidence ?? [],
    retryCount: input.retryCount ?? 0,
    safeReadConfirmed: input.safeReadConfirmed ?? true,
  };
}
