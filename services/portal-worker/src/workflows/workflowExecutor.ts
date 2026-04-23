import {
  type CrossDocumentQaResult,
  type DocumentKind,
  type QaDecisionResult,
  type WriteExecutionResult,
  workflowCompletionResultSchema,
} from "@medical-ai-qa/shared-types";
import { type RetryAttemptRecord } from "../types/runtimeDiagnostics";
import { executeLockRecordStep } from "./steps/lockRecordStep";
import { executeMarkQaCompleteStep } from "./steps/markQaCompleteStep";
import { executeSavePageStep } from "./steps/savePageStep";
import { executeValidatePageStep } from "./steps/validatePageStep";
import { buildOperatorCheckpoint } from "./operatorCheckpointBuilder";
import { type WorkflowExecutionConfig } from "./workflowExecutionConfig";
import { evaluateWorkflowGuards } from "./workflowGuardEvaluator";
import { buildWorkflowPlan } from "./workflowPlanner";
import { getWorkflowSupport } from "./workflowSupportMatrix";
import {
  buildBlockedWorkflowStepResult,
  buildPlannedWorkflowStepResult,
  buildWorkflowWarning,
  emptyWorkflowCompletionResult,
} from "./workflowResultHelpers";
import { type WorkflowPageLike } from "../types/workflowSteps";

export async function executeWorkflowCompletion(input: {
  page: WorkflowPageLike | null;
  currentDocumentKind: DocumentKind;
  crossDocumentQa: CrossDocumentQaResult;
  decisionResult: QaDecisionResult;
  writeExecutionResult: WriteExecutionResult;
  config: WorkflowExecutionConfig;
  onRetryRecord?: (record: RetryAttemptRecord) => void;
}): Promise<import("@medical-ai-qa/shared-types").WorkflowCompletionResult> {
  if (input.config.safetyMode === "READ_ONLY") {
    return workflowCompletionResultSchema.parse({
      ...emptyWorkflowCompletionResult({
        mode: input.config.mode,
        documentKind: input.currentDocumentKind,
        workflowSupport: getWorkflowSupport({
          documentKind: input.currentDocumentKind,
          targetField: null,
        }),
        bundleConfidence: input.crossDocumentQa.bundleConfidence,
        decisionConfidence: "LOW",
        sourceWriteStatus: null,
      }),
      attempted: false,
      status: "BLOCKED",
      eligibility: "INELIGIBLE",
      guardFailures: ["READ_ONLY_MODE_ENFORCED"],
      warnings: [buildWorkflowWarning("READ_ONLY", "Workflow execution blocked because safetyMode=READ_ONLY.")],
    });
  }

  const guardEvaluation = evaluateWorkflowGuards({
    currentDocumentKind: input.currentDocumentKind,
    crossDocumentQa: input.crossDocumentQa,
    decisionResult: input.decisionResult,
    writeExecutionResult: input.writeExecutionResult,
    config: input.config,
  });
  const baseResult = emptyWorkflowCompletionResult({
    mode: input.config.mode,
    documentKind: guardEvaluation.targetDocumentKind ?? input.currentDocumentKind,
    targetField: guardEvaluation.targetField,
    workflowSupport: guardEvaluation.workflowSupport,
    bundleConfidence: guardEvaluation.verifiedWriteAttempt?.audit.bundleConfidence ?? input.crossDocumentQa.bundleConfidence,
    decisionConfidence: guardEvaluation.verifiedWriteAttempt?.audit.decisionConfidence ?? "LOW",
    sourceWriteStatus: guardEvaluation.verifiedWriteAttempt?.status ?? null,
  });
  const plan = guardEvaluation.allowlistEntry
    ? buildWorkflowPlan({
      allowlistEntry: guardEvaluation.allowlistEntry,
      config: input.config,
    })
    : null;
  const plannedCheckpointStep = plan?.steps.find((step) => step.requiresOperatorCheckpoint) ?? null;
  const defaultCheckpoint = guardEvaluation.allowlistEntry
    ? buildOperatorCheckpoint({
      action: plannedCheckpointStep?.action ?? "STOP_FOR_REVIEW",
      allowlistEntry: guardEvaluation.allowlistEntry,
      config: input.config,
      workflowSupport: guardEvaluation.workflowSupport,
      matchedDecision: guardEvaluation.matchedDecision,
    })
    : null;

  if (!guardEvaluation.eligible || !guardEvaluation.allowlistEntry || !guardEvaluation.verifiedWriteAttempt) {
    return workflowCompletionResultSchema.parse({
      ...baseResult,
      attempted: guardEvaluation.verifiedWriteAttempt !== null || input.writeExecutionResult.attempted,
      status: deriveIneligibleWorkflowStatus(guardEvaluation.workflowSupport.supportLevel),
      eligibility: guardEvaluation.eligibility,
      plan,
      operatorCheckpoint: defaultCheckpoint,
      guardFailures: guardEvaluation.reasons,
      warnings: guardEvaluation.reasons.map((reason) =>
        buildWorkflowWarning(reason, `Workflow blocked by guard: ${reason}.`),
      ),
    });
  }

  if (!plan) {
    return workflowCompletionResultSchema.parse({
      ...baseResult,
      attempted: true,
      status: "BLOCKED",
      eligibility: "INELIGIBLE",
      guardFailures: ["DOCUMENT_KIND_NOT_EXECUTION_READY"],
      warnings: [buildWorkflowWarning("PLAN_MISSING", "No workflow plan could be constructed for this document kind.")],
    });
  }

  if (input.config.mode === "DRY_RUN") {
    return workflowCompletionResultSchema.parse({
      ...baseResult,
      attempted: true,
      status: guardEvaluation.workflowSupport.supportLevel === "PLANNED_ONLY" ? "PLANNED_ONLY" : "PARTIAL",
      eligibility: guardEvaluation.eligibility,
      plan,
      steps: plan.steps.map((step) => buildPlannedWorkflowStepResult({
        action: step.action,
        mode: input.config.mode,
        status: step.status === "BLOCKED" ? "BLOCKED" : "PLANNED",
        guardFailures: step.status === "BLOCKED" && step.guardFailure ? [step.guardFailure] : [],
        warnings: step.status === "BLOCKED"
          ? [buildWorkflowWarning("PLAN_BLOCKED", step.reason ?? "Workflow step blocked during planning.")]
          : [buildWorkflowWarning("DRY_RUN", "Workflow step planned but not executed because mode=DRY_RUN.")],
      })),
      operatorCheckpoint: defaultCheckpoint,
      warnings: [buildWorkflowWarning("DRY_RUN", "Workflow plan produced without mutating the page.")],
    });
  }

  if (!input.page) {
    return workflowCompletionResultSchema.parse({
      ...baseResult,
      attempted: true,
      status: "BLOCKED",
      eligibility: "REVIEW_REQUIRED",
      plan,
      operatorCheckpoint: defaultCheckpoint,
      guardFailures: ["PRECONDITION_NOT_MET"],
      warnings: [buildWorkflowWarning("PAGE_REQUIRED", "Workflow execution required an open target page.")],
    });
  }

  const steps: import("@medical-ai-qa/shared-types").WorkflowStepResult[] = [];
  let operatorCheckpoint: import("@medical-ai-qa/shared-types").OperatorCheckpoint | null = defaultCheckpoint;

  for (const plannedStep of plan.steps) {
    if (plannedStep.status === "BLOCKED") {
      steps.push(buildBlockedWorkflowStepResult({
        action: plannedStep.action,
        mode: input.config.mode,
        guardFailures: plannedStep.guardFailure ? [plannedStep.guardFailure] : ["ACTION_NOT_ENABLED_BY_CONFIG"],
        warnings: [buildWorkflowWarning("PLAN_BLOCKED", plannedStep.reason ?? "Workflow step blocked during planning.")],
      }));
      continue;
    }

    if (plannedStep.action === "STOP_FOR_REVIEW") {
      if (!operatorCheckpoint && guardEvaluation.allowlistEntry.requiresOperatorCheckpoint) {
        operatorCheckpoint = buildOperatorCheckpoint({
          action: plannedStep.action,
          allowlistEntry: guardEvaluation.allowlistEntry,
          config: input.config,
          workflowSupport: guardEvaluation.workflowSupport,
          matchedDecision: guardEvaluation.matchedDecision,
        });
      }
      steps.push({
        action: plannedStep.action,
        status: "VERIFIED",
        mode: input.config.mode,
        attempted: false,
        selectorUsed: null,
        verificationPassed: true,
        guardFailures: [],
        warnings: operatorCheckpoint?.required
          ? [buildWorkflowWarning("OPERATOR_REVIEW", operatorCheckpoint.reason ?? "Operator review required.")]
          : [],
        snapshotBefore: null,
        snapshotAfter: null,
        executedAt: null,
        verifiedAt: new Date().toISOString(),
      });
      break;
    }

    if (plannedStep.requiresOperatorCheckpoint) {
      operatorCheckpoint = buildOperatorCheckpoint({
        action: plannedStep.action,
        allowlistEntry: guardEvaluation.allowlistEntry,
        config: input.config,
        workflowSupport: guardEvaluation.workflowSupport,
        matchedDecision: guardEvaluation.matchedDecision,
      });
      steps.push(buildBlockedWorkflowStepResult({
        action: plannedStep.action,
        mode: input.config.mode,
        guardFailures: ["OPERATOR_CHECKPOINT_REQUIRED"],
        warnings: [buildWorkflowWarning("OPERATOR_CHECKPOINT", operatorCheckpoint?.reason ?? "Operator review required before this step.")],
      }));
      continue;
    }

    const stepResult = await executeSingleWorkflowStep({
      page: input.page,
      documentKind: input.currentDocumentKind,
      action: plannedStep.action,
      mode: input.config.mode,
      onRetryRecord: input.onRetryRecord,
    });
    steps.push(stepResult);

    if (
      stepResult.status === "FAILED" ||
      stepResult.status === "BLOCKED"
    ) {
      break;
    }
  }

  const hasFailure = steps.some((step) => step.status === "FAILED");
  const hasBlocked = steps.some((step) => step.status === "BLOCKED");
  const hasVerifiedMutation = steps.some((step) =>
    step.status === "VERIFIED" && step.action !== "STOP_FOR_REVIEW",
  );
  const onlyReviewStepVerified =
    steps.some((step) => step.action === "STOP_FOR_REVIEW" && step.status === "VERIFIED") &&
    !hasBlocked &&
    !hasVerifiedMutation;

  return workflowCompletionResultSchema.parse({
    ...baseResult,
    attempted: true,
    status: deriveWorkflowStatus({
      hasFailure,
      hasBlocked,
      hasVerifiedMutation,
      hasOperatorCheckpoint: operatorCheckpoint?.required ?? false,
      onlyReviewStepVerified,
      hasPlannedOnlySupport: guardEvaluation.workflowSupport.supportLevel === "PLANNED_ONLY",
    }),
    eligibility: guardEvaluation.eligibility,
    plan,
    workflowSupport: guardEvaluation.workflowSupport,
    steps,
    operatorCheckpoint: operatorCheckpoint?.required ? operatorCheckpoint : null,
    guardFailures: hasFailure
      ? ["POST_STEP_VERIFICATION_FAILED"]
      : hasBlocked && !hasVerifiedMutation
        ? [...new Set(steps.flatMap((step) => step.guardFailures))]
        : [],
    warnings: [],
  });
}

async function executeSingleWorkflowStep(input: {
  page: WorkflowPageLike;
  documentKind: DocumentKind;
  action: "SAVE_PAGE" | "VALIDATE_PAGE" | "LOCK_RECORD" | "MARK_QA_COMPLETE";
  mode: "EXECUTE";
  onRetryRecord?: (record: RetryAttemptRecord) => void;
}) {
  switch (input.action) {
    case "SAVE_PAGE":
      return executeSavePageStep(input);
    case "VALIDATE_PAGE":
      return executeValidatePageStep(input);
    case "LOCK_RECORD":
      return executeLockRecordStep(input);
    case "MARK_QA_COMPLETE":
      return executeMarkQaCompleteStep(input);
  }
}

function deriveWorkflowStatus(input: {
  hasFailure: boolean;
  hasBlocked: boolean;
  hasVerifiedMutation: boolean;
  hasOperatorCheckpoint: boolean;
  onlyReviewStepVerified: boolean;
  hasPlannedOnlySupport: boolean;
}) {
  if (input.hasFailure) {
    return "FAILED" as const;
  }

  if (input.hasPlannedOnlySupport && !input.hasVerifiedMutation) {
    return "PLANNED_ONLY" as const;
  }

  if (input.hasBlocked && !input.hasVerifiedMutation && !input.onlyReviewStepVerified) {
    return "BLOCKED" as const;
  }

  if (input.hasOperatorCheckpoint && input.hasVerifiedMutation) {
    return "PARTIAL" as const;
  }

  if (input.onlyReviewStepVerified) {
    return "REVIEW_REQUIRED" as const;
  }

  if (input.hasBlocked) {
    return "PARTIAL" as const;
  }

  if (input.hasOperatorCheckpoint) {
    return "REVIEW_REQUIRED" as const;
  }

  return "COMPLETED" as const;
}

function deriveIneligibleWorkflowStatus(
  supportLevel: import("@medical-ai-qa/shared-types").WorkflowSupport["supportLevel"],
) {
  switch (supportLevel) {
    case "PLANNED_ONLY":
      return "PLANNED_ONLY" as const;
    case "REVIEW_GATED":
    case "SAVE_ONLY":
      return "REVIEW_REQUIRED" as const;
    case "FULLY_SUPPORTED":
    case "NOT_SUPPORTED":
    default:
      return "BLOCKED" as const;
  }
}
