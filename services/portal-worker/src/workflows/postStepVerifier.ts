import { type DocumentKind } from "@medical-ai-qa/shared-types";
import {
  type FinalizeAction,
  type WorkflowStateSnapshot,
  type WorkflowWarning,
} from "../types/workflowCompletion";
import { type WorkflowActionSelectorDefinition, type WorkflowPageLike } from "../types/workflowSteps";

export async function captureWorkflowStateSnapshot(input: {
  page: WorkflowPageLike;
  documentKind: DocumentKind | null;
  currentAction: FinalizeAction;
  definition: WorkflowActionSelectorDefinition | null;
}): Promise<WorkflowStateSnapshot> {
  const successIndicatorsPresent = input.definition
    ? await hasVisibleSelector(input.page, input.definition.successSelectors)
    : null;
  const dirtyIndicatorsPresent = input.definition
    ? await hasVisibleSelector(input.page, input.definition.dirtySelectors)
    : null;

  return {
    capturedAt: new Date().toISOString(),
    documentKind: input.documentKind,
    currentUrlPath: toUrlPath(input.page.url()),
    signedState: null,
    dirtyIndicatorsPresent,
    successIndicatorsPresent,
    availableActions: input.definition ? [input.currentAction] : [],
  };
}

export async function runPostStepVerification(input: {
  page: WorkflowPageLike;
  documentKind: DocumentKind | null;
  action: FinalizeAction;
  definition: WorkflowActionSelectorDefinition;
}): Promise<{
  verificationPassed: boolean;
  snapshot: WorkflowStateSnapshot;
  warnings: WorkflowWarning[];
}> {
  const snapshot = await captureWorkflowStateSnapshot({
    page: input.page,
    documentKind: input.documentKind,
    currentAction: input.action,
    definition: input.definition,
  });
  const success = snapshot.successIndicatorsPresent === true;
  const dirty = snapshot.dirtyIndicatorsPresent === true;
  const warnings: WorkflowWarning[] = [];

  if (!success) {
    warnings.push({
      code: "POST_STEP_SIGNAL_MISSING",
      message: `${input.action} did not expose a deterministic success indicator.`,
    });
  }

  if (dirty) {
    warnings.push({
      code: "DIRTY_STATE_REMAINS",
      message: `${input.action} left a dirty or unsaved state indicator visible.`,
    });
  }

  return {
    verificationPassed: success && !dirty,
    snapshot,
    warnings,
  };
}

async function hasVisibleSelector(
  page: WorkflowPageLike,
  selectors: readonly string[],
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 5);

    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) {
        return true;
      }
    }
  }

  return false;
}

function toUrlPath(url: string): string | null {
  try {
    return new URL(url).pathname || null;
  } catch {
    return null;
  }
}
