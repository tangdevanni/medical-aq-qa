import { type DocumentKind } from "@medical-ai-qa/shared-types";
import { type WorkflowMode, type WorkflowStepResult } from "../../types/workflowCompletion";
import { type WorkflowPageLike } from "../../types/workflowSteps";
import { executeWorkflowActionStep } from "./stepExecutionShared";
import { type RetryAttemptRecord } from "../../types/runtimeDiagnostics";

export function executeValidatePageStep(input: {
  page: WorkflowPageLike;
  documentKind: DocumentKind | null;
  mode: WorkflowMode;
  onRetryRecord?: (record: RetryAttemptRecord) => void;
}): Promise<WorkflowStepResult> {
  return executeWorkflowActionStep({
    ...input,
    action: "VALIDATE_PAGE",
  });
}
