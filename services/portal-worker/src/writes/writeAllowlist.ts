import { type DocumentKind } from "@medical-ai-qa/shared-types";
import { type WriteAllowlistEntry } from "../types/writeTargets";

const WRITE_ALLOWLIST: WriteAllowlistEntry[] = [
  {
    targetDocumentKind: "VISIT_NOTE",
    targetField: "frequencySummary",
    supportedAction: "UPDATE_FIELD",
    supportedChangeStrategy: "REPLACE",
    maxLength: 48,
    allowedExecutionModes: ["DRY_RUN", "EXECUTE"],
    allowEmptyCurrentValue: false,
    allowReplaceNonEmptyCurrentValue: true,
    requiresTargetAnchorMatch: true,
    requiresHighConfidence: true,
  },
  {
    targetDocumentKind: "OASIS",
    targetField: "frequencySummary",
    supportedAction: "UPDATE_FIELD",
    supportedChangeStrategy: "REPLACE",
    maxLength: 48,
    allowedExecutionModes: ["DRY_RUN"],
    allowEmptyCurrentValue: false,
    allowReplaceNonEmptyCurrentValue: false,
    requiresTargetAnchorMatch: true,
    requiresHighConfidence: true,
  },
  {
    targetDocumentKind: "PLAN_OF_CARE",
    targetField: "frequencySummary",
    supportedAction: "UPDATE_FIELD",
    supportedChangeStrategy: "REPLACE",
    maxLength: 48,
    allowedExecutionModes: ["DRY_RUN"],
    allowEmptyCurrentValue: false,
    allowReplaceNonEmptyCurrentValue: false,
    requiresTargetAnchorMatch: true,
    requiresHighConfidence: true,
  },
  {
    targetDocumentKind: "ADMISSION_ORDER",
    targetField: "orderSummary",
    supportedAction: "UPDATE_FIELD",
    supportedChangeStrategy: "REPLACE",
    maxLength: 48,
    allowedExecutionModes: ["DRY_RUN"],
    allowEmptyCurrentValue: false,
    allowReplaceNonEmptyCurrentValue: false,
    requiresTargetAnchorMatch: true,
    requiresHighConfidence: true,
  },
  {
    targetDocumentKind: "PHYSICIAN_ORDER",
    targetField: "orderSummary",
    supportedAction: "UPDATE_FIELD",
    supportedChangeStrategy: "REPLACE",
    maxLength: 48,
    allowedExecutionModes: ["DRY_RUN"],
    allowEmptyCurrentValue: false,
    allowReplaceNonEmptyCurrentValue: false,
    requiresTargetAnchorMatch: true,
    requiresHighConfidence: true,
  },
];

export function getWriteAllowlistEntry(
  targetDocumentKind: DocumentKind | null | undefined,
  targetField: string | null | undefined,
) {
  if (!targetDocumentKind || !targetField) {
    return null;
  }

  return WRITE_ALLOWLIST.find((entry) =>
    entry.targetDocumentKind === targetDocumentKind &&
    entry.targetField === targetField,
  ) ?? null;
}

export function isAllowlistedWriteTarget(
  targetDocumentKind: DocumentKind | null | undefined,
  targetField: string | null | undefined,
): boolean {
  return Boolean(getWriteAllowlistEntry(targetDocumentKind, targetField));
}

export function listWriteAllowlist(): readonly WriteAllowlistEntry[] {
  return WRITE_ALLOWLIST;
}
