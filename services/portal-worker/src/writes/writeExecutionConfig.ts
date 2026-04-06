import { type DocumentKind, type PortalSafetyMode, type WriteMode } from "@medical-ai-qa/shared-types";

export interface WriteExecutionConfig {
  safetyMode: PortalSafetyMode;
  mode: WriteMode;
  writesEnabled: boolean;
  maxWritesPerRun: number;
  stopOnWriteFailure: boolean;
  allowedTargetFields: Set<string> | null;
  restrictToDocumentKinds: Set<DocumentKind> | null;
}

export function resolveWriteExecutionConfig(input: {
  safetyMode?: PortalSafetyMode;
  writeMode?: WriteMode;
  writesEnabled?: boolean;
  maxWritesPerRun?: number;
  stopOnWriteFailure?: boolean;
  allowedWriteTargetFields?: string[];
  restrictWriteDocumentKinds?: DocumentKind[];
}): WriteExecutionConfig {
  const safetyMode = input.safetyMode ?? "READ_ONLY";
  return {
    safetyMode,
    mode: input.writeMode ?? "DRY_RUN",
    writesEnabled: safetyMode === "READ_ONLY" ? false : (input.writesEnabled ?? false),
    maxWritesPerRun: input.maxWritesPerRun ?? 5,
    stopOnWriteFailure: input.stopOnWriteFailure ?? false,
    allowedTargetFields: input.allowedWriteTargetFields?.length
      ? new Set(input.allowedWriteTargetFields)
      : null,
    restrictToDocumentKinds: input.restrictWriteDocumentKinds?.length
      ? new Set(input.restrictWriteDocumentKinds)
      : null,
  };
}
