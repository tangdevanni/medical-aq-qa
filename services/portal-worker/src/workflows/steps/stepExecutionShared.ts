import { type DocumentKind } from "@medical-ai-qa/shared-types";
import { captureWorkflowStateSnapshot, runPostStepVerification } from "../postStepVerifier";
import {
  getWorkflowActionDefinition,
  resolveWorkflowActionTarget,
  routeMatchesWorkflowDefinition,
} from "../workflowSelectorRegistry";
import {
  buildBlockedWorkflowStepResult,
  buildWorkflowWarning,
} from "../workflowResultHelpers";
import { SAFE_READ_RETRY_POLICIES } from "../../reliability/retryPolicy";
import { withRetry } from "../../reliability/withRetry";
import { type WorkflowMode, type WorkflowStepResult } from "../../types/workflowCompletion";
import { type WorkflowPageLike } from "../../types/workflowSteps";
import { type RetryAttemptRecord } from "../../types/runtimeDiagnostics";
import { sanitizeObservabilityText } from "../../observability/sanitizeObservability";

export async function executeWorkflowActionStep(input: {
  page: WorkflowPageLike;
  documentKind: DocumentKind | null;
  action: "SAVE_PAGE" | "VALIDATE_PAGE" | "LOCK_RECORD" | "MARK_QA_COMPLETE";
  mode: WorkflowMode;
  onRetryRecord?: (record: RetryAttemptRecord) => void;
}): Promise<WorkflowStepResult> {
  const definition = getWorkflowActionDefinition(input.documentKind, input.action);
  const snapshotBefore = await captureWorkflowStateSnapshot({
    page: input.page,
    documentKind: input.documentKind,
    currentAction: input.action,
    definition,
  });

  if (!definition) {
    return buildBlockedWorkflowStepResult({
      action: input.action,
      mode: input.mode,
      guardFailures: ["STEP_NOT_ALLOWLISTED"],
      snapshotBefore,
    });
  }

  if (!routeMatchesWorkflowDefinition(input.page.url(), definition)) {
    return buildBlockedWorkflowStepResult({
      action: input.action,
      mode: input.mode,
      guardFailures: ["PAGE_KIND_MISMATCH", "PRECONDITION_NOT_MET"],
      warnings: [buildWorkflowWarning("ROUTE_MISMATCH", "Current page route did not match the workflow definition.")],
      snapshotBefore,
    });
  }

  const resolvedTarget = (await withRetry({
    policy: SAFE_READ_RETRY_POLICIES.selectorResolution,
    operation: `resolve-workflow-action:${input.action}`,
    execute: () => resolveWorkflowActionTarget(input.page, definition),
    documentKind: input.documentKind,
    action: input.action,
    onRetryRecord: input.onRetryRecord,
  })).result;
  if (resolvedTarget.status === "AMBIGUOUS") {
    return buildBlockedWorkflowStepResult({
      action: input.action,
      mode: input.mode,
      guardFailures: ["EXECUTABLE_CONTROL_AMBIGUOUS", "SELECTOR_CARDINALITY_UNEXPECTED", "PAGE_STATE_AMBIGUOUS"],
      warnings: [buildWorkflowWarning("AMBIGUOUS_SELECTOR", "Workflow action resolved to multiple visible controls.")],
      snapshotBefore,
    });
  }

  if (resolvedTarget.status !== "FOUND" || !resolvedTarget.target) {
    return buildBlockedWorkflowStepResult({
      action: input.action,
      mode: input.mode,
      guardFailures: [selectorNotFoundReason(input.action), "EXECUTABLE_CONTROL_MISSING"],
      snapshotBefore,
    });
  }

  if (!(await resolvedTarget.target.locator.isEnabled().catch(() => false))) {
    return buildBlockedWorkflowStepResult({
      action: input.action,
      mode: input.mode,
      guardFailures: ["PRECONDITION_NOT_MET"],
      warnings: [buildWorkflowWarning("CONTROL_DISABLED", "Workflow action control was present but disabled.")],
      snapshotBefore,
    });
  }

  const executedAt = new Date().toISOString();

  try {
    await resolvedTarget.target.locator.click();
    await input.page.waitForTimeout?.(250);
  } catch (error: unknown) {
    return {
      action: input.action,
      status: "FAILED",
      mode: input.mode,
      attempted: true,
      selectorUsed: resolvedTarget.target.selectorUsed,
      verificationPassed: false,
      guardFailures: [],
      warnings: [
        buildWorkflowWarning(
          "STEP_EXECUTION_FAILED",
          sanitizeObservabilityText(error instanceof Error ? error.message : "Workflow action click failed."),
        ),
      ],
      snapshotBefore,
      snapshotAfter: null,
      executedAt,
      verifiedAt: null,
    };
  }

  const verification = (await withRetry({
    policy: SAFE_READ_RETRY_POLICIES.postStepVerification,
    operation: `post-step-verification:${input.action}`,
    execute: () => runPostStepVerification({
      page: input.page,
      documentKind: input.documentKind,
      action: input.action,
      definition,
    }),
    documentKind: input.documentKind,
    action: input.action,
    onRetryRecord: input.onRetryRecord,
  })).result;

  if (!verification.verificationPassed) {
    return {
      action: input.action,
      status: "FAILED",
      mode: input.mode,
      attempted: true,
      selectorUsed: resolvedTarget.target.selectorUsed,
      verificationPassed: false,
      guardFailures: [
        "POST_STEP_VERIFICATION_FAILED",
        specificPostVerificationReason(input.action),
        "RETRY_EXHAUSTED",
      ],
      warnings: verification.warnings,
      snapshotBefore,
      snapshotAfter: verification.snapshot,
      executedAt,
      verifiedAt: null,
    };
  }

  return {
    action: input.action,
    status: "VERIFIED",
    mode: input.mode,
    attempted: true,
    selectorUsed: resolvedTarget.target.selectorUsed,
    verificationPassed: true,
    guardFailures: [],
    warnings: [],
    snapshotBefore,
    snapshotAfter: verification.snapshot,
    executedAt,
    verifiedAt: new Date().toISOString(),
  };
}

function selectorNotFoundReason(action: "SAVE_PAGE" | "VALIDATE_PAGE" | "LOCK_RECORD" | "MARK_QA_COMPLETE") {
  switch (action) {
    case "SAVE_PAGE":
      return "SAVE_SELECTOR_NOT_FOUND" as const;
    case "VALIDATE_PAGE":
      return "VALIDATE_SELECTOR_NOT_FOUND" as const;
    case "LOCK_RECORD":
      return "LOCK_SELECTOR_NOT_FOUND" as const;
    case "MARK_QA_COMPLETE":
      return "QA_COMPLETE_SELECTOR_NOT_FOUND" as const;
  }
}

function specificPostVerificationReason(action: "SAVE_PAGE" | "VALIDATE_PAGE" | "LOCK_RECORD" | "MARK_QA_COMPLETE") {
  switch (action) {
    case "SAVE_PAGE":
      return "POST_SAVE_SIGNAL_MISSING" as const;
    case "VALIDATE_PAGE":
      return "POST_VALIDATE_SIGNAL_MISSING" as const;
    case "LOCK_RECORD":
    case "MARK_QA_COMPLETE":
      return "POST_STEP_VERIFICATION_FAILED" as const;
  }
}
