import {
  type DocumentKind,
  type FinalizeAction,
  type WorkflowSupport,
  workflowSupportSchema,
} from "@medical-ai-qa/shared-types";
import { type SupportDisposition, type SupportMatrixDiagnostic } from "../types/runtimeDiagnostics";
import { getWorkflowAllowlistEntry, listWorkflowAllowlist } from "./workflowAllowlist";

const EXECUTABLE_ACTIONS: readonly FinalizeAction[] = [
  "SAVE_PAGE",
  "VALIDATE_PAGE",
  "LOCK_RECORD",
  "MARK_QA_COMPLETE",
];

export function getWorkflowSupport(input: {
  documentKind: DocumentKind | null;
  targetField: string | null;
}): WorkflowSupport {
  const allowlistEntry = getWorkflowAllowlistEntry(input.documentKind, input.targetField);

  if (!input.documentKind || !allowlistEntry) {
    return workflowSupportSchema.parse({
      documentKind: input.documentKind,
      documentFamily: inferDocumentFamily(input.documentKind),
      targetField: input.targetField,
      supportLevel: "NOT_SUPPORTED",
      allowedActions: [],
      executableActions: [],
      reviewGatedActions: [],
      blockedActions: EXECUTABLE_ACTIONS,
      requiresVerifiedWrite: true,
      operatorCheckpointRequired: false,
      checkpointCategories: [],
      dryRunOnly: false,
      reason: "No explicit workflow policy is configured for this document kind and target field.",
    });
  }

  return workflowSupportSchema.parse({
    documentKind: allowlistEntry.targetDocumentKind,
    documentFamily: allowlistEntry.documentFamily,
    targetField: input.targetField ?? allowlistEntry.targetField,
    supportLevel: allowlistEntry.supportLevel,
    allowedActions: allowlistEntry.executableActions,
    executableActions: allowlistEntry.executableActions,
    reviewGatedActions: allowlistEntry.reviewGatedActions,
    blockedActions: allowlistEntry.blockedActions,
    requiresVerifiedWrite: allowlistEntry.requiresVerifiedWriteStatuses.length > 0,
    operatorCheckpointRequired: allowlistEntry.requiresOperatorCheckpoint,
    checkpointCategories: allowlistEntry.checkpointCategories,
    dryRunOnly:
      allowlistEntry.dryRunPermitted &&
      (
        allowlistEntry.supportLevel === "PLANNED_ONLY" ||
        allowlistEntry.executableActions.length === 0
      ),
    reason: allowlistEntry.reason,
  });
}

export function listWorkflowSupportMatrix(): WorkflowSupport[] {
  return listWorkflowAllowlist().map((entry) =>
    getWorkflowSupport({
      documentKind: entry.targetDocumentKind,
      targetField: entry.targetField,
    })
  );
}

export function getSupportDispositionForAction(
  workflowSupport: WorkflowSupport,
  action: FinalizeAction,
): SupportDisposition {
  if (workflowSupport.executableActions.includes(action)) {
    return "EXECUTABLE";
  }

  if (workflowSupport.reviewGatedActions.includes(action)) {
    return "REVIEW_GATED";
  }

  switch (workflowSupport.supportLevel) {
    case "PLANNED_ONLY":
      return "PLANNED_ONLY";
    case "NOT_SUPPORTED":
      return "NOT_SUPPORTED";
    default:
      return "UNKNOWN";
  }
}

export function buildWorkflowSupportDiagnostics(input: {
  workflowSupport: WorkflowSupport;
  actions: readonly FinalizeAction[];
}): SupportMatrixDiagnostic[] {
  return input.actions.map((action) => {
    const supportDisposition = getSupportDispositionForAction(input.workflowSupport, action);
    return {
      timestamp: new Date().toISOString(),
      documentKind: input.workflowSupport.documentKind,
      targetField: input.workflowSupport.targetField,
      action,
      supportLevel: input.workflowSupport.supportLevel,
      supportDisposition,
      driftEligible: supportDisposition === "EXECUTABLE",
      reason: supportDisposition === "EXECUTABLE"
        ? `${action} is currently executable for this document kind and target field.`
        : supportDisposition === "REVIEW_GATED"
          ? `${action} is intentionally review-gated for this document kind and target field.`
          : `${action} is not currently executable for this document kind and target field.`,
    };
  });
}

function inferDocumentFamily(documentKind: DocumentKind | null): WorkflowSupport["documentFamily"] {
  switch (documentKind) {
    case "VISIT_NOTE":
      return "VISIT_NOTE";
    case "OASIS":
      return "OASIS";
    case "PLAN_OF_CARE":
      return "PLAN_OF_CARE";
    case "ADMISSION_ORDER":
    case "PHYSICIAN_ORDER":
      return "ORDER_FAMILY";
    default:
      return "UNKNOWN";
  }
}
