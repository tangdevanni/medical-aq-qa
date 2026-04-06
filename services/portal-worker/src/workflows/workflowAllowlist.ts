import {
  type DocumentFamily,
  type DocumentKind,
  type FinalizeAction,
  type OperatorCheckpointCategory,
  type WorkflowSupportLevel,
  type WriteExecutionStatus,
} from "@medical-ai-qa/shared-types";

export interface WorkflowAllowlistEntry {
  targetDocumentKind: DocumentKind;
  targetField: string | null;
  documentFamily: DocumentFamily;
  supportLevel: WorkflowSupportLevel;
  permittedActions: readonly FinalizeAction[];
  executableActions: readonly FinalizeAction[];
  reviewGatedActions: readonly FinalizeAction[];
  blockedActions: readonly FinalizeAction[];
  defaultPlan: readonly FinalizeAction[];
  checkpointCategories: readonly OperatorCheckpointCategory[];
  requiresVerifiedWriteStatuses: readonly WriteExecutionStatus[];
  requiresOperatorCheckpoint: boolean;
  maxStepsPerRun: number;
  dryRunPermitted: boolean;
  reason: string;
}

const WORKFLOW_ALLOWLIST: WorkflowAllowlistEntry[] = [
  {
    targetDocumentKind: "VISIT_NOTE",
    targetField: "frequencySummary",
    documentFamily: "VISIT_NOTE",
    supportLevel: "REVIEW_GATED",
    permittedActions: ["SAVE_PAGE", "VALIDATE_PAGE"],
    executableActions: ["SAVE_PAGE"],
    reviewGatedActions: ["VALIDATE_PAGE"],
    blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"],
    defaultPlan: ["SAVE_PAGE", "VALIDATE_PAGE", "STOP_FOR_REVIEW"],
    checkpointCategories: ["PRE_VALIDATE_REVIEW"],
    requiresVerifiedWriteStatuses: ["VERIFIED"],
    requiresOperatorCheckpoint: true,
    maxStepsPerRun: 3,
    dryRunPermitted: true,
    reason: "Visit-note frequency updates can save in place, but validation remains review-gated.",
  },
  {
    targetDocumentKind: "OASIS",
    targetField: "frequencySummary",
    documentFamily: "OASIS",
    supportLevel: "REVIEW_GATED",
    permittedActions: ["SAVE_PAGE", "VALIDATE_PAGE"],
    executableActions: [],
    reviewGatedActions: ["SAVE_PAGE", "VALIDATE_PAGE"],
    blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"],
    defaultPlan: ["STOP_FOR_REVIEW"],
    checkpointCategories: ["SOURCE_OF_TRUTH_REVIEW", "DOCUMENT_KIND_REVIEW"],
    requiresVerifiedWriteStatuses: ["VERIFIED"],
    requiresOperatorCheckpoint: true,
    maxStepsPerRun: 1,
    dryRunPermitted: true,
    reason: "OASIS workflow support is review-gated until selectors and source-of-truth mapping are execution-ready.",
  },
  {
    targetDocumentKind: "PLAN_OF_CARE",
    targetField: "frequencySummary",
    documentFamily: "PLAN_OF_CARE",
    supportLevel: "SAVE_ONLY",
    permittedActions: ["SAVE_PAGE", "VALIDATE_PAGE"],
    executableActions: ["SAVE_PAGE"],
    reviewGatedActions: ["VALIDATE_PAGE"],
    blockedActions: ["LOCK_RECORD", "MARK_QA_COMPLETE"],
    defaultPlan: ["SAVE_PAGE", "STOP_FOR_REVIEW"],
    checkpointCategories: ["PRE_VALIDATE_REVIEW", "DOCUMENT_KIND_REVIEW"],
    requiresVerifiedWriteStatuses: ["VERIFIED"],
    requiresOperatorCheckpoint: true,
    maxStepsPerRun: 2,
    dryRunPermitted: true,
    reason: "Plan-of-care support is save-capable, but downstream completion remains review-gated.",
  },
  {
    targetDocumentKind: "ADMISSION_ORDER",
    targetField: "orderSummary",
    documentFamily: "ORDER_FAMILY",
    supportLevel: "PLANNED_ONLY",
    permittedActions: [],
    executableActions: [],
    reviewGatedActions: [],
    blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
    defaultPlan: ["STOP_FOR_REVIEW"],
    checkpointCategories: ["EPISODE_ASSOCIATION_REVIEW", "DOCUMENT_KIND_REVIEW"],
    requiresVerifiedWriteStatuses: ["VERIFIED"],
    requiresOperatorCheckpoint: true,
    maxStepsPerRun: 1,
    dryRunPermitted: true,
    reason: "Admission orders are currently planned-only until deterministic write targets and workflow selectors are proven stable.",
  },
  {
    targetDocumentKind: "PHYSICIAN_ORDER",
    targetField: "orderSummary",
    documentFamily: "ORDER_FAMILY",
    supportLevel: "PLANNED_ONLY",
    permittedActions: [],
    executableActions: [],
    reviewGatedActions: [],
    blockedActions: ["SAVE_PAGE", "VALIDATE_PAGE", "LOCK_RECORD", "MARK_QA_COMPLETE"],
    defaultPlan: ["STOP_FOR_REVIEW"],
    checkpointCategories: ["EPISODE_ASSOCIATION_REVIEW", "DOCUMENT_KIND_REVIEW"],
    requiresVerifiedWriteStatuses: ["VERIFIED"],
    requiresOperatorCheckpoint: true,
    maxStepsPerRun: 1,
    dryRunPermitted: true,
    reason: "Physician orders are currently planned-only until deterministic write targets and workflow selectors are proven stable.",
  },
];

validateWorkflowAllowlist(WORKFLOW_ALLOWLIST);

export function getWorkflowAllowlistEntry(
  targetDocumentKind: DocumentKind | null | undefined,
  targetField: string | null | undefined,
): WorkflowAllowlistEntry | null {
  if (!targetDocumentKind) {
    return null;
  }

  return WORKFLOW_ALLOWLIST.find((entry) =>
    entry.targetDocumentKind === targetDocumentKind &&
    entry.targetField === (targetField ?? null),
  ) ?? WORKFLOW_ALLOWLIST.find((entry) =>
    entry.targetDocumentKind === targetDocumentKind &&
    entry.targetField === null,
  ) ?? null;
}

export function listWorkflowAllowlist(): readonly WorkflowAllowlistEntry[] {
  return WORKFLOW_ALLOWLIST;
}

function validateWorkflowAllowlist(entries: readonly WorkflowAllowlistEntry[]): void {
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const key = `${entry.targetDocumentKind}:${entry.targetField ?? "*"}`;
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate workflow allowlist entry: ${key}`);
    }
    seenKeys.add(key);

    const executableActions = new Set(entry.executableActions);
    const reviewGatedActions = new Set(entry.reviewGatedActions);
    const blockedActions = new Set(entry.blockedActions);
    const permittedActions = new Set(entry.permittedActions);
    const defaultPlanActions = entry.defaultPlan.filter((action) => action !== "STOP_FOR_REVIEW");

    for (const action of entry.executableActions) {
      if (!permittedActions.has(action)) {
        throw new Error(`Workflow allowlist ${key} has executable action outside permittedActions: ${action}`);
      }
      if (reviewGatedActions.has(action) || blockedActions.has(action)) {
        throw new Error(`Workflow allowlist ${key} marks ${action} in multiple action sets.`);
      }
    }

    for (const action of entry.reviewGatedActions) {
      if (!permittedActions.has(action)) {
        throw new Error(`Workflow allowlist ${key} has review-gated action outside permittedActions: ${action}`);
      }
      if (blockedActions.has(action)) {
        throw new Error(`Workflow allowlist ${key} marks ${action} as both review-gated and blocked.`);
      }
    }

    for (const action of defaultPlanActions) {
      if (!permittedActions.has(action)) {
        throw new Error(`Workflow allowlist ${key} default plan references non-permitted action: ${action}`);
      }
    }

    switch (entry.supportLevel) {
      case "SAVE_ONLY":
        if (entry.executableActions.some((action) => action !== "SAVE_PAGE")) {
          throw new Error(`Workflow allowlist ${key} is SAVE_ONLY but exposes non-save executable actions.`);
        }
        break;
      case "PLANNED_ONLY":
        if (
          entry.permittedActions.length > 0 ||
          entry.executableActions.length > 0 ||
          entry.reviewGatedActions.length > 0
        ) {
          throw new Error(`Workflow allowlist ${key} is PLANNED_ONLY but exposes executable or review-gated actions.`);
        }
        if (entry.defaultPlan.length !== 1 || entry.defaultPlan[0] !== "STOP_FOR_REVIEW") {
          throw new Error(`Workflow allowlist ${key} is PLANNED_ONLY and must plan only STOP_FOR_REVIEW.`);
        }
        break;
      case "REVIEW_GATED":
        if (entry.reviewGatedActions.length === 0 && entry.requiresOperatorCheckpoint) {
          throw new Error(`Workflow allowlist ${key} is REVIEW_GATED but has no review-gated actions.`);
        }
        break;
      case "FULLY_SUPPORTED":
      case "NOT_SUPPORTED":
        break;
    }
  }
}
