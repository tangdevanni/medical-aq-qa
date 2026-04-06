import { type FinalizeAction, type WorkflowPlan } from "@medical-ai-qa/shared-types";
import { type WorkflowExecutionConfig } from "./workflowExecutionConfig";
import { type WorkflowAllowlistEntry } from "./workflowAllowlist";

export function buildWorkflowPlan(input: {
  allowlistEntry: WorkflowAllowlistEntry;
  config: WorkflowExecutionConfig;
}): WorkflowPlan {
  const maxSteps = Math.min(
    input.allowlistEntry.maxStepsPerRun,
    input.config.maxWorkflowStepsPerRun,
  );
  const needsStopForReview =
    input.allowlistEntry.defaultPlan.includes("STOP_FOR_REVIEW") &&
    (
      input.allowlistEntry.requiresOperatorCheckpoint ||
      input.allowlistEntry.defaultPlan.some((action) =>
        (
          action !== "STOP_FOR_REVIEW" &&
          input.allowlistEntry.reviewGatedActions.includes(action)
        ) ||
        input.config.requireOperatorCheckpointFor.has(action),
      )
    );
  const executableStepBudget = Math.max(0, maxSteps - (needsStopForReview ? 1 : 0));
  let executableStepsRetained = 0;
  const actionableSteps = input.allowlistEntry.defaultPlan
    .filter((action) => action !== "STOP_FOR_REVIEW")
    .map((action) => {
      const step = buildPlannedStep(action, input.allowlistEntry, input.config);

      if (step.status === "PLANNED" && executableStepsRetained >= executableStepBudget) {
        return {
          ...step,
          status: "BLOCKED" as const,
          guardFailure: "MAX_WORKFLOW_STEPS_PER_RUN_REACHED" as const,
          reason: "Skipped because maxWorkflowStepsPerRun reserved capacity for operator review handoff.",
        };
      }

      if (step.status === "PLANNED") {
        executableStepsRetained += 1;
      }

      return step;
    });
  const steps = [
    ...actionableSteps,
    ...(needsStopForReview && maxSteps > 0
      ? [buildPlannedStep("STOP_FOR_REVIEW", input.allowlistEntry, input.config)]
      : []),
  ];

  return {
    documentKind: input.allowlistEntry.targetDocumentKind,
    targetField: input.allowlistEntry.targetField,
    supportLevel: input.allowlistEntry.supportLevel,
    reason: buildPlanReason(input.allowlistEntry),
    steps,
    maxSteps,
  };
}

function buildPlannedStep(
  action: FinalizeAction,
  allowlistEntry: WorkflowAllowlistEntry,
  config: WorkflowExecutionConfig,
): WorkflowPlan["steps"][number] {
  return {
    action,
    status:
      !allowlistEntry.permittedActions.includes(action) ||
      (config.allowedActions !== null && !config.allowedActions.has(action))
        ? "BLOCKED"
        : "PLANNED",
    guardFailure:
      !allowlistEntry.permittedActions.includes(action)
        ? "STEP_NOT_ALLOWLISTED"
        : config.allowedActions !== null && !config.allowedActions.has(action)
          ? "ACTION_NOT_ENABLED_BY_CONFIG"
          : null,
    reason:
      !allowlistEntry.permittedActions.includes(action)
        ? `${action} is not permitted for ${allowlistEntry.targetDocumentKind}:${allowlistEntry.targetField ?? "document"}.`
        : config.allowedActions !== null && !config.allowedActions.has(action)
          ? `${action} is disabled by workflow execution config.`
          : null,
    requiresOperatorCheckpoint:
      action === "STOP_FOR_REVIEW" ||
      allowlistEntry.reviewGatedActions.includes(action) ||
      config.requireOperatorCheckpointFor.has(action),
  };
}

function buildPlanReason(entry: WorkflowAllowlistEntry): string {
  if (entry.reviewGatedActions.length === 0) {
    return entry.reason;
  }

  return `${entry.reason} Review-gated actions: ${entry.reviewGatedActions.join(", ")}.`;
}
